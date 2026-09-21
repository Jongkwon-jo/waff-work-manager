# WorkHub MCP Python 스터디

기존 Next.js/Firebase 코드를 변경하지 않고, **가상 데이터 → MCP 도구 → 답변**을 배우는 독립 실습입니다. 운영 DB, 계정, 이메일, 실제 프로젝트 파일을 읽지 않습니다. 모든 업무와 사람은 창작한 예제입니다.

## 먼저 실행하기

Python 3.11 이상 기준. 프로젝트 루트에서 PowerShell로 실행합니다.

```powershell
cd prototypes/workhub-mcp-study
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe client.py
```

MCP 서버는 클라이언트가 자식 프로세스로 시작하고 종료합니다. 별도 터미널, 서버 공개, API 키가 필요 없습니다. 의존성 설치에는 인터넷이 필요하지만 **기본 실습 실행은 외부 API를 호출하지 않습니다.**

이 PC에는 MCP 1.27.1 / OpenAI 2.37.0이 이미 설치되어 있어 `python client.py`로도 실행할 수 있습니다. 재현을 위해 버전을 고정했습니다. 최신 MCP SDK는 v2이며, 이 실습은 기존 설치의 **v1 FastMCP API**를 사용합니다. v2의 `MCPServer`/`Client` 예제와 섞지 마세요. 기존 앱이나 전역 패키지의 버전을 바꾸지 않아도 됩니다.

## 학습 목표와 흐름

```text
질문
  → Python 클라이언트 (호스트)
  → MCP 초기화 / tools/list
  → tools/call (실제 stdio MCP 통신)
  → Python 서버에서 권한 범위·입력 검증
  → 가상 업무 조회·집계
  → 구조화된 결과와 근거 ID 반환
  → 템플릿 답변 또는 선택적 AI 답변
```

MCP는 데이터를 학습시키는 기술이 아니라, AI 호스트가 외부 기능을 발견하고 호출하는 규약입니다. 이 실습에서는 데이터·계산을 서버에 두고, 호스트가 결과를 답변으로 연결합니다.

**기본 모드의 도구 선택과 문장 생성은 미리 정해져 있습니다.** 자연어를 이해하는 AI는 실행되지 않습니다. 서버와 클라이언트 사이의 MCP 통신은 실제입니다. 자유 질문과 모델의 도구 선택은 `--ai` 단계에서 실습합니다.

## 1교시 — 데이터와 계산 (20분)

`sample_data.json`을 읽고 `domain.py`를 살펴봅니다.

- 전략기획·FA·ICT 데이터 모양을 단순화했습니다. 실제 Firestore 스키마와 1:1로 같지는 않습니다.
- 예제의 기준일은 **2026-09-09, 한국 시간**으로 고정했습니다. 실행 날짜가 바뀌어도 정답이 같습니다.
- `queried_at`은 실제 실행 시각입니다. 고정 기준일과 조회 시각을 구분합니다.
- 최하위 업무만 집계하며, 상위 업무의 공수를 중복 합산하지 않습니다.
- 취소는 일반 목록에 보이지만 완료율·지연·공수 집계에서는 제외합니다.
- 숨김 프로젝트, 숨김 업무와 그 하위 업무는 조회에서 제외합니다.
- 다른 화면에 연결된 업무는 원본 프로젝트 ID + 업무 ID로 중복 제거합니다.
- 지연은 `마감 < 기준일`이고 상태가 완료/취소가 아닌 업무입니다.
- 완료율은 완료 건수 / 취소 제외 최하위 건수입니다. 대상 0건이면 비율은 `null`입니다.
- 기간 조회는 시작일과 종료일 사이에 업무 기간이 겹치는지 판단합니다.

예상 정답:

| 범위 | 취소 제외 업무 | 완료 | 지연 | 공수 합계 | 완료율 |
|---|---:|---:|---:|---:|---:|
| FA | 3 | 1 | 1 | 6일 | 33.3% |
| 전체 사업부 | 5 | 1 | 2 | 11일 | 20.0% |

연습: `fa-1` 상태를 완료로 바꿔 실행해 보세요. FA 지연은 0건, 완료율은 66.7%가 되어야 합니다. 실습 후 원래 `진행`으로 돌립니다. 공수는 기간에서 새로 계산하지 않고 예제의 `man_days`를 합산합니다.

## 2교시 — Python 함수를 MCP 도구로 공개하기 (20분)

`server.py`의 `@mcp.tool()`과 함수 설명·타입을 확인합니다. 설명은 도구 선택을 돕고, 타입은 입력 스키마가 됩니다.

| 도구 | 용도 |
|---|---|
| `search_projects` | 프로젝트명을 검색해 원본 ID 찾기 |
| `list_tasks` | 조건에 맞는 업무와 근거 조회 |
| `get_project_metrics` | 페이지 제한에 영향받지 않는 전체 범위 집계 |

도구 결과에는 데이터 출처, 조회 시각, 기준일, 조회 범위가 있습니다. 업무 목록에는 조건, 전체 건수, 반환 건수, `partial`, `next_offset`이 있습니다. 집계에는 계산 기준과 `source_refs`가 있습니다.

`sample://...`는 가상 데이터의 근거 식별자입니다. 실제 웹 링크가 아닙니다. 운영 연결 때 검증된 업무 상세 링크로 바꿉니다.

서버에서 `print()`를 추가하지 마세요. stdio의 stdout은 MCP 메시지를 전달하므로 일반 출력이 섞이면 통신이 깨집니다. 로그는 stderr를 사용합니다.

## 3교시 — 호출 과정을 관찰하기 (20분)

