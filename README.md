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
| `/` (인증) | 서재(숲속 오두막 책장), 제목/저자 검색·읽기 상태·서브 책장 필터와 책장 관리, 직접 정한 순서·서재 등록 최신순·읽기 시작 최신순, 무한 스크롤, 여러 권 책장 담기·빼기, 필터 없는 직접 정한 순서의 편집(드래그·방향키·앞/뒤 버튼) |
| `/search` | 전체·제목·저자·출판사 검색, 정확도순·출간일 최신순, ISBN13이 있는 결과만 표시·담기 |
| `/timer` | 읽는 중인 책 선택·타이머 측정, 모든 상태의 책별 시간 기록 조회·삭제 |
| `/catalog/{isbn13}` | 공통 책 정보·소개, 내 기록 확인, 공개 후기·평점·더 보기 |
| `/books/{user_book_id}` | 독서 상태·읽기 진도·과거 읽은 날·독서 노트·별점/후기를 접기·펼치기. 읽는 중에만 오늘 체크, 상태 영역에서 서재에서 빼기. 과거 읽은 날은 서버 `past_log_range` 안 달력에서 하루씩 입력 |
| `/settings` | 공개 후기 닉네임, 계정 전체 후기·별점 공개, 계정 전체 독서 알림·현재 기기의 권한/연결 상태, 비밀번호 재확인 후 계정 탈퇴 |
| `/records` | 달력·통계·노트 전환. 월별 노트·표지 달력·최근 7일 체크/취소, 월간·연간 실적/목표/달성률 통합 표시, 서재 현황 접기, 알림 설정 링크와 알림에서 그날 체크 편집기 바로 열기 |

계정에서 공개를 켜면 기존·신규 후기와 별점이 모두 공개되고, 끄면 개인 기록은 보존한 채 모두 비공개로 바뀝니다. 별점만 남긴 책도 공개·평점 집계에 포함합니다. API의 `memo` 필드명은 유지하고 화면에서는 후기로 표시합니다. 이 계정 단위 계약은 BE 운영 반영 후 FE를 배포해야 하며 현재 확인 범위는 plan.md를 따릅니다.

독서 타이머는 독립 타이머 탭에서 읽는 중인 책을 선택해 사용하며, 일시정지 시간을 빼고 1분부터 저장합니다. 한 구간은 최대 1시간이고 계속 읽기를 확인해야 다음 구간을 시작합니다. 같은 계정의 측정은 화면을 나갔다 와도 복원되며 로그아웃하면 지웁니다. 저장하면 시작한 한국 날짜의 독서 체크가 되고, 시간 기록을 지워도 체크는 남습니다. 타이머 탭의 시간 기록 모드에서 완독·중단된 책의 기록도 조회·삭제할 수 있습니다. 통계에서 기간 독서 시간(분)을 확인할 수 있습니다. 운영 반영 상태는 plan.md를 따릅니다.

읽기 진도는 상세에서 현재 쪽(또는 %)을 기록합니다. 제공된 전체 쪽수가 있으면 기본 읽기 전용이며 판본이 다를 때 직접 수정할 수 있고, 없으면 직접 입력합니다. 직접 입력한 전체 쪽수가 우선이고 없으면 BE의 국립중앙도서관 쪽수를 씁니다. 전체 쪽수를 모르면 진도는 표시하지 않습니다. 완독은 전체 쪽수를 알 때 100%와 쪽수를 함께 보여 줍니다. 현재 쪽은 읽는 중·중단·포기에서만 기록하며 서재 카드에도 진도 %를 표시합니다.

독서 노트는 책마다 날짜별 인상 깊은 문구·생각·페이지와 사진 한 장을 남기는 나만 보는 기록입니다. 사진 선택 후 자르기·회전·펜·형광펜 편집을 확정해 저장하고, 기존 사진도 같은 방식으로 교체할 수 있습니다. 편집 중에는 되돌릴 수 있고 저장한 필기는 사진의 일부가 됩니다. 촬영·앨범 선택은 휴대폰의 사진 선택 메뉴를 사용합니다. 공개 후기와 별개이고 독서 체크를 만들지 않습니다. 기록 화면의 노트 탭에서 달별로 모아 봅니다. 운영 반영 상태는 plan.md를 따릅니다.

