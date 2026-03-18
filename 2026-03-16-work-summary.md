# 2026-03-16 작업 정리

## 개요
- WorkHub 메인 구조를 로그인/권한 기반 허브 형태로 재편함.
- Firebase Auth + Firestore를 연결해 사용자 로그인, 페이지 권한, 사용자별 별칭 관리를 추가함.
- 업무관리 화면을 전략사업부와 FA 사업부로 분리하고, 변경 이력 및 롤백 흐름을 붙임.
- GPT 테스트 화면과 OpenAI 연동 API를 추가해 PDF 기반 벡터 스토어 검색형 테스트 환경을 구성함.

## 주요 작업

### 1. 인증 및 권한 체계 추가
- `components/auth/auth-provider.tsx`
  - Firebase 로그인 상태를 전역으로 관리.
  - 현재 사용자 페이지 권한을 Firestore에서 구독.
- `components/auth/auth-gate.tsx`
  - 로그인하지 않은 경우 로그인 화면으로 유도.
  - 관리자 전용 페이지(`/admin`)와 일반 페이지 권한 접근 제어 추가.
- `components/auth/login-form.tsx`
  - 이메일/비밀번호 로그인 UI 추가.
  - 이메일 기억하기, 자동 로그인 옵션 추가.
- `lib/firebase.ts`
  - Firebase App/Auth/Firestore 초기화 구성.
- `lib/page-access.ts`
  - 관리자 이메일, 페이지 권한 키, 기본 권한값, 경로-권한 매핑 정의.
- `app/layout.tsx`
  - 전체 앱을 `AuthProvider`, `AuthGate`, `Toaster`로 감싸도록 변경.

### 2. 메인 허브 및 페이지 구조 개편
- `app/page.tsx`
  - 기존 단일 대시보드 성격 화면을 WorkHub 허브형 메인 페이지로 변경.
  - 사용자 권한에 따라 카드 메뉴 노출:
    - 마이 페이지
    - 전략사업부 업무관리
    - FA 사업부 업무관리
    - GPT 테스트
    - 관리자
- `public/placeholder-logo.png`
  - 로그인/메인/서브 화면에 쓰이는 로고 자산 반영.

### 3. 업무관리 화면 분리 및 확장
- `app/work-management/page.tsx`
  - 전략사업부 업무관리 전용 페이지 추가.
- `app/fa-work-management/page.tsx`
  - FA 사업부 업무관리 전용 페이지 추가.
- 공통적으로 반영된 내용
  - 로그인 사용자 기반 데이터 구독
  - 프로젝트/업무 CRUD
  - 프로젝트/업무 순서 이동
  - 업무 드래그 재배치 반영
  - 변경 이력 조회 및 최근/개별 롤백
  - 간트/목록/카드 뷰 전환
  - 헤더에서 권한별 빠른 이동 링크 제공

### 4. Firestore 서비스 고도화
- `lib/firestore-service.ts`
  - 전략사업부용 Firestore 서비스 확장.
  - 프로젝트/업무 트리 구성 로직 보강.
  - 변경 이력 저장/조회/롤백 기능 추가.
  - 사용자 프로필, 최근 로그인 시각, task alias 저장/구독 추가.
  - 사용자 페이지 권한 저장/구독 추가.
- `lib/firestore-service-fa.ts`
  - FA 사업부용 컬렉션(`fa_projects`, `fa_tasks`, `fa_history`, `fa_settings`) 분리 버전 추가.

### 5. 간트뷰 기능 확장
- `components/gantt-view.tsx`
  - 프로젝트/업무 숨김 처리 및 숨김 보기 지원.
  - 담당자/부서 멀티 선택 편집 UI 추가.
  - 날짜 셀 캘린더 선택 UI 추가.
  - 업무 상하 이동 버튼 추가.
  - 업무 드래그 앤 드롭 재배치 처리 강화.
  - 상세 컬럼 패널, 가상 스크롤, 타임라인 스크롤 동기화 등 화면 사용성 보강.

### 6. 관리자/개인화 화면 추가
- `app/admin/page.tsx`
  - 사용자별 페이지 접근 권한 관리 화면 추가.
  - 사용자별 task alias 관리 기능 추가.
  - 로그인 이력 기반 사용자 목록 관리.
- `app/my-page/page.tsx`
  - 사용자 이메일/표시명/task alias 기준으로 본인 담당 업무만 모아보는 화면 추가.
  - 전략사업부/FA 사업부 업무를 함께 집계.

### 7. GPT 테스트 기능 추가
- `app/gpt-test/page.tsx`
  - GPT 채팅 테스트 UI 추가.
  - 로컬 스토리지 기반 채팅 세션 저장/불러오기.
  - API Key, 모델, 시스템 프롬프트 설정 UI 추가.
  - PDF 업로드 및 벡터 스토어 선택 UI 추가.
  - 답변과 함께 참고 문서/검색 스니펫 표시.
- `app/api/gpt-test/route.ts`
  - OpenAI Responses API 호출 엔드포인트 추가.
  - vector store 검색 결과를 기반으로 답변 grounding 처리.
  - citation/snippet/usage 응답 가공.
- `app/api/gpt-test/vector-stores/route.ts`
  - 벡터 스토어 목록 조회 API 추가.
  - PDF 업로드 -> OpenAI Files 업로드 -> Vector Store 생성 -> 완료 대기 흐름 구현.

### 8. 패키지 의존성 반영
- `package.json`
  - `firebase` 의존성 추가.

## 어제 변경된 주요 파일
- `app/layout.tsx`
- `app/page.tsx`
- `app/admin/page.tsx`
- `app/my-page/page.tsx`
- `app/work-management/page.tsx`
- `app/fa-work-management/page.tsx`
- `app/gpt-test/page.tsx`
- `app/api/gpt-test/route.ts`
- `app/api/gpt-test/vector-stores/route.ts`
- `components/auth/auth-provider.tsx`
- `components/auth/auth-gate.tsx`
- `components/auth/login-form.tsx`
- `components/gantt-view.tsx`
- `lib/firebase.ts`
- `lib/firestore-service.ts`
- `lib/firestore-service-fa.ts`
- `lib/page-access.ts`
- `package.json`
- `public/placeholder-logo.png`

## 메모
- 기준일은 현재 워크스페이스 시간 기준 어제인 `2026-03-16`로 잡았음.
- 커밋 로그보다는 워킹트리의 실제 소스 변경 시각과 변경 파일 내용을 기준으로 정리함.
