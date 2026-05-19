import { db } from "./firebase"
import {
  addDoc,
  arrayRemove,
  arrayUnion,
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
  addHistoryEntry as addStrategyHistoryEntry,
  deleteHistoryEntry as deleteStrategyHistoryEntry,
  rollbackHistoryEntry as rollbackStrategyHistoryEntry,
} from "./firestore-service"
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

const PROJECTS_COLLECTION = "ict_projects"
const TASKS_COLLECTION = "ict_tasks"
const HISTORY_COLLECTION = "ict_history"
const SETTINGS_COLLECTION = "ict_settings"
const DASHBOARD_PREFERENCES_DOC = "ict_dashboard_preferences"
const LINKED_STRATEGY_PROJECT_VISIBILITY_DOC = "ict_linked_strategy_project_visibility"
const HIDDEN_LINKED_STRATEGY_PROJECT_IDS_FIELD = "hiddenLinkedStrategyProjectIds"
const STRATEGY_PROJECTS_COLLECTION = "projects"
const STRATEGY_TASKS_COLLECTION = "tasks"
const USER_PROFILES_COLLECTION = "user_profiles"
const ICT_GANTT_COLLAPSE_STATE_FIELD = "ictGanttCollapseState"
const ICT_GANTT_LEFT_PANEL_WIDTH_FIELD = "ictGanttLeftPanelWidth"
const ICT_GANTT_DETAIL_PANEL_WIDTH_FIELD = "ictGanttDetailPanelWidth"
const USER_PAGE_PERMISSIONS_COLLECTION = "user_page_permissions"
const STRATEGY_SOURCE_PREFIX = "strategy:"
const ICT_SOURCE_PREFIX = "ict:"

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

export type HistorySource = "my-page" | "work-management" | "fa-work-management" | "ict-work-management" | "gantt" | "other"

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

function isStrategyId(id?: string) {
  return Boolean(id?.startsWith(STRATEGY_SOURCE_PREFIX))
}

function stripStrategyId(id?: string) {
  return id?.startsWith(STRATEGY_SOURCE_PREFIX) ? id.slice(STRATEGY_SOURCE_PREFIX.length) : id
}

function stripIctId(id?: string) {
  return id?.startsWith(ICT_SOURCE_PREFIX) ? id.slice(ICT_SOURCE_PREFIX.length) : id
}

function stripSourceId(id?: string) {
  return stripStrategyId(stripIctId(id))
}

function stripSourcePrefixFromRecord(value: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...value }
  if (typeof next.projectId === "string") next.projectId = stripSourceId(next.projectId)
  if (typeof next.parentId === "string") next.parentId = stripSourceId(next.parentId)
  delete next.sourceSchedule
  delete next.originalTaskId
  delete next.originalProjectId
  return next
}

function uniqueTrimmedStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeHiddenLinkedStrategyProjectIds(value: unknown): string[] {
  return Array.isArray(value) ? uniqueTrimmedStrings(value.filter((item): item is string => typeof item === "string")) : []
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
    isSubTask: Boolean(raw?.isSubTask ?? raw?.is_sub_task ?? parentId),
    isHidden: toBooleanOr(raw?.isHidden ?? raw?.is_hidden, false),
    displayOrder: toNumberOr(raw?.displayOrder, Number.MAX_SAFE_INTEGER),
    sourceSchedule: raw?.sourceSchedule === "strategy" ? "strategy" : raw?.sourceSchedule === "ict" ? "ict" : undefined,
    originalTaskId: toOptionalString(raw?.originalTaskId),
    originalProjectId: toOptionalString(raw?.originalProjectId),
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

function isIctTask(raw: any) {
  return toStringOrEmpty(raw?.department).toUpperCase().includes("ICT")
}

function buildStrategyIctProjectTree(
  strategyProjects: any[],
  strategyTasks: any[],
  hiddenLinkedStrategyProjectIds: string[] = [],
): Project[] {
  const hiddenProjectIdSet = new Set(hiddenLinkedStrategyProjectIds.map((id) => stripStrategyId(id) || id))
  const taskById = new Map<string, any>()
  strategyTasks.forEach((task) => {
    const id = toStringOrEmpty(task.id)
    if (id) taskById.set(id, task)
  })

  const directIctTaskIds = new Set<string>()
  const includedTaskIds = new Set<string>()
  strategyTasks.forEach((task) => {
    if (!isIctTask(task)) return
    const directTaskId = toStringOrEmpty(task.id)
    if (directTaskId) directIctTaskIds.add(directTaskId)
    let current: any | undefined = task
    while (current) {
      const id = toStringOrEmpty(current.id)
      if (!id || includedTaskIds.has(id)) break
      includedTaskIds.add(id)
      const parentId = toOptionalString(current.parentId)
      current = parentId ? taskById.get(parentId) : undefined
    }
  })

  const includedTasks = strategyTasks
    .filter((task) => includedTaskIds.has(toStringOrEmpty(task.id)))
    .map((task) => ({
      ...task,
      id: `${STRATEGY_SOURCE_PREFIX}${toStringOrEmpty(task.id)}`,
      projectId: `${STRATEGY_SOURCE_PREFIX}${toStringOrEmpty(task.projectId)}`,
      parentId: toOptionalString(task.parentId) ? `${STRATEGY_SOURCE_PREFIX}${toStringOrEmpty(task.parentId)}` : undefined,
      isHidden: directIctTaskIds.has(toStringOrEmpty(task.id))
        ? toBooleanOr(task.isHidden ?? task.is_hidden, false)
        : false,
      originalTaskId: toStringOrEmpty(task.id),
      originalProjectId: toStringOrEmpty(task.projectId),
      sourceSchedule: "strategy",
    }))

  const includedProjectIds = new Set(includedTasks.map((task) => stripStrategyId(toStringOrEmpty(task.projectId))))
  const includedProjects = strategyProjects
    .filter((project) => includedProjectIds.has(toStringOrEmpty(project.id)))
    .map((project) => ({
      ...project,
      id: `${STRATEGY_SOURCE_PREFIX}${toStringOrEmpty(project.id)}`,
      isHidden: hiddenProjectIdSet.has(toStringOrEmpty(project.id)),
      originalProjectId: toStringOrEmpty(project.id),
      sourceSchedule: "strategy",
    }))

  return buildProjectTree(includedProjects, includedTasks)
}

function buildIctScheduleProjectTree(
  ictProjects: any[],
  ictTasks: any[],
  strategyProjects: any[],
  strategyTasks: any[],
  hiddenLinkedStrategyProjectIds: string[] = [],
): Project[] {
  return [
    ...buildProjectTree(ictProjects, ictTasks),
    ...buildStrategyIctProjectTree(strategyProjects, strategyTasks, hiddenLinkedStrategyProjectIds),
  ]
}

export function subscribeToData(callback: (projects: Project[]) => void) {
  const projectsQuery = collection(db, PROJECTS_COLLECTION)
  const tasksQuery = collection(db, TASKS_COLLECTION)
  const strategyProjectsQuery = collection(db, STRATEGY_PROJECTS_COLLECTION)
  const strategyTasksQuery = collection(db, STRATEGY_TASKS_COLLECTION)
  const linkedStrategyVisibilityRef = doc(db, SETTINGS_COLLECTION, LINKED_STRATEGY_PROJECT_VISIBILITY_DOC)

  let ictProjects: any[] = []
  let ictTasks: any[] = []
  let strategyProjects: any[] = []
  let strategyTasks: any[] = []
  let hiddenLinkedStrategyProjectIds: string[] = []

  const updateAndNotify = () => {
    callback(
      buildIctScheduleProjectTree(
        ictProjects,
        ictTasks,
        strategyProjects,
        strategyTasks,
        hiddenLinkedStrategyProjectIds,
      ),
    )
  }

  const unsubscribeProjects = onSnapshot(
    projectsQuery,
    (snapshot) => {
      ictProjects = snapshot.docs.map((docSnap) => ({
        ...docSnap.data(),
        id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
        originalProjectId: docSnap.id,
        sourceSchedule: "ict",
      }))
      updateAndNotify()
    },
    (error) => {
      console.error("Projects snapshot error:", error)
    },
  )

  const unsubscribeTasks = onSnapshot(
    tasksQuery,
    (snapshot) => {
      ictTasks = snapshot.docs.map((docSnap) => {
        const raw = docSnap.data()
        return {
          ...raw,
          id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
          projectId: `${ICT_SOURCE_PREFIX}${toStringOrEmpty(raw.projectId)}`,
          parentId: toOptionalString(raw.parentId) ? `${ICT_SOURCE_PREFIX}${toStringOrEmpty(raw.parentId)}` : undefined,
          originalTaskId: docSnap.id,
          originalProjectId: toStringOrEmpty(raw.projectId),
          sourceSchedule: "ict",
        }
      })
      updateAndNotify()
    },
    (error) => {
      console.error("Tasks snapshot error:", error)
    },
  )

  const unsubscribeStrategyProjects = onSnapshot(
    strategyProjectsQuery,
    (snapshot) => {
      strategyProjects = snapshot.docs.map((docSnap) => ({
        ...docSnap.data(),
        id: docSnap.id,
        originalProjectId: docSnap.id,
        sourceSchedule: "strategy",
      }))
      updateAndNotify()
    },
    (error) => {
      console.error("Strategy projects snapshot error:", error)
    },
  )

  const unsubscribeStrategyTasks = onSnapshot(
    strategyTasksQuery,
    (snapshot) => {
      strategyTasks = snapshot.docs.map((docSnap) => ({
        ...docSnap.data(),
        id: docSnap.id,
        originalTaskId: docSnap.id,
        originalProjectId: toStringOrEmpty(docSnap.data().projectId),
        sourceSchedule: "strategy",
      }))
      updateAndNotify()
    },
    (error) => {
      console.error("Strategy tasks snapshot error:", error)
    },
  )

  const unsubscribeLinkedStrategyVisibility = onSnapshot(
    linkedStrategyVisibilityRef,
    (snapshot) => {
      hiddenLinkedStrategyProjectIds = normalizeHiddenLinkedStrategyProjectIds(
        snapshot.data()?.[HIDDEN_LINKED_STRATEGY_PROJECT_IDS_FIELD],
      )
      updateAndNotify()
    },
    (error) => {
      console.error("Linked strategy project visibility snapshot error:", error)
    },
  )

  return () => {
    unsubscribeProjects()
    unsubscribeTasks()
    unsubscribeStrategyProjects()
    unsubscribeStrategyTasks()
    unsubscribeLinkedStrategyVisibility()
  }
}

export async function fetchProjectsWithTasks(): Promise<Project[]> {
  const projectsSnapshot = await getDocs(collection(db, PROJECTS_COLLECTION))
  const tasksSnapshot = await getDocs(collection(db, TASKS_COLLECTION))
  const strategyProjectsSnapshot = await getDocs(collection(db, STRATEGY_PROJECTS_COLLECTION))
  const strategyTasksSnapshot = await getDocs(collection(db, STRATEGY_TASKS_COLLECTION))
  const linkedStrategyVisibilitySnapshot = await getDoc(doc(db, SETTINGS_COLLECTION, LINKED_STRATEGY_PROJECT_VISIBILITY_DOC))

  const projectsData = projectsSnapshot.docs.map((docSnap) => ({
    ...docSnap.data(),
    id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
    originalProjectId: docSnap.id,
    sourceSchedule: "ict",
  }))
  const tasksData = tasksSnapshot.docs.map((docSnap) => {
    const raw = docSnap.data()
    return {
      ...raw,
      id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
      projectId: `${ICT_SOURCE_PREFIX}${toStringOrEmpty(raw.projectId)}`,
      parentId: toOptionalString(raw.parentId) ? `${ICT_SOURCE_PREFIX}${toStringOrEmpty(raw.parentId)}` : undefined,
      originalTaskId: docSnap.id,
      originalProjectId: toStringOrEmpty(raw.projectId),
      sourceSchedule: "ict",
    }
  })
  const strategyProjectsData = strategyProjectsSnapshot.docs.map((docSnap) => ({
    ...docSnap.data(),
    id: docSnap.id,
    originalProjectId: docSnap.id,
    sourceSchedule: "strategy",
  }))
  const strategyTasksData = strategyTasksSnapshot.docs.map((docSnap) => ({
    ...docSnap.data(),
    id: docSnap.id,
    originalTaskId: docSnap.id,
    originalProjectId: toStringOrEmpty(docSnap.data().projectId),
    sourceSchedule: "strategy",
  }))

  const hiddenLinkedStrategyProjectIds = normalizeHiddenLinkedStrategyProjectIds(
    linkedStrategyVisibilitySnapshot.data()?.[HIDDEN_LINKED_STRATEGY_PROJECT_IDS_FIELD],
  )

  return buildIctScheduleProjectTree(
    projectsData,
    tasksData,
    strategyProjectsData,
    strategyTasksData,
    hiddenLinkedStrategyProjectIds,
  )
}

export async function addProjectToDB(project: Omit<Project, "id" | "tasks">): Promise<string> {
  const docRef = await addDoc(collection(db, PROJECTS_COLLECTION), {
    ...stripSourcePrefixFromRecord(project as Record<string, unknown>),
    displayOrder: Date.now(),
    createdAt: serverTimestamp(),
  })
  return `${ICT_SOURCE_PREFIX}${docRef.id}`
}

async function updateLinkedStrategyProjectVisibility(projectId: string, isHidden: boolean): Promise<void> {
  const sourceProjectId = stripStrategyId(projectId) || projectId
  const visibilityRef = doc(db, SETTINGS_COLLECTION, LINKED_STRATEGY_PROJECT_VISIBILITY_DOC)
  await setDoc(
    visibilityRef,
    {
      [HIDDEN_LINKED_STRATEGY_PROJECT_IDS_FIELD]: isHidden
        ? arrayUnion(sourceProjectId)
        : arrayRemove(sourceProjectId),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

function isLinkedStrategyProjectVisibilityHistoryEntry(entry: HistoryEntryInput | ChangeHistoryEntry) {
  return (
    entry.entityType === "project" &&
    entry.action === "update" &&
    isStrategyId(entry.entityId) &&
    typeof entry.before?.isHidden === "boolean" &&
    typeof entry.after?.isHidden === "boolean"
  )
}

export async function updateProjectInDB(projectId: string, updates: Partial<Project>): Promise<void> {
  if (isStrategyId(projectId)) {
    const updateKeys = Object.keys(updates).filter(
      (key) => !["id", "tasks", "sourceSchedule", "originalProjectId"].includes(key),
    )
    if (updateKeys.length === 1 && updateKeys[0] === "isHidden" && typeof updates.isHidden === "boolean") {
      await updateLinkedStrategyProjectVisibility(projectId, updates.isHidden)
      return
    }
    throw new Error("Linked strategy projects cannot be edited from ICT schedule.")
  }
  const projectRef = doc(db, PROJECTS_COLLECTION, stripIctId(projectId) || projectId)
  await updateDoc(projectRef, stripSourcePrefixFromRecord(updates as Record<string, unknown>) as any)
}

export async function deleteProjectFromDB(projectId: string): Promise<void> {
  if (isStrategyId(projectId)) {
    throw new Error("Linked strategy projects cannot be deleted from ICT schedule.")
  }
  const sourceProjectId = stripIctId(projectId) || projectId
  const tasksQ = query(collection(db, TASKS_COLLECTION), where("projectId", "==", sourceProjectId))
  const tasksSnapshot = await getDocs(tasksQ)
  const batch = writeBatch(db)

  tasksSnapshot.docs.forEach((taskDoc) => {
    batch.delete(taskDoc.ref)
  })

  batch.delete(doc(db, PROJECTS_COLLECTION, sourceProjectId))
  await batch.commit()
}

export async function addTaskToDB(task: Omit<Task, "id">): Promise<string> {
  const isStrategyTask = isStrategyId(task.projectId)
  const targetCollection = isStrategyTask ? STRATEGY_TASKS_COLLECTION : TASKS_COLLECTION
  const cleanTask = stripSourcePrefixFromRecord(task as unknown as Record<string, unknown>)
  const docRef = await addDoc(collection(db, targetCollection), {
    ...cleanTask,
    displayOrder: typeof task.displayOrder === "number" ? task.displayOrder : Date.now(),
  })
  return `${isStrategyTask ? STRATEGY_SOURCE_PREFIX : ICT_SOURCE_PREFIX}${docRef.id}`
}

export async function updateTaskInDB(taskId: string, updates: Omit<Partial<Task>, "parentId"> & { parentId?: string | null }): Promise<void> {
  const isStrategyTask = isStrategyId(taskId)
  const taskRef = doc(db, isStrategyTask ? STRATEGY_TASKS_COLLECTION : TASKS_COLLECTION, stripSourceId(taskId) || taskId)
  await updateDoc(taskRef, stripSourcePrefixFromRecord(updates as Record<string, unknown>) as any)
}

export async function deleteTaskFromDB(taskId: string): Promise<void> {
  if (isStrategyId(taskId)) {
    throw new Error("Linked strategy tasks cannot be deleted from ICT schedule.")
  }
  const taskRef = doc(db, TASKS_COLLECTION, stripIctId(taskId) || taskId)
  await deleteDoc(taskRef)
}

export async function updateProjectOrdersInDB(projectIds: string[]): Promise<void> {
  const batch = writeBatch(db)
  projectIds.filter((id) => !isStrategyId(id)).forEach((id, index) => {
    batch.update(doc(db, PROJECTS_COLLECTION, stripIctId(id) || id), { displayOrder: index })
  })
  await batch.commit()
}

export async function updateTaskOrdersInDB(taskIds: string[]): Promise<void> {
  const batch = writeBatch(db)
  taskIds.forEach((id, index) => {
    const isStrategyTask = isStrategyId(id)
    batch.update(doc(db, isStrategyTask ? STRATEGY_TASKS_COLLECTION : TASKS_COLLECTION, stripSourceId(id) || id), { displayOrder: index })
  })
  await batch.commit()
}

export async function addHistoryEntry(entry: HistoryEntryInput): Promise<string> {
  const actorEmail = toOptionalString(entry.actorEmail)
  const notificationFields = buildHistoryNotificationFields(entry)
  if (isLinkedStrategyProjectVisibilityHistoryEntry(entry)) {
    const payload = compactObject({
      ...entry,
      linkedStrategyProject: true,
      entityId: stripStrategyId(entry.entityId),
      projectId: stripStrategyId(entry.projectId),
      before: entry.before ? stripSourcePrefixFromRecord(entry.before) : undefined,
      after: entry.after ? stripSourcePrefixFromRecord(entry.after) : undefined,
      actorEmail: actorEmail ? normalizeEmail(actorEmail) : undefined,
      actorName: toOptionalString(entry.actorName),
      notificationPersonKeys: notificationFields.notificationPersonKeys,
      notificationDepartmentGroups: notificationFields.notificationDepartmentGroups,
      createdAt: serverTimestamp(),
    })
    const docRef = await addDoc(collection(db, HISTORY_COLLECTION), payload)
    return `${ICT_SOURCE_PREFIX}${docRef.id}`
  }
  if (isStrategyId(entry.entityId) || isStrategyId(entry.projectId)) {
    const strategyEntry = {
      ...entry,
      entityId: stripStrategyId(entry.entityId),
      projectId: stripStrategyId(entry.projectId),
      before: entry.before ? stripSourcePrefixFromRecord(entry.before) : undefined,
      after: entry.after ? stripSourcePrefixFromRecord(entry.after) : undefined,
      batch: entry.batch?.map((item) => ({
        ...item,
        entityId: stripStrategyId(item.entityId) || item.entityId,
        before: item.before ? stripSourcePrefixFromRecord(item.before) : undefined,
        after: item.after ? stripSourcePrefixFromRecord(item.after) : undefined,
      })),
      source: "ict-work-management" as HistorySource,
    }
    const id = await addStrategyHistoryEntry(strategyEntry as any)
    return `${STRATEGY_SOURCE_PREFIX}${id}`
  }
  const payload = compactObject({
    ...entry,
    entityId: stripIctId(entry.entityId),
    projectId: stripIctId(entry.projectId),
    before: entry.before ? stripSourcePrefixFromRecord(entry.before) : undefined,
    after: entry.after ? stripSourcePrefixFromRecord(entry.after) : undefined,
    batch: entry.batch?.map((item) => ({
      ...item,
      entityId: stripIctId(item.entityId) || item.entityId,
      before: item.before ? stripSourcePrefixFromRecord(item.before) : undefined,
      after: item.after ? stripSourcePrefixFromRecord(item.after) : undefined,
    })),
    actorEmail: actorEmail ? normalizeEmail(actorEmail) : undefined,
    actorName: toOptionalString(entry.actorName),
    notificationPersonKeys: notificationFields.notificationPersonKeys,
    notificationDepartmentGroups: notificationFields.notificationDepartmentGroups,
    createdAt: serverTimestamp(),
  })
  const docRef = await addDoc(collection(db, HISTORY_COLLECTION), payload)
  return `${ICT_SOURCE_PREFIX}${docRef.id}`
}

function mapIctHistoryDoc(docSnap: { id: string; data: () => any }): ChangeHistoryEntry {
  const raw = docSnap.data()
  const entityPrefix = raw?.linkedStrategyProject ? STRATEGY_SOURCE_PREFIX : ICT_SOURCE_PREFIX
  return {
    id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
    entityType: (toStringOrEmpty(raw?.entityType) as HistoryEntityType) || "batch",
    action: (toStringOrEmpty(raw?.action) as HistoryActionType) || "batch_update",
    actorEmail: toOptionalString(raw?.actorEmail),
    actorName: toOptionalString(raw?.actorName),
    entityId: toOptionalString(raw?.entityId) ? `${entityPrefix}${toStringOrEmpty(raw?.entityId)}` : undefined,
    projectId: toOptionalString(raw?.projectId) ? `${entityPrefix}${toStringOrEmpty(raw?.projectId)}` : undefined,
    before: (raw?.before as Record<string, unknown> | undefined) || undefined,
    after: (raw?.after as Record<string, unknown> | undefined) || undefined,
    batch: Array.isArray(raw?.batch)
      ? raw.batch.map((item: HistoryBatchItem) => ({
          ...item,
          entityId: `${entityPrefix}${item.entityId}`,
        }))
      : undefined,
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

function mapStrategyHistoryDoc(docSnap: { id: string; data: () => any }): ChangeHistoryEntry {
  const raw = docSnap.data()
  return {
    id: `${STRATEGY_SOURCE_PREFIX}${docSnap.id}`,
    entityType: (toStringOrEmpty(raw?.entityType) as HistoryEntityType) || "batch",
    action: (toStringOrEmpty(raw?.action) as HistoryActionType) || "batch_update",
    actorEmail: toOptionalString(raw?.actorEmail),
    actorName: toOptionalString(raw?.actorName),
    entityId: toOptionalString(raw?.entityId) ? `${STRATEGY_SOURCE_PREFIX}${toStringOrEmpty(raw?.entityId)}` : undefined,
    projectId: toOptionalString(raw?.projectId) ? `${STRATEGY_SOURCE_PREFIX}${toStringOrEmpty(raw?.projectId)}` : undefined,
    before: (raw?.before as Record<string, unknown> | undefined) || undefined,
    after: (raw?.after as Record<string, unknown> | undefined) || undefined,
    batch: Array.isArray(raw?.batch)
      ? raw.batch.map((item: HistoryBatchItem) => ({
          ...item,
          entityId: `${STRATEGY_SOURCE_PREFIX}${item.entityId}`,
        }))
      : undefined,
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

function mergeHistoryEntries(entries: ChangeHistoryEntry[], limitCount: number) {
  const byId = new Map<string, ChangeHistoryEntry>()
  entries.forEach((entry) => byId.set(entry.id, entry))
  return Array.from(byId.values())
    .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))
    .slice(0, limitCount)
}

export async function fetchHistoryEntries(limitCount = 30, actorEmail?: string): Promise<ChangeHistoryEntry[]> {
  const normalizedActorEmail = actorEmail ? normalizeEmail(actorEmail) : ""
  const ictHistoryQ = normalizedActorEmail
    ? query(
        collection(db, HISTORY_COLLECTION),
        where("actorEmail", "==", normalizedActorEmail),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      )
    : query(collection(db, HISTORY_COLLECTION), orderBy("createdAt", "desc"), limit(limitCount))
  const strategyHistoryQ = normalizedActorEmail
    ? query(
        collection(db, "history"),
        where("source", "==", "ict-work-management"),
        where("actorEmail", "==", normalizedActorEmail),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      )
    : query(
        collection(db, "history"),
        where("source", "==", "ict-work-management"),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      )
  const [snapshot, strategySnapshot] = await Promise.all([getDocs(ictHistoryQ), getDocs(strategyHistoryQ)])
  return mergeHistoryEntries(
    [...snapshot.docs.map(mapIctHistoryDoc), ...strategySnapshot.docs.map(mapStrategyHistoryDoc)],
    limitCount,
  )
}

export async function fetchNotificationHistoryEntries(
  limitCount = 30,
  filter: HistoryNotificationFilter = {},
): Promise<ChangeHistoryEntry[]> {
  const personKeys = buildPersonKeys(filter.personKeys || []).slice(0, 30)
  const departmentGroups = (filter.departmentGroups || []).slice(0, 30)
  const historyQueries: Array<{ source: "ict" | "strategy"; query: any }> = []

  if (personKeys.length > 0) {
    historyQueries.push({
      source: "ict",
      query: query(
        collection(db, HISTORY_COLLECTION),
        where("notificationPersonKeys", "array-contains-any", personKeys),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      ),
    })
    historyQueries.push({
      source: "strategy",
      query: query(
        collection(db, "history"),
        where("source", "==", "ict-work-management"),
        where("notificationPersonKeys", "array-contains-any", personKeys),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      ),
    })
  }

  if (departmentGroups.length > 0) {
    historyQueries.push({
      source: "ict",
      query: query(
        collection(db, HISTORY_COLLECTION),
        where("notificationDepartmentGroups", "array-contains-any", departmentGroups),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      ),
    })
    historyQueries.push({
      source: "strategy",
      query: query(
        collection(db, "history"),
        where("source", "==", "ict-work-management"),
        where("notificationDepartmentGroups", "array-contains-any", departmentGroups),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      ),
    })
  }

  if (historyQueries.length === 0) return []
  const snapshots = await Promise.all(historyQueries.map((item) => getDocs(item.query)))
  const entries = snapshots.flatMap((snapshot, index) =>
    snapshot.docs.map(historyQueries[index].source === "strategy" ? mapStrategyHistoryDoc : mapIctHistoryDoc),
  )
  return mergeHistoryEntries(entries, limitCount)
}

function getCollectionForEntity(entityType: "project" | "task") {
  return entityType === "project" ? PROJECTS_COLLECTION : TASKS_COLLECTION
}

async function rollbackSingle(entry: ChangeHistoryEntry): Promise<void> {
  const entityType = entry.entityType === "project" ? "project" : "task"
  if (!entry.entityId) return

  const targetRef = doc(db, getCollectionForEntity(entityType), stripIctId(entry.entityId) || entry.entityId)
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
  if (isLinkedStrategyProjectVisibilityHistoryEntry(entry) && entry.entityId) {
    await updateLinkedStrategyProjectVisibility(entry.entityId, Boolean(entry.before?.isHidden))
    return
  }

  if (isStrategyId(entry.id) || isStrategyId(entry.entityId) || isStrategyId(entry.projectId)) {
    await rollbackStrategyHistoryEntry({
      ...entry,
      id: stripStrategyId(entry.id) || entry.id,
      entityId: stripStrategyId(entry.entityId),
      projectId: stripStrategyId(entry.projectId),
      batch: entry.batch?.map((item) => ({
        ...item,
        entityId: stripStrategyId(item.entityId) || item.entityId,
      })),
    } as any)
    return
  }

  if (entry.entityType === "batch" && entry.action === "batch_update" && entry.batch?.length) {
    await Promise.all(
      entry.batch.map(async (item) => {
        if (!item.before) return
        const ref = doc(db, getCollectionForEntity(item.entityType), stripIctId(item.entityId) || item.entityId)
        await updateDoc(ref, compactObject(item.before) as any)
      }),
    )
    return
  }

  if (entry.entityType === "project_bundle" && entry.action === "project_delete" && entry.before) {
    const project = entry.before.project as { id?: string; data?: Record<string, unknown> } | undefined
    const tasks = (entry.before.tasks as Array<{ id: string; data: Record<string, unknown> }> | undefined) || []
    if (!project?.id || !project.data) return

    await setDoc(doc(db, PROJECTS_COLLECTION, stripIctId(project.id) || project.id), compactObject(project.data))
    await Promise.all(
      tasks.map((task) => setDoc(doc(db, TASKS_COLLECTION, stripIctId(task.id) || task.id), compactObject(task.data))),
    )
    return
  }

  if (entry.entityType === "project" || entry.entityType === "task") {
    await rollbackSingle(entry)
  }
}

export async function deleteHistoryEntry(entryId: string): Promise<void> {
  if (isStrategyId(entryId)) {
    await deleteStrategyHistoryEntry(stripStrategyId(entryId) || entryId)
    return
  }
  await deleteDoc(doc(db, HISTORY_COLLECTION, stripIctId(entryId) || entryId))
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
      const profile = snapshot.data() as { ictGanttCollapseState?: Partial<Record<keyof GanttCollapseState, unknown>> } | undefined
      const raw = profile?.[ICT_GANTT_COLLAPSE_STATE_FIELD]
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
      [ICT_GANTT_COLLAPSE_STATE_FIELD]: normalizeGanttCollapseState(state),
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
      const profile = snapshot.data() as { ictGanttLeftPanelWidth?: unknown } | undefined
      const raw = profile?.[ICT_GANTT_LEFT_PANEL_WIDTH_FIELD]
      const width = toNumberOr(raw, DEFAULT_GANTT_LEFT_PANEL_WIDTH)
      callback(width > 0 ? width : null)
    },
    (error) => {
      console.error("ICT gantt left panel width snapshot error:", error)
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
      [ICT_GANTT_LEFT_PANEL_WIDTH_FIELD]: normalizedWidth,
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
      const profile = snapshot.data() as { ictGanttDetailPanelWidth?: unknown } | undefined
      const raw = profile?.[ICT_GANTT_DETAIL_PANEL_WIDTH_FIELD]
      const width = toNumberOr(raw, DEFAULT_GANTT_DETAIL_PANEL_WIDTH)
      callback(width > 0 ? width : null)
    },
    (error) => {
      console.error("ICT gantt detail panel width snapshot error:", error)
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
      [ICT_GANTT_DETAIL_PANEL_WIDTH_FIELD]: normalizedWidth,
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
