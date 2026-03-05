# 변경 사항 정리 (2026-03-05)

## 개요
이번 작업에서는 간트 상세 UI 개선, `depth` 기반 표시/동작 고도화, 드래그 앤 드랍 정렬 확장, 변경 이력 및 롤백 기능을 추가했습니다.

## 1) 간트 상세 보기 UI 개선
- `CATEGORY` 표시를 `status`와 동일한 작은 칩(배지) 형태로 변경
- 카테고리별 색상 적용
  - `중요`: red 계열
  - `정기`: blue 계열
  - `상시`: emerald 계열
  - `일반`: slate 계열
- `CATEGORY` 텍스트 중앙 정렬 적용
- `CATEGORY`와 `DEPARTMENT` 간격 미세 조정 및 밀착에 가깝게 정렬
- `CATEGORY` 칩 위치를 사용자 요청에 맞게 살짝 좌측으로 이동

## 2) 프로젝트 행 스타일 조정
- 프로젝트명이 있는 행 전체를 블루 톤 배경으로 변경
- 프로젝트명 라벨은 블루 배경 + 흰색 텍스트 배지 스타일 적용

## 3) depth 기반 표시 개선
- 행 배경색을 `depth` 기준으로 다르게 표시하도록 적용
- 화면 표시 depth를 `0~3`으로 클램프 처리
  - depth가 4 이상이어도 화면에서는 depth 3 스타일 사용
- depth 3 배경은 흰색으로 설정
- depth 3(화면 기준 3단계 이상) 업무명 앞에 불렛(`•`) 표시
  - 좌측 업무명/간트 바 텍스트 모두 적용

## 4) 업무 추가 시 depth 자동 반영
- `Task` 타입에 `depth?: number` 필드 추가
- 업무 추가 시 `parentId`를 기준으로 depth 자동 계산 후 저장
  - 루트 업무: depth 0
  - 하위 업무: 부모 depth + 1 (최대 3)
- Firestore 로딩 시 `depth` 필드 파싱 반영

## 5) 업무 정렬 DnD 도입/확장
### 5-1. 기본 DnD 정렬
- 간트 업무 행에 드래그 핸들 추가 (`GripVertical`)
- 드래그 드롭으로 업무 순서 변경 가능
- Drop 시점에만 저장하도록 처리

### 5-2. 트리 이동 확장
- 다른 부모로 드롭 가능
- 드롭 위치 3가지 지원
  - `before` (위)
  - `after` (아래)
  - `child` (하위로 삽입)
- 이동 시 자동 갱신
  - `parentId`
  - `depth` (0~3)
  - `isSubTask`
  - `displayOrder`
- 드롭 위치 시각화
  - 위/아래 라인 표시
  - 하위 삽입 영역 하이라이트
  - 위치 라벨(`위에 삽입/아래에 삽입/하위로 삽입`)

## 6) 변경 이력 + 롤백 기능
### 6-1. 이력 스키마/서비스
- Firestore `history` 컬렉션 추가
- 엔티티 타입
  - `project`, `task`, `batch`, `project_bundle`
- 액션 타입
  - `create`, `update`, `delete`, `batch_update`, `project_delete`
- 서비스 함수 추가
  - `addHistoryEntry`
  - `fetchHistoryEntries`
  - `rollbackHistoryEntry`
  - `deleteHistoryEntry`

### 6-2. 저장 훅 적용
- 프로젝트: 추가/수정/삭제 시 이력 저장
- 업무: 추가/수정/삭제 시 이력 저장
- 정렬/이동(DnD/화살표): `batch_update` 이력 저장
- 프로젝트 삭제: 프로젝트 + 하위 업무 번들(`project_bundle`)로 저장

### 6-3. UI
- 헤더에 `최근 롤백` 버튼 추가 (최신 이력 1건 롤백)
- 본문에 `변경 이력` 패널 추가
- 이력 항목별 `롤백` 버튼 추가 (선택 이력 롤백)
- 변경 이력 패널 접기/펼치기 토글 추가
  - 초기값: 접힘

## 7) 주요 수정 파일
- `components/gantt-view.tsx`
- `app/page.tsx`
- `lib/data.ts`
- `lib/firestore-service.ts`

## 8) 검증
- TypeScript 무에러 확인
  - 실행: `pnpm.cmd -s tsc --noEmit`
