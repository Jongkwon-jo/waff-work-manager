import { callStructured, defaultDailyReportModel } from "./openai-client";
import {
  SpecialistOutput,
  type SpecialistOutput as SpecialistOutputType,
} from "./schemas";
import type { SlimKakaoSnapshot } from "./kakao-slim";

export interface KakaoAgentInput {
  todayIso: string;
  ownerEmail: string;
  snapshot: SlimKakaoSnapshot;
  apiKey?: string;
}

const SYSTEM_PROMPT = `당신은 WorkHub 의 카카오톡 분석 에이전트다.

입력 JSON 구조:
{
  todayIso: "YYYY-MM-DD",
  ownerEmail: string,
  snapshot: {
    todayIso,
    selfName: string | null,
    participants: string[],
    messages: [
      {
        id: "kakao-N",
        timestamp: ISO,
        date: "YYYY-MM-DD",
        sender: string,
        role: "self" | "other",     // self = 사용자 본인의 발화
        content: string,             // 같은 화자 연속 메시지는 줄바꿈으로 결합됨
        attachments: string[]        // 같은 그룹에 포함된 파일명들
      }
    ],
    totals: { raw, afterWindow, afterNoise, kept, truncated, sinceIso, windowDays }
  }
}

중요:
- snapshot.messages 는 이미 (a) 윈도우(sinceIso ~ todayIso), (b) 노이즈(사진/이모티콘/송금/시스템) 제거, (c) 같은 화자 연속 그룹화가 끝난 상태다.
- selfName 이 있으면 그 화자가 사용자 본인이다. role 필드로도 식별 가능.
- attachments.length > 0 인 그룹은 파일 첨부 단서이므로 무시하지 말고 suggestedAction 또는 summary 에 반영한다.

DailyReportItem 생성 규칙:
- 모든 item.source 는 반드시 "kakao".
- kakaoMessageRef 필드에 messages[i].id (예: "kakao-12") 또는 timestamp+sender 조합을 채운다.
- role = "other" 가 self 에게 보낸 명시적 지시 / 요청 / 마감 언급 → section "today" 또는 "immediate", priority "high".
- role = "self" 가 한 약속 / 다음 행동 선언 ("내일 보고드릴게요", "오후에 검토하겠습니다") → section "today", priority "medium".
- 일정 / 회의 / 출장 / 마감일이 명시된 메시지 → section "immediate".
- self 가 보낸 질문(? 로 끝남)인데 후속 답변 없거나 짧은 호응만 있다면 → section "pending" (답변 대기).
- 갈등 / 일정 미준수 / 지연 시그널 → section "atRisk".
- 단순 안부 / 잡담 / 호응 ("넵", "네", "ㅇㅋ", "ㅎㅎ") 은 출력에서 제외.
- 동일 주제로 연속된 메시지는 가장 의미 있는 1건으로 묶고 summary 에 맥락을 정리.
- title 은 핵심 요청 / 결정 사항을 70자 이내로.
- summary 는 발신자(또는 self/other)와 맥락을 한 줄로. attachments 가 있으면 "(첨부: 파일명)" 형태로 명시.
- suggestedAction 은 짧은 실행 권고. attachments 가 있으면 "첨부 파일 검토" 류 권고 우선.
- dueDate 는 메시지에서 명확한 날짜가 추론되면 ISO (YYYY-MM-DD), 아니면 null.
- 전체 item 수는 15개 이하로 유지.
- 입력에 없는 새 아이템(추측만으로 생성)을 만들지 않는다.`;

export async function runKakaoAgent(
  input: KakaoAgentInput,
): Promise<SpecialistOutputType> {
  if (input.snapshot.messages.length === 0) {
    return { items: [] };
  }
  return callStructured({
    model: defaultDailyReportModel(),
    schemaName: "kakao_agent_output",
    schema: SpecialistOutput,
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      todayIso: input.todayIso,
      ownerEmail: input.ownerEmail,
      snapshot: input.snapshot,
    }),
    apiKey: input.apiKey,
  });
}
