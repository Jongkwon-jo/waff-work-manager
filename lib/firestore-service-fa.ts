import { db } from "./firebase"
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore"
import type { Project, Task } from "./data"
import {
  DEFAULT_PAGE_PERMISSIONS,
  normalizeEmail,
  normalizePermissions,
  permissionDocId,
  type PagePermissionKey,
  type UserPagePermissions,
} from "./page-access"
import {
  buildHistoryNotificationFields,
  buildPersonKeys,
  type HistoryNotificationFilter,
} from "./history-notification"
import { buildTaskPersonKeys, buildTaskPersonKeysFromValues } from "./task-person-keys"

const PROJECTS_COLLECTION = "fa_projects"
const TASKS_COLLECTION = "fa_tasks"
const HISTORY_COLLECTION = "fa_history"
const SETTINGS_COLLECTION = "fa_settings"
const DASHBOARD_PREFERENCES_DOC = "fa_dashboard_preferences"
const USER_PROFILES_COLLECTION = "user_profiles"
const FA_GANTT_COLLAPSE_STATE_FIELD = "faGanttCollapseState"
const FA_GANTT_LEFT_PANEL_WIDTH_FIELD = "faGanttLeftPanelWidth"
const FA_GANTT_DETAIL_PANEL_WIDTH_FIELD = "faGanttDetailPanelWidth"
const USER_PAGE_PERMISSIONS_COLLECTION = "user_page_permissions"

export type DashboardSortBy = "name" | "type" | "progress" | "latest"
export type GanttCollapseState = {
  collapsedProjectIds: string[]
  collapsedTaskIds: string[]
}
export type UserProfile = {
  email: string
  lastLoginAt?: Date
}

export type UserPagePermissionEntry = {
  email: string
  permissions: UserPagePermissions
  updatedAt?: Date
}

type HistoryEntityType = "project" | "task" | "batch" | "project_bundle"
type HistoryActionType = "create" | "update" | "delete" | "batch_update" | "project_delete"

type HistoryBatchItem = {
  entityType: "project" | "task"
  entityId: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

export type HistorySource = "my-page" | "work-management" | "fa-work-management" | "gantt" | "other"

export interface ChangeHistoryEntry {
  id: string
  entityType: HistoryEntityType
  action: HistoryActionType
  actorEmail?: string
  actorName?: string
  entityId?: string
  projectId?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  batch?: HistoryBatchItem[]
  createdAt?: Date
  source?: HistorySource
  notificationPersonKeys?: string[]
  notificationDepartmentGroups?: string[]
}

export type HistoryEntryInput = Omit<ChangeHistoryEntry, "id" | "createdAt">
export const DEFAULT_GANTT_COLLAPSE_STATE: GanttCollapseState = {
  collapsedProjectIds: [],
  collapsedTaskIds: [],
}
export const DEFAULT_GANTT_LEFT_PANEL_WIDTH = 0
export const DEFAULT_GANTT_DETAIL_PANEL_WIDTH = 0

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

function toBooleanOr(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["true", "1", "yes", "y"].includes(normalized)) return true
    if (["false", "0", "no", "n"].includes(normalized)) return false
  }
  return fallback
}

function compactObject<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T
}

function uniqueTrimmedStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeGanttCollapseState(
  raw?: Partial<Record<keyof GanttCollapseState, unknown>>,
): GanttCollapseState {
  return {
    collapsedProjectIds: Array.isArray(raw?.collapsedProjectIds)
      ? uniqueTrimmedStrings(raw.collapsedProjectIds.filter((value): value is string => typeof value === "string"))
      : [],
    collapsedTaskIds: Array.isArray(raw?.collapsedTaskIds)
      ? uniqueTrimmedStrings(raw.collapsedTaskIds.filter((value): value is string => typeof value === "string"))
      : [],
  }
}

function todayLabel(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  return `${mm}월 ${dd}일`
}

function normalizeTaskStatus(status: string): Task["status"] {
  const normalized = status.trim()
  if (normalized === "대기") return "예정"
  return (normalized as Task["status"]) || "미정"
}

