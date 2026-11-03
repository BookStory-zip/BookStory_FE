# 프론트 운영 유지보수

운영 배포 절차, 운영 설정, 실패 처리입니다. 배포 기록은 [plan.md](../plan.md)에 남깁니다.

## 운영 설정

| 위치 | 설정 | 값 |
| --- | --- | --- |
| Vercel (개인 계정 프로젝트 `bookstory-fe`) | 환경변수 Production·Config | `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Vercel | `vercel.json` | SPA rewrite, 보안 헤더(프레임 차단·nosniff·Referrer-Policy·Permissions-Policy) |
| Render (BE) | `CORS_ORIGINS` | 운영 `https://bookstory-fe.vercel.app`, 로컬 `http://localhost:5173` |
| Supabase | Site URL | `https://bookstory-fe.vercel.app` |
| Supabase | Redirect URLs | 운영·로컬 각각 `/`, `/reset-password/update` |

- 환경변수는 모두 브라우저에 공개되는 값이라 Secret이 아닌 Config로 둡니다. 비밀값은 넣지 않습니다.
- Vite는 빌드할 때 환경변수를 넣으므로, 값을 바꾸면 다시 배포해야 반영됩니다.
- 새 주소(포트·Preview 포함)를 쓰면 Render `CORS_ORIGINS`와 Supabase 두 설정에 함께 추가합니다. 주소 끝에 `/`나 와일드카드를 붙이지 않습니다.

## 검증 환경 (FE 순서 변경 통합 확인, 2026-11-02)

현재 단계는 로컬 FE `http://localhost:5173`와 로컬 BE `http://127.0.0.1:8000`를 운영과 분리된 검증 DB·Supabase 인증 프로젝트에 연결합니다. 별도 FE/API 호스팅은 우선 만들지 않습니다. 운영 `.env.local`은 덮어쓰지 않습니다.

