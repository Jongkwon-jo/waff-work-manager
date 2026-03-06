export type TaskStatus = "완료" | "진행" | "대기" | "보류" | "미정"
export type TaskCategory = "일반" | "중요" | "정기" | "상시"

export interface Task {
  id: string
  displayOrder?: number
  depth?: number
  isHidden?: boolean
  projectId: string
  parentId?: string
  task: string
  memo?: string
  category: TaskCategory
  department: string
  person: string
  startDate: string
  endDate: string
  status: TaskStatus
  manDays: number
  isSubTask?: boolean
  subTasks?: Task[]
}

export type ProjectType = "SI" | "R&D" | "S/F" | "Etc"

export interface Project {
  id: string
  displayOrder?: number
  name: string
  type: ProjectType
  period?: string
  tasks: Task[]
  createdAt?: Date
}

export const projects: Project[] = []

function flattenTasks(tasks: Task[]): Task[] {
  return tasks.reduce((acc, task) => [...acc, task, ...flattenTasks(task.subTasks || [])], [] as Task[])
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
    "대기": tasks.filter((t) => t.status === "대기").length,
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
  return ["전략", "ICT", "FA", "기술고문"]
}
