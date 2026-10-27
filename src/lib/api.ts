export class ApiError extends Error {
  status: number

  constructor(status: number) {
    super(`사용자 확인 요청에 실패했습니다. (${status})`)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function getMe(
  accessToken: string,
): Promise<{ user_id: string }> {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

  if (!apiBaseUrl) {
    throw new Error('API 주소 설정이 필요합니다.')
  }

  const response = await fetch(`${apiBaseUrl}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (response.status !== 200) {
    throw new ApiError(response.status)
  }

  const data: unknown = await response.json()

  if (
    typeof data !== 'object' ||
    data === null ||
    !('user_id' in data) ||
    typeof data.user_id !== 'string' ||
    data.user_id.trim().length === 0
  ) {
    throw new Error('사용자 확인 응답 형식이 올바르지 않습니다.')
  }

  return { user_id: data.user_id }
}
