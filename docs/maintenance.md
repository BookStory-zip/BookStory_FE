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

## 검증 환경 (BE 준비 완료·FE 접속 대기, 2026-11-02)

현재 단계는 로컬 FE `http://localhost:5173`와 로컬 BE `http://127.0.0.1:8000`를 운영과 분리된 검증 DB·Supabase 인증 프로젝트에 연결합니다. 별도 FE/API 호스팅은 우선 만들지 않습니다. 운영 `.env.local`은 덮어쓰지 않습니다.

- BE 준비 완료(사용자 전달): 로컬 검증 DB `bookstory_verify`, 검증 인증 프로젝트 `bookstory-verify`(`https://sktohgilahbxddykqhgy.supabase.co`), 계정 A `verify-a@bookstory.test`·B `verify-b@bookstory.test`. publishable key와 비밀번호는 별도 전달 예정이며 문서·소스·대화 출력에 비밀번호·토큰을 남기지 않습니다.
- 데이터는 모두 읽고 싶음·비공개 상태입니다. 공통 ISBN `9788936433598`은 양쪽 계정에 있고 A 고유 ISBN은 `9791168343887`, B 고유 ISBN은 `9791170614043`입니다. 메모는 계정·ISBN마다 다르고 별점은 A 4·B 2입니다. 개인 날짜·공개 설정을 바꾸는 검증 전 현재 데이터를 확인합니다.
- BE 서버는 항상 실행 중인 것으로 가정하지 않습니다. 검증 전에 BE 담당에게 실행을 요청하며 절차는 `../BookStory_BE/docs/maintenance.md`의 "검증 환경"을 따릅니다. FE 세션에서 BE 설정·DB를 임의 변경하지 않습니다.
- FE에 전달할 값: 로컬 API 주소와 검증 프로젝트의 Supabase URL·publishable key만 필요합니다. DB 주소·비밀번호·secret/service_role·로그인 토큰은 FE에 전달하지 않습니다.
- CORS의 `http://localhost:5173` 허용과 검증 인증 프로젝트의 Site URL·Redirect URLs(로컬 `/`·`/reset-password/update`) 설정 완료를 BE가 전달했습니다. 운영 프로젝트의 설정은 변경하지 않았습니다. 실제 FE 연결·인증 검증은 아직 수행하지 않았습니다.
- FE의 Git 제외 파일 `.env.validation.local`에 공개 설정 3개를 모두 검증용 값으로 채웁니다. `VITE_API_BASE_URL=http://127.0.0.1:8000`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`입니다. Vite는 공통 `.env.local`도 읽으므로 한 값이라도 비워 두거나 생략해 운영 설정이 섞이지 않도록 세 값을 모두 확인한 뒤 실행합니다. 파일은 실제 값을 전달받은 후 만들며 커밋하지 않습니다.

```powershell
npm.cmd run dev -- --mode validation --port 5173 --strictPort
```

검증 계정은 최소 2개이며 화면·데이터·세션 전환 검사 범위는 [plan.md](../plan.md)의 "다음 기능 제안·검증 준비"를 따릅니다. 미래 완독일은 검증 환경의 인증 API로 422와 기존 기록 보존을 확인합니다. KST 자정 경계의 BE 고정 시각 테스트·FE mock 검사와 실제 자정 수동 확인은 별도 결과로 기록하며, 이를 위해 운영 서버 시계를 바꾸지 않습니다. 운영 데이터 복제·운영 테스트 스위트·자동 정리는 수행하지 않습니다.

검증 계정의 `.test` 주소는 메일을 수신할 수 없으므로 비밀번호 재설정 메일 확인은 현재 검증 범위에서 제외합니다. 이 검사가 필요하면 수신 가능한 검증 주소를 BE와 별도로 협의합니다.

## 배포 절차 (Vercel CLI 수동)

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
