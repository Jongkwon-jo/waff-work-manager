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
import { buildTaskPersonKeys, buildTaskPersonKeysFromValues } from "./task-person-keys"

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

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size))
  return chunks
}

async function fetchParentTaskChain(
  tasksById: Map<string, any>,
  collectionName: string,
  prefix = "",
) {
  const pendingParentIds = new Set<string>()
  tasksById.forEach((task) => {
    const parentId = stripSourceId(toOptionalString(task.parentId)) || toOptionalString(task.parentId)
    if (parentId && !tasksById.has(`${prefix}${parentId}`) && !tasksById.has(parentId)) pendingParentIds.add(parentId)
  })

  while (pendingParentIds.size > 0) {
    const parentId = pendingParentIds.values().next().value as string
    pendingParentIds.delete(parentId)
    const mapId = `${prefix}${parentId}`
    if (tasksById.has(mapId) || tasksById.has(parentId)) continue

    const parentSnap = await getDoc(doc(db, collectionName, parentId))
    if (!parentSnap.exists()) continue

    const parentTask = {
      ...parentSnap.data(),
      id: mapId,
      parentId: toOptionalString(parentSnap.data().parentId)
        ? `${prefix}${toStringOrEmpty(parentSnap.data().parentId)}`
        : undefined,
      projectId: `${prefix}${toStringOrEmpty(parentSnap.data().projectId)}`,
      sourceSchedule: prefix === STRATEGY_SOURCE_PREFIX ? "strategy" : "ict",
      originalTaskId: parentSnap.id,
      originalProjectId: toStringOrEmpty(parentSnap.data().projectId),
    }
    tasksById.set(mapId, parentTask)

    const nextParentId = toOptionalString(parentSnap.data().parentId)
    if (nextParentId && !tasksById.has(`${prefix}${nextParentId}`)) pendingParentIds.add(nextParentId)
  }
}

async function fetchRawParentTaskChain(tasksById: Map<string, any>, collectionName: string) {
  const pendingParentIds = new Set<string>()
  tasksById.forEach((task) => {
    const parentId = toOptionalString(task.parentId)
    if (parentId && !tasksById.has(parentId)) pendingParentIds.add(parentId)
  })

  while (pendingParentIds.size > 0) {
    const parentId = pendingParentIds.values().next().value as string
    pendingParentIds.delete(parentId)
    if (tasksById.has(parentId)) continue

    const parentSnap = await getDoc(doc(db, collectionName, parentId))
    if (!parentSnap.exists()) continue

    const parentTask: any = { ...parentSnap.data(), id: parentSnap.id }
    tasksById.set(parentSnap.id, parentTask)

    const nextParentId = toOptionalString(parentTask.parentId)
    if (nextParentId && !tasksById.has(nextParentId)) pendingParentIds.add(nextParentId)
  }
}

async function fetchProjectsForTaskIds(projectIds: string[], collectionName: string, prefix = "") {
  const uniqueProjectIds = Array.from(new Set(projectIds.map((id) => stripSourceId(id) || id).filter(Boolean)))
  const projectsData = await Promise.all(
    uniqueProjectIds.map(async (projectId) => {
      const projectSnap = await getDoc(doc(db, collectionName, projectId))
      if (!projectSnap.exists()) return null
      return {
        ...projectSnap.data(),
        id: `${prefix}${projectSnap.id}`,
        sourceSchedule: prefix === STRATEGY_SOURCE_PREFIX ? "strategy" : "ict",
        originalProjectId: projectSnap.id,
      }
    }),
  )
  return projectsData.filter((project): project is any => Boolean(project))
}

export type SubscribeOptions = {
  /**
   * When false (default), excludes docs with `isHidden == true` from the
   * underlying Firestore queries so they don't count toward read quota.
   * Set true to also stream hidden docs (composite indexes required).
   */
  includeHidden?: boolean
}

