import type { Task } from "./data"
import { calculateManDaysBetweenDates } from "./man-days"

export type TaskDatePropagationUpdate = {
  id: string
  before: Task
  after: Task
  updates: Pick<Task, "endDate" | "manDays">
}

type DateCandidate = {
  value: string
  date: Date
}

function parseTaskDate(value?: string): Date | undefined {
  const text = value?.trim()
  if (!text) return undefined

  const ymd = text.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (ymd) {
    return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
  }

  const md = text.match(/^(\d{1,2})\D+(\d{1,2})/)
  if (md) {
    return new Date(new Date().getFullYear(), Number(md[1]) - 1, Number(md[2]))
  }

  return undefined
}

function latestEndDateInTasks(tasks: Task[]): DateCandidate | undefined {
  let latest: DateCandidate | undefined

  const visit = (task: Task) => {
    const date = parseTaskDate(task.endDate)
    if (date && (!latest || date.getTime() > latest.date.getTime())) {
      latest = { value: task.endDate, date }
    }
    ;(task.subTasks || []).forEach(visit)
  }

  tasks.forEach(visit)
  return latest
}

function buildTaskWithEndDate(task: Task, latestEnd: DateCandidate): Task {
  const startDate = parseTaskDate(task.startDate)
  const manDays = startDate
    ? calculateManDaysBetweenDates(startDate, latestEnd.date, false)
    : task.manDays

  return {
    ...task,
    endDate: latestEnd.value,
    manDays,
  }
}

export function extendAncestorEndDatesFromSubtasks(
  tasks: Task[],
  parentId: string,
): { tasks: Task[]; updates: TaskDatePropagationUpdate[] } {
  const updates: TaskDatePropagationUpdate[] = []

  const visit = (task: Task): { task: Task; containsParent: boolean; changed: boolean } => {
    let containsParent = task.id === parentId
    let changed = false

    const nextSubTasks = (task.subTasks || []).map((child) => {
      const result = visit(child)
      containsParent = containsParent || result.containsParent
      changed = changed || result.changed
      return result.task
    })

    let nextTask =
      changed && task.subTasks
        ? { ...task, subTasks: nextSubTasks }
        : task

    if (containsParent) {
      const latestChildEnd = latestEndDateInTasks(nextTask.subTasks || [])
      const currentEnd = parseTaskDate(nextTask.endDate)
      if (latestChildEnd && (!currentEnd || latestChildEnd.date.getTime() > currentEnd.getTime())) {
        const before = nextTask
        nextTask = buildTaskWithEndDate(nextTask, latestChildEnd)
        updates.push({
          id: nextTask.id,
          before,
          after: nextTask,
          updates: {
            endDate: nextTask.endDate,
            manDays: nextTask.manDays,
          },
        })
        changed = true
      }
    }

    return { task: nextTask, containsParent, changed }
  }

  let changed = false
  const nextTasks = tasks.map((task) => {
    const result = visit(task)
    changed = changed || result.changed
    return result.task
  })

  return { tasks: changed ? nextTasks : tasks, updates }
}
