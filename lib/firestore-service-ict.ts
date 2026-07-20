import { db } from "./firebase"
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  documentId,
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
  computeIsIctFromTaskFields,
  computeIsIctFromTaskFieldsWithSettings,
  DEFAULT_DEPARTMENT_PERSON_SETTINGS,
  deleteHistoryEntry as deleteStrategyHistoryEntry,
  fetchDepartmentPersonSettings,
  rollbackHistoryEntry as rollbackStrategyHistoryEntry,
  subscribeDepartmentPersonSettings,
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
import { buildTaskPersonKeys, buildTaskPersonKeysFromValues, normalizeTaskPersonKey } from "./task-person-keys"
import { resolveTaskChildPresenceOnce } from "./task-child-presence"

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
    isHiddenRoot: toBooleanOr(raw?.isHiddenRoot ?? raw?.is_hidden_root, false),
    displayOrder: toNumberOr(raw?.displayOrder, Number.MAX_SAFE_INTEGER),
    sourceSchedule: raw?.sourceSchedule === "strategy" ? "strategy" : raw?.sourceSchedule === "ict" ? "ict" : undefined,
    originalTaskId: toOptionalString(raw?.originalTaskId),
    originalProjectId: toOptionalString(raw?.originalProjectId),
    ...(typeof raw?.isLeafInStore === "boolean" ? { isLeafInStore: raw.isLeafInStore } : {}),
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

function isIctTask(raw: any, ictPersonNames: string[] = DEFAULT_DEPARTMENT_PERSON_SETTINGS.ICT) {
  return computeIsIctFromTaskFields(raw?.department, raw?.person, ictPersonNames)
}

function isVisibleTask(raw: any, includeHidden: boolean) {
  return includeHidden || !toBooleanOr(raw?.isHidden ?? raw?.is_hidden, false)
}

function buildLinkedStrategyPersonKeyChunks(ictPersonNames: string[]) {
  return chunkValues(buildTaskPersonKeysFromValues(ictPersonNames), 30)
}

function mapStrategyTaskDoc(docSnap: any) {
  const raw = docSnap.data()
  return {
    ...raw,
    id: docSnap.id,
    originalTaskId: docSnap.id,
    originalProjectId: toStringOrEmpty(raw.projectId),
    sourceSchedule: "strategy",
  }
}

function mapIctTaskDoc(docSnap: any) {
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

function mergeStrategyTaskSources(...sources: any[][]): any[] {
  const byId = new Map<string, any>()
  sources.flat().forEach((task) => {
    const id = stripSourceId(toStringOrEmpty(task.id)) || toStringOrEmpty(task.originalTaskId)
    if (!id) return
    byId.set(id, { ...task, id })
  })
  return Array.from(byId.values())
}

async function collectLinkedStrategyTasksWithParents(
  candidateTasks: any[],
  ictPersonNames: string[],
  includeHidden: boolean,
  hiddenLinkedStrategyProjectIds: string[] = [],
): Promise<any[]> {
  const hiddenProjectIds = new Set(hiddenLinkedStrategyProjectIds.map((id) => stripStrategyId(id) || id))
  const directTasks = mergeStrategyTaskSources(candidateTasks).filter((task) => {
    const projectId = stripSourceId(toStringOrEmpty(task.projectId)) || toStringOrEmpty(task.originalProjectId)
    return (
      isVisibleTask(task, includeHidden) &&
      isIctTask(task, ictPersonNames) &&
      (includeHidden || !hiddenProjectIds.has(projectId))
    )
  })

  const tasksById = new Map<string, any>()
  directTasks.forEach((task) => {
    const id = stripSourceId(toStringOrEmpty(task.id)) || toStringOrEmpty(task.originalTaskId)
    if (id) tasksById.set(id, { ...task, id })
  })
  await fetchRawParentTaskChain(tasksById, STRATEGY_TASKS_COLLECTION)
  return Array.from(tasksById.values())
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
  const hiddenStrategyProjectIdSet = new Set(hiddenLinkedStrategyProjectIds.map((id) => stripStrategyId(id) || id))
  const ictProjectIds = new Set(ictProjects.map((project) => stripSourceId(toStringOrEmpty(project.id))).filter(Boolean))
  const strategyProjectIds = new Set(
    strategyProjects.map((project) => stripSourceId(toStringOrEmpty(project.id))).filter(Boolean),
  )

  const normalizedProjects = [
    ...ictProjects.map((project) => {
      const sourceProjectId = stripSourceId(toStringOrEmpty(project.id)) || toStringOrEmpty(project.id)
      return {
        ...project,
        id: `${ICT_SOURCE_PREFIX}${sourceProjectId}`,
        originalProjectId: sourceProjectId,
        sourceSchedule: "ict",
      }
    }),
    ...strategyProjects.map((project) => {
      const sourceProjectId = stripSourceId(toStringOrEmpty(project.id)) || toStringOrEmpty(project.id)
      return {
        ...project,
        id: `${STRATEGY_SOURCE_PREFIX}${sourceProjectId}`,
        isHidden: hiddenStrategyProjectIdSet.has(sourceProjectId),
        originalProjectId: sourceProjectId,
        sourceSchedule: "strategy",
      }
    }),
  ]

  type SourceTask = {
    raw: any
    source: "ict" | "strategy"
    sourcePrefix: typeof ICT_SOURCE_PREFIX | typeof STRATEGY_SOURCE_PREFIX
    rawId: string
    rawParentId?: string
    rawProjectId: string
    projectId: string
  }

  const resolveProjectId = (rawProjectId: string, source: SourceTask["source"]) => {
    if (!rawProjectId) return ""
    if (source === "ict") {
      if (ictProjectIds.has(rawProjectId)) return `${ICT_SOURCE_PREFIX}${rawProjectId}`
      if (strategyProjectIds.has(rawProjectId)) return `${STRATEGY_SOURCE_PREFIX}${rawProjectId}`
      return `${ICT_SOURCE_PREFIX}${rawProjectId}`
    }
    if (strategyProjectIds.has(rawProjectId)) return `${STRATEGY_SOURCE_PREFIX}${rawProjectId}`
    if (ictProjectIds.has(rawProjectId)) return `${ICT_SOURCE_PREFIX}${rawProjectId}`
    return `${STRATEGY_SOURCE_PREFIX}${rawProjectId}`
  }

  const makeSourceTask = (raw: any, source: SourceTask["source"]): SourceTask | null => {
    const sourcePrefix = source === "ict" ? ICT_SOURCE_PREFIX : STRATEGY_SOURCE_PREFIX
    const rawId = stripSourceId(toStringOrEmpty(raw.id)) || toStringOrEmpty(raw.originalTaskId)
    const rawProjectId = stripSourceId(toStringOrEmpty(raw.projectId)) || toStringOrEmpty(raw.originalProjectId)
    if (!rawId || !rawProjectId) return null

    return {
      raw,
      source,
      sourcePrefix,
      rawId,
      rawParentId: stripSourceId(toOptionalString(raw.parentId)) || undefined,
      rawProjectId,
      projectId: resolveProjectId(rawProjectId, source),
    }
  }

  const sourceTasks = [
    ...ictTasks.map((task) => makeSourceTask(task, "ict")),
    ...strategyTasks.map((task) => makeSourceTask(task, "strategy")),
  ].filter((task): task is SourceTask => Boolean(task))

  const tasksByRawId = new Map<string, SourceTask[]>()
  sourceTasks.forEach((task) => {
    const list = tasksByRawId.get(task.rawId) || []
    list.push(task)
    tasksByRawId.set(task.rawId, list)
  })

  const resolveParentId = (task: SourceTask) => {
    if (!task.rawParentId) return undefined
    const candidates = tasksByRawId.get(task.rawParentId) || []
    const parent =
      candidates.find((candidate) => candidate.projectId === task.projectId) ||
      candidates.find((candidate) => candidate.source === task.source) ||
      candidates[0]
    return `${parent?.sourcePrefix || task.sourcePrefix}${task.rawParentId}`
  }

  const normalizedTasks = sourceTasks.map((task) => ({
    ...task.raw,
    id: `${task.sourcePrefix}${task.rawId}`,
    projectId: task.projectId,
    parentId: resolveParentId(task),
    originalTaskId: task.rawId,
    originalProjectId: task.rawProjectId,
    sourceSchedule: task.source,
  }))

  return buildProjectTree(normalizedProjects, normalizedTasks)
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size))
  return chunks
}

// See lib/firestore-service.ts for the rationale behind these caches. The
// ICT module reads from both the strategy and ICT collections, so cache keys
// include the collection name to avoid cross-collection collisions.
const DOC_CACHE_TTL_MS = 60_000
type CachedDoc = { value: any; fetchedAt: number }
const projectDocCache = new Map<string, CachedDoc>()
const rawTaskDocCache = new Map<string, CachedDoc>()

function cacheKey(collectionName: string, id: string) {
  return `${collectionName}::${id}`
}

