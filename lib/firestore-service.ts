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
import type { EditableTaskField, Project, Task } from "./data"
import { EDITABLE_TASK_FIELD_OPTIONS } from "./data"
import {
  DEFAULT_ORG_DEPARTMENT_PERSON_SETTINGS,
  cloneDepartmentOrgChart,
  getDepartmentOrgPersonNamesFromOrg,
  type DepartmentOrg,
} from "./department-org"
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

const PROJECTS_COLLECTION = "projects"
const TASKS_COLLECTION = "tasks"
const HISTORY_COLLECTION = "history"
const SETTINGS_COLLECTION = "settings"
const DASHBOARD_PREFERENCES_DOC = "dashboard_preferences"
const DEPARTMENT_PERSON_SETTINGS_DOC = "department_person_settings"
const DEPARTMENT_ORG_SETTINGS_DOC = "department_org_settings"
const GLOBAL_SCHEDULES_DOC = "global_schedules"
const MY_PAGE_EDITABLE_FIELDS_DOC = "my_page_editable_fields"
const USER_PROFILES_COLLECTION = "user_profiles"
const GANTT_COLLAPSE_STATE_FIELD = "ganttCollapseState"
const GANTT_LEFT_PANEL_WIDTH_FIELD = "ganttLeftPanelWidth"
const GANTT_DETAIL_PANEL_WIDTH_FIELD = "ganttDetailPanelWidth"
const USER_PAGE_PERMISSIONS_COLLECTION = "user_page_permissions"

export type DashboardSortBy = "name" | "type" | "progress" | "latest"
export type GanttCollapseState = {
  collapsedProjectIds: string[]
  collapsedTaskIds: string[]
}
export const DEPARTMENT_PERSON_GROUPS = ["ICT", "FA", "전략기획", "기타"] as const
export type DepartmentPersonGroup = (typeof DEPARTMENT_PERSON_GROUPS)[number]

export const MBTI_TYPES = [
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP",
] as const
export type MbtiType = (typeof MBTI_TYPES)[number]
export type MyPageTaskPriority = "high" | "medium" | "low"
export type MyPageTaskPreference = {
  checked: boolean
  priority: MyPageTaskPriority
  important: boolean
  order?: number
  deleted?: boolean
}
export type MyPagePersonalTask = {
  id: string
  title: string
  memo?: string
  startDate?: string
  endDate?: string
  checked: boolean
  priority: MyPageTaskPriority
  important: boolean
  order: number
  createdAt?: number
  updatedAt?: number
}
export type UserProfile = {
  email: string
  lastLoginAt?: Date
  taskAliases?: string[]
  hiddenOwnerOptions?: string[]
  myPageTaskPreferences?: Record<string, MyPageTaskPreference>
  myPagePersonalTasks?: MyPagePersonalTask[]
  myPageMemo?: string
  myPageCollapsedProjectGroups?: Record<string, boolean>
  seenRecentChangeIds?: string[]
  department?: DepartmentPersonGroup
  mbti?: MbtiType
}

export type DepartmentPersonSettings = Record<DepartmentPersonGroup, string[]>
export type DepartmentOrgSettings = Record<DepartmentPersonGroup, DepartmentOrg>

export type UserPagePermissionEntry = {
  email: string
  permissions: UserPagePermissions
  updatedAt?: Date
}

