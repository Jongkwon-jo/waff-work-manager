import type { EmailMessage } from "./imap-client";
import { callStructured, defaultDailyReportModel } from "./openai-client";
import { SpecialistOutput, type SpecialistOutput as SpecialistOutputType } from "./schemas";

export interface EmailAgentInput {
  todayIso: string;
  ownerEmail: string;
  emails: EmailMessage[];
  apiKey?: string;
}

const SYSTEM_PROMPT = `당신은 WorkHub의 메일 분류 에이전트다. IMAP으로 수집된 이메일 목록과 오늘 날짜를 받아 DailyReportItem을 만든다.

- 모든 item.source는 반드시 "email"로 설정한다.
- emailMessageId 필드에 EmailMessage.messageId(없으면 emailId)를 그대로 채운다.
- 긴급(즉시 회신 필요/오늘 마감 요청) → section "immediate", priority "high".
- 오늘 처리해야 하는 답신·확인 요청 → section "today", priority "medium".
- 회의/검토 대기 등 일정 후속 → section "pending", priority "medium".
- 미응답이 길어져 리스크가 된 메일 → section "atRisk", priority "high".
- 사내 공지/뉴스레터/참고 자료 → section "reference", priority "low".
- title은 메일 제목 그대로 또는 70자 이내로 압축.
- summary는 발신자와 핵심 요청을 한 줄로.
- suggestedAction은 "오늘 답신", "회의 일정 잡기" 등 짧은 권고.
- 스팸/홍보로 판단되는 메일은 출력에서 제외한다.
- 같은 발신자가 보낸 동일 주제의 메일은 최신 1건만 남긴다.
- 전체 item은 25개 이하.`;

export async function runEmailAgent(
  input: EmailAgentInput,
): Promise<SpecialistOutputType> {
  if (input.emails.length === 0) {
    return { items: [] };
  }
  return callStructured({
    model: defaultDailyReportModel(),
    schemaName: "email_agent_output",
    schema: SpecialistOutput,
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      todayIso: input.todayIso,
      ownerEmail: input.ownerEmail,
      emails: input.emails,
    }),
    apiKey: input.apiKey,
  });
}
