import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { normalizeEmail } from "@/lib/page-access";

import {
  computeSectionStats,
  DailyReportItem,
  DailyReportRun,
  type AgentRunStatus,
  type DailyReportError,
  type DailyReportItem as DailyReportItemType,
  type DailyReportRun as DailyReportRunType,
  type DailyReportSource,
} from "./schemas";

const RUNS = "dailyReportRuns";

// 최근 24시간 이내에 사용자의 active run이 있으면 그걸 재사용한다.
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

const newRunId = () =>
  `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const blankRun = (id: string, ownerEmail: string): DailyReportRunType => ({
  id,
  requestedAt: new Date().toISOString(),
  requestedBy: ownerEmail,
  status: "idle",
  items: [],
  errors: [],
  sectionStats: computeSectionStats([]),
});

// 구 스키마(optional) 시절 저장된 문서는 일부 필드가 누락돼 있을 수 있다.
// 새 스키마(nullable required)와 호환되도록 누락 필드를 null 로 채워준다.
const normalizeItemRaw = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    ...obj,
    summary: typeof obj.summary === "string" ? obj.summary : "",
    suggestedAction:
      typeof obj.suggestedAction === "string" ? obj.suggestedAction : "",
    priority: obj.priority ?? "medium",
    dueDate: obj.dueDate ?? null,
    projectId: obj.projectId ?? null,
    projectName: obj.projectName ?? null,
    taskId: obj.taskId ?? null,
    emailMessageId: obj.emailMessageId ?? null,
    kakaoMessageRef: obj.kakaoMessageRef ?? null,
  };
};

const normalizeRunRaw = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  const items = Array.isArray(obj.items)
    ? obj.items.map(normalizeItemRaw)
    : obj.items;
  return { ...obj, items };
};

/** Firestore 문서를 Zod로 검증해 안전한 DailyReportRun 으로 반환. 실패 시 null. */
function parseRunDoc(raw: unknown): DailyReportRunType | null {
  const parsed = DailyReportRun.safeParse(normalizeRunRaw(raw));
  return parsed.success ? parsed.data : null;
}

/**
 * 사용자의 최신 활성 run 을 찾는다.
 * - ACTIVE_WINDOW_MS 이내에 갱신된 run 중 가장 최근 1건.
 * - 없으면 새 빈 run 을 만들어 저장 후 반환.
 */
export async function getOrCreateActiveRunId(
  ownerEmail: string,
): Promise<DailyReportRunType> {
  const normalized = normalizeEmail(ownerEmail);
  if (!normalized) throw new Error("ownerEmail 이 필요합니다.");

  const q = query(
    collection(db, RUNS),
    where("requestedBy", "==", normalized),
    orderBy("updatedAt", "desc"),
    fsLimit(5),
  );

  try {
    const snap = await getDocs(q);
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown> & {
        updatedAt?: { toMillis?: () => number };
      };
      const updatedMs = data.updatedAt?.toMillis?.() ?? 0;
      if (updatedMs && Date.now() - updatedMs > ACTIVE_WINDOW_MS) continue;
      const parsed = parseRunDoc({ ...data, id: docSnap.id });
      if (parsed) return parsed;
    }
  } catch (err) {
    console.error("getOrCreateActiveRunId query failed", err);
  }

  // active run 없음 → 새 run 생성
  const fresh = blankRun(newRunId(), normalized);
  await setDoc(doc(db, RUNS, fresh.id), {
    ...fresh,
    updatedAt: serverTimestamp(),
  });
  return fresh;
}

/** 특정 runId 의 문서를 그대로 조회. 없으면 null. */
export async function getRun(runId: string): Promise<DailyReportRunType | null> {
  if (!runId) return null;
  try {
    const snap = await getDoc(doc(db, RUNS, runId));
    if (!snap.exists()) return null;
    return parseRunDoc({ ...snap.data(), id: snap.id });
  } catch (err) {
    console.error(`getRun(${runId}) failed`, err);
    return null;
  }
}

export interface MergeIntoRunInput {
  runId: string;
  ownerEmail: string;
  /** source 가 지정되면 그 source 의 items 만 교체한다. 비우면 items 전체를 교체. */
  source?: DailyReportSource;
  items: DailyReportItemType[];
  /** 누적할 에러 (있으면 추가). */
  appendErrors?: DailyReportError[];
  /** run.status 를 명시적으로 갱신. */
  status?: AgentRunStatus;
}

/**
 * dailyReportRuns/{runId} 의 일부를 업데이트한다.
 * - source 가 주어지면 기존 items 에서 그 source 만 빼고 새 items 를 append.
 * - source 없으면 items 전체 교체.
 * - errors 는 append, status 는 명시 시 덮어쓰기.
 */
export async function mergeIntoRun(
  input: MergeIntoRunInput,
): Promise<DailyReportRunType> {
  const normalized = normalizeEmail(input.ownerEmail);
  if (!normalized) throw new Error("ownerEmail 이 필요합니다.");
  if (!input.runId) throw new Error("runId 가 필요합니다.");

  const existing = (await getRun(input.runId)) ?? blankRun(
    input.runId,
    normalized,
  );

  const mergedItems = input.source
    ? [
        ...existing.items.filter((it) => it.source !== input.source),
        ...input.items,
      ]
    : input.items;

  // 중복 id 안전망
  const seen = new Set<string>();
  const dedup: DailyReportItemType[] = [];
  for (const it of mergedItems) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    dedup.push(it);
  }

  const errors = input.appendErrors
    ? [...existing.errors, ...input.appendErrors]
    : existing.errors;

  const status: AgentRunStatus =
    input.status ??
    (errors.length === 0 ? "succeeded" : dedup.length > 0 ? "partial" : "failed");

  const next: DailyReportRunType = {
    id: input.runId,
    requestedAt: existing.requestedAt,
    requestedBy: existing.requestedBy || normalized,
    status,
    items: dedup,
    errors,
    sectionStats: computeSectionStats(dedup),
  };

  await setDoc(
    doc(db, RUNS, input.runId),
    {
      ...next,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return next;
}

/** Zod 로 한 번 더 검증한 안전한 candidates 만 반환. */
export function sanitizeCandidates(raw: unknown): DailyReportItemType[] {
  if (!Array.isArray(raw)) return [];
  const out: DailyReportItemType[] = [];
  for (const entry of raw) {
    const parsed = DailyReportItem.safeParse(normalizeItemRaw(entry));
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