export type GlobalScheduleType = "holiday" | "annual_leave"
export type GlobalSchedule = {
  id: string
  title: string
  type: GlobalScheduleType
  startDate: string
  endDate: string
  createdAt?: Date
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

export type MyPageEditableFieldsSettings = EditableTaskField[]

export const DEFAULT_MY_PAGE_EDITABLE_FIELDS: MyPageEditableFieldsSettings = [
  "status",
  "memo",
  "manDays",
  "startDate",
  "endDate",
]

const ALL_EDITABLE_FIELD_KEYS: ReadonlySet<EditableTaskField> = new Set(
  EDITABLE_TASK_FIELD_OPTIONS.map((option) => option.key),
)

function normalizeMyPageEditableFields(raw: unknown): MyPageEditableFieldsSettings {
  if (!Array.isArray(raw)) return [...DEFAULT_MY_PAGE_EDITABLE_FIELDS]
  const collected: EditableTaskField[] = []
  raw.forEach((value) => {
    if (typeof value !== "string") return
    if (!ALL_EDITABLE_FIELD_KEYS.has(value as EditableTaskField)) return
    if (collected.includes(value as EditableTaskField)) return
    collected.push(value as EditableTaskField)
  })
  return collected
}

export function isUserOwnerOfTask(task: Pick<Task, "person">, aliases: string[]): boolean {
  const person = (task.person || "").trim().toLowerCase()
  if (!person) return false
  const tokens = person
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
  return aliases.some((rawAlias) => {
    const alias = rawAlias.trim().toLowerCase()
    if (!alias) return false
    return tokens.includes(alias) || person.includes(alias)
  })
}

export const DEFAULT_DEPARTMENT_PERSON_SETTINGS: DepartmentPersonSettings = {
  ICT: [...DEFAULT_ORG_DEPARTMENT_PERSON_SETTINGS.ICT],
  FA: [...DEFAULT_ORG_DEPARTMENT_PERSON_SETTINGS.FA],
  전략기획: [...DEFAULT_ORG_DEPARTMENT_PERSON_SETTINGS.전략기획],
  기타: [...DEFAULT_ORG_DEPARTMENT_PERSON_SETTINGS.기타],
}

export const DEFAULT_DEPARTMENT_ORG_SETTINGS: DepartmentOrgSettings = cloneDepartmentOrgChart()

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

function removeUndefinedValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUndefinedValues)
  if (!value || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, removeUndefinedValues(entryValue)]),
  )
}

function normalizeMyPageTaskPreferences(raw: unknown): Record<string, MyPageTaskPreference> {
  if (!raw || typeof raw !== "object") return {}

  const result: Record<string, MyPageTaskPreference> = {}
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (!value || typeof value !== "object") return
    const candidate = value as Record<string, unknown>
    const priority =
      candidate.priority === "high" || candidate.priority === "medium" || candidate.priority === "low"
        ? candidate.priority
        : "medium"
    result[key] = {
      checked: Boolean(candidate.checked),
      priority,
      important: Boolean(candidate.important),
      order: toNumberOr(candidate.order, Number.MAX_SAFE_INTEGER),
      deleted: toBooleanOr(candidate.deleted, false),
    }
  })
  return result
}

function normalizeMyPagePersonalTasks(raw: unknown): MyPagePersonalTask[] {
  if (!Array.isArray(raw)) return []

  const tasks: MyPagePersonalTask[] = []
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return
    const candidate = entry as Record<string, unknown>
    const title = toStringOrEmpty(candidate.title)
    if (!title) return
    const priority =
      candidate.priority === "high" || candidate.priority === "medium" || candidate.priority === "low"
        ? candidate.priority
        : "medium"
    tasks.push({
      id: toStringOrEmpty(candidate.id) || `personal-${Date.now()}-${index}`,
      title,
      memo: toOptionalString(candidate.memo),
      startDate: toOptionalString(candidate.startDate),
      endDate: toOptionalString(candidate.endDate),
      checked: Boolean(candidate.checked),
      priority,
      important: Boolean(candidate.important),
      order: toNumberOr(candidate.order, index),
      createdAt: toNumberOr(candidate.createdAt, Date.now()),
      updatedAt: toNumberOr(candidate.updatedAt, Date.now()),
    })
  })
  return tasks.sort((a, b) => a.order - b.order)
}

function uniqueTrimmedStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeDepartmentGroup(value: unknown): DepartmentPersonGroup | undefined {
  const normalized = toStringOrEmpty(value)
  if (normalized === "ICT") return "ICT"
  if (normalized === "FA") return "FA"
  if (normalized === "전략기획") return "전략기획"
  if (normalized === "기타") return "기타"
  return undefined
}

function todayLabel(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  return `${mm}월 ${dd}일`
}

