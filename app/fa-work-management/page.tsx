"use client"

import Image from "next/image"
import Link from "next/link"
import { useState, useMemo, useEffect, useDeferredValue } from "react"
import { signOut } from "firebase/auth"
import type { Project, ProjectPmOption, Task, TaskStatus } from "@/lib/data"
import { getDepartmentList } from "@/lib/data"
import {
  subscribeToData,
  addProjectToDB,
  updateProjectInDB,
  deleteProjectFromDB,
  addTaskToDB,
  updateTaskInDB,
  deleteTaskFromDB,
  updateProjectOrdersInDB,
  updateTaskOrdersInDB,
  saveDashboardSortBy,
  subscribeDashboardSortBy,
  saveGanttCollapseState,
  subscribeGanttCollapseState,
  saveGanttDetailPanelWidth,
  saveGanttLeftPanelWidth,
  subscribeGanttDetailPanelWidth,
  subscribeGanttLeftPanelWidth,
  addHistoryEntry,
  fetchHistoryEntries,
  rollbackHistoryEntry,
  deleteHistoryEntry,
  type ChangeHistoryEntry,
} from "@/lib/firestore-service-fa"
import {
  saveUserHiddenOwnerOptions,
  subscribeCurrentUserProfile,
  subscribeUserProfiles,
  saveSeenRecentChangeIds,
  subscribeGlobalSchedules,
  type GlobalSchedule,
  type UserProfile,
} from "@/lib/firestore-service"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/components/auth/auth-provider"
import { LoginForm } from "@/components/auth/login-form"
import { StatusSummary } from "@/components/status-summary"
import { FilterBar, ProjectSortType } from "@/components/filter-bar"
import { ProjectList } from "@/components/project-list"
import { GanttView } from "@/components/gantt-view"
import { ProjectCardView } from "@/components/project-card-view"
import { Bell, CalendarDays, Building2, Home, List, BarChart3, LayoutGrid, RotateCcw, History, ChevronDown, ChevronRight, LogOut, UserRoundSearch } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"
import { toast } from "sonner"
import { RecentChangesWidget } from "@/components/recent-changes-widget"

