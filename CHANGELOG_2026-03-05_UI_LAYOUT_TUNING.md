# 변경 사항 정리 (2026-03-05, UI 레이아웃 튜닝)

## 개요
상단 대시보드 레이아웃(업무 현황판 + 필터/정렬)과 간트 뷰의 시인성/밀도 개선, 업무 메모 편의 기능을 반영했습니다.

## 1) 필터/정렬 영역 개편
- `필터 및 정렬` 카드에서 `새 프로젝트` 버튼 제거
- 필터 컨트롤을 가로 1행으로 정렬
- `필터 및 정렬` 제목도 같은 줄에 배치
- 정렬/상태/부서/담당자/검색 라벨 정상화

대상 파일:
- `components/filter-bar.tsx`

## 2) 상단 배치 재정렬
- `업무 현황판`과 `필터 및 정렬`을 동일 행으로 배치
- 우측 필터 컬럼 폭 조정으로 과도한 여백 완화
- 카드 간 간격(`gap`) 축소로 상단 밀도 개선

대상 파일:
- `app/page.tsx`

## 3) 업무 현황판 한 줄/균등 정렬
- 현황 카드가 한 줄에서 보이도록 레이아웃 조정
- 6개 카드 균등 분할(`grid-cols-6`)로 좌측 영역 채움
- 화면이 좁을 때 가로 스크롤 허용(`overflow-x-auto`)

대상 파일:
- `components/status-summary.tsx`

## 4) 필터 카드 높이 정렬
- `필터 및 정렬` 카드 높이를 현황 카드 높이와 맞추기 위해 `h-full` 적용
- 내부 정렬을 `items-center` 기준으로 통일

대상 파일:
- `components/filter-bar.tsx`

## 5) 간트 뷰 높이/시인성 개선
- 고정 높이(`65vh`) 제거
- 뷰포트 기준 높이(`calc(100dvh - Npx)`)로 변경해 하단 여백 최소화
- 토/일(주말) 셀 음영 강도 상향

대상 파일:
- `components/gantt-view.tsx`

## 6) 간트 바 색상 통일
- 간트 일정 bar 색상을 업무 상태 색상 체계와 맞추어 통일
  - 완료: slate 계열
  - 진행: blue 계열
  - 대기: gray 계열
  - 보류: yellow 계열
  - 미정: rose 계열

대상 파일:
- `components/gantt-view.tsx`

## 7) 업무 메모 기능 추가
- 업무 수정 다이얼로그에 `메모` 필드 추가 (최하단 배치)
- `Task` 타입에 `memo?: string` 추가
- Firestore 로딩 시 `memo`(또는 `note`/`notes`) 파싱 지원
- 변경 이력 직렬화에 `memo` 포함
- 업무 제목 hover 시 메모 툴팁 노출(간트/목록/카드)

대상 파일:
- `components/edit-task-dialog.tsx`
- `lib/data.ts`
- `lib/firestore-service.ts`
- `app/page.tsx`
- `components/gantt-view.tsx`
- `components/project-list.tsx`
- `components/project-card-view.tsx`

## 8) 업무 수정 저장 안정화
- 특정 업무에서 수정 저장이 되지 않던 문제 수정
- 날짜 파서 지원 포맷 확장:
  - `MM월 dd일`
  - `MM/DD`, `MM-DD`
  - `YYYY.MM.DD`, `YYYY-MM-DD`, `YYYY/MM/DD`
- 날짜 파싱 실패 시 기존 시작일/종료일 유지
- 업데이트 payload 정리로 `undefined` 필드 제거 후 저장

대상 파일:
- `components/edit-task-dialog.tsx`
- `app/page.tsx`

## 9) 상세 보기(DEPARTMENT/OWNER) 표시 개선
- `DEPARTMENT`/`OWNER`를 단순 텍스트가 아닌 칩 형태로 표시
- 각 항목별 색상 토큰 적용(값마다 개별 색감)
- `OWNER`는 기본 gray 톤으로 통일하고 예외 색상 추가
  - `대표님`: blue
  - `외주`: amber
- `OWNER` 표시 개수 확장(최대 3개 표시 후 `+N`)
- `DEPARTMENT`/`OWNER` 컬럼 폭 소폭 축소

대상 파일:
- `components/gantt-view.tsx`

## 10) 숨김 토글 기능 고도화
- 업무별 숨기기(눈 아이콘) 기능 추가
- 눈 아이콘 버튼을 hover 방식에서 항상 노출로 변경
- 눈 아이콘 상태 표시 반전(숨김/보이기 구분)
- 부모 업무 단위 숨김 토글(`+/-`) 추가 및 텍스트 개선
  - `+`: `숨김 항목(00개)`
  - `-`: `숨긴 항목 숨기기`
- 숨김 항목이 0개인 경우 `+/-` 및 텍스트 미표시
- 프로젝트 단위 숨김 토글(`+/-`) 추가
- 프로젝트 단위/부모 단위 토글 충돌 로직 수정(부모 토글 우선)
- 프로젝트 숨김 카운트 계산을 원본 트리 기준으로 보정
- 토글 위치 조정 요청 반영 후 원래 위치로 롤백

대상 파일:
- `components/gantt-view.tsx`

## 11) 검증
- TypeScript 타입체크 통과
- 실행 명령:
  - `pnpm.cmd -s tsc --noEmit`
