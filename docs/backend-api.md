# 백엔드 API 연동

FE가 사용하는 BookStory BE API 계약과 FE 반영 방식, BE 전달 사항입니다.
구현 전에는 BE `app/` 코드와 운영 [OpenAPI](https://bookstory-api-w31a.onrender.com/openapi.json)를 다시 대조합니다.
BE가 FE용으로 정리한 계약은 BE 저장소 `docs/frontend-api.md`에 있습니다.

- 운영 API: https://bookstory-api-w31a.onrender.com · [Swagger](https://bookstory-api-w31a.onrender.com/docs)
- 기준: 운영 OpenAPI와 로컬 BE `185e11b` (2026-10-28 확인)

## 인증

Supabase SDK로 로그인·세션 복원 → `session.access_token`으로 `GET /me` 성공 → 개인 화면을 엽니다.

- BE에는 `/login`·`/signup`이 없습니다. 요청은 `Authorization: Bearer <access_token>`만 씁니다.
- 401은 SDK로 한 번만 갱신해 다시 요청합니다. 503·연결 실패·60초 시간 초과는 로그아웃으로 처리하지 않습니다.
- 계정이 바뀌면 개인 화면을 새로 그려 이전 계정의 늦은 응답을 버립니다.
- 세션 없는 가입 성공은 이메일 인증 대기입니다. 재설정 메일은 `/reset-password/update`로 돌아옵니다.

## 사용하는 API

| 메서드·경로 | 요점 | FE 반영 |
| --- | --- | --- |
| `GET /books/search?query=` | 공개. 1~200자, 최대 10개 `{documents, meta}` | 공급자 값의 누락·null 방어, 이전 검색 응답 차단 |
| `GET /me` | `{user_id}` | 개인 화면 진입 조건 |
| `POST /library/books` | `{isbn13}` → `{id, book_id, status}`. 이미 있으면 기존 기록 반환 | ISBN13 없는 결과는 담기 막음 |
| `GET /library/books?limit&offset` | 배열, 기본 20·최대 100, 최신 등록순. 전체 건수 없음 | 20개씩 더 보기. 부분 목록으로 통계를 만들지 않음 |
| `GET /library/books/{id}` | 상세. 날짜·별점·메모 등 null 가능 | 없는 값을 채우지 않음. 404는 타인 항목과 구분하지 않음 |
| `PATCH …/{id}/status` | `status` + 선택 `started_at`·`completed_at` | 아래 날짜 규칙 |
| `PATCH …/{id}/record` | 선택 `rating`(1~5)·`memo`(1만 자)·`stop_reason`(1천 자) | 바뀐 필드만 전송. 빈 값은 null(삭제), 별점 0은 보내지 않음 |
| `DELETE …/{id}` | 204. 연결된 독서 체크도 삭제 | 확인창 후 삭제 |
| `PUT·DELETE …/{id}/reading-logs/today` | 체크는 읽는 중만, 취소는 상태 무관·기록 없어도 204. 날짜는 서버 KST | 오늘 체크 여부는 오늘 기록의 `user_book_id`로 판단 |
| `GET /reading-logs?start_date&end_date&limit&offset` | 양 끝 포함·최대 366일, 100개씩 | 마지막 페이지까지 전부 조회. 실제 체크한 날만 달력에 표시 |
| `GET /me/statistics?year&month` | `month` 생략 시 연간 합계. `library`(현재 서재 현황)·`period`(기간 활동, `reading_days`) | 기록 화면 통계 탭에서만 요청. 아래 통계 참고 |

| 값 | 의미 |
| --- | --- |
| `isbn13` | 등록용 ISBN. 공백으로 이어진 `isbn`에서 `97[89]`로 시작하는 13자리만 사용 |
| `book_id` | 사용자 공용 책 UUID |
| 서재 `id` | `user_book_id`. 상세·수정·체크·삭제 경로에 사용 |

## 개인 독서 통계

`GET /me/statistics?year=2026&month=10`은 월간, `month`를 생략하면 연간 합계입니다.

- `library`: 기간과 무관한 현재 서재 현황(`total_books`, 5개 상태의 `status_counts`, `completed_books`). 완독 경험은 재독 중인 책도 포함하고 회독 횟수를 세지 않습니다.
- `period`: 선택 기간 활동(`year`, 연간이면 null인 `month`, `start_date`, `end_date`, `reading_days`). 같은 날 여러 책을 체크해도 1일이며, 체크 취소·서재 삭제 후 수치가 달라질 수 있습니다.
- FE: 통계 탭은 달력과 선택 월을 공유하고, 연간·월간 전환과 이전 기간 이동을 지원합니다. 기간을 바꾸거나 화면을 떠나면 이전 응답을 버리고, 오류·로딩·실제 0일을 구분합니다. 12개월 추이 그래프는 없습니다.
- 상태: BE 통계 커밋 `3f9605f`의 계약을 사용합니다. BE main 반영·운영 배포 후 운영 연결을 확인해야 하며, FE의 mock·e2e 검증이 이를 대신하지 않습니다.

## 독서 상태와 날짜

| 상태 | 규칙 |
| --- | --- |
| `want_to_read` 읽고 싶음 | 되돌리면 시작일·중단일·사유 초기화. 완독 경험이 없으면 완독일·별점·메모도 초기화 |
| `reading` 읽는 중 | 읽고 싶음·완독·포기에서 오면 새 독서: 시작일을 미리 채우지 않고 빈칸이면 오늘 시작. 중단에서 재개·읽는 중 날짜 고치기는 기존 시작일 유지 |
| `completed` 완독 | 읽는 중·중단에서 오면 완독일 생략 시 지금. 완독일 null 가능. 재독을 시작해도 이전 완독일 보존 |
| `paused` 중단 | 읽는 중에서만 |
| `abandoned` 포기 | 읽는 중·중단에서만 |

- 사용자가 고른 날짜만 보냅니다. 시작은 KST 00:00, 완독은 KST 23:59:59(오늘이면 지금)로 보냅니다.
- `read_date`·`published_date`는 문자열 그대로 다뤄 시간대 변환으로 하루가 밀리지 않게 합니다.
- 중단 7일 경과 포기와 도서 정보 갱신은 BE 배치 몫이며 FE 타이머로 처리하지 않습니다.

## 오류 처리

| 상태 | FE 안내 |
| --- | --- |
| 401 | 다시 로그인 |
| 404 | 서재에서 찾을 수 없음 |
| 409 | 지금 상태에서 바꿀 수 없거나 날짜 충돌 |
| 422 | 입력값 확인(영어 `detail`은 노출하지 않음) |
| 502·504 | 책 정보 제공처 문제·응답 지연 |
| 503 | 서버가 잠시 응답할 수 없음 |

쓰기 결과가 불명확하면(연결 실패·502·504·시간 초과) 다시 보내지 않고 서버 상태를 다시 조회합니다. 실패해도 입력은 보존합니다.

## BE 전달 사항

FE 작업 중 확인한 BE 제약과 최소 변경 제안입니다. BE 반영·배포 전에는 FE에서 대체 구현하지 않습니다.

| 우선순위 | 요청 | 현재 제약 | 제안 | FE 영향 |
| --- | --- | --- | --- | --- |
| 1 | 독서 기록에 완독 정보 | `/reading-logs`에 완독일·상태 없음 | `completed_at` 등 추가 | 달력 "완독" 라벨 |
| 2 | 검색 결과 10개 초과 | 카카오에 `size: 10`만 전달, `page` 없음 | `page`(1~50) 전달 | "결과 더 보기" |
| 3 | 신규·기존 등록 구분 | 신규·기존 모두 200 | 신규 201·기존 200 | "이미 서재에 있음" 정확한 안내 |
| 4 | 오류 코드 | 409·422 `detail`이 영어 문장 | 최상위 `code` | 원인별 한국어 안내 |
| 5 | 검색 `isbn13` | FE가 `isbn`에서 ISBN13을 고름 | 항목별 `isbn13` | FE 정리 로직 삭제 |
| 6 | 날짜만 받는 상태 변경 | FE가 KST 시각으로 변환해 전송 | `started_date`·`completed_date` | FE 시각 변환·자정 보정 삭제, 기기 시계 오차 해소 |
| 7 | 허용 전환 제공 | FE가 전환 규칙을 복제 | 상세 `allowed_statuses` | FE 규칙 삭제 |
| 후속 | 서재 순서 바꾸기 | 최신 등록순 고정 | 순서 필드·API | 드래그 정렬(MVP 이후) |
| 후속 | 실제 책등 이미지·판형 | 카카오는 앞표지만 제공 | 데이터 출처 조사 | 책등이 꽂힌 서재 |

**진행 상황(2026-10-28):** BE가 1~7번을 모두 다루는 계약(BE `docs/frontend-api.md`)을 보냈고, 재독 시작일 규칙을 확정했습니다. 운영 OpenAPI에는 아직 반영되지 않았습니다. 운영 배포를 OpenAPI로 확인한 뒤 아래 FE 작업을 진행합니다.

배포 후 FE 작업:

- [ ] 검색: `page` "결과 더 보기"(50페이지 또는 `meta.is_end`면 숨김), BE `isbn13` 사용 후 `pickIsbn13` 삭제
- [ ] 등록: 201 "서재에 담았습니다", 200 "이미 서재에 있는 책(상태)". 요청 함수가 응답 상태 코드도 반환
- [ ] 상세: `started_date`·`completed_date` 전송 후 KST 시각 변환·자정 보정 삭제, `allowed_statuses`로 전환 제한 후 `blockedReason` 삭제
- [ ] 기록 달력: `/reading-completions` 다중 페이지 조회, `user_book_id`+날짜로 체크와 합쳐 표지에 "완독" 라벨, 안내 문구 수정
- [ ] 오류: `code`별 한국어 안내