function normalizeTask(raw: any): Task {
  const parentId =
    toOptionalString(raw?.parentId) ??
    toOptionalString(raw?.parent_id) ??
    toOptionalString(raw?.parentTaskId) ??
    toOptionalString(raw?.parent_task_id)

  return {
    id: toStringOrEmpty(raw?.id),
    depth: toNumberOr(raw?.depth, 0),
    projectId:
      toStringOrEmpty(raw?.projectId) ||
      toStringOrEmpty(raw?.project_id) ||
      toStringOrEmpty(raw?.projectID),
    parentId,
    task: toStringOrEmpty(raw?.task) || toStringOrEmpty(raw?.name) || "이름 없음",
    memo: toOptionalString(raw?.memo) ?? toOptionalString(raw?.note) ?? toOptionalString(raw?.notes),
    person: toStringOrEmpty(raw?.person),
    personKeys: Array.isArray(raw?.personKeys)
      ? raw.personKeys.filter((value: unknown): value is string => typeof value === "string")
      : buildTaskPersonKeys(toStringOrEmpty(raw?.person)),
    department: toStringOrEmpty(raw?.department),
    status: normalizeTaskStatus(toStringOrEmpty(raw?.status)),
    category: (toStringOrEmpty(raw?.category) as Task["category"]) || "일반",
    startDate: toStringOrEmpty(raw?.startDate) || toStringOrEmpty(raw?.start_date) || todayLabel(),
    endDate: toStringOrEmpty(raw?.endDate) || toStringOrEmpty(raw?.end_date) || todayLabel(),
    manDays: toNumberOr(raw?.manDays ?? raw?.man_days, 0),
    completionPhoto:
      raw?.completionPhoto && typeof raw.completionPhoto === "object"
        ? {
            url: toStringOrEmpty(raw.completionPhoto.url),
            path: toStringOrEmpty(raw.completionPhoto.path),
            name: toStringOrEmpty(raw.completionPhoto.name),
            contentType: toOptionalString(raw.completionPhoto.contentType),
            size: typeof raw.completionPhoto.size === "number" ? raw.completionPhoto.size : undefined,
            uploadedAt: toOptionalString(raw.completionPhoto.uploadedAt),
            uploadedBy: toOptionalString(raw.completionPhoto.uploadedBy),
          }
        : undefined,
    createdByEmail: toOptionalString(raw?.createdByEmail ?? raw?.created_by_email),
    createdByName: toOptionalString(raw?.createdByName ?? raw?.created_by_name),
    isSubTask: Boolean(raw?.isSubTask ?? raw?.is_sub_task ?? parentId),
    isHidden: toBooleanOr(raw?.isHidden ?? raw?.is_hidden, false),
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
    const timeA = a.createdAt?.toDate?.()?.getTime?.() || 0
    const timeB = b.createdAt?.toDate?.()?.getTime?.() || 0
    if (timeA !== timeB) return timeA - timeB
    return toStringOrEmpty(a.id).localeCompare(toStringOrEmpty(b.id))
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
      const byName = (a.task || "").localeCompare(b.task || "", "ko")
      if (byName !== 0) return byName
      return a.id.localeCompare(b.id)
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
      isHidden: toBooleanOr(projectData.isHidden ?? projectData.is_hidden, false),
      tasks: roots,
      createdAt: projectData.createdAt?.toDate?.() || new Date(0),
    } as Project
  })
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size))
  return chunks
}

async function fetchParentTaskChain(tasksById: Map<string, any>) {
  const pendingParentIds = new Set<string>()
  tasksById.forEach((task) => {
    const parentId = toOptionalString(task.parentId)
    if (parentId && !tasksById.has(parentId)) pendingParentIds.add(parentId)
  })

  while (pendingParentIds.size > 0) {
    const parentId = pendingParentIds.values().next().value as string
    pendingParentIds.delete(parentId)
    if (tasksById.has(parentId)) continue

    const parentSnap = await getDoc(doc(db, TASKS_COLLECTION, parentId))
    if (!parentSnap.exists()) continue

    const parentTask: any = { ...parentSnap.data(), id: parentSnap.id }
    tasksById.set(parentSnap.id, parentTask)

    const nextParentId = toOptionalString(parentTask.parentId)
    if (nextParentId && !tasksById.has(nextParentId)) pendingParentIds.add(nextParentId)
  }
}

