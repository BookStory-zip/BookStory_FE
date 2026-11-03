# BookStory Frontend

모바일 중심의 개인 서재·독서 기록 웹앱입니다.
React·TypeScript·Vite SPA이며, 인증은 Supabase, 개인 데이터는 BookStory FastAPI를 사용합니다.

- 운영: https://bookstory-fe.vercel.app
- [docs/backend-api.md](./docs/backend-api.md): 사용하는 BE API 계약, FE 반영 사항, BE 전달 사항
- [docs/maintenance.md](./docs/maintenance.md): 배포 절차, 운영 설정, 실패 처리
- [plan.md](./plan.md): 배포 기록, 미확인 항목, 남은 작업
- [CLAUDE.md](./CLAUDE.md): 작업 규칙

## 구현된 기능

| 경로 | 기능 |
| --- | --- |
| `/` (미인증) | 회원가입·이메일 인증 안내·로그인 |
| `/reset-password`, `/reset-password/update` | 재설정 메일 요청, 새 비밀번호 저장 |
| `/` (인증) | 서재(숲속 오두막 책장), 20개씩 더 보기, 순서 편집(드래그·앞/뒤 버튼) |
| `/search` | 책 검색, ISBN13이 있는 책만 담기 |
| `/catalog/{isbn13}` | 공통 책 정보·소개, 내 기록 확인, 공개 후기·평점·더 보기 |
| `/books/{user_book_id}` | 상태·날짜·별점·메모·중단 사유, 메모·별점 공개 선택, 오늘 체크, 서재에서 빼기 |
| `/records` | 달력·통계 전환. 월별 표지 달력, 연간·월간 읽은 날짜 수와 현재 서재 현황 |

책별 공개 후기는 사용자가 직접 공개를 선택한 메모·별점만 표시합니다. 기존 메모는 비공개이며, 수정하면 후기에도 반영되고 메모를 비우면 비공개가 됩니다.

서재 순서 편집은 불러온 책 사이에서 이동할 때마다 저장하고 불러온 범위(최대 100개)를 처음부터 다시 확인합니다. 100개 밖의 책은 더 보기로 이어 받습니다. 운영 반영 커밋·배포 ID와 확인 범위는 [plan.md](./plan.md)의 배포 기록을 따릅니다.

제외: 공개 서재·피드·팔로우·추천·회독별 기록·페이지 수·푸시·복잡한 통계·서재 꾸미기·PWA·오프라인.

## 로컬 실행

Node.js 24, npm 11이 필요합니다. Windows PowerShell에서는 `npm` 대신 `npm.cmd`를 씁니다.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

`.env.local`의 Supabase 두 값은 BE 인증과 같은 프로젝트 값으로 채웁니다.

```dotenv
VITE_API_BASE_URL=https://bookstory-api-w31a.onrender.com
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

`VITE_` 값은 브라우저에 공개됩니다. Supabase secret·`service_role` 키, `DATABASE_URL`, 카카오 키는 넣지 않습니다.
값이 빠지면 앱이 변수 이름을 안내합니다.

## 검사

| 명령 | 내용 |
| --- | --- |
| `npm run lint` | ESLint |
| `npm test` | Vitest 테스트 182개(jsdom, Supabase SDK·fetch 대체) |
| `npm run build` | 타입 검사 후 프로덕션 빌드 |
| `npm run test:e2e` | Playwright 모바일 Chromium 핵심 흐름 8개(가짜 API). 처음 한 번 `npx playwright install chromium` |

테스트는 운영 API·DB를 호출하지 않습니다.
CI(`.github/workflows/ci.yml`)가 develop·main push와 두 브랜치 대상 PR에서 위 네 가지를 실행합니다.

## 배포 기준

- 브랜치: develop에서 분기한 작업 브랜치에서 개발합니다. 로컬 커밋을 쌓고 브랜치 작업·검증이 모두 끝나면 push·develop 대상 PR을 진행합니다. PR 병합·main 반영·배포는 별도 요청으로 진행하며, 배포는 CI를 통과한 main을 사용합니다.
- 방식: 조직 비공개 저장소라 Git 연동 대신 Vercel CLI로 수동 배포합니다. 절차는 [docs/maintenance.md](./docs/maintenance.md)를 따릅니다.
- 기록: 배포마다 FE·BE 커밋과 배포 ID를 plan.md에 남깁니다.
- API 변경: 새 필드 추가 → BE 배포 → FE 전환 → 기존 필드 제거 순서로 호환성을 유지합니다.

## 참고

- 저장소: [FE](https://github.com/BookStory-zip/BookStory_FE) · [BE](https://github.com/BookStory-zip/BookStory_BE) · [Infra](https://github.com/BookStory-zip/BookStory_Infra)
- 사진(Unsplash License): 로그인 배경 [Valeriia Neganova](https://unsplash.com/photos/sunlight-streams-through-a-redwood-forest-canopy-NEGTKMK5wtM), 서재 배경 [Billy Huynh](https://unsplash.com/photos/redwood-forest-with-sunlit-trees-4M1wucdlANA)
- 글꼴: 고운바탕·IBM Plex Sans KR(Google Fonts)
