# 2026-03-18 작업 정리

## 개요
- `gpt-test` 페이지의 벡터 스토어 PDF 기록 유지 방식을 개선함.
- 벡터 스토어 생성 시 사용한 PDF 목록을 브라우저 저장뿐 아니라 Firestore 컬렉션에도 저장하도록 확장함.
- 검색된 문서 조각 UI를 짧은 미리보기 + 클릭 시 전체 보기 방식으로 개선함.
- `gpt-test` 화면과 관련 API의 깨진 한글 문구를 정상 한국어로 정리함.
- 벡터 스토어 삭제 기능을 추가하고, 삭제 시 메타데이터와 로컬 기록도 함께 정리되도록 연결함.

## 주요 작업

### 1. 벡터 스토어 PDF 기록 저장 구조 개선
- `app/gpt-test/page.tsx`
  - 벡터 스토어별 PDF 파일명 기록을 `localStorage`에 저장/복원하는 로직을 정리함.
  - 초기 복원 이전에 빈 값이 `localStorage`를 덮어쓰지 않도록 persistence 가드를 추가함.
  - 새로고침 후 목록 새로고침 시에도 저장된 PDF 기록을 다시 병합하도록 보강함.
- `lib/gpt-test-vector-store-metadata.ts`
  - Firestore `gpt_test_vector_stores` 컬렉션을 사용하는 메타데이터 저장/조회/삭제 유틸을 추가함.
  - 저장 항목:
    - `vectorStoreId`
    - `name`
    - `filenames`
    - `savedAt`
- `app/gpt-test/page.tsx`
  - 벡터 스토어 생성 후 PDF 목록을 Firestore에도 저장하도록 연결함.
  - 새로고침 후 벡터 스토어 목록 조회 시 Firestore 메타데이터를 다시 읽어 PDF 목록을 병합함.

### 2. 벡터 스토어 삭제 기능 추가
- `app/api/gpt-test/vector-stores/route.ts`
  - OpenAI 벡터 스토어 삭제용 `DELETE` 핸들러를 추가함.
- `app/gpt-test/page.tsx`
  - 벡터 스토어 카드에 삭제 버튼을 추가함.
  - 삭제 확인 후 OpenAI의 벡터 스토어를 실제로 삭제하도록 연결함.
  - 삭제 성공 시 아래 항목도 함께 정리되도록 처리함:
    - 화면 목록
    - 선택된 벡터 스토어 ID
    - PDF 기록 `localStorage`
    - Firestore 메타데이터

### 3. 검색된 문서 조각 UI 개선
- `app/gpt-test/page.tsx`
  - 문서 조각 본문을 그대로 길게 노출하던 방식에서 카드형 미리보기로 변경함.
  - 상위 일부 조각만 요약해서 보여주고, 카드를 클릭하면 모달에서 전체 본문을 확인할 수 있도록 수정함.
  - 조각 카드에 파일명, 페이지, 유사도, 파일 ID를 함께 표시함.

### 4. 깨진 한글 문구 복구
- `app/gpt-test/page.tsx`
  - 제목, 버튼, 패널 제목, 안내 문구, 상태 메시지, 빈 상태 문구를 정상 한국어로 복구함.
- `app/api/gpt-test/route.ts`
  - GPT 응답 실패, 메시지 없음, 검색 실패 등 API 오류 메시지를 정상 한국어로 정리함.
- `app/api/gpt-test/vector-stores/route.ts`
  - 벡터 스토어 생성/조회/삭제 관련 오류 메시지와 기본 문자열을 정상 한국어로 정리함.

## 오늘 수정한 주요 파일
- `app/gpt-test/page.tsx`
- `app/api/gpt-test/route.ts`
- `app/api/gpt-test/vector-stores/route.ts`
- `lib/gpt-test-vector-store-metadata.ts`

## 검증 메모
- `cmd /c node_modules\\.bin\\tsc.CMD --noEmit --pretty false` 실행 기준 타입 오류 없이 통과함.

## 커밋 메시지 후보
- `feat: persist gpt-test vector store metadata in firestore and add delete flow`