async function fetchProjectsForTasks(tasks: any[]) {
  const projectIds = Array.from(new Set(tasks.map((task) => toStringOrEmpty(task.projectId)).filter(Boolean)))
  const projectsData = await Promise.all(
    projectIds.map(async (projectId) => {
      const projectSnap = await getDoc(doc(db, PROJECTS_COLLECTION, projectId))
      return projectSnap.exists() ? { ...projectSnap.data(), id: projectSnap.id } : null
    }),
  )
  return projectsData.filter((project): project is any => Boolean(project))
}

export function subscribeProjectsWithTasksByPersonKeys(
  personKeys: string[],
  callback: (projects: Project[]) => void,
) {
  const queryKeys = buildTaskPersonKeysFromValues(personKeys).slice(0, 300)
  if (queryKeys.length === 0) {
    callback([])
    return () => {}
  }

  const chunks = chunkValues(queryKeys, 30)
  const taskGroups = new Map<number, any[]>()
  let disposed = false

  const notify = async () => {
    const tasksById = new Map<string, any>()
    taskGroups.forEach((tasks) => {
      tasks.forEach((task) => tasksById.set(task.id, task))
    })

    await fetchParentTaskChain(tasksById)
    const allTasks = Array.from(tasksById.values())
    const projectsData = await fetchProjectsForTasks(allTasks)
    if (!disposed) callback(buildProjectTree(projectsData, allTasks))
  }

  const unsubscribes = chunks.map((chunk, index) =>
    onSnapshot(
      query(collection(db, TASKS_COLLECTION), where("personKeys", "array-contains-any", chunk)),
      (snapshot) => {
        taskGroups.set(index, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
        void notify().catch((error) => {
          console.error("Scoped FA data snapshot error:", error)
          if (!disposed) callback([])
        })
      },
      (error) => {
        console.error("Scoped FA tasks snapshot error:", error)
      },
    ),
  )

  return () => {
    disposed = true
    unsubscribes.forEach((unsubscribe) => unsubscribe())
  }
}

export type ScheduleScopeOptions = {
  personKeys?: string[]
  pmEmail?: string
  includeAll?: boolean
}

export function subscribeProjectsWithTasksByScheduleScope(
  scope: ScheduleScopeOptions,
  callback: (projects: Project[]) => void,
) {
  if (scope.includeAll) return subscribeToData(callback)

  const queryKeys = buildTaskPersonKeysFromValues(scope.personKeys || []).slice(0, 300)
  const normalizedPmEmail = normalizeEmail(scope.pmEmail || "")
  if (queryKeys.length === 0 && !normalizedPmEmail) {
    callback([])
    return () => {}
  }

  const taskGroups = new Map<string, any[]>()
  const pmProjectsById = new Map<string, any>()
  let pmTaskUnsubscribes: Array<() => void> = []
  let disposed = false
  let notifyToken = 0

  const notify = async () => {
    const currentToken = ++notifyToken
    const tasksById = new Map<string, any>()
    taskGroups.forEach((tasks) => {
      tasks.forEach((task) => tasksById.set(task.id, task))
    })

    await fetchParentTaskChain(tasksById)
    const allTasks = Array.from(tasksById.values())
    const relatedProjects = await fetchProjectsForTasks(allTasks)
    const projectsById = new Map<string, any>()
    relatedProjects.forEach((project) => projectsById.set(toStringOrEmpty(project.id), project))
    pmProjectsById.forEach((project, projectId) => projectsById.set(projectId, project))

    if (!disposed && currentToken === notifyToken) {
      callback(buildProjectTree(Array.from(projectsById.values()), allTasks))
    }
  }

  const resetPmTaskSubscriptions = (projectIds: string[]) => {
    pmTaskUnsubscribes.forEach((unsubscribe) => unsubscribe())
    pmTaskUnsubscribes = []
    Array.from(taskGroups.keys())
      .filter((key) => key.startsWith("pm:"))
      .forEach((key) => taskGroups.delete(key))

    const chunks = chunkValues(projectIds, 30)
    if (chunks.length === 0) {
      void notify().catch((error) => {
        console.error("Schedule PM FA data snapshot error:", error)
        if (!disposed) callback([])
      })
      return
    }

    pmTaskUnsubscribes = chunks.map((chunk, index) =>
      onSnapshot(
        query(collection(db, TASKS_COLLECTION), where("projectId", "in", chunk)),
        (snapshot) => {
          taskGroups.set(`pm:${index}`, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
          void notify().catch((error) => {
            console.error("Schedule PM FA data snapshot error:", error)
            if (!disposed) callback([])
          })
        },
        (error) => {
          console.error("Schedule PM FA tasks snapshot error:", error)
        },
      ),
    )
  }

  const unsubscribes: Array<() => void> = []

  chunkValues(queryKeys, 30).forEach((chunk, index) => {
    unsubscribes.push(
      onSnapshot(
        query(collection(db, TASKS_COLLECTION), where("personKeys", "array-contains-any", chunk)),
        (snapshot) => {
          taskGroups.set(`person:${index}`, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
          void notify().catch((error) => {
            console.error("Schedule assignee FA data snapshot error:", error)
            if (!disposed) callback([])
          })
        },
        (error) => {
          console.error("Schedule assignee FA tasks snapshot error:", error)
        },
      ),
    )
  })

  if (normalizedPmEmail) {
    unsubscribes.push(
      onSnapshot(
        query(collection(db, PROJECTS_COLLECTION), where("pmEmail", "==", normalizedPmEmail)),
        (snapshot) => {
          pmProjectsById.clear()
          snapshot.docs.forEach((docSnap) => {
            pmProjectsById.set(docSnap.id, { ...docSnap.data(), id: docSnap.id })
          })
          resetPmTaskSubscriptions(snapshot.docs.map((docSnap) => docSnap.id))
        },
        (error) => {
          console.error("Schedule PM FA projects snapshot error:", error)
        },
      ),
    )
  }

  return () => {
    disposed = true
    unsubscribes.forEach((unsubscribe) => unsubscribe())
    pmTaskUnsubscribes.forEach((unsubscribe) => unsubscribe())
  }
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
      projects = snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
      updateAndNotify()
    },
    (error) => {
      console.error("Projects snapshot error:", error)
    },
  )

  const unsubscribeTasks = onSnapshot(
    tasksQuery,
    (snapshot) => {
      tasks = snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
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

  const projectsData = projectsSnapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
  const tasksData = tasksSnapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))

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
    personKeys: buildTaskPersonKeys(task.person || ""),
    displayOrder: typeof task.displayOrder === "number" ? task.displayOrder : Date.now(),
  })
  return docRef.id
}

