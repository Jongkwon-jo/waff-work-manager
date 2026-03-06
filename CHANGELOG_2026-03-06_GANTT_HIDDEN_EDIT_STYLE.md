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
