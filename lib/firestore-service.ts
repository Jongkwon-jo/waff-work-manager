import { db } from "./firebase"
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore"
import type { Project, Task } from "./data"

const PROJECTS_COLLECTION = "projects"
const TASKS_COLLECTION = "tasks"

function toStringOrEmpty(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number") return String(value)
  return ""
}

function toOptionalString(value: unknown): string | undefined {
  const text = toStringOrEmpty(value)
  return text ? text : undefined
}

function toNumberOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function todayLabel(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  return `${mm}월 ${dd}일`
}

function normalizeTask(raw: any): Task {
  const parentId =
    toOptionalString(raw?.parentId) ??
    toOptionalString(raw?.parent_id) ??
    toOptionalString(raw?.parentTaskId) ??
    toOptionalString(raw?.parent_task_id)

  return {
    id: toStringOrEmpty(raw?.id),
    projectId:
      toStringOrEmpty(raw?.projectId) ||
      toStringOrEmpty(raw?.project_id) ||
      toStringOrEmpty(raw?.projectID),
    parentId,
    task: toStringOrEmpty(raw?.task) || toStringOrEmpty(raw?.name) || "이름 없음",
    person: toStringOrEmpty(raw?.person),
    department: toStringOrEmpty(raw?.department),
    status: (toStringOrEmpty(raw?.status) as Task["status"]) || "미정",
    category: (toStringOrEmpty(raw?.category) as Task["category"]) || "일반",
    startDate: toStringOrEmpty(raw?.startDate) || toStringOrEmpty(raw?.start_date) || todayLabel(),
    endDate: toStringOrEmpty(raw?.endDate) || toStringOrEmpty(raw?.end_date) || todayLabel(),
    manDays: toNumberOr(raw?.manDays ?? raw?.man_days, 0),
    isSubTask: Boolean(raw?.isSubTask ?? raw?.is_sub_task ?? parentId),
    displayOrder: toNumberOr(raw?.displayOrder, Number.MAX_SAFE_INTEGER),
    subTasks: [],
  }
}

function buildProjectTree(projectsData: any[], allTasksData: any[]): Project[] {
  const normalizedTasks = allTasksData.map(normalizeTask)

  const orderedProjects = [...projectsData].sort((a, b) => {
    const orderA = typeof a.displayOrder === "number" ? a.displayOrder : Number.MAX_SAFE_INTEGER
    const orderB = typeof b.displayOrder === "number" ? b.displayOrder : Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    return (a.name || "").localeCompare(b.name || "")
  })

  return orderedProjects.map((projectData) => {
    const projectId = toStringOrEmpty(projectData.id)
    const projectTasks = normalizedTasks.filter((task) => task.projectId === projectId)

    const taskMap: Record<string, Task> = {}
    const roots: Task[] = []

    projectTasks.forEach((task) => {
      taskMap[task.id] = { ...task, subTasks: [] }
    })

    const orderedTasks = [...projectTasks].sort((a, b) => {
      const orderA = typeof a.displayOrder === "number" ? a.displayOrder : Number.MAX_SAFE_INTEGER
      const orderB = typeof b.displayOrder === "number" ? b.displayOrder : Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB
      return (a.task || "").localeCompare(b.task || "")
    })

    orderedTasks.forEach((task) => {
      const current = taskMap[task.id]
      if (task.parentId && taskMap[task.parentId]) {
        taskMap[task.parentId].subTasks?.push(current)
      } else {
        roots.push(current)
      }
    })

    return {
      ...projectData,
      id: projectId,
      tasks: roots,
      createdAt: projectData.createdAt?.toDate?.() || new Date(0),
    } as Project
  })
}

export function subscribeToData(callback: (projects: Project[]) => void) {
  const projectsQuery = collection(db, PROJECTS_COLLECTION)
  const tasksQuery = collection(db, TASKS_COLLECTION)

  let projects: any[] = []
  let tasks: any[] = []

  const updateAndNotify = () => {
    callback(buildProjectTree(projects, tasks))
  }

  const unsubscribeProjects = onSnapshot(
    projectsQuery,
    (snapshot) => {
      projects = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      updateAndNotify()
    },
    (error) => {
      console.error("Projects snapshot error:", error)
    },
  )

  const unsubscribeTasks = onSnapshot(
    tasksQuery,
    (snapshot) => {
      tasks = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      updateAndNotify()
    },
    (error) => {
      console.error("Tasks snapshot error:", error)
    },
  )

  return () => {
    unsubscribeProjects()
    unsubscribeTasks()
  }
}

export async function fetchProjectsWithTasks(): Promise<Project[]> {
  const projectsSnapshot = await getDocs(collection(db, PROJECTS_COLLECTION))
  const tasksSnapshot = await getDocs(collection(db, TASKS_COLLECTION))

  const projectsData = projectsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
  const tasksData = tasksSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))

  return buildProjectTree(projectsData, tasksData)
}

export async function addProjectToDB(project: Omit<Project, "id" | "tasks">): Promise<string> {
  const docRef = await addDoc(collection(db, PROJECTS_COLLECTION), {
    ...project,
    displayOrder: Date.now(),
    createdAt: serverTimestamp(),
  })
  return docRef.id
}

export async function updateProjectInDB(projectId: string, updates: Partial<Project>): Promise<void> {
  const projectRef = doc(db, PROJECTS_COLLECTION, projectId)
  await updateDoc(projectRef, updates)
}

export async function deleteProjectFromDB(projectId: string): Promise<void> {
  const tasksQ = query(collection(db, TASKS_COLLECTION), where("projectId", "==", projectId))
  const tasksSnapshot = await getDocs(tasksQ)
  const batch = writeBatch(db)

  tasksSnapshot.docs.forEach((taskDoc) => {
    batch.delete(taskDoc.ref)
  })

  batch.delete(doc(db, PROJECTS_COLLECTION, projectId))
  await batch.commit()
}

export async function addTaskToDB(task: Omit<Task, "id">): Promise<string> {
  const docRef = await addDoc(collection(db, TASKS_COLLECTION), {
    ...task,
    displayOrder: typeof task.displayOrder === "number" ? task.displayOrder : Date.now(),
  })
  return docRef.id
}

export async function updateTaskInDB(taskId: string, updates: Partial<Task>): Promise<void> {
  const taskRef = doc(db, TASKS_COLLECTION, taskId)
  await updateDoc(taskRef, updates)
}

export async function deleteTaskFromDB(taskId: string): Promise<void> {
  const taskRef = doc(db, TASKS_COLLECTION, taskId)
  await deleteDoc(taskRef)
}

export async function updateProjectOrdersInDB(projectIds: string[]): Promise<void> {
  const batch = writeBatch(db)
  projectIds.forEach((id, index) => {
    batch.update(doc(db, PROJECTS_COLLECTION, id), { displayOrder: index })
  })
  await batch.commit()
}

export async function updateTaskOrdersInDB(taskIds: string[]): Promise<void> {
  const batch = writeBatch(db)
  taskIds.forEach((id, index) => {
    batch.update(doc(db, TASKS_COLLECTION, id), { displayOrder: index })
  })
  await batch.commit()
}