function normalizeDepartmentPersonSettings(
  raw?: Partial<Record<DepartmentPersonGroup, unknown>>,
): DepartmentPersonSettings {
  return {
    ICT: Array.isArray(raw?.ICT)
      ? uniqueTrimmedStrings(raw.ICT.filter((value): value is string => typeof value === "string"))
      : [...DEFAULT_DEPARTMENT_PERSON_SETTINGS.ICT],
    FA: Array.isArray(raw?.FA)
      ? uniqueTrimmedStrings(raw.FA.filter((value): value is string => typeof value === "string"))
      : [...DEFAULT_DEPARTMENT_PERSON_SETTINGS.FA],
    전략기획: Array.isArray(raw?.전략기획)
      ? uniqueTrimmedStrings(raw.전략기획.filter((value): value is string => typeof value === "string"))
      : [...DEFAULT_DEPARTMENT_PERSON_SETTINGS.전략기획],
    기타: Array.isArray(raw?.기타)
      ? uniqueTrimmedStrings(raw.기타.filter((value): value is string => typeof value === "string"))
      : [...DEFAULT_DEPARTMENT_PERSON_SETTINGS.기타],
  }
}

function normalizeOrgMember(raw: unknown) {
  if (!raw || typeof raw !== "object") return undefined
  const candidate = raw as Record<string, unknown>
  const name = toStringOrEmpty(candidate.name)
  if (!name) return undefined
  const title = toStringOrEmpty(candidate.title)
  return title ? { name, title } : { name }
}

function normalizeDepartmentOrg(raw: unknown, fallback: DepartmentOrg): DepartmentOrg {
  if (!raw || typeof raw !== "object") {
    return {
      ...fallback,
      leader: fallback.leader ? { ...fallback.leader } : undefined,
      advisors: fallback.advisors?.map((member) => ({ ...member })) || [],
      teams: fallback.teams.map((team) => ({
        ...team,
        members: team.members.map((member) => ({ ...member })),
      })),
    }
  }

  const candidate = raw as Record<string, unknown>
  const leader = normalizeOrgMember(candidate.leader) || fallback.leader
  const advisors = Array.isArray(candidate.advisors)
    ? candidate.advisors.map(normalizeOrgMember).filter((member): member is NonNullable<typeof member> => Boolean(member))
    : fallback.advisors?.map((member) => ({ ...member })) || []
  const teams = Array.isArray(candidate.teams)
    ? candidate.teams
        .map((entry, index) => {
          if (!entry || typeof entry !== "object") return null
          const team = entry as Record<string, unknown>
          const fallbackTeam = fallback.teams[index]
          const name = toStringOrEmpty(team.name) || fallbackTeam?.name || `팀 ${index + 1}`
          const members = Array.isArray(team.members)
            ? team.members.map(normalizeOrgMember).filter((member): member is NonNullable<typeof member> => Boolean(member))
            : fallbackTeam?.members.map((member) => ({ ...member })) || []
          return { name, members }
        })
        .filter((team): team is DepartmentOrg["teams"][number] => Boolean(team))
    : fallback.teams.map((team) => ({
        ...team,
        members: team.members.map((member) => ({ ...member })),
      }))

  return {
    group: fallback.group,
    label: toStringOrEmpty(candidate.label) || fallback.label,
    leader: leader ? { ...leader } : undefined,
    advisors,
    teams,
  }
}

function normalizeDepartmentOrgSettings(raw?: Partial<Record<DepartmentPersonGroup, unknown>>): DepartmentOrgSettings {
  return {
    ICT: normalizeDepartmentOrg(raw?.ICT, DEFAULT_DEPARTMENT_ORG_SETTINGS.ICT),
    FA: normalizeDepartmentOrg(raw?.FA, DEFAULT_DEPARTMENT_ORG_SETTINGS.FA),
    전략기획: normalizeDepartmentOrg(raw?.전략기획, DEFAULT_DEPARTMENT_ORG_SETTINGS.전략기획),
    기타: normalizeDepartmentOrg(raw?.기타, DEFAULT_DEPARTMENT_ORG_SETTINGS.기타),
  }
}

