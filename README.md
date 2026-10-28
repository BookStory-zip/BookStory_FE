# BookStory Frontend

모바일에서 개인 서재와 독서 기록을 관리하는 React 웹앱입니다. Vercel 배포와 비용 최소화를 목표로 합니다.

## 문서와 현재 상태

- [plan.md](./plan.md): 단계별 계획, 최소 화면, 외부 설정과 다음 작업의 완료 기준
- [CLAUDE.md](./CLAUDE.md): 에이전트의 단위별 구현·설명·검증 방식과 작업 규칙
- 이 README: 프로젝트 소개, 환경변수, API 계약과 배포 안내

React·TypeScript·Vite 기본 앱과 환경변수 양식, Supabase SDK 회원가입·이메일 인증 안내·로그인·세션 복원·로그아웃을 구성했습니다. 세션 이벤트를 구독하고 `/me` 성공 후 인증 상태를 표시합니다. 401이면 SDK 세션 갱신 후 최대 한 번 다시 요청하며, 503은 로그아웃으로 처리하지 않습니다. 비밀번호 재설정 메일 요청·링크 복귀·새 비밀번호 저장 코드도 추가했습니다. `/me` 7개·인증 함수 17개·재설정 폼 9개로 총 33개의 mock 테스트를 구성했고, 서재 10개, 검색·등록 14개, 상세 27개, 독서 기록 12개, 날짜 고치기 4개, self-review 반영 10개를 더해 총 110개입니다.

2026-10-27 사용자가 로컬 브라우저에서 로그인 → `/me` 성공, 새로고침 후 세션 복원, 현재 세션 로그아웃과 새로고침 후 미인증 표시를 확인했습니다. 두 탭의 로그인·로그아웃 동기화도 사용자 확인을 받았습니다. 이 결과는 사용자의 수동 확인이며 에이전트가 브라우저를 직접 조작한 검증은 아닙니다. 로그인 폼은 사용자 확인 성공 후 숨기고 세션 종료 시 다시 표시합니다. 로그아웃 요청 실패는 성공으로 표시하지 않으며, 실제 인증 표시는 SDK 세션 이벤트와 `/me` 결과를 따릅니다.

현재 상태는 **로그인·세션 관리와 회원가입·이메일 인증 안내 단위 완료**입니다. 가입 폼은 비밀번호 확인과 한국어 오류 안내를 제공하며, 세션 없는 가입 성공은 이메일 확인 대기로 표시합니다. 세션이 생겨도 `/me` 성공을 기다립니다. Gmail SMTP 인증 거절(535)을 서버 로그로 확인한 뒤 사용자가 설정을 수정했고, 실제 메일 수신·인증 링크 복귀 후 사용자 확인 완료를 보고했습니다. SMTP 비밀번호는 Supabase에만 설정하며 프론트에 저장하지 않습니다.

세션 변경 시 이전 인증 표시와 입력을 정리하고, 늦은 `/me` 응답과 이전 버튼 요청의 결과를 무시합니다. 계정 A/B 전환과 늦은 응답은 mock 검증이며 실제 서로 다른 두 계정의 브라우저 전환은 별도로 남아 있습니다. 비밀번호 재설정은 2026-10-27 사용자가 로컬 브라우저에서 메일 수신 → 링크 복귀 → 새 비밀번호 저장 → 재로그인·`/me` 성공을 확인하여 **인증 단위를 완료**했습니다. 디자인 기준(어두운 숲 테마)을 정해 인증 화면에 적용했습니다. React Router로 경로를 나누고, `/me` 확인 후 내 서재 목록(20개씩 더 보기)을 표시합니다. 계정 변경·로그아웃 시 목록과 늦은 응답을 버립니다. `/search`에서 책을 검색해 ISBN13으로 서재에 담고, `/books/{user_book_id}`에서 상태·날짜·별점·메모를 수정하거나 서재에서 뺍니다. 상세에서 오늘 체크·취소를 하고 `/records`에서 월별 독서 기록을 표지 달력으로 봅니다. 백엔드 전달 사항은 plan.md에 정리했습니다. TanStack Query, FE CI/CD와 Vercel 배포는 아직 구성하지 않았습니다.