```powershell
.\.venv\Scripts\python.exe client.py
.\.venv\Scripts\python.exe client.py --viewer all_reader
```

첫 실행에서는 도구 발견 → 지연 업무 조회 → 집계 조회 → 템플릿 답변 → ICT 권한 거절이 순서대로 나옵니다. `all_reader`에서는 마지막 ICT 조회가 성공합니다. 예제 질문은 두 실행 모두 FA 질문입니다.

`client.py`의 `offline()`에서 `list_tasks` 인자를 `{"department": "fa", "limit": 2}`로 바꾸고 부분 결과를 관찰해 보세요. 전체 목록은 4건(취소 포함)이지만 첫 페이지는 2건입니다. 이후 `offset=next_offset`으로 다음 페이지를 조회합니다. 이 경우 기존 답변 템플릿은 지연 전용이므로 목록·제목도 함께 수정하는 연습입니다.

실습 역할은 서버 시작 시 고정되며 도구 인자에 사용자 이메일을 넣지 않습니다. 다만 `--viewer`는 **권한 필터 학습을 위한 역할 모의 설정**입니다. OS 사용자가 자유롭게 바꿀 수 있으므로 실제 로그인·보안 경계를 구현한 것은 아닙니다. `readOnlyHint` 역시 설명용 힌트이며 권한 검증을 대신하지 않습니다.

## 4교시 — 선택적으로 실제 AI 연결하기 (30분)

이 단계에서만 질문과 가상 도구 결과가 OpenAI API로 전송되고 API 비용이 발생합니다. 모델은 본인 계정에서 Responses API와 함수 호출을 지원하는 모델 ID를 지정합니다. 앱의 `.env.local`을 읽지 않습니다.

키를 명령 기록에 직접 적지 않고 입력하는 PowerShell 예시:

```powershell
$studyKey = Read-Host "OpenAI API key" -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $studyKey).Password
$env:OPENAI_MODEL = Read-Host "사용 가능한 모델 ID"
.\.venv\Scripts\python.exe client.py --ai --question "FA 검사라인의 지연 업무와 완료율을 알려줘"
Remove-Item Env:OPENAI_API_KEY
```

실제 연결 흐름:

1. MCP에서 발견한 입력 스키마를 OpenAI 함수 도구 정의로 변환합니다.
2. 모델이 함수 이름과 조회 인자를 반환합니다.
3. Python 호스트가 해당 요청을 실제 MCP `call_tool`로 전달합니다.
4. 반환 결과를 `function_call_output`으로 모델에 전달합니다.
5. 필요한 도구 호출을 반복하고, 모델이 근거를 포함한 답변을 생성합니다.

**이번 방식은 Python 호스트가 중개하는 로컬 MCP 방식입니다.** OpenAI의 원격 `type: "mcp"` 도구를 사용하는 예제는 아닙니다. 로컬 stdio 서버를 OpenAI가 직접 방문할 수 없으므로 호스트가 중개합니다. 원격 MCP는 다음 스터디에서 HTTP 배포와 인증을 추가하며 다룹니다.

API 키는 호스트에서만 사용하고 MCP 서버 자식 프로세스에는 전달하지 않습니다. SDK 재시도는 껐고 요청당 40초, 최대 6회 모델 호출·회당 8개 도구 호출로 실습 상한을 뒀습니다. 오류와 데이터 없음은 구분하여 전달합니다.

AI 단계는 키 없이 만들었으며 실제 유료 API 호출은 실행하지 않았습니다. 계정 모델 지원 및 최종 자연어 답변 품질은 이 단계에서 직접 검증합니다.

## 확인 테스트

```powershell
.\.venv\Scripts\python.exe -m unittest -v test_study.py
```

정확한 통계, 숨김 부모의 하위 항목 제외, 사업부 권한, 중복 제거, 페이지 처리, 날짜 오류·빈 결과, 빈 집계, 실제 MCP 초기화·도구 발견·조회·오류 전달을 확인합니다.

## 이번 실습 이후

| 현재 학습용 구현 | 후속 운영 연결 작업 |
|---|---|
| JSON 가상 데이터 | Firestore 읽기 전용 어댑터와 실제 스키마 정규화 |
| 시작 시 고정한 모의 사용자 범위 | 검증한 사용자 ID와 서버 측 권한 정책 |
| 단순 원본 ID 중복 제거 | 전략기획/ICT 연결·원본 ID 규칙 이식 |
| 로컬 stdio | 인증된 Streamable HTTP 서버 |
| sample 근거 ID | 실제 프로젝트·업무 상세 링크 |
| 가상 고정 날짜 | 한국 시간, 조회 기준일·날짜 형식 정규화 |
| 단일 질문 실행 | 대화 문맥, 권한별 캐시, 호출 기록·평가 |

업무 수정 도구와 문서 검색은 이번 범위에 포함하지 않습니다. 우선 정확한 조회와 근거 답변을 이해하고, 후속으로 프로젝트 검색→업무 상세 조회, 문서 검색 결합, 인증된 원격 MCP 순서로 확장합니다.

## 공식 참고자료

- [사용한 MCP Python SDK v1.27.1](https://github.com/modelcontextprotocol/python-sdk/tree/v1.27.1)
- [MCP Python SDK 최신 버전과 v1/v2 안내](https://github.com/modelcontextprotocol/python-sdk)
- [MCP 서버 개념 및 stdio 로그 주의점](https://modelcontextprotocol.io/docs/develop/build-server)
- [OpenAI 함수 호출 흐름](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI 원격 MCP 연결 — 후속 학습](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
