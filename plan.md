# BookStory 프론트엔드 작업 계획

## 목표와 진행 기준

React·Vercel·비용 최소화·모바일 중심의 개인 독서 기록 MVP를 기존 FastAPI에 연결한다. 2026-10-28 MVP 기능(인증·서재·검색·등록·상세·오늘 체크·월별 기록)을 main에 반영하고 Vercel에 수동 배포했다. 완료된 단위별 기록은 git 이력(`e3999b0` 이전 plan.md)에서 확인한다.

[README.md](./README.md), [docs/backend-api.md](./docs/backend-api.md) API 계약, [CLAUDE.md](./CLAUDE.md)의 작업 규칙을 먼저 읽는다. 이 파일은 사용자의 명시적 요청으로 만든 계획이며, 2026-10-28 사용자 요청으로 완료된 계획을 정리하고 남은 일만 둔다.

- 작업 분담: BE에서 쉽게 되는 일은 BE에서 하고 FE는 꼭 필요한 것만 구현한다. BE 몫은 아래 백엔드 전달 사항에 기록하고 FE에서 대체 구현하지 않는다(2026-10-28 사용자 지시).
- 제외: 피드·팔로우·추천·공개 서재·회독·페이지 수·푸시·복잡한 통계·서재 꾸미기·PWA·오프라인. 사용자 승인한 책별 공개 후기는 아래 범위로 구현한다. BE 배치를 FE에 옮기지 않는다.

## 다음에 이어서 시작할 순서

1. FE의 현재 브랜치·미커밋·원격 변경과 README·이 파일·CLAUDE.md를 확인한다. 새 작업은 최신 develop에서 분기한 작업 브랜치에서 진행하며, 로컬 커밋과 완료 후 push·PR 기준은 CLAUDE.md를 따른다.
2. BE(`../BookStory_BE`) 코드·운영 OpenAPI와 docs/backend-api.md 계약의 변경 여부를 대조한다. 백엔드 전달 사항이 반영됐으면 FE 후속 작업을 진행한다.
3. 새 컴퓨터에서는 `npm ci`와 `.env.local`(README)을 먼저 준비한다.

## 지난 날짜 독서 체크 (2026-11-03)

- 작업 브랜치 `feat/past-reading-check`, 기준 develop `bdd398c`. 자동 배포 PR #7과 별개이며 병합은 사용자가 진행한다.
- 범위: 달력에서 오늘 포함 최근 7일의 체크·취소, 개인 상세의 `last_read_date`, API·오류 안내·검증·문서. 앱 안 안내·푸시·PWA는 이번에 구현하지 않는다.
- 현재 읽는 중인 책만 새 체크 가능, 기존 체크 취소는 상태와 무관하다. 완독·중단 후 지난 날짜 추가는 허용하지 않는 기존 계약을 따른다. 시작일 검사는 서버가 판단한다.
- [x] 날짜 경로 PUT·DELETE와 응답 검증, `date_too_old`·독서 체크 전용 `date_order` 안내(기존 오늘 체크 포함)
- [x] 달력 날짜 선택 → 체크·취소, 전체 서재 페이지 조회, 결과 불명확 시 재전송 없이 재조회, 실패·늦은 응답·KST 날짜 변경 처리
- [x] 최근 체크를 `last_read_date`로 표시하고 관련 fixture·응답 검증 갱신
- [x] 단위 테스트 204개·lint·타입 검사/빌드·가짜 API 기반 Playwright 9개 통과. 설치된 Chrome 임시 설정으로 실행하고 390·768·1440px 화면과 키보드 조작을 확인했다. 임시 설정은 제거하고 CI의 Chromium 설치 설정은 유지했다. API 문서·README·CLAUDE.md 갱신, 전체 변경 독립 리뷰와 self-review 완료.
- [x] BE `feat/past-reading-check` `26903f5`의 로컬 검증 API·Supabase A/B 실제 연동. 오늘·6일 전 체크/취소, 7일 전·미래 거부, 시작일 이전 거부, 기존 체크 멱등성, 완독 후 취소, 실패 전후 보존, 최신 체크 취소 후 이전 날짜/null 복귀를 확인했다. 실제 브라우저 체크·새로고침·최근 체크·A→B→A 분리와 취소도 통과했다. 검증용 새 항목만 생성·삭제했으며 기존 A 21권·B 2권의 서재 순서·전체 개인 상세가 전후 동일함을 확인했다.
- 독립 리뷰에서 자정에 `today`가 바뀌면 진행 중 저장의 재조회가 빠지는 문제 1건을 발견해 편집 인스턴스를 유지하도록 수정했다. 저장 도중 KST 자정을 넘긴 뒤 잠금·달력/체크 재조회 회귀 테스트로 확인했다. 실제 자정 수동 검증은 하지 않았으며 고정 시각 테스트와 구분한다.
- PR #8 작성 후 자동 배포 PR #7이 develop `c9c1a71`에 병합되어 기능 브랜치에 동기화했다. README 검사 설명 충돌은 화면·API·배포 스크립트 검사를 모두 포함하도록 해결했다. 결합한 단위 테스트 226개·lint·타입 검사/빌드·actionlint를 통과했다. 기능 코드 충돌은 없으며 배포 활성화·운영 반영과는 구분한다.
- 운영 반영 순서: FE 검증 → BE 병합·운영 배포 → FE 운영 배포. DB migration 없음. 이번 요청에 병합·배포는 포함하지 않는다.

