"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { signOut } from "firebase/auth"
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GripVertical,
  Home,
  LogOut,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Star,
  User,
  X,
} from "lucide-react"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/components/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { CategoryBadge, ProjectTypeBadge, StatusBadge } from "@/components/status-badge"
import { EditTaskDialog } from "@/components/edit-task-dialog"
import { toast } from "sonner"
import {
  addHistoryEntry as addStrategyHistoryEntry,
  DEFAULT_MY_PAGE_EDITABLE_FIELDS,
  fetchMyPageEditableFields,
  isUserOwnerOfTask,
  saveMyPageMemo,
  saveMyPagePersonalTasks,
  saveMyPageTaskPreferences,
  subscribeCurrentUserProfile,
  subscribeProjectsWithTasksByPersonKeys as subscribeStrategyProjectsByPersonKeys,
  updateTaskInDB as updateStrategyTaskInDB,
  type MyPageEditableFieldsSettings,
  type MyPagePersonalTask,
  type MyPageTaskPreference,
} from "@/lib/firestore-service"
import {
  addHistoryEntry as addFaHistoryEntry,
  subscribeProjectsWithTasksByPersonKeys as subscribeFaProjectsByPersonKeys,
  updateTaskInDB as updateFaTaskInDB,
} from "@/lib/firestore-service-fa"
import {
  addHistoryEntry as addIctHistoryEntry,
  subscribeProjectsWithTasksByPersonKeys as subscribeIctProjectsByPersonKeys,
  updateTaskInDB as updateIctTaskInDB,
} from "@/lib/firestore-service-ict"
import { calculateManDaysBetweenDates } from "@/lib/man-days"
import type { Project, Task, TaskStatus } from "@/lib/data"
import { cn, keepIfShallowEqual } from "@/lib/utils"

type ProjectSource = "strategy" | "fa" | "ict"
type CalendarSource = ProjectSource | "personal"
type DepartmentPage = "전략사업부" | "FA 사업부" | "ICT 사업부"
type ProjectDateRange = { startDate: string; endDate: string }
type CalendarDragAction = "move" | "resize-start" | "resize-end"

type ProjectTaskItem = {
  key: string
  source: ProjectSource
  departmentPage: DepartmentPage
  projectName: string
  projectType: string
  task: Task
  depth: number
  ancestorNames: string[]
}

type CalendarDay = {
  date: Date
  key: string
  dayNumber: string
  isCurrentMonth: boolean
  isToday: boolean
  isWeekend: boolean
}

type PersonalCalendarItem = {
  id: string
  kind: "personal"
  source: "personal"
  title: string
  start: Date
  end: Date
  personalTask: MyPagePersonalTask
}

type ProjectCalendarItem = {
  id: string
  kind: "project"
  source: ProjectSource
  title: string
  start: Date
  end: Date
  projectTask: ProjectTaskItem
}

type CalendarItem = PersonalCalendarItem | ProjectCalendarItem

type CalendarWeekSegment = {
  item: CalendarItem
  startOffset: number
  span: number
  lane: number
}

type CalendarDragPayload = {
  itemId: string
  action: CalendarDragAction
}
type CalendarBadgeKey = "project" | "category" | "status"

const CALENDAR_DND_MIME = "application/x-workhub-calendar-item"
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]
const PROJECT_STATUS_FILTERS: TaskStatus[] = ["진행", "예정", "취소", "미정", "완료"]
const CALENDAR_BADGE_OPTIONS: Array<{ key: CalendarBadgeKey; label: string }> = [
  { key: "project", label: "프로젝트" },
  { key: "category", label: "업무 분류" },
  { key: "status", label: "진행상황" },
]

const DEFAULT_TASK_PREFERENCE: MyPageTaskPreference = {
  checked: false,
  priority: "medium",
  important: false,
  order: Number.MAX_SAFE_INTEGER,
}

const sourceMeta: Record<
  CalendarSource,
  {
    label: string
    chipClass: string
    barClass: string
    dotClass: string
  }
> = {
  personal: {
    label: "개인",
    chipClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    barClass: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    dotClass: "bg-emerald-500",
  },
  strategy: {
    label: "전략",
    chipClass: "border-amber-200 bg-amber-50 text-amber-700",
    barClass: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
    dotClass: "bg-amber-500",
  },
  fa: {
    label: "FA",
    chipClass: "border-violet-200 bg-violet-50 text-violet-700",
    barClass: "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100",
    dotClass: "bg-violet-500",
  },
  ict: {
    label: "ICT",
    chipClass: "border-sky-200 bg-sky-50 text-sky-700",
    barClass: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100",
    dotClass: "bg-sky-500",
  },
}

const priorityMeta: Record<MyPageTaskPreference["priority"], { label: string; className: string; rank: number }> = {
  high: { label: "높음", className: "bg-rose-100 text-rose-700", rank: 0 },
  medium: { label: "보통", className: "bg-amber-100 text-amber-700", rank: 1 },
  low: { label: "낮음", className: "bg-slate-700 text-white", rank: 2 },
}

const statusFilterMeta: Record<TaskStatus, string> = {
  진행: "border-blue-500 bg-blue-500 text-white",
  예정: "border-slate-500 bg-slate-500 text-white",
  취소: "border-yellow-500 bg-yellow-500 text-white",
  미정: "border-rose-500 bg-rose-500 text-white",
  완료: "border-slate-800 bg-slate-800 text-white",
}

const serializeTaskForHistory = (task: Task) => {
  const payload: Record<string, unknown> = {
    projectId: task.projectId,
    task: task.task,
    category: task.category,
    department: task.department,
    person: task.person,
    personKeys: task.personKeys,
    startDate: task.startDate,
    endDate: task.endDate,
    status: task.status,
    manDays: task.manDays,
  }
  if (task.parentId) payload.parentId = task.parentId
  if (task.memo !== undefined) payload.memo = task.memo
  if (task.isSubTask !== undefined) payload.isSubTask = task.isSubTask
  if (task.isHidden !== undefined) payload.isHidden = task.isHidden
  if (task.depth !== undefined) payload.depth = task.depth
  if (task.displayOrder !== undefined) payload.displayOrder = task.displayOrder
  if (task.completionPhoto !== undefined) payload.completionPhoto = task.completionPhoto
  return payload
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number) {
  const next = startOfDay(date)
  next.setDate(next.getDate() + days)
  return next
}

function daysBetween(start: Date, end: Date) {
  const startTime = startOfDay(start).getTime()
  const endTime = startOfDay(end).getTime()
  return Math.max(0, Math.round((endTime - startTime) / 86_400_000))
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function toDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatDateInputValue(date: Date) {
  return toDayKey(date)
}

function parseDateInputValue(value: string) {
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return undefined
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
}

function formatTaskDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${month}월 ${day}일`
}

function formatDateWithYear(date?: Date) {
  if (!date) return "-"
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}.${month}.${day}`
}