export async function updateTaskInDB(taskId: string, updates: Omit<Partial<Task>, "parentId"> & { parentId?: string | null }): Promise<void> {
  const taskRef = doc(db, TASKS_COLLECTION, taskId)
  const payload = {
    ...updates,
    ...(typeof updates.person === "string" ? { personKeys: buildTaskPersonKeys(updates.person) } : {}),
  }
  await updateDoc(taskRef, payload)
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

export async function addHistoryEntry(entry: HistoryEntryInput): Promise<string> {
  const actorEmail = toOptionalString(entry.actorEmail)
  const notificationFields = buildHistoryNotificationFields(entry)
  const payload = compactObject({
    ...entry,
    actorEmail: actorEmail ? normalizeEmail(actorEmail) : undefined,
    actorName: toOptionalString(entry.actorName),
    notificationPersonKeys: notificationFields.notificationPersonKeys,
    notificationDepartmentGroups: notificationFields.notificationDepartmentGroups,
    createdAt: serverTimestamp(),
  })
  const docRef = await addDoc(collection(db, HISTORY_COLLECTION), payload)
  return docRef.id
}

function mapHistoryDoc(docSnap: { id: string; data: () => any }): ChangeHistoryEntry {
  const raw = docSnap.data()
  return {
    id: docSnap.id,
    entityType: (toStringOrEmpty(raw?.entityType) as HistoryEntityType) || "batch",
    action: (toStringOrEmpty(raw?.action) as HistoryActionType) || "batch_update",
    actorEmail: toOptionalString(raw?.actorEmail),
    actorName: toOptionalString(raw?.actorName),
    entityId: toOptionalString(raw?.entityId),
    projectId: toOptionalString(raw?.projectId),
    before: (raw?.before as Record<string, unknown> | undefined) || undefined,
    after: (raw?.after as Record<string, unknown> | undefined) || undefined,
    batch: (raw?.batch as HistoryBatchItem[] | undefined) || undefined,
    createdAt: raw?.createdAt?.toDate?.() || undefined,
    source: (toOptionalString(raw?.source) as HistorySource | undefined) || undefined,
    notificationPersonKeys: Array.isArray(raw?.notificationPersonKeys)
      ? raw.notificationPersonKeys.filter((value: unknown): value is string => typeof value === "string")
      : [],
    notificationDepartmentGroups: Array.isArray(raw?.notificationDepartmentGroups)
      ? raw.notificationDepartmentGroups.filter((value: unknown): value is string => typeof value === "string")
      : [],
  }
}

export async function fetchHistoryEntries(limitCount = 30, actorEmail?: string): Promise<ChangeHistoryEntry[]> {
  const normalizedActorEmail = actorEmail ? normalizeEmail(actorEmail) : ""
  const historyQ = normalizedActorEmail
    ? query(
        collection(db, HISTORY_COLLECTION),
        where("actorEmail", "==", normalizedActorEmail),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      )
    : query(collection(db, HISTORY_COLLECTION), orderBy("createdAt", "desc"), limit(limitCount))
  const snapshot = await getDocs(historyQ)
  return snapshot.docs.map(mapHistoryDoc)
}

export async function fetchNotificationHistoryEntries(
  limitCount = 30,
  filter: HistoryNotificationFilter = {},
): Promise<ChangeHistoryEntry[]> {
  const personKeys = buildPersonKeys(filter.personKeys || []).slice(0, 30)
  const departmentGroups = (filter.departmentGroups || []).slice(0, 30)
  const historyQueries: any[] = []

  if (personKeys.length > 0) {
    historyQueries.push(
      query(
        collection(db, HISTORY_COLLECTION),
        where("notificationPersonKeys", "array-contains-any", personKeys),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      ),
    )
  }
  if (departmentGroups.length > 0) {
    historyQueries.push(
      query(
        collection(db, HISTORY_COLLECTION),
        where("notificationDepartmentGroups", "array-contains-any", departmentGroups),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      ),
    )
  }
  if (historyQueries.length === 0) return []

  const snapshots = await Promise.all(historyQueries.map((historyQ) => getDocs(historyQ)))
  const byId = new Map<string, ChangeHistoryEntry>()
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((docSnap) => byId.set(docSnap.id, mapHistoryDoc(docSnap)))
  })
  return Array.from(byId.values())
    .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
    .slice(0, limitCount)
}

