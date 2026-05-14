"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { signOut } from "firebase/auth"
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock3,
  GripVertical,
  Home,
  LogOut,
  Eye,
  EyeOff,
  MessageSquareText,
  Pencil,
  Plus,
  Star,
  Trash2,
  User,
  UserRoundSearch,
} from "lucide-react"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/components/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CategoryBadge, ProjectTypeBadge, StatusBadge } from "@/components/status-badge"
import { toast } from "sonner"
import {
  addHistoryEntry as addStrategyHistoryEntry,
  DEFAULT_MY_PAGE_EDITABLE_FIELDS,
  deleteHistoryEntry as deleteStrategyHistoryEntry,
  fetchHistoryEntries as fetchStrategyHistoryEntries,
  isUserOwnerOfTask,
  rollbackHistoryEntry as rollbackStrategyHistoryEntry,
  saveMyPageMemo,
  saveMyPageCollapsedProjectGroups,
  saveMyPagePersonalTasks,
  saveMyPageTaskPreferences,
  subscribeCurrentUserProfile,
  subscribeMyPageEditableFields,
  subscribeToData as subscribeStrategyData,
  updateTaskInDB as updateStrategyTaskInDB,
  type MyPageEditableFieldsSettings,
  type MyPagePersonalTask,
  type MyPageTaskPreference,
} from "@/lib/firestore-service"
import {
  addHistoryEntry as addFaHistoryEntry,
  deleteHistoryEntry as deleteFaHistoryEntry,
  fetchHistoryEntries as fetchFaHistoryEntries,
  rollbackHistoryEntry as rollbackFaHistoryEntry,
  subscribeToData as subscribeFaData,
  updateTaskInDB as updateFaTaskInDB,
} from "@/lib/firestore-service-fa"
import type { Project, Task, TaskStatus } from "@/lib/data"
import { EditTaskDialog } from "@/components/edit-task-dialog"
import { RecentChangesWidget, type RecentChangeEntry } from "@/components/recent-changes-widget"
import { cn } from "@/lib/utils"

type GroupedProject = {
  id: string
  departmentPage: "전략사업부" | "FA 사업부"
  name: string
  type: string
  tasks: ProjectTaskItem[]
}

type ProjectTaskItem = {
  key: string
  departmentPage: GroupedProject["departmentPage"]
  projectName: string
  projectType: string
  task: Task
  sortTime: number
  depth: number
  ancestorNames: string[]
}

type MyPagePanel = "today" | "project" | "personal" | "memo"

const DEFAULT_TASK_PREFERENCE: MyPageTaskPreference = {
  checked: false,
  priority: "medium",
  important: false,
  order: Number.MAX_SAFE_INTEGER,
}

const PROJECT_TASK_DND_MIME = "application/x-workhub-project-task"
const PERSONAL_TASK_DND_MIME = "application/x-workhub-personal-task"


const serializeTaskForHistory = (task: Task) => {
  const payload: Record<string, unknown> = {
    projectId: task.projectId,
    task: task.task,
    category: task.category,
    department: task.department,
    person: task.person,
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

const priorityMeta: Record<MyPageTaskPreference["priority"], { label: string; className: string; rank: number }> = {
  high: { label: "높음", className: "bg-rose-100 text-rose-700", rank: 0 },
  medium: { label: "보통", className: "bg-amber-100 text-amber-700", rank: 1 },
  low: { label: "낮음", className: "bg-slate-700 text-white", rank: 2 },
}

type ProjectStatusFilter = TaskStatus

const PROJECT_STATUS_FILTERS: ProjectStatusFilter[] = ["진행", "예정", "보류", "미정", "완료"]

const projectStatusFilterMeta: Record<ProjectStatusFilter, { className: string; activeClassName: string }> = {
  진행: {
    className: "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-400",
    activeClassName: "border-blue-600 bg-blue-600 text-white ring-2 ring-blue-100",
  },
  예정: {
    className: "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-400",
    activeClassName: "border-gray-500 bg-gray-600 text-white ring-2 ring-gray-100",
  },
  보류: {
    className: "border-yellow-200 bg-yellow-50 text-yellow-800 hover:border-yellow-400",
    activeClassName: "border-yellow-500 bg-yellow-400 text-yellow-950 ring-2 ring-yellow-100",
  },
  미정: {
    className: "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-400",
    activeClassName: "border-rose-500 bg-rose-500 text-white ring-2 ring-rose-100",
  },
  완료: {
    className: "border-slate-600 bg-slate-600 text-slate-50 hover:border-slate-700",
    activeClassName: "border-slate-800 bg-slate-800 text-slate-50 ring-2 ring-slate-200",
  },
}

const isProjectStatusFilter = (status: TaskStatus): status is ProjectStatusFilter => PROJECT_STATUS_FILTERS.includes(status as ProjectStatusFilter)

const parseDateLabel = (value?: string) => {
  const matched = value?.match(/(\d{1,2})\D+(\d{1,2})/)
  return matched ? new Date(new Date().getFullYear(), Number(matched[1]) - 1, Number(matched[2])).getTime() : Number.MAX_SAFE_INTEGER
}

const parseTaskDateTime = (value?: string) => {
  const normalized = (value || "").trim()
  if (!normalized) return null
  const isoMatched = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatched) {
    return new Date(Number(isoMatched[1]), Number(isoMatched[2]) - 1, Number(isoMatched[3])).getTime()
  }
  const matched = normalized.match(/(\d{1,2})\D+(\d{1,2})/)
  return matched ? new Date(new Date().getFullYear(), Number(matched[1]) - 1, Number(matched[2])).getTime() : null
}

const getTodayTime = () => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

const isTaskInToday = (task: Task) => {
  const today = getTodayTime()
  const start = parseTaskDateTime(task.startDate)
  const end = parseTaskDateTime(task.endDate)
  if (start === null && end === null) return false
  return (start === null || start <= today) && (end === null || today <= end)
}

const formatDateWithYear = (value?: string) => {
  const normalized = (value || "").trim()
  if (!normalized) return "-"
  if (/\d{4}/.test(normalized)) return normalized
  const matched = normalized.match(/(\d{1,2})\D+(\d{1,2})/)
  if (!matched) return normalized
  const year = new Date().getFullYear()
  const month = String(Number(matched[1])).padStart(2, "0")
  const day = String(Number(matched[2])).padStart(2, "0")
  return `${year}.${month}.${day}`
}

const buildAliasCandidates = (email?: string | null, displayName?: string | null) => {
  const normalizedEmail = (email || "").trim().toLowerCase()
  const localPart = normalizedEmail.split("@")[0] || ""
  return Array.from(new Set([normalizedEmail, localPart, localPart.replaceAll(".", " "), displayName?.trim() || ""].filter(Boolean)))
}

const hasAliasMatch = (person: string, aliases: string[]) => {
  const normalizedPerson = person.trim().toLowerCase()
  const tokens = person.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean)
  return aliases.some((alias) => normalizedPerson.includes(alias.trim().toLowerCase()) || tokens.includes(alias.trim().toLowerCase()))
}

