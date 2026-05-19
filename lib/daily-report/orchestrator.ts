import { callStructured, orchestratorModel } from "./openai-client";
import {
  SpecialistOutput,
  type DailyReportItem as DailyReportItemType,
} from "./schemas";

export interface OrchestratorInput {
  todayIso: string;
  ownerEmail: string;
  candidates: DailyReportItemType[];
  apiKey?: string;
}

const SYSTEM_PROMPT = `당신은 Daily Report 오케스트레이터다. WBS/Email/Kakao 에이전트가 만든 후보 DailyReportItem 배열을 받아 최종 5섹션 보고서로 정리한다.

- 입력에 없는 새 아이템을 만들지 않는다.
- 같은 의미의 중복(동일 task, 동일 messageId, 동일 회의/요청)은 가장 정보량 많은 1건만 남기고 summary에 다중 출처를 한 줄로 표기한다.
- source 필드는 가장 영향력 있는 출처로 설정한다. 합쳐진 경우 summary에 "(메일+카카오)" 같은 표기를 덧붙인다.
- 각 섹션 내 정렬: priority high → medium → low, 그 다음 dueDate 빠른 순(없으면 마지막).
- 섹션별 최대 개수: immediate ≤ 7, today ≤ 10, atRisk ≤ 5, pending ≤ 8, reference ≤ 5.
- title은 70자 이내, summary는 한 줄로 다듬는다.
- suggestedAction은 짧고 실행 가능한 한 줄.
- id는 입력 id를 그대로 유지하되, 합치는 경우 두 id를 "+"로 결합("kakao-3+email-12").`;

export async function runOrchestrator(
  input: OrchestratorInput,
): Promise<DailyReportItemType[]> {
  if (input.candidates.length === 0) return [];
  const result = await callStructured({
    model: orchestratorModel(),
    schemaName: "orchestrator_output",
    schema: SpecialistOutput,
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      todayIso: input.todayIso,
      ownerEmail: input.ownerEmail,
      candidates: input.candidates,
    }),
    apiKey: input.apiKey,
  });

  const seen = new Set<string>();
  const dedup: DailyReportItemType[] = [];
  for (const item of result.items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    dedup.push(item);
  }
  return dedup;
}
