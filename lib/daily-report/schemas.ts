import { z } from "zod";

export const DailyReportSection = z.enum([
  "immediate",
  "today",
  "pending",
  "atRisk",
  "reference",
]);
export type DailyReportSection = z.infer<typeof DailyReportSection>;

export const DailyReportSource = z.enum([
  "wbs",
  "email",
  "kakao",
  "orchestrator",
]);
export type DailyReportSource = z.infer<typeof DailyReportSource>;

export const AgentRunStatus = z.enum([
  "idle",
  "running",
  "succeeded",
  "failed",
  "partial",
]);
export type AgentRunStatus = z.infer<typeof AgentRunStatus>;

export const DailyReportPriority = z.enum(["high", "medium", "low"]);
export type DailyReportPriority = z.infer<typeof DailyReportPriority>;

// OpenAI Structured Outputs 는 모든 필드 required + nullable 만 허용한다.
// 따라서 .optional() / .default() 는 사용하지 않고, 빈 값은 "" 또는 null 로 표현.
export const DailyReportItem = z.object({
  id: z.string().min(1),
  section: DailyReportSection,
  source: DailyReportSource,
  title: z.string().min(1),
  summary: z.string(),
  priority: DailyReportPriority,
  suggestedAction: z.string(),
  dueDate: z.string().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  taskId: z.string().nullable(),
  emailMessageId: z.string().nullable(),
  kakaoMessageRef: z.string().nullable(),
});
export type DailyReportItem = z.infer<typeof DailyReportItem>;

export const SpecialistOutput = z.object({
  items: z.array(DailyReportItem),
});
export type SpecialistOutput = z.infer<typeof SpecialistOutput>;

export const DailyReportSectionStats = z.object({
  immediate: z.number().int().nonnegative(),
  today: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  atRisk: z.number().int().nonnegative(),
  reference: z.number().int().nonnegative(),
});
export type DailyReportSectionStats = z.infer<typeof DailyReportSectionStats>;

export const DailyReportError = z.object({
  source: DailyReportSource,
  message: z.string(),
});
export type DailyReportError = z.infer<typeof DailyReportError>;

export const DailyReportRun = z.object({
  id: z.string(),
  requestedAt: z.string(),
  requestedBy: z.string(),
  status: AgentRunStatus,
  items: z.array(DailyReportItem),
  errors: z.array(DailyReportError).default([]),
  sectionStats: DailyReportSectionStats,
});
export type DailyReportRun = z.infer<typeof DailyReportRun>;

export const StreamEventPhase = z.enum([
  "wbs_loaded",
  "email_fetched",
  "kakao_parsed",
  "agent_started",
  "agent_done",
  "agent_failed",
  "orchestrator_done",
  "done",
  "error",
]);
export type StreamEventPhase = z.infer<typeof StreamEventPhase>;

export const StreamEvent = z.object({
  phase: StreamEventPhase,
  source: DailyReportSource.optional(),
  message: z.string().optional(),
  items: z.array(DailyReportItem).optional(),
  run: DailyReportRun.optional(),
  stats: z
    .object({
      durationMs: z.number().optional(),
      count: z.number().optional(),
    })
    .optional(),
});
export type StreamEvent = z.infer<typeof StreamEvent>;

export const emptySectionStats = (): DailyReportSectionStats => ({
  immediate: 0,
  today: 0,
  pending: 0,
  atRisk: 0,
  reference: 0,
});

export const computeSectionStats = (
  items: DailyReportItem[],
): DailyReportSectionStats => {
  const stats = emptySectionStats();
  for (const item of items) {
    stats[item.section] += 1;
  }
  return stats;
};
