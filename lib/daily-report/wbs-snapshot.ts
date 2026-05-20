import type { Project, Task } from "@/lib/data";

import { personMatchesAliases } from "./server-aliases";

export interface SlimTask {
  id: string;
  title: string;
  department: string;
  person: string;
  status: string;
  category: string;
  startDate: string;
  endDate: string;
  manDays: number;
}

export interface SlimProject {
  id: string;
  name: string;
  type: string;
  pmEmail: string;
  tasks: SlimTask[];
}

export interface SlimSnapshot {
  todayIso: string;
  strategy: SlimProject[];
  fa: SlimProject[];
  ict: SlimProject[];
  totals: {
    projects: number;
    tasks: number;
    truncated: number;
    aliasFiltered: boolean;
    aliases: string[];
    windowDays: number;
    sinceIso: string | null;
  };
}

export interface BuildSlimSnapshotOptions {
  aliases?: string[];
  maxTotalTasks?: number;
  windowDays?: number;
}

const flattenTasks = (tasks: Task[] | undefined): Task[] => {
  if (!tasks || tasks.length === 0) return [];
  return tasks.flatMap((t) => [t, ...flattenTasks(t.subTasks)]);
};

const addDaysIso = (iso: string, days: number): string => {
  if (!iso) return iso;
  const base = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return iso;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const isRelevantTask = (
  task: Task,
  todayIso: string,
  aliases: string[],
  windowDays: number,
): boolean => {
  if (task.isHidden) return false;
  // 사용자 alias 가 주어졌으면 그 사용자가 담당자(person)로 들어간 태스크만 통과
  if (aliases.length > 0 && !personMatchesAliases(task.person, aliases)) {
    return false;
  }
  if (!isTaskInWindow(task, todayIso, windowDays)) return false;

  const startDate = normalizeDateToIso(task.startDate, todayIso);
  const status = task.status;
  if (status === "완료") {
    return true;
  }
  if (status === "예정") {
    // 전체 기간 조회일 때만 먼 미래 예정 업무를 제한한다.
    return !startDate || windowDays > 0 || startDate <= addDaysIso(todayIso, 60);
  }
  // 진행 / 보류 / 미정 → 모두 유지
  return true;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// "04월 10일" / "2026년 4월 10일" / "4월 10일" 등 한글 단축 표기 → ISO 정규화
const KOREAN_DATE_RE = /^\s*(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*$/;

/** Firestore 에 저장된 다양한 날짜 포맷을 "YYYY-MM-DD" 로 정규화. 실패 시 "" */
const normalizeDateToIso = (
  raw: string | undefined | null,
  todayIso: string,
): string => {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  if (ISO_DATE_RE.test(trimmed)) return trimmed;
  const km = trimmed.match(KOREAN_DATE_RE);
  if (km) {
    const year = km[1] ?? todayIso.slice(0, 4);
    const mm = km[2].padStart(2, "0");
    const dd = km[3].padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isFinite(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return "";
};

const normalizeWindowDays = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 30;
  const rounded = Math.floor(parsed);
  if (rounded <= 0) return 0;
  return Math.min(365, rounded);
};

const getWindowSinceIso = (todayIso: string, windowDays: number): string | null =>
  windowDays > 0 ? addDaysIso(todayIso, -windowDays + 1) : null;

const isTaskInWindow = (
  task: Task,
  todayIso: string,
  windowDays: number,
): boolean => {
  const sinceIso = getWindowSinceIso(todayIso, windowDays);
  if (!sinceIso) return true;

  const startDate = normalizeDateToIso(task.startDate, todayIso);
  const endDate = normalizeDateToIso(task.endDate, todayIso);
  if (startDate && endDate) {
    const from = startDate <= endDate ? startDate : endDate;
    const to = startDate <= endDate ? endDate : startDate;
    return to >= sinceIso && from <= todayIso;
  }

  const singleDate = endDate || startDate;
  return Boolean(singleDate && singleDate >= sinceIso && singleDate <= todayIso);
};

const toSlimTask = (task: Task, todayIso: string): SlimTask => ({
  id: task.id,
  title: task.task ?? "",
  department: task.department ?? "",
  person: task.person ?? "",
  status: task.status ?? "미정",
  category: task.category ?? "일반",
  startDate: normalizeDateToIso(task.startDate, todayIso),
  endDate: normalizeDateToIso(task.endDate, todayIso),
  manDays: typeof task.manDays === "number" ? task.manDays : 0,
});

const toSlimProject = (
  project: Project,
  todayIso: string,
  aliases: string[],
  windowDays: number,
): SlimProject | null => {
  if (project.isHidden) return null;
  const flat = flattenTasks(project.tasks);
  const filtered = flat.filter((t) => isRelevantTask(t, todayIso, aliases, windowDays));
  if (filtered.length === 0) return null;
  return {
    id: project.id,
    name: project.name,
    type: project.type,
    pmEmail: project.pmEmail ?? "",
    tasks: filtered.map((t) => toSlimTask(t, todayIso)),
  };
};

const countTasks = (list: SlimProject[]): number =>
  list.reduce((acc, p) => acc + p.tasks.length, 0);

export function buildSlimSnapshot(
  todayIso: string,
  strategy: Project[],
  fa: Project[],
  ict: Project[],
  options: BuildSlimSnapshotOptions = {},
): SlimSnapshot {
  const aliases = (options.aliases ?? []).map((a) => a.trim()).filter(Boolean);
  const maxTotalTasks = options.maxTotalTasks ?? 400;
  const windowDays = normalizeWindowDays(options.windowDays ?? 30);
  const sinceIso = getWindowSinceIso(todayIso, windowDays);
  const slim = (list: Project[]): SlimProject[] =>
    list
      .map((p) => toSlimProject(p, todayIso, aliases, windowDays))
      .filter((p): p is SlimProject => p !== null);

  const snapshot: SlimSnapshot = {
    todayIso,
    strategy: slim(strategy),
    fa: slim(fa),
    ict: slim(ict),
    totals: {
      projects: 0,
      tasks: 0,
      truncated: 0,
      aliasFiltered: aliases.length > 0,
      aliases,
      windowDays,
      sinceIso,
    },
  };

  // 전체 task가 한도 초과 시 round-robin으로 마지막 task부터 제거
  let truncated = 0;
  const all = [snapshot.strategy, snapshot.fa, snapshot.ict];
  while (
    countTasks(snapshot.strategy) +
      countTasks(snapshot.fa) +
      countTasks(snapshot.ict) >
    maxTotalTasks
  ) {
    let removed = false;
    for (const dept of all) {
      // 가장 task가 많은 프로젝트에서 한 개 제거
      const target = dept
        .filter((p) => p.tasks.length > 0)
        .sort((a, b) => b.tasks.length - a.tasks.length)[0];
      if (target) {
        target.tasks.pop();
        truncated += 1;
        removed = true;
      }
      if (
        countTasks(snapshot.strategy) +
          countTasks(snapshot.fa) +
          countTasks(snapshot.ict) <=
        maxTotalTasks
      ) {
        break;
      }
    }
    if (!removed) break;
  }

  // 빈 프로젝트 정리
  snapshot.strategy = snapshot.strategy.filter((p) => p.tasks.length > 0);
  snapshot.fa = snapshot.fa.filter((p) => p.tasks.length > 0);
  snapshot.ict = snapshot.ict.filter((p) => p.tasks.length > 0);

  snapshot.totals = {
    projects:
      snapshot.strategy.length + snapshot.fa.length + snapshot.ict.length,
    tasks:
      countTasks(snapshot.strategy) +
      countTasks(snapshot.fa) +
      countTasks(snapshot.ict),
    truncated,
    aliasFiltered: aliases.length > 0,
    aliases,
    windowDays,
    sinceIso,
  };

  return snapshot;
}