export function subscribeProjectsWithTasksByPersonKeys(
  personKeys: string[],
  callback: (projects: Project[]) => void,
  options: SubscribeOptions = {},
) {
  const includeHidden = options.includeHidden === true
  const queryKeys = buildTaskPersonKeysFromValues(personKeys).slice(0, 300)
  if (queryKeys.length === 0) {
    callback([])
    return () => {}
  }

  const chunks = chunkValues(queryKeys, 30)
  const ictTaskGroups = new Map<number, any[]>()
  const strategyTaskGroups = new Map<number, any[]>()
  let disposed = false

  const notify = async () => {
    const ictTasksById = new Map<string, any>()
    ictTaskGroups.forEach((tasks) => tasks.forEach((task) => ictTasksById.set(task.id, task)))
    await fetchParentTaskChain(ictTasksById, TASKS_COLLECTION, ICT_SOURCE_PREFIX)

    const strategyTasksById = new Map<string, any>()
    strategyTaskGroups.forEach((tasks) => tasks.forEach((task) => strategyTasksById.set(task.id, task)))
    await fetchParentTaskChain(strategyTasksById, STRATEGY_TASKS_COLLECTION, STRATEGY_SOURCE_PREFIX)

    const ictTasks = Array.from(ictTasksById.values())
    const strategyTasks = Array.from(strategyTasksById.values())
    const ictProjects = await fetchProjectsForTaskIds(
      ictTasks.map((task) => toStringOrEmpty(task.projectId)),
      PROJECTS_COLLECTION,
      ICT_SOURCE_PREFIX,
    )
    const strategyProjects = await fetchProjectsForTaskIds(
      strategyTasks.map((task) => toStringOrEmpty(task.projectId)),
      STRATEGY_PROJECTS_COLLECTION,
      STRATEGY_SOURCE_PREFIX,
    )

    if (!disposed) callback(buildProjectTree([...ictProjects, ...strategyProjects], [...ictTasks, ...strategyTasks]))
  }

  const unsubscribes = chunks.flatMap((chunk, index) => {
    const ictConstraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    if (!includeHidden) ictConstraints.push(where("isHidden", "==", false))
    const strategyConstraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    if (!includeHidden) strategyConstraints.push(where("isHidden", "==", false))
    return [
      onSnapshot(
        query(collection(db, TASKS_COLLECTION), ...ictConstraints),
        (snapshot) => {
          ictTaskGroups.set(
            index,
            snapshot.docs.map((docSnap) => ({
              ...docSnap.data(),
              id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
              parentId: toOptionalString(docSnap.data().parentId) ? `${ICT_SOURCE_PREFIX}${toStringOrEmpty(docSnap.data().parentId)}` : undefined,
              projectId: `${ICT_SOURCE_PREFIX}${toStringOrEmpty(docSnap.data().projectId)}`,
              sourceSchedule: "ict",
              originalTaskId: docSnap.id,
              originalProjectId: toStringOrEmpty(docSnap.data().projectId),
            })),
          )
          void notify().catch((error) => console.error("Scoped ICT data snapshot error:", error))
        },
        (error) => console.error("Scoped ICT tasks snapshot error:", error),
      ),
      onSnapshot(
        query(collection(db, STRATEGY_TASKS_COLLECTION), ...strategyConstraints),
        (snapshot) => {
          strategyTaskGroups.set(
            index,
            snapshot.docs
              .filter((docSnap) => isIctTask(docSnap.data()))
              .map((docSnap) => ({
                ...docSnap.data(),
                id: `${STRATEGY_SOURCE_PREFIX}${docSnap.id}`,
                parentId: toOptionalString(docSnap.data().parentId)
                  ? `${STRATEGY_SOURCE_PREFIX}${toStringOrEmpty(docSnap.data().parentId)}`
                  : undefined,
                projectId: `${STRATEGY_SOURCE_PREFIX}${toStringOrEmpty(docSnap.data().projectId)}`,
                sourceSchedule: "strategy",
                originalTaskId: docSnap.id,
                originalProjectId: toStringOrEmpty(docSnap.data().projectId),
              })),
          )
          void notify().catch((error) => console.error("Scoped linked strategy data snapshot error:", error))
        },
        (error) => console.error("Scoped linked strategy tasks snapshot error:", error),
      ),
    ]
  })

  return () => {
    disposed = true
    unsubscribes.forEach((unsubscribe) => unsubscribe())
  }
}

export type ScheduleScopeOptions = {
  personKeys?: string[]
  pmEmail?: string
  includeAll?: boolean
  includeHidden?: boolean
}