export default function FaWorkManagementPage() {
  const { user, loading: authLoading, isAdmin, pagePermissions } = useAuth()
  const isMobile = useIsMobile()
  const canEdit = isAdmin || pagePermissions.faWorkManagementEdit
  const [projectList, setProjectList] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all")
  const [departmentFilter, setDepartmentFilter] = useState("all")
  const [personFilter, setPersonFilter] = useState("all")
  const [sortBy, setSortBy] = useState<ProjectSortType>("latest")
  const [viewMode, setViewMode] = useState<"list" | "gantt" | "card">("gantt")
  const [historyEntries, setHistoryEntries] = useState<ChangeHistoryEntry[]>([])
  const [visibleHistoryEntries, setVisibleHistoryEntries] = useState<ChangeHistoryEntry[]>([])
  const [isRecentChangesOpen, setIsRecentChangesOpen] = useState(false)
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null)
  const [isRollingBack, setIsRollingBack] = useState(false)
  const [rollingBackEntryId, setRollingBackEntryId] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [ganttCollapsedProjectIds, setGanttCollapsedProjectIds] = useState<string[]>([])
  const [ganttCollapsedTaskIds, setGanttCollapsedTaskIds] = useState<string[]>([])
  const [isGanttCollapseStateReady, setIsGanttCollapseStateReady] = useState(false)
  const [ganttLeftPanelWidth, setGanttLeftPanelWidth] = useState<number | null>(null)
  const [ganttDetailPanelWidth, setGanttDetailPanelWidth] = useState<number | null>(null)
  const [defaultTaskPerson, setDefaultTaskPerson] = useState("")
  const [hiddenOwnerOptions, setHiddenOwnerOptions] = useState<string[]>([])
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([])
  const [seenRecentChangeIds, setSeenRecentChangeIds] = useState<string[]>([])
  const [globalSchedules, setGlobalSchedules] = useState<GlobalSchedule[]>([])
  const deferredSearchQuery = useDeferredValue(searchQuery)

  useEffect(() => {
    if (!user) {
      setProjectList([])
      setLoading(false)
      return
    }

    setLoading(true)
    const unsubscribe = subscribeToData((data) => {
      setProjectList(data)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [user])

  useEffect(() => {
    if (!user) {
      setGlobalSchedules([])
      return
    }
    const unsubscribe = subscribeGlobalSchedules(setGlobalSchedules)
    return () => unsubscribe()
  }, [user])

  useEffect(() => {
    if (!user) {
      setUserProfiles([])
      return
    }
    const unsubscribe = subscribeUserProfiles(setUserProfiles)
    return () => unsubscribe()
  }, [user])

  const loadHistory = async () => {
    try {
      const history = await fetchHistoryEntries(20)
      setHistoryEntries(history)
    } catch (error) {
      console.error("History fetch failed:", error)
    }
  }

  useEffect(() => {
    if (!user) {
      setHistoryEntries([])
      return
    }

    loadHistory()
  }, [user])

  useEffect(() => {
    if (!user) return

    const unsubscribe = subscribeDashboardSortBy((savedSortBy) => {
      setSortBy(savedSortBy)
    })
    return () => unsubscribe()
  }, [user])

  useEffect(() => {
    const email = user?.email || ""
    setGanttCollapsedProjectIds([])
    setGanttCollapsedTaskIds([])
    setIsGanttCollapseStateReady(false)

    if (!email) return

    const unsubscribe = subscribeGanttCollapseState(email, (state) => {
      setGanttCollapsedProjectIds(state.collapsedProjectIds)
      setGanttCollapsedTaskIds(state.collapsedTaskIds)
      setIsGanttCollapseStateReady(true)
    })

    return () => unsubscribe()
  }, [user?.email])

  useEffect(() => {
    const email = user?.email || ""
    setGanttLeftPanelWidth(null)
    setGanttDetailPanelWidth(null)

    if (!email) return

    const unsubscribeLeftPanel = subscribeGanttLeftPanelWidth(email, setGanttLeftPanelWidth)
    const unsubscribeDetailPanel = subscribeGanttDetailPanelWidth(email, setGanttDetailPanelWidth)
    return () => {
      unsubscribeLeftPanel()
      unsubscribeDetailPanel()
    }
  }, [user?.email])

  useEffect(() => {
    if (!user?.email) {
      setDefaultTaskPerson("")
      setHiddenOwnerOptions([])
      setSeenRecentChangeIds([])
      return
    }

    const unsubscribe = subscribeCurrentUserProfile(user.email, (profile) => {
      const accountDefaultPerson = (profile?.taskAliases || [])[0]?.trim() || ""
      setDefaultTaskPerson(accountDefaultPerson)
      setHiddenOwnerOptions(profile?.hiddenOwnerOptions || [])
      setSeenRecentChangeIds(profile?.seenRecentChangeIds || [])
    })

    return () => unsubscribe()
  }, [user])

  const compact = <T extends Record<string, unknown>>(obj: T): T =>
    Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T

  const serializeTaskData = (task: Task) =>
    compact({
      projectId: task.projectId,
      parentId: task.parentId,
      task: task.task,
      memo: task.memo,
      category: task.category,
      department: task.department,
      person: task.person,
      startDate: task.startDate,
      endDate: task.endDate,
      status: task.status,
      manDays: task.manDays,
      isSubTask: task.isSubTask,
      isHidden: task.isHidden,
      depth: task.depth,
      displayOrder: task.displayOrder,
    })

  const serializeProjectData = (project: Project) =>
    compact({
      name: project.name,
      type: project.type,
      period: project.period,
      pmEmail: project.pmEmail,
      isHidden: project.isHidden,
      displayOrder: project.displayOrder,
      createdAt: project.createdAt,
    })

  const flattenTaskRecords = (tasks: Task[]): Array<{ id: string; data: Record<string, unknown> }> =>
    tasks.flatMap((task) => [{ id: task.id, data: serializeTaskData(task) }, ...flattenTaskRecords(task.subTasks || [])])

  const recordHistory = async (entry: Omit<ChangeHistoryEntry, "id" | "createdAt">) => {
    try {
      await addHistoryEntry({
        ...entry,
        actorEmail: entry.actorEmail || user?.email || undefined,
        source: entry.source || "fa-work-management",
      })
      await loadHistory()
    } catch (error) {
      console.error("History write failed:", error)
    }
  }

  const getHistoryLabel = (entry: ChangeHistoryEntry) => {
    if (entry.entityType === "project_bundle") return "프로젝트 삭제"
    if (entry.entityType === "batch") return "업무 이동/정렬"
    if (entry.entityType === "project" && entry.action === "create") return "프로젝트 추가"
    if (entry.entityType === "project" && entry.action === "update") return "프로젝트 수정"
    if (entry.entityType === "project" && entry.action === "delete") return "프로젝트 삭제"
    if (entry.entityType === "task" && entry.action === "create") return "업무 추가"
    if (entry.entityType === "task" && entry.action === "update") return "업무 수정"
    if (entry.entityType === "task" && entry.action === "delete") return "업무 삭제"
    return "변경"
  }

  const handleRollbackLatest = async () => {
    const latest = historyEntries[0]
    if (!latest) {
      toast.info("롤백할 이력이 없습니다.")
      return
    }

    if (!confirm(`최근 변경(${getHistoryLabel(latest)})을 롤백하시겠습니까?`)) return

    setIsRollingBack(true)
    try {
      await rollbackHistoryEntry(latest)
      await deleteHistoryEntry(latest.id)
      await loadHistory()
      toast.success("최근 변경을 롤백했습니다.")
    } catch (error) {
      toast.error("롤백 실패")
    } finally {
      setIsRollingBack(false)
    }
  }

  const handleRollbackEntry = async (entry: ChangeHistoryEntry) => {
    if (!confirm(`선택한 변경(${getHistoryLabel(entry)})을 롤백하시겠습니까?`)) return

    setRollingBackEntryId(entry.id)
    try {
      await rollbackHistoryEntry(entry)
      await deleteHistoryEntry(entry.id)
      await loadHistory()
      toast.success("선택한 변경을 롤백했습니다.")
    } catch (error) {
      toast.error("선택 이력 롤백 실패")
    } finally {
      setRollingBackEntryId(null)
    }
  }

  const flattenTasks = (tasks: Task[]): Task[] => {
    return tasks.reduce((acc, task) => {
      return [...acc, task, ...flattenTasks(task.subTasks || [])]
    }, [] as Task[])
  }

  const insertTaskIntoTree = (tasks: Task[], parentId: string, taskToInsert: Task): Task[] => {
    return tasks.map((task) => {
      if (task.id === parentId) {
        return {
          ...task,
          subTasks: [...(task.subTasks || []), taskToInsert],
        }
      }

      if (task.subTasks && task.subTasks.length > 0) {
        return {
          ...task,
          subTasks: insertTaskIntoTree(task.subTasks, parentId, taskToInsert),
        }
      }

      return task
    })
  }

  const removeTaskFromTree = (tasks: Task[], taskId: string): Task[] => {
    return tasks
      .filter((task) => task.id !== taskId)
      .map((task) => ({
        ...task,
        subTasks: task.subTasks ? removeTaskFromTree(task.subTasks, taskId) : task.subTasks,
      }))
  }

  const replaceTaskIdInTree = (tasks: Task[], fromId: string, toId: string): Task[] => {
    return tasks.map((task) => {
      const nextId = task.id === fromId ? toId : task.id
      const nextParentId = task.parentId === fromId ? toId : task.parentId
      return {
        ...task,
        id: nextId,
        parentId: nextParentId,
        subTasks: task.subTasks ? replaceTaskIdInTree(task.subTasks, fromId, toId) : task.subTasks,
      }
    })
  }

  const clampDepth = (depth: number) => Math.min(3, Math.max(0, Math.floor(depth)))

  const findTaskDepth = (tasks: Task[], targetId: string, currentDepth = 0): number | undefined => {
    for (const task of tasks) {
      if (task.id === targetId) return clampDepth(currentDepth)
      const nested = findTaskDepth(task.subTasks || [], targetId, currentDepth + 1)
      if (typeof nested === "number") return nested
    }
    return undefined
  }

  const resolveNewTaskDepth = (projectTasks: Task[], parentId?: string): number => {
    if (!parentId) return 0
    const parentDepth = findTaskDepth(projectTasks, parentId, 0)
    if (typeof parentDepth !== "number") return 0
    return clampDepth(parentDepth + 1)
  }

  const moveArrayItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
    const next = [...items]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    return next
  }

  const moveTaskInTree = (
    tasks: Task[],
    taskId: string,
    direction: "up" | "down",
  ): { tasks: Task[]; movedSiblingIds: string[] | null } => {
    const foundIndex = tasks.findIndex((task) => task.id === taskId)
    if (foundIndex !== -1) {
      const targetIndex = direction === "up" ? foundIndex - 1 : foundIndex + 1
      if (targetIndex < 0 || targetIndex >= tasks.length) {
        return { tasks, movedSiblingIds: null }
      }
      const moved = moveArrayItem(tasks, foundIndex, targetIndex).map((task, index) => ({
        ...task,
        displayOrder: index,
      }))
      return { tasks: moved, movedSiblingIds: moved.map((task) => task.id) }
    }

    for (let i = 0; i < tasks.length; i++) {
      const current = tasks[i]
      if (!current.subTasks || current.subTasks.length === 0) continue

      const nested = moveTaskInTree(current.subTasks, taskId, direction)
      if (nested.movedSiblingIds) {
        const updated = [...tasks]
        updated[i] = { ...current, subTasks: nested.tasks }
        return { tasks: updated, movedSiblingIds: nested.movedSiblingIds }
      }
    }

    return { tasks, movedSiblingIds: null }
  }

  const withDisplayOrder = (tasks: Task[]) => tasks.map((task, index) => ({ ...task, displayOrder: index }))

  const normalizeDepthSubtree = (task: Task, depth: number): Task => {
    const clamped = clampDepth(depth)
    const subTasks = (task.subTasks || []).map((child) => normalizeDepthSubtree(child, clamped + 1))
    return {
      ...task,
      depth: clamped,
      isSubTask: clamped > 0,
      subTasks,
    }
  }

  const removeTaskNode = (
    tasks: Task[],
    taskId: string,
    depth = 0,
  ): { tasks: Task[]; removed?: Task; removedDepth?: number } => {
    const foundIndex = tasks.findIndex((task) => task.id === taskId)
    if (foundIndex !== -1) {
      const removed = tasks[foundIndex]
      const next = withDisplayOrder(tasks.filter((_, index) => index !== foundIndex))
      return { tasks: next, removed, removedDepth: depth }
    }

    for (let i = 0; i < tasks.length; i++) {
      const current = tasks[i]
      if (!current.subTasks || current.subTasks.length === 0) continue

      const nested = removeTaskNode(current.subTasks, taskId, depth + 1)
      if (nested.removed) {
        const next = [...tasks]
        next[i] = { ...current, subTasks: nested.tasks }
        return { tasks: next, removed: nested.removed, removedDepth: nested.removedDepth }
      }
    }

    return { tasks }
  }

  const insertTaskAtTarget = (
    tasks: Task[],
    taskToInsert: Task,
    targetTaskId: string,
    position: "before" | "after" | "child",
    depth = 0,
    parentId?: string,
  ): { tasks: Task[]; inserted: boolean } => {
    const targetIndex = tasks.findIndex((task) => task.id === targetTaskId)
    if (targetIndex !== -1) {
      if (position === "child") {
        const target = tasks[targetIndex]
        const normalized = normalizeDepthSubtree(
          { ...taskToInsert, parentId: target.id, isSubTask: true },
          depth + 1,
        )
        const nextChildren = withDisplayOrder([...(target.subTasks || []), normalized])
        const next = [...tasks]
        next[targetIndex] = { ...target, subTasks: nextChildren }
        return { tasks: next, inserted: true }
      }

      const normalized = normalizeDepthSubtree(
        { ...taskToInsert, parentId, isSubTask: Boolean(parentId) },
        depth,
      )
      const insertIndex = position === "before" ? targetIndex : targetIndex + 1
      const next = [...tasks]
      next.splice(insertIndex, 0, normalized)
      return { tasks: withDisplayOrder(next), inserted: true }
    }

    for (let i = 0; i < tasks.length; i++) {
      const current = tasks[i]
      if (!current.subTasks || current.subTasks.length === 0) continue

      const nested = insertTaskAtTarget(current.subTasks, taskToInsert, targetTaskId, position, depth + 1, current.id)
      if (nested.inserted) {
        const next = [...tasks]
        next[i] = { ...current, subTasks: nested.tasks }
        return { tasks: next, inserted: true }
      }
    }

    return { tasks, inserted: false }
  }

  const collectTaskMap = (tasks: Task[], map = new Map<string, Task>()) => {
    tasks.forEach((task) => {
      map.set(task.id, task)
      collectTaskMap(task.subTasks || [], map)
    })
    return map
  }

  type TaskReorderUpdates = Omit<Partial<Task>, "parentId"> & { parentId?: string | null }

  const applyProjectIdToSubtree = (task: Task, projectId: string): Task => ({
    ...task,
    projectId,
    subTasks: (task.subTasks || []).map((child) => applyProjectIdToSubtree(child, projectId)),
  })

  const buildTaskUpdatesFromMaps = (
    prevMap: Map<string, Task>,
    nextMap: Map<string, Task>,
  ): Array<{ id: string; updates: TaskReorderUpdates }> => {
    const updates: Array<{ id: string; updates: TaskReorderUpdates }> = []

    nextMap.forEach((nextTask, id) => {
      const prevTask = prevMap.get(id)
      if (!prevTask) return

      const itemUpdates: TaskReorderUpdates = {}
      if ((prevTask.parentId || undefined) !== (nextTask.parentId || undefined)) itemUpdates.parentId = nextTask.parentId ?? null
      if ((prevTask.depth ?? 0) !== (nextTask.depth ?? 0)) itemUpdates.depth = nextTask.depth
      if ((prevTask.displayOrder ?? -1) !== (nextTask.displayOrder ?? -1)) itemUpdates.displayOrder = nextTask.displayOrder
      if (Boolean(prevTask.isSubTask) !== Boolean(nextTask.isSubTask)) itemUpdates.isSubTask = nextTask.isSubTask
      if ((prevTask.projectId || "") !== (nextTask.projectId || "")) itemUpdates.projectId = nextTask.projectId

      if (Object.keys(itemUpdates).length > 0) {
        updates.push({ id, updates: itemUpdates })
      }
    })

    return updates
  }

  const reorderTaskInTree = (
    tasks: Task[],
    draggedTaskId: string,
    targetTaskId: string,
    position: "before" | "after" | "child",
  ): { tasks: Task[]; taskUpdates: Array<{ id: string; updates: TaskReorderUpdates }>; moved: boolean } => {
    const removed = removeTaskNode(tasks, draggedTaskId, 0)
    if (!removed.removed) return { tasks, taskUpdates: [], moved: false }

    const inserted = insertTaskAtTarget(removed.tasks, removed.removed, targetTaskId, position, 0, undefined)
    if (!inserted.inserted) return { tasks, taskUpdates: [], moved: false }

    const prevMap = collectTaskMap(tasks)
    const nextMap = collectTaskMap(inserted.tasks)
    const taskUpdates = buildTaskUpdatesFromMaps(prevMap, nextMap)

    return { tasks: inserted.tasks, taskUpdates, moved: taskUpdates.length > 0 }
  }

  const allTasksFlat = useMemo(() => {
    return projectList.flatMap((p) => flattenTasks(p.tasks))
  }, [projectList])

  const persons = useMemo(() => {
    const personSet = new Set<string>()
    allTasksFlat.forEach((t) => {
      t.person.split(",").forEach((p) => {
        const trimmed = p.trim()
        if (trimmed) personSet.add(trimmed)
      })
    })
    return Array.from(personSet).sort()
  }, [allTasksFlat])

  const departments = getDepartmentList()

  const sortedProjects = useMemo(() => {
    const list = [...projectList]
    const getTime = (project: Project) => (project.createdAt ? new Date(project.createdAt).getTime() : 0)
    const baseCompare = (a: Project, b: Project) => {
      const orderA = typeof a.displayOrder === "number" ? a.displayOrder : Number.MAX_SAFE_INTEGER
      const orderB = typeof b.displayOrder === "number" ? b.displayOrder : Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB

      const timeA = getTime(a)
      const timeB = getTime(b)
      if (timeA !== timeB) return timeA - timeB

      return a.id.localeCompare(b.id)
    }

    return list.sort((a, b) => {
      if (sortBy === "latest") {
        return baseCompare(a, b)
      }
      if (sortBy === "name") {
        const byName = a.name.localeCompare(b.name, "ko")
        if (byName !== 0) return byName
        return baseCompare(a, b)
      }
      if (sortBy === "type") {
        const byType = a.type.localeCompare(b.type, "ko")
        if (byType !== 0) return byType
        const byName = a.name.localeCompare(b.name, "ko")
        if (byName !== 0) return byName
        return baseCompare(a, b)
      }
      if (sortBy === "progress") {
        const getProgress = (p: Project) => {
          const tasks = flattenTasks(p.tasks)
          if (tasks.length === 0) return 0
          return tasks.filter((t) => t.status === "완료").length / tasks.length
        }
        const progressDiff = getProgress(b) - getProgress(a)
        if (progressDiff !== 0) return progressDiff
        return baseCompare(a, b)
      }
      return baseCompare(a, b)
    })
  }, [projectList, sortBy])

  const pmOptions = useMemo<ProjectPmOption[]>(
    () =>
      userProfiles.map((profile) => ({
        email: profile.email,
        label: profile.taskAliases?.[0] || profile.email,
      })),
    [userProfiles],
  )

  const currentUserEmail = (user?.email || "").trim().toLowerCase()
  const pmProjectIds = useMemo(() => {
    if (!currentUserEmail) return new Set<string>()
    return new Set(
      projectList
        .filter((project) => (project.pmEmail || "").trim().toLowerCase() === currentUserEmail)
        .map((project) => project.id),
    )
  }, [currentUserEmail, projectList])

  const canViewAllRecentChanges = isAdmin || pagePermissions.recentChangesWidget
  const canViewRecentChanges = canViewAllRecentChanges || pmProjectIds.size > 0

  const loadVisibleHistoryEntries = async () => {
    const entries = await fetchHistoryEntries(20)
    if (canViewAllRecentChanges) return entries
    return entries.filter((entry) => {
      if (entry.projectId && pmProjectIds.has(entry.projectId)) return true
      if (entry.entityType === "project" && entry.entityId && pmProjectIds.has(entry.entityId)) return true
      return false
    })
  }

  const markChangeHistorySeen = (ids: string[]) => {
    if (!user?.email || ids.length === 0) return
    setSeenRecentChangeIds((prev) => {
      const next = Array.from(new Set([...prev, ...ids])).slice(-300)
      void saveSeenRecentChangeIds(user.email || "", next).catch((error) => {
        console.error("Failed to save seen recent changes:", error)
      })
      return next
    })
  }

  const visibleUnreadChangeCount = useMemo(() => {
    const seen = new Set(seenRecentChangeIds)
    return visibleHistoryEntries.filter((entry) => {
      if (entry.entityType !== "task" || entry.action !== "update") return false
      if (currentUserEmail && (entry.actorEmail || "").trim().toLowerCase() === currentUserEmail) return false
      return !seen.has(`fa:${entry.id}`)
    }).length
  }, [currentUserEmail, seenRecentChangeIds, visibleHistoryEntries])

  const jumpToHistoryEntry = (entry: { entityId?: string; entityType?: string }) => {
    if (entry.entityType !== "task" || !entry.entityId) return
    setViewMode("gantt")
    setHighlightedTaskId(entry.entityId)
  }

  useEffect(() => {
    if (!user || !canViewRecentChanges) {
      setVisibleHistoryEntries([])
      return
    }

    let disposed = false
    void loadVisibleHistoryEntries()
      .then((entries) => {
        if (!disposed) setVisibleHistoryEntries(entries)
      })
      .catch((error) => {
        console.error("Visible history fetch failed:", error)
        if (!disposed) setVisibleHistoryEntries([])
      })
    return () => {
      disposed = true
    }
  }, [user, canViewRecentChanges, canViewAllRecentChanges, pmProjectIds])

  const handleAddProject = async (newProject: Project) => {
    try {
      const { id, tasks, ...projectData } = newProject
      const newProjectId = await addProjectToDB(projectData)
      await recordHistory({
        entityType: "project",
        action: "create",
        entityId: newProjectId,
        after: serializeProjectData({ ...newProject, id: newProjectId }),
      })
      toast.success("프로젝트가 추가되었습니다.")
    } catch (error) {
      toast.error("프로젝트 추가 실패")
    }
  }

  const handleSortByChange = (nextSortBy: ProjectSortType) => {
    setSortBy(nextSortBy)
    void saveDashboardSortBy(nextSortBy).catch(() => {
      toast.error("정렬 설정 저장 실패")
    })
  }

  const handlePersistGanttCollapseState = async (state: {
    collapsedProjectIds: string[]
    collapsedTaskIds: string[]
  }) => {
    if (!user) return
    try {
      await saveGanttCollapseState(user.email || "", state)
    } catch (error) {
      console.error("Failed to save gantt collapse state:", error)
    }
  }

  const handlePersistGanttLeftPanelWidth = async (width: number) => {
    if (!user?.email) return
    setGanttLeftPanelWidth(width)
    try {
      await saveGanttLeftPanelWidth(user.email, width)
    } catch (error) {
      console.error("Failed to save FA gantt left panel width:", error)
    }
  }

  const handlePersistGanttDetailPanelWidth = async (width: number) => {
    if (!user?.email) return
    setGanttDetailPanelWidth(width)
    try {
      await saveGanttDetailPanelWidth(user.email, width)
    } catch (error) {
      console.error("Failed to save FA gantt detail panel width:", error)
    }
  }

  const handlePersistHiddenOwnerOptions = async (owners: string[]) => {
    if (!user?.email) return
    const normalized = Array.from(new Set(owners.map((owner) => owner.trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "ko"),
    )
    setHiddenOwnerOptions(normalized)
    try {
      await saveUserHiddenOwnerOptions(user.email, normalized)
    } catch (error) {
      toast.error("담당자 옵션 삭제 저장 실패")
    }
  }

  const handleEditProject = async (updatedProject: Project) => {
    try {
      const beforeProject = projectList.find((p) => p.id === updatedProject.id)
      const { id, tasks, ...projectData } = updatedProject
      await updateProjectInDB(id, projectData)
      await recordHistory({
        entityType: "project",
        action: "update",
        entityId: id,
        before: beforeProject ? serializeProjectData(beforeProject) : undefined,
        after: serializeProjectData(updatedProject),
      })
      toast.success("프로젝트 정보가 수정되었습니다.")
    } catch (error) {
      toast.error("프로젝트 수정 실패")
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    try {
      if (confirm("프로젝트를 삭제하면 모든 하위 업무도 함께 삭제됩니다. 계속하시겠습니까?")) {
        const beforeProject = projectList.find((p) => p.id === projectId)
        const beforeTasks = beforeProject ? flattenTaskRecords(beforeProject.tasks) : []
        await deleteProjectFromDB(projectId)
        if (beforeProject) {
          await recordHistory({
            entityType: "project_bundle",
            action: "project_delete",
            entityId: projectId,
            before: {
              project: { id: beforeProject.id, data: serializeProjectData(beforeProject) },
              tasks: beforeTasks,
            },
          })
        }
        toast.success("프로젝트가 삭제되었습니다.")
      }
    } catch (error) {
      toast.error("프로젝트 삭제 실패")
    }
  }

  const handleAddTask = async (newTask: Task) => {
    const targetProject = projectList.find((project) => project.id === newTask.projectId)
    const computedDepth = resolveNewTaskDepth(targetProject?.tasks || [], newTask.parentId)
    const taskWithDepth: Task = {
      ...newTask,
      depth: computedDepth,
      subTasks: newTask.subTasks || [],
    }

    setProjectList((prev) =>
      prev.map((project) => {
        if (project.id !== newTask.projectId) return project

        if (newTask.parentId) {
          return {
            ...project,
            tasks: insertTaskIntoTree(project.tasks, newTask.parentId, taskWithDepth),
          }
        }

        return {
          ...project,
          tasks: [taskWithDepth, ...project.tasks],
        }
      }),
    )

    try {
      const { id, subTasks, ...taskData } = taskWithDepth
      const sanitizedTaskData = { ...taskData } as Omit<Task, "id">
      if (sanitizedTaskData.parentId === undefined) {
        delete sanitizedTaskData.parentId
      }
      if (sanitizedTaskData.isSubTask === undefined) {
        delete sanitizedTaskData.isSubTask
      }

      const createdTaskId = await addTaskToDB(sanitizedTaskData)
      setProjectList((prev) =>
        prev.map((project) =>
          project.id === newTask.projectId
            ? { ...project, tasks: replaceTaskIdInTree(project.tasks, newTask.id, createdTaskId) }
            : project,
        ),
      )
      await recordHistory({
        entityType: "task",
        action: "create",
        entityId: createdTaskId,
        projectId: newTask.projectId,
        after: sanitizedTaskData as unknown as Record<string, unknown>,
      })
      toast.success("업무가 추가되었습니다.")
    } catch (error) {
      setProjectList((prev) =>
        prev.map((project) =>
          project.id === newTask.projectId
            ? {
                ...project,
                tasks: removeTaskFromTree(project.tasks, newTask.id),
              }
            : project,
        ),
      )
      toast.error("업무 추가 실패")
    }
  }

  const handleEditTask = async (updatedTask: Task) => {
    try {
      const beforeTask = allTasksFlat.find((t) => t.id === updatedTask.id)
      const { id, subTasks, ...updates } = updatedTask
      const sanitizedUpdates = compact(updates as Record<string, unknown>) as Partial<Task>
      await updateTaskInDB(id, sanitizedUpdates)
      await recordHistory({
        entityType: "task",
        action: "update",
        entityId: id,
        projectId: updatedTask.projectId,
        before: beforeTask ? serializeTaskData(beforeTask) : undefined,
        after: serializeTaskData(updatedTask),
      })
      toast.success("업무가 수정되었습니다.")
    } catch (error) {
      toast.error("업무 수정 실패")
    }
  }

  const handleDeleteTask = async (taskId: string, projectId: string) => {
    try {
      const beforeTask = allTasksFlat.find((t) => t.id === taskId)
      await deleteTaskFromDB(taskId)
      if (beforeTask) {
        await recordHistory({
          entityType: "task",
          action: "delete",
          entityId: taskId,
          projectId,
          before: serializeTaskData(beforeTask),
        })
      }
      toast.success("업무가 삭제되었습니다.")
    } catch (error) {
      toast.error("업무 삭제 실패")
    }
  }

  const handleDeleteTasksBulk = async (targets: Array<{ taskId: string; projectId: string }>) => {
    const uniqueTargets = Array.from(new Map(targets.map((target) => [target.taskId, target])).values())
    if (uniqueTargets.length === 0) return

    let deletedCount = 0
    let failedCount = 0

    for (const target of uniqueTargets) {
      try {
        const beforeTask = allTasksFlat.find((task) => task.id === target.taskId)
        await deleteTaskFromDB(target.taskId)
        if (beforeTask) {
          await recordHistory({
            entityType: "task",
            action: "delete",
            entityId: target.taskId,
            projectId: target.projectId,
            before: serializeTaskData(beforeTask),
          })
        }
        deletedCount += 1
      } catch (error) {
        failedCount += 1
      }
    }

    if (deletedCount > 0) {
      toast.success(`${deletedCount}개 업무가 삭제되었습니다.`)
    }
    if (failedCount > 0) {
      toast.error(`${failedCount}개 업무 삭제에 실패했습니다.`)
    }
  }

  const handleCopyTasksBulk = async (taskIds: string[]) => {
    const uniqueIds = Array.from(new Set(taskIds))
    if (uniqueIds.length === 0) return

    const taskMap = new Map(allTasksFlat.map((task) => [task.id, task]))
    const selectedSet = new Set(uniqueIds.filter((id) => taskMap.has(id)))
    const rootIds = Array.from(selectedSet).filter((id) => {
      let parentId = taskMap.get(id)?.parentId
      while (parentId) {
        if (selectedSet.has(parentId)) return false
        parentId = taskMap.get(parentId)?.parentId
      }
      return true
    })
    if (rootIds.length === 0) return

    type CopyPayload = {
      tempId: string
      parentTempId?: string
      originalParentId?: string
      data: Omit<Task, "id">
      projectId: string
    }
    const payloads: CopyPayload[] = []
    let sequence = 0
    const baseTimestamp = Date.now()

    const cloneSubTree = (source: Task, parentTempId: string | undefined, isRoot: boolean): string => {
      const tempId = `tmp_${baseTimestamp}_${sequence}`
      sequence += 1

      const clonedTask: Omit<Task, "id"> = {
        ...source,
        task: isRoot ? `${source.task} (복사)` : source.task,
        isSubTask: Boolean(parentTempId || source.parentId),
        displayOrder: baseTimestamp + sequence,
        subTasks: [],
      }
      payloads.push({
        tempId,
        parentTempId,
        originalParentId: source.parentId,
        data: clonedTask,
        projectId: clonedTask.projectId,
      })

      ;(source.subTasks || []).forEach((child) => {
        cloneSubTree(child, tempId, false)
      })

      return tempId
    }

    rootIds.forEach((rootId) => {
      const rootTask = taskMap.get(rootId)
      if (!rootTask) return
      cloneSubTree(rootTask, rootTask.parentId, true)
    })

    let copiedCount = 0
    let failedCount = 0
    const createdIdByTempId = new Map<string, string>()

    for (const payload of payloads) {
      try {
        const { id: _ignoredId, subTasks, ...taskData } = payload.data as Task
        const resolvedParentId = payload.parentTempId
          ? createdIdByTempId.get(payload.parentTempId)
          : payload.originalParentId

        if (payload.parentTempId && !resolvedParentId) {
          failedCount += 1
          continue
        }

        const sanitizedTaskData = compact({
          ...(taskData as Record<string, unknown>),
          parentId: resolvedParentId,
          isSubTask: Boolean(resolvedParentId),
        }) as Omit<Task, "id">

        if (sanitizedTaskData.parentId === undefined) {
          delete sanitizedTaskData.parentId
        }
        if (sanitizedTaskData.isSubTask === undefined) {
          delete sanitizedTaskData.isSubTask
        }

        const createdTaskId = await addTaskToDB(sanitizedTaskData)
        createdIdByTempId.set(payload.tempId, createdTaskId)
        await recordHistory({
          entityType: "task",
          action: "create",
          entityId: createdTaskId,
          projectId: payload.projectId,
          after: sanitizedTaskData as unknown as Record<string, unknown>,
        })
        copiedCount += 1
      } catch (error) {
        failedCount += 1
      }
    }

    if (copiedCount > 0) {
      toast.success(`${copiedCount}개 업무가 복사되었습니다.`)
    }
    if (failedCount > 0) {
      toast.error(`${failedCount}개 업무 복사에 실패했습니다.`)
    }
  }

  const handleMoveProject = async (projectId: string, direction: "up" | "down") => {
    let movedProjectIds: string[] | null = null

    setProjectList((prev) => {
      const currentIndex = prev.findIndex((project) => project.id === projectId)
      if (currentIndex === -1) return prev

      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= prev.length) return prev

      const moved = moveArrayItem(prev, currentIndex, targetIndex).map((project, index) => ({
        ...project,
        displayOrder: index,
      }))
      movedProjectIds = moved.map((project) => project.id)
      return moved
    })

    if (!movedProjectIds) return

    try {
      await updateProjectOrdersInDB(movedProjectIds)
    } catch (error) {
      toast.error("프로젝트 순서 저장 실패")
    }
  }

  const handleMoveTask = async (
    projectId: string,
    taskId: string,
    direction: "up" | "down",
  ) => {
    const beforeTaskMap = new Map(allTasksFlat.map((task) => [task.id, task]))
    let movedSiblingIds: string[] = []

    setProjectList((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project
        const moved = moveTaskInTree(project.tasks, taskId, direction)
        movedSiblingIds = moved.movedSiblingIds || []
        return { ...project, tasks: moved.tasks }
      }),
    )

    if (movedSiblingIds.length === 0) return

    try {
      await updateTaskOrdersInDB(movedSiblingIds)
      await recordHistory({
        entityType: "batch",
        action: "batch_update",
        projectId,
        batch: movedSiblingIds.map((id, index) => ({
          entityType: "task",
          entityId: id,
          before: compact({ displayOrder: beforeTaskMap.get(id)?.displayOrder }),
          after: compact({ displayOrder: index }),
        })),
      })
    } catch (error) {
      toast.error("업무 순서 저장 실패")
    }
  }

  const handleReorderTask = async (
    targetProjectId: string,
    draggedTaskId: string,
    targetTaskId: string,
    position: "before" | "after" | "child",
  ) => {
    if (!draggedTaskId || !targetTaskId || draggedTaskId === targetTaskId) return

    let taskUpdates: Array<{ id: string; updates: TaskReorderUpdates }> = []
    let moved = false

    setProjectList((prev) => {
      const draggedTask = allTasksFlat.find((task) => task.id === draggedTaskId)
      const sourceProjectId = draggedTask?.projectId
      if (!sourceProjectId) return prev

      if (sourceProjectId === targetProjectId) {
        return prev.map((project) => {
          if (project.id !== targetProjectId) return project
          const reordered = reorderTaskInTree(project.tasks, draggedTaskId, targetTaskId, position)
          moved = reordered.moved
          taskUpdates = reordered.taskUpdates
          return reordered.moved ? { ...project, tasks: reordered.tasks } : project
        })
      }

      const sourceProject = prev.find((project) => project.id === sourceProjectId)
      const targetProject = prev.find((project) => project.id === targetProjectId)
      if (!sourceProject || !targetProject) return prev

      const removed = removeTaskNode(sourceProject.tasks, draggedTaskId, 0)
      if (!removed.removed) return prev

      const movedSubtree = applyProjectIdToSubtree(removed.removed, targetProjectId)
      const inserted = insertTaskAtTarget(targetProject.tasks, movedSubtree, targetTaskId, position, 0, undefined)
      if (!inserted.inserted) return prev

      const prevMap = collectTaskMap(sourceProject.tasks, collectTaskMap(targetProject.tasks))
      const nextMap = collectTaskMap(removed.tasks, collectTaskMap(inserted.tasks))
      taskUpdates = buildTaskUpdatesFromMaps(prevMap, nextMap)
      moved = taskUpdates.length > 0

      if (!moved) return prev

      return prev.map((project) => {
        if (project.id === sourceProjectId) return { ...project, tasks: removed.tasks }
        if (project.id === targetProjectId) return { ...project, tasks: inserted.tasks }
        return project
      })
    })

    if (!moved || taskUpdates.length === 0) return

    try {
      await Promise.all(taskUpdates.map((item) => updateTaskInDB(item.id, item.updates)))
      await recordHistory({
        entityType: "batch",
        action: "batch_update",
        projectId: targetProjectId,
        batch: taskUpdates.map((item) => {
          const beforeTask = allTasksFlat.find((task) => task.id === item.id)
          const afterTask = {
            ...beforeTask,
            ...item.updates,
          } as Task
          return {
            entityType: "task" as const,
            entityId: item.id,
            before: beforeTask ? serializeTaskData(beforeTask) : undefined,
            after: serializeTaskData(afterTask),
          }
        }),
      })
    } catch (error) {
      toast.error("업무 순서 저장 실패")
    }
  }

  const handleMoveTaskToProjectTop = async (targetProjectId: string, draggedTaskId: string) => {
    if (!draggedTaskId || !targetProjectId) return

    let taskUpdates: Array<{ id: string; updates: TaskReorderUpdates }> = []
    let moved = false

    setProjectList((prev) => {
      const draggedTask = allTasksFlat.find((task) => task.id === draggedTaskId)
      const sourceProjectId = draggedTask?.projectId
      if (!sourceProjectId) return prev

      const sourceProject = prev.find((project) => project.id === sourceProjectId)
      const targetProject = prev.find((project) => project.id === targetProjectId)
      if (!sourceProject || !targetProject) return prev

      const removed = removeTaskNode(sourceProject.tasks, draggedTaskId, 0)
      if (!removed.removed) return prev

      const movedSubtree = applyProjectIdToSubtree(removed.removed, targetProjectId)
      const normalizedRoot = normalizeDepthSubtree(
        { ...movedSubtree, parentId: undefined, isSubTask: false },
        0,
      )

      if (sourceProjectId === targetProjectId) {
        const nextTasks = withDisplayOrder([...removed.tasks, normalizedRoot])
        const prevMap = collectTaskMap(sourceProject.tasks)
        const nextMap = collectTaskMap(nextTasks)
        taskUpdates = buildTaskUpdatesFromMaps(prevMap, nextMap)
        moved = taskUpdates.length > 0
        if (!moved) return prev
        return prev.map((project) => (project.id === targetProjectId ? { ...project, tasks: nextTasks } : project))
      }

      const nextTargetTasks = withDisplayOrder([...targetProject.tasks, normalizedRoot])
      const prevMap = collectTaskMap(sourceProject.tasks, collectTaskMap(targetProject.tasks))
      const nextMap = collectTaskMap(removed.tasks, collectTaskMap(nextTargetTasks))
      taskUpdates = buildTaskUpdatesFromMaps(prevMap, nextMap)
      moved = taskUpdates.length > 0
      if (!moved) return prev

      return prev.map((project) => {
        if (project.id === sourceProjectId) return { ...project, tasks: removed.tasks }
        if (project.id === targetProjectId) return { ...project, tasks: nextTargetTasks }
        return project
      })
    })

    if (!moved || taskUpdates.length === 0) return

    try {
      await Promise.all(taskUpdates.map((item) => updateTaskInDB(item.id, item.updates)))
      await recordHistory({
        entityType: "batch",
        action: "batch_update",
        projectId: targetProjectId,
        batch: taskUpdates.map((item) => {
          const beforeTask = allTasksFlat.find((task) => task.id === item.id)
          const afterTask = { ...beforeTask, ...item.updates } as Task
          return {
            entityType: "task" as const,
            entityId: item.id,
            before: beforeTask ? serializeTaskData(beforeTask) : undefined,
            after: serializeTaskData(afterTask),
          }
        }),
      })
    } catch (error) {
      toast.error("업무 이동 저장 실패")
    }
  }

  const counts = useMemo(() => {
    return {
      total: allTasksFlat.length,
      "완료": allTasksFlat.filter((t) => t.status === "완료").length,
      "진행": allTasksFlat.filter((t) => t.status === "진행").length,
      "예정": allTasksFlat.filter((t) => t.status === "예정").length,
      "보류": allTasksFlat.filter((t) => t.status === "보류").length,
      "미정": allTasksFlat.filter((t) => t.status === "미정").length,
    }
  }, [allTasksFlat])

  const today = new Date()
  const formattedDate = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`
  const shouldHideMobileGanttControls = isMobile && viewMode === "gantt"

  const handleLogout = async () => {
    try {
      await signOut(auth)
      toast.success("로그아웃되었습니다.")
    } catch (error) {
      toast.error("로그아웃에 실패했습니다.")
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">로그인 상태를 확인하는 중...</p>
      </div>
    )
  }

  if (!user) {
    return <LoginForm />
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-full flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 shrink-0 items-center">
              <Image
                src="/placeholder-logo.png"
                alt="WorkHub 로고"
                width={132}
                height={40}
                className="h-10 w-auto object-contain"
                priority
              />
            </div>
            <div>
              <p className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">WorkHub</p>
              <h1 className="whitespace-nowrap text-base font-bold text-card-foreground leading-tight">{"FA 사업부 스케줄"}</h1>
            </div>
          </div>
          <div className="relative flex w-full flex-wrap items-center gap-2 text-xs text-muted-foreground lg:w-auto lg:flex-nowrap">
            <div className="hidden shrink-0 items-center whitespace-nowrap rounded-md border border-border bg-background px-3 py-1.5 text-[11px] text-foreground shadow-sm lg:flex">
              {user.email || "로그인 사용자"}
            </div>
            <Link
              href="/"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-3 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
            >
              <Home className="h-3.5 w-3.5" />
              메인
            </Link>
            {(isAdmin || pagePermissions.myPage) && (
              <Link
                href="/my-page"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-3 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
              >
                <UserRoundSearch className="h-3.5 w-3.5" />
                마이 워크
              </Link>
            )}
            <Link
              href="/weekly-work"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-3 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              주간 업무
            </Link>
            <div
              className={cn(
                "flex shrink-0 overflow-hidden rounded-md border border-border bg-background shadow-sm lg:mr-4",
                shouldHideMobileGanttControls && "hidden",
              )}
            >
              <button
                onClick={() => setViewMode("gantt")}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-1.5 text-xs font-medium transition-colors",
                  viewMode === "gantt"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent",
                )}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                {"간트"}
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-l border-border px-4 py-1.5 text-xs font-medium transition-colors",
                  viewMode === "list"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent",
                )}
              >
                <List className="h-3.5 w-3.5" />
                {"목록"}
              </button>
              <button
                onClick={() => setViewMode("card")}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-l border-border px-4 py-1.5 text-xs font-medium transition-colors",
                  viewMode === "card"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent",
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                {"카드"}
              </button>
            </div>
            <div className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap font-medium md:flex">
              <CalendarDays className="h-4 w-4" />
              <span>{formattedDate}</span>
            </div>
            {canViewRecentChanges && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="relative inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border bg-background px-2 text-foreground shadow-sm"
                title={`미확인 수정 이력 ${visibleUnreadChangeCount}건`}
                aria-label={`미확인 수정 이력 ${visibleUnreadChangeCount}건`}
                onClick={() => setIsRecentChangesOpen((prev) => !prev)}
              >
                <Bell className="h-3.5 w-3.5" />
                {visibleUnreadChangeCount > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
                    {visibleUnreadChangeCount > 99 ? "99+" : visibleUnreadChangeCount}
                  </span>
                )}
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="ml-2 h-8 shrink-0 gap-1.5 whitespace-nowrap px-2 text-[11px]"
                onClick={handleRollbackLatest}
                disabled={isRollingBack || historyEntries.length === 0}
                title={historyEntries.length === 0 ? "롤백할 이력이 없습니다." : "가장 최근 변경을 되돌립니다."}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                최근 롤백
              </Button>
            )}
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5 whitespace-nowrap px-2 text-[11px]"
                onClick={() => setIsHistoryOpen((prev) => !prev)}
              >
                <History className="h-3.5 w-3.5" />
                변경 이력
                {isHistoryOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 whitespace-nowrap px-2 text-[11px]"
              onClick={handleLogout}
            >
              <LogOut className="h-3.5 w-3.5" />
              로그아웃
            </Button>
            {isHistoryOpen && (
              <div className="absolute left-0 top-10 z-[70] w-full max-w-[360px] rounded-lg border border-border bg-card p-3 shadow-lg lg:left-auto lg:right-0">
                {historyEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">아직 저장된 변경 이력이 없습니다.</p>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-auto pr-1">
                    {historyEntries.slice(0, 12).map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between rounded border border-border/70 px-2 py-1 text-[11px]">
                        <div className="min-w-0">
                          <span className="font-medium text-card-foreground">{getHistoryLabel(entry)}</span>
                          <span className="ml-2 text-muted-foreground">
                            {entry.createdAt
                              ? entry.createdAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
                              : ""}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          disabled={isRollingBack || rollingBackEntryId === entry.id}
                          onClick={() => handleRollbackEntry(entry)}
                        >
                          롤백
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {isRecentChangesOpen && (
              <div className="absolute left-0 top-10 z-[70] w-[min(760px,calc(100vw-2rem))] lg:left-auto lg:right-0">
                <RecentChangesWidget
                  loadEntries={loadVisibleHistoryEntries}
                  rollbackEntry={
                    canViewAllRecentChanges
                      ? async (entry) => {
                          await rollbackHistoryEntry(entry as ChangeHistoryEntry)
                          await deleteHistoryEntry(entry.id)
                        }
                      : undefined
                  }
                  projects={projectList}
                  currentUserEmail={user?.email || undefined}
                  onJump={jumpToHistoryEntry}
                  defaultOpen
                  title="최근 사용자 변경"
                  description="권한이 있는 프로젝트의 최근 업무 수정 이력을 확인합니다."
                  emptyMessage="확인할 최근 사용자 변경이 없습니다."
                />
              </div>
            )}
          </div>
        </div>
      </header>

      <main
        className={cn(
          "mx-auto max-w-full px-4 py-6 lg:px-10",
          viewMode === "gantt" && "px-2 sm:px-3 lg:px-6",
          viewMode === "gantt" && "py-4",
          shouldHideMobileGanttControls && "py-3",
        )}
      >
        {loading ? (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="text-sm text-muted-foreground">데이터를 불러오는 중...</p>
          </div>
        ) : (
          <div
            className={cn(
              "space-y-4",
              viewMode === "gantt" && "space-y-2",
              shouldHideMobileGanttControls && "space-y-1.5",
            )}
          >
            <div
              className={
                viewMode === "gantt"
                  ? shouldHideMobileGanttControls
                    ? "grid gap-2"
                    : "grid items-start gap-2 xl:grid-cols-[minmax(420px,max-content)_minmax(0,1fr)]"
                  : "grid items-start gap-3 xl:grid-cols-[minmax(460px,max-content)_minmax(0,1fr)]"
              }
            >
              <div className="min-w-0">
                <StatusSummary counts={counts} showDescriptions={viewMode === "gantt"} />
              </div>
              {!shouldHideMobileGanttControls && (
                <div className="min-w-0">
                  <FilterBar
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    statusFilter={statusFilter}
                    onStatusChange={setStatusFilter}
                    departmentFilter={departmentFilter}
                    onDepartmentChange={setDepartmentFilter}
                    personFilter={personFilter}
                    onPersonChange={setPersonFilter}
                    sortBy={sortBy}
                    onSortByChange={handleSortByChange}
                    departments={departments}
                    persons={persons}
                    compact={viewMode === "gantt"}
                  />
                </div>
              )}
            </div>
            {projectList.length === 0 ? (
              <div className="flex h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 text-center p-8">
                <Building2 className="h-10 w-10 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-semibold">표시할 데이터가 없습니다</h3>
                <p className="text-sm text-muted-foreground mt-2">새로운 프로젝트를 추가하여 업무 관리를 시작해 보세요.</p>
              </div>
            ) : viewMode === "list" ? (
              <ProjectList
                projects={sortedProjects}
                statusFilter={statusFilter}
                departmentFilter={departmentFilter}
                personFilter={personFilter}
                defaultTaskDepartment="FA"
                searchQuery={deferredSearchQuery}
                canEdit={canEdit}
                pmOptions={pmOptions}
                onAddTask={handleAddTask}
                onEditTask={handleEditTask}
                onDeleteTask={handleDeleteTask}
                onEditProject={handleEditProject}
                onDeleteProject={handleDeleteProject}
              />
            ) : viewMode === "gantt" ? (
              <GanttView
                projects={sortedProjects}
                globalSchedules={globalSchedules}
                changeHistoryEntries={visibleHistoryEntries}
                seenChangeHistoryIds={seenRecentChangeIds}
                changeHistoryIdPrefix="fa:"
                highlightedTaskId={highlightedTaskId}
                currentUserEmail={user?.email || undefined}
                onMarkChangeHistorySeen={markChangeHistorySeen}
                statusFilter={statusFilter}
                departmentFilter={departmentFilter}
                personFilter={personFilter}
                defaultTaskDepartment="FA"
                defaultTaskPerson={defaultTaskPerson}
                pmOptions={pmOptions}
                searchQuery={deferredSearchQuery}
                canEdit={canEdit}
                onAddProject={handleAddProject}
                onEditProject={handleEditProject}
                onAddTask={handleAddTask}
                onEditTask={handleEditTask}
                onDeleteTask={handleDeleteTask}
                onDeleteTasks={handleDeleteTasksBulk}
                onCopyTasks={handleCopyTasksBulk}
                onMoveProject={handleMoveProject}
                onMoveTask={handleMoveTask}
                onMoveTaskToProjectTop={handleMoveTaskToProjectTop}
                onReorderTask={handleReorderTask}
                persistedCollapsedProjectIds={ganttCollapsedProjectIds}
                persistedCollapsedTaskIds={ganttCollapsedTaskIds}
                persistedLeftPanelWidth={ganttLeftPanelWidth}
                persistedDetailPanelWidth={ganttDetailPanelWidth}
                persistedHiddenOwnerOptions={hiddenOwnerOptions}
                isCollapseStateReady={isGanttCollapseStateReady}
                onPersistCollapseState={handlePersistGanttCollapseState}
                onPersistLeftPanelWidth={handlePersistGanttLeftPanelWidth}
                onPersistDetailPanelWidth={handlePersistGanttDetailPanelWidth}
                onPersistHiddenOwnerOptions={handlePersistHiddenOwnerOptions}
              />
            ) : (
              <ProjectCardView
                projects={sortedProjects}
                statusFilter={statusFilter}
                departmentFilter={departmentFilter}
                personFilter={personFilter}
                searchQuery={deferredSearchQuery}
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