function getCollectionForEntity(entityType: "project" | "task") {
  return entityType === "project" ? PROJECTS_COLLECTION : TASKS_COLLECTION
}

async function rollbackSingle(entry: ChangeHistoryEntry): Promise<void> {
  const entityType = entry.entityType === "project" ? "project" : "task"
  if (!entry.entityId) return

  const targetRef = doc(db, getCollectionForEntity(entityType), entry.entityId)
  if (entry.action === "create") {
    await deleteDoc(targetRef)
    return
  }
  if (entry.action === "delete" && entry.before) {
    await setDoc(targetRef, compactObject(entry.before))
    return
  }
  if (entry.action === "update" && entry.before) {
    await updateDoc(targetRef, compactObject(entry.before) as any)
  }
}

export async function rollbackHistoryEntry(entry: ChangeHistoryEntry): Promise<void> {
  if (entry.entityType === "batch" && entry.action === "batch_update" && entry.batch?.length) {
    await Promise.all(
      entry.batch.map(async (item) => {
        if (!item.before) return
        const ref = doc(db, getCollectionForEntity(item.entityType), item.entityId)
        await updateDoc(ref, compactObject(item.before) as any)
      }),
    )
    return
  }

  if (entry.entityType === "project_bundle" && entry.action === "project_delete" && entry.before) {
    const project = entry.before.project as { id?: string; data?: Record<string, unknown> } | undefined
    const tasks = (entry.before.tasks as Array<{ id: string; data: Record<string, unknown> }> | undefined) || []
    if (!project?.id || !project.data) return

    await setDoc(doc(db, PROJECTS_COLLECTION, project.id), compactObject(project.data))
    await Promise.all(
      tasks.map((task) => setDoc(doc(db, TASKS_COLLECTION, task.id), compactObject(task.data))),
    )
    return
  }

  if (entry.entityType === "project" || entry.entityType === "task") {
    await rollbackSingle(entry)
  }
}