export function subscribeProjectsWithTasksByScheduleScope(
  scope: ScheduleScopeOptions,
  callback: (projects: Project[]) => void,
) {
  const includeHidden = scope.includeHidden === true
  if (scope.includeAll) return subscribeToData(callback, { includeHidden })

  const queryKeys = buildTaskPersonKeysFromValues(scope.personKeys || []).slice(0, 300)
  const normalizedPmEmail = normalizeEmail(scope.pmEmail || "")
  if (queryKeys.length === 0 && !normalizedPmEmail) {
    callback([])
    return () => {}
  }

  const ictTaskGroups = new Map<string, any[]>()
  const strategyTaskGroups = new Map<string, any[]>()
  const ictPmProjectsById = new Map<string, any>()
  const strategyPmProjectsById = new Map<string, any>()
  let ictPmTaskUnsubscribes: Array<() => void> = []
  let strategyPmTaskUnsubscribes: Array<() => void> = []
  let hiddenLinkedStrategyProjectIds: string[] = []
  let disposed = false
  let notifyToken = 0

  const notify = async () => {
    const currentToken = ++notifyToken

    const ictTasksById = new Map<string, any>()
    ictTaskGroups.forEach((tasks) => tasks.forEach((task) => ictTasksById.set(task.id, task)))
    await fetchParentTaskChain(ictTasksById, TASKS_COLLECTION, ICT_SOURCE_PREFIX)

    const strategyTasksById = new Map<string, any>()
    strategyTaskGroups.forEach((tasks) => tasks.forEach((task) => strategyTasksById.set(task.id, task)))
    await fetchRawParentTaskChain(strategyTasksById, STRATEGY_TASKS_COLLECTION)

    const ictTasks = Array.from(ictTasksById.values())
    const strategyTasks = Array.from(strategyTasksById.values())
    const ictRelatedProjects = await fetchProjectsForTaskIds(
      ictTasks.map((task) => toStringOrEmpty(task.projectId)),
      PROJECTS_COLLECTION,
      ICT_SOURCE_PREFIX,
    )
    const strategyRelatedProjects = await fetchProjectsForTaskIds(
      strategyTasks.map((task) => toStringOrEmpty(task.projectId)),
      STRATEGY_PROJECTS_COLLECTION,
    )

    const ictProjectsById = new Map<string, any>()
    ictRelatedProjects.forEach((project) => ictProjectsById.set(toStringOrEmpty(project.id), project))
    ictPmProjectsById.forEach((project, projectId) => ictProjectsById.set(projectId, project))

    const strategyProjectsById = new Map<string, any>()
    strategyRelatedProjects.forEach((project) => strategyProjectsById.set(stripSourceId(toStringOrEmpty(project.id)) || toStringOrEmpty(project.id), project))
    strategyPmProjectsById.forEach((project, projectId) => strategyProjectsById.set(projectId, project))

    if (!disposed && currentToken === notifyToken) {
      callback(
        buildIctScheduleProjectTree(
          Array.from(ictProjectsById.values()),
          ictTasks,
          Array.from(strategyProjectsById.values()),
          strategyTasks,
          hiddenLinkedStrategyProjectIds,
        ),
      )
    }
  }

  const mapIctTaskDoc = (docSnap: any) => {
    const raw = docSnap.data()
    return {
      ...raw,
      id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
      parentId: toOptionalString(raw.parentId) ? `${ICT_SOURCE_PREFIX}${toStringOrEmpty(raw.parentId)}` : undefined,
      projectId: `${ICT_SOURCE_PREFIX}${toStringOrEmpty(raw.projectId)}`,
      sourceSchedule: "ict",
      originalTaskId: docSnap.id,
      originalProjectId: toStringOrEmpty(raw.projectId),
    }
  }

  const resetIctPmTaskSubscriptions = (projectIds: string[]) => {
    ictPmTaskUnsubscribes.forEach((unsubscribe) => unsubscribe())
    ictPmTaskUnsubscribes = []
    Array.from(ictTaskGroups.keys())
      .filter((key) => key.startsWith("pm:"))
      .forEach((key) => ictTaskGroups.delete(key))

    const chunks = chunkValues(projectIds, 30)
    if (chunks.length === 0) {
      void notify().catch((error) => {
        console.error("Schedule PM ICT data snapshot error:", error)
        if (!disposed) callback([])
      })
      return
    }

    ictPmTaskUnsubscribes = chunks.map((chunk, index) => {
      const constraints: any[] = [where("projectId", "in", chunk)]
      if (!includeHidden) constraints.push(where("isHidden", "==", false))
      return onSnapshot(
        query(collection(db, TASKS_COLLECTION), ...constraints),
        (snapshot) => {
          ictTaskGroups.set(`pm:${index}`, snapshot.docs.map(mapIctTaskDoc))
          void notify().catch((error) => {
            console.error("Schedule PM ICT data snapshot error:", error)
            if (!disposed) callback([])
          })
        },
        (error) => {
          console.error("Schedule PM ICT tasks snapshot error:", error)
        },
      )
    })
  }

  const resetStrategyPmTaskSubscriptions = (projectIds: string[]) => {
    strategyPmTaskUnsubscribes.forEach((unsubscribe) => unsubscribe())
    strategyPmTaskUnsubscribes = []
    Array.from(strategyTaskGroups.keys())
      .filter((key) => key.startsWith("pm:"))
      .forEach((key) => strategyTaskGroups.delete(key))

    const chunks = chunkValues(projectIds, 30)
    if (chunks.length === 0) {
      void notify().catch((error) => {
        console.error("Schedule PM linked strategy data snapshot error:", error)
        if (!disposed) callback([])
      })
      return
    }

    strategyPmTaskUnsubscribes = chunks.map((chunk, index) => {
      const constraints: any[] = [where("projectId", "in", chunk)]
      if (!includeHidden) constraints.push(where("isHidden", "==", false))
      return onSnapshot(
        query(collection(db, STRATEGY_TASKS_COLLECTION), ...constraints),
        (snapshot) => {
          strategyTaskGroups.set(`pm:${index}`, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
          void notify().catch((error) => {
            console.error("Schedule PM linked strategy data snapshot error:", error)
            if (!disposed) callback([])
          })
        },
        (error) => {
          console.error("Schedule PM linked strategy tasks snapshot error:", error)
        },
      )
    })
  }

  const unsubscribes: Array<() => void> = [
    onSnapshot(
      doc(db, SETTINGS_COLLECTION, LINKED_STRATEGY_PROJECT_VISIBILITY_DOC),
      (snapshot) => {
        hiddenLinkedStrategyProjectIds = normalizeHiddenLinkedStrategyProjectIds(
          snapshot.data()?.[HIDDEN_LINKED_STRATEGY_PROJECT_IDS_FIELD],
        )
        void notify().catch((error) => {
          console.error("Schedule ICT visibility snapshot error:", error)
        })
      },
      (error) => {
        console.error("Schedule ICT visibility snapshot error:", error)
      },
    ),
  ]

  chunkValues(queryKeys, 30).forEach((chunk, index) => {
    const ictConstraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    if (!includeHidden) ictConstraints.push(where("isHidden", "==", false))
    const strategyConstraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    if (!includeHidden) strategyConstraints.push(where("isHidden", "==", false))
    unsubscribes.push(
      onSnapshot(
        query(collection(db, TASKS_COLLECTION), ...ictConstraints),
        (snapshot) => {
          ictTaskGroups.set(`person:${index}`, snapshot.docs.map(mapIctTaskDoc))
          void notify().catch((error) => {
            console.error("Schedule assignee ICT data snapshot error:", error)
            if (!disposed) callback([])
          })
        },
        (error) => {
          console.error("Schedule assignee ICT tasks snapshot error:", error)
        },
      ),
      onSnapshot(
        query(collection(db, STRATEGY_TASKS_COLLECTION), ...strategyConstraints),
        (snapshot) => {
          strategyTaskGroups.set(
            `person:${index}`,
            snapshot.docs
              .filter((docSnap) => isIctTask(docSnap.data()))
              .map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })),
          )
          void notify().catch((error) => {
            console.error("Schedule assignee linked strategy data snapshot error:", error)
            if (!disposed) callback([])
          })
        },
        (error) => {
          console.error("Schedule assignee linked strategy tasks snapshot error:", error)
        },
      ),
    )
  })

  if (normalizedPmEmail) {
    const ictProjectConstraints: any[] = [where("pmEmail", "==", normalizedPmEmail)]
    if (!includeHidden) ictProjectConstraints.push(where("isHidden", "==", false))
    const strategyProjectConstraints: any[] = [where("pmEmail", "==", normalizedPmEmail)]
    if (!includeHidden) strategyProjectConstraints.push(where("isHidden", "==", false))
    unsubscribes.push(
      onSnapshot(
        query(collection(db, PROJECTS_COLLECTION), ...ictProjectConstraints),
        (snapshot) => {
          ictPmProjectsById.clear()
          snapshot.docs.forEach((docSnap) => {
            ictPmProjectsById.set(`${ICT_SOURCE_PREFIX}${docSnap.id}`, {
              ...docSnap.data(),
              id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
              originalProjectId: docSnap.id,
              sourceSchedule: "ict",
            })
          })
          resetIctPmTaskSubscriptions(snapshot.docs.map((docSnap) => docSnap.id))
        },
        (error) => {
          console.error("Schedule PM ICT projects snapshot error:", error)
        },
      ),
      onSnapshot(
        query(collection(db, STRATEGY_PROJECTS_COLLECTION), ...strategyProjectConstraints),
        (snapshot) => {
          strategyPmProjectsById.clear()
          snapshot.docs.forEach((docSnap) => {
            strategyPmProjectsById.set(docSnap.id, {
              ...docSnap.data(),
              id: docSnap.id,
              originalProjectId: docSnap.id,
              sourceSchedule: "strategy",
            })
          })
          resetStrategyPmTaskSubscriptions(snapshot.docs.map((docSnap) => docSnap.id))
        },
        (error) => {
          console.error("Schedule PM linked strategy projects snapshot error:", error)
        },
      ),
    )
  }

  return () => {
    disposed = true
    unsubscribes.forEach((unsubscribe) => unsubscribe())
    ictPmTaskUnsubscribes.forEach((unsubscribe) => unsubscribe())
    strategyPmTaskUnsubscribes.forEach((unsubscribe) => unsubscribe())
  }
}