독서 목표는 통계 탭에서 월·연별로 세 지표를 한 팝업에서 정하고 한 번에 저장합니다. 월 목표는 다음 달로 이어지고, 연 목표를 직접 정하지 않으면 월 목표 합계를 씁니다. 0 입력은 목표 끄기, 빈칸은 이전 목표·합계로 되돌리기이며, 이어받기·합계 계산은 서버가 합니다. 계약은 [docs/backend-api.md](./docs/backend-api.md#독서-목표-2026-11-04-be-pr-26-운영-반영), 상태는 plan.md를 따릅니다.

기록 달력에서는 서버 KST 오늘을 포함한 최근 7일을 체크·취소합니다. 읽는 중인 책만 추가하고 기존 체크는 상태와 무관하게 취소할 수 있습니다. 상세의 오늘 카드는 읽는 중에만 표시하되, 다른 상태에도 오늘 체크가 있으면 취소 버튼을 제공합니다. 가져온 완독 책은 상세의 과거 읽은 날 달력에서 서버가 허용한 범위까지 입력합니다. 최근 체크는 버튼을 누른 시각이 아닌 실제 읽은 날짜입니다. 운영 반영·검증 범위는 [plan.md](./plan.md)를 따릅니다.

서재는 처음 20권을 받은 뒤 화면이 덜 찼거나 목록 끝에 가까워지면 다음 책을 자동으로 불러옵니다. 순서 편집은 불러온 책 사이에서 이동할 때마다 저장하고, 100권을 넘더라도 받은 범위 전체를 다시 조회합니다. 책 선택 모드에서 담을 책장을 고르면 이미 담긴 책은 체크된 상태로 표시하며 새로 선택한 책만 추가합니다. 대상 책장을 바꿔도 선택을 유지하고 이미 담긴 책은 추가 요청에서 제외합니다. 빼기 모드에서는 보던 책장의 책을 소속 표시와 무관하게 선택해 제거합니다. 운영 반영과 확인 범위는 [plan.md](./plan.md)를 따릅니다.

독서 알림은 Web Push로 매일 21시 KST에 오늘 체크하지 않은 읽는 중인 책이 있으면 보냅니다. 계정 화면에서 모든 기기의 알림을 함께 켜고 끄며, 현재 기기의 권한은 별도 버튼으로 요청합니다. 계정 알림이 켜져 있고 권한이 있는 기기는 로그인·앱 복귀 시 자동 연결합니다. 로그아웃은 현재 기기만 해제합니다. iPhone은 iOS 16.4 이상에서 홈 화면에 추가한 뒤 받을 수 있습니다. 계약과 계정 보호 규칙은 [docs/backend-api.md](./docs/backend-api.md)의 "독서 알림"을 따릅니다.

제외: 공개 서재·피드·팔로우·추천·회독별 기록·날짜별 진도 이력과 쪽수 통계·독서 알림 외 푸시·복잡한 통계·서재 꾸미기·홈 화면 추가 외 PWA 기능·오프라인.

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
| `npm test` | Vitest 화면·API·읽기 전용 배포 확인 스크립트 테스트 |
| `npm run build` | 타입 검사 후 프로덕션 빌드 |
| `npm run test:e2e` | Playwright 모바일 Chromium 핵심 흐름 28개(가짜 API). 처음 한 번 `npx playwright install chromium` |

테스트는 운영 API·DB를 호출하지 않습니다.
CI(`.github/workflows/ci.yml`)가 develop·main push와 두 브랜치 대상 PR에서 위 네 가지를 실행합니다.

## 배포 기준

- 브랜치: develop에서 분기한 작업 브랜치에서 개발합니다. 로컬 커밋을 쌓고 브랜치 작업·검증이 모두 끝나면 push·develop 대상 PR을 진행합니다. PR 병합·main 반영·배포는 별도 요청으로 진행하며, 배포는 CI를 통과한 main을 사용합니다.
- 방식: 2026-11-03부터 main push CI의 check·e2e 성공 후 GitHub Actions가 Vercel CLI로 운영 배포합니다. main 병합이 곧 운영 배포 승인입니다. 수동 배포는 복구용으로 남깁니다. 절차는 [docs/maintenance.md](./docs/maintenance.md)를 따릅니다.
- 기록: 운영 반영 시 FE·BE 커밋과 배포 ID를 plan.md에 모아 기록합니다. 자동 배포 전환 후 개별 실행의 커밋·배포 ID/URL·검증 결과는 Actions Summary에 남기며 자동 Git 커밋은 만들지 않습니다.
- API 변경: 새 필드 추가 → BE 배포 → FE 전환 → 기존 필드 제거 순서로 호환성을 유지합니다.

## 참고

- 저장소: [FE](https://github.com/BookStory-zip/BookStory_FE) · [BE](https://github.com/BookStory-zip/BookStory_BE) · [Infra](https://github.com/BookStory-zip/BookStory_Infra)
- 사진(Unsplash License): 로그인 배경 [Valeriia Neganova](https://unsplash.com/photos/sunlight-streams-through-a-redwood-forest-canopy-NEGTKMK5wtM), 서재 배경 [Billy Huynh](https://unsplash.com/photos/redwood-forest-with-sunlit-trees-4M1wucdlANA)
- 글꼴: 고운바탕·IBM Plex Sans KR(Google Fonts)
