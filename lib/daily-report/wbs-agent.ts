import { callStructured, defaultDailyReportModel } from "./openai-client";
import {
  SpecialistOutput,
  type DailyReportItem,
  type SpecialistOutput as SpecialistOutputType,
} from "./schemas";
import type { SlimProject, SlimSnapshot, SlimTask } from "./wbs-snapshot";

export interface WbsAgentInput {
  todayIso: string;
  ownerEmail: string;
  snapshot: SlimSnapshot;
  apiKey?: string;
}

const SYSTEM_PROMPT = `당신은 WorkHub의 WBS 분석가다.

중요: 입력 snapshot 은 이미 ownerEmail 사용자가 담당자(Task.person 필드 매칭)로 배정된 태스크만 포함하도록 사전 필터링되어 있다.
결과는 항상 "본인 담당 업무" 관점에서 작성한다.
snapshot.totals.aliasFiltered = true 면 alias 매칭이 적용된 상태이며, totals.aliases 는 매칭에 사용된 사용자의 별칭 후보다.
snapshot.totals.windowDays > 0 이면 WBS 데이터는 todayIso 기준 최근 windowDays일(sinceIso 포함) 범위와 겹치는 태스크만 포함한다.
snapshot 의 모든 날짜 필드(todayIso, startDate, endDate)는 이미 ISO 8601 "YYYY-MM-DD" 포맷으로 정규화돼 있다. 별도 파싱/변환 없이 문자열 비교로 시점을 판단해도 정확하다.

입력 JSON 구조:
{
  todayIso: "YYYY-MM-DD",
  ownerEmail: string,
  snapshot: {
    todayIso, strategy[], fa[], ict[],
    totals: { projects, tasks, truncated, aliasFiltered, aliases, windowDays, sinceIso }
  }
}
각 부서 배열(strategy/fa/ict)의 원소는 SlimProject { id, name, type, pmEmail, tasks: SlimTask[] }.
SlimTask: { id, title, department, person, status, category, startDate, endDate, manDays }
status: "완료" | "진행" | "예정" | "취소" | "미정"
category: "일반" | "중요" | "정기" | "상시"

섹션 분류 — 위에서부터 먼저 매칭되는 규칙을 적용하고, 한 번 분류된 태스크는 이후 규칙과 비교하지 않는다:
1. **status 가 "완료" 가 아니면서 endDate < todayIso → section "atRisk", priority "high"** (지연 위험 — 마감 초과). 가장 우선되는 규칙이며 어떤 경우에도 누락 금지.
2. status 가 "완료" → 다른 부서/팀이 참고할 만한 결과물이면 section "reference", priority "low" (전체 최대 5개). 그 외 완료 태스크는 결과에 포함하지 않는다.
3. status 가 "취소" → section "pending", priority "medium".
4. endDate == todayIso 또는 startDate == todayIso → section "today", priority "high".
5. endDate 가 todayIso 보다 1~3일 후이고 status 가 "진행" 또는 "예정" → section "immediate", priority "high".
6. 그 외 진행/예정 항목은 임팩트 큰 것만 골라 가장 가까운 섹션(today/immediate/pending)에 배치하거나 결과에서 제외한다.

출력 규칙:
- 모든 item.source 는 반드시 "wbs".
- title: "[프로젝트명] 태스크 title".
- summary: 한 줄로 핵심 맥락(상태/담당자/마감 등). atRisk 항목은 며칠 지났는지 명시.
- suggestedAction: 짧은 실행 권고.
- projectId/projectName/taskId 는 입력에서 가져와 그대로 채운다(임의 생성 금지). 동일 SlimTask 는 결과에 한 번만 등장.
- dueDate 는 SlimTask.endDate 그대로(YYYY-MM-DD). 없으면 null.
- 보존 우선순위: atRisk > today/immediate > pending > reference. 압축이나 30개 한도 적용 시에도 atRisk 항목은 절대 누락하지 말 것.
- 같은 프로젝트의 같은 섹션에 다수 태스크가 있으면 가장 중요한 1~2개만 남기고 압축. 단 atRisk 는 모두 유지.
- 최종 item 수는 30개 이하.
- snapshot.totals.truncated > 0 이면 일부 데이터가 잘린 상태임을 인지하고 임팩트 큰 항목 위주로 선별.`;