export function subscribeToData(
  callback: (projects: Project[]) => void,
  options: SubscribeOptions = {},
) {
  const includeHidden = options.includeHidden === true
  const projectsQuery = includeHidden
    ? query(collection(db, PROJECTS_COLLECTION))
    : query(collection(db, PROJECTS_COLLECTION), where("isHidden", "==", false))
  const tasksQuery = includeHidden
    ? query(collection(db, TASKS_COLLECTION))
    : query(collection(db, TASKS_COLLECTION), where("isHidden", "==", false))
  const strategyProjectsQuery = includeHidden
    ? query(collection(db, STRATEGY_PROJECTS_COLLECTION))
    : query(collection(db, STRATEGY_PROJECTS_COLLECTION), where("isHidden", "==", false))
  const strategyTasksQuery = includeHidden
    ? query(collection(db, STRATEGY_TASKS_COLLECTION))
    : query(collection(db, STRATEGY_TASKS_COLLECTION), where("isHidden", "==", false))
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

export async function fetchProjectsWithTasks(
  options: SubscribeOptions = {},
): Promise<Project[]> {
  const includeHidden = options.includeHidden === true
  const projectsQuery = includeHidden
    ? query(collection(db, PROJECTS_COLLECTION))
    : query(collection(db, PROJECTS_COLLECTION), where("isHidden", "==", false))
  const tasksQuery = includeHidden
    ? query(collection(db, TASKS_COLLECTION))
    : query(collection(db, TASKS_COLLECTION), where("isHidden", "==", false))
  const strategyProjectsQuery = includeHidden
    ? query(collection(db, STRATEGY_PROJECTS_COLLECTION))
    : query(collection(db, STRATEGY_PROJECTS_COLLECTION), where("isHidden", "==", false))
  const strategyTasksQuery = includeHidden
    ? query(collection(db, STRATEGY_TASKS_COLLECTION))
    : query(collection(db, STRATEGY_TASKS_COLLECTION), where("isHidden", "==", false))

  const projectsSnapshot = await getDocs(projectsQuery)
  const tasksSnapshot = await getDocs(tasksQuery)
  const strategyProjectsSnapshot = await getDocs(strategyProjectsQuery)
  const strategyTasksSnapshot = await getDocs(strategyTasksQuery)
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
    personKeys: buildTaskPersonKeys(task.person || ""),
    displayOrder: typeof task.displayOrder === "number" ? task.displayOrder : Date.now(),
  })
  return `${isStrategyTask ? STRATEGY_SOURCE_PREFIX : ICT_SOURCE_PREFIX}${docRef.id}`
}