function getCachedDoc(cache: Map<string, CachedDoc>, key: string, now: number): any | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (now - entry.fetchedAt >= DOC_CACHE_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

async function fetchRawDocsByIds(collectionName: string, ids: string[]): Promise<any[]> {
  if (ids.length === 0) return []
  const chunks = chunkValues(ids, 30)
  const snapshots = await Promise.all(
    chunks.map((chunk) => getDocs(query(collection(db, collectionName), where(documentId(), "in", chunk)))),
  )
  return snapshots.flatMap((snap) => snap.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
}

async function fetchParentTaskChain(
  tasksById: Map<string, any>,
  collectionName: string,
  prefix = "",
) {
  const now = Date.now()
  const source: "strategy" | "ict" = prefix === STRATEGY_SOURCE_PREFIX ? "strategy" : "ict"

  const wrapParent = (raw: any, mapId: string) => ({
    ...raw,
    id: mapId,
    parentId: toOptionalString(raw.parentId)
      ? `${prefix}${toStringOrEmpty(raw.parentId)}`
      : undefined,
    projectId: `${prefix}${toStringOrEmpty(raw.projectId)}`,
    sourceSchedule: source,
    originalTaskId: raw.id,
    originalProjectId: toStringOrEmpty(raw.projectId),
  })

  let pending = new Set<string>()
  tasksById.forEach((task) => {
    const parentId = stripSourceId(toOptionalString(task.parentId)) || toOptionalString(task.parentId)
    if (parentId && !tasksById.has(`${prefix}${parentId}`) && !tasksById.has(parentId)) pending.add(parentId)
  })

  while (pending.size > 0) {
    const toFetch: string[] = []
    pending.forEach((parentId) => {
      const mapId = `${prefix}${parentId}`
      if (tasksById.has(mapId) || tasksById.has(parentId)) return
      const cached = getCachedDoc(rawTaskDocCache, cacheKey(collectionName, parentId), now)
      if (cached) {
        tasksById.set(mapId, wrapParent(cached, mapId))
      } else {
        toFetch.push(parentId)
      }
    })

    const nextPending = new Set<string>()

    pending.forEach((parentId) => {
      const mapId = `${prefix}${parentId}`
      const wrapped = tasksById.get(mapId)
      if (!wrapped) return
      const nextParentId = stripSourceId(toOptionalString(wrapped.parentId)) || toOptionalString(wrapped.parentId)
      if (nextParentId && !tasksById.has(`${prefix}${nextParentId}`)) nextPending.add(nextParentId)
    })

    if (toFetch.length > 0) {
      const fetched = await fetchRawDocsByIds(collectionName, toFetch)
      fetched.forEach((raw) => {
        rawTaskDocCache.set(cacheKey(collectionName, raw.id), { value: raw, fetchedAt: now })
        const mapId = `${prefix}${raw.id}`
        tasksById.set(mapId, wrapParent(raw, mapId))
        const nextParentId = toOptionalString(raw.parentId)
        if (nextParentId && !tasksById.has(`${prefix}${nextParentId}`)) nextPending.add(nextParentId)
      })
    }

    pending = nextPending
  }
}

async function fetchRawParentTaskChain(tasksById: Map<string, any>, collectionName: string) {
  const now = Date.now()
  let pending = new Set<string>()
  tasksById.forEach((task) => {
    const parentId = toOptionalString(task.parentId)
    if (parentId && !tasksById.has(parentId)) pending.add(parentId)
  })

  while (pending.size > 0) {
    const toFetch: string[] = []
    pending.forEach((id) => {
      if (tasksById.has(id)) return
      const cached = getCachedDoc(rawTaskDocCache, cacheKey(collectionName, id), now)
      if (cached) {
        tasksById.set(id, cached)
      } else {
        toFetch.push(id)
      }
    })

    const nextPending = new Set<string>()

    pending.forEach((id) => {
      const task = tasksById.get(id)
      if (!task) return
      const nextParentId = toOptionalString(task.parentId)
      if (nextParentId && !tasksById.has(nextParentId)) nextPending.add(nextParentId)
    })

    if (toFetch.length > 0) {
      const fetched = await fetchRawDocsByIds(collectionName, toFetch)
      fetched.forEach((task) => {
        rawTaskDocCache.set(cacheKey(collectionName, task.id), { value: task, fetchedAt: now })
        tasksById.set(task.id, task)
        const nextParentId = toOptionalString(task.parentId)
        if (nextParentId && !tasksById.has(nextParentId)) nextPending.add(nextParentId)
      })
    }

    pending = nextPending
  }
}

async function fetchProjectsForTaskIds(projectIds: string[], collectionName: string, prefix = "") {
  const now = Date.now()
  const source: "strategy" | "ict" = prefix === STRATEGY_SOURCE_PREFIX ? "strategy" : "ict"
  const uniqueProjectIds = Array.from(new Set(projectIds.map((id) => stripSourceId(id) || id).filter(Boolean)))

  const wrapProject = (raw: any) => ({
    ...raw,
    id: `${prefix}${raw.id}`,
    sourceSchedule: source,
    originalProjectId: raw.id,
  })

  const result: any[] = []
  const missing: string[] = []
  uniqueProjectIds.forEach((id) => {
    const cached = getCachedDoc(projectDocCache, cacheKey(collectionName, id), now)
    if (cached) {
      result.push(wrapProject(cached))
    } else {
      missing.push(id)
    }
  })

  if (missing.length > 0) {
    const fetched = await fetchRawDocsByIds(collectionName, missing)
    fetched.forEach((raw) => {
      projectDocCache.set(cacheKey(collectionName, raw.id), { value: raw, fetchedAt: now })
      result.push(wrapProject(raw))
    })
  }

  return result
}

export type SubscribeOptions = {
  /**
   * When false (default), hidden projects and hidden tasks are excluded from
   * the initial schedule stream. Hidden task roots/details use separate lazy
   * subscriptions.
   */
  includeHidden?: boolean
  dateRange?: {
    startDate: string
    endDate: string
  }
  /** Resolve actual leaf state once per browser session for partial task trees. */
  resolveLeafStateOnce?: boolean
}

type QueryDateRange = {
  startDate: string
  endDate: string
}

function normalizeQueryDateRange(range?: SubscribeOptions["dateRange"]): QueryDateRange | undefined {
  const startDate = toStringOrEmpty(range?.startDate)
  const endDate = toStringOrEmpty(range?.endDate)
  if (!startDate || !endDate) return undefined
  return { startDate, endDate }
}

function parseDateOrdinal(value?: string) {
  const text = toStringOrEmpty(value)
  if (!text) return undefined
  const isoMatched = text.match(/^\d{4}-(\d{2})-(\d{2})$/)
  if (isoMatched) return Number(isoMatched[1]) * 100 + Number(isoMatched[2])
  const koreanMatched = text.match(/^(?:\d{4}\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일$/)
  if (koreanMatched) return Number(koreanMatched[1]) * 100 + Number(koreanMatched[2])
  const shortMatched = text.match(/^(\d{1,2})[\/.-](\d{1,2})$/)
  if (shortMatched) return Number(shortMatched[1]) * 100 + Number(shortMatched[2])
  return undefined
}

function taskOverlapsQueryDateRange(task: any, range?: QueryDateRange) {
  if (!range) return true
  const rangeStart = parseDateOrdinal(range.startDate)
  const rangeEnd = parseDateOrdinal(range.endDate)
  const startDate = parseDateOrdinal(toStringOrEmpty(task?.startDate) || toStringOrEmpty(task?.endDate))
  const endDate = parseDateOrdinal(toStringOrEmpty(task?.endDate) || toStringOrEmpty(task?.startDate))
  if (rangeStart === undefined || rangeEnd === undefined || startDate === undefined || endDate === undefined) return false
  if (rangeStart <= rangeEnd) return startDate <= rangeEnd && endDate >= rangeStart
  return startDate <= rangeEnd || endDate >= rangeStart
}

function getTaskPersonKeyValues(task: any): string[] {
  const raw = task?.personKeys
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string")
  if (typeof raw === "string") return [raw]
  return []
}

function taskMatchesPersonScope(task: any, personNames: string[], queryKeys: string[]) {
  const normalizedQueryKeys = new Set(queryKeys.map(normalizeTaskPersonKey).filter(Boolean))
  if (
    getTaskPersonKeyValues(task).some((key) => {
      const normalized = normalizeTaskPersonKey(key)
      return normalized && normalizedQueryKeys.has(normalized)
    })
  ) {
    return true
  }

  const normalizedNames = personNames.map(normalizeTaskPersonKey).filter(Boolean)
  if (normalizedNames.length === 0) return false

  return toStringOrEmpty(task?.person)
    .split(",")
    .map(normalizeTaskPersonKey)
    .filter(Boolean)
    .some((token) =>
      normalizedNames.some((name) => token === name || token.includes(name) || name.includes(token)),
    )
}

type ProjectTaskSubscriptionPoolOptions = {
  collectionName: string
  groupPrefix: string
  taskGroups: Map<string, any[]>
  mapSnapshot: (snapshot: any) => any[]
  onChange: () => void
  onError: (error: unknown) => void
  buildConstraints?: (projectIds: string[]) => any[]
}

function createProjectTaskSubscriptionPool({
  collectionName,
  groupPrefix,
  taskGroups,
  mapSnapshot,
  onChange,
  onError,
  buildConstraints,
}: ProjectTaskSubscriptionPoolOptions) {
  const chunks: Array<{ ids: string[]; unsubscribe?: () => void; ready: boolean }> = []
  const chunkByProjectId = new Map<string, number>()

  const groupKey = (index: number) => `${groupPrefix}:${index}`
  const constraintsFor = (ids: string[]) => buildConstraints?.(ids) || [where("projectId", "in", ids)]

  const detachChunk = (index: number) => {
    const chunk = chunks[index]
    if (!chunk) return
    chunk.unsubscribe?.()
    chunk.unsubscribe = undefined
    chunk.ready = true
    taskGroups.delete(groupKey(index))
  }

  const attachChunk = (index: number) => {
    const chunk = chunks[index]
    if (!chunk) return

    detachChunk(index)
    if (chunk.ids.length === 0) {
      onChange()
      return
    }

    chunk.ready = false
    chunk.unsubscribe = onSnapshot(
      query(collection(db, collectionName), ...constraintsFor(chunk.ids)),
      (snapshot) => {
        taskGroups.set(groupKey(index), mapSnapshot(snapshot))
        chunk.ready = true
        onChange()
      },
      (error) => {
        chunk.ready = true
        onError(error)
      },
    )
  }

  return {
    sync(projectIds: string[]) {
      const nextIds = uniqueTrimmedStrings(projectIds)
      const nextIdSet = new Set(nextIds)
      const changedChunks = new Set<number>()

      Array.from(chunkByProjectId.entries()).forEach(([projectId, chunkIndex]) => {
        if (nextIdSet.has(projectId)) return
        const chunk = chunks[chunkIndex]
        if (chunk) {
          chunk.ids = chunk.ids.filter((id) => id !== projectId)
          changedChunks.add(chunkIndex)
        }
        chunkByProjectId.delete(projectId)
      })

      nextIds.forEach((projectId) => {
        if (chunkByProjectId.has(projectId)) return
        let chunkIndex = chunks.findIndex((chunk) => chunk.ids.length < 30)
        if (chunkIndex === -1) {
          chunkIndex = chunks.length
          chunks.push({ ids: [], ready: true })
        }
        chunks[chunkIndex].ids.push(projectId)
        chunkByProjectId.set(projectId, chunkIndex)
        changedChunks.add(chunkIndex)
      })

      if (changedChunks.size === 0) return
      changedChunks.forEach((chunkIndex) => attachChunk(chunkIndex))
      onChange()
    },
    isReady() {
      return chunks.every((chunk) => chunk.ids.length === 0 || chunk.ready)
    },
    unsubscribe() {
      chunks.forEach((_, index) => detachChunk(index))
      chunks.length = 0
      chunkByProjectId.clear()
    },
  }
}

type LinkedStrategyTaskCandidateSubscriptionOptions = {
  groupPrefix: string
  taskGroups: Map<string, any[]>
  includeHidden: boolean
  onChange: () => void
  onError: (error: unknown) => void
}

function createLinkedStrategyTaskCandidateSubscription({
  groupPrefix,
  taskGroups,
  includeHidden,
  onChange,
  onError,
}: LinkedStrategyTaskCandidateSubscriptionOptions) {
  const staticUnsubscribes: Array<() => void> = []
  let personUnsubscribes: Array<() => void> = []
  let isIctReady = false
  let departmentReady = false
  let personReady = true
  let personKeySignature = ""

  const setGroup = (key: string, snapshot: any) => {
    taskGroups.set(key, snapshot.docs.map(mapStrategyTaskDoc))
  }

  const subscribeStaticGroup = (key: string, constraints: any[], markReady: () => void) => {
    staticUnsubscribes.push(
      onSnapshot(
        query(collection(db, STRATEGY_TASKS_COLLECTION), ...constraints),
        (snapshot) => {
          setGroup(key, snapshot)
          markReady()
          onChange()
        },
        (error) => {
          markReady()
          onError(error)
          onChange()
        },
      ),
    )
  }

  const isIctConstraints: any[] = [where("isIct", "==", true)]
  if (!includeHidden) isIctConstraints.push(where("isHidden", "==", false))
  subscribeStaticGroup(`${groupPrefix}:isIct`, isIctConstraints, () => {
    isIctReady = true
  })
  const departmentConstraints: any[] = [where("department", "==", "ICT")]
  if (!includeHidden) departmentConstraints.push(where("isHidden", "==", false))
  subscribeStaticGroup(`${groupPrefix}:department`, departmentConstraints, () => {
    departmentReady = true
  })

  const clearPersonGroups = () => {
    Array.from(taskGroups.keys())
      .filter((key) => key.startsWith(`${groupPrefix}:person:`))
      .forEach((key) => taskGroups.delete(key))
  }

  return {
    syncPersonNames(ictPersonNames: string[]) {
      const keyChunks = buildLinkedStrategyPersonKeyChunks(ictPersonNames)
      const nextSignature = keyChunks.map((chunk) => chunk.join("\u0000")).join("\u0001")
      if (nextSignature === personKeySignature) return
      personKeySignature = nextSignature

      personUnsubscribes.forEach((unsubscribe) => unsubscribe())
      personUnsubscribes = []
      clearPersonGroups()

      if (keyChunks.length === 0) {
        personReady = true
        onChange()
        return
      }

      personReady = false
      const readyChunks = new Set<number>()
      keyChunks.forEach((chunk, index) => {
        const personConstraints: any[] = [where("personKeys", "array-contains-any", chunk)]
        if (!includeHidden) personConstraints.push(where("isHidden", "==", false))
        personUnsubscribes.push(
          onSnapshot(
            query(collection(db, STRATEGY_TASKS_COLLECTION), ...personConstraints),
            (snapshot) => {
              taskGroups.set(`${groupPrefix}:person:${index}`, snapshot.docs.map(mapStrategyTaskDoc))
              readyChunks.add(index)
              personReady = readyChunks.size === keyChunks.length
              onChange()
            },
            (error) => {
              readyChunks.add(index)
              personReady = readyChunks.size === keyChunks.length
              onError(error)
              onChange()
            },
          ),
        )
      })
    },
    isReady() {
      return isIctReady && departmentReady && personReady
    },
    unsubscribe() {
      staticUnsubscribes.forEach((unsubscribe) => unsubscribe())
      personUnsubscribes.forEach((unsubscribe) => unsubscribe())
      clearPersonGroups()
    },
  }
}

function queueScheduleCallback(callback: () => void) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback)
    return
  }
  void Promise.resolve().then(callback)
}

