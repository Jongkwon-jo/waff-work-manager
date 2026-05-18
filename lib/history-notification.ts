type HistoryNotificationBatchItem = {
  entityType: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

type HistoryNotificationInput = {
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  batch?: HistoryNotificationBatchItem[]
}

type DepartmentPersonGroup = "ICT" | "FA" | "전략기획" | "기타"

export type HistoryNotificationFilter = {
  personKeys?: string[]
  departmentGroups?: string[]
}

const normalizeKey = (value: string) => value.trim().toLowerCase()

const unique = (values: string[]) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))

export function buildPersonKeys(values: string[]) {
  return unique(
    values.flatMap((value) => {
      const normalized = normalizeKey(value)
      if (!normalized) return []
      return [normalized, ...normalized.split(/\s+/).filter(Boolean)]
    }),
  )
}

function splitPeople(value: unknown) {
  if (typeof value !== "string") return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function resolveDepartmentGroup(value: unknown): DepartmentPersonGroup | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  if (normalized === "ICT") return "ICT"
  if (normalized === "FA") return "FA"
  if (normalized === "전략기획" || normalized === "전략") return "전략기획"
  if (normalized) return "기타"
  return null
}

function collectFromRecord(record: Record<string, unknown> | undefined, people: string[], departments: string[]) {
  if (!record) return
  people.push(...splitPeople(record.person))
  const department = resolveDepartmentGroup(record.department)
  if (department) departments.push(department)
}

export function buildHistoryNotificationFields(entry: HistoryNotificationInput) {
  const people: string[] = []
  const departments: string[] = []

  collectFromRecord(entry.before, people, departments)
  collectFromRecord(entry.after, people, departments)
  ;(entry.batch || []).forEach((item) => {
    if (item.entityType !== "task") return
    collectFromRecord(item.before, people, departments)
    collectFromRecord(item.after, people, departments)
  })

  return {
    notificationPersonKeys: buildPersonKeys(people),
    notificationDepartmentGroups: unique(departments),
  }
}