function parseTaskDate(value?: string, referenceDate = new Date()) {
  const normalized = (value || "").trim()
  if (!normalized) return undefined

  const isoMatched = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatched) {
    return new Date(Number(isoMatched[1]), Number(isoMatched[2]) - 1, Number(isoMatched[3]))
  }

  const koreanWithYear = normalized.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (koreanWithYear) {
    return new Date(Number(koreanWithYear[1]), Number(koreanWithYear[2]) - 1, Number(koreanWithYear[3]))
  }

  const matched = normalized.match(/(\d{1,2})\D+(\d{1,2})/)
  if (!matched) return undefined
  return new Date(referenceDate.getFullYear(), Number(matched[1]) - 1, Number(matched[2]))
}

function normalizeDateRange(start?: Date, end?: Date) {
  const from = start || end
  const to = end || start
  if (!from || !to) return undefined
  return from <= to ? { start: from, end: to } : { start: to, end: from }
}

function buildCalendarWeeks(viewMonth: Date): CalendarDay[][] {
  const today = startOfDay(new Date())
  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
  const monthEnd = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0)
  const mondayOffset = (monthStart.getDay() + 6) % 7
  const cursor = addDays(monthStart, -mondayOffset)
  const weeks: CalendarDay[][] = []

  while (cursor <= monthEnd || weeks.length < 5) {
    const week: CalendarDay[] = []
    for (let i = 0; i < 7; i += 1) {
      const date = startOfDay(cursor)
      week.push({
        date,
        key: toDayKey(date),
        dayNumber: String(date.getDate()),
        isCurrentMonth: date.getMonth() === viewMonth.getMonth(),
        isToday: isSameDay(date, today),
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }

  return weeks
}

function buildProjectDateRange(weeks: CalendarDay[][]): ProjectDateRange {
  const first = weeks[0]?.[0]?.date || new Date()
  const lastWeek = weeks[weeks.length - 1] || weeks[0] || []
  const last = lastWeek[lastWeek.length - 1]?.date || first
  return {
    startDate: formatTaskDateKey(first),
    endDate: formatTaskDateKey(last),
  }
}

function buildAliasCandidates(email?: string | null, displayName?: string | null) {
  const normalizedEmail = (email || "").trim().toLowerCase()
  const localPart = normalizedEmail.split("@")[0] || ""
  return Array.from(
    new Set(
      [
        normalizedEmail,
        localPart,
        localPart.replaceAll(".", " "),
        displayName?.trim() || "",
      ].filter(Boolean),
    ),
  )
}

function hasAliasMatch(person: string, aliases: string[]) {
  const normalizedPerson = person.trim().toLowerCase()
  const tokens = person
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return aliases.some((alias) => {
    const normalizedAlias = alias.trim().toLowerCase()
    return normalizedPerson.includes(normalizedAlias) || tokens.includes(normalizedAlias)
  })
}

function collectProjectTaskItems(
  tasks: Task[],
  context: Pick<ProjectTaskItem, "source" | "departmentPage" | "projectName" | "projectType">,
  projectId: string,
  aliases: string[],
  ancestors: Task[] = [],
): ProjectTaskItem[] {
  return tasks.flatMap((task) => {
    const children = task.subTasks || []
    if (children.length > 0) {
      return collectProjectTaskItems(children, context, projectId, aliases, [...ancestors, task])
    }

    if (!hasAliasMatch(task.person || "", aliases)) return []

    return [
      {
        key: `${context.source}:${projectId}:${task.id}`,
        ...context,
        task,
        depth: ancestors.length,
        ancestorNames: ancestors.map((entry) => entry.task),
      },
    ]
  })
}

function getProjectTaskSortTime(item: ProjectTaskItem, referenceDate: Date) {
  return parseTaskDate(item.task.startDate, referenceDate)?.getTime() ?? Number.MAX_SAFE_INTEGER
}

function getCalendarItemStatus(item: CalendarItem): TaskStatus {
  if (item.kind === "personal") return item.personalTask.checked ? "완료" : "진행"
  return item.projectTask.task.status
}

function getCalendarItemSearchText(item: CalendarItem) {
  if (item.kind === "personal") {
    return [item.title, item.personalTask.memo || "", "개인"].join(" ").toLowerCase()
  }
  const project = item.projectTask
  return [
    item.title,
    project.projectName,
    project.projectType,
    project.departmentPage,
    project.task.person,
    project.task.department,
    project.task.memo || "",
  ].join(" ").toLowerCase()
}

function getCalendarPropertyBadges(item: CalendarItem, enabledBadges: CalendarBadgeKey[]) {
  const enabled = new Set(enabledBadges)
  const badges: Array<{ key: CalendarBadgeKey; label: string }> = []

  if (enabled.has("project")) {
    badges.push({
      key: "project",
      label: item.kind === "project" ? item.projectTask.projectName : "개인 업무",
    })
  }

  if (enabled.has("category")) {
    badges.push({
      key: "category",
      label:
        item.kind === "project"
          ? item.projectTask.task.category
          : priorityMeta[item.personalTask.priority]?.label || "보통",
    })
  }

  if (enabled.has("status")) {
    badges.push({
      key: "status",
      label: getCalendarItemStatus(item),
    })
  }

  return badges
}

function getWeekSegments(items: CalendarItem[], week: CalendarDay[]): { segments: CalendarWeekSegment[]; laneCount: number } {
  const weekStart = week[0].date
  const weekEnd = week[6].date
  const rawSegments = items
    .filter((item) => item.start <= weekEnd && item.end >= weekStart)
    .map((item) => {
      const clampedStart = item.start < weekStart ? weekStart : item.start
      const clampedEnd = item.end > weekEnd ? weekEnd : item.end
      const startOffset = daysBetween(weekStart, clampedStart)
      const endOffset = daysBetween(weekStart, clampedEnd)
      return {
        item,
        startOffset,
        endOffset,
        span: endOffset - startOffset + 1,
      }
    })
    .sort((a, b) => {
      if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset
      if (b.span !== a.span) return b.span - a.span
      return a.item.title.localeCompare(b.item.title, "ko")
    })

  const laneEnds: number[] = []
  const segments = rawSegments.map((segment) => {
    let lane = laneEnds.findIndex((endOffset) => segment.startOffset > endOffset)
    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(segment.endOffset)
    } else {
      laneEnds[lane] = segment.endOffset
    }
    return {
      item: segment.item,
      startOffset: segment.startOffset,
      span: segment.span,
      lane,
    }
  })

  return { segments, laneCount: Math.max(1, laneEnds.length) }
}

function moveRangeToDate(item: CalendarItem | { start?: Date; end?: Date }, targetDate: Date) {
  const range = normalizeDateRange(item.start, item.end)
  const duration = range ? daysBetween(range.start, range.end) : 0
  return {
    start: startOfDay(targetDate),
    end: addDays(targetDate, duration),
  }
}

function resizeRangeToDate(
  item: CalendarItem | { start?: Date; end?: Date },
  targetDate: Date,
  action: Exclude<CalendarDragAction, "move">,
) {
  const range = normalizeDateRange(item.start, item.end)
  if (!range) return { start: startOfDay(targetDate), end: startOfDay(targetDate) }

  if (action === "resize-start") {
    return {
      start: targetDate <= range.end ? startOfDay(targetDate) : range.end,
      end: range.end,
    }
  }

  return {
    start: range.start,
    end: targetDate >= range.start ? startOfDay(targetDate) : range.start,
  }
}

export default function MyPageTest() {
  const { user, isAdmin } = useAuth()
  const [strategyProjects, setStrategyProjects] = useState<Project[]>([])
  const [faProjects, setFaProjects] = useState<Project[]>([])
  const [ictProjects, setIctProjects] = useState<Project[]>([])
  const [aliases, setAliases] = useState<string[]>([])
  const [taskPreferences, setTaskPreferences] = useState<Record<string, MyPageTaskPreference>>({})
  const [personalTasks, setPersonalTasks] = useState<MyPagePersonalTask[]>([])
  const [myMemo, setMyMemo] = useState("")
  const [isSavingMemo, setIsSavingMemo] = useState(false)
  const [editableFieldsConfig, setEditableFieldsConfig] = useState<MyPageEditableFieldsSettings>([
    ...DEFAULT_MY_PAGE_EDITABLE_FIELDS,
  ])
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedSources, setSelectedSources] = useState<CalendarSource[]>(["personal", "strategy", "fa", "ict"])
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | "all">("all")
  const [visibleBadgeKeys, setVisibleBadgeKeys] = useState<CalendarBadgeKey[]>(["project", "category", "status"])
  const [searchTerm, setSearchTerm] = useState("")
  const [dragPayload, setDragPayload] = useState<CalendarDragPayload | null>(null)
  const [dropDateKey, setDropDateKey] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [sidebarTitle, setSidebarTitle] = useState("")
  const [sidebarMemo, setSidebarMemo] = useState("")
  const [quickCreateDate, setQuickCreateDate] = useState<Date | null>(null)
  const [quickCreateTitle, setQuickCreateTitle] = useState("")
  const [quickCreateMemo, setQuickCreateMemo] = useState("")
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false)
  const [detailTitle, setDetailTitle] = useState("")
  const [detailMemo, setDetailMemo] = useState("")

  const calendarWeeks = useMemo(() => buildCalendarWeeks(viewMonth), [viewMonth])
  const projectDateRange = useMemo(() => buildProjectDateRange(calendarWeeks), [calendarWeeks])
  const viewMonthLabel = `${viewMonth.getFullYear()}년 ${viewMonth.getMonth() + 1}월`
  const effectiveEditableFields = isAdmin ? DEFAULT_MY_PAGE_EDITABLE_FIELDS : editableFieldsConfig
  const memoPreview = useMemo(() => myMemo.trim().replace(/\s+/g, " ") || "메모 없음", [myMemo])

  useEffect(() => {
    let disposed = false
    void fetchMyPageEditableFields()
      .then((fields) => {
        if (!disposed) setEditableFieldsConfig(fields)
      })
      .catch((error) => {
        console.error("My-page settings fetch failed:", error)
      })
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    if (!user?.email) return
    const unsubscribe = subscribeCurrentUserProfile(user.email, (profile) => {
      const nextAliases = profile?.taskAliases?.length
        ? profile.taskAliases
        : buildAliasCandidates(user.email, user.displayName)
      setAliases((prev) => keepIfShallowEqual(prev, nextAliases))
      setTaskPreferences(profile?.myPageTaskPreferences || {})
      setPersonalTasks((profile?.myPagePersonalTasks || []).slice().sort((a, b) => a.order - b.order))
      setMyMemo(profile?.myPageMemo || "")
    })
    return () => unsubscribe()
  }, [user])

  useEffect(() => {
    if (!user?.email || aliases.length === 0) {
      setStrategyProjects([])
      setFaProjects([])
      setIctProjects([])
      return
    }

    const options = { dateRange: projectDateRange }
    const unsubscribeStrategy = subscribeStrategyProjectsByPersonKeys(aliases, setStrategyProjects, options)
    const unsubscribeFa = subscribeFaProjectsByPersonKeys(aliases, setFaProjects, options)
    const unsubscribeIct = subscribeIctProjectsByPersonKeys(aliases, setIctProjects, options)

    return () => {
      unsubscribeStrategy()
      unsubscribeFa()
      unsubscribeIct()
    }
  }, [aliases, projectDateRange, user?.email])

  const projectTaskItems = useMemo(() => {
    const toItems = (
      projects: Project[],
      source: ProjectSource,
      departmentPage: DepartmentPage,
    ) =>
      projects.flatMap((project) =>
        collectProjectTaskItems(
          project.tasks,
          {
            source,
            departmentPage,
            projectName: project.name,
            projectType: project.type,
          },
          project.id,
          aliases,
        ),
      )

    const strategyItems = toItems(strategyProjects, "strategy", "전략사업부")
    const faItems = toItems(faProjects, "fa", "FA 사업부")
    const ictItems = toItems(
      ictProjects.filter((project) => project.sourceSchedule !== "strategy" && !project.id.startsWith("strategy:")),
      "ict",
      "ICT 사업부",
    ).filter((item) => item.task.sourceSchedule !== "strategy" && !item.task.id.startsWith("strategy:"))

    return [...strategyItems, ...faItems, ...ictItems]
      .filter((item) => !(taskPreferences[item.key] || DEFAULT_TASK_PREFERENCE).deleted)
      .sort((a, b) => {
        const byDate = getProjectTaskSortTime(a, viewMonth) - getProjectTaskSortTime(b, viewMonth)
        if (byDate !== 0) return byDate
        return a.task.task.localeCompare(b.task.task, "ko")
      })
  }, [aliases, faProjects, ictProjects, strategyProjects, taskPreferences, viewMonth])

  const calendarItems = useMemo<CalendarItem[]>(() => {
    const personalItems: CalendarItem[] = personalTasks.flatMap((task) => {
      const range = normalizeDateRange(
        parseTaskDate(task.startDate, viewMonth),
        parseTaskDate(task.endDate, viewMonth),
      )
      if (!range) return []
      return [
        {
          id: `personal:${task.id}`,
          kind: "personal",
          source: "personal",
          title: task.title,
          start: range.start,
          end: range.end,
          personalTask: task,
        },
      ]
    })

    const projectItems: CalendarItem[] = projectTaskItems.flatMap((item) => {
      const range = normalizeDateRange(
        parseTaskDate(item.task.startDate, viewMonth),
        parseTaskDate(item.task.endDate, viewMonth),
      )
      if (!range) return []
      return [
        {
          id: `project:${item.key}`,
          kind: "project",
          source: item.source,
          title: item.task.task,
          start: range.start,
          end: range.end,
          projectTask: item,
        },
      ]
    })

    return [...personalItems, ...projectItems].sort((a, b) => {
      const byStart = a.start.getTime() - b.start.getTime()
      if (byStart !== 0) return byStart
      const byDuration = daysBetween(b.start, b.end) - daysBetween(a.start, a.end)
      if (byDuration !== 0) return byDuration
      return a.title.localeCompare(b.title, "ko")
    })
  }, [personalTasks, projectTaskItems, viewMonth])

  const unscheduledPersonalTasks = useMemo(
    () =>
      personalTasks
        .filter((task) => !parseTaskDate(task.startDate, viewMonth) && !parseTaskDate(task.endDate, viewMonth))
        .sort((a, b) => {
          if (a.checked !== b.checked) return a.checked ? 1 : -1
          return a.order - b.order
        }),
    [personalTasks, viewMonth],
  )

  const visibleCalendarItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return calendarItems.filter((item) => {
      if (!selectedSources.includes(item.source)) return false
      if (selectedStatus !== "all" && getCalendarItemStatus(item) !== selectedStatus) return false
      if (query && !getCalendarItemSearchText(item).includes(query)) return false
      return true
    })
  }, [calendarItems, searchTerm, selectedSources, selectedStatus])

  const visibleUnscheduledPersonalTasks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!selectedSources.includes("personal")) return []
    return unscheduledPersonalTasks.filter((task) => {
      const status: TaskStatus = task.checked ? "완료" : "진행"
      if (selectedStatus !== "all" && status !== selectedStatus) return false
      if (query && ![task.title, task.memo || ""].join(" ").toLowerCase().includes(query)) return false
      return true
    })
  }, [searchTerm, selectedSources, selectedStatus, unscheduledPersonalTasks])

  const selectedCalendarItem = useMemo(
    () => calendarItems.find((item) => item.id === selectedItemId),
    [calendarItems, selectedItemId],
  )
  const selectedPersonalTask = useMemo(() => {
    if (selectedCalendarItem?.kind === "personal") return selectedCalendarItem.personalTask
    if (selectedItemId?.startsWith("personal:")) {
      const id = selectedItemId.slice("personal:".length)
      return personalTasks.find((task) => task.id === id)
    }
    return undefined
  }, [calendarItems, personalTasks, selectedCalendarItem, selectedItemId])
  const selectedProjectTask = selectedCalendarItem?.kind === "project" ? selectedCalendarItem.projectTask : undefined

  useEffect(() => {
    if (!selectedPersonalTask) return
    setDetailTitle(selectedPersonalTask.title)
    setDetailMemo(selectedPersonalTask.memo || "")
  }, [selectedPersonalTask?.id])

  const savePreferences = async (next: Record<string, MyPageTaskPreference>) => {
    setTaskPreferences(next)
    if (!user?.email) return
    try {
      await saveMyPageTaskPreferences(user.email, next)
    } catch {
      toast.error("프로젝트 업무 설정 저장에 실패했습니다.")
    }
  }

  const updateProjectPref = (taskKey: string, updates: Partial<MyPageTaskPreference>) => {
    void savePreferences({
      ...taskPreferences,
      [taskKey]: { ...(taskPreferences[taskKey] || DEFAULT_TASK_PREFERENCE), ...updates },
    })
  }

  const savePersonal = async (next: MyPagePersonalTask[]) => {
    setPersonalTasks(next)
    if (!user?.email) return
    try {
      await saveMyPagePersonalTasks(user.email, next)
    } catch {
      toast.error("개인 업무 저장에 실패했습니다.")
    }
  }

  const updatePersonal = (id: string, updates: Partial<MyPagePersonalTask>) => {
    void savePersonal(personalTasks.map((task) => (task.id === id ? { ...task, ...updates, updatedAt: Date.now() } : task)))
  }

  const createPersonalTask = (title: string, memo: string, date?: Date) => {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) return false
    const now = Date.now()
    const dateKey = date ? formatTaskDateKey(date) : undefined
    const next: MyPagePersonalTask = {
      id: `personal-${now}`,
      title: normalizedTitle,
      memo: memo.trim() || undefined,
      startDate: dateKey,
      endDate: dateKey,
      checked: false,
      priority: "medium",
      important: false,
      order: personalTasks.length,
      createdAt: now,
      updatedAt: now,
    }
    void savePersonal([...personalTasks, next])
    return true
  }

  const removePersonal = (id: string) => {
    if (selectedItemId === `personal:${id}`) setSelectedItemId(null)
    void savePersonal(personalTasks.filter((task) => task.id !== id).map((task, index) => ({ ...task, order: index })))
  }

  const updatePersonalDates = (task: MyPagePersonalTask, nextStart: Date, nextEnd: Date) => {
    const normalized = normalizeDateRange(nextStart, nextEnd)
    if (!normalized) return
    updatePersonal(task.id, {
      startDate: formatTaskDateKey(normalized.start),
      endDate: formatTaskDateKey(normalized.end),
    })
    toast.success("개인 업무 날짜가 변경되었습니다.")
  }

  const clearPersonalDates = (task: MyPagePersonalTask) => {
    updatePersonal(task.id, { startDate: undefined, endDate: undefined })
    toast.success("개인 업무를 미배정으로 이동했습니다.")
  }

  const getProjectUpdateFns = (source: ProjectSource) => {
    if (source === "fa") {
      return { updateTask: updateFaTaskInDB, addHistory: addFaHistoryEntry }
    }
    if (source === "ict") {
      return { updateTask: updateIctTaskInDB, addHistory: addIctHistoryEntry }
    }
    return { updateTask: updateStrategyTaskInDB, addHistory: addStrategyHistoryEntry }
  }

  const handleProjectTaskEdit = async (item: ProjectTaskItem, updatedTask: Task) => {
    if (!user?.email) {
      toast.error("로그인 정보를 확인할 수 없습니다.")
      return
    }
    if (!isAdmin && !isUserOwnerOfTask(item.task, aliases)) {
      toast.error("본인 담당 업무만 수정할 수 있습니다.")
      return
    }

    const allowedFieldSet = new Set(effectiveEditableFields)
    if (allowedFieldSet.size === 0) {
      toast.info("관리자가 편집을 허용한 항목이 없습니다.")
      return
    }

    const allowedUpdates: Partial<Task> = {}
    if (allowedFieldSet.has("status")) allowedUpdates.status = updatedTask.status
    if (allowedFieldSet.has("memo")) allowedUpdates.memo = updatedTask.memo
    if (allowedFieldSet.has("manDays")) allowedUpdates.manDays = updatedTask.manDays
    if (allowedFieldSet.has("startDate")) allowedUpdates.startDate = updatedTask.startDate
    if (allowedFieldSet.has("endDate")) allowedUpdates.endDate = updatedTask.endDate
    if (allowedFieldSet.has("task")) allowedUpdates.task = updatedTask.task
    if (allowedFieldSet.has("category")) allowedUpdates.category = updatedTask.category
    if (allowedFieldSet.has("department")) allowedUpdates.department = updatedTask.department
    if (allowedFieldSet.has("person")) allowedUpdates.person = updatedTask.person

    const { updateTask, addHistory } = getProjectUpdateFns(item.source)

    try {
      await updateTask(item.task.id, allowedUpdates)
      const merged: Task = { ...item.task, ...allowedUpdates }
      try {
        await addHistory({
          entityType: "task",
          action: "update",
          entityId: item.task.id,
          projectId: item.task.projectId,
          before: serializeTaskForHistory(item.task),
          after: serializeTaskForHistory(merged),
          actorEmail: user.email,
          actorName: aliases[0] || user.email.split("@")[0] || undefined,
          source: "my-page",
        })
      } catch (historyError) {
        console.error("History write failed:", historyError)
      }
      toast.success("업무가 수정되었습니다.")
    } catch (error) {
      console.error("Task update failed:", error)
      toast.error("업무 수정에 실패했습니다.")
    }
  }

  const updateProjectDates = async (item: ProjectTaskItem, nextStart: Date, nextEnd: Date) => {
    if (!user?.email) {
      toast.error("로그인 정보를 확인할 수 없습니다.")
      return
    }
    if (!isAdmin && !isUserOwnerOfTask(item.task, aliases)) {
      toast.error("본인 담당 업무만 수정할 수 있습니다.")
      return
    }

    const allowedFieldSet = new Set(effectiveEditableFields)
    if (!isAdmin && (!allowedFieldSet.has("startDate") || !allowedFieldSet.has("endDate"))) {
      toast.info("관리자가 날짜 편집을 허용하지 않았습니다.")
      return
    }

    const normalized = normalizeDateRange(nextStart, nextEnd)
    if (!normalized) return

    const updates: Partial<Task> = {
      startDate: formatTaskDateKey(normalized.start),
      endDate: formatTaskDateKey(normalized.end),
    }
    if (isAdmin || allowedFieldSet.has("manDays")) {
      updates.manDays = calculateManDaysBetweenDates(normalized.start, normalized.end, false)
    }

    const { updateTask, addHistory } = getProjectUpdateFns(item.source)

    try {
      await updateTask(item.task.id, updates)
      const merged: Task = { ...item.task, ...updates }
      try {
        await addHistory({
          entityType: "task",
          action: "update",
          entityId: item.task.id,
          projectId: item.task.projectId,
          before: serializeTaskForHistory(item.task),
          after: serializeTaskForHistory(merged),
          actorEmail: user.email,
          actorName: aliases[0] || user.email.split("@")[0] || undefined,
          source: "my-page",
        })
      } catch (historyError) {
        console.error("History write failed:", historyError)
      }
      toast.success("프로젝트 업무 날짜가 변경되었습니다.")
    } catch (error) {
      console.error("Project date update failed:", error)
      toast.error("프로젝트 업무 날짜 변경에 실패했습니다.")
    }
  }

  const saveMemo = async () => {
    if (!user?.email) return
    setIsSavingMemo(true)
    try {
      await saveMyPageMemo(user.email, myMemo)
      toast.success("메모가 저장되었습니다.")
    } catch {
      toast.error("메모 저장에 실패했습니다.")
    } finally {
      setIsSavingMemo(false)
    }
  }

  const logout = async () => {
    try {
      await signOut(auth)
      toast.success("로그아웃 되었습니다.")
    } catch {
      toast.error("로그아웃에 실패했습니다.")
    }
  }

  const toggleSource = (source: CalendarSource) => {
    setSelectedSources((prev) =>
      prev.includes(source) ? prev.filter((item) => item !== source) : [...prev, source],
    )
  }

  const toggleCalendarBadge = (badgeKey: CalendarBadgeKey) => {
    setVisibleBadgeKeys((prev) =>
      prev.includes(badgeKey) ? prev.filter((key) => key !== badgeKey) : [...prev, badgeKey],
    )
  }

  const startDrag = (event: React.DragEvent<HTMLElement>, payload: CalendarDragPayload) => {
    setDragPayload(payload)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(CALENDAR_DND_MIME, JSON.stringify(payload))
  }

  const readDragPayload = (event: React.DragEvent<HTMLElement>) => {
    if (dragPayload) return dragPayload
    const raw = event.dataTransfer.getData(CALENDAR_DND_MIME)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as CalendarDragPayload
      if (
        typeof parsed.itemId === "string" &&
        (parsed.action === "move" || parsed.action === "resize-start" || parsed.action === "resize-end")
      ) {
        return parsed
      }
    } catch {
      return null
    }
    return null
  }

  const hasCalendarDrag = (event: React.DragEvent<HTMLElement>) =>
    Boolean(dragPayload) || Array.from(event.dataTransfer.types).includes(CALENDAR_DND_MIME)

  const handleDropOnDate = (event: React.DragEvent<HTMLElement>, targetDate: Date) => {
    event.preventDefault()
    const payload = readDragPayload(event)
    setDropDateKey(null)
    setDragPayload(null)
    if (!payload) return

    const calendarItem = calendarItems.find((item) => item.id === payload.itemId)
    if (payload.itemId.startsWith("personal:")) {
      const personalId = payload.itemId.slice("personal:".length)
      const task = personalTasks.find((item) => item.id === personalId)
      if (!task) return
      const taskRange = {
        start: calendarItem?.start || parseTaskDate(task.startDate, viewMonth),
        end: calendarItem?.end || parseTaskDate(task.endDate, viewMonth),
      }
      const nextRange =
        payload.action === "move"
          ? moveRangeToDate(taskRange, targetDate)
          : resizeRangeToDate(taskRange, targetDate, payload.action)
      updatePersonalDates(task, nextRange.start, nextRange.end)
      setSelectedItemId(`personal:${task.id}`)
      return
    }

    if (payload.itemId.startsWith("project:")) {
      const projectKey = payload.itemId.slice("project:".length)
      const taskItem = projectTaskItems.find((item) => item.key === projectKey)
      if (!taskItem) return
      const itemRange = calendarItem || {
        start: parseTaskDate(taskItem.task.startDate, viewMonth),
        end: parseTaskDate(taskItem.task.endDate, viewMonth),
      }
      const nextRange =
        payload.action === "move"
          ? moveRangeToDate(itemRange, targetDate)
          : resizeRangeToDate(itemRange, targetDate, payload.action)
      void updateProjectDates(taskItem, nextRange.start, nextRange.end)
      setSelectedItemId(`project:${taskItem.key}`)
    }
  }

  const openQuickCreate = (date: Date) => {
    setQuickCreateDate(date)
    setQuickCreateTitle("")
    setQuickCreateMemo("")
    setIsQuickCreateOpen(true)
  }

  const submitQuickCreate = () => {
    if (!quickCreateDate) return
    if (createPersonalTask(quickCreateTitle, quickCreateMemo, quickCreateDate)) {
      setIsQuickCreateOpen(false)
      setQuickCreateTitle("")
      setQuickCreateMemo("")
    }
  }

  const submitSidebarPersonal = () => {
    if (createPersonalTask(sidebarTitle, sidebarMemo)) {
      setSidebarTitle("")
      setSidebarMemo("")
    }
  }

  const saveSelectedPersonalDetails = () => {
    if (!selectedPersonalTask) return
    const title = detailTitle.trim()
    if (!title) {
      toast.info("업무 제목을 입력하세요.")
      return
    }
    updatePersonal(selectedPersonalTask.id, {
      title,
      memo: detailMemo.trim() || undefined,
    })
    toast.success("개인 업무가 저장되었습니다.")
  }

  const renderCalendarBar = (segment: CalendarWeekSegment) => {
    const item = segment.item
    const meta = sourceMeta[item.source]
    const isSelected = selectedItemId === item.id
    const status = getCalendarItemStatus(item)
    const duration = daysBetween(item.start, item.end) + 1
    const propertyBadges = getCalendarPropertyBadges(item, visibleBadgeKeys)
    const pref =
      item.kind === "project"
        ? taskPreferences[item.projectTask.key] || DEFAULT_TASK_PREFERENCE
        : {
            priority: item.personalTask.priority,
            important: item.personalTask.important,
          }
    const important = item.kind === "project" ? pref.important || item.projectTask.task.category === "중요" : pref.important

    return (
      <div
        key={`${item.id}-${segment.startOffset}-${segment.lane}`}
        className="absolute left-0 right-0 px-1"
        style={{ top: segment.lane * 54 }}
      >
        <div className="grid grid-cols-7 gap-px">
          <div
            role="button"
            tabIndex={0}
            draggable
            onClick={() => setSelectedItemId(item.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setSelectedItemId(item.id)
            }}
            onDragStart={(event) => startDrag(event, { itemId: item.id, action: "move" })}
            onDragEnd={() => {
              setDragPayload(null)
              setDropDateKey(null)
            }}
            style={{ gridColumn: `${segment.startOffset + 1} / span ${segment.span}` }}
            className={cn(
              "group relative flex min-h-[48px] min-w-0 cursor-grab flex-col items-stretch justify-center rounded-md border px-1.5 py-1 text-left text-[11px] font-medium shadow-sm transition active:cursor-grabbing",
              meta.barClass,
              isSelected && "border-slate-500 ring-2 ring-slate-200",
              important && "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100",
              status === "완료" && "opacity-55",
            )}
            title={`${item.title} (${formatDateWithYear(item.start)} ~ ${formatDateWithYear(item.end)})`}
          >
            <button
              type="button"
              draggable
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.stopPropagation()
                startDrag(event, { itemId: item.id, action: "resize-start" })
              }}
              className="absolute left-0 top-0 h-full w-2 cursor-ew-resize rounded-l-md opacity-0 transition group-hover:opacity-100"
              aria-label="시작일 조정"
              title="시작일 조정"
            />
            <div className="flex min-w-0 items-center gap-1">
              {important ? <Star className="h-3 w-3 shrink-0 fill-current text-rose-600" /> : null}
              <span className={cn("min-w-0 flex-1 truncate", status === "완료" && "line-through")}>{item.title}</span>
              <span className="shrink-0 text-[10px] font-normal text-slate-400">{meta.label}</span>
              {duration > 1 ? <span className="shrink-0 text-[10px] opacity-70">{duration}일</span> : null}
            </div>
            {propertyBadges.length > 0 ? (
              <div className="mt-1 flex min-w-0 flex-wrap gap-1 overflow-hidden">
                {propertyBadges.map((badge) => (
                  <span
                    key={`${item.id}-${badge.key}`}
                    className="max-w-full truncate rounded-full bg-white/75 px-1.5 py-0.5 text-[10px] font-normal leading-none text-slate-600 ring-1 ring-inset ring-slate-200/80"
                    title={badge.label}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              draggable
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.stopPropagation()
                startDrag(event, { itemId: item.id, action: "resize-end" })
              }}
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r-md opacity-0 transition group-hover:opacity-100"
              aria-label="종료일 조정"
              title="종료일 조정"
            />
          </div>
        </div>
      </div>
    )
  }

  const renderCalendarWeek = (week: CalendarDay[], index: number) => {
    const { segments, laneCount } = getWeekSegments(visibleCalendarItems, week)
    const minHeight = Math.max(158, 66 + laneCount * 54)

    return (
      <div key={`week-${index}`} className="relative border-t border-slate-200" style={{ minHeight }}>
        <div className="absolute inset-0 grid grid-cols-7">
          {week.map((day) => {
            const isDropTarget = dropDateKey === day.key
            return (
              <div
                key={day.key}
                onDragOver={(event) => {
                  if (!hasCalendarDrag(event)) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = "move"
                  if (dropDateKey !== day.key) setDropDateKey(day.key)
                }}
                onDragLeave={() => {
                  if (dropDateKey === day.key) setDropDateKey(null)
                }}
                onDrop={(event) => handleDropOnDate(event, day.date)}
                className={cn(
                  "relative border-r border-slate-200 px-2 py-1.5 transition-colors last:border-r-0",
                  "group/day",
                  day.isCurrentMonth ? "bg-white" : "bg-slate-50/70 text-slate-400",
                  day.isWeekend && day.isCurrentMonth && "bg-slate-50/60",
                  day.isToday && day.isCurrentMonth && "bg-emerald-50/70",
                  isDropTarget && "bg-sky-100 ring-2 ring-inset ring-sky-400",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-semibold",
                      day.isToday ? "bg-emerald-600 text-white" : "text-slate-500",
                    )}
                  >
                    {day.dayNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => openQuickCreate(day.date)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 opacity-100 transition hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 sm:opacity-0 sm:group-hover/day:opacity-100"
                    aria-label={`${formatDateWithYear(day.date)} 개인 업무 추가`}
                    title="개인 업무 추가"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="absolute inset-x-0 top-9">{segments.map(renderCalendarBar)}</div>
      </div>
    )
  }

  const renderUnscheduledPersonalTask = (task: MyPagePersonalTask) => {
    const itemId = `personal:${task.id}`
    return (
      <div
        key={task.id}
        role="button"
        tabIndex={0}
        draggable
        onClick={() => setSelectedItemId(itemId)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") setSelectedItemId(itemId)
        }}
        onDragStart={(event) => startDrag(event, { itemId, action: "move" })}
        onDragEnd={() => {
          setDragPayload(null)
          setDropDateKey(null)
        }}
        className={cn(
          "rounded-md border border-slate-200 bg-white p-2 text-sm shadow-sm transition hover:border-slate-300 hover:shadow-md",
          selectedItemId === itemId && "border-slate-500 ring-2 ring-slate-200",
          task.important && "border-rose-300 bg-rose-50",
        )}
      >
        <div className="flex items-start gap-2">
          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className={cn("truncate font-semibold text-slate-800", task.checked && "line-through")}>{task.title}</p>
            {task.memo ? <p className="mt-1 line-clamp-2 text-xs text-slate-500">{task.memo}</p> : null}
            <div className="mt-2 flex items-center gap-1">
              <Badge variant="outline" className={sourceMeta.personal.chipClass}>개인</Badge>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px]", priorityMeta[task.priority].className)}>
                {priorityMeta[task.priority].label}
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#f3f6fb_48%,#ffffff_100%)] px-3 py-5 lg:px-5">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4">
        <header className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
              <Image
                src="/placeholder-logo.png"
                alt="WorkHub 로고"
                width={34}
                height={34}
                className="h-8 w-auto object-contain"
                priority
              />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">WORKHUB</p>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">마이워크 테스트</h1>
            </div>
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end">
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="max-w-full justify-start border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 sm:max-w-[320px]"
                >
                  <MessageSquareText className="h-4 w-4" />
                  <span>메모장</span>
                  <span className="hidden max-w-[170px] overflow-hidden text-ellipsis text-xs font-normal text-amber-700/70 sm:inline-block">
                    {memoPreview}
                  </span>
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>메모장</DialogTitle>
                  <DialogDescription>업무 중 필요한 내용을 빠르게 남겨둡니다.</DialogDescription>
                </DialogHeader>
                <Textarea
                  value={myMemo}
                  onChange={(event) => setMyMemo(event.target.value)}
                  placeholder="메모를 입력하세요"
                  rows={12}
                  className="min-h-[320px] resize-y"
                />
                <DialogFooter>
                  <Button type="button" onClick={() => void saveMemo()} disabled={isSavingMemo}>
                    {isSavingMemo ? "저장 중..." : "메모 저장"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button asChild variant="outline">
              <Link href="/">
                <Home className="h-4 w-4" />
                메인
              </Link>
            </Button>
            <Button type="button" variant="outline" onClick={logout}>
              <LogOut className="h-4 w-4" />
              로그아웃
            </Button>
          </div>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                title="이전 달"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const now = new Date()
                  setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1))
                }}
              >
                오늘
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                title="다음 달"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div className="flex min-w-[150px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-800">
                <CalendarDays className="h-4 w-4 text-slate-500" />
                {viewMonthLabel}
              </div>
            </div>

            <div className="flex flex-1 flex-wrap items-center gap-2">
              {(["personal", "strategy", "fa", "ict"] as CalendarSource[]).map((source) => {
                const meta = sourceMeta[source]
                const selected = selectedSources.includes(source)
                return (
                  <button
                    key={source}
                    type="button"
                    onClick={() => toggleSource(source)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      selected ? meta.chipClass : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                    aria-pressed={selected}
                  >
                    <span className={cn("h-2 w-2 rounded-full", selected ? meta.dotClass : "bg-slate-300")} />
                    {meta.label}
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedStatus("all")}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  selectedStatus === "all" ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600",
                )}
              >
                전체
              </button>
              {PROJECT_STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setSelectedStatus(status)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                    selectedStatus === status ? statusFilterMeta[status] : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {status}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-1">
              <span className="px-1 text-[11px] font-medium text-slate-500">표시 배지</span>
              {CALENDAR_BADGE_OPTIONS.map((option) => {
                const selected = visibleBadgeKeys.includes(option.key)
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => toggleCalendarBadge(option.key)}
                    className={cn(
                      "rounded-full px-2 py-1 text-[11px] font-semibold transition",
                      selected ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-white",
                    )}
                    aria-pressed={selected}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>

            <div className="relative min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="업무, 프로젝트, 담당자 검색"
                className="pl-9"
              />
            </div>
          </div>
        </section>

        <section className="grid min-h-[calc(100vh-230px)] gap-4 xl:grid-cols-[300px_minmax(720px,1fr)_340px]">
          <aside className="flex min-h-[360px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-bold text-slate-900">미배정 업무</h2>
                  <p className="text-xs text-slate-500">날짜 칸으로 드래그해 배정합니다.</p>
                </div>
                <Badge variant="outline">{visibleUnscheduledPersonalTasks.length}</Badge>
              </div>
              <div className="mt-3 space-y-2">
                <Input
                  value={sidebarTitle}
                  onChange={(event) => setSidebarTitle(event.target.value)}
                  placeholder="개인 업무 제목"
                />
                <Textarea
                  value={sidebarMemo}
                  onChange={(event) => setSidebarMemo(event.target.value)}
                  placeholder="메모 (선택)"
                  rows={2}
                />
                <Button type="button" className="w-full" onClick={submitSidebarPersonal}>
                  <Plus className="h-4 w-4" />
                  미배정 업무 추가
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {visibleUnscheduledPersonalTasks.length > 0 ? (
                visibleUnscheduledPersonalTasks.map(renderUnscheduledPersonalTask)
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
                  미배정 개인 업무가 없습니다.
                </div>
              )}
            </div>
          </aside>

          <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {DAY_LABELS.map((label, index) => (
                <div
                  key={label}
                  className={cn(
                    "px-3 py-2 text-center text-xs font-bold text-slate-500",
                    index >= 5 && "text-slate-400",
                  )}
                >
                  {label}
                </div>
              ))}
            </div>
            <div className="group">{calendarWeeks.map(renderCalendarWeek)}</div>
          </div>

          <aside className="flex min-h-[360px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-4">
              <div>
                <h2 className="font-bold text-slate-900">상세</h2>
                <p className="text-xs text-slate-500">카드를 선택해 업무를 편집합니다.</p>
              </div>
              {selectedItemId ? (
                <Button type="button" variant="ghost" size="icon" onClick={() => setSelectedItemId(null)} title="선택 해제">
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {!selectedItemId ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">
                  달력 카드나 미배정 업무를 선택하세요.
                </div>
              ) : selectedPersonalTask ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={sourceMeta.personal.chipClass}>개인</Badge>
                    <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", priorityMeta[selectedPersonalTask.priority].className)}>
                      {priorityMeta[selectedPersonalTask.priority].label}
                    </span>
                    {selectedPersonalTask.important ? <Badge className="bg-rose-600 text-white">중요</Badge> : null}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-500">업무 제목</label>
                    <Input value={detailTitle} onChange={(event) => setDetailTitle(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-500">메모</label>
                    <Textarea value={detailMemo} onChange={(event) => setDetailMemo(event.target.value)} rows={4} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-500">시작일</label>
                      <Input
                        type="date"
                        value={
                          parseTaskDate(selectedPersonalTask.startDate, viewMonth)
                            ? formatDateInputValue(parseTaskDate(selectedPersonalTask.startDate, viewMonth)!)
                            : ""
                        }
                        onChange={(event) => {
                          const parsed = parseDateInputValue(event.target.value)
                          if (parsed) {
                            updatePersonal(selectedPersonalTask.id, { startDate: formatTaskDateKey(parsed) })
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-500">종료일</label>
                      <Input
                        type="date"
                        value={
                          parseTaskDate(selectedPersonalTask.endDate, viewMonth)
                            ? formatDateInputValue(parseTaskDate(selectedPersonalTask.endDate, viewMonth)!)
                            : ""
                        }
                        onChange={(event) => {
                          const parsed = parseDateInputValue(event.target.value)
                          if (parsed) {
                            updatePersonal(selectedPersonalTask.id, { endDate: formatTaskDateKey(parsed) })
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={selectedPersonalTask.checked ? "default" : "outline"}
                      onClick={() => updatePersonal(selectedPersonalTask.id, { checked: !selectedPersonalTask.checked })}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {selectedPersonalTask.checked ? "완료됨" : "완료 처리"}
                    </Button>
                    <Button
                      type="button"
                      variant={selectedPersonalTask.important ? "default" : "outline"}
                      onClick={() => updatePersonal(selectedPersonalTask.id, { important: !selectedPersonalTask.important })}
                    >
                      <Star className={cn("h-4 w-4", selectedPersonalTask.important && "fill-current")} />
                      중요
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["high", "medium", "low"] as const).map((priority) => (
                      <button
                        key={priority}
                        type="button"
                        onClick={() => updatePersonal(selectedPersonalTask.id, { priority })}
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-semibold",
                          selectedPersonalTask.priority === priority ? priorityMeta[priority].className : "bg-slate-100 text-slate-500",
                        )}
                      >
                        {priorityMeta[priority].label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                    <Button type="button" onClick={saveSelectedPersonalDetails}>저장</Button>
                    <Button type="button" variant="outline" onClick={() => clearPersonalDates(selectedPersonalTask)}>
                      미배정으로
                    </Button>
                    <Button type="button" variant="destructive" onClick={() => removePersonal(selectedPersonalTask.id)}>
                      삭제
                    </Button>
                  </div>
                </div>
              ) : selectedProjectTask ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={sourceMeta[selectedProjectTask.source].chipClass}>
                      {sourceMeta[selectedProjectTask.source].label}
                    </Badge>
                    <ProjectTypeBadge type={selectedProjectTask.projectType} />
                    <CategoryBadge category={selectedProjectTask.task.category} />
                    <StatusBadge status={selectedProjectTask.task.status} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{selectedProjectTask.task.task}</h3>
                    <p className="mt-1 text-sm text-slate-500">{selectedProjectTask.projectName}</p>
                  </div>
                  <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-4 w-4 text-slate-400" />
                      {formatDateWithYear(parseTaskDate(selectedProjectTask.task.startDate, viewMonth))} ~{" "}
                      {formatDateWithYear(parseTaskDate(selectedProjectTask.task.endDate, viewMonth))}
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-slate-400" />
                      {selectedProjectTask.task.person || "-"}
                    </div>
                    {selectedProjectTask.ancestorNames.length > 0 ? (
                      <div className="text-xs text-slate-500">상위업무: {selectedProjectTask.ancestorNames.join(" > ")}</div>
                    ) : null}
                  </div>
                  {selectedProjectTask.task.memo ? (
                    <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600">
                      {selectedProjectTask.task.memo}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {(["high", "medium", "low"] as const).map((priority) => {
                      const pref = taskPreferences[selectedProjectTask.key] || DEFAULT_TASK_PREFERENCE
                      return (
                        <button
                          key={priority}
                          type="button"
                          onClick={() => updateProjectPref(selectedProjectTask.key, { priority })}
                          className={cn(
                            "rounded-full px-3 py-1 text-xs font-semibold",
                            pref.priority === priority ? priorityMeta[priority].className : "bg-slate-100 text-slate-500",
                          )}
                        >
                          {priorityMeta[priority].label}
                        </button>
                      )
                    })}
                    <Button
                      type="button"
                      variant={(taskPreferences[selectedProjectTask.key] || DEFAULT_TASK_PREFERENCE).important ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        updateProjectPref(selectedProjectTask.key, {
                          important: !(taskPreferences[selectedProjectTask.key] || DEFAULT_TASK_PREFERENCE).important,
                        })
                      }
                    >
                      <Star
                        className={cn(
                          "h-4 w-4",
                          (taskPreferences[selectedProjectTask.key] || DEFAULT_TASK_PREFERENCE).important && "fill-current",
                        )}
                      />
                      중요
                    </Button>
                  </div>
                  <EditTaskDialog
                    task={selectedProjectTask.task}
                    onEditTask={(updated) => void handleProjectTaskEdit(selectedProjectTask, updated)}
                    defaultDepartment={
                      selectedProjectTask.task.department ||
                      (selectedProjectTask.source === "fa" ? "FA" : selectedProjectTask.source === "ict" ? "ICT" : "전략")
                    }
                    editableFields={effectiveEditableFields}
                    trigger={
                      <Button type="button" className="w-full">
                        <Pencil className="h-4 w-4" />
                        프로젝트 업무 수정
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">
                  선택한 업무를 찾을 수 없습니다.
                </div>
              )}
            </div>
          </aside>
        </section>
      </div>

      <Dialog open={isQuickCreateOpen} onOpenChange={setIsQuickCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>개인 업무 추가</DialogTitle>
            <DialogDescription>
              {quickCreateDate ? `${formatDateWithYear(quickCreateDate)}에 배치할 개인 업무를 추가합니다.` : "개인 업무를 추가합니다."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={quickCreateTitle}
              onChange={(event) => setQuickCreateTitle(event.target.value)}
              placeholder="업무 제목"
            />
            <Textarea
              value={quickCreateMemo}
              onChange={(event) => setQuickCreateMemo(event.target.value)}
              placeholder="메모 (선택)"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsQuickCreateOpen(false)}>취소</Button>
            <Button type="button" onClick={submitQuickCreate}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