export function subscribeProjectsWithTasksByPersonKeys(
  personKeys: string[],
  callback: (projects: Project[]) => void,
  options: SubscribeOptions = {},
) {
  const includeHidden = options.includeHidden === true
  const dateRange = normalizeQueryDateRange(options.dateRange)
  const queryPersons = uniqueTrimmedStrings(personKeys)
  const queryKeys = buildTaskPersonKeysFromValues(personKeys).slice(0, 300)
  if (queryKeys.length === 0) {
    callback([])
    return () => {}
  }

  const chunks = chunkValues(queryKeys, 30)
  const ictTaskGroups = new Map<string | number, any[]>()
  const strategyTaskGroups = new Map<string | number, any[]>()
  let ictPersonNames = DEFAULT_DEPARTMENT_PERSON_SETTINGS.ICT
  let hiddenLinkedStrategyProjectIds: string[] = []
  let disposed = false
  let areDepartmentPersonsReady = false
  let notifyToken = 0

  const notify = async () => {
    if (!areDepartmentPersonsReady) return
    const currentToken = ++notifyToken
    const ictTasksById = new Map<string, any>()
    ictTaskGroups.forEach((tasks) => tasks.forEach((task) => ictTasksById.set(task.id, task)))
    await fetchParentTaskChain(ictTasksById, TASKS_COLLECTION, ICT_SOURCE_PREFIX)

    let ictTasks = Array.from(ictTasksById.values())
    let strategyTasks = await collectLinkedStrategyTasksWithParents(
      Array.from(strategyTaskGroups.values()).flat(),
      ictPersonNames,
      includeHidden,
      hiddenLinkedStrategyProjectIds,
    )
    if (options.resolveLeafStateOnce) {
      const [ictChildPresence, strategyChildPresence] = await Promise.all([
        resolveTaskChildPresenceOnce(
          TASKS_COLLECTION,
          ictTasks.map((task) => stripSourceId(toStringOrEmpty(task.id)) || ""),
        ),
        resolveTaskChildPresenceOnce(
          STRATEGY_TASKS_COLLECTION,
          strategyTasks.map((task) => stripSourceId(toStringOrEmpty(task.id)) || ""),
        ),
      ])
      ictTasks = ictTasks.map((task) => ({
        ...task,
        isLeafInStore: ictChildPresence.get(stripSourceId(toStringOrEmpty(task.id)) || "") === "leaf",
      }))
      strategyTasks = strategyTasks.map((task) => ({
        ...task,
        isLeafInStore: strategyChildPresence.get(stripSourceId(toStringOrEmpty(task.id)) || "") === "leaf",
      }))
    }
    const taskProjectIds = [...ictTasks, ...strategyTasks].map((task) => toStringOrEmpty(task.projectId))
    const ictProjects = await fetchProjectsForTaskIds(taskProjectIds, PROJECTS_COLLECTION, ICT_SOURCE_PREFIX)
    const strategyProjects = await fetchProjectsForTaskIds(taskProjectIds, STRATEGY_PROJECTS_COLLECTION)

    if (!disposed && currentToken === notifyToken) {
      callback(buildIctScheduleProjectTree(ictProjects, ictTasks, strategyProjects, strategyTasks, hiddenLinkedStrategyProjectIds))
    }
  }

  const unsubscribes: Array<() => void> = [
    subscribeDepartmentPersonSettings((settings) => {
      ictPersonNames = settings.ICT
      areDepartmentPersonsReady = true
      void notify().catch((error) => console.error("Scoped ICT department persons snapshot error:", error))
    }),
    onSnapshot(
      doc(db, SETTINGS_COLLECTION, LINKED_STRATEGY_PROJECT_VISIBILITY_DOC),
      (snapshot: any) => {
        hiddenLinkedStrategyProjectIds = normalizeHiddenLinkedStrategyProjectIds(
          snapshot.data()?.[HIDDEN_LINKED_STRATEGY_PROJECT_IDS_FIELD],
        )
        void notify().catch((error) => console.error("Scoped ICT visibility snapshot error:", error))
      },
      (error) => console.error("Scoped ICT visibility snapshot error:", error),
    ),
  ]

  chunks.forEach((chunk, index) => {
    const ictConstraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    if (!includeHidden) ictConstraints.push(where("isHidden", "==", false))
    if (dateRange) ictConstraints.push(where("endDate", ">=", dateRange.startDate))
    const strategyConstraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    if (!includeHidden) strategyConstraints.push(where("isHidden", "==", false))
    unsubscribes.push(
      onSnapshot(
        query(collection(db, TASKS_COLLECTION), ...ictConstraints),
        (snapshot) => {
          ictTaskGroups.set(
            index,
            snapshot.docs
              .map((docSnap) => ({
                ...docSnap.data(),
                id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
                parentId: toOptionalString(docSnap.data().parentId) ? `${ICT_SOURCE_PREFIX}${toStringOrEmpty(docSnap.data().parentId)}` : undefined,
                projectId: `${ICT_SOURCE_PREFIX}${toStringOrEmpty(docSnap.data().projectId)}`,
                sourceSchedule: "ict",
                originalTaskId: docSnap.id,
                originalProjectId: toStringOrEmpty(docSnap.data().projectId),
              }))
              .filter((task) => taskOverlapsQueryDateRange(task, dateRange)),
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
              .map(mapStrategyTaskDoc)
              .filter((task) => taskOverlapsQueryDateRange(task, dateRange)),
          )
          void notify().catch((error) => console.error("Scoped linked strategy data snapshot error:", error))
        },
        (error) => console.error("Scoped linked strategy tasks snapshot error:", error),
      ),
    )
  })

  if (dateRange) {
    const mapFallbackIctTasks = (snapshot: any) =>
      snapshot.docs
        .map((docSnap: any) => ({
          ...docSnap.data(),
          id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
          parentId: toOptionalString(docSnap.data().parentId) ? `${ICT_SOURCE_PREFIX}${toStringOrEmpty(docSnap.data().parentId)}` : undefined,
          projectId: `${ICT_SOURCE_PREFIX}${toStringOrEmpty(docSnap.data().projectId)}`,
          sourceSchedule: "ict",
          originalTaskId: docSnap.id,
          originalProjectId: toStringOrEmpty(docSnap.data().projectId),
        }))
        .filter((task: any) => taskOverlapsQueryDateRange(task, dateRange))
        .filter((task: any) => taskMatchesPersonScope(task, queryPersons, queryKeys))

    unsubscribes.push(
      onSnapshot(
        query(
          collection(db, TASKS_COLLECTION),
          where("endDate", ">=", dateRange.startDate),
          ...(includeHidden ? [] : [where("isHidden", "==", false)]),
        ),
        (snapshot) => {
          ictTaskGroups.set("fallback:date-person", mapFallbackIctTasks(snapshot))
          void notify().catch((error) => console.error("Scoped ICT fallback data snapshot error:", error))
        },
        (error) => console.error("Scoped ICT fallback tasks snapshot error:", error),
      ),
      onSnapshot(
        query(
          collection(db, STRATEGY_TASKS_COLLECTION),
          where("endDate", ">=", dateRange.startDate),
          ...(includeHidden ? [] : [where("isHidden", "==", false)]),
        ),
        (snapshot) => {
          strategyTaskGroups.set(
            "fallback:date-person",
            snapshot.docs
              .map(mapStrategyTaskDoc)
              .filter((task) => taskOverlapsQueryDateRange(task, dateRange))
              .filter((task) => taskMatchesPersonScope(task, queryPersons, queryKeys)),
          )
          void notify().catch((error) => console.error("Scoped linked strategy fallback data snapshot error:", error))
        },
        (error) => console.error("Scoped linked strategy fallback tasks snapshot error:", error),
      ),
    )
  }

  return () => {
    disposed = true
    unsubscribes.forEach((unsubscribe) => unsubscribe())
  }
}

