import { db } from "./firebase"
import {
  addDoc,
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
import { resolveTaskChildPresenceOnce } from "./task-child-presence"

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
    isHiddenRoot: toBooleanOr(raw?.isHiddenRoot ?? raw?.is_hidden_root, false),
    displayOrder: toNumberOr(raw?.displayOrder, Number.MAX_SAFE_INTEGER),
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

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size))
  return chunks
}

// See lib/firestore-service.ts for the rationale behind these caches.
const DOC_CACHE_TTL_MS = 60_000
type CachedDoc = { value: any; fetchedAt: number }
const projectDocCache = new Map<string, CachedDoc>()
const parentTaskDocCache = new Map<string, CachedDoc>()

function getCachedDoc(cache: Map<string, CachedDoc>, id: string, now: number): any | undefined {
  const entry = cache.get(id)
  if (!entry) return undefined
  if (now - entry.fetchedAt >= DOC_CACHE_TTL_MS) {
    cache.delete(id)
    return undefined
  }
  return entry.value
}

async function fetchDocsByIds(collectionName: string, ids: string[]): Promise<any[]> {
  if (ids.length === 0) return []
  const chunks = chunkValues(ids, 30)
  const snapshots = await Promise.all(
    chunks.map((chunk) => getDocs(query(collection(db, collectionName), where(documentId(), "in", chunk)))),
  )
  return snapshots.flatMap((snap) => snap.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
}

async function fetchParentTaskChain(tasksById: Map<string, any>) {
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
      const cached = getCachedDoc(parentTaskDocCache, id, now)
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
      const fetched = await fetchDocsByIds(TASKS_COLLECTION, toFetch)
      fetched.forEach((task) => {
        parentTaskDocCache.set(task.id, { value: task, fetchedAt: now })
        tasksById.set(task.id, task)
        const nextParentId = toOptionalString(task.parentId)
        if (nextParentId && !tasksById.has(nextParentId)) nextPending.add(nextParentId)
      })
    }

    pending = nextPending
  }
}

