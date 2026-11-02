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