function getDepartmentPersonSettingsFromOrgSettings(settings: DepartmentOrgSettings): DepartmentPersonSettings {
  return {
    ICT: getDepartmentOrgPersonNamesFromOrg(settings.ICT),
    FA: getDepartmentOrgPersonNamesFromOrg(settings.FA),
    전략기획: getDepartmentOrgPersonNamesFromOrg(settings.전략기획),
    기타: getDepartmentOrgPersonNamesFromOrg(settings.기타),
  }
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

export function resolveDepartmentPersonGroup(department: string): DepartmentPersonGroup {
  const normalized = department.trim()
  if (normalized === "ICT") return "ICT"
  if (normalized === "FA") return "FA"
  if (normalized === "전략기획" || normalized === "전략") return "전략기획"
  return "기타"
}

function normalizeIsoDate(value: unknown): string {
  if (typeof value !== "string") return ""
  const text = value.trim()
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return ""
  return `${matched[1]}-${matched[2]}-${matched[3]}`
}

function normalizeGlobalScheduleType(value: unknown): GlobalScheduleType {
  const text = toStringOrEmpty(value)
  return text === "annual_leave" ? "annual_leave" : "holiday"
}

function normalizeGlobalSchedule(raw: unknown, index: number): GlobalSchedule | null {
  if (!raw || typeof raw !== "object") return null
  const candidate = raw as Record<string, unknown>
  const startDate = normalizeIsoDate(candidate.startDate)
  const endDate = normalizeIsoDate(candidate.endDate)
  if (!startDate || !endDate) return null
  const title = toStringOrEmpty(candidate.title) || (normalizeGlobalScheduleType(candidate.type) === "holiday" ? "공휴일" : "전체 연차")
  const id = toStringOrEmpty(candidate.id) || `schedule-${index + 1}`
  const createdAtRaw = candidate.createdAt as { toDate?: () => Date } | undefined
  const updatedAtRaw = candidate.updatedAt as { toDate?: () => Date } | undefined
  return {
    id,
    title,
    type: normalizeGlobalScheduleType(candidate.type),
    startDate,
    endDate,
    createdAt: createdAtRaw?.toDate?.() || undefined,
    updatedAt: updatedAtRaw?.toDate?.() || undefined,
  }
}

function normalizeGlobalSchedules(raw: unknown): GlobalSchedule[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const normalized = raw
    .map((item, index) => normalizeGlobalSchedule(item, index))
    .filter((item): item is GlobalSchedule => Boolean(item))
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate)
      if (a.endDate !== b.endDate) return a.endDate.localeCompare(b.endDate)
      return a.title.localeCompare(b.title, "ko")
    })
  return normalized
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

