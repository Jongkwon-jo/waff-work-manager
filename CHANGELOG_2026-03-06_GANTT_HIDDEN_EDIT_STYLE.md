# 2026-03-06 간트 뷰 기능/스타일 수정 내역

## 범위
- 파일: `components/gantt-view.tsx`, `components/edit-project-dialog.tsx`, `app/page.tsx`
- 목적: 간트 뷰의 숨김 토글 동작/집계 정합성 개선, 클릭 편집 UX 개선, 프로젝트 헤더 스타일 조정

## 1) 숨김 항목 집계/노출 로직을 직계 자식 기준으로 변경
- 프로젝트의 `숨김 항목(00개)`는 프로젝트의 바로 아래 업무(`project.tasks`)만 집계
- 상위 업무의 `숨김 항목(00개)`는 해당 업무의 바로 아래 하위업무(`subTasks`)만 집계
- 숨김 항목 보기 토글이 후손 전체를 열지 않고, 해당 레벨(직계 자식)만 열도록 변경

## 2) 숨기기 즉시 반영 동작 추가
- 업무를 숨기는 즉시 화면에서 사라지도록 동작 보강
- 숨김 처리 시 해당 컨텍스트의 `숨김 항목 보기` 확장을 자동 해제
  - 루트 업무 숨김: 프로젝트 숨김 확장 해제
  - 하위 업무 숨김: 조상 부모들의 숨김 확장 해제 + 숨김 상태로 전환

## 3) 클릭 편집 UX 개선
- 프로젝트명 클릭 시 `EditProjectDialog` 열리도록 연결
  - `GanttView`에 `onEditProject` prop 추가
  - `app/page.tsx`에서 `handleEditProject` 전달
- 상위 업무(자식 보유 업무) 제목 클릭 시 `EditTaskDialog` 열리도록 변경
  - 하위 업무와 동일한 편집 진입 방식으로 통일
- `EditProjectDialog`에 사용자 지정 트리거(`trigger?: ReactNode`) 지원 추가

## 4) 프로젝트 헤더 스타일 조정
- 프로젝트명 배경 제거
- 프로젝트명 글자색 흰색 적용
- 프로젝트 헤더 내 토글 버튼(접기/펼치기, 숨김 +/-) 흰색 적용
- 프로젝트 정렬 버튼(위/아래) 흰색 적용

## 5) 검증
- 타입체크: `pnpm -s tsc --noEmit` 통과

## 참고
- 현재 워크트리에는 본 변경 외 파일(`lib/firestore-service.ts`, `tsconfig.tsbuildinfo`)의 수정도 존재함

---

## 6) 숨김 상태 Firestore 연동 (새로고침 유지)
- `Task` 모델에 `isHidden?: boolean` 필드 추가
- 간트에서 숨김 토글 시 `onEditTask`를 통해 `isHidden`을 DB에 즉시 저장
- 데이터 구독 시 `task.isHidden` 기준으로 `hiddenTaskIds`를 동기화하여 새로고침 후에도 숨김 상태 유지
- 이력 직렬화(`serializeTaskData`)에도 `isHidden` 포함하여 롤백 정합성 보강

## 7) 프로젝트 정렬 흔들림(동률) 안정화
- 프로젝트 정렬 비교식에 고정 타이브레이커 추가:
  - `displayOrder -> createdAt -> id`
- `이름/구분/진행률` 정렬에서도 동률 시 동일 타이브레이커를 사용하도록 보강
- 스냅샷 갱신 시 순서가 임의로 바뀌는 현상 완화

## 8) 정렬 선택값 공통 저장 (Firestore)
- `settings/dashboard_preferences` 문서에 `sortBy` 저장
- 앱 로드 시 `sortBy`를 구독하여 공통 기본 정렬 자동 반영
- 정렬 선택 변경 시 DB 저장(`saveDashboardSortBy`) 수행

## 9) 간트 DnD 재정렬 후 새로고침 원복 이슈 수정
- 드래그 재정렬에서 루트 이동 시 `parentId`를 `undefined` 대신 `null`로 저장하도록 수정
- Firestore `updateTaskInDB` 업데이트 타입을 `parentId: string | null` 허용으로 보강
- 재정렬 결과가 DB에 정상 반영되어 새로고침 후에도 유지

## 10) 프로젝트 헤더 숨김 토글 라벨 위치 조정
- `숨긴 항목 숨기기/숨김 항목(00개)` UI를 프로젝트명 바로 오른쪽에 고정
- 우측 액션 버튼 영역(업무 추가/정렬 버튼)과 레이아웃 분리하여 위치 안정화

## 추가 검증
- 타입체크: `pnpm.cmd exec tsc --noEmit` 통과