## 운영 배포 기록

| 날짜 | FE | 배포 | BE |
| --- | --- | --- | --- |
| 2026-10-28 | main `e3999b0` (PR #1, CI run 40610539527 통과) | https://bookstory-fe.vercel.app · `dpl_76PbqgQdBjZqLd9448dpAP7bdMV5` · Vercel CLI `64.0.2` 수동 배포 | Render 운영 배포 커밋 확인 필요(로컬 대조 기준 `185e11b`). `CORS_ORIGINS`에 운영 주소 추가 후 재배포 |
| 2026-11-02 | main `cdcbff7` ([PR #2](https://github.com/BookStory-zip/BookStory_FE/pull/2), [main CI 41381439179](https://github.com/BookStory-zip/BookStory_FE/actions/runs/41381439179) 통과) | https://bookstory-fe.vercel.app · `dpl_En5qb68qkXZhcDrSjm1sPwBzwwmx` · [배포 URL](https://bookstory-cabqsyvt6-honey-0a33.vercel.app) · Vercel CLI `64.0.2` 수동 배포 | 기준 `290da3e`, migration `c4d8e2a76f10`(사용자 2026-11-02 확인). 이번 배포 확인은 운영 health·CORS 조회이며 BE 배포 SHA를 새로 검증한 것은 아님 |
| 2026-11-02 14:33 KST | main `aab40d0` ([PR #3](https://github.com/BookStory-zip/BookStory_FE/pull/3), [main CI 41394235068](https://github.com/BookStory-zip/BookStory_FE/actions/runs/41394235068) 통과) | https://bookstory-fe.vercel.app · `dpl_4nbsYowenZBjF61WCTbbz5HKgAdm` · [배포 URL](https://bookstory-p77qwywj9-honey-0a33.vercel.app) · Vercel CLI `64.0.2` 수동 배포 | main `1ffaa8a`(PR #9) Render Live와 실제 미래 시작일 422·기존 기록 보존 확인(사용자, 2026-11-02). 이번 BE 변경의 스키마·마이그레이션 변경 없음 |
| 2026-11-03 KST | main `a82c21a` ([PR #5](https://github.com/BookStory-zip/BookStory_FE/pull/5), [main CI 41417329233](https://github.com/BookStory-zip/BookStory_FE/actions/runs/41417329233) 통과) | https://bookstory-fe.vercel.app · `dpl_AtHZiqTumHoAmz3xZJQAJ3fpBNZe` · [배포 URL](https://bookstory-a8tlcrua6-honey-0a33.vercel.app) · Vercel CLI `64.0.2` 수동 배포·READY | main `2c2b6e7`(PR #12), migration `57f75310c7d5` 적용·Render Live 완료(BE 유지보수 기록·사용자 안내). FE에서 운영 순서 API·health/ready 200·PATCH CORS 확인 |
| 2026-11-03 12:21 KST | main `85c36a0` ([PR #9](https://github.com/BookStory-zip/BookStory_FE/pull/9), [main CI 41571461514](https://github.com/BookStory-zip/BookStory_FE/actions/runs/41571461514)) | https://bookstory-fe.vercel.app · `dpl_6JzDV4srrZpRqRYBGA6nYKNSDEbc` · [배포 URL](https://bookstory-8s7yfgfav-honey-0a33.vercel.app) · 첫 Actions 자동 배포·READY. 사후 검증 단계만 실패(아래 무료 자동 배포 참고) | 운영 OpenAPI에서 날짜 경로 PUT/DELETE·`last_read_date` 확인(에이전트). BE 배포 SHA는 새로 검증하지 않음 |

배포 후 확인: 모든 SPA 경로 200, 공개 환경변수 3개 번들 반영, 운영·로컬 origin CORS 허용(에이전트). 운영 주소에서 로그인부터 기록까지 통합 동작(사용자, 2026-10-28). 배포 방법은 [docs/maintenance.md](./docs/maintenance.md)를 따른다.

2026-11-02 배포 확인: Vercel production Ready·운영 별칭 연결, `/`·`/search`·`/catalog/9788936433598`·`/books/abc`·`/records`·비밀번호 재설정 두 경로의 동일 SPA 응답 200, 보안 헤더 5개, 운영 origin의 Authorization CORS 사전 요청·BE health 200 확인. 운영 JS·CSS 11개가 검증한 로컬 빌드와 일치함. 브라우저 제어는 현재 URL 확인 실패로 중단되어 실제 로그인·공개/수정/비공개·계정 전환은 이번에 검증하지 않음.

이후 안내한 운영 화면 수동 점검에 대해 사용자가 “다 작동하는듯”으로 정상 동작을 알림(2026-11-02). 에이전트 직접 검증과 구분하며, 두 계정 전환 등 개별 확인 범위가 명시되지 않은 항목은 완료 처리하지 않음.

2026-11-02 14:33 배포 확인: Vercel production Ready·운영 별칭, 위 SPA 7개 경로·보안 헤더 5개·운영 CORS·BE `/health`·`/ready` 200, 운영 JS·CSS 11개의 로컬 검증 빌드 일치와 `future_date` 한국어 문구 포함 확인(에이전트). 실제 날짜 저장은 에이전트 인증 연결이 없어 직접 검증하지 않았으며, 이후 사용자가 오늘·어제 시작/완독 저장과 새로고침 후 유지 확인 완료를 알림(2026-11-02). 미래 완독일 거부·자정 경계는 미검증.

## 미확인·보류

- [x] BE Render 배포 `290da3e`와 마이그레이션 `c4d8e2a76f10` 확인(사용자, 2026-11-02). 위 표의 10월 28일 FE 배포 기록과는 별개
- [x] 날짜만 고치기: 완독 상태에서 시작·완독일을 어제로 수정하고 새로고침 후 유지 확인(사용자, 2026-11-02). 별도 검증 환경에서도 회귀 확인 예정
- [ ] 서로 다른 두 계정의 실제 브라우저 전환: 검증 환경 서재의 A→로그아웃→B→로그아웃→A는 확인(2026-11-02). 상세·공통 상세·달력/통계·검색의 전체 전환 검증은 남음
- [ ] 운영 SMTP 발송 제한 확인. 공개 가입 전에 해결
- [ ] 테스트 환경과 검증용 계정·데이터 구분. 지금까지 실제 확인은 운영 DB의 개인 계정으로 진행했다. 운영 DB에 테스트 스위트·자동 정리를 실행하지 않는다
- [x] 미래 날짜·시각 제한 BE main `1ffaa8a` 운영 반영(사용자 2026-11-02 확인), FE `future_date` 안내 main `aab40d0` 운영 반영. 실제 날짜 저장·자정 경계의 남은 검증은 아래 항목 참고
- [ ] BE 예약 배치 실행 결과는 운영 담당 확인 사항(FE 대체 구현 대상 아님)

## 백엔드 전달 사항

BE 전달 사항, 2026-10-28 BE 계약 수신 상태, 재독 규칙, BE 배포 후 FE 작업 목록은 [docs/backend-api.md](./docs/backend-api.md)로 옮겼다. BE 운영 배포를 OpenAPI로 확인하면 그 목록대로 진행한다.

## 진행 중: BE 작업 대기 중 FE 정비 (2026-10-28 사용자 요청)

- [x] A. 파비콘을 오두막 아이콘으로 교체, `vercel.json` 보안 헤더(프레임 차단·nosniff·Referrer-Policy·Permissions-Policy), 공개 설정 누락 시 흰 화면 대신 변수 이름 안내, 검색·상세·기록·재설정 화면 코드 분할(빌드 크기 경고 해소). 보안 헤더는 다음 배포 후 응답 헤더로 확인
- [x] B. 접근성·UI 점검(Web Interface Guidelines)과 수정: 본문 바로가기, 이메일 맞춤법 검사 끔, 브랜드 번역 제외, 표지 이미지 크기 지정, 검색 예시 문구, 날짜 표기 `Intl`, 제목 줄바꿈 균형·숫자 폭 고정·확인창 스크롤 전파 차단·탭 하이라이트, 상세에서 저장하지 않은 기록이 있으면 새로고침·창 닫기 경고
- [x] C. Playwright 자동 통합 테스트: `@playwright/test` 1.64 개발 의존성, 모바일 Chromium e2e 3개(가짜 API·가짜 세션·테스트 전용 공개 설정), CI `e2e` 작업 추가
- [x] D. 문서 구조 정리: README(소개·실행·검사·배포 기준), `docs/backend-api.md`(API 계약·FE 반영·BE 전달 사항), `docs/maintenance.md`(배포 절차·운영 설정·실패 처리)

## 남은 작업

- [x] 백엔드 전달 사항 1~7 FE 반영(2026-11-02 develop, mock·e2e 검증). 운영 API에서의 실제 화면 확인은 남음
- [ ] 모바일·태블릿·데스크톱 실제 기기에서 접근성·키보드·입력·로딩·빈 화면·실패·재시도 점검(web-design-guidelines 등 활용)
- [ ] 실제 BE와 연결한 통합 검증은 운영 DB가 아닌 검증 환경이 생긴 뒤 검토(현재 e2e는 가짜 API)
- [ ] 디자인 보류 항목: 검색·서재 화면 추가 다듬기, 다크 모드 외 테마 없음. 더 나은 아이디어가 있으면 수정
- [ ] 배포 방식 재검토: 배포가 잦아지면 Git 자동 연동(저장소 공개 시 커밋 이메일 노출 확인)·미리보기 배포 검토

## 다음 기능 제안·검증 준비 (2026-11-02)

- 다음 신규 기능 우선순위는 서재 순서 변경으로 정한다(FE 선정). 검색·서재의 추가 시각 개선과 책등·판형 조사는 후순위다. 구현 전 기존 화면의 접근성·입력 점검은 계속한다.
- 20개씩 조회하는 서재에 맞춰 한 항목을 기준 책 뒤로 이동하는 API 계약을 FE에서 수용했다(2026-11-02). 전체 계약은 docs/backend-api.md에 둔다. BE `feat/library-order`의 `728f8e2`와 로컬 API `/health`·`/ready` 200, OpenAPI의 순서 PATCH·필수 nullable 기준 필드·204 응답을 확인했다. FE 작업 브랜치는 `feat/library-order`, 전체 구현·검증·리뷰 완료 후 push·develop PR을 진행한다. BE 테스트 실행·병합·운영 배포는 이 FE 작업에 포함하지 않는다.
- FE 검증 계정은 최소 2개(A·B). BE와 합의한 검증 환경의 인증 프로젝트에서 발급하며, 각 계정에 자기 계정에만 있는 책 1권과 공통 ISBN 책 1권을 준비해 서로 다른 개인 메모·별점을 둔다. 로그아웃 상태는 세 번째 계정 없이 검사한다.
- 계정 전환은 같은 브라우저에서 A → 로그아웃 → B → 로그아웃 → A로 확인한다. 별도 브라우저/프로필의 동시 로그인은 보조 확인이며 같은 브라우저의 세션·늦은 응답 격리를 대신하지 않는다.

| 검증 대상 화면 | 확인할 내용 |
| --- | --- |
| `/` 로그인·서재 | 로그인·복원·로그아웃, 계정별 서재 분리·전환 중 이전 응답 차단 |
| `/books/{user_book_id}` | 오늘·과거 시작/완독, 같은 상태의 날짜만 수정, 422 시 날짜·메모 보존, 타 계정 기록 접근 차단 |
| `/catalog/{isbn13}` | 계정별 내 기록·미등록 상태, 공개 후기·내 후기 표시·수정 링크 구분 |
| `/records` 달력·통계 | 계정별 달력·완독일·연간/월간 통계 분리, 늦은 응답 차단 |
| `/search` | 계정 전환 후 담기 동작과 개인 등록 결과가 이전 계정에 연결되지 않는지 |

- 미래 완독일 거부는 FE 선택기가 내일을 막으므로 인증 API로 422 `future_date`·기존 기록 보존을 확인하고, FE 안내·입력 보존은 기존 mock 회귀 테스트와 구분한다. 자정 직후 오늘 날짜는 합의된 환경의 실제 서버 KST 기준으로 확인하며 운영 서버 시계를 바꾸지 않는다.
- 검증 환경은 로컬 FE `http://localhost:5173` + 로컬 BE `http://127.0.0.1:8000`를 사용한다. BE가 `bookstory_verify` DB·별도 Supabase `bookstory-verify`·A/B 계정·각 2권의 데이터·순서 migration 적용을 알렸다(2026-11-02). 접속 설정·계정·ISBN·검증 결과는 docs/maintenance.md에 둔다. Git 제외 검증 설정을 준비하고 실제 로그인·서재 계정 전환을 확인했다. 운영에 테스트 스위트·자동 데이터 정리를 실행하지 않는다.
- 검증 API의 검색·등록으로 A 서재를 21권으로 늘려 페이지 경계와 새로고침 유지·포커스 복구를 확인했다. B는 2권이며 A/B 순서와 전체 개인 상세의 메모·별점·날짜·공개 상태·수정 시각이 서로 영향을 받지 않음을 비교했다. 검사 후 두 계정의 순서는 복구했고 추가한 검증 책은 보존한다.

## 서재 순서 변경 FE (2026-11-02)

- [x] 기존 숲·오두막 테마를 유지하며 순서 편집·손잡이 드래그(마우스·터치)·앞/뒤 버튼(키보드) 구현. 의존성 추가 없음
- [x] 개인 ID·필수 nullable 기준 필드·204 API 연결, `invalid_position` 한국어 안내, 같은 위치·자기 자신 이동 요청 방지
- [x] 저장/재조회 중 잠금, 불러온 범위 재조회(최대 100개), 드래그 중 화면 가장자리 자동 스크롤·문서 단위 Escape 취소, 저장·확인 단계별 안내와 서버 기동 지연 안내, 불명확한 결과 자동 재전송 금지, 재조회 실패 시 목록 보존·재확인 후 복구, 계정 전환·늦은 응답 차단, 포커스 복구
- [x] 가짜 API 기반 단위 검사 179개·Playwright 핵심 흐름 7개 통과. 로컬 e2e는 설치된 Chrome의 임시 설정을 사용하고 CI 기본 Chromium 설정은 유지
- [x] 실제 검증 API·Supabase 계정 A/B에서 로그인·204 이동·새로고침 유지·21권 페이지 경계·포커스·순서/개인 기록 보존·같은 브라우저 전환 확인. 390/768/1440px 화면 확인. 실제 기기 검사는 아님
- [x] 최종 lint·전체 테스트 179개·타입 검사/빌드·Playwright 7개 통과. 브랜치 전체 독립 리뷰에서 Critical/Important 지적 없음. 검증 이력 문구 1건 수정
- [x] 코드 리뷰 반영(2026-11-02): 불러온 범위 재조회, 자동 스크롤, 문서 단위 Escape, 저장·확인 단계 안내, `aria-busy` 범위 축소. 가짜 API 기반 단위 검사 179개·Playwright 8개·lint·빌드 통과
- [x] 추가 리뷰 수정(2026-11-02): 끝까지 불러온 서재가 100권을 넘으면 이동 후 재조회에서 잘린 책을 더 보기로 이어 받도록 수정. 100·101·123권 경계에서 다음 offset·전체 순서·누락/중복 없는 이어 받기 회귀 검사 추가. 단위 검사 182개·lint·빌드 검증. 실제 기기·운영 API·e2e는 이번 수정에서 재실행하지 않음
- [ ] 리뷰 반영분의 실제 확인은 사용자 결정으로 이후 UX 다듬기 때 진행: 검증 API에서 21권 이상 불러온 뒤 이동, 실제 Android·iPhone에서 자동 스크롤 속도(가장자리 80px·프레임당 12px)·손잡이 조작감, macOS Safari Escape 취소
- [x] 사용자 배포 요청으로 [작업 PR #4](https://github.com/BookStory-zip/BookStory_FE/pull/4)를 squash 병합(develop `14b3cb0`), [배포 PR #5](https://github.com/BookStory-zip/BookStory_FE/pull/5)를 merge commit 병합(main `a82c21a`). 작업 PR CI `41416318514`·develop CI `41416862143`·배포 PR CI `41416990336`·[main CI `41417329233`](https://github.com/BookStory-zip/BookStory_FE/actions/runs/41417329233) 모두 성공. 최종 독립 리뷰 지적 없음, 로컬 lint·182개 검사·빌드·Chrome 워커 2개 기반 e2e 8개 통과
- [x] Vercel 수동 운영 배포(2026-11-03 KST): BE migration·Render 완료 안내 후 격리된 main `a82c21a`에서 CLI `64.0.2`로 배포하고 READY·운영 alias 연결을 확인했다. 기존 `.env.local`은 보존했고 CLI가 배포 트리에 만든 토큰 파일은 제거했다. 배포 ID·URL·BE 기준은 위 표에 기록했다
- [x] 운영 응답 검증: SPA 7개 경로 200·보안 헤더, 운영 순서 API·health/ready 200·운영 origin PATCH CORS, 새 순서 편집 코드가 포함된 JS 자산 10개·운영 API 설정·검증 프로젝트/로컬 API 설정 미포함 확인. 실제 Chrome 비로그인 화면 390/1440px에서 가로 넘침·미처리 JS 오류 없음
- [x] 운영 계정에서 실제 순서 이동 후 새로고침 유지 확인(사용자, 2026-11-03). 운영 데이터 쓰기와 두 계정 전환은 자동 배포 검증에 포함하지 않음
- 브랜치 완료 후 작업 브랜치 push·develop 대상 PR·CI 확인을 진행한다. 원격 반영 결과는 해당 PR·CI와 최종 인계에서 확인하며 병합·main 반영·운영 배포는 별도 요청이다.

## 무료 자동 배포 준비 (2026-11-03)

- 브랜치 흐름 확정(사용자, 2026-11-03): 모든 작업 브랜치 → develop → main. 이번 자동화 작업은 develop PR·CI·병합까지만 진행하고, 다음 기능 작업도 develop에 모은 뒤 운영 alias를 유지하는 시험 배포와 develop → main PR·첫 운영 자동 배포 검증을 함께 진행한다. 작업 브랜치에서 main으로 직접 반영하지 않는다.
- 사용자 결정: 무료 유지가 우선이다. FE 공개 적합성 점검 후 FE만 공개하는 방향을 준비하고, 공개 전환은 검사 결과·공개 범위를 제시한 뒤 최종 확인받는다. BE·Infra 비공개와 현재 운영 배포는 유지한다.
- [x] 공개 적합성 검사: 과거 PR head를 포함한 47개 커밋·과거 파일 61개·PR 6개·Actions 로그 34개를 Gitleaks 8.30.1로 검사해 비밀값 탐지 0건. Actions 산출물·저장소 변수/Secrets는 없음. 커밋 개인 이메일 1개와 문서의 검증 프로젝트 주소·테스트 계정명은 공개 범위에 포함된다. 패턴 검사 결과이며 비밀정보 부재의 절대 보장은 아님
- [x] `.github/workflows/ci.yml`: 공개된 원본 FE 저장소의 main push에서 check·e2e 성공 뒤 Vercel CLI 64.0.2 pull/build/prebuilt 배포. PR·develop·fork·비공개 저장소는 운영 배포하지 않으며 main 실행을 직렬화해 이전 배포가 최신 배포를 덮지 않게 한다
- [x] 배포 확인 스크립트·회귀 검사: BE ready/CORS 사전 확인, Production 설정 확인, 배포 결과 ID/URL·정적 커밋 표식·SPA 경로·보안 헤더 검사와 Actions Summary 기록. 자동 Git 커밋은 만들지 않으며 수동 배포·복구 절차를 남긴다
- [x] actionlint 1.7.12·Bash 구문 검사·단위 검사 204개·lint·빌드 통과. 독립 리뷰의 CORS 허용 헤더 누락 지적을 회귀 검사 4건과 함께 수정했고 실제 운영 BE의 ready·인증/JSON PATCH CORS 읽기 전용 검사도 통과했다. 앱 코드·e2e가 바뀌지 않아 로컬 브라우저 흐름은 반복하지 않았으며 원격 전체 CI는 develop 대상 PR에서 확인한다. 기존 운영 확인 1줄도 이번 작업 커밋에 포함한다
- 이번 작업의 원격 반영 범위는 develop 대상 PR·CI·병합이다(사용자 요청, 2026-11-03). 최종 병합 SHA·CI 결과는 해당 PR과 최종 인계에서 확인한다. main 반영·공개 전환·Secrets 등록·운영 배포는 다음 기능 작업 때 진행한다
- [x] FE 저장소 공개, 변수 `VERCEL_ORG_ID`·`VERCEL_PROJECT_ID`, `production` 환경(main만 허용) Secret `VERCEL_TOKEN` 등록(2026-11-03). 토큰은 대시보드에서 발급한 `bookstory-fe` 프로젝트 한정, 2027-02-01 만료(교체 절차는 docs/maintenance.md). 로컬 토큰 파일은 등록 후 삭제
- [x] develop `defcbf4` `--skip-domain` 시험 배포 `dpl_8TVnLtkBSt7hsMNUJJVjGNEuGX84` READY. 배포 보호 때문에 `vercel curl`로 커밋 표식·`/`·`/records`·`/catalog/9788936433598` 200·보안 헤더 5종 확인. 운영 alias 유지 확인
- [x] 사용자 요청으로 배포 PR #9 병합(main `85c36a0`). 첫 Actions 배포가 READY·운영 alias 연결됐고, 에이전트가 운영 커밋 표식 `85c36a0`·SPA 7개 경로·보안 헤더를 `verifyProduction`으로 직접 확인했다
- [x] 사후 검증 단계 실패 원인: CLI `deploy --json`은 비대화형(에이전트) 실행에서만 `{status, deployment}`로 감싸고 Actions에서는 배포 객체를 그대로 출력한다. 로컬 시험 배포는 감싼 형태만 확인했다. `deploymentInfo`가 두 형태를 모두 받고 `error` 포함 결과를 거부하도록 수정·회귀 검사 추가
- [ ] 수정 반영 후 다음 main 배포에서 Actions의 사후 검증 단계 통과 확인

## 개인 독서 통계 연결 (2026-10-30)

- 사용자 요청: 기존 기록 화면에서 달력·통계를 전환하고 연간·월간 통계를 조회한다.
- BE 계약: 통계 커밋 `3f9605f`, `GET /me/statistics`. `library`는 현재 현황, `period`는 선택 기간의 읽은 날짜 수이다.
- 기존 숲 테마·인증 요청·오류 처리를 재사용하고 추가 라이브러리 없이 구현한다. 12개월별 추이·장르·회독 통계는 범위에 포함하지 않는다.
- [x] API 응답 검증·달력/통계 전환·연간/월간 조회·로딩/빈 값/오류·늦은 응답 차단 검증
- [x] 연간 이동으로 공유 월이 미래가 되는 버그 수정. `moveMonth`에서 현재 KST 월을 상한으로 제한하고, 2025년 12월 → 다음 해 → 월간/달력 복귀 시 2026년 10월을 사용하는 회귀 테스트 추가.
- [x] lint·전체 단위 테스트 123개·타입 검사/빌드 통과. Playwright 4개는 설치된 Chrome을 사용하는 임시 설정으로 통과했고 모바일/태블릿/데스크톱 화면을 확인함. 기본 Chromium 실행 파일은 로컬에 미설치이며 CI 설정은 변경하지 않음. API·세션은 가짜 응답으로 검증함.
- [x] BE main `290da3e` Render 배포 및 연간·월간 통계 API 200 확인(사용자, 2026-11-02). FE 운영 화면 연결 확인은 남음
- [x] main `cdcbff7` 반영·Vercel 운영 배포(2026-11-02). 실제 로그인 후 통계 화면 확인은 남음

## 책 상세·공개 후기 연결 (2026-11-02)

- 사용자 승인 범위: 기존 메모·별점을 직접 공개 선택한 경우에만 책별 후기로 표시. 수정 시 공개 내용도 바뀌며 피드·팔로우·댓글은 제외.
- [x] 검색 제목 → `/catalog/{isbn13}`. 책 소개·출간일·출판사·출처, 내 기록, 공개 후기·평점·20개씩 더 보기
- [x] 기존 개인 기록 폼의 공개 선택·저장·해제. 메모 삭제 시 공개 해제, 재입력 시 자동 공개 금지, 실패 시 입력 보존, 새 링크 이동 전 미저장 확인
- [x] 404와 개인 조회 실패 구분, 더 보기 실패 재시도, 늦은 페이지·다른 책 응답 차단, 새 응답의 공개 필드 검증
- [x] Vitest 156개와 Playwright 핵심 흐름 5개 통과. Playwright는 설치된 Chrome 임시 설정으로 가짜 API·세션을 사용했고 390·768·1440px 스크린샷을 확인함. CI Chromium 설정은 유지
- [x] develop `b08134c` 원격 반영 확인(2026-11-02). [Frontend CI 41377397397](https://github.com/BookStory-zip/BookStory_FE/actions/runs/41377397397)의 check(lint·단위 테스트·타입 검사·빌드)·e2e 모두 통과
- [x] FE main `cdcbff7` 반영·Vercel 운영 배포, `/catalog` SPA 응답·최신 기능 번들 확인(2026-11-02)
- [ ] 실제 운영 브라우저에서 공개·수정·비공개 전환 확인. 운영 데이터 쓰기는 자동 검증에 포함하지 않음

## FE·BE 연동 리뷰 수정 (2026-11-02)

- [x] 401 대기·토큰 갱신 중 계정 전환/로그아웃 시 이전 등록 요청 재전송 차단
- [x] 개인 기록 저장 후 재조회까지 변경 잠금 유지. 재조회 실패 시 입력 보존·추가 변경 차단·최신 상태 재확인으로 복구
- [x] 회귀 사례 6개 추가. Vitest 162개·lint·타입 검사/빌드, 가짜 API 기반 Playwright 핵심 흐름 5개 검증
- [x] 수정 `28e8277` develop 푸시와 [CI 41380869454](https://github.com/BookStory-zip/BookStory_FE/actions/runs/41380869454) check·e2e 통과 확인
- [x] `e3999b0..28e8277` 전체 변경·연결 코드·BE 계약 독립 리뷰에서 병합 차단 사항 없음. [PR CI 41381107929](https://github.com/BookStory-zip/BookStory_FE/actions/runs/41381107929) 통과 후 PR #2 merge commit 병합·main CI 통과·수동 운영 배포. 로컬 lint·162개 테스트·타입 검사/빌드도 재확인함. 로컬 기본 Chromium 미설치로 e2e는 원격 CI 성공 결과로 확인

## 미래 날짜 오류 안내 (2026-11-02)

- [x] `future_date` 코드 확정. "오늘 이후 날짜는 선택할 수 없어요." 안내를 기존 공통 오류 처리에 추가하고 날짜 필드 전송 유지
- [x] 서버가 시작일·완독일을 미래로 거부하면 날짜·선택 상태·메모가 유지되고 재조회·자동 재전송 없이 다시 수정할 수 있는 회귀 사례 2개 검증. 기기에서는 과거로 보이는 날짜도 BE 오류를 기준으로 안내
- [x] 로컬 lint·Vitest 164개·타입 검사/빌드 통과. 가짜 API 기반 Playwright 핵심 흐름 5개는 설치된 Chrome 임시 설정으로 통과(`test-results/.last-run.json` passed 확인). 임시 설정은 제거하고 CI 기본 Chromium 설정은 유지
- [x] develop `a5412b7` [CI 41393012032](https://github.com/BookStory-zip/BookStory_FE/actions/runs/41393012032)·독립 리뷰·[PR CI 41393892921](https://github.com/BookStory-zip/BookStory_FE/actions/runs/41393892921) 통과 후 PR #3 merge commit 병합. main `aab40d0` CI 통과·Vercel 수동 운영 배포 완료
- [x] BE main `1ffaa8a` 운영 배포, 미래 시작일(`2026-11-03`) 422 `future_date`와 상태·시작/완독 시각·중단 시각 보존 확인(사용자 전달). 미래 완독일·자정 경계는 BE 자동 테스트만 검증됨
- [x] 운영 화면에서 오늘·어제 날짜 시작/완독 저장과 새로고침 후 상태·날짜 유지 확인(사용자, 2026-11-02)
- [ ] 실제 API에서 미래 완독일 거부·기존 기록 보존 확인. 날짜 선택기는 기기 기준 내일을 막으므로 별도 인증 API 검증 필요
- [ ] KST 자정 직후 오늘 날짜 시작/완독 저장 확인

## 매 작업 단위의 종료 기준

- 구현 전에 이번 단위의 목적·범위·완료 기준을 설명한다.
- 정상·경계·실패·데이터 보존 검증과 lint·테스트·빌드를 통과하고, 실제 동작은 사용자 확인과 mock 검증을 구분해 기록한다.
- 진행 상황·문서는 해당 작업 브랜치에 모아 반영한다. 로컬 중간 커밋은 가능하며 브랜치 전체 완료·검증 후에만 push·develop 대상 PR을 진행한다(CLAUDE.md). PR 병합·main 반영·배포는 별도 요청 범위이며, 배포 시 FE·BE 버전을 위 표에 기록한다.
