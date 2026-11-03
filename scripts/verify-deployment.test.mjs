import { afterEach, expect, test, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deploymentInfo, verifyBackend, verifyProduction } from './verify-deployment.mjs'

const commit = 'a'.repeat(40)
const headers = {
  'content-type': 'text/html',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "frame-ancestors 'none'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
}
const result = { status: 'ok', deployment: { id: 'dpl_test123', url: 'https://bookstory-test-honey-0a33.vercel.app', readyState: 'READY', target: 'production' } }
function response(input, options) {
  const url = new URL(input)
  if (url.pathname === '/deployment.json') return Response.json({ commit })
  if (url.pathname === '/ready') return Response.json({ status: 'ready' })
  if (options?.method === 'OPTIONS') return new Response(null, { status: 200, headers: { 'access-control-allow-origin': 'https://bookstory-fe.vercel.app', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE', 'access-control-allow-headers': 'Authorization, Content-Type' } })
  return new Response('<!doctype html><html></html>', { headers })
}
afterEach(() => vi.unstubAllGlobals())

test.each([result, result.deployment])('완료된 운영 배포 결과 %j에서 ID·URL만 반환한다', (body) => {
  expect(deploymentInfo(body)).toEqual({ id: 'dpl_test123', url: result.deployment.url })
})
test.each([
  null,
  { status: 'error' },
  { status: 'error', deployment: result.deployment },
  { ...result.deployment, error: { name: 'CHECKS_FAILED' } },
  { ...result.deployment, readyState: 'ERROR' },
  { ...result, deployment: { ...result.deployment, readyState: 'BUILDING' } },
  { ...result, deployment: { ...result.deployment, target: 'preview' } },
  { ...result, deployment: { ...result.deployment, id: 'untrusted\ntext' } },
  { ...result, deployment: { ...result.deployment, url: 'https://unrelated.example' } },
])('완료된 운영 배포가 아닌 결과 %j는 거부한다', (body) => {
  expect(() => deploymentInfo(body)).toThrow()
})

test('BE 준비·CORS와 정확한 FE 커밋·7개 SPA 경로·보안 헤더를 읽기 전용으로 확인한다', async () => {
  const fetch = vi.fn(response)
  vi.stubGlobal('fetch', fetch)
  await verifyBackend()
  await verifyProduction(commit)
  expect(fetch).toHaveBeenCalledTimes(10)
  expect(fetch.mock.calls.some(([url]) => String(url).includes(`/deployment.json?commit=${commit}`))).toBe(true)
  for (const [, options] of fetch.mock.calls) {
    expect(['GET', 'OPTIONS']).toContain(options?.method ?? 'GET')
    expect(new Headers(options?.headers).has('authorization')).toBe(false)
  }
})
test.each(['', 'invalid', undefined])('잘못된 커밋 %j는 네트워크 요청 전에 거부한다', async (value) => {
  const fetch = vi.fn(response)
  vi.stubGlobal('fetch', fetch)
  await expect(verifyProduction(value)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
test('이전 배포의 200 응답은 성공으로 표시하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn((url, options) => String(url).includes('deployment.json') ? Response.json({ commit: 'b'.repeat(40) }) : response(url, options)))
  await expect(verifyProduction(commit)).rejects.toThrow('commit')
})
test('SPA fallback HTML은 커밋 표식으로 인정하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn((url, options) => String(url).includes('deployment.json') ? new Response('<html></html>', { headers }) : response(url, options)))
  await expect(verifyProduction(commit)).rejects.toThrow('JSON')
})
test('200이어도 보안 헤더가 없으면 실패한다', async () => {
  vi.stubGlobal('fetch', vi.fn((url, options) => new URL(url).pathname === '/records' ? new Response('<html></html>') : response(url, options)))
  await expect(verifyProduction(commit)).rejects.toThrow('header')
})
test('SPA 경로의 HTTP 오류를 유지한다', async () => {
  vi.stubGlobal('fetch', vi.fn((url, options) => new URL(url).pathname === '/search' ? new Response(null, { status: 503 }) : response(url, options)))
  await expect(verifyProduction(commit)).rejects.toThrow('503')
})
test('BE가 준비되지 않으면 배포 전 검사를 실패시킨다', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
  vi.stubGlobal('fetch', fetch)
  await expect(verifyBackend()).rejects.toThrow('503')
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('운영 origin에 대한 PATCH가 허용되지 않으면 실패한다', async () => {
  vi.stubGlobal('fetch', vi.fn((url, options) => options?.method === 'OPTIONS' ? new Response(null, { status: 200, headers: { 'access-control-allow-origin': 'https://unexpected.example', 'access-control-allow-methods': 'GET' } }) : response(url, options)))
  await expect(verifyBackend()).rejects.toThrow('CORS')
})

test.each([null, 'Content-Type', 'Authorization', '*'])('CORS 요청 헤더 허용 %j가 불충분하면 배포를 막는다', async (allowed) => {
  vi.stubGlobal('fetch', vi.fn((url, options) => {
    if (options?.method !== 'OPTIONS') return response(url, options)
    const headers = { 'access-control-allow-origin': 'https://bookstory-fe.vercel.app', 'access-control-allow-methods': 'PATCH' }
    if (allowed !== null) headers['access-control-allow-headers'] = allowed
    return new Response(null, { status: 200, headers })
  }))
  await expect(verifyBackend()).rejects.toThrow('CORS')
})

test('배포 후 응답 검사가 실패해도 배포 ID·URL과 실패 상태를 실행 기록에 남긴다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookstory-deployment-'))
  const resultPath = join(directory, 'result.json')
  const summaryPath = join(directory, 'summary.md')
  try {
    writeFileSync(resultPath, JSON.stringify(result))
    const stub = 'globalThis.fetch = async () => new Response(null, { status: 503 })'
    const child = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(stub)}`, 'scripts/verify-deployment.mjs', commit, resultPath], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath }, windowsHide: true })
    expect(child.error).toBeUndefined()
    expect(child.status).not.toBe(0)
    expect(existsSync(summaryPath)).toBe(true)
    const summary = readFileSync(summaryPath, 'utf8')
    expect(summary).toContain(result.deployment.id)
    expect(summary).toContain(result.deployment.url)
    expect(summary).toContain('FAILED')
  } finally {
    rmSync(resultPath, { force: true })
    rmSync(summaryPath, { force: true })
    rmdirSync(directory)
  }
})