async function fetchProjectsForTasks(tasks: any[]) {
  const now = Date.now()
  const projectIds = Array.from(new Set(tasks.map((task) => toStringOrEmpty(task.projectId)).filter(Boolean)))

  const result: any[] = []
  const missing: string[] = []
  projectIds.forEach((id) => {
    const cached = getCachedDoc(projectDocCache, id, now)
    if (cached) {
      result.push(cached)
    } else {
      missing.push(id)
    }
  })

  if (missing.length > 0) {
    const fetched = await fetchDocsByIds(PROJECTS_COLLECTION, missing)
    fetched.forEach((project) => {
      projectDocCache.set(project.id, { value: project, fetchedAt: now })
      result.push(project)
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
    let allTasks = Array.from(tasksById.values())
    if (options.resolveLeafStateOnce) {
      const childPresence = await resolveTaskChildPresenceOnce(
        TASKS_COLLECTION,
        allTasks.map((task) => toStringOrEmpty(task.id)),
      )
      allTasks = allTasks.map((task) => ({
        ...task,
        isLeafInStore: childPresence.get(toStringOrEmpty(task.id)) === "leaf",
      }))
    }
    const projectsData = await fetchProjectsForTasks(allTasks)
    if (!disposed) callback(buildProjectTree(projectsData, allTasks))
  }

  const unsubscribes = chunks.map((chunk, index) => {
    const constraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    if (!includeHidden) constraints.push(where("isHidden", "==", false))
    if (dateRange) constraints.push(where("endDate", ">=", dateRange.startDate))
    return onSnapshot(
      query(collection(db, TASKS_COLLECTION), ...constraints),
      (snapshot) => {
        taskGroups.set(
          index,
          snapshot.docs
            .map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
            .filter((task) => taskOverlapsQueryDateRange(task, dateRange)),
        )
        void notify().catch((error) => {
          console.error("Scoped FA data snapshot error:", error)
          if (!disposed) callback([])
        })
      },
      (error) => {
        console.error("Scoped FA tasks snapshot error:", error)
      },
    )
  })

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

  const taskGroups = new Map<string, any[]>()
  const pmProjectsById = new Map<string, any>()
  const pmProjectGroups = new Map<string, any[]>()
  const creatorProjectsById = new Map<string, any>()
  let disposed = false
  let notifyToken = 0
  let notifyScheduled = false
  let pmTaskPool: ReturnType<typeof createProjectTaskSubscriptionPool> | null = null

  const notify = async () => {
    if (pmTaskPool && !pmTaskPool.isReady()) return
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
    creatorProjectsById.forEach((project, projectId) => projectsById.set(projectId, project))

    if (!disposed && currentToken === notifyToken) {
      callback(buildProjectTree(Array.from(projectsById.values()), allTasks))
    }
  }

  const scheduleNotify = () => {
    if (notifyScheduled) return
    notifyScheduled = true
    queueScheduleCallback(() => {
      notifyScheduled = false
      void notify().catch((error) => {
        console.error("Schedule FA data snapshot error:", error)
        if (!disposed) callback([])
      })
    })
  }

  const resetScopedProjectTasks = () => {
    pmTaskPool?.sync(Array.from(new Set([...pmProjectsById.keys(), ...creatorProjectsById.keys()])))
  }

  const syncPmProjectGroup = (key: string, projects: any[]) => {
    pmProjectGroups.set(key, projects)
    pmProjectsById.clear()
    pmProjectGroups.forEach((items) => {
      items.forEach((project) => pmProjectsById.set(toStringOrEmpty(project.id), project))
    })
    resetScopedProjectTasks()
    scheduleNotify()
  }

  const unsubscribes: Array<() => void> = []

  pmTaskPool = createProjectTaskSubscriptionPool({
    collectionName: TASKS_COLLECTION,
    groupPrefix: "pm",
    taskGroups,
    mapSnapshot: (snapshot) => snapshot.docs.map((docSnap: any) => ({ ...docSnap.data(), id: docSnap.id })),
    onChange: scheduleNotify,
    onError: (error) => {
      console.error("Schedule PM FA tasks snapshot error:", error)
    },
    buildConstraints: (projectIds) => [
      where("projectId", "in", projectIds),
      ...(includeHidden ? [] : [where("isHidden", "==", false)]),
    ],
  })

  chunkValues(queryKeys, 30).forEach((chunk, index) => {
    const constraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    if (!includeHidden) constraints.push(where("isHidden", "==", false))
    unsubscribes.push(
      onSnapshot(
        query(collection(db, TASKS_COLLECTION), ...constraints),
        (snapshot) => {
          taskGroups.set(`person:${index}`, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
          scheduleNotify()
        },
        (error) => {
          console.error("Schedule assignee FA tasks snapshot error:", error)
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
          taskGroups.set("creator", snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
          scheduleNotify()
        },
        (error) => {
          console.error("Schedule creator FA tasks snapshot error:", error)
        },
      ),
      onSnapshot(
        query(collection(db, PROJECTS_COLLECTION), where("createdByEmail", "==", normalizedCreatorEmail)),
        (snapshot) => {
          creatorProjectsById.clear()
          snapshot.docs
            .filter((docSnap) => includeHidden || !toBooleanOr(docSnap.data().isHidden ?? docSnap.data().is_hidden, false))
            .forEach((docSnap) => {
              creatorProjectsById.set(docSnap.id, { ...docSnap.data(), id: docSnap.id })
            })
          resetScopedProjectTasks()
          scheduleNotify()
        },
        (error) => {
          console.error("Schedule creator FA projects snapshot error:", error)
        },
      ),
    )
  }

  if (normalizedPmEmail) {
    const legacyProjectConstraints: any[] = [where("pmEmail", "==", normalizedPmEmail)]
    const multiProjectConstraints: any[] = [where("pmEmails", "array-contains", normalizedPmEmail)]
    const mapVisibleProjectDocs = (snapshot: any) =>
      snapshot.docs
        .filter((docSnap: any) => includeHidden || !toBooleanOr(docSnap.data().isHidden ?? docSnap.data().is_hidden, false))
        .map((docSnap: any) => ({ ...docSnap.data(), id: docSnap.id }))
    unsubscribes.push(
      onSnapshot(
        query(collection(db, PROJECTS_COLLECTION), ...legacyProjectConstraints),
        (snapshot) => {
          syncPmProjectGroup("pmEmail", mapVisibleProjectDocs(snapshot))
        },
        (error) => {
          console.error("Schedule PM FA projects snapshot error:", error)
        },
      ),
      onSnapshot(
        query(collection(db, PROJECTS_COLLECTION), ...multiProjectConstraints),
        (snapshot) => {
          syncPmProjectGroup("pmEmails", mapVisibleProjectDocs(snapshot))
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
    pmTaskPool?.unsubscribe()
  }
}

export function subscribeHiddenProjectSummaries(callback: (projects: Project[]) => void) {
  return onSnapshot(
    query(collection(db, PROJECTS_COLLECTION), where("isHidden", "==", true)),
    (snapshot) => {
      callback(buildProjectTree(snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })), []))
    },
    (error) => {
      console.error("Hidden FA projects snapshot error:", error)
      callback([])
    },
  )
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
  const limitedIdSet = new Set(limitedIds)
  const queryGroups: Array<{ key: string; taskQuery: any; allowedProjectIds?: Set<string> }> = []

  chunkValues(fullIds, 30).forEach((chunk, index) => {
    queryGroups.push({
      key: `full:${index}`,
      taskQuery: query(
        collection(db, TASKS_COLLECTION),
        where("projectId", "in", chunk),
        where(rootsOnly ? "isHiddenRoot" : "isHidden", "==", true),
      ),
    })
  })

  if (limitedIds.length > 0) {
    chunkValues(buildTaskPersonKeysFromValues(scope.personKeys || []).slice(0, 300), 30).forEach((chunk, index) => {
      queryGroups.push({
        key: `person:${index}`,
        taskQuery: query(
          collection(db, TASKS_COLLECTION),
          where("personKeys", "array-contains-any", chunk),
          where("isHidden", "==", true),
        ),
        allowedProjectIds: limitedIdSet,
      })
    })
    const creatorEmail = normalizeEmail(scope.creatorEmail || "")
    if (creatorEmail) {
      queryGroups.push({
        key: "creator",
        taskQuery: query(
          collection(db, TASKS_COLLECTION),
          where("createdByEmail", "==", creatorEmail),
          where("isHidden", "==", true),
        ),
        allowedProjectIds: limitedIdSet,
      })
    }
  }

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
        const tasks = snapshot.docs
          .map((docSnap: any) => normalizeTask({ ...docSnap.data(), id: docSnap.id }))
          .filter((task: Task) => !group.allowedProjectIds || group.allowedProjectIds.has(task.projectId))
        groups.set(group.key, tasks)
        ready.add(group.key)
        notify()
      },
      (error: unknown) => {
        console.error("Hidden FA task snapshot error:", error)
        groups.set(group.key, [])
        ready.add(group.key)
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

  const projectGroups = new Map<number, any[]>()
  const taskGroups = new Map<number, any[]>()
  const notify = () => {
    callback(buildProjectTree(Array.from(projectGroups.values()).flat(), Array.from(taskGroups.values()).flat()))
  }

  const unsubscribes = chunkValues(ids, 30).flatMap((chunk, index) => [
    onSnapshot(
      query(collection(db, PROJECTS_COLLECTION), where(documentId(), "in", chunk)),
      (snapshot) => {
        projectGroups.set(index, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
        notify()
      },
      (error) => {
        console.error("Selected hidden FA projects snapshot error:", error)
      },
    ),
    onSnapshot(
      query(collection(db, TASKS_COLLECTION), where("projectId", "in", chunk)),
      (snapshot) => {
        taskGroups.set(index, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
        notify()
      },
      (error) => {
        console.error("Selected hidden FA tasks snapshot error:", error)
      },
    ),
  ])

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
}

export function subscribeToData(
  callback: (projects: Project[]) => void,
  options: SubscribeOptions = {},
) {
  const includeHidden = options.includeHidden === true
  if (!includeHidden) {
    let projects: any[] = []
    const taskGroups = new Map<string, any[]>()
    let notifyScheduled = false
    let taskPool: ReturnType<typeof createProjectTaskSubscriptionPool>

    const notify = () => {
      if (!taskPool.isReady()) return
      callback(buildProjectTree(projects, Array.from(taskGroups.values()).flat()))
    }

    const scheduleNotify = () => {
      if (notifyScheduled) return
      notifyScheduled = true
      queueScheduleCallback(() => {
        notifyScheduled = false
        notify()
      })
    }

    taskPool = createProjectTaskSubscriptionPool({
      collectionName: TASKS_COLLECTION,
      groupPrefix: "visible",
      taskGroups,
      mapSnapshot: (snapshot) => snapshot.docs.map((docSnap: any) => ({ ...docSnap.data(), id: docSnap.id })),
      onChange: scheduleNotify,
      onError: (error) => {
        console.error("Visible FA project tasks snapshot error:", error)
      },
      buildConstraints: (projectIds) => [where("projectId", "in", projectIds), where("isHidden", "==", false)],
    })

    const unsubscribeProjects = onSnapshot(
      query(collection(db, PROJECTS_COLLECTION), where("isHidden", "==", false)),
      (snapshot) => {
        projects = snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
        taskPool.sync(snapshot.docs.map((docSnap) => docSnap.id))
        scheduleNotify()
      },
      (error) => {
        console.error("Projects snapshot error:", error)
      },
    )

    return () => {
      unsubscribeProjects()
      taskPool.unsubscribe()
    }
  }

  const projectsQuery = includeHidden
    ? query(collection(db, PROJECTS_COLLECTION))
    : query(collection(db, PROJECTS_COLLECTION), where("isHidden", "==", false))
  const tasksQuery = includeHidden
    ? query(collection(db, TASKS_COLLECTION))
    : query(collection(db, TASKS_COLLECTION), where("isHidden", "==", false))

  let projects: any[] = []
  let tasks: any[] = []
  let projectsReady = false
  let tasksReady = false

  const updateAndNotify = () => {
    if (!projectsReady || !tasksReady) return
    callback(buildProjectTree(projects, tasks))
  }

  const unsubscribeProjects = onSnapshot(
    projectsQuery,
    (snapshot) => {
      projects = snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
      projectsReady = true
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
      tasksReady = true
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

  const projectsSnapshot = await getDocs(projectsQuery)
  const tasksSnapshot = await getDocs(tasksQuery)

  const projectsData = projectsSnapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
  const tasksData = tasksSnapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))

  return buildProjectTree(projectsData, tasksData)
}

export async function addProjectToDB(project: Omit<Project, "id" | "tasks">): Promise<string> {
  const docRef = await addDoc(
    collection(db, PROJECTS_COLLECTION),
    compactObject({
      ...project,
      isHidden: typeof project.isHidden === "boolean" ? project.isHidden : false,
      displayOrder: Date.now(),
      createdAt: serverTimestamp(),
    }),
  )
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
    isHidden: typeof task.isHidden === "boolean" ? task.isHidden : false,
    isHiddenRoot: typeof task.isHiddenRoot === "boolean" ? task.isHiddenRoot : false,
    displayOrder: typeof task.displayOrder === "number" ? task.displayOrder : Date.now(),
  })
  return docRef.id
}

export async function updateTaskInDB(taskId: string, updates: Omit<Partial<Task>, "parentId"> & { parentId?: string | null }): Promise<void> {
  const taskRef = doc(db, TASKS_COLLECTION, taskId)
  const hasParentUpdate = Object.prototype.hasOwnProperty.call(updates, "parentId")
  const hasProjectUpdate = Object.prototype.hasOwnProperty.call(updates, "projectId")
  const shouldCheckMove = hasParentUpdate || hasProjectUpdate
  const shouldValidateHiddenRoot = updates.isHiddenRoot === true
  const current = shouldCheckMove || shouldValidateHiddenRoot ? (await getDoc(taskRef)).data() || {} : {}
  const currentParentId = typeof current.parentId === "string" ? current.parentId : null
  const nextParentId = hasParentUpdate ? updates.parentId ?? null : currentParentId
  const currentProjectId = typeof current.projectId === "string" ? current.projectId : ""
  const nextProjectId = hasProjectUpdate && typeof updates.projectId === "string" ? updates.projectId : currentProjectId
  const moved = shouldCheckMove && (currentParentId !== nextParentId || currentProjectId !== nextProjectId)
  const nextIsHidden = typeof updates.isHidden === "boolean" ? updates.isHidden : current.isHidden === true
  const shouldRecomputeHiddenRoot = moved || shouldValidateHiddenRoot
  const nextParentIsHidden = shouldRecomputeHiddenRoot && nextIsHidden && nextParentId
    ? (await getDoc(doc(db, TASKS_COLLECTION, nextParentId))).data()?.isHidden === true
    : false
  const payload = {
    ...updates,
    ...(typeof updates.person === "string" ? { personKeys: buildTaskPersonKeys(updates.person) } : {}),
    ...(shouldRecomputeHiddenRoot ? { isHiddenRoot: nextIsHidden && !nextParentIsHidden } : {}),
  }
  await updateDoc(taskRef, payload)
}

export async function deleteTaskFromDB(taskId: string): Promise<void> {
  const taskRef = doc(db, TASKS_COLLECTION, taskId)
  const taskSnap = await getDoc(taskRef)
  if (taskSnap.data()?.isHiddenRoot !== true) {
    await deleteDoc(taskRef)
    return
  }

  const childSnapshot = await getDocs(query(collection(db, TASKS_COLLECTION), where("parentId", "==", taskId)))
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
  clearHistoryQueryCache()
  return docRef.id
}

// 60초 모듈 캐시 — addHistoryEntry 호출 시 무효화.
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
  const cacheKey = `f|${limitCount}|${normalizedActorEmail}`
  const cached = getCachedHistoryQuery(cacheKey)
  if (cached) return cached
  const historyQ = normalizedActorEmail
    ? query(
        collection(db, HISTORY_COLLECTION),
        where("actorEmail", "==", normalizedActorEmail),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      )
    : query(collection(db, HISTORY_COLLECTION), orderBy("createdAt", "desc"), limit(limitCount))
  const snapshot = await getDocs(historyQ)
  const result = snapshot.docs.map(mapHistoryDoc)
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
  if (historyQueries.length === 0) {
    setCachedHistoryQuery(cacheKey, [])
    return []
  }

  const snapshots = await Promise.all(historyQueries.map((historyQ) => getDocs(historyQ)))
  const byId = new Map<string, ChangeHistoryEntry>()
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((docSnap) => byId.set(docSnap.id, mapHistoryDoc(docSnap)))
  })
  const result = Array.from(byId.values())
    .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
    .slice(0, limitCount)
  setCachedHistoryQuery(cacheKey, result)
  return result
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
      [FA_GANTT_COLLAPSE_STATE_FIELD]: normalizeGanttCollapseState(state),
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
      [FA_GANTT_LEFT_PANEL_WIDTH_FIELD]: normalizedWidth,
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
