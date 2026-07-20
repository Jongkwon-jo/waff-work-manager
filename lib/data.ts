export type TaskStatus = "완료" | "진행" | "예정" | "보류" | "미정"
export type TaskCategory = "일반" | "중요" | "정기" | "상시"

export type TaskCompletionPhoto = {
  url: string
  path: string
  name: string
  contentType?: string
  size?: number
  uploadedAt?: string
  uploadedBy?: string
}

export const EDITABLE_TASK_FIELD_OPTIONS = [
  { key: "status", label: "상태" },
  { key: "memo", label: "메모" },
  { key: "manDays", label: "공수" },
  { key: "startDate", label: "시작일" },
  { key: "endDate", label: "종료일" },
  { key: "task", label: "업무내용(제목)" },
  { key: "category", label: "구분" },
  { key: "department", label: "부서" },
  { key: "person", label: "담당자" },
] as const

export type EditableTaskField = (typeof EDITABLE_TASK_FIELD_OPTIONS)[number]["key"]

export interface Task {
  id: string
  sourceSchedule?: "ict" | "strategy"
  originalTaskId?: string
  originalProjectId?: string
  displayOrder?: number
  depth?: number
  isHidden?: boolean
  /** Persisted marker for the top task of a hidden subtree. */
  isHiddenRoot?: boolean
  projectId: string
  parentId?: string
  task: string
  memo?: string
  category: TaskCategory
  department: string
  person: string
  personKeys?: string[]
  startDate: string
  endDate: string
  status: TaskStatus
  manDays: number
  completionPhoto?: TaskCompletionPhoto
  createdByEmail?: string
  createdByName?: string
  isSubTask?: boolean
  /** Runtime-only leaf verification metadata; never persisted to Firestore. */
  isLeafInStore?: boolean
  subTasks?: Task[]
}

export type ProjectType = "SI" | "R&D" | "S/F" | "공사" | "A/S" | "Etc"

export interface Project {
  id: string
  sourceSchedule?: "ict" | "strategy"
  originalProjectId?: string
  displayOrder?: number
  isHidden?: boolean
  name: string
  type: ProjectType
  period?: string
  pmEmail?: string
  pmEmails?: string[]
  createdByEmail?: string
  createdByName?: string
  tasks: Task[]
  createdAt?: Date
}

export type ProjectPmOption = {
  email: string
  label: string
}

export function normalizeProjectPmEmails(project: Pick<Project, "pmEmail" | "pmEmails">): string[] {
  return Array.from(
    new Set(
      [...(project.pmEmails || []), project.pmEmail || ""]
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

export function makeProjectPmFields(pmEmails: string[]): Pick<Project, "pmEmail" | "pmEmails"> {
  const normalized = Array.from(new Set(pmEmails.map((email) => email.trim().toLowerCase()).filter(Boolean)))
  return {
    pmEmail: normalized[0] || "",
    pmEmails: normalized,
  }
}

export function areProjectPmEmailsEqual(
  left: Pick<Project, "pmEmail" | "pmEmails"> | undefined,
  right: Pick<Project, "pmEmail" | "pmEmails"> | undefined,
) {
  const leftEmails = left ? normalizeProjectPmEmails(left) : []
  const rightEmails = right ? normalizeProjectPmEmails(right) : []
  if (leftEmails.length !== rightEmails.length) return false
  return leftEmails.every((email, index) => email === rightEmails[index])
}

export const projects: Project[] = []

export function flattenTasks(tasks: Task[]): Task[] {
  return tasks.reduce((acc, task) => [...acc, task, ...flattenTasks(task.subTasks || [])], [] as Task[])
}

function rebuildTaskTree(tasks: Task[]): Task[] {
  const taskMap = new Map<string, Task>()
  tasks.forEach((task) => taskMap.set(task.id, { ...task, subTasks: [] }))

  const ordered = Array.from(taskMap.values()).sort((a, b) => {
    const orderA = typeof a.displayOrder === "number" ? a.displayOrder : Number.MAX_SAFE_INTEGER
    const orderB = typeof b.displayOrder === "number" ? b.displayOrder : Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    const byName = (a.task || "").localeCompare(b.task || "", "ko")
    return byName !== 0 ? byName : a.id.localeCompare(b.id)
  })

  const roots: Task[] = []
  ordered.forEach((task) => {
    const parent = task.parentId ? taskMap.get(task.parentId) : undefined
    if (parent) parent.subTasks?.push(task)
    else roots.push(task)
  })
  return roots
}

/** Merge lazily loaded task documents into the currently visible project trees. */
export function mergeProjectTaskDetails(projects: Project[], detailTasks: Task[]): Project[] {
  if (detailTasks.length === 0) return projects
  const detailsByProject = new Map<string, Task[]>()
  detailTasks.forEach((task) => {
    const current = detailsByProject.get(task.projectId) || []
    current.push(task)
    detailsByProject.set(task.projectId, current)
  })

  return projects.map((project) => {
    const details = detailsByProject.get(project.id)
    if (!details?.length) return project
    const taskById = new Map(flattenTasks(project.tasks).map((task) => [task.id, task]))
    details.forEach((task) => taskById.set(task.id, task))
    return { ...project, tasks: rebuildTaskTree(Array.from(taskById.values())) }
  })
}

export function getAllTasks(): Task[] {
  return projects.flatMap((p) => flattenTasks(p.tasks))
}

export function getStatusCounts() {
  const tasks = getAllTasks()
  return {
    total: tasks.length,
    "완료": tasks.filter((t) => t.status === "완료").length,
    "진행": tasks.filter((t) => t.status === "진행").length,
    "예정": tasks.filter((t) => t.status === "예정").length,
    "보류": tasks.filter((t) => t.status === "보류").length,
    "미정": tasks.filter((t) => t.status === "미정").length,
  }
}

export function getPersonList(): string[] {
  const tasks = getAllTasks()
  const personSet = new Set<string>()
  tasks.forEach((t) => {
    t.person
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .forEach((p) => personSet.add(p))
  })
  return Array.from(personSet).sort((a, b) => a.localeCompare(b, "ko"))
}

export function getDepartmentList(): string[] {
  return ["전략", "ICT", "FA", "기타"]
}