export async function deleteHistoryEntry(entryId: string): Promise<void> {
  await deleteDoc(doc(db, HISTORY_COLLECTION, entryId))
}

export function subscribeDashboardSortBy(callback: (sortBy: DashboardSortBy) => void) {
  const preferencesRef = doc(db, SETTINGS_COLLECTION, DASHBOARD_PREFERENCES_DOC)
  return onSnapshot(
    preferencesRef,
    (snapshot) => {
      const raw = snapshot.data() as { sortBy?: unknown } | undefined
      const candidate = toStringOrEmpty(raw?.sortBy) as DashboardSortBy
      if (candidate === "latest" || candidate === "name" || candidate === "type" || candidate === "progress") {
        callback(candidate)
        return
      }
      callback("latest")
    },
    (error) => {
      console.error("Dashboard sort snapshot error:", error)
    },
  )
}

export async function saveDashboardSortBy(sortBy: DashboardSortBy): Promise<void> {
  const preferencesRef = doc(db, SETTINGS_COLLECTION, DASHBOARD_PREFERENCES_DOC)
  await setDoc(
    preferencesRef,
    {
      sortBy,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export function subscribeGanttCollapseState(email: string, callback: (state: GanttCollapseState) => void) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    callback({ ...DEFAULT_GANTT_COLLAPSE_STATE })
    return () => {}
  }

  const profileRef = doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail))
  return onSnapshot(
    profileRef,
    (snapshot) => {
      const profile = snapshot.data() as { faGanttCollapseState?: Partial<Record<keyof GanttCollapseState, unknown>> } | undefined
      const raw = profile?.[FA_GANTT_COLLAPSE_STATE_FIELD]
      callback(normalizeGanttCollapseState(raw))
    },
    (error) => {
      console.error("Gantt collapse state snapshot error:", error)
      callback({ ...DEFAULT_GANTT_COLLAPSE_STATE })
    },
  )
}

export async function saveGanttCollapseState(email: string, state: GanttCollapseState): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  const profileRef = doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail))
  await setDoc(
    profileRef,
    {
      email: normalizedEmail,
      [FA_GANTT_COLLAPSE_STATE_FIELD]: normalizeGanttCollapseState(state),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export function subscribeGanttLeftPanelWidth(email: string, callback: (width: number | null) => void) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    callback(null)
    return () => {}
  }

  const profileRef = doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail))
  return onSnapshot(
    profileRef,
    (snapshot) => {
      const profile = snapshot.data() as { faGanttLeftPanelWidth?: unknown } | undefined
      const raw = profile?.[FA_GANTT_LEFT_PANEL_WIDTH_FIELD]
      const width = toNumberOr(raw, DEFAULT_GANTT_LEFT_PANEL_WIDTH)
      callback(width > 0 ? width : null)
    },
    (error) => {
      console.error("FA gantt left panel width snapshot error:", error)
      callback(null)
    },
  )
}

