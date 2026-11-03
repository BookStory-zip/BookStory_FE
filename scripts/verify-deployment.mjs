import assert from 'node:assert/strict'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FE = 'https://bookstory-fe.vercel.app'
const API = 'https://bookstory-api-w31a.onrender.com'
const routes = ['/', '/search', '/catalog/9788936433598', '/books/abc', '/records', '/reset-password', '/reset-password/update']

async function request(url, options) {
  const response = await fetch(url, { signal: AbortSignal.timeout(65000), ...options })
  assert(response.ok, `${new URL(url).pathname}: HTTP ${response.status}`)
  return response
}

// CLI는 에이전트 등 비대화형 실행에서만 { status, deployment }로 감싸고 Actions에서는 배포 객체를 그대로 출력한다.
export function deploymentInfo(result) {
  const deployment = result?.status === undefined ? result : result.status === 'ok' ? result.deployment : undefined
  assert(deployment?.readyState === 'READY' && deployment.target === 'production' && !deployment.error, 'Expected a READY production deployment')
  assert(typeof deployment.id === 'string' && /^dpl_[a-z\d]+$/i.test(deployment.id), 'Invalid deployment ID')
  const url = new URL(deployment.url)
  assert(url.protocol === 'https:' && url.hostname.startsWith('bookstory-') && url.hostname.endsWith('.vercel.app') && !url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Invalid deployment URL')
  return { id: deployment.id, url: url.origin }
}

export async function verifyBackend() {
  const ready = await request(API + '/ready')
  assert((await ready.json())?.status === 'ready', 'Invalid backend ready response')
  const cors = await request(API + '/library/books', {
    method: 'OPTIONS',
    headers: { Origin: FE, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type' },
  })
  assert(cors.headers.get('access-control-allow-origin') === FE && cors.headers.get('access-control-allow-methods')?.split(/,\s*/).includes('PATCH'), 'Backend CORS does not allow production PATCH requests')
  const allowedHeaders = (cors.headers.get('access-control-allow-headers') ?? '').split(',').map((value) => value.trim().toLowerCase())
  assert(['authorization', 'content-type'].every((value) => allowedHeaders.includes(value)), 'Backend CORS does not allow authenticated JSON request headers')
}

export async function verifyProduction(commit) {
  assert(typeof commit === 'string' && /^[a-f\d]{40}$/i.test(commit), 'Expected a full Git commit SHA')
  const marker = await request(`${FE}/deployment.json?commit=${commit}`, { headers: { 'Cache-Control': 'no-cache' } })
  assert(marker.headers.get('content-type')?.includes('application/json'), 'Deployment commit marker must be JSON')
  assert((await marker.json())?.commit === commit, 'Production commit does not match the tested commit')
  await Promise.all(routes.map(async (path) => {
    const response = await request(FE + path)
    const headers = response.headers
    assert(headers.get('content-type')?.includes('text/html'), `${path}: invalid SPA content header`)
    assert(headers.get('x-frame-options') === 'DENY', `${path}: missing frame header`)
    assert(headers.get('x-content-type-options') === 'nosniff', `${path}: missing content-type header`)
    assert(headers.get('content-security-policy')?.includes("frame-ancestors 'none'"), `${path}: missing CSP header`)
    assert(headers.get('referrer-policy') === 'strict-origin-when-cross-origin', `${path}: missing referrer header`)
    assert(['camera=()', 'microphone=()', 'geolocation=()', 'payment=()'].every((value) => headers.get('permissions-policy')?.includes(value)), `${path}: missing permissions header`)
  }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--backend') {
    await verifyBackend()
    console.log('Production backend ready and PATCH CORS checks passed.')
  } else {
    const [commit, resultPath] = process.argv.slice(2)
    assert(typeof commit === 'string' && /^[a-f\d]{40}$/i.test(commit), 'Expected a full Git commit SHA')
    assert(resultPath, 'Deployment result JSON file is required')
    const deployment = deploymentInfo(JSON.parse(readFileSync(resultPath, 'utf8')))
    const summary = `### Production deployment\n\n- Commit: \`${commit}\`\n- Deployment: \`${deployment.id}\`\n- Deployment URL: ${deployment.url}\n- Production: ${FE}\n`
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
    console.log(summary)
    try {
      await verifyProduction(commit)
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\nVerification: PASSED (commit marker, 7 SPA routes and security headers)\n')
      console.log('Production deployment verification passed.')
    } catch (error) {
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\nVerification: FAILED. Inspect the deployment before using the manual recovery procedure.\n')
      throw error
    }
  }
}