// snapshot listeners fire frequently — without caching we'd re-read every
// referenced project/parent-task on every task change. TTL is short enough that
// edits made on this client appear via the live task snapshot anyway.
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

    // Surface parents reached via cache hits so the chain keeps walking up.
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

  const unsubscribes = chunks.map((chunk, index) => {
    const constraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    if (!includeHidden) constraints.push(where("isHidden", "==", false))
    return onSnapshot(
      query(collection(db, TASKS_COLLECTION), ...constraints),
      (snapshot) => {
        taskGroups.set(index, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
        void notify().catch((error) => {
          console.error("Scoped strategy data snapshot error:", error)
          if (!disposed) callback([])
        })
      },
      (error) => {
        console.error("Scoped strategy tasks snapshot error:", error)
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
        console.error("Schedule PM strategy data snapshot error:", error)
        if (!disposed) callback([])
      })
      return
    }

    pmTaskUnsubscribes = chunks.map((chunk, index) => {
      const constraints: any[] = [where("projectId", "in", chunk)]
      if (!includeHidden) constraints.push(where("isHidden", "==", false))
      return onSnapshot(
        query(collection(db, TASKS_COLLECTION), ...constraints),
        (snapshot) => {
          taskGroups.set(`pm:${index}`, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
          void notify().catch((error) => {
            console.error("Schedule PM strategy data snapshot error:", error)
            if (!disposed) callback([])
          })
        },
        (error) => {
          console.error("Schedule PM strategy tasks snapshot error:", error)
        },
      )
    })
  }

  const unsubscribes: Array<() => void> = []

  chunkValues(queryKeys, 30).forEach((chunk, index) => {
    const constraints: any[] = [where("personKeys", "array-contains-any", chunk)]
    if (!includeHidden) constraints.push(where("isHidden", "==", false))
    unsubscribes.push(
      onSnapshot(
        query(collection(db, TASKS_COLLECTION), ...constraints),
        (snapshot) => {
          taskGroups.set(`person:${index}`, snapshot.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id })))
          void notify().catch((error) => {
            console.error("Schedule assignee strategy data snapshot error:", error)
            if (!disposed) callback([])
          })
        },
        (error) => {
          console.error("Schedule assignee strategy tasks snapshot error:", error)
        },
      ),
    )
  })

  if (normalizedCreatorEmail) {
    unsubscribes.push(
      onSnapshot(
        query(collection(db, TASKS_COLLECTION), where("createdByEmail", "==", normalizedCreatorEmail)),
        (snapshot) => {
          taskGroups.set(
            "creator",
            snapshot.docs
              .map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
              .filter((task: any) => includeHidden || !toBooleanOr(task.isHidden, false)),
          )
          void notify().catch((error) => {
            console.error("Schedule creator strategy data snapshot error:", error)
            if (!disposed) callback([])
          })
        },
        (error) => {
          console.error("Schedule creator strategy tasks snapshot error:", error)
        },
      ),
    )
  }

  if (normalizedPmEmail) {
    const projectConstraints: any[] = [where("pmEmail", "==", normalizedPmEmail)]
    if (!includeHidden) projectConstraints.push(where("isHidden", "==", false))
    unsubscribes.push(
      onSnapshot(
        query(collection(db, PROJECTS_COLLECTION), ...projectConstraints),
        (snapshot) => {
          pmProjectsById.clear()
          snapshot.docs.forEach((docSnap) => {
            pmProjectsById.set(docSnap.id, { ...docSnap.data(), id: docSnap.id })
          })
          resetPmTaskSubscriptions(snapshot.docs.map((docSnap) => docSnap.id))
        },
        (error) => {
          console.error("Schedule PM strategy projects snapshot error:", error)
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
      const profile = snapshot.data() as { ganttCollapseState?: Partial<Record<keyof GanttCollapseState, unknown>> } | undefined
      const raw = profile?.[GANTT_COLLAPSE_STATE_FIELD]
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
      [GANTT_COLLAPSE_STATE_FIELD]: normalizeGanttCollapseState(state),
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
      const profile = snapshot.data() as { ganttLeftPanelWidth?: unknown } | undefined
      const raw = profile?.[GANTT_LEFT_PANEL_WIDTH_FIELD]
      const width = toNumberOr(raw, DEFAULT_GANTT_LEFT_PANEL_WIDTH)
      callback(width > 0 ? width : null)
    },
    (error) => {
      console.error("Gantt left panel width snapshot error:", error)
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
      [GANTT_LEFT_PANEL_WIDTH_FIELD]: normalizedWidth,
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
      const profile = snapshot.data() as { ganttDetailPanelWidth?: unknown } | undefined
      const raw = profile?.[GANTT_DETAIL_PANEL_WIDTH_FIELD]
      const width = toNumberOr(raw, DEFAULT_GANTT_DETAIL_PANEL_WIDTH)
      callback(width > 0 ? width : null)
    },
    (error) => {
      console.error("Gantt detail panel width snapshot error:", error)
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
      [GANTT_DETAIL_PANEL_WIDTH_FIELD]: normalizedWidth,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export function subscribeDepartmentPersonSettings(callback: (settings: DepartmentPersonSettings) => void) {
  const settingsRef = doc(db, SETTINGS_COLLECTION, DEPARTMENT_PERSON_SETTINGS_DOC)
  return onSnapshot(
    settingsRef,
    (snapshot) => {
      const raw = snapshot.data() as Partial<Record<DepartmentPersonGroup, unknown>> | undefined
      callback(normalizeDepartmentPersonSettings(raw))
    },
    (error) => {
      console.error("Department person settings snapshot error:", error)
      callback({ ...DEFAULT_DEPARTMENT_PERSON_SETTINGS })
    },
  )
}

export async function saveDepartmentPersonSettings(settings: DepartmentPersonSettings): Promise<void> {
  const settingsRef = doc(db, SETTINGS_COLLECTION, DEPARTMENT_PERSON_SETTINGS_DOC)
  await setDoc(
    settingsRef,
    {
      ...normalizeDepartmentPersonSettings(settings),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export function subscribeDepartmentOrgSettings(callback: (settings: DepartmentOrgSettings) => void) {
  const settingsRef = doc(db, SETTINGS_COLLECTION, DEPARTMENT_ORG_SETTINGS_DOC)
  return onSnapshot(
    settingsRef,
    (snapshot) => {
      const raw = snapshot.data() as Partial<Record<DepartmentPersonGroup, unknown>> | undefined
      callback(normalizeDepartmentOrgSettings(raw))
    },
    (error) => {
      console.error("Department org settings snapshot error:", error)
      callback(normalizeDepartmentOrgSettings())
    },
  )
}

export async function saveDepartmentOrgSettings(settings: DepartmentOrgSettings): Promise<DepartmentPersonSettings> {
  const normalized = normalizeDepartmentOrgSettings(settings)
  const orgRef = doc(db, SETTINGS_COLLECTION, DEPARTMENT_ORG_SETTINGS_DOC)
  const personSettings = getDepartmentPersonSettingsFromOrgSettings(normalized)

  await Promise.all([
    setDoc(
      orgRef,
      {
        ...(removeUndefinedValues(normalized) as DepartmentOrgSettings),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
    saveDepartmentPersonSettings(personSettings),
  ])

  return personSettings
}

export function subscribeMyPageEditableFields(callback: (fields: MyPageEditableFieldsSettings) => void) {
  const settingsRef = doc(db, SETTINGS_COLLECTION, MY_PAGE_EDITABLE_FIELDS_DOC)
  return onSnapshot(
    settingsRef,
    (snapshot) => {
      const raw = snapshot.data() as { fields?: unknown } | undefined
      if (!raw || !Array.isArray(raw.fields)) {
        callback([...DEFAULT_MY_PAGE_EDITABLE_FIELDS])
        return
      }
      callback(normalizeMyPageEditableFields(raw.fields))
    },
    (error) => {
      console.error("My-page editable fields snapshot error:", error)
      callback([...DEFAULT_MY_PAGE_EDITABLE_FIELDS])
    },
  )
}

export async function saveMyPageEditableFields(fields: MyPageEditableFieldsSettings): Promise<void> {
  const settingsRef = doc(db, SETTINGS_COLLECTION, MY_PAGE_EDITABLE_FIELDS_DOC)
  await setDoc(
    settingsRef,
    {
      fields: normalizeMyPageEditableFields(fields),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export function subscribeGlobalSchedules(callback: (schedules: GlobalSchedule[]) => void) {
  const schedulesRef = doc(db, SETTINGS_COLLECTION, GLOBAL_SCHEDULES_DOC)
  return onSnapshot(
    schedulesRef,
    (snapshot) => {
      const raw = snapshot.data() as { items?: unknown } | undefined
      callback(normalizeGlobalSchedules(raw?.items))
    },
    (error) => {
      console.error("Global schedules snapshot error:", error)
      callback([])
    },
  )
}

export async function saveGlobalSchedules(schedules: GlobalSchedule[]): Promise<void> {
  const schedulesRef = doc(db, SETTINGS_COLLECTION, GLOBAL_SCHEDULES_DOC)
  const normalized = normalizeGlobalSchedules(schedules).map((item) => ({
    id: item.id,
    title: item.title,
    type: item.type,
    startDate: item.startDate,
    endDate: item.endDate,
  }))

  await setDoc(
    schedulesRef,
    {
      items: normalized,
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

function mapUserProfileDoc(docSnap: { data: () => any }): UserProfile | null {
  const raw = docSnap.data() as {
    email?: unknown
    lastLoginAt?: { toDate?: () => Date }
    department?: unknown
    taskAliases?: unknown
    hiddenOwnerOptions?: unknown
    myPageTaskPreferences?: unknown
    myPagePersonalTasks?: unknown
    myPageMemo?: unknown
    myPageCollapsedProjectGroups?: unknown
    seenRecentChangeIds?: unknown
    mbti?: unknown
  }
  const profile = {
    email: normalizeEmail(toStringOrEmpty(raw?.email)),
    lastLoginAt: raw?.lastLoginAt?.toDate?.() || undefined,
    department: normalizeDepartmentGroup(raw?.department),
    taskAliases: Array.isArray(raw?.taskAliases)
      ? raw.taskAliases.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
      : [],
    hiddenOwnerOptions: Array.isArray(raw?.hiddenOwnerOptions)
      ? raw.hiddenOwnerOptions
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
    myPageTaskPreferences: normalizeMyPageTaskPreferences(raw?.myPageTaskPreferences),
    myPagePersonalTasks: normalizeMyPagePersonalTasks(raw?.myPagePersonalTasks),
    myPageMemo: toOptionalString(raw?.myPageMemo),
    myPageCollapsedProjectGroups:
      raw?.myPageCollapsedProjectGroups && typeof raw.myPageCollapsedProjectGroups === "object"
        ? Object.fromEntries(
            Object.entries(raw.myPageCollapsedProjectGroups as Record<string, unknown>).map(([key, value]) => [
              key,
              toBooleanOr(value, false),
            ]),
          )
        : {},
    seenRecentChangeIds: Array.isArray(raw?.seenRecentChangeIds)
      ? uniqueTrimmedStrings(raw.seenRecentChangeIds.filter((value): value is string => typeof value === "string"))
      : [],
    mbti: (MBTI_TYPES as readonly string[]).includes(raw?.mbti as string) ? (raw.mbti as MbtiType) : undefined,
  } satisfies UserProfile

  return profile.email ? profile : null
}

export async function fetchUserProfiles(): Promise<UserProfile[]> {
  const snapshot = await getDocs(collection(db, USER_PROFILES_COLLECTION))
  return snapshot.docs
    .map(mapUserProfileDoc)
    .filter((profile): profile is UserProfile => Boolean(profile))
    .sort((a, b) => a.email.localeCompare(b.email))
}

export function subscribeUserProfiles(callback: (profiles: UserProfile[]) => void) {
  return onSnapshot(
    collection(db, USER_PROFILES_COLLECTION),
    (snapshot) => {
      const profiles = snapshot.docs
        .map(mapUserProfileDoc)
        .filter((profile): profile is UserProfile => Boolean(profile))
        .sort((a, b) => a.email.localeCompare(b.email))

      callback(profiles)
    },
    (error) => {
      console.error("User profiles snapshot error:", error)
    },
  )
}

export function subscribeCurrentUserProfile(email: string, callback: (profile: UserProfile | null) => void) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    callback(null)
    return () => {}
  }

  return onSnapshot(
    doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail)),
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null)
        return
      }

      const raw = snapshot.data() as {
        email?: unknown
        lastLoginAt?: { toDate?: () => Date }
        department?: unknown
        taskAliases?: unknown
        hiddenOwnerOptions?: unknown
        myPageTaskPreferences?: unknown
        myPagePersonalTasks?: unknown
        myPageMemo?: unknown
        myPageCollapsedProjectGroups?: unknown
        seenRecentChangeIds?: unknown
      }
      callback({
        email: normalizeEmail(toStringOrEmpty(raw?.email)),
        lastLoginAt: raw?.lastLoginAt?.toDate?.() || undefined,
        department: normalizeDepartmentGroup(raw?.department),
        taskAliases: Array.isArray(raw?.taskAliases)
          ? raw.taskAliases.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
          : [],
        hiddenOwnerOptions: Array.isArray(raw?.hiddenOwnerOptions)
          ? raw.hiddenOwnerOptions
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
        myPageTaskPreferences: normalizeMyPageTaskPreferences(raw?.myPageTaskPreferences),
        myPagePersonalTasks: normalizeMyPagePersonalTasks(raw?.myPagePersonalTasks),
        myPageMemo: toOptionalString(raw?.myPageMemo),
        myPageCollapsedProjectGroups:
          raw?.myPageCollapsedProjectGroups && typeof raw.myPageCollapsedProjectGroups === "object"
            ? Object.fromEntries(
                Object.entries(raw.myPageCollapsedProjectGroups as Record<string, unknown>).map(([key, value]) => [
                  key,
                  toBooleanOr(value, false),
                ]),
              )
            : {},
        seenRecentChangeIds: Array.isArray(raw?.seenRecentChangeIds)
          ? uniqueTrimmedStrings(raw.seenRecentChangeIds.filter((value): value is string => typeof value === "string"))
          : [],
      })
    },
    (error) => {
      console.error("Current user profile snapshot error:", error)
    },
  )
}

export async function saveUserTaskAliases(email: string, taskAliases: string[]): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  await setDoc(
    doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail)),
    {
      email: normalizedEmail,
      taskAliases: Array.from(new Set(taskAliases.map((alias) => alias.trim()).filter(Boolean))),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function saveUserHiddenOwnerOptions(email: string, hiddenOwnerOptions: string[]): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  await setDoc(
    doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail)),
    {
      email: normalizedEmail,
      hiddenOwnerOptions: Array.from(new Set(hiddenOwnerOptions.map((owner) => owner.trim()).filter(Boolean))),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function saveUserDepartment(email: string, department?: DepartmentPersonGroup): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  await setDoc(
    doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail)),
    {
      email: normalizedEmail,
      department: department || null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function saveUserMbti(email: string, mbti?: MbtiType): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  await setDoc(
    doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail)),
    {
      email: normalizedEmail,
      mbti: mbti || null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function saveMyPageTaskPreferences(
  email: string,
  myPageTaskPreferences: Record<string, MyPageTaskPreference>,
): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  await setDoc(
    doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail)),
    {
      email: normalizedEmail,
      myPageTaskPreferences,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function saveMyPagePersonalTasks(email: string, tasks: MyPagePersonalTask[]): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  const sanitized = tasks.map((task, index) => {
    const priority = task.priority === "high" || task.priority === "medium" || task.priority === "low" ? task.priority : "medium"
    return compactObject({
      id: toStringOrEmpty(task.id) || `personal-${Date.now()}-${index}`,
      title: toStringOrEmpty(task.title),
      memo: toOptionalString(task.memo),
      startDate: toOptionalString(task.startDate),
      endDate: toOptionalString(task.endDate),
      checked: Boolean(task.checked),
      priority,
      important: Boolean(task.important),
      order: toNumberOr(task.order, index),
      createdAt: toNumberOr(task.createdAt, Date.now()),
      updatedAt: toNumberOr(task.updatedAt, Date.now()),
    }) satisfies MyPagePersonalTask
  })

  await setDoc(
    doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail)),
    {
      email: normalizedEmail,
      myPagePersonalTasks: sanitized,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function saveMyPageMemo(email: string, memo: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  await setDoc(
    doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail)),
    {
      email: normalizedEmail,
      myPageMemo: toStringOrEmpty(memo),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function saveMyPageCollapsedProjectGroups(
  email: string,
  groups: Record<string, boolean>,
): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  await setDoc(
    doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail)),
    {
      email: normalizedEmail,
      myPageCollapsedProjectGroups: groups,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function saveSeenRecentChangeIds(email: string, ids: string[]): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  await setDoc(
    doc(db, USER_PROFILES_COLLECTION, permissionDocId(normalizedEmail)),
    {
      email: normalizedEmail,
      seenRecentChangeIds: uniqueTrimmedStrings(ids).slice(-300),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
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
            strategyWorkManagement?: unknown
            workManagement?: unknown
            faWorkManagement?: unknown
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