### 백엔드 확인 기준

- 운영 API: https://bookstory-api-w31a.onrender.com
- [Swagger UI](https://bookstory-api-w31a.onrender.com/docs) · [OpenAPI](https://bookstory-api-w31a.onrender.com/openapi.json)
- 2026-10-26 문서 정리 시 공개 `/health`, `/ready`, `/openapi.json`의 HTTP 200과 배포된 API 경로를 확인했습니다. 인증 API·쓰기 API·실제 브라우저 연동은 이번에 검증하지 않았습니다.
- 로컬 BE 확인 커밋: `185e11bdcf643c240dfec809d785c5739ad494c1`. 2026-10-28 상세 단위에서 `../BookStory_BE/app/books.py`의 상태 전환 규칙을 다시 대조했습니다. 실제 배포 SHA와 같다고 단정하지 않습니다. 아래 계약은 로컬 코드와 전달받은 운영 인계 내용을 대조한 기준입니다.
- 사용자 인계 기준으로 운영 배포·주요 API 연동과 GitHub Actions 운영 배치 수동 실행을 확인한 상태입니다. 유지보수 워크플로의 예약은 `17 19 * * *` UTC, 한국 시간 다음 날 04:17입니다. 예약 실행 성공 여부는 별도 확인이 필요합니다.
- 기존 FE의 `974e5ae` 기준과 BE·Infra README의 일부 “배포 미완료” 문구는 최신 운영 인계와 불일치합니다. 과거 문구로 배포가 안 됐다고 판단하지 않습니다. 개별 배포 DB 마이그레이션 적용 여부는 담당자가 별도로 확인합니다.

구현 전에는 BE의 `app/main.py`, `app/schemas.py`, `app/auth.py`, `app/books.py`, `app/reading_logs.py`와 운영 OpenAPI를 다시 대조합니다. 현재 코드·실제 배포 상태·사용자 지시를 우선하고, 차이가 있으면 설명합니다.

## 범위와 기술 방향

MVP는 이메일 회원가입·인증 안내·로그인·로그아웃·세션 복원·비밀번호 재설정, 책 검색·등록, 내 서재 목록·상세·삭제, 독서 상태·날짜·별점·메모·중단 사유, 오늘 체크·취소와 기간별 독서 기록입니다.

공개 리뷰·공개 서재·피드·팔로우·추천·회독별 기록·페이지 수 기록·푸시·복잡한 통계·서재 꾸미기는 제외합니다. PWA·오프라인 기능도 선행 구현하지 않습니다. 달력용 데이터 연결을 먼저 완료하고 시각적 다듬기는 이후 진행합니다.

| 구분 | 방향 |
| --- | --- |
| 확정 | React 웹앱, Vercel 배포, 비용 최소화, 모바일 중심 |
| 현재 앱 구성 | TypeScript + Vite SPA |
| 현재 데이터 처리 | 기본 `fetch`와 `src/lib/api.ts` 공통 요청, Supabase JavaScript SDK, React Router 8.4.0 |
| 현재 스타일 | `src/index.css`의 전역 CSS와 `:root` 변수. 어두운 숲 테마, 고운바탕·IBM Plex Sans KR(Google Fonts). 인증 화면 배경 `public/forest.jpg`는 [Valeriia Neganova, Unsplash License](https://unsplash.com/photos/sunlight-streams-through-a-redwood-forest-canopy-NEGTKMK5wtM), 서재 배경 `public/library-forest.jpg`는 [Billy Huynh, Unsplash License](https://unsplash.com/photos/redwood-forest-with-sunlit-trees-4M1wucdlANA) |
| 현재 검사 | ESLint, Vitest, React Testing Library·jsdom, TypeScript 검사와 Vite 빌드 |
| 후속 도입 검토 | TanStack Query(상세·수정 단계), 핵심 흐름의 Playwright |

권장안은 설치 완료나 최종 확정을 뜻하지 않습니다. 라이브러리·버전·구조는 해당 단계에서 기존 구성과 필요성을 확인한 뒤 선택합니다. 공개 콘텐츠의 검색 노출·공유 미리보기가 필요해지면 SSR을 재검토합니다.

## 로컬 환경과 환경변수

기준 폴더는 FE `C:\PJ\BookStory_FE`, BE `C:\PJ\BookStory_BE`, Infra `C:\PJ\BookStory_Infra`입니다. 다른 컴퓨터에서는 실제 체크아웃 경로를 사용합니다.

현재 검증 환경은 Node.js `24.19.0`, npm `11.17.0`입니다. 다른 컴퓨터에서 처음 준비할 때 저장소 루트에서 실행합니다. Windows PowerShell 실행 정책 때문에 `npm` 대신 `npm.cmd`를 사용하며, 다른 셸에서는 `npm`을 사용할 수 있습니다.

```powershell
npm.cmd ci
if (-not (Test-Path -LiteralPath .env.local)) {
    Copy-Item .env.example .env.local
}
```

`.env.local`의 Supabase 두 값을 BE 인증과 같은 프로젝트의 값으로 채웁니다. `.env.example`의 Supabase 값은 비워둡니다. 다른 컴퓨터에는 `.env.local`이 전달되지 않으므로 해당 컴퓨터에서 별도로 설정해야 합니다.

```dotenv
VITE_API_BASE_URL=https://bookstory-api-w31a.onrender.com
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

`VITE_` 값은 브라우저에 공개됩니다. `DATABASE_URL`, PostgreSQL 비밀번호, `KAKAO_REST_API_KEY`, Supabase secret·`service_role` 키를 넣지 않습니다. 예제에는 실제 키 대신 빈 값 또는 명시적인 예시를 둡니다.

Supabase SDK는 인증에만 사용합니다. `books`·`users`·`user_books`·`reading_logs`는 FastAPI로 접근하며 직접 조회하지 않습니다. 사용자 인계 기준으로 꺼져 있는 Supabase Data API를 FE 연결을 위해 켜지 않습니다.

개발 서버와 검사 명령은 다음과 같습니다. 환경변수를 변경하면 개발 서버를 다시 시작합니다.

```powershell
npm.cmd run dev
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

`dev`는 개발 서버, `lint`는 코드 검사, `test`는 테스트 1회 실행, `build`는 TypeScript 검사 후 프로덕션 빌드입니다. 자동 테스트 110개는 `/me`·서재·검색·등록·상세·독서 기록 요청, 가입·인증 함수·세션 구독, 재설정 폼, 서재·검색·상세·기록 화면과 날짜 선택·한국 날짜 계산을 검사합니다. UI 검사는 jsdom이며 실제 브라우저·메일 수신 검증과 구분합니다. SDK와 `fetch`·API 주소를 대체하므로 운영 계정·DB를 호출하지 않습니다.

`.env.local`·`node_modules`·`dist`·로컬 임시 `bookstory-scaffold` 폴더는 Git에서 제외합니다. 임시 폴더는 앱 실행에 필요하지 않으며 미사용 템플릿을 로컬에 보존하는 용도로만 남깁니다.

## 인증 계약

1. Supabase SDK로 로그인 또는 세션을 복원합니다.
2. 현재 `session.access_token`으로 `GET /me`를 호출합니다.
3. BE의 JWT 검증과 사용자 행 생성·확인이 성공한 뒤 개인 서재 기능을 사용합니다.

BE에는 `/login`·`/signup`이 없습니다. BE 요청은 `Authorization: Bearer <access_token>`을 사용하며 Publishable key·refresh token을 대신 보내지 않습니다. 프론트의 JWT 해석만으로 인증 완료를 판단하지 않습니다. 쿠키 인증이 아니므로 `credentials: include`를 기본 추가하지 않습니다.

이메일 확인이 필요한 회원가입은 session 없이 성공할 수 있습니다. 이 경우 인증 메일 확인 안내를 표시합니다. 재설정은 Supabase의 메일 요청 → 리다이렉트 → 새 비밀번호 저장 흐름으로 연결합니다.

### 비밀번호 재설정 확인 방법

- 로그인 화면의 `비밀번호를 잊으셨나요?` 또는 `/reset-password`에서 메일을 요청합니다. 가입 여부를 단정하지 않는 공통 안내를 표시합니다.
- 메일 복귀 경로는 `/reset-password/update`입니다. Supabase Authentication의 URL Configuration → Redirect URLs에 실제 개발 origin을 포함한 주소를 추가합니다. 로컬 기본값은 `http://localhost:5173/reset-password/update`이며 포트가 다르면 실제 개발 서버 주소를 사용합니다. 기존 가입 복귀 주소는 유지합니다.
- SDK 링크 초기화 오류를 먼저 확인하고 서버 `getUser()`로 계정을 검증한 뒤 새 비밀번호 폼을 표시합니다. 만료·잘못된 링크와 일시적인 서버 실패를 구분합니다. 로그인된 계정의 비밀번호 변경도 가능한 경로이며, 재설정 메일의 별도 세션을 자체 저장하지 않습니다.
- 비밀번호·확인 값을 입력하고 저장 성공 후 `로그아웃 후 로그인하기`로 새 비밀번호 로그인을 확인합니다. 중복 제출을 막고 일반 저장 실패 시 입력을 보존합니다. 계정 변경·로그아웃 때 폼을 닫고 늦은 결과를 무시하며, 사용자 확인 중이면 저장 요청 시작도 차단합니다. 이미 전송한 변경 요청은 취소됐다고 보장하지 않습니다.
- `vercel.json`에 SPA 경로 rewrite를 준비했습니다. Vercel 배포 후 상세 경로 새로고침·메일 복귀는 별도 확인합니다. 운영·Preview 주소도 Supabase 허용 목록에 따로 등록해야 합니다.

2026-10-27 코드의 테스트·lint·타입 검사·빌드를 확인했고, 로컬(Site URL `http://localhost:5173`)에서 실제 재설정 메일 수신 → 링크 복귀 → 변경 → 새 비밀번호 로그인을 사용자가 확인했습니다. 운영·Preview 주소는 배포 단계에서 따로 확인합니다. [Supabase 메일 재설정](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [리다이렉트 설정](https://supabase.com/docs/guides/auth/redirect-urls), [Vercel Vite SPA 경로](https://vercel.com/docs/frameworks/frontend/vite)를 참고합니다.

세션 저장·복원·갱신은 SDK를 사용합니다. 401에서는 갱신 가능한 세션을 확인하고 재요청은 최대 한 번으로 제한합니다. JWKS 접근 실패 등의 503은 로그아웃 사유로 취급하지 않습니다. 로그아웃·계정 변경 시 개인 캐시와 진행 중인 요청을 정리하여 이전 계정의 늦은 응답을 차단합니다.

## API 계약

### ID와 응답 해석

| 값 | 의미·사용처 |
| --- | --- |
| `isbn13` | 책의 ISBN 문자열. 서재 등록 요청에 사용 |
| `book_id` | 여러 사용자가 공유하는 책 정보 UUID |
| 서재 응답의 `id` | 개인 서재 UUID인 `user_book_id`. 상세·수정·체크·삭제 URL에 사용 |
| 독서 체크 응답의 `id` | 체크 기록 자체의 UUID. 함께 오는 `user_book_id`와 구분 |

같은 책도 사용자마다 `user_book_id`가 다릅니다. 응답의 없는 날짜·별점을 현재 날짜·0으로 채우지 않습니다.

### 공개 API

| 메서드·경로 | 계약 |
| --- | --- |
| `GET /health` | 200 `{"status":"ok"}` |
| `GET /ready` | DB 정상 시 200 `{"status":"ready"}`, 접근 실패 시 503 |
| `GET /books/search?query=검색어` | 검색어 1~200자, 공백만 입력하면 422. 최대 10개, `{documents: [...], meta: {...}}` 응답 |

검색 페이지 번호·정렬·추가 결과 조회 인자는 없습니다. 검색은 제출 방식으로 시작합니다. 결과의 `title, authors, publisher, datetime, thumbnail, contents, url, isbn`은 공급자 데이터이므로 누락·null·빈 문자열을 방어합니다.

검색 `isbn`을 공백으로 분리하여 `^97[89][0-9]{10}$`인 ISBN13을 선택합니다. 없으면 등록 불가 이유를 안내하며 ISBN10을 그대로 보내거나 가짜 ISBN을 만들지 않습니다. 카카오 검색은 항상 FastAPI를 통합니다.

### 인증 API

아래 API는 모두 Bearer access token이 필요합니다.

| 메서드·경로 | 요청·응답과 제약 |
| --- | --- |
| `GET /me` | 200 `{"user_id":"UUID"}`. JWT 검증 및 BE 사용자 행 생성·확인 |
| `POST /library/books` | `{"isbn13":"9788936433598"}` → 200 `{"id":"user_book_id","book_id":"UUID","status":"want_to_read"}`. 예시는 신규 등록 기준 |
| `GET /library/books?limit=20&offset=0` | 배열 응답, limit 1~100·기본 20, offset 0 이상, 최신 등록순. 전체 건수·서버 상태 필터 없음 |
| `GET /library/books/{user_book_id}` | 아래 상세 필드 응답 |
| `PATCH /library/books/{user_book_id}/status` | 필수 `status`, 선택 `started_at, completed_at` → 200 `{"id":"UUID","status":"completed"}` 등 |
| `PATCH /library/books/{user_book_id}/record` | 선택 `rating, memo, stop_reason` → 200 `{"id":"UUID"}` |
| `DELETE /library/books/{user_book_id}` | 204, 본문 없음. 개인 서재와 연결된 독서 체크 삭제 |
| `PUT /library/books/{user_book_id}/reading-logs/today` | 본문 없음. reading 상태에서만 가능. 200 `id, user_book_id, read_date, created_at` |
| `DELETE /library/books/{user_book_id}/reading-logs/today` | 204, 본문 없음. 현재 상태와 무관하게 취소 가능. 오늘 기록이 없어도 성공 |
| `GET /reading-logs?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&limit=100&offset=0` | 날짜 필수·양 끝 포함, 시작일 ≤ 종료일, 최대 366일. limit 1~100·기본 100, offset 0 이상. 날짜 오름차순 배열 |

같은 사용자의 같은 책 재등록은 기존 서재 기록과 상태를 반환하며 메모를 초기화하지 않습니다. 항상 새 기록·201·409가 온다고 가정하지 않습니다. 서재 삭제는 다른 사용자 기록이나 공통 책을 즉시 삭제하지 않습니다.

**목록 필드:** `id, book_id, isbn13, title, authors, thumbnail_url, status, created_at`.

**상세 추가 필드:** `publisher, published_date, description, source_url, started_at, last_read_at, completed_at, stopped_at, stop_reason, rating, memo, has_completed, updated_at`. 메타데이터의 선택 필드·독서 날짜·개인 기록은 null일 수 있습니다. 목록에는 별점·메모·시작일 등 상세 필드가 없습니다.

**기간별 기록 필드:** `id, user_book_id, read_date, created_at, book_id, title, authors, thumbnail_url`.

일부 서재 페이지만으로 전체 상태별 개수·통계를 표시하지 않습니다. 필터가 필요하면 전체 조회와 최소 BE 확장 중 방식을 먼저 논의합니다. 한 달 독서 기록도 100건을 넘을 수 있으므로 필요한 모든 페이지를 조회해야 합니다.

개인 기록은 `rating` 정수 1~5 또는 null, `memo` 최대 10000자 또는 null, `stop_reason` 최대 1000자 또는 null입니다. PATCH에서 생략은 유지, 명시적 null은 삭제입니다. 미변경 필드를 null로 보내거나 미선택 별점을 0으로 보내지 않습니다. 빈 문자열과 null의 사용은 필드별로 결정합니다.

### 독서 상태와 보존

| 서버값 | 표시 | 핵심 규칙 |
| --- | --- | --- |
| `want_to_read` | 읽고 싶음 | 되돌릴 때 시작일·중단일·중단 사유 초기화 |
| `reading` | 읽는 중 | 시작일 생략 시 일반적으로 현재 시각. paused에서 재개하면 기존 시작일 유지 |
| `completed` | 완독 | reading·paused에서 전환 시 완료일 생략하면 현재 시각. 과거 완독은 날짜 없이도 등록 가능 |
| `paused` | 중단 | reading에서만 새로 중단 가능. 이미 paused이면 유지 |
| `abandoned` | 포기 | reading·paused에서 수동 포기 가능. 이미 abandoned이면 유지 |

`started_at`은 reading·completed 요청에만, `completed_at`은 completed 요청에만 사용합니다. 시작일은 완료일보다 뒤일 수 없습니다. 완독이어도 완료일이 null일 수 있으며, 허용되지 않는 전환·기존 날짜와 충돌하면 409가 올 수 있습니다.

읽고 싶음으로 되돌릴 때 완독 경험이 없으면 완료일·별점·메모도 초기화됩니다. 완독 경험이 있으면 기존 완료일·별점·메모를 보존합니다. 데이터 초기화·삭제 영향은 실행 전에 안내하고 서버 결과를 따릅니다. `has_completed`는 완독 경험 여부이며 회독 횟수가 아닙니다.

중단 7일 경과 포기 전환과 도서 메타데이터 갱신은 BE 배치 책임입니다. FE 타이머로 상태를 확정하지 않으며 화면 재진입 시 최신 서버 상태를 조회합니다.

### 날짜·독서 기록

- 오늘 체크는 서버 한국 시간 기준이며 본문으로 날짜를 받지 않습니다. 과거 날짜 체크·수정 API는 없습니다.
- 같은 책·같은 한국 날짜의 반복 체크는 중복을 만들지 않습니다. 같은 날 여러 책은 각각 체크할 수 있습니다.
- 실제 `/reading-logs`의 `read_date`로 달력을 구성합니다. reading 상태만으로 매일 읽었다고 표시하거나 “안 읽음” 기록을 만들지 않습니다.
- 오늘 체크 여부는 `user_book_id + read_date`로 판단합니다. `last_read_at`은 누적 체크의 최근 `created_at`이며 취소 후 이전 시각 또는 null로 바뀔 수 있습니다. 과거 달력 복원에 사용하지 않습니다.
- `read_date, published_date`는 날짜 문자열 `YYYY-MM-DD` 그대로 다루어 UTC 변환으로 하루가 밀리지 않게 합니다. `started_at, completed_at`은 시간대를 포함한 ISO 문자열로 보내고 날짜 입력의 한국 시간 기준을 명확히 합니다. 현재 FE는 날짜만 고르게 하고 시작은 `YYYY-MM-DDT00:00:00+09:00`, 완독은 `T23:59:59+09:00`(오늘이면 현재 시각)으로 보냅니다. 미리 채운 날짜를 바꾸지 않으면 필드를 생략해 기존 시각을 유지합니다.
- 시작·완독 날짜와 독서 체크는 별개입니다. “시작한 지 N일”을 표시한다면 시작일 기준 경과일이며 체크 일수·독서 시간이 아닙니다. 시작일이 없으면 계산하지 않습니다.

### HTTP·오류와 화면 갱신

204에는 `response.json()`을 호출하지 않습니다. 오류 `detail`은 문자열과 FastAPI 검증 배열을 모두 처리합니다.

| 상태 | 의미 |
| --- | --- |
| 401 | 인증 필요·유효하지 않은 토큰 |
| 404 | 도서·개인 서재 없음. 타인 항목도 같은 404이므로 구분 추정·추가 조회 금지 |
| 409 | 상태 전환 또는 날짜 충돌 |
| 422 | 요청 형식·입력값 검증 실패 |
| 502 | 카카오 통신·공급자 응답 오류 |
| 503 | DB·JWKS·서비스 설정 등의 문제. 인증 만료로 단정하지 않음 |
| 504 | 카카오 검색 시간 초과 |

한국어 안내, 로딩·빈 결과·오류·재시도를 구분합니다. 오류를 빈 서재·기록 없음으로 바꾸지 않습니다. 저장 실패·세션 만료 시 메모와 날짜 입력을 보존하고, 저장 중 중복 클릭과 성공 전 완료 표시를 막습니다.

초기에는 쓰기 성공 응답 후 관련 목록·상세·독서 기록을 다시 조회합니다. 작은 변경 응답으로 상세 전체를 덮어쓰지 않습니다. 네트워크 실패·시간 초과로 쓰기 결과가 불명확하면 무조건 재전송하지 않고 서버 상태를 확인합니다. 이전 검색·계정의 늦은 응답이 최신 화면을 덮어쓰지 않게 합니다.

## 외부 설정·배포·비용

- 사용자 인계의 Render Free API는 미사용 후 첫 응답이 늦을 수 있습니다. 기동 대기와 실패를 구분하고 짧은 대기로 로그아웃·쓰기 반복을 유발하지 않습니다. [Render 무료 인스턴스](https://render.com/docs/free)
- 로컬 origin과 Vercel origin을 Render `CORS_ORIGINS`에 정확히 등록합니다. 포트가 다르면 별도 origin이며 경로·마지막 슬래시·와일드카드를 붙이지 않습니다. Preview 주소도 자동 허용되지 않습니다. 설정 후 BE 재시작·재배포 및 실제 브라우저 검증이 필요합니다.
- BE와 같은 Supabase 프로젝트의 Publishable key, Site URL·Redirect URLs·메일 발송을 확인합니다. 공개 가입 전 SMTP 수신자·발송 제한을 해결합니다. [인증](https://supabase.com/docs/guides/auth/passwords) · [키](https://supabase.com/docs/guides/getting-started/api-keys) · [SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- Vercel 환경변수 등록 후 재빌드·배포하고 SPA 상세 주소 새로고침과 인증 리다이렉트를 확인합니다. Vite 환경변수는 빌드에 반영되므로 환경별 빌드는 각각 검증합니다.
- 현재 FE는 조직 비공개 저장소입니다. [Hobby의 조직 비공개 Git 연동 제한](https://vercel.com/docs/git#using-hobby-teams)과 [개인·비상업적 사용 조건](https://vercel.com/docs/plans/hobby)을 고려하여 소유·공개 범위 또는 플랜을 배포 전에 결정합니다. 저장소 공개·이전·유료 전환은 별도 승인 없이 실행하지 않습니다.
- 정적 FE와 기본 `vercel.app` 주소, 필요한 API 캐시를 우선합니다. 프론트 전용 서버·DB·이미지 저장소·유료 UI·분석 서비스·Docker 빌드는 선행 추가하지 않습니다. [Supabase Free의 일시 중지·용량 조건](https://supabase.com/pricing)과 BE·메일 비용까지 확인하며 전체 운영비 0원을 보장하지 않습니다.

## CI/CD 방향

`.github/workflows/ci.yml`(Frontend CI)이 develop·main push와 두 브랜치 대상 PR에서 `npm ci` → `npm run lint` → `npm test` → `npm run build`(타입 검사 포함)를 실행합니다. 액션은 커밋 SHA로 고정하고 읽기 권한만 사용합니다. 테스트는 fetch·Supabase SDK를 대체하므로 운영 API·DB·비밀값 없이 실행되며, 실제 BE 통합 검증과 구분합니다. 별도 포맷 검사 도구는 아직 도입하지 않았습니다.

초기 운영 배포는 CI를 통과한 main 버전을 수동 선택합니다. Vercel 기본 Git 배포가 별도 GitHub CI를 기다린다고 가정하지 않으며 중복 배포를 막습니다. FE 설정은 FE 레포, BE 실행·공통 인프라는 Infra 레포에서 관리합니다. FE·BE 커밋 SHA와 배포 ID 또는 BE 이미지 digest를 기록하고 운영 버전 조합을 검증합니다.

API 변경은 새 필드 추가 → BE 배포 → FE 전환 → 기존 필드 제거 순서로 호환성을 유지합니다. 브랜치·커밋·PR 규칙은 [CLAUDE.md](./CLAUDE.md)를 따릅니다.

## 관련 저장소

- [프론트엔드](https://github.com/BookStory-zip/BookStory_FE)
- [백엔드](https://github.com/BookStory-zip/BookStory_BE)
- [인프라](https://github.com/BookStory-zip/BookStory_Infra)
- [기존 Notion 기본 계획](https://app.notion.com/p/3e51a6e97edf81118a86deee56738f3d): 과거 초안과 충돌하면 최신 사용자 지시와 현재 작업 규칙을 우선합니다.
