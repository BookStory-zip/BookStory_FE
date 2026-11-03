// @vitest-environment jsdom
import { AuthApiError } from '@supabase/supabase-js'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError } from './lib/api'
import AccountSettings from './AccountSettings'

const mocks = vi.hoisted(() => ({ getProfile: vi.fn(), updateNickname: vi.fn(), deleteAccount: vi.fn(), isAccountDeleted: vi.fn() }))
vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  getProfile: mocks.getProfile,
  updateNickname: mocks.updateNickname,
}))
// 환경변수 없는 CI에서도 실제 Supabase 클라이언트를 만들지 않는다.
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
  deleteAccount: mocks.deleteAccount,
  isAccountDeleted: mocks.isAccountDeleted,
}))

const onDeleted = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getProfile.mockResolvedValue(null)
  mocks.isAccountDeleted.mockResolvedValue(false)
  onDeleted.mockResolvedValue(undefined)
})
afterEach(cleanup)

async function renderSettings() {
  render(<AccountSettings onDeleted={onDeleted} />)
  return screen.findByLabelText('닉네임')
}

function saveNickname(value: string) {
  fireEvent.change(screen.getByLabelText('닉네임'), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: '닉네임 저장' }))
}

test.each(['책', 'ㅋㅋ', '책  벌레', '책벌레!', 'a'.repeat(21)])('규칙에 맞지 않는 닉네임 %j는 보내지 않는다', async (value) => {
  await renderSettings()
  saveNickname(value)
  expect(screen.getByText(/닉네임은 2~20자/)).toBeTruthy()
  expect(mocks.updateNickname).not.toHaveBeenCalled()
})

test('앞뒤 공백을 지우고 NFC로 정규화해 보내며, 비우면 null로 지운다', async () => {
  mocks.getProfile.mockResolvedValue('독서광')
  mocks.updateNickname.mockImplementation(async (_token: string, value: string | null) => value)
  await renderSettings()
  // 자모를 나눠 쓴 '책'(NFD)도 완성형으로 합쳐 보낸다.
  saveNickname(`  ${'책벌레'.normalize('NFD')} 1  `)
  await screen.findByText('닉네임을 저장했습니다.')
  saveNickname('   ')
  await screen.findByText('닉네임을 지웠습니다. 공개 후기에는 독서가로 표시됩니다.')
  expect(mocks.updateNickname.mock.calls.map((call) => call[1])).toEqual(['책벌레 1', null])
})

test('서버의 invalid_nickname은 규칙 안내로, 결과가 불명확하면 다시 보내지 않고 입력을 둔다', async () => {
  mocks.updateNickname.mockRejectedValueOnce(new ApiError(422, undefined, 'invalid_nickname')).mockRejectedValueOnce(new TypeError('network'))
  await renderSettings()
  saveNickname('책벌레')
  await screen.findByText(/닉네임은 2~20자/)
  saveNickname('책벌레')
  await screen.findByText('저장 결과를 확인하지 못했습니다. 새로고침해 현재 닉네임을 확인해주세요.')
  expect(screen.getByLabelText('닉네임')).toHaveProperty('value', '책벌레')
  expect(mocks.updateNickname).toHaveBeenCalledTimes(2)
})

function requestDelete(password: string) {
  fireEvent.change(screen.getByLabelText('비밀번호 확인'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: '탈퇴하기' }))
}

test('비밀번호 확인과 확인창을 거친 뒤에만 탈퇴하고, 성공하면 로그아웃 정리를 부른다', async () => {
  mocks.deleteAccount.mockResolvedValue(undefined)
  await renderSettings()
  requestDelete('')
  expect(screen.getByText('탈퇴하려면 비밀번호를 입력해주세요.')).toBeTruthy()
  requestDelete('current password')
  expect(mocks.deleteAccount).not.toHaveBeenCalled()
  fireEvent.click(screen.getAllByRole('button', { name: '탈퇴하기', hidden: true }).at(-1)!)
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
  expect(mocks.deleteAccount).toHaveBeenCalledWith('current password')
})

test.each([
  [new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'), '비밀번호가 맞지 않습니다.'],
  [new ApiError(403, undefined, 'recent_login_required'), '보안을 위해 비밀번호를 다시 입력해주세요.'],
  [new ApiError(503, undefined, 'account_deletion_failed'), '계정 삭제를 마치지 못했습니다. 기록은 이미 지워졌으니 다시 시도해주세요.'],
  [new DOMException('timeout', 'TimeoutError'), '탈퇴 결과를 확인하지 못했습니다. 비밀번호를 입력하고 다시 시도하면 이어서 처리됩니다.'],
])('탈퇴 실패 %s는 로그아웃하지 않고 안내한다', async (error, message) => {
  mocks.deleteAccount.mockRejectedValue(error)
  await renderSettings()
  requestDelete('password')
  fireEvent.click(screen.getAllByRole('button', { name: '탈퇴하기', hidden: true }).at(-1)!)
  expect(await screen.findByText(message)).toBeTruthy()
  expect(onDeleted).not.toHaveBeenCalled()
  expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
})

test.each([
  ['결과가 불명확했는데', new DOMException('timeout', 'TimeoutError')],
  ['재시도의 재로그인이 비밀번호 오류였는데', new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')],
])('%s 로그인 계정이 이미 지워졌으면 탈퇴 완료로 처리한다', async (_label, error) => {
  mocks.deleteAccount.mockRejectedValue(error)
  mocks.isAccountDeleted.mockResolvedValue(true)
  await renderSettings()
  requestDelete('password')
  fireEvent.click(screen.getAllByRole('button', { name: '탈퇴하기', hidden: true }).at(-1)!)
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('비밀번호가 맞지 않습니다.')).toBeNull()
})

test('탈퇴 뒤 로그아웃이 화면을 닫지 못해도 완료 안내를 남기고 다시 보내지 않는다', async () => {
  mocks.deleteAccount.mockResolvedValue(undefined)
  await renderSettings()
  requestDelete('password')
  fireEvent.click(screen.getAllByRole('button', { name: '탈퇴하기', hidden: true }).at(-1)!)
  expect(await screen.findByText('탈퇴가 완료되었습니다. 로그아웃하는 중입니다.')).toBeTruthy()
  expect(screen.getByLabelText('비밀번호 확인')).toHaveProperty('disabled', true)
  requestDelete('password')
  expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
})