const collectProjectTaskItems = (
  tasks: Task[],
  context: Pick<ProjectTaskItem, "departmentPage" | "projectName" | "projectType">,
  projectId: string,
  aliases: string[],
  ancestors: Task[] = [],
): ProjectTaskItem[] => {
  const collected: ProjectTaskItem[] = []

  tasks.forEach((task) => {
    const children = task.subTasks || []
    if (children.length > 0) {
      collected.push(...collectProjectTaskItems(children, context, projectId, aliases, [...ancestors, task]))
      return
    }

    if (!hasAliasMatch(task.person || "", aliases)) return

    collected.push({
      key: `${projectId}:${task.id}`,
      departmentPage: context.departmentPage,
      projectName: context.projectName,
      projectType: context.projectType,
      task,
      sortTime: parseDateLabel(task.startDate),
      depth: ancestors.length,
      ancestorNames: ancestors.map((entry) => entry.task),
    })
  })

  return collected
}

export default function MyPage() {
  const { user, isAdmin, pagePermissions } = useAuth()
  const [strategyProjects, setStrategyProjects] = useState<Project[]>([])
  const [faProjects, setFaProjects] = useState<Project[]>([])
  const [aliases, setAliases] = useState<string[]>([])
  const [taskPreferences, setTaskPreferences] = useState<Record<string, MyPageTaskPreference>>({})
  const [personalTasks, setPersonalTasks] = useState<MyPagePersonalTask[]>([])
  const [draftTitle, setDraftTitle] = useState("")
  const [draftMemo, setDraftMemo] = useState("")
  const [draftStartDate, setDraftStartDate] = useState("")
  const [draftEndDate, setDraftEndDate] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const [editingMemo, setEditingMemo] = useState("")
  const [editingStartDate, setEditingStartDate] = useState("")
  const [editingEndDate, setEditingEndDate] = useState("")
  const [draggedProjectKey, setDraggedProjectKey] = useState<string | null>(null)
  const [draggedPersonalId, setDraggedPersonalId] = useState<string | null>(null)
  const [projectDropIndicator, setProjectDropIndicator] = useState<{ key: string; position: "before" | "after" } | null>(null)
  const [personalDropIndicator, setPersonalDropIndicator] = useState<{ id: string; position: "before" | "after" } | null>(null)
  const [isProjectActiveCollapsed, setIsProjectActiveCollapsed] = useState(true)
  const [isProjectHiddenCollapsed, setIsProjectHiddenCollapsed] = useState(true)
  const [selectedProjectStatus, setSelectedProjectStatus] = useState<ProjectStatusFilter | null>("진행")
  const [checkedTodayTaskKeys, setCheckedTodayTaskKeys] = useState<string[]>([])
  const [isTodayActiveCollapsed, setIsTodayActiveCollapsed] = useState(true)
  const [isTodayCompletedCollapsed, setIsTodayCompletedCollapsed] = useState(true)
  const [collapsedProjectGroups, setCollapsedProjectGroups] = useState<Record<string, boolean>>({})
  const [isPersonalActiveCollapsed, setIsPersonalActiveCollapsed] = useState(true)
  const [isPersonalCompletedCollapsed, setIsPersonalCompletedCollapsed] = useState(true)
  const [expandedPersonalMemoIds, setExpandedPersonalMemoIds] = useState<string[]>([])
  const [expandedPanels, setExpandedPanels] = useState<MyPagePanel[]>([])
  const [myMemo, setMyMemo] = useState("")
  const [isSavingMemo, setIsSavingMemo] = useState(false)
  const [editableFieldsConfig, setEditableFieldsConfig] = useState<MyPageEditableFieldsSettings>([
    ...DEFAULT_MY_PAGE_EDITABLE_FIELDS,
  ])

  useEffect(() => {
    const unsubscribeStrategy = subscribeStrategyData(setStrategyProjects)
    const unsubscribeFa = subscribeFaData(setFaProjects)
    const unsubscribeEditableFields = subscribeMyPageEditableFields(setEditableFieldsConfig)
    return () => {
      unsubscribeStrategy()
      unsubscribeFa()
      unsubscribeEditableFields()
    }
  }, [])

  useEffect(() => {
    if (!user?.email) return
    const unsubscribe = subscribeCurrentUserProfile(user.email, (profile) => {
      setAliases(profile?.taskAliases?.length ? profile.taskAliases : buildAliasCandidates(user.email, user.displayName))
      setTaskPreferences(profile?.myPageTaskPreferences || {})
      setPersonalTasks((profile?.myPagePersonalTasks || []).slice().sort((a, b) => a.order - b.order))
      setMyMemo(profile?.myPageMemo || "")
      setCollapsedProjectGroups(profile?.myPageCollapsedProjectGroups || {})
    })
    return () => unsubscribe()
  }, [user])

  const groupedProjects = useMemo<GroupedProject[]>(() => {
    const toGrouped = (projects: Project[], departmentPage: GroupedProject["departmentPage"]) =>
      projects
        .map((project) => ({
          id: `${departmentPage}-${project.id}`,
          departmentPage,
          name: project.name,
          type: project.type,
          tasks: collectProjectTaskItems(
            project.tasks,
            { departmentPage, projectName: project.name, projectType: project.type },
            `${departmentPage}-${project.id}`,
            aliases,
          ),
        }))
        .filter((project) => project.tasks.length > 0)

    return [...toGrouped(strategyProjects, "전략사업부"), ...toGrouped(faProjects, "FA 사업부")]
  }, [aliases, strategyProjects, faProjects, taskPreferences])

  const currentUserEmail = (user?.email || "").trim().toLowerCase()
  const strategyPmProjectIds = useMemo(
    () =>
      new Set(
        strategyProjects
          .filter((project) => (project.pmEmail || "").trim().toLowerCase() === currentUserEmail)
          .map((project) => project.id),
      ),
    [currentUserEmail, strategyProjects],
  )
  const faPmProjectIds = useMemo(
    () =>
      new Set(
        faProjects
          .filter((project) => (project.pmEmail || "").trim().toLowerCase() === currentUserEmail)
          .map((project) => project.id),
      ),
    [currentUserEmail, faProjects],
  )
  const canViewAllRecentChanges = isAdmin || pagePermissions.recentChangesWidget
  const canViewRecentChanges =
    canViewAllRecentChanges || strategyPmProjectIds.size > 0 || faPmProjectIds.size > 0

  const loadVisibleRecentChanges = async (): Promise<RecentChangeEntry[]> => {
    const [strategyEntries, faEntries] = await Promise.all([
      fetchStrategyHistoryEntries(30),
      fetchFaHistoryEntries(30),
    ])

    const filterByPm = (entry: RecentChangeEntry, pmProjectIds: Set<string>) => {
      if (entry.projectId && pmProjectIds.has(entry.projectId)) return true
      if (entry.entityType === "project" && entry.entityId && pmProjectIds.has(entry.entityId)) return true
      return false
    }

    const visibleStrategy = canViewAllRecentChanges
      ? strategyEntries
      : strategyEntries.filter((entry) => filterByPm(entry, strategyPmProjectIds))
    const visibleFa = canViewAllRecentChanges
      ? faEntries
      : faEntries.filter((entry) => filterByPm(entry, faPmProjectIds))

    return [
      ...visibleStrategy.map((entry) => ({
        ...entry,
        id: `strategy:${entry.id}`,
        source: entry.source || "work-management",
      })),
      ...visibleFa.map((entry) => ({
        ...entry,
        id: `fa:${entry.id}`,
        source: entry.source || "fa-work-management",
      })),
    ]
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, 30)
  }

  const rollbackVisibleRecentChange = async (entry: RecentChangeEntry) => {
    if (!canViewAllRecentChanges) return
    if (entry.id.startsWith("fa:")) {
      const rawId = entry.id.replace(/^fa:/, "")
      await rollbackFaHistoryEntry({ ...entry, id: rawId } as never)
      await deleteFaHistoryEntry(rawId)
      return
    }

    const rawId = entry.id.replace(/^strategy:/, "")
    await rollbackStrategyHistoryEntry({ ...entry, id: rawId } as never)
    await deleteStrategyHistoryEntry(rawId)
  }

  const allProjectTasks = useMemo<ProjectTaskItem[]>(() => {
    return groupedProjects.flatMap((project) => project.tasks)
  }, [groupedProjects])
  const projectTasks = useMemo(
    () => allProjectTasks.filter((item) => !(taskPreferences[item.key] || DEFAULT_TASK_PREFERENCE).deleted),
    [allProjectTasks, taskPreferences],
  )
  const hiddenProjectTasks = useMemo(
    () => allProjectTasks.filter((item) => (taskPreferences[item.key] || DEFAULT_TASK_PREFERENCE).deleted),
    [allProjectTasks, taskPreferences],
  )
  const projectStatusCounts = useMemo(
    () => {
      const counts = Object.fromEntries(PROJECT_STATUS_FILTERS.map((status) => [status, 0])) as Record<ProjectStatusFilter, number>
      projectTasks.forEach((item) => {
        if (!isProjectStatusFilter(item.task.status)) return
        counts[item.task.status] += 1
      })
      return counts
    },
    [projectTasks],
  )
  const visibleProjectTasks = useMemo(
    () =>
      projectTasks.filter((item) => !selectedProjectStatus || item.task.status === selectedProjectStatus),
    [projectTasks, selectedProjectStatus],
  )
  const filteredHiddenProjectTasks = useMemo(
    () =>
      hiddenProjectTasks.filter((item) => !selectedProjectStatus || item.task.status === selectedProjectStatus),
    [hiddenProjectTasks, selectedProjectStatus],
  )
  const todayProjectTasks = useMemo(
    () =>
      projectTasks
        .filter((item) => isTaskInToday(item.task))
        .sort((a, b) => {
          const statusA = a.task.status === "완료" ? 1 : 0
          const statusB = b.task.status === "완료" ? 1 : 0
          if (statusA !== statusB) return statusA - statusB
          const startDiff = parseDateLabel(a.task.startDate) - parseDateLabel(b.task.startDate)
          if (startDiff !== 0) return startDiff
          return a.task.task.localeCompare(b.task.task, "ko")
        }),
    [projectTasks],
  )
  const activeTodayProjectTasks = useMemo(
    () => todayProjectTasks.filter((item) => item.task.status !== "완료" && !checkedTodayTaskKeys.includes(item.key)),
    [checkedTodayTaskKeys, todayProjectTasks],
  )
  const completedTodayProjectTasks = useMemo(
    () => todayProjectTasks.filter((item) => item.task.status === "완료" || checkedTodayTaskKeys.includes(item.key)),
    [checkedTodayTaskKeys, todayProjectTasks],
  )
  const groupTasksByProject = (items: ProjectTaskItem[]) =>
    Object.values(
      items.reduce(
        (acc, item) => {
          const key = `${item.departmentPage}::${item.projectName}`
          if (!acc[key]) {
            acc[key] = {
              key,
              departmentPage: item.departmentPage,
              projectName: item.projectName,
              projectType: item.projectType,
              items: [] as ProjectTaskItem[],
            }
          }
          acc[key].items.push(item)
          return acc
        },
        {} as Record<string, { key: string; departmentPage: string; projectName: string; projectType: string; items: ProjectTaskItem[] }>,
      ),
    )
  const visibleProjectTaskGroups = useMemo(() => groupTasksByProject(visibleProjectTasks), [visibleProjectTasks])
  const hiddenProjectTaskGroups = useMemo(() => groupTasksByProject(filteredHiddenProjectTasks), [filteredHiddenProjectTasks])

  const orderedPersonalTasks = useMemo(() => personalTasks.slice().sort((a, b) => a.order - b.order), [personalTasks])
  const activePersonalTasks = useMemo(() => orderedPersonalTasks.filter((task) => !task.checked), [orderedPersonalTasks])
  const completedPersonalTasks = useMemo(() => orderedPersonalTasks.filter((task) => task.checked), [orderedPersonalTasks])

  const savePreferences = async (next: Record<string, MyPageTaskPreference>) => {
    setTaskPreferences(next)
    if (!user?.email) return
    try {
      await saveMyPageTaskPreferences(user.email, next)
    } catch {
      toast.error("프로젝트 업무 설정 저장에 실패했습니다.")
    }
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

  const toggleProjectStatusFilter = (status: ProjectStatusFilter) => {
    setSelectedProjectStatus((prev) => (prev === status ? null : status))
  }

  const reorderProject = (dragged: string, target: string, position: "before" | "after" = "before") => {
    if (dragged === target) return
    const remaining = projectTasks.filter((item) => item.key !== dragged)
    const targetIndex = remaining.findIndex((item) => item.key === target)
    if (targetIndex < 0) return
    const draggedItem = projectTasks.find((item) => item.key === dragged)
    if (!draggedItem) return
    const insertIndex = position === "before" ? targetIndex : targetIndex + 1
    const next = [...remaining]
    next.splice(insertIndex, 0, draggedItem)
    const prefs = { ...taskPreferences }
    next.forEach((item, i) => {
      prefs[item.key] = { ...(prefs[item.key] || DEFAULT_TASK_PREFERENCE), order: i }
    })
    void savePreferences(prefs)
  }

  const updateProjectPref = (taskKey: string, updates: Partial<MyPageTaskPreference>) =>
    void savePreferences({ ...taskPreferences, [taskKey]: { ...(taskPreferences[taskKey] || DEFAULT_TASK_PREFERENCE), ...updates } })

  const handleProjectTaskEdit = async (
    item: ProjectTaskItem,
    updatedTask: Task,
  ) => {
    if (!user?.email) {
      toast.error("로그인 정보를 확인할 수 없습니다.")
      return
    }
    if (!isUserOwnerOfTask(item.task, aliases)) {
      toast.error("본인 담당 업무만 수정할 수 있습니다.")
      return
    }

    const allowedFieldSet = new Set(editableFieldsConfig)
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

    const isFa = item.departmentPage === "FA 사업부"
    const updateFn = isFa ? updateFaTaskInDB : updateStrategyTaskInDB
    const recordFn = isFa ? addFaHistoryEntry : addStrategyHistoryEntry

    try {
      await updateFn(item.task.id, allowedUpdates)
      const merged: Task = { ...item.task, ...allowedUpdates }
      try {
        await recordFn({
          entityType: "task",
          action: "update",
          entityId: item.task.id,
          projectId: item.task.projectId,
          before: serializeTaskForHistory(item.task),
          after: serializeTaskForHistory(merged),
          actorEmail: user.email,
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

  const hideProjectTask = (taskKey: string) => {
    const next = { ...taskPreferences }
    next[taskKey] = {
      ...(next[taskKey] || DEFAULT_TASK_PREFERENCE),
      deleted: true,
    }
    void savePreferences(next)
  }

  const showProjectTask = (taskKey: string) => {
    const next = { ...taskPreferences }
    next[taskKey] = {
      ...(next[taskKey] || DEFAULT_TASK_PREFERENCE),
      deleted: false,
    }
    void savePreferences(next)
  }

  const addPersonal = () => {
    const title = draftTitle.trim()
    if (!title) return
    const now = Date.now()
    const next: MyPagePersonalTask = {
      id: `personal-${now}`,
      title,
      memo: draftMemo.trim() || undefined,
      startDate: draftStartDate || undefined,
      endDate: draftEndDate || draftStartDate || undefined,
      checked: false,
      priority: "medium",
      important: false,
      order: personalTasks.length,
      createdAt: now,
      updatedAt: now,
    }
    setDraftTitle("")
    setDraftMemo("")
    setDraftStartDate("")
    setDraftEndDate("")
    void savePersonal([...personalTasks, next])
  }

  const updatePersonal = (id: string, updates: Partial<MyPagePersonalTask>) =>
    void savePersonal(personalTasks.map((task) => (task.id === id ? { ...task, ...updates, updatedAt: Date.now() } : task)))

  const removePersonal = (id: string) => {
    setExpandedPersonalMemoIds((prev) => prev.filter((memoId) => memoId !== id))
    void savePersonal(personalTasks.filter((task) => task.id !== id).map((task, i) => ({ ...task, order: i })))
  }

  const togglePersonalMemo = (id: string) => {
    setExpandedPersonalMemoIds((prev) => (prev.includes(id) ? prev.filter((memoId) => memoId !== id) : [...prev, id]))
  }

  const reorderPersonal = (dragged: string, target: string, position: "before" | "after" = "before") => {
    if (dragged === target) return
    const remaining = orderedPersonalTasks.filter((task) => task.id !== dragged)
    const targetIndex = remaining.findIndex((task) => task.id === target)
    if (targetIndex < 0) return
    const draggedTask = orderedPersonalTasks.find((task) => task.id === dragged)
    if (!draggedTask) return
    const insertIndex = position === "before" ? targetIndex : targetIndex + 1
    const next = [...remaining]
    next.splice(insertIndex, 0, draggedTask)
    void savePersonal(next.map((task, i) => ({ ...task, order: i, updatedAt: Date.now() })))
  }

  const submitEdit = () => {
    if (!editingId || !editingTitle.trim()) return
    updatePersonal(editingId, {
      title: editingTitle.trim(),
      memo: editingMemo.trim() || undefined,
      startDate: editingStartDate || undefined,
      endDate: editingEndDate || editingStartDate || undefined,
    })
    setEditingId(null)
    setEditingTitle("")
    setEditingMemo("")
    setEditingStartDate("")
    setEditingEndDate("")
  }

  const logout = async () => {
    try {
      await signOut(auth)
      toast.success("로그아웃 되었습니다.")
    } catch {
      toast.error("로그아웃에 실패했습니다.")
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

  const toggleProjectGroupCollapsed = (groupKey: string) => {
    setCollapsedProjectGroups((prev) => {
      const next = { ...prev, [groupKey]: !prev[groupKey] }
      if (user?.email) {
        void saveMyPageCollapsedProjectGroups(user.email, next)
      }
      return next
    })
  }

  const togglePanel = (panel: MyPagePanel) => {
    const expanding = !expandedPanels.includes(panel)
    if (panel === "today") {
      setIsTodayActiveCollapsed(!expanding)
      setIsTodayCompletedCollapsed(!expanding)
    }
    if (panel === "project") {
      setIsProjectActiveCollapsed(!expanding)
      setIsProjectHiddenCollapsed(!expanding)
      if (expanding) {
        setCollapsedProjectGroups({})
      }
    }
    if (panel === "personal") {
      setIsPersonalActiveCollapsed(!expanding)
      setIsPersonalCompletedCollapsed(!expanding)
    }
    setExpandedPanels((prev) => (expanding ? [...prev, panel] : prev.filter((item) => item !== panel)))
  }

  const isPanelExpanded = (panel: MyPagePanel) => expandedPanels.includes(panel)

  const panelCardClass = (panel: MyPagePanel, orderClass: string) =>
    cn(
      "flex min-h-0 flex-col transition-[height,min-height,box-shadow] duration-300 ease-out",
      isPanelExpanded(panel)
        ? "h-auto overflow-visible shadow-xl ring-1 ring-sky-200"
        : "h-[260px] overflow-hidden",
      orderClass,
    )

  const renderPanelToggleButton = (panel: MyPagePanel) => {
    const expanded = isPanelExpanded(panel)
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => togglePanel(panel)} className="shrink-0">
        <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        {expanded ? "접기" : "펼치기"}
      </Button>
    )
  }

  const renderProjectTaskCard = (item: ProjectTaskItem, options?: { hiddenList?: boolean }) => {
    const pref = taskPreferences[item.key] || DEFAULT_TASK_PREFERENCE
    const important = pref.important || item.task.category === "중요"
    const isCompleted = item.task.status === "완료"
    const hiddenList = Boolean(options?.hiddenList)
    const isHidden = Boolean(pref.deleted)
    return (
      <div
        key={item.key}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = "move"
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
          const position: "before" | "after" = e.clientY < rect.top + rect.height / 2 ? "before" : "after"
          if (!projectDropIndicator || projectDropIndicator.key !== item.key || projectDropIndicator.position !== position) {
            setProjectDropIndicator({ key: item.key, position })
          }
        }}
        onDragLeave={() => {
          if (projectDropIndicator?.key === item.key) setProjectDropIndicator(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          const droppedKey = draggedProjectKey || e.dataTransfer.getData(PROJECT_TASK_DND_MIME) || ""
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
          const position: "before" | "after" =
            projectDropIndicator?.key === item.key
              ? projectDropIndicator.position
              : e.clientY < rect.top + rect.height / 2
                ? "before"
                : "after"
          if (droppedKey) reorderProject(droppedKey, item.key, position)
          setDraggedProjectKey(null)
          setProjectDropIndicator(null)
        }}
        className={cn(
          "relative rounded-xl border px-2.5 py-2 transition-colors",
          important ? "border-red-300 bg-red-50/60" : "border-slate-200 bg-white",
          draggedProjectKey === item.key && "opacity-65 ring-1 ring-slate-300",
        )}
        style={{ marginLeft: `${Math.min(item.depth, 4) * 14}px` }}
      >
        {projectDropIndicator?.key === item.key && (
          <div
            className={cn(
              "pointer-events-none absolute left-0 right-0 z-20 h-0.5 bg-sky-500",
              projectDropIndicator.position === "before" ? "top-0" : "bottom-0",
            )}
          />
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              setDraggedProjectKey(item.key)
              e.dataTransfer.effectAllowed = "move"
              e.dataTransfer.setData(PROJECT_TASK_DND_MIME, item.key)
            }}
            onDragEnd={() => {
              setDraggedProjectKey(null)
              setProjectDropIndicator(null)
            }}
            className="inline-flex h-5 w-5 cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
            aria-label="업무 순서 이동"
            title="드래그로 순서 이동"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <Badge variant="outline">{item.departmentPage}</Badge>
          <ProjectTypeBadge type={item.projectType} />
          <CategoryBadge category={item.task.category} />
          <StatusBadge status={item.task.status} />
          {isHidden ? <Badge variant="secondary">숨김</Badge> : null}
          <div className="ml-auto flex items-center gap-1">
            {(["high", "medium", "low"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => updateProjectPref(item.key, { priority: p })}
                className={cn("rounded-full px-2 py-0.5 text-[11px]", pref.priority === p ? priorityMeta[p].className : "bg-slate-100 text-slate-500")}
              >
                {priorityMeta[p].label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => updateProjectPref(item.key, { important: !pref.important })}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                important ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500",
              )}
            >
              <Star className={cn("h-3 w-3", important && "fill-current")} />중요
            </button>
            {editableFieldsConfig.length > 0 && (
              <EditTaskDialog
                task={item.task}
                onEditTask={(updated) => void handleProjectTaskEdit(item, updated)}
                defaultDepartment={item.task.department || (item.departmentPage === "FA 사업부" ? "FA" : "전략")}
                editableFields={editableFieldsConfig}
                trigger={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-700 hover:bg-sky-200"
                    title="업무 수정 (관리자가 허용한 항목만 편집 가능)"
                  >
                    <Pencil className="h-3 w-3" />수정
                  </button>
                }
              />
            )}
            {hiddenList ? (
              <button
                type="button"
                onClick={() => showProjectTask(item.key)}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-200"
                title="숨김 해제"
              >
                <Eye className="h-3 w-3" />
                보이기
              </button>
            ) : (
              <button
                type="button"
                onClick={() => hideProjectTask(item.key)}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200"
                title="마이 워크에서 숨기기"
              >
                <EyeOff className="h-3 w-3" />
                숨김
              </button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-start justify-between gap-2">
          <p className={cn("text-sm font-semibold leading-5", isCompleted && "line-through")}>{item.task.task}</p>
          <p className="shrink-0 text-[11px] text-slate-500">
            상위업무: {item.ancestorNames.length > 0 ? item.ancestorNames.join(" > ") : "없음 (최상위)"}
          </p>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatDateWithYear(item.task.startDate)}</span>
          <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatDateWithYear(item.task.endDate)}</span>
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" />
            {item.task.person || "-"}
          </span>
        </div>
      </div>
    )
  }

  const renderTodayTaskRow = (item: ProjectTaskItem) => {
    const isChecked = checkedTodayTaskKeys.includes(item.key)
    const isCompleted = item.task.status === "완료" || isChecked

    return (
      <div key={item.key} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCheckedTodayTaskKeys((prev) =>
                prev.includes(item.key) ? prev.filter((key) => key !== item.key) : [...prev, item.key],
              )
            }}
            className={cn(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-2 transition-colors",
              isCompleted
                ? "border-emerald-600 bg-emerald-600 text-white shadow-[0_0_0_2px_rgba(16,185,129,0.2)]"
                : "border-slate-300 bg-white text-transparent hover:border-slate-400",
            )}
            title={isCompleted ? "오늘 업무 체크 해제" : "오늘 업무 체크"}
          >
            <CheckCircle2 className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className={cn("truncate text-sm font-semibold text-slate-800", isCompleted && "line-through")}>
                {item.task.task}
              </p>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <Badge variant="outline">{item.departmentPage}</Badge>
              <span className="truncate">{item.projectName}</span>
              <span>{formatDateWithYear(item.task.startDate)} ~ {formatDateWithYear(item.task.endDate)}</span>
            </div>
          </div>
          {item.task.completionPhoto?.url ? (
            <a
              href={item.task.completionPhoto.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              사진
            </a>
          ) : null}
        </div>
      </div>
    )
  }

  const renderPersonalTaskCard = (task: MyPagePersonalTask) => {
	    const hasMemo = Boolean(task.memo)
	    const isMemoExpanded = expandedPersonalMemoIds.includes(task.id)
    const hasSchedule = Boolean(task.startDate || task.endDate)

    return (
    <div
      key={task.id}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        const position: "before" | "after" = e.clientY < rect.top + rect.height / 2 ? "before" : "after"
        if (!personalDropIndicator || personalDropIndicator.id !== task.id || personalDropIndicator.position !== position) {
          setPersonalDropIndicator({ id: task.id, position })
        }
      }}
      onDragLeave={() => {
        if (personalDropIndicator?.id === task.id) setPersonalDropIndicator(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const droppedId = draggedPersonalId || e.dataTransfer.getData(PERSONAL_TASK_DND_MIME) || ""
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        const position: "before" | "after" =
          personalDropIndicator?.id === task.id
            ? personalDropIndicator.position
            : e.clientY < rect.top + rect.height / 2
              ? "before"
              : "after"
        if (droppedId) reorderPersonal(droppedId, task.id, position)
        setDraggedPersonalId(null)
        setPersonalDropIndicator(null)
      }}
      className={cn(
        "relative rounded-xl border p-3 transition-colors",
        task.important ? "border-red-300 bg-red-50/60" : "border-slate-200 bg-white",
        draggedPersonalId === task.id && "opacity-65 ring-1 ring-slate-300",
      )}
    >
      {personalDropIndicator?.id === task.id && (
        <div
          className={cn(
            "pointer-events-none absolute left-0 right-0 z-20 h-0.5 bg-sky-500",
            personalDropIndicator.position === "before" ? "top-0" : "bottom-0",
          )}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            setDraggedPersonalId(task.id)
            e.dataTransfer.effectAllowed = "move"
            e.dataTransfer.setData(PERSONAL_TASK_DND_MIME, task.id)
          }}
          onDragEnd={() => {
            setDraggedPersonalId(null)
            setPersonalDropIndicator(null)
          }}
          className="inline-flex h-5 w-5 cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
          aria-label="개인 업무 순서 이동"
          title="드래그로 순서 이동"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => updatePersonal(task.id, { checked: !task.checked })}
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded-sm border-2 transition-colors",
            task.checked
              ? "border-emerald-600 bg-emerald-600 text-white shadow-[0_0_0_2px_rgba(16,185,129,0.2)]"
              : "border-slate-300 bg-white text-transparent hover:border-slate-400",
          )}
          aria-label={task.checked ? "완료 해제" : "완료 처리"}
          title={task.checked ? "완료 해제" : "완료 처리"}
        >
          <CheckCircle2 className="h-4 w-4" />
        </button>
	        <p className={cn("flex-1 font-semibold", task.checked && "line-through")}>{task.title}</p>
        {hasSchedule ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
            <Calendar className="h-3.5 w-3.5" />
            {task.startDate || "-"} ~ {task.endDate || task.startDate || "-"}
          </span>
        ) : null}
	        {hasMemo ? (
          <button
            type="button"
            onClick={() => togglePersonalMemo(task.id)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs font-semibold transition-colors",
              isMemoExpanded
                ? "border-amber-400 bg-amber-100 text-amber-800"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100",
            )}
            aria-label={isMemoExpanded ? "메모 접기" : "메모 보기"}
            title={isMemoExpanded ? "메모 접기" : "메모 보기"}
          >
            <MessageSquareText className="h-3.5 w-3.5" />
            메모
          </button>
        ) : null}
      </div>
      {hasMemo && isMemoExpanded ? (
        <div className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          {task.memo}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {(["high", "medium", "low"] as const).map((p) => (
          <button key={p} type="button" onClick={() => updatePersonal(task.id, { priority: p })} className={cn("rounded-full px-3 py-1 text-xs", task.priority === p ? priorityMeta[p].className : "bg-slate-100 text-slate-500")}>
            {priorityMeta[p].label}
          </button>
        ))}
        <button type="button" onClick={() => updatePersonal(task.id, { important: !task.important })} className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs", task.important ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500")}>
          <Star className={cn("h-3.5 w-3.5", task.important && "fill-current")} />중요
        </button>
	        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setEditingId(task.id)
            setEditingTitle(task.title)
            setEditingMemo(task.memo || "")
            setEditingStartDate(task.startDate || "")
            setEditingEndDate(task.endDate || task.startDate || "")
          }}
        >
	          <Pencil className="h-3.5 w-3.5" />수정
	        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => removePersonal(task.id)}>
          <Trash2 className="h-3.5 w-3.5" />삭제
        </Button>
      </div>
      {editingId === task.id ? (
	        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
	          <Input value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} />
	          <Textarea value={editingMemo} onChange={(e) => setEditingMemo(e.target.value)} rows={3} />
          <div className="grid gap-2 sm:grid-cols-[auto_1fr_1fr] sm:items-center">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
              <Calendar className="h-3.5 w-3.5" />
              일정
            </span>
            <Input type="date" value={editingStartDate} onChange={(e) => setEditingStartDate(e.target.value)} aria-label="개인 업무 시작일" />
            <Input type="date" value={editingEndDate} onChange={(e) => setEditingEndDate(e.target.value)} aria-label="개인 업무 종료일" />
          </div>
	          <div className="flex justify-end gap-2">
	            <Button type="button" variant="outline" size="sm" onClick={() => { setEditingId(null); setEditingStartDate(""); setEditingEndDate("") }}>취소</Button>
	            <Button type="button" size="sm" onClick={submitEdit}>저장</Button>
	          </div>
        </div>
      ) : null}
    </div>
    )
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(180deg,#f8fbff_0%,#f5f7fb_55%,#ffffff_100%)] px-3 py-6 lg:px-6">
      <div className="mx-auto w-full max-w-none space-y-4">
        <header className="flex flex-col gap-3 rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur lg:flex-row lg:items-center">
          <div>
            <p className="text-xl font-extrabold uppercase tracking-[0.12em] text-sky-600">WORKHUB</p>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">마이 워크</h1>
            <p className="mt-2 text-sm text-slate-600">프로젝트 연동 업무와 개인 업무를 분리했습니다.</p>
          </div>
          <div className="flex flex-wrap gap-1.5 lg:ml-5">
            <Button asChild variant="outline"><Link href="/"><Home className="h-4 w-4" />메인</Link></Button>
            <Button type="button" variant="outline" onClick={logout}><LogOut className="h-4 w-4" />로그아웃</Button>
          </div>
          <Image
            src="/placeholder-logo.png"
            alt="WorkHub 로고"
            width={180}
            height={52}
            className="h-12 w-auto object-contain lg:ml-auto"
            priority
          />
        </header>

        {canViewRecentChanges && (
          <section id="recent-changes" className="scroll-mt-6">
            <RecentChangesWidget
              loadEntries={loadVisibleRecentChanges}
              rollbackEntry={canViewAllRecentChanges ? rollbackVisibleRecentChange : undefined}
              projects={[...strategyProjects, ...faProjects]}
              currentUserEmail={user?.email || undefined}
              title="최근 사용자 변경"
              description="권한이 있는 프로젝트의 최근 업무 수정 이력을 확인합니다."
              emptyMessage="확인할 최근 사용자 변경이 없습니다."
            />
          </section>
        )}

	        <section className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
	            <Card className={panelCardClass("today", "lg:order-1")}>
	              <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
		                  <CardTitle>오늘의 업무</CardTitle>
		                  <CardDescription>오늘 처리해야 할 프로젝트 업무를 체크리스트로 확인합니다.</CardDescription>
                    </div>
                    {renderPanelToggleButton("today")}
                  </div>
	              </CardHeader>
	              <CardContent className="min-h-0 flex-1">
	                {todayProjectTasks.length === 0 ? (
	                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
	                    오늘 처리할 프로젝트 업무가 없습니다.
	                  </div>
	                ) : (
	                  <div className="space-y-4">
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => setIsTodayActiveCollapsed((prev) => !prev)}
                          className="flex items-center gap-1 text-xs font-semibold text-slate-500"
                        >
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isTodayActiveCollapsed && "-rotate-90")} />
                          진행 업무 ({activeTodayProjectTasks.length})
                        </button>
                        {!isTodayActiveCollapsed && (
                          activeTodayProjectTasks.length > 0 ? (
                            <div className="space-y-2">{activeTodayProjectTasks.map(renderTodayTaskRow)}</div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">진행 중인 오늘의 업무가 없습니다.</div>
                          )
                        )}
                      </div>
                      <div className="border-t border-dashed border-slate-300 pt-3">
                        <button
                          type="button"
                          onClick={() => setIsTodayCompletedCollapsed((prev) => !prev)}
                          className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-500"
                        >
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isTodayCompletedCollapsed && "-rotate-90")} />
                          완료 업무 ({completedTodayProjectTasks.length})
                        </button>
                        {!isTodayCompletedCollapsed && (
                          completedTodayProjectTasks.length > 0 ? (
                            <div className="space-y-2">{completedTodayProjectTasks.map(renderTodayTaskRow)}</div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">완료된 오늘의 업무가 없습니다.</div>
                          )
                        )}
                      </div>
	                  </div>
	                )}
	              </CardContent>
	            </Card>

	          <Card className={panelCardClass("project", "lg:order-3")}>
            <CardHeader className="pb-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>프로젝트 연동 업무</CardTitle>
                  <CardDescription>스케줄 상태에 따라 진행/완료가 분리되며 드래그앤드롭으로 우선순서를 조정합니다.</CardDescription>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {PROJECT_STATUS_FILTERS.map((status) => {
                      const isSelected = selectedProjectStatus === status
                      const meta = projectStatusFilterMeta[status]
                      return (
                        <button
                          key={status}
                          type="button"
                          onClick={() => toggleProjectStatusFilter(status)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                            isSelected ? meta.activeClassName : meta.className,
                          )}
                          aria-pressed={isSelected}
                        >
                          {status}
                          <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", isSelected ? "bg-white/20" : "bg-white/80")}>
                            {projectStatusCounts[status] || 0}
                          </span>
                        </button>
                      )
                    })}
                  </div>
	                </div>
	                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
	                    {renderPanelToggleButton("project")}
	                  </div>
	              </div>
	            </CardHeader>
	              <CardContent className="min-h-0 flex-1 pt-0">
	                {projectTasks.length === 0 && hiddenProjectTasks.length === 0 ? (
	                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
	                    <UserRoundSearch className="mx-auto mb-2 h-6 w-6" />연동된 업무가 없습니다.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => setIsProjectActiveCollapsed((prev) => !prev)}
                        className="flex items-center gap-1 text-xs font-semibold text-slate-500"
                      >
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isProjectActiveCollapsed && "-rotate-90")} />
                        {selectedProjectStatus ? `${selectedProjectStatus} 업무` : "전체 업무"} ({visibleProjectTasks.length})
                      </button>
                      {!isProjectActiveCollapsed &&
                        visibleProjectTaskGroups.map((group) => (
                          <div key={`active-${group.key}`} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/40 p-2">
                            <button
                              type="button"
                              onClick={() => toggleProjectGroupCollapsed(`active-${group.key}`)}
                              className="flex w-full items-center justify-between gap-2 text-left"
                            >
                              <div className="flex items-center gap-2">
                                <ChevronDown
                                  className={cn(
                                    "h-3.5 w-3.5 text-slate-500 transition-transform",
                                    collapsedProjectGroups[`active-${group.key}`] && "-rotate-90",
                                  )}
                                />
                                <Badge variant="outline">{group.departmentPage}</Badge>
                                <ProjectTypeBadge type={group.projectType} />
                                <span className="text-base font-bold text-slate-800">{group.projectName}</span>
                              </div>
                            </button>
                            {!collapsedProjectGroups[`active-${group.key}`] ? (
                              <div className="space-y-2">{group.items.map((item) => renderProjectTaskCard(item))}</div>
                            ) : null}
                          </div>
                        ))}
                    </div>
                    <div className="border-t border-dashed border-slate-300 pt-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setIsProjectHiddenCollapsed((prev) => !prev)}
                          className="flex items-center gap-1 text-xs font-semibold text-slate-500"
                          aria-label={isProjectHiddenCollapsed ? "숨긴 업무 펼치기" : "숨긴 업무 접기"}
                        >
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isProjectHiddenCollapsed && "-rotate-90")} />
                          숨긴 업무 ({selectedProjectStatus ? `${filteredHiddenProjectTasks.length}/${hiddenProjectTasks.length}` : hiddenProjectTasks.length})
                        </button>
                      </div>
                      {!isProjectHiddenCollapsed && (
                        <div className="space-y-2">
                          {filteredHiddenProjectTasks.length > 0 ? hiddenProjectTaskGroups.map((group) => (
                            <div key={`hidden-${group.key}`} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/40 p-2">
                              <button
                                type="button"
                                onClick={() => toggleProjectGroupCollapsed(`hidden-${group.key}`)}
                                className="flex w-full items-center justify-between gap-2 text-left"
                              >
                                <div className="flex items-center gap-2">
                                  <ChevronDown
                                    className={cn(
                                      "h-3.5 w-3.5 text-slate-500 transition-transform",
                                      collapsedProjectGroups[`hidden-${group.key}`] && "-rotate-90",
                                    )}
                                  />
                                  <EyeOff className="h-3.5 w-3.5 text-slate-500" />
                                  <Badge variant="outline">{group.departmentPage}</Badge>
                                  <ProjectTypeBadge type={group.projectType} />
                                  <span className="text-base font-bold text-slate-800">{group.projectName}</span>
                                </div>
                              </button>
                              {!collapsedProjectGroups[`hidden-${group.key}`] ? (
                                <div className="space-y-2">{group.items.map((item) => renderProjectTaskCard(item, { hiddenList: true }))}</div>
                              ) : null}
                            </div>
                          )) : (
                            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                              {selectedProjectStatus ? `${selectedProjectStatus} 상태의 숨김 업무가 없습니다.` : "숨김 처리된 업무가 없습니다."}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
	                  </div>
	                )}
	              </CardContent>
		          </Card>

					            <Card className={panelCardClass("personal", "lg:order-2")}>
		              <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
		                <CardTitle>개인 업무</CardTitle>
		                <CardDescription>완료/미완료가 분리되며 개별 작성/수정/삭제가 가능합니다.</CardDescription>
                      </div>
                      {renderPanelToggleButton("personal")}
                    </div>
		              </CardHeader>
		              <CardContent className="min-h-0 flex-1 space-y-3">
                <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto] md:items-start">
	                  <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="업무 제목" />
	                  <Textarea
                    value={draftMemo}
                    onChange={(e) => setDraftMemo(e.target.value)}
                    placeholder="메모 (선택)"
                    rows={1}
                    className="h-9 min-h-9 resize-y py-1"
	                  />
	                  <Button type="button" onClick={addPersonal}><Plus className="h-4 w-4" />추가</Button>
	                </div>
                <div className="grid gap-2 sm:grid-cols-[auto_1fr_1fr] sm:items-center">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                    <Calendar className="h-3.5 w-3.5" />
                    일정
                  </span>
                  <Input type="date" value={draftStartDate} onChange={(e) => setDraftStartDate(e.target.value)} aria-label="개인 업무 시작일" />
                  <Input type="date" value={draftEndDate} onChange={(e) => setDraftEndDate(e.target.value)} aria-label="개인 업무 종료일" />
                </div>

                {personalTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">등록된 개인 업무가 없습니다.</div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setIsPersonalActiveCollapsed((prev) => !prev)}
                        className="flex items-center gap-1 text-xs font-semibold text-slate-500"
                      >
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isPersonalActiveCollapsed && "-rotate-90")} />
                        진행 업무 ({activePersonalTasks.length})
                      </button>
                      {!isPersonalActiveCollapsed && activePersonalTasks.map(renderPersonalTaskCard)}
                    </div>
                    <div className="border-t border-dashed border-slate-300 pt-3">
                      <button
                        type="button"
                        onClick={() => setIsPersonalCompletedCollapsed((prev) => !prev)}
                        className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-500"
                      >
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isPersonalCompletedCollapsed && "-rotate-90")} />
                        완료 업무 ({completedPersonalTasks.length})
                      </button>
                      {!isPersonalCompletedCollapsed && (
                        <div className="space-y-2">
                          {completedPersonalTasks.length > 0 ? completedPersonalTasks.map(renderPersonalTaskCard) : (
                            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">완료된 업무가 없습니다.</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

			            <Card className={panelCardClass("memo", "lg:order-4")}>
		              <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
		                <CardTitle>메모장</CardTitle>
		                <CardDescription>필요한 내용을 자유롭게 입력하고 수정해 저장합니다.</CardDescription>
                      </div>
                      {renderPanelToggleButton("memo")}
                    </div>
		              </CardHeader>
		              <CardContent className="flex min-h-0 flex-1 flex-col space-y-3">
	                <Textarea
	                  value={myMemo}
	                  onChange={(e) => setMyMemo(e.target.value)}
	                  placeholder="메모를 입력하세요"
	                  rows={8}
	                  className="min-h-0 flex-1 resize-none"
	                />
                <div className="flex justify-end">
                  <Button type="button" onClick={() => void saveMemo()} disabled={isSavingMemo}>
                    {isSavingMemo ? "저장 중..." : "메모 저장"}
                  </Button>
                </div>
              </CardContent>
	            </Card>

	        </section>
      </div>
    </main>
  )
}