const parseIsoDay = (iso: string): number | null => {
  if (!iso) return null;
  const time = new Date(`${iso}T00:00:00Z`).getTime();
  return Number.isFinite(time) ? time : null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const buildTaskIndex = (
  snapshot: SlimSnapshot,
): Map<string, { task: SlimTask; project: SlimProject }> => {
  const index = new Map<string, { task: SlimTask; project: SlimProject }>();
  for (const list of [snapshot.strategy, snapshot.fa, snapshot.ict]) {
    for (const project of list) {
      for (const task of project.tasks) {
        if (task.id) index.set(task.id, { task, project });
      }
    }
  }
  return index;
};

/**
 * 단일 규칙: endDate < todayIso 인 미완료 태스크는 항상 "atRisk" 로 강제.
 * - taskId 로 원본 SlimTask 조회 → status/endDate 확인
 * - 매칭 실패 시 item.dueDate 만으로 보정
 * - 그 외 분류는 LLM 판단을 그대로 유지
 */
const forceOverdueAtRisk = (
  items: DailyReportItem[],
  snapshot: SlimSnapshot,
  todayIso: string,
): DailyReportItem[] => {
  const today = parseIsoDay(todayIso);
  if (today === null) return items;
  const index = buildTaskIndex(snapshot);

  return items.map((item) => {
    const entry = item.taskId ? index.get(item.taskId) : undefined;
    if (entry?.task.status === "완료") return item;

    const endIso = entry?.task.endDate || item.dueDate || "";
    const end = parseIsoDay(endIso);
    if (end === null || end >= today) return item;

    return {
      ...item,
      section: "atRisk" as const,
      priority: "high" as const,
      dueDate: endIso || item.dueDate || null,
    };
  });
};

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * LLM 이 결과에서 빠뜨린 "마감 초과" 태스크를 합성 atRisk item 으로 직접 주입.
 * 최대 INJECT_OVERDUE_LIMIT 개 까지, 지연 일수 큰 순.
 */
const INJECT_OVERDUE_LIMIT = 20;

const injectMissingOverdue = (
  items: DailyReportItem[],
  snapshot: SlimSnapshot,
  todayIso: string,
): DailyReportItem[] => {
  const today = parseIsoDay(todayIso);
  if (today === null) return items;

  const covered = new Set<string>();
  for (const it of items) if (it.taskId) covered.add(it.taskId);

  const overdue: { task: SlimTask; project: SlimProject; daysLate: number }[] = [];
  for (const list of [snapshot.strategy, snapshot.fa, snapshot.ict]) {
    for (const project of list) {
      for (const task of project.tasks) {
        if (!task.id || covered.has(task.id)) continue;
        if (task.status === "완료") continue;
        const end = parseIsoDay(task.endDate);
        if (end === null || end >= today) continue;
        const daysLate = Math.round((today - end) / DAY_MS);
        overdue.push({ task, project, daysLate });
      }
    }
  }

  overdue.sort((a, b) => b.daysLate - a.daysLate);

  const injected: DailyReportItem[] = overdue
    .slice(0, INJECT_OVERDUE_LIMIT)
    .map(({ task, project, daysLate }) => ({
      id: `wbs-overdue-${task.id}`,
      section: "atRisk" as const,
      source: "wbs" as const,
      title: truncate(`[${project.name}] ${task.title || task.id}`, 70),
      summary: `마감 ${task.endDate} · ${daysLate}일 경과 · 상태 ${task.status}`,
      priority: "high" as const,
      suggestedAction: "마감 재조정 또는 진행 상태 업데이트",
      dueDate: task.endDate || null,
      projectId: project.id,
      projectName: project.name,
      taskId: task.id,
      emailMessageId: null,
      kakaoMessageRef: null,
    }));

  return injected.length > 0 ? [...items, ...injected] : items;
};

export async function runWbsAgent(
  input: WbsAgentInput,
): Promise<SpecialistOutputType> {
  const raw = await callStructured({
    model: defaultDailyReportModel(),
    schemaName: "wbs_agent_output",
    schema: SpecialistOutput,
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      todayIso: input.todayIso,
      ownerEmail: input.ownerEmail,
      snapshot: input.snapshot,
    }),
    apiKey: input.apiKey,
  });

  const forced = forceOverdueAtRisk(raw.items, input.snapshot, input.todayIso);
  const withInjected = injectMissingOverdue(
    forced,
    input.snapshot,
    input.todayIso,
  );
  return { items: withInjected };
}
