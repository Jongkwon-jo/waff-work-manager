import type { Project, Task } from "./data"

/** Display-only dates; never written back to the task. */
export type GanttSummaryRange = { startDate: Date; endDate: Date }

type CalendarDay = { year: number; month: number; day: number }

function parseDate(value: string, defaultYear: number): Date | undefined {
  const match = value.trim().match(/^(?:(\d{4})(?:[-/.]|년)\s*)?(\d{1,2})(?:[-/.]|월)\s*(\d{1,2})(?:일|\.)?$/)
  if (!match) return undefined
  const year = match[1] ? Number(match[1]) : defaultYear
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : undefined
}

function mergeRanges(
  first: GanttSummaryRange | undefined,
  second: GanttSummaryRange | undefined,
): GanttSummaryRange | undefined {
  if (!first) return second
  if (!second) return first
  return {
    startDate: first.startDate < second.startDate ? first.startDate : second.startDate,
    endDate: first.endDate > second.endDate ? first.endDate : second.endDate,
  }
}

function collectGanttRanges(
  tasks: readonly Task[],
  defaultYear: number,
  hiddenTaskIds: ReadonlySet<string>,
) {
  const ranges = new Map<string, GanttSummaryRange>()

  const visit = (task: Task): GanttSummaryRange | undefined => {
    if (task.isHidden || hiddenTaskIds.has(task.id)) return undefined

    let descendants: GanttSummaryRange | undefined
    for (const child of task.subTasks || []) {
      descendants = mergeRanges(descendants, visit(child))
    }
    if (descendants) ranges.set(task.id, descendants)

    // Ineligible intermediate tasks still contribute their eligible descendants.
    if (task.status !== "진행" && task.status !== "예정" && task.status !== "미정") return descendants
    const startDate = parseDate(task.startDate || "", defaultYear)
    const endDate = parseDate(task.endDate || "", defaultYear)
    if (!startDate || !endDate || startDate > endDate) return descendants
    return mergeRanges(descendants, { startDate, endDate })
  }

  let treeRange: GanttSummaryRange | undefined
  for (const task of tasks) treeRange = mergeRanges(treeRange, visit(task))
  return { ranges, treeRange }
}

/** Aggregate the original tree, independently of row filtering and collapse state. */
export function buildGanttSummaryRanges(
  tasks: readonly Task[],
  defaultYear: number,
  hiddenTaskIds: ReadonlySet<string> = new Set(),
): Map<string, GanttSummaryRange> {
  return collectGanttRanges(tasks, defaultYear, hiddenTaskIds).ranges
}

/** Project summaries include eligible top-level tasks as well as their descendants. */
export function buildGanttProjectSummaryRanges(
  projects: readonly Pick<Project, "id" | "tasks">[],
  defaultYear: number,
  hiddenTaskIds: ReadonlySet<string> = new Set(),
): Map<string, GanttSummaryRange> {
  const ranges = new Map<string, GanttSummaryRange>()
  for (const project of projects) {
    const { treeRange } = collectGanttRanges(project.tasks, defaultYear, hiddenTaskIds)
    if (treeRange) ranges.set(project.id, treeRange)
  }
  return ranges
}

/** Clip a summary to the actual calendar, retaining full dates for its tooltip. */
export function getGanttSummaryDaySpan(
  range: GanttSummaryRange | undefined,
  days: readonly CalendarDay[],
): { startIndex: number; endIndex: number } | undefined {
  if (!range) return undefined
  let startIndex = -1
  let endIndex = -1
  days.forEach(({ year, month, day }, index) => {
    const date = new Date(year, month, day)
    if (date >= range.startDate && date <= range.endDate) {
      if (startIndex === -1) startIndex = index
      endIndex = index
    }
  })
  return startIndex === -1 ? undefined : { startIndex, endIndex }
}