- BE 준비 완료(사용자 전달): 로컬 검증 DB `bookstory_verify`, 검증 인증 프로젝트 `bookstory-verify`(`https://sktohgilahbxddykqhgy.supabase.co`), 계정 A `verify-a@bookstory.test`·B `verify-b@bookstory.test`.
- 공개 설정은 BE의 Git 제외 `.env.verify`에서 필요한 두 항목만 FE 검증 설정으로 옮겼습니다. 사용자가 같은 파일에 준비한 `VERIFY_A_PASSWORD`·`VERIFY_B_PASSWORD`는 로컬 검증 도구에서만 읽고 FE 환경변수·브라우저 번들에 넣지 않습니다. 문서·소스·대화 출력에 비밀번호·토큰을 남기지 않습니다.
- 데이터는 모두 읽고 싶음·비공개 상태입니다. 공통 ISBN `9788936433598`은 양쪽 계정에 있고 A 고유 ISBN은 `9791168343887`, B 고유 ISBN은 `9791170614043`입니다. 메모는 계정·ISBN마다 다르고 별점은 A 4·B 2입니다. 개인 날짜·공개 설정을 바꾸는 검증 전 현재 데이터를 확인합니다.
- BE 서버는 항상 실행 중인 것으로 가정하지 않습니다. 검증 전에 BE 담당에게 실행을 요청하며 절차는 `../BookStory_BE/docs/maintenance.md`의 "검증 환경"을 따릅니다. FE 세션에서 BE 설정·DB를 임의 변경하지 않습니다.
- FE에 전달할 값: 로컬 API 주소와 검증 프로젝트의 Supabase URL·publishable key만 필요합니다. DB 주소·비밀번호·secret/service_role·로그인 토큰은 FE에 전달하지 않습니다.
- CORS의 `http://localhost:5173` 허용과 검증 인증 프로젝트의 Site URL·Redirect URLs(로컬 `/`·`/reset-password/update`) 설정 완료를 BE가 전달했습니다. 운영 프로젝트의 설정은 변경하지 않았습니다. 실제 브라우저에서 A/B 로그인·서재 조회·순서 이동·로그아웃·같은 브라우저 A→B→A 전환을 확인했습니다.
- 2026-11-02 초기 접속 점검에서는 로컬 `/health`·`/ready` 200과 OpenAPI의 순서 PATCH·필수 기준 필드·204 응답을 읽기 전용으로 확인했습니다. 이후 인증된 이동까지 확인했으며 다음 검증 전에도 서버 실행 여부를 확인합니다.
- FE의 Git 제외 파일 `.env.validation.local`에 공개 설정 3개를 모두 검증용 값으로 채웠습니다. `VITE_API_BASE_URL=http://127.0.0.1:8000`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`입니다. Vite는 공통 `.env.local`도 읽으므로 한 값이라도 비워 두거나 생략해 운영 설정이 섞이지 않도록 세 값을 모두 확인한 뒤 실행합니다. 파일은 커밋하지 않습니다.
- 페이지 경계를 위해 검증 API의 검색·등록으로 A 서재를 21권으로 늘렸습니다(B는 2권 유지). 실제 이동·새로고침·페이지 초기화·포커스 복구·계정별 순서 분리를 확인한 뒤 두 계정의 순서를 검사 전 상태로 복구했습니다. 전체 개인 상세를 메모리에서 전후 비교해 메모·별점·날짜·공개 상태·`updated_at` 보존을 확인했습니다. 추가한 검증용 책은 그대로 남겨 두며 운영 DB는 접근하지 않았습니다.

```powershell
npm.cmd run dev -- --mode validation --port 5173 --strictPort
```

검증 계정은 최소 2개이며 화면·데이터·세션 전환 검사 범위는 [plan.md](../plan.md)의 "다음 기능 제안·검증 준비"를 따릅니다. 미래 완독일은 검증 환경의 인증 API로 422와 기존 기록 보존을 확인합니다. KST 자정 경계의 BE 고정 시각 테스트·FE mock 검사와 실제 자정 수동 확인은 별도 결과로 기록하며, 이를 위해 운영 서버 시계를 바꾸지 않습니다. 운영 데이터 복제·운영 테스트 스위트·자동 정리는 수행하지 않습니다.

검증 계정의 `.test` 주소는 메일을 수신할 수 없으므로 비밀번호 재설정 메일 확인은 현재 검증 범위에서 제외합니다. 이 검사가 필요하면 수신 가능한 검증 주소를 BE와 별도로 협의합니다.

## 무료 자동 배포 준비 (공개 전환·인증 설정 대기)

현재 운영은 아래 수동 절차를 사용합니다. 자동화 코드는 `ci/vercel-production`에서 준비하며, 공개 최종 확인·Secrets/변수 등록·원격 CI·첫 자동 배포 확인 전까지 활성화 완료로 기록하지 않습니다.

- 무료 구성은 FE 저장소 공개 + Vercel Hobby + GitHub의 표준 `ubuntu-latest` 러너입니다. Hobby의 개인·비상업용 조건과 사용 한도를 따르며 Pro·대형 유료 러너·유료 기능을 자동 선택하지 않습니다. [Vercel Git 제한](https://vercel.com/docs/git#using-hobby-teams), [Hobby 조건](https://vercel.com/docs/plans/hobby), [공개 저장소 러너 요금](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)을 확인합니다.
- FE만 공개 대상으로 삼으며 BE·Infra는 변경하지 않습니다. 공개 전 소스·과거 PR 커밋·Actions 로그/산출물을 점검하고 개인 이메일·운영 및 검증 환경 주소·테스트 계정명이 이력과 문서에 포함되는 범위를 사용자에게 알립니다. `.env`의 현재 Git 제외만으로 과거 이력까지 안전하다고 판단하지 않습니다.
- Vercel 기본 Git 연동은 연결하지 않습니다. `vercel.json`의 `git.deploymentEnabled=false`로 중복 배포를 막고 [공식 Actions+CLI 방식](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)을 사용합니다.

공개 최종 확인 후 다음 값을 GitHub에 설정합니다. 실제 토큰 값은 채팅·소스·로그로 출력하지 않습니다.

| 위치 | 이름 | 내용 |
| --- | --- | --- |
| Actions Secret (`production` 환경 또는 저장소) | `VERCEL_TOKEN` | `bookstory-fe` 전용 토큰. CLI 64.0.2의 `tokens create --project` 옵션은 확인했지만 실제 Hobby 계정에서 발급 가능한지 아직 검증하지 않았습니다. 범위를 확인한 뒤 등록하며, 미지원 시 더 넓은 토큰으로 자동 대체하거나 계정 공용 로그인 토큰을 복사하지 않습니다 |
| Actions 저장소 변수 | `VERCEL_ORG_ID` | 기존 프로젝트 `.vercel/project.json`의 `orgId` |
| Actions 저장소 변수 | `VERCEL_PROJECT_ID` | 같은 파일의 `projectId` |
| Vercel Production | 기존 `VITE_` 공개 설정 3개 | 그대로 유지하며 `vercel pull --environment=production`으로 읽습니다 |

모든 작업 브랜치는 develop 대상 PR로 모으며, main 대상 PR은 develop에서만 만듭니다. 자동 배포 준비 브랜치도 예외가 아닙니다.

이번 자동화 작업은 develop PR·CI·병합까지만 진행하며, 첫 배포 검증은 다음 기능 작업과 함께 진행합니다(사용자, 2026-11-03). 다음 기능도 develop으로 모은 뒤, 공개 최종 확인·전용 토큰 준비를 마치고 해당 develop 커밋에서 `vercel build --prod`와 `vercel deploy --prebuilt --prod --skip-domain` 시험 배포를 확인합니다. 운영 alias는 유지한 채 빌드·인증·READY 결과를 확인한 다음 develop → main PR로 반영하고 첫 Actions 배포를 검증합니다. 기능 변화가 없어도 운영의 `deployment.json` 커밋 표식과 Actions Summary로 배포 여부를 확인할 수 있습니다.

배포 흐름은 다음과 같습니다.

1. PR·develop·fork에서는 check·e2e만 실행합니다. 공개된 원본 `BookStory-zip/BookStory_FE`의 main push에서 두 작업이 성공해야 deploy 작업을 실행합니다. 비공개 저장소에서는 배포하지 않습니다.
2. main 워크플로는 진행 중인 실행을 취소하지 않고 직렬화합니다. 배포 직전 원격 main과 검사한 SHA를 비교해 이미 더 최신 main이 있으면 이전 실행은 배포를 생략합니다. 토큰은 배포 단계에만 전달하고 배포 작업은 공유 npm 캐시를 사용하지 않습니다.
3. 읽기 전용 BE ready·운영 origin의 PATCH CORS를 먼저 확인합니다. 이 검사가 DB migration·새 API 계약의 적용을 증명하는 것은 아니므로, BE 변경이 필요한 기능은 BE 배포 완료 확인 후 FE main을 병합합니다. 자동화 활성화 후 main 병합은 운영 배포 승인입니다.
4. CLI `64.0.2`로 Production 설정을 읽고 API 주소·Supabase 프로젝트·공개키 형식을 값 출력 없이 확인합니다. `vercel build --prod` 결과의 `.vercel/output/static/deployment.json`에 검사한 SHA만 기록하고 `vercel deploy --prebuilt --prod --json`으로 올립니다. `.vercel` 파일은 커밋·산출물 업로드하지 않습니다.
5. CLI가 반환한 READY/production·배포 ID/URL을 검증하고, 운영 alias의 커밋 표식·7개 SPA 경로·보안 헤더를 읽기 전용으로 확인합니다. Actions Summary에는 배포 ID/URL을 먼저 기록하고 검증 성공/실패를 덧붙이므로 사후 검사에 실패해도 배포를 추적할 수 있습니다.
6. 검사 전 실패는 배포를 막습니다. 배포 후 응답 검사 실패는 이미 바뀐 운영을 자동으로 되돌리지 않으며, 실행을 실패로 표시하고 아래 수동 절차로 복구합니다. 운영 계정의 실제 데이터 쓰기는 이 자동 검사에 포함하지 않습니다.

토큰 만료·취소·저장소 비공개 전환·요금제/권한 변경 시 상태를 다시 확인합니다. CI가 실패했을 때 유료 전환이나 검사를 건너뛰는 대체 경로를 자동 실행하지 않습니다. 수동 복구 시에는 해당 워크플로를 중지하고 진행 중인 Vercel 배포 상태를 먼저 확인한 뒤, 이전 정상 커밋을 아래 절차로 배포합니다. 이후 원인을 해결하고 자동화를 재개합니다.

## 배포 절차 (Vercel CLI 수동·복구용)

조직 비공개 저장소는 Vercel Hobby에서 Git 연동이 제한되어, CLI로 수동 배포합니다(2026-10-28 결정).

1. develop → main PR을 self-review·CI 통과 후 merge commit으로 병합하고 main CI 통과를 확인합니다.
2. 로컬 변경과 `.env.local`이 없는 main 작업 트리를 만듭니다.
   ```bash
   git fetch && git worktree add --detach <임시 폴더> origin/main
   ```
3. 그 폴더에서 프로젝트를 연결하고, CLI가 만든 `.env.local`(Vercel 토큰)은 지우고 `.gitignore` 변경을 되돌립니다.
   ```bash
   npx vercel@64.0.2 link --yes --project bookstory-fe
   rm .env.local && git checkout -- .gitignore
   ```
4. 운영 배포 후 출력된 배포 URL·ID를 확인합니다.
   ```bash
   npx vercel@64.0.2 deploy --prod --yes
   ```
5. 배포 확인
   - `/`, `/search`, `/catalog/9788936433598`, `/books/abc`, `/records`, `/reset-password`, `/reset-password/update`가 200(SPA 새로고침)
   - 응답 헤더에 보안 헤더 포함
   - 운영 origin의 CORS 사전 요청 허용
   - 운영 주소에서 로그인 → 서재 → 상세 → 기록 → 로그아웃
6. plan.md "운영 배포 기록"에 날짜, FE 커밋, 배포 URL·ID, BE 커밋을 남기고 임시 작업 트리를 지웁니다(`git worktree remove <임시 폴더>`).

Vercel CLI 로그인이 필요하면 `npx vercel@64.0.2 login`을 실행하고 브라우저에서 승인합니다.

## 실패 처리

| 증상 | 확인 | 조치 |
| --- | --- | --- |
| 화면에 "앱 설정이 완료되지 않았습니다"와 변수 이름 | Vercel 환경변수 누락 | 누락 변수 등록 후 다시 배포 |
| 로그인 후 "다시 시도"가 반복 | BE `/health`, Render 기동 상태, 브라우저 콘솔의 CORS 오류 | 기동 지연이면 잠시 후 다시 시도. CORS면 `CORS_ORIGINS` 확인 후 BE 재배포 |
| 처음 접속이 30초 이상 느림 | Render 무료 인스턴스 기동 | 정상. "서버를 깨우는 중" 안내 후 이어짐 |
| 인증·재설정 메일 링크가 다른 주소로 열림 | Supabase Site URL·Redirect URLs | 실제 origin의 `/`, `/reset-password/update` 추가 |
| 인증 메일이 오지 않음 | Supabase 메일·SMTP 발송 제한 | SMTP 설정과 발송 제한 확인. 공개 가입 전 해결 |
| 상세 주소 새로고침이 404 | `vercel.json` rewrite 포함 여부 | rewrite가 들어간 main으로 다시 배포 |
| 배포 후 기능 이상 | 직전 배포 기록(plan.md) | 직전에 정상이던 main 커밋으로 위 절차를 다시 실행해 되돌림 |

운영 DB에 테스트 스위트·자동 데이터 정리를 실행하지 않습니다. 운영 확인은 개인 계정으로 수동 진행하고, 자동 검사는 가짜 API를 씁니다.
