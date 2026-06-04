import type { Project, Task } from "./data"
import {
  isUserOwnerOfTask,
  resolveDepartmentPersonGroup,
  type DepartmentOrgSettings,
  type DepartmentPersonGroup,
  type UserProfile,
} from "./firestore-service"
import { isActiveDepartmentOrgMember } from "./department-org"

export type RecentChangeVisibilityEntry = {
  id: string
  entityType: string
  action: string
  actorEmail?: string
  entityId?: string
  projectId?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  batch?: Array<{
    entityType: string
    entityId: string
    before?: Record<string, unknown>
    after?: Record<string, unknown>
  }>
}

type NotificationScope = {
  projects: Project[]
  userAliases: string[]
  ledDepartmentGroups: Set<DepartmentPersonGroup>
  canViewAll: boolean
}

const normalizeText = (value: string) => value.trim().toLowerCase()

const uniqueTrimmed = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))

export function getUserAliasesForChangeNotifications(
  profiles: UserProfile[],
  email?: string,
  fallbackAliases: string[] = [],
): string[] {
  const normalizedEmail = normalizeText(email || "")
  const profile = normalizedEmail
    ? profiles.find((item) => normalizeText(item.email) === normalizedEmail)
    : undefined

  return uniqueTrimmed([...(profile?.taskAliases || []), ...fallbackAliases])
}

function aliasMatchesName(name: string | undefined, aliases: string[]) {
  const normalizedName = normalizeText(name || "")
  if (!normalizedName) return false

  return aliases.some((rawAlias) => {
    const alias = normalizeText(rawAlias)
    if (!alias) return false
    return normalizedName === alias || normalizedName.includes(alias) || alias.includes(normalizedName)
  })
}

export function getLedDepartmentGroupsForAliases(
  aliases: string[],
  departmentOrgSettings: DepartmentOrgSettings,
): Set<DepartmentPersonGroup> {
  const groups = new Set<DepartmentPersonGroup>()

  ;(Object.keys(departmentOrgSettings) as DepartmentPersonGroup[]).forEach((group) => {
    const leader = departmentOrgSettings[group]?.leader
    if (isActiveDepartmentOrgMember(leader) && aliasMatchesName(leader?.name, aliases)) groups.add(group)
  })

  return groups
}

export function hasChangeNotificationScope(
  aliases: string[],
  ledDepartmentGroups: Set<DepartmentPersonGroup>,
) {
  return aliases.length > 0 || ledDepartmentGroups.size > 0
}

function flattenTasks(tasks: Task[]): Task[] {
  return tasks.flatMap((task) => [task, ...flattenTasks(task.subTasks || [])])
}

function findTaskById(projects: Project[], taskId?: string): Task | undefined {
  if (!taskId) return undefined
  for (const project of projects) {
    const found = flattenTasks(project.tasks).find((task) => task.id === taskId)
    if (found) return found
  }
  return undefined
}

function taskSnapshotFromRecord(record?: Record<string, unknown>): Pick<Task, "person" | "department"> | null {
  if (!record) return null
  const person = typeof record.person === "string" ? record.person : ""
  const department = typeof record.department === "string" ? record.department : ""
  if (!person && !department) return null
  return { person, department }
}

function getTaskSnapshots(
  entry: Pick<RecentChangeVisibilityEntry, "entityId" | "before" | "after">,
  projects: Project[],
): Array<Pick<Task, "person" | "department">> {
  return [
    findTaskById(projects, entry.entityId),
    taskSnapshotFromRecord(entry.after),
    taskSnapshotFromRecord(entry.before),
  ].filter((task): task is Pick<Task, "person" | "department"> => Boolean(task))
}

function taskMatchesScope(
  task: Pick<Task, "person" | "department">,
  userAliases: string[],
  ledDepartmentGroups: Set<DepartmentPersonGroup>,
) {
  if (userAliases.length > 0 && isUserOwnerOfTask(task, userAliases)) return true
  if (ledDepartmentGroups.size === 0) return false
  return ledDepartmentGroups.has(resolveDepartmentPersonGroup(task.department || ""))
}

export function isTaskChangeNotificationEntry(entry: RecentChangeVisibilityEntry) {
  return (
    entry.entityType === "task" &&
    (entry.action === "update" || entry.action === "create" || entry.action === "delete")
  )
}

export function canSeeRecentChangeEntry(
  entry: RecentChangeVisibilityEntry,
  scope: NotificationScope,
) {
  if (scope.canViewAll) return true

  if (isTaskChangeNotificationEntry(entry)) {
    return getTaskSnapshots(entry, scope.projects).some((task) =>
      taskMatchesScope(task, scope.userAliases, scope.ledDepartmentGroups),
    )
  }

  if (entry.entityType === "batch") {
    return (entry.batch || []).some((item) => {
      if (item.entityType !== "task") return false
      return getTaskSnapshots(item, scope.projects).some((task) =>
        taskMatchesScope(task, scope.userAliases, scope.ledDepartmentGroups),
      )
    })
  }

  return false
}

export function filterRecentChangeEntriesForNotifications<T extends RecentChangeVisibilityEntry>(
  entries: T[],
  scope: NotificationScope,
): T[] {
  if (scope.canViewAll) return entries
  return entries.filter((entry) => canSeeRecentChangeEntry(entry, scope))
}