export async function saveGanttLeftPanelWidth(email: string, width: number): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  const normalizedWidth = Math.round(toNumberOr(width, DEFAULT_GANTT_LEFT_PANEL_WIDTH))
  if (normalizedWidth <= 0) return

  const profileRef = doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail))
  await setDoc(
    profileRef,
    {
      email: normalizedEmail,
      [FA_GANTT_LEFT_PANEL_WIDTH_FIELD]: normalizedWidth,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export function subscribeGanttDetailPanelWidth(email: string, callback: (width: number | null) => void) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    callback(null)
    return () => {}
  }

  const profileRef = doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail))
  return onSnapshot(
    profileRef,
    (snapshot) => {
      const profile = snapshot.data() as { faGanttDetailPanelWidth?: unknown } | undefined
      const raw = profile?.[FA_GANTT_DETAIL_PANEL_WIDTH_FIELD]
      const width = toNumberOr(raw, DEFAULT_GANTT_DETAIL_PANEL_WIDTH)
      callback(width > 0 ? width : null)
    },
    (error) => {
      console.error("FA gantt detail panel width snapshot error:", error)
      callback(null)
    },
  )
}

export async function saveGanttDetailPanelWidth(email: string, width: number): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  const normalizedWidth = Math.round(toNumberOr(width, DEFAULT_GANTT_DETAIL_PANEL_WIDTH))
  if (normalizedWidth <= 0) return

  const profileRef = doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail))
  await setDoc(
    profileRef,
    {
      email: normalizedEmail,
      [FA_GANTT_DETAIL_PANEL_WIDTH_FIELD]: normalizedWidth,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function upsertUserProfile(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  await setDoc(
    doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail)),
    {
      email: normalizedEmail,
      lastLoginAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export function subscribeUserProfiles(callback: (profiles: UserProfile[]) => void) {
  return onSnapshot(
    collection(db, USER_PROFILES_COLLECTION),
    (snapshot) => {
      const profiles = snapshot.docs
        .map((docSnap) => {
          const raw = docSnap.data() as { email?: unknown; lastLoginAt?: { toDate?: () => Date } }
          return {
            email: normalizeEmail(toStringOrEmpty(raw?.email)),
            lastLoginAt: raw?.lastLoginAt?.toDate?.() || undefined,
          } satisfies UserProfile
        })
        .filter((profile) => Boolean(profile.email))
        .sort((a, b) => a.email.localeCompare(b.email))

      callback(profiles)
    },
    (error) => {
      console.error("User profiles snapshot error:", error)
    },
  )
}

export function subscribeCurrentUserPagePermissions(
  email: string,
  callback: (permissions: UserPagePermissions) => void,
) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    callback({ ...DEFAULT_PAGE_PERMISSIONS })
    return () => {}
  }

  return onSnapshot(
    doc(db, USER_PAGE_PERMISSIONS_COLLECTION, permissionDocId(normalizedEmail)),
    (snapshot) => {
      const raw = snapshot.data() as Partial<Record<PagePermissionKey, unknown>> | undefined
      callback(normalizePermissions(raw))
    },
    (error) => {
      console.error("User page permissions snapshot error:", error)
    },
  )
}

export function subscribeAllUserPagePermissions(callback: (entries: UserPagePermissionEntry[]) => void) {
  return onSnapshot(
    collection(db, USER_PAGE_PERMISSIONS_COLLECTION),
    (snapshot) => {
      const entries = snapshot.docs
        .map((docSnap) => {
          const raw = docSnap.data() as {
            email?: unknown
            workManagement?: unknown
            gptTest?: unknown
            updatedAt?: { toDate?: () => Date }
          }

          return {
            email: normalizeEmail(toStringOrEmpty(raw?.email)),
            permissions: normalizePermissions(raw),
            updatedAt: raw?.updatedAt?.toDate?.() || undefined,
          } satisfies UserPagePermissionEntry
        })
        .filter((entry) => Boolean(entry.email))
        .sort((a, b) => a.email.localeCompare(b.email))

      callback(entries)
    },
    (error) => {
      console.error("All user permissions snapshot error:", error)
    },
  )
}

export async function saveUserPagePermissions(email: string, permissions: UserPagePermissions): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  await setDoc(
    doc(db, USER_PAGE_PERMISSIONS_COLLECTION, permissionDocId(normalizedEmail)),
    {
      email: normalizedEmail,
      ...normalizePermissions(permissions),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}