export type ScheduleScopeOptions = {
  personKeys?: string[]
  pmEmail?: string
  creatorEmail?: string
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
  const normalizedCreatorEmail = normalizeEmail(scope.creatorEmail || "")
  if (queryKeys.length === 0 && !normalizedPmEmail && !normalizedCreatorEmail) {
    callback([])
    return () => {}
  }

  const ictTaskGroups = new Map<string, any[]>()
  const strategyTaskGroups = new Map<string, any[]>()
  const ictPmProjectsById = new Map<string, any>()
  const strategyPmProjectsById = new Map<string, any>()
  const ictPmProjectGroups = new Map<string, any[]>()
  const strategyPmProjectGroups = new Map<string, any[]>()
  const ictCreatorProjectsById = new Map<string, any>()
  const strategyCreatorProjectsById = new Map<string, any>()
  let ictPersonNames = DEFAULT_DEPARTMENT_PERSON_SETTINGS.ICT
  let hiddenLinkedStrategyProjectIds: string[] = []
  let disposed = false
  let areDepartmentPersonsReady = false
  let notifyToken = 0
  let notifyScheduled = false
  let ictPmTaskPool: ReturnType<typeof createProjectTaskSubscriptionPool> | null = null
  let strategyPmTaskPool: ReturnType<typeof createProjectTaskSubscriptionPool> | null = null

  const notify = async () => {
    if (!areDepartmentPersonsReady) return
    if (ictPmTaskPool && !ictPmTaskPool.isReady()) return
    if (strategyPmTaskPool && !strategyPmTaskPool.isReady()) return
    const currentToken = ++notifyToken

    const ictTasksById = new Map<string, any>()
    ictTaskGroups.forEach((tasks) => tasks.forEach((task) => ictTasksById.set(task.id, task)))
    await fetchParentTaskChain(ictTasksById, TASKS_COLLECTION, ICT_SOURCE_PREFIX)

    const ictTasks = Array.from(ictTasksById.values())
    const strategyTasks = await collectLinkedStrategyTasksWithParents(
      Array.from(strategyTaskGroups.values()).flat(),
      ictPersonNames,
      includeHidden,
      hiddenLinkedStrategyProjectIds,
    )
    const taskProjectIds = [...ictTasks, ...strategyTasks].map((task) => toStringOrEmpty(task.projectId))
    const ictRelatedProjects = await fetchProjectsForTaskIds(taskProjectIds, PROJECTS_COLLECTION, ICT_SOURCE_PREFIX)
    const strategyRelatedProjects = await fetchProjectsForTaskIds(taskProjectIds, STRATEGY_PROJECTS_COLLECTION)

    const ictProjectsById = new Map<string, any>()
    ictRelatedProjects.forEach((project) => ictProjectsById.set(toStringOrEmpty(project.id), project))
    ictPmProjectsById.forEach((project, projectId) => ictProjectsById.set(projectId, project))
    ictCreatorProjectsById.forEach((project, projectId) => ictProjectsById.set(projectId, project))

    const strategyProjectsById = new Map<string, any>()
    strategyRelatedProjects.forEach((project) => strategyProjectsById.set(stripSourceId(toStringOrEmpty(project.id)) || toStringOrEmpty(project.id), project))
    strategyPmProjectsById.forEach((project, projectId) => strategyProjectsById.set(projectId, project))
    strategyCreatorProjectsById.forEach((project, projectId) => strategyProjectsById.set(projectId, project))

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

  const scheduleNotify = () => {
    if (notifyScheduled) return
    notifyScheduled = true
    queueScheduleCallback(() => {
      notifyScheduled = false
      void notify().catch((error) => {
        console.error("Schedule ICT data snapshot error:", error)
        if (!disposed) callback([])
      })
    })
  }

  ictPmTaskPool = createProjectTaskSubscriptionPool({
    collectionName: TASKS_COLLECTION,
    groupPrefix: "pm-ict",
    taskGroups: ictTaskGroups,
    mapSnapshot: (snapshot) => snapshot.docs.map(mapIctTaskDoc),
    onChange: scheduleNotify,
    onError: (error) => {
      console.error("Schedule PM ICT tasks snapshot error:", error)
    },
    buildConstraints: (projectIds) => [
      where("projectId", "in", projectIds),
      ...(includeHidden ? [] : [where("isHidden", "==", false)]),
    ],
  })

  strategyPmTaskPool = createProjectTaskSubscriptionPool({
    collectionName: STRATEGY_TASKS_COLLECTION,
    groupPrefix: "pm-strategy",
    taskGroups: strategyTaskGroups,
    mapSnapshot: (snapshot) => snapshot.docs.map(mapStrategyTaskDoc),
    onChange: scheduleNotify,
    onError: (error) => {
      console.error("Schedule PM linked strategy tasks snapshot error:", error)
    },
    buildConstraints: (projectIds) => [
      where("projectId", "in", projectIds),
      ...(includeHidden ? [] : [where("isHidden", "==", false)]),
    ],
  })

  const resetIctScopedProjectTasks = () => {
    ictPmTaskPool?.sync(
      Array.from(
        new Set([...ictPmProjectsById.keys(), ...ictCreatorProjectsById.keys()].map((id) => stripIctId(id) || id)),
      ),
    )
  }

  const resetStrategyScopedProjectTasks = () => {
    strategyPmTaskPool?.sync(Array.from(new Set([...strategyPmProjectsById.keys(), ...strategyCreatorProjectsById.keys()])))
  }

  const syncIctPmProjectGroup = (key: string, projects: any[]) => {
    ictPmProjectGroups.set(key, projects)
    ictPmProjectsById.clear()
    ictPmProjectGroups.forEach((items) => {
      items.forEach((project) => ictPmProjectsById.set(toStringOrEmpty(project.id), project))
    })
    resetIctScopedProjectTasks()
    scheduleNotify()
  }

  const syncStrategyPmProjectGroup = (key: string, projects: any[]) => {
    strategyPmProjectGroups.set(key, projects)
    strategyPmProjectsById.clear()
    strategyPmProjectGroups.forEach((items) => {
      items.forEach((project) => strategyPmProjectsById.set(toStringOrEmpty(project.id), project))
    })
    resetStrategyScopedProjectTasks()
    scheduleNotify()
  }

  const unsubscribes: Array<() => void> = [
    subscribeDepartmentPersonSettings((settings) => {
      ictPersonNames = settings.ICT
      areDepartmentPersonsReady = true
      scheduleNotify()
    }),
    onSnapshot(
      doc(db, SETTINGS_COLLECTION, LINKED_STRATEGY_PROJECT_VISIBILITY_DOC),
      (snapshot) => {
        hiddenLinkedStrategyProjectIds = normalizeHiddenLinkedStrategyProjectIds(
          snapshot.data()?.[HIDDEN_LINKED_STRATEGY_PROJECT_IDS_FIELD],
        )
        scheduleNotify()
      },
      (error) => {
        console.error("Schedule ICT visibility snapshot error:", error)
      },
    ),
  ]

  chunkValues(queryKeys, 30).forEach((chunk, index) => {
    const ictConstraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    const strategyConstraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    if (!includeHidden) {
      ictConstraints.push(where("isHidden", "==", false))
      strategyConstraints.push(where("isHidden", "==", false))
    }
    unsubscribes.push(
      onSnapshot(
        query(collection(db, TASKS_COLLECTION), ...ictConstraints),
        (snapshot) => {
          ictTaskGroups.set(`person:${index}`, snapshot.docs.map(mapIctTaskDoc))
          scheduleNotify()
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
            snapshot.docs.map(mapStrategyTaskDoc),
          )
          scheduleNotify()
        },
        (error) => {
          console.error("Schedule assignee linked strategy tasks snapshot error:", error)
        },
      ),
    )
  })

  if (normalizedCreatorEmail) {
    unsubscribes.push(
      onSnapshot(
        query(
          collection(db, TASKS_COLLECTION),
          where("createdByEmail", "==", normalizedCreatorEmail),
          ...(includeHidden ? [] : [where("isHidden", "==", false)]),
        ),
        (snapshot) => {
          ictTaskGroups.set(
            "creator",
            snapshot.docs.map(mapIctTaskDoc),
          )
          scheduleNotify()
        },
        (error) => {
          console.error("Schedule creator ICT tasks snapshot error:", error)
        },
      ),
      onSnapshot(
        query(
          collection(db, STRATEGY_TASKS_COLLECTION),
          where("createdByEmail", "==", normalizedCreatorEmail),
          ...(includeHidden ? [] : [where("isHidden", "==", false)]),
        ),
        (snapshot) => {
          strategyTaskGroups.set(
            "creator",
            snapshot.docs.map(mapStrategyTaskDoc),
          )
          scheduleNotify()
        },
        (error) => {
          console.error("Schedule creator linked strategy tasks snapshot error:", error)
        },
      ),
      onSnapshot(
        query(collection(db, PROJECTS_COLLECTION), where("createdByEmail", "==", normalizedCreatorEmail)),
        (snapshot) => {
          ictCreatorProjectsById.clear()
          snapshot.docs
            .filter((docSnap) => includeHidden || !toBooleanOr(docSnap.data().isHidden ?? docSnap.data().is_hidden, false))
            .forEach((docSnap) => {
              ictCreatorProjectsById.set(`${ICT_SOURCE_PREFIX}${docSnap.id}`, {
                ...docSnap.data(),
                id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
                originalProjectId: docSnap.id,
                sourceSchedule: "ict",
              })
            })
          resetIctScopedProjectTasks()
          scheduleNotify()
        },
        (error) => {
          console.error("Schedule creator ICT projects snapshot error:", error)
        },
      ),
      onSnapshot(
        query(collection(db, STRATEGY_PROJECTS_COLLECTION), where("createdByEmail", "==", normalizedCreatorEmail)),
        (snapshot) => {
          strategyCreatorProjectsById.clear()
          snapshot.docs
            .filter((docSnap) => includeHidden || !toBooleanOr(docSnap.data().isHidden ?? docSnap.data().is_hidden, false))
            .forEach((docSnap) => {
              strategyCreatorProjectsById.set(docSnap.id, {
                ...docSnap.data(),
                id: docSnap.id,
                originalProjectId: docSnap.id,
                sourceSchedule: "strategy",
              })
            })
          resetStrategyScopedProjectTasks()
          scheduleNotify()
        },
        (error) => {
          console.error("Schedule creator linked strategy projects snapshot error:", error)
        },
      ),
    )
  }

  if (normalizedPmEmail) {
    const ictLegacyProjectConstraints: any[] = [where("pmEmail", "==", normalizedPmEmail)]
    const ictMultiProjectConstraints: any[] = [where("pmEmails", "array-contains", normalizedPmEmail)]
    const strategyLegacyProjectConstraints: any[] = [where("pmEmail", "==", normalizedPmEmail)]
    const strategyMultiProjectConstraints: any[] = [where("pmEmails", "array-contains", normalizedPmEmail)]

    const mapIctProjectDocs = (snapshot: any) =>
      snapshot.docs
        .filter((docSnap: any) => includeHidden || !toBooleanOr(docSnap.data().isHidden ?? docSnap.data().is_hidden, false))
        .map((docSnap: any) => ({
          ...docSnap.data(),
          id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
          originalProjectId: docSnap.id,
          sourceSchedule: "ict",
        }))
    const mapStrategyProjectDocs = (snapshot: any) =>
      snapshot.docs
        .filter((docSnap: any) => includeHidden || !toBooleanOr(docSnap.data().isHidden ?? docSnap.data().is_hidden, false))
        .map((docSnap: any) => ({
          ...docSnap.data(),
          id: docSnap.id,
          originalProjectId: docSnap.id,
          sourceSchedule: "strategy",
        }))

    unsubscribes.push(
      onSnapshot(
        query(collection(db, PROJECTS_COLLECTION), ...ictLegacyProjectConstraints),
        (snapshot) => {
          syncIctPmProjectGroup("pmEmail", mapIctProjectDocs(snapshot))
        },
        (error) => {
          console.error("Schedule PM ICT projects snapshot error:", error)
        },
      ),
      onSnapshot(
        query(collection(db, PROJECTS_COLLECTION), ...ictMultiProjectConstraints),
        (snapshot) => {
          syncIctPmProjectGroup("pmEmails", mapIctProjectDocs(snapshot))
        },
        (error) => {
          console.error("Schedule PM ICT projects snapshot error:", error)
        },
      ),
      onSnapshot(
        query(collection(db, STRATEGY_PROJECTS_COLLECTION), ...strategyLegacyProjectConstraints),
        (snapshot) => {
          syncStrategyPmProjectGroup("pmEmail", mapStrategyProjectDocs(snapshot))
        },
        (error) => {
          console.error("Schedule PM linked strategy projects snapshot error:", error)
        },
      ),
      onSnapshot(
        query(collection(db, STRATEGY_PROJECTS_COLLECTION), ...strategyMultiProjectConstraints),
        (snapshot) => {
          syncStrategyPmProjectGroup("pmEmails", mapStrategyProjectDocs(snapshot))
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
    ictPmTaskPool?.unsubscribe()
    strategyPmTaskPool?.unsubscribe()
  }
}

export function subscribeHiddenProjectSummaries(callback: (projects: Project[]) => void) {
  let ictProjects: any[] = []
  let strategyProjects: any[] = []
  let strategyProjectUnsubscribes: Array<() => void> = []

  const notify = () => {
    callback(buildProjectTree(ictProjects, []).concat(buildProjectTree(strategyProjects, [])))
  }

  const resetStrategyProjectSubscriptions = (projectIds: string[]) => {
    strategyProjectUnsubscribes.forEach((unsubscribe) => unsubscribe())
    strategyProjectUnsubscribes = []
    strategyProjects = []

    const chunks = chunkValues(projectIds, 30)
    if (chunks.length === 0) {
      notify()
      return
    }

    const projectGroups = new Map<number, any[]>()
    strategyProjectUnsubscribes = chunks.map((chunk, index) =>
      onSnapshot(
        query(collection(db, STRATEGY_PROJECTS_COLLECTION), where(documentId(), "in", chunk)),
        (snapshot) => {
          projectGroups.set(
            index,
            snapshot.docs.map((docSnap) => ({
              ...docSnap.data(),
              id: `${STRATEGY_SOURCE_PREFIX}${docSnap.id}`,
              originalProjectId: docSnap.id,
              sourceSchedule: "strategy",
              isHidden: true,
            })),
          )
          strategyProjects = Array.from(projectGroups.values()).flat()
          notify()
        },
        (error) => {
          console.error("Hidden linked strategy project summaries snapshot error:", error)
        },
      ),
    )
  }

  const unsubscribeIctProjects = onSnapshot(
    query(collection(db, PROJECTS_COLLECTION), where("isHidden", "==", true)),
    (snapshot) => {
      ictProjects = snapshot.docs.map((docSnap) => ({
        ...docSnap.data(),
        id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
        originalProjectId: docSnap.id,
        sourceSchedule: "ict",
      }))
      notify()
    },
    (error) => {
      console.error("Hidden ICT projects snapshot error:", error)
      ictProjects = []
      notify()
    },
  )

  const unsubscribeLinkedStrategyVisibility = onSnapshot(
    doc(db, SETTINGS_COLLECTION, LINKED_STRATEGY_PROJECT_VISIBILITY_DOC),
    (snapshot) => {
      resetStrategyProjectSubscriptions(
        normalizeHiddenLinkedStrategyProjectIds(snapshot.data()?.[HIDDEN_LINKED_STRATEGY_PROJECT_IDS_FIELD]),
      )
    },
    (error) => {
      console.error("Hidden linked strategy project ids snapshot error:", error)
      resetStrategyProjectSubscriptions([])
    },
  )

  return () => {
    unsubscribeIctProjects()
    unsubscribeLinkedStrategyVisibility()
    strategyProjectUnsubscribes.forEach((unsubscribe) => unsubscribe())
  }
}

function mapHiddenIctTaskDoc(docSnap: any): Task {
  return normalizeTask(mapIctTaskDoc(docSnap))
}

function mapHiddenStrategyTaskDoc(docSnap: any): Task {
  const raw = docSnap.data()
  return normalizeTask({
    ...raw,
    id: `${STRATEGY_SOURCE_PREFIX}${docSnap.id}`,
    projectId: `${STRATEGY_SOURCE_PREFIX}${toStringOrEmpty(raw.projectId)}`,
    parentId: toOptionalString(raw.parentId) ? `${STRATEGY_SOURCE_PREFIX}${toStringOrEmpty(raw.parentId)}` : undefined,
    originalTaskId: docSnap.id,
    originalProjectId: toStringOrEmpty(raw.projectId),
    sourceSchedule: "strategy",
  })
}

export type HiddenTaskAccessScope = {
  projectIds: string[]
  fullProjectIds?: string[]
  personKeys?: string[]
  creatorEmail?: string
}

function subscribeHiddenTaskDocumentsByAccessScope(
  scope: HiddenTaskAccessScope,
  rootsOnly: boolean,
  callback: (tasks: Task[]) => void,
) {
  const ids = uniqueTrimmedStrings(scope.projectIds)
  if (ids.length === 0) {
    callback([])
    return () => {}
  }

  const idSet = new Set(ids)
  const fullIds = uniqueTrimmedStrings(scope.fullProjectIds || []).filter((id) => idSet.has(id))
  const fullIdSet = new Set(fullIds)
  const limitedIds = ids.filter((id) => !fullIdSet.has(id))
  const personKeyChunks = chunkValues(buildTaskPersonKeysFromValues(scope.personKeys || []).slice(0, 300), 30)
  const creatorEmail = normalizeEmail(scope.creatorEmail || "")
  const sources = [
    {
      key: "ict",
      collectionName: TASKS_COLLECTION,
      fullIds: fullIds.filter((id) => !isStrategyId(id)),
      limitedIds: limitedIds.filter((id) => !isStrategyId(id)),
      stripProjectId: (id: string) => stripIctId(id) || id,
      mapDoc: mapHiddenIctTaskDoc,
    },
    {
      key: "strategy",
      collectionName: STRATEGY_TASKS_COLLECTION,
      fullIds: fullIds.filter((id) => isStrategyId(id)),
      limitedIds: limitedIds.filter((id) => isStrategyId(id)),
      stripProjectId: (id: string) => stripStrategyId(id) || id,
      mapDoc: mapHiddenStrategyTaskDoc,
    },
  ]

  const queryGroups: Array<{
    groupKey: string
    taskQuery: any
    mapDoc: (docSnap: any) => Task
    allowedProjectIds?: Set<string>
  }> = []
  sources.forEach((source) => {
    chunkValues(source.fullIds.map(source.stripProjectId), 30).forEach((chunk, index) => {
      queryGroups.push({
        groupKey: `${source.key}:full:${index}`,
        taskQuery: query(
          collection(db, source.collectionName),
          where("projectId", "in", chunk),
          where(rootsOnly ? "isHiddenRoot" : "isHidden", "==", true),
        ),
        mapDoc: source.mapDoc,
      })
    })

    if (source.limitedIds.length === 0) return
    const allowedProjectIds = new Set(source.limitedIds)
    personKeyChunks.forEach((chunk, index) => {
      queryGroups.push({
        groupKey: `${source.key}:person:${index}`,
        taskQuery: query(
          collection(db, source.collectionName),
          where("personKeys", "array-contains-any", chunk),
          where("isHidden", "==", true),
        ),
        mapDoc: source.mapDoc,
        allowedProjectIds,
      })
    })
    if (creatorEmail) {
      queryGroups.push({
        groupKey: `${source.key}:creator`,
        taskQuery: query(
          collection(db, source.collectionName),
          where("createdByEmail", "==", creatorEmail),
          where("isHidden", "==", true),
        ),
        mapDoc: source.mapDoc,
        allowedProjectIds,
      })
    }
  })

  if (queryGroups.length === 0) {
    callback([])
    return () => {}
  }

  const groups = new Map<string, Task[]>()
  const ready = new Set<string>()
  const notify = () => {
    if (ready.size !== queryGroups.length) return
    const tasksById = new Map<string, Task>()
    groups.forEach((tasks) => tasks.forEach((task) => tasksById.set(task.id, task)))
    callback(Array.from(tasksById.values()))
  }
  const unsubscribes = queryGroups.map((group) =>
    onSnapshot(
      group.taskQuery,
      (snapshot: any) => {
        groups.set(
          group.groupKey,
          snapshot.docs
            .map(group.mapDoc)
            .filter((task: Task) => !group.allowedProjectIds || group.allowedProjectIds.has(task.projectId)),
        )
        ready.add(group.groupKey)
        notify()
      },
      (error: unknown) => {
        console.error("Hidden ICT task snapshot error:", error)
        groups.set(group.groupKey, [])
        ready.add(group.groupKey)
        notify()
      },
    ),
  )
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
}

export function subscribeHiddenTaskRootsByAccessScope(scope: HiddenTaskAccessScope, callback: (tasks: Task[]) => void) {
  return subscribeHiddenTaskDocumentsByAccessScope(scope, true, callback)
}

export function subscribeHiddenTasksByAccessScope(scope: HiddenTaskAccessScope, callback: (tasks: Task[]) => void) {
  return subscribeHiddenTaskDocumentsByAccessScope(scope, false, callback)
}

export function subscribeProjectsWithTasksByProjectIds(
  projectIds: string[],
  callback: (projects: Project[]) => void,
) {
  const ids = uniqueTrimmedStrings(projectIds)
  if (ids.length === 0) {
    callback([])
    return () => {}
  }

  const ictIds = ids.filter((id) => !isStrategyId(id)).map((id) => stripIctId(id) || id)
  const strategyIds = ids.filter((id) => isStrategyId(id)).map((id) => stripStrategyId(id) || id)
  const ictProjectGroups = new Map<string, any[]>()
  const ictTaskGroups = new Map<string, any[]>()
  const strategyProjectGroups = new Map<string, any[]>()
  const strategyTaskGroups = new Map<string, any[]>()

  const notify = () => {
    callback(
      buildIctScheduleProjectTree(
        Array.from(ictProjectGroups.values()).flat(),
        Array.from(ictTaskGroups.values()).flat(),
        Array.from(strategyProjectGroups.values()).flat(),
        Array.from(strategyTaskGroups.values()).flat(),
        strategyIds,
      ),
    )
  }

  const unsubscribes: Array<() => void> = []

  chunkValues(ictIds, 30).forEach((chunk, index) => {
    unsubscribes.push(
      onSnapshot(
        query(collection(db, PROJECTS_COLLECTION), where(documentId(), "in", chunk)),
        (snapshot) => {
          ictProjectGroups.set(
            `p:${index}`,
            snapshot.docs.map((docSnap) => ({
              ...docSnap.data(),
              id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
              originalProjectId: docSnap.id,
              sourceSchedule: "ict",
            })),
          )
          notify()
        },
        (error) => {
          console.error("Selected hidden ICT projects snapshot error:", error)
        },
      ),
      onSnapshot(
        query(collection(db, TASKS_COLLECTION), where("projectId", "in", chunk)),
        (snapshot) => {
          ictTaskGroups.set(
            `t:${index}`,
            snapshot.docs.map((docSnap) => {
              const raw = docSnap.data()
              return {
                ...raw,
                id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
                projectId: `${ICT_SOURCE_PREFIX}${toStringOrEmpty(raw.projectId)}`,
                parentId: toOptionalString(raw.parentId)
                  ? `${ICT_SOURCE_PREFIX}${toStringOrEmpty(raw.parentId)}`
                  : undefined,
                originalTaskId: docSnap.id,
                originalProjectId: toStringOrEmpty(raw.projectId),
                sourceSchedule: "ict",
              }
            }),
          )
          notify()
        },
        (error) => {
          console.error("Selected hidden ICT tasks snapshot error:", error)
        },
      ),
    )
  })

  chunkValues(strategyIds, 30).forEach((chunk, index) => {
    unsubscribes.push(
      onSnapshot(
        query(collection(db, STRATEGY_PROJECTS_COLLECTION), where(documentId(), "in", chunk)),
        (snapshot) => {
          strategyProjectGroups.set(`p:${index}`, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
          notify()
        },
        (error) => {
          console.error("Selected hidden linked strategy projects snapshot error:", error)
        },
      ),
      onSnapshot(
        query(collection(db, STRATEGY_TASKS_COLLECTION), where("projectId", "in", chunk)),
        (snapshot) => {
          strategyTaskGroups.set(`t:${index}`, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
          notify()
        },
        (error) => {
          console.error("Selected hidden linked strategy tasks snapshot error:", error)
        },
      ),
    )
  })

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
}

export function subscribeToData(
  callback: (projects: Project[]) => void,
  options: SubscribeOptions = {},
) {
  const includeHidden = options.includeHidden === true
  const linkedStrategyVisibilityRef = doc(db, SETTINGS_COLLECTION, LINKED_STRATEGY_PROJECT_VISIBILITY_DOC)
  let ictProjects: any[] = []
  let ictPersonNames = DEFAULT_DEPARTMENT_PERSON_SETTINGS.ICT
  let hiddenLinkedStrategyProjectIds: string[] = []
  const ictTaskGroups = new Map<string, any[]>()
  const strategyTaskGroups = new Map<string, any[]>()
  let areIctProjectsReady = false
  let areDepartmentPersonsReady = false
  let isLinkedStrategyVisibilityReady = false
  let disposed = false
  let notifyToken = 0
  let notifyScheduled = false
  let ictTaskPool: ReturnType<typeof createProjectTaskSubscriptionPool>
  let linkedStrategyTaskSubscription: ReturnType<typeof createLinkedStrategyTaskCandidateSubscription>

  const updateAndNotify = async () => {
    if (!areIctProjectsReady || !areDepartmentPersonsReady || !isLinkedStrategyVisibilityReady) return
    if (!ictTaskPool.isReady() || !linkedStrategyTaskSubscription.isReady()) return
    const currentToken = ++notifyToken
    const ictTasks = Array.from(ictTaskGroups.values()).flat()
    const strategyTasks = await collectLinkedStrategyTasksWithParents(
      Array.from(strategyTaskGroups.values()).flat(),
      ictPersonNames,
      includeHidden,
      hiddenLinkedStrategyProjectIds,
    )
    const strategyProjects = (
      await fetchProjectsForTaskIds(
        strategyTasks.map((task) => toStringOrEmpty(task.projectId)),
        STRATEGY_PROJECTS_COLLECTION,
      )
    ).filter((project) => isVisibleTask(project, includeHidden))

    if (!disposed && currentToken === notifyToken) {
      callback(buildIctScheduleProjectTree(ictProjects, ictTasks, strategyProjects, strategyTasks, hiddenLinkedStrategyProjectIds))
    }
  }

  const scheduleUpdate = () => {
    if (notifyScheduled) return
    notifyScheduled = true
    queueScheduleCallback(() => {
      notifyScheduled = false
      void updateAndNotify().catch((error) => {
        console.error("ICT schedule data snapshot error:", error)
        if (!disposed) callback([])
      })
    })
  }

  ictTaskPool = createProjectTaskSubscriptionPool({
    collectionName: TASKS_COLLECTION,
    groupPrefix: "visible-ict",
    taskGroups: ictTaskGroups,
    mapSnapshot: (snapshot) => snapshot.docs.map(mapIctTaskDoc),
    onChange: scheduleUpdate,
    onError: (error) => {
      console.error("Visible ICT project tasks snapshot error:", error)
    },
    buildConstraints: (projectIds) => [where("projectId", "in", projectIds), where("isHidden", "==", false)],
  })

  linkedStrategyTaskSubscription = createLinkedStrategyTaskCandidateSubscription({
    groupPrefix: "visible-strategy",
    taskGroups: strategyTaskGroups,
    includeHidden,
    onChange: scheduleUpdate,
    onError: (error) => {
      console.error("Visible linked strategy tasks snapshot error:", error)
    },
  })

  const projectsQuery = includeHidden
    ? query(collection(db, PROJECTS_COLLECTION))
    : query(collection(db, PROJECTS_COLLECTION), where("isHidden", "==", false))

  const unsubscribeDepartmentPersons = subscribeDepartmentPersonSettings((settings) => {
    ictPersonNames = settings.ICT
    areDepartmentPersonsReady = true
    linkedStrategyTaskSubscription.syncPersonNames(ictPersonNames)
    scheduleUpdate()
  })

  const unsubscribeProjects = onSnapshot(
    projectsQuery,
    (snapshot) => {
      ictProjects = snapshot.docs.map((docSnap) => ({
        ...docSnap.data(),
        id: `${ICT_SOURCE_PREFIX}${docSnap.id}`,
          originalProjectId: docSnap.id,
          sourceSchedule: "ict",
        }))
      areIctProjectsReady = true
      ictTaskPool.sync(snapshot.docs.map((docSnap) => docSnap.id))
      scheduleUpdate()
    },
    (error) => console.error("Projects snapshot error:", error),
  )

  const unsubscribeLinkedStrategyVisibility = onSnapshot(
    linkedStrategyVisibilityRef,
    (snapshot) => {
      hiddenLinkedStrategyProjectIds = normalizeHiddenLinkedStrategyProjectIds(
        snapshot.data()?.[HIDDEN_LINKED_STRATEGY_PROJECT_IDS_FIELD],
      )
      isLinkedStrategyVisibilityReady = true
      scheduleUpdate()
    },
    (error) => {
      console.error("Linked strategy project visibility snapshot error:", error)
    },
  )

  return () => {
    disposed = true
    unsubscribeDepartmentPersons()
    unsubscribeProjects()
    unsubscribeLinkedStrategyVisibility()
    ictTaskPool.unsubscribe()
    linkedStrategyTaskSubscription.unsubscribe()
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
  // 위 subscribeToData 와 동일하게 isIct 필터에 ICT 담당자 보조 조회를 합친다.
  const strategyIctTasksQuery = includeHidden
    ? query(collection(db, STRATEGY_TASKS_COLLECTION), where("isIct", "==", true))
    : query(collection(db, STRATEGY_TASKS_COLLECTION), where("isIct", "==", true), where("isHidden", "==", false))
  const strategyDepartmentTasksQuery = query(
    collection(db, STRATEGY_TASKS_COLLECTION),
    where("department", "==", "ICT"),
    ...(includeHidden ? [] : [where("isHidden", "==", false)]),
  )
  const departmentPersonSettings = await fetchDepartmentPersonSettings()
  const linkedStrategyPersonTasksQueries = buildLinkedStrategyPersonKeyChunks(departmentPersonSettings.ICT).map((chunk) =>
    query(
      collection(db, STRATEGY_TASKS_COLLECTION),
      where("personKeys", "array-contains-any", chunk),
      ...(includeHidden ? [] : [where("isHidden", "==", false)]),
    ),
  )

  const [
    projectsSnapshot,
    tasksSnapshot,
    strategyIctTasksSnapshot,
    strategyDepartmentTasksSnapshot,
    linkedStrategyPersonTasksSnapshots,
    linkedStrategyVisibilitySnapshot,
  ] = await Promise.all([
    getDocs(projectsQuery),
    getDocs(tasksQuery),
    getDocs(strategyIctTasksQuery),
    getDocs(strategyDepartmentTasksQuery),
    Promise.all(linkedStrategyPersonTasksQueries.map((personTasksQuery) => getDocs(personTasksQuery))),
    getDoc(doc(db, SETTINGS_COLLECTION, LINKED_STRATEGY_PROJECT_VISIBILITY_DOC)),
  ])

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
  const hiddenLinkedStrategyProjectIds = normalizeHiddenLinkedStrategyProjectIds(
    linkedStrategyVisibilitySnapshot.data()?.[HIDDEN_LINKED_STRATEGY_PROJECT_IDS_FIELD],
  )
  const strategyTasksData = await collectLinkedStrategyTasksWithParents(
    [
      ...strategyIctTasksSnapshot.docs.map(mapStrategyTaskDoc),
      ...strategyDepartmentTasksSnapshot.docs.map(mapStrategyTaskDoc),
      ...linkedStrategyPersonTasksSnapshots.flatMap((snapshot) => snapshot.docs.map(mapStrategyTaskDoc)),
    ],
    departmentPersonSettings.ICT,
    includeHidden,
    hiddenLinkedStrategyProjectIds,
  )
  const strategyProjectsData = (
    await fetchProjectsForTaskIds(
      strategyTasksData.map((task) => toStringOrEmpty(task.projectId)),
      STRATEGY_PROJECTS_COLLECTION,
    )
  ).filter((project) => isVisibleTask(project, includeHidden))

  return buildIctScheduleProjectTree(
    projectsData,
    tasksData,
    strategyProjectsData,
    strategyTasksData,
    hiddenLinkedStrategyProjectIds,
  )
}

export async function addProjectToDB(project: Omit<Project, "id" | "tasks">): Promise<string> {
  const docRef = await addDoc(
    collection(db, PROJECTS_COLLECTION),
    compactObject({
      ...stripSourcePrefixFromRecord(project as Record<string, unknown>),
      isHidden: typeof project.isHidden === "boolean" ? project.isHidden : false,
      displayOrder: Date.now(),
      createdAt: serverTimestamp(),
    }),
  )
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
  // ICT 페이지에서 strategy task 를 만드는 경우 server-side isIct 필터에도 잡혀야 함
  const isIctValue = isStrategyTask
    ? await computeIsIctFromTaskFieldsWithSettings(
        (cleanTask as { department?: unknown }).department ?? task.department,
        (cleanTask as { person?: unknown }).person ?? task.person,
      )
    : undefined
  const docRef = await addDoc(collection(db, targetCollection), {
    ...cleanTask,
    personKeys: buildTaskPersonKeys(task.person || ""),
    isHidden: typeof task.isHidden === "boolean" ? task.isHidden : false,
    isHiddenRoot: typeof task.isHiddenRoot === "boolean" ? task.isHiddenRoot : false,
    ...(isIctValue !== undefined ? { isIct: isIctValue } : {}),
    displayOrder: typeof task.displayOrder === "number" ? task.displayOrder : Date.now(),
  })
  return `${isStrategyTask ? STRATEGY_SOURCE_PREFIX : ICT_SOURCE_PREFIX}${docRef.id}`
}

export async function updateTaskInDB(taskId: string, updates: Omit<Partial<Task>, "parentId"> & { parentId?: string | null }): Promise<void> {
  const isStrategyTask = isStrategyId(taskId)
  const taskRef = doc(db, isStrategyTask ? STRATEGY_TASKS_COLLECTION : TASKS_COLLECTION, stripSourceId(taskId) || taskId)
  const cleanUpdates = stripSourcePrefixFromRecord(updates as Record<string, unknown>)
  const shouldUpdateIctMarker = isStrategyTask && (typeof updates.department === "string" || typeof updates.person === "string")
  const hasParentUpdate = Object.prototype.hasOwnProperty.call(cleanUpdates, "parentId")
  const hasProjectUpdate = Object.prototype.hasOwnProperty.call(cleanUpdates, "projectId")
  const shouldCheckMove = hasParentUpdate || hasProjectUpdate
  const shouldValidateHiddenRoot = cleanUpdates.isHiddenRoot === true
  const currentSnap = shouldUpdateIctMarker || shouldCheckMove || shouldValidateHiddenRoot ? await getDoc(taskRef) : null
  const current = currentSnap?.data() || {}
  let isIctUpdate: { isIct?: boolean } = {}
  if (shouldUpdateIctMarker) {
    isIctUpdate = {
      isIct: await computeIsIctFromTaskFieldsWithSettings(
        typeof cleanUpdates.department === "string" ? cleanUpdates.department : current.department,
        typeof cleanUpdates.person === "string" ? cleanUpdates.person : current.person,
      ),
    }
  }
  const currentParentId = typeof current.parentId === "string" ? current.parentId : null
  const nextParentId = hasParentUpdate
    ? typeof cleanUpdates.parentId === "string" ? cleanUpdates.parentId : null
    : currentParentId
  const currentProjectId = typeof current.projectId === "string" ? current.projectId : ""
  const nextProjectId = hasProjectUpdate && typeof cleanUpdates.projectId === "string" ? cleanUpdates.projectId : currentProjectId
  const moved = shouldCheckMove && (currentParentId !== nextParentId || currentProjectId !== nextProjectId)
  const nextIsHidden = typeof cleanUpdates.isHidden === "boolean" ? cleanUpdates.isHidden : current.isHidden === true
  const shouldRecomputeHiddenRoot = moved || shouldValidateHiddenRoot
  const requestedParentId = typeof updates.parentId === "string" ? updates.parentId : ""
  const nextParentCollection = requestedParentId.startsWith(STRATEGY_SOURCE_PREFIX)
    ? STRATEGY_TASKS_COLLECTION
    : requestedParentId.startsWith(ICT_SOURCE_PREFIX) ? TASKS_COLLECTION : isStrategyTask ? STRATEGY_TASKS_COLLECTION : TASKS_COLLECTION
  const nextParentIsHidden = shouldRecomputeHiddenRoot && nextIsHidden && nextParentId
    ? (await getDoc(doc(db, nextParentCollection, nextParentId))).data()?.isHidden === true
    : false
  const payload = {
    ...cleanUpdates,
    ...(typeof updates.person === "string" ? { personKeys: buildTaskPersonKeys(updates.person) } : {}),
    ...isIctUpdate,
    ...(shouldRecomputeHiddenRoot ? { isHiddenRoot: nextIsHidden && !nextParentIsHidden } : {}),
  }
  await updateDoc(taskRef, payload as any)
}

export async function deleteTaskFromDB(taskId: string): Promise<void> {
  const targetCollection = isStrategyId(taskId) ? STRATEGY_TASKS_COLLECTION : TASKS_COLLECTION
  const rawTaskId = stripSourceId(taskId) || taskId
  const taskRef = doc(db, targetCollection, rawTaskId)
  const taskSnap = await getDoc(taskRef)
  if (taskSnap.data()?.isHiddenRoot !== true) {
    await deleteDoc(taskRef)
    return
  }

  const childSnapshot = await getDocs(query(collection(db, targetCollection), where("parentId", "==", rawTaskId)))
  const hiddenChildren = childSnapshot.docs.filter((child) => child.data().isHidden === true)
  for (let offset = 0; offset < hiddenChildren.length; offset += 450) {
    const promotionBatch = writeBatch(db)
    hiddenChildren.slice(offset, offset + 450).forEach((child) => {
      promotionBatch.update(child.ref, { isHiddenRoot: true })
    })
    await promotionBatch.commit()
  }

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
    clearHistoryQueryCache()
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
    // ICT fetch 결과는 strategy history 일부도 포함 → ICT 캐시도 함께 비움
    clearHistoryQueryCache()
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
  clearHistoryQueryCache()
  return `${ICT_SOURCE_PREFIX}${docRef.id}`
}

// 60초 모듈 캐시 — addHistoryEntry 호출 시 무효화.
// ICT fetch 는 ict_history + strategy history 양쪽을 합쳐 반환하므로,
// 어느 분기든 ICT 캐시는 모두 비워야 함.
const HISTORY_QUERY_CACHE_TTL_MS = 60_000
type CachedHistoryQuery = { value: ChangeHistoryEntry[]; fetchedAt: number }
const historyQueryCache = new Map<string, CachedHistoryQuery>()

function getCachedHistoryQuery(key: string): ChangeHistoryEntry[] | undefined {
  const entry = historyQueryCache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.fetchedAt >= HISTORY_QUERY_CACHE_TTL_MS) {
    historyQueryCache.delete(key)
    return undefined
  }
  return entry.value
}

function setCachedHistoryQuery(key: string, value: ChangeHistoryEntry[]): void {
  historyQueryCache.set(key, { value, fetchedAt: Date.now() })
}

function clearHistoryQueryCache(): void {
  historyQueryCache.clear()
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
  const cacheKey = `f|${limitCount}|${normalizedActorEmail}`
  const cached = getCachedHistoryQuery(cacheKey)
  if (cached) return cached
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
  const result = mergeHistoryEntries(
    [
      ...snapshot.docs.map(mapIctHistoryDoc),
      ...strategySnapshot.docs.filter(isIctSourceHistoryDoc).map(mapStrategyHistoryDoc),
    ],
    limitCount,
  )
  setCachedHistoryQuery(cacheKey, result)
  return result
}

export async function fetchNotificationHistoryEntries(
  limitCount = 30,
  filter: HistoryNotificationFilter = {},
): Promise<ChangeHistoryEntry[]> {
  const personKeys = buildPersonKeys(filter.personKeys || []).slice(0, 30)
  const departmentGroups = (filter.departmentGroups || []).slice(0, 30)
  const cacheKey = `n|${limitCount}|${personKeys.join(",")}|${departmentGroups.join(",")}`
  const cached = getCachedHistoryQuery(cacheKey)
  if (cached) return cached
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

  if (historyQueries.length === 0) {
    setCachedHistoryQuery(cacheKey, [])
    return []
  }
  const snapshots = await Promise.all(historyQueries.map((item) => getDocs(item.query)))
  const entries = snapshots.flatMap((snapshot, index) => {
    const historyQuery = historyQueries[index]
    const docs = historyQuery.source === "strategy" ? snapshot.docs.filter(isIctSourceHistoryDoc) : snapshot.docs
    return docs.map(historyQuery.source === "strategy" ? mapStrategyHistoryDoc : mapIctHistoryDoc)
  })
  const result = mergeHistoryEntries(entries, limitCount)
  setCachedHistoryQuery(cacheKey, result)
  return result
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

export async function fetchDashboardSortBy(): Promise<DashboardSortBy> {
  try {
    const snap = await getDoc(doc(db, SETTINGS_COLLECTION, DASHBOARD_PREFERENCES_DOC))
    const raw = snap.data() as { sortBy?: unknown } | undefined
    const candidate = toStringOrEmpty(raw?.sortBy) as DashboardSortBy
    if (candidate === "latest" || candidate === "name" || candidate === "type" || candidate === "progress") {
      return candidate
    }
    return "latest"
  } catch (error) {
    console.error("Dashboard sort fetch error:", error)
    return "latest"
  }
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
