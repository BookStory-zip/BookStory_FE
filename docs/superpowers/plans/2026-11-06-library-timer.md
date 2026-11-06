# Library and Timer Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서재의 관리 노출과 타이머 기록 노출을 줄이고 화면에 맞게 책을 채운다.
**Architecture:** 기존 Library의 조건·조회·저장 상태를 유지하며 상단을 재배치한다. 네이티브 dialog로 책장 관리를 감싸고 책/책장 손잡이의 이동 메뉴를 재사용한다. 타이머 기록은 독립적인 접이식 영역에서 현재 historyOnly 동작을 재사용한다.
**Tech Stack:** React 19, TypeScript, CSS, Vitest, Playwright. 의존성 추가 없음.
**Spec:** `docs/superpowers/specs/2026-11-06-library-timer-design.md`

## Global Constraints

- 요청당 limit 1~100, offset은 받은 수 기준. BE 기본 20과 API 계약은 변경하지 않는다.
- 책과 책장 모두 반복되는 앞·뒤 버튼 제거.
- 기존 저장·오류 처리·불명확한 쓰기 결과 재확인과 접근성 보존.
- 작업별 순차 브랜치. main 병합과 원격 push 없음.

## Review Focus

- 검색/크기 변경과 늦은 응답 경합: 새 조건에 이전 결과를 붙이지 않는다(Task 1).
- 초기 가변 limit과 재조회: 다음 페이지 유무를 잘못 닫거나 끝없이 요청하지 않는다(Task 1).
- 모달 위 삭제 확인과 저장 중 Esc: 바른 계층과 포커스, 저장 잠금 유지(Task 2).
- 손잡이 click과 drag의 충돌: 드래그 뒤 메뉴가 뜨거나 중복 저장되지 않는다(Task 3).
- 기록용 책 선택과 다른 탭 측정 복원: 측정값·선택·계정 격리를 보존한다(Task 4).

### Task 1: 서재 상단과 초기 채우기

**Files:** `src/Library.tsx`, `src/index.css`, 필요시 `src/lib/library-layout.ts`; tests `src/Library.test.tsx`, `e2e/library-experience.e2e.ts`, `e2e/library-order.e2e.ts`.
**Interfaces:** 기존 `getLibraryBooks(token, limit, offset, filter)`와 필터를 유지. 초기/추가 조회에 레이아웃 기반 limit 사용. 조건 적용 및 보존 재조회의 hasMore 판정을 구분.

- [ ] 숨긴 검색의 조건 해제와 관리 진입 테스트, 8열 부분 행·resize·접기·책 부족 브라우저 회귀 테스트를 먼저 작성하고 실패 확인.
- [ ] 상단 disclosure와 관리 메뉴, 조건 요약/해제, 가변 초기 조회와 렌더 후 보충 구현. 실측이 없는 jsdom은 기존 20 fallback.
- [ ] `npm.cmd test`, `npm.cmd run test:e2e -- e2e/library-experience.e2e.ts e2e/library-order.e2e.ts --workers=1` 통과 및 세 폭 스크린샷 확인.
- [ ] `feat/library-toolbar`에서 검증한 파일만 커밋.

### Task 2: 책장 관리 모달

**Files:** `src/ShelfManager.tsx`, `src/Library.tsx`, `src/index.css`, `src/ShelfManager.test.tsx`, `src/Library.test.tsx`, `e2e/library-order.e2e.ts`.
**Interfaces:** 기존 `ShelfManager` props와 쓰기/재조회 유지. open/onClose를 추가해 dialog 표시와 저장 중 닫기를 제어.

- [ ] 모달·저장 중 cancel 차단·닫기 포커스 복귀 테스트를 먼저 작성하고 실패 확인.
- [ ] 기존 관리 화면을 dialog에 배치. 내부 스크롤과 삭제 확인 계층, 필요한 안내/도움말 구현.
- [ ] 관련 Vitest/Playwright와 모바일 스크린샷 검증 후 `feat/shelf-management-modal` 커밋.

### Task 3: 책·책장 순서 손잡이

**Files:** `src/Library.tsx`, `src/ShelfManager.tsx`, 필요시 `src/OrderHandle.tsx`, `src/index.css`; 해당 unit/e2e 테스트.
**Interfaces:** 책 `move(from,to)`와 책장 `move(from,to)` API·저장 처리 재사용. 손잡이는 disable 상태와 방향별 이동 가능 여부, onMove를 받는다.

- [ ] 앞뒤 상시 버튼 부재, click 메뉴 이동·방향키·드래그 및 실패 후 복구 테스트를 먼저 작성하고 실패 확인.
- [ ] 책/책장 손잡이와 메뉴, 포커스 복귀·경계 차단·사용법 접기 구현.
- [ ] 관련 unit/e2e 검증 후 `feat/library-order-controls` 커밋.

### Task 4: 타이머 기록 접기

**Files:** `src/TimerPage.tsx`, `src/ReadingTimer.tsx`, `src/index.css`, 해당 unit 테스트와 타이머 e2e.
**Interfaces:** `ReadingTimer`의 기존 저장·복원 유지. 기록 표시를 제어해 측정 인스턴스를 remount하지 않는다. historyOnly 경로는 전체 상태 책의 조회/삭제에 재사용.

- [ ] 초기 기록 숨김·완독/중단 기록 조회삭제·접기/기록 책 변경 중 측정 유지 테스트를 먼저 작성하고 실패 확인.
- [ ] 작은 기록 disclosure와 독립적인 기록 책 선택, 상황별 안내와 사용법 도움말 구현.
- [ ] 전체 `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build`, 관련 전체 e2e와 세 폭 스크린샷 검증.
- [ ] `feat/timer-history-disclosure` 커밋. 전체 변경 독립 리뷰 후 중요한 문제를 회귀 테스트와 함께 수정.