export async function updateTaskInDB(taskId: string, updates: Omit<Partial<Task>, "parentId"> & { parentId?: string | null }): Promise<void> {
  const isStrategyTask = isStrategyId(taskId)
  const taskRef = doc(db, isStrategyTask ? STRATEGY_TASKS_COLLECTION : TASKS_COLLECTION, stripSourceId(taskId) || taskId)
  const cleanUpdates = stripSourcePrefixFromRecord(updates as Record<string, unknown>)
  const payload = {
    ...cleanUpdates,
    ...(typeof updates.person === "string" ? { personKeys: buildTaskPersonKeys(updates.person) } : {}),
  }
  await updateDoc(taskRef, payload as any)
}

export async function deleteTaskFromDB(taskId: string): Promise<void> {
  const taskRef = doc(db, isStrategyId(taskId) ? STRATEGY_TASKS_COLLECTION : TASKS_COLLECTION, stripSourceId(taskId) || taskId)
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

function isIctSourceHistoryDoc(docSnap: { data: () => any }) {
  return toStringOrEmpty(docSnap.data()?.source) === "ict-work-management"
}

export async function fetchHistoryEntries(limitCount = 30, actorEmail?: string): Promise<ChangeHistoryEntry[]> {
  const normalizedActorEmail = actorEmail ? normalizeEmail(actorEmail) : ""
  const ictHistoryLimit = Math.max(limitCount * 3, limitCount)
  const strategyHistoryLimit = Math.max(limitCount * 3, limitCount)
  const ictHistoryQ = normalizedActorEmail
    ? query(
        collection(db, HISTORY_COLLECTION),
        where("actorEmail", "==", normalizedActorEmail),
        limit(ictHistoryLimit),
      )
    : query(collection(db, HISTORY_COLLECTION), orderBy("createdAt", "desc"), limit(limitCount))
  const strategyHistoryQ = normalizedActorEmail
    ? query(
        collection(db, "history"),
        where("actorEmail", "==", normalizedActorEmail),
        orderBy("createdAt", "desc"),
        limit(strategyHistoryLimit),
      )
    : query(collection(db, "history"), orderBy("createdAt", "desc"), limit(strategyHistoryLimit))
  const [snapshot, strategySnapshot] = await Promise.all([getDocs(ictHistoryQ), getDocs(strategyHistoryQ)])
  return mergeHistoryEntries(
    [
      ...snapshot.docs.map(mapIctHistoryDoc),
      ...strategySnapshot.docs.filter(isIctSourceHistoryDoc).map(mapStrategyHistoryDoc),
    ],
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
        limit(limitCount),
      ),
    })
    historyQueries.push({
      source: "strategy",
      query: query(
        collection(db, "history"),
        where("notificationPersonKeys", "array-contains-any", personKeys),
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
        limit(limitCount),
      ),
    })
    historyQueries.push({
      source: "strategy",
      query: query(
        collection(db, "history"),
        where("notificationDepartmentGroups", "array-contains-any", departmentGroups),
        limit(limitCount),
      ),
    })
  }

  if (historyQueries.length === 0) return []
  const snapshots = await Promise.all(historyQueries.map((item) => getDocs(item.query)))
  const entries = snapshots.flatMap((snapshot, index) => {
    const historyQuery = historyQueries[index]
    const docs = historyQuery.source === "strategy" ? snapshot.docs.filter(isIctSourceHistoryDoc) : snapshot.docs
    return docs.map(historyQuery.source === "strategy" ? mapStrategyHistoryDoc : mapIctHistoryDoc)
  })
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
