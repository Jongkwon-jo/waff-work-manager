"use client"

import { useState, useMemo, useEffect, useDeferredValue } from "react"
import type { Project, Task, TaskStatus } from "@/lib/data"
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
  addHistoryEntry,
  fetchHistoryEntries,
  rollbackHistoryEntry,
  deleteHistoryEntry,
  type ChangeHistoryEntry,
} from "@/lib/firestore-service"
import { StatusSummary } from "@/components/status-summary"
import { FilterBar, ProjectSortType } from "@/components/filter-bar"
import { ProjectList } from "@/components/project-list"
import { GanttView } from "@/components/gantt-view"
import { ProjectCardView } from "@/components/project-card-view"
import { CalendarDays, Building2, List, BarChart3, LayoutGrid, RotateCcw, History, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export default function DashboardPage() {
  const [projectList, setProjectList] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all")
  const [departmentFilter, setDepartmentFilter] = useState("all")
  const [personFilter, setPersonFilter] = useState("all")
  const [sortBy, setSortBy] = useState<ProjectSortType>("latest")
  const [viewMode, setViewMode] = useState<"list" | "gantt" | "card">("gantt")
  const [historyEntries, setHistoryEntries] = useState<ChangeHistoryEntry[]>([])
  const [isRollingBack, setIsRollingBack] = useState(false)
  const [rollingBackEntryId, setRollingBackEntryId] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const deferredSearchQuery = useDeferredValue(searchQuery)

  useEffect(() => {
    setLoading(true)
    const unsubscribe = subscribeToData((data) => {
      setProjectList(data)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const loadHistory = async () => {
    try {
      const history = await fetchHistoryEntries(20)
      setHistoryEntries(history)
    } catch (error) {
      console.error("History fetch failed:", error)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [])

  const compact = <T extends Record<string, unknown>>(obj: T): T =>
    Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T

  const serializeTaskData = (task: Task) =>
    compact({
      projectId: task.projectId,
      parentId: task.parentId,
      task: task.task,
      category: task.category,
      department: task.department,
      person: task.person,
      startDate: task.startDate,
      endDate: task.endDate,
      status: task.status,
      manDays: task.manDays,
      isSubTask: task.isSubTask,
      depth: task.depth,
      displayOrder: task.displayOrder,
    })

  const serializeProjectData = (project: Project) =>
    compact({
      name: project.name,
      type: project.type,
      period: project.period,
      displayOrder: project.displayOrder,
      createdAt: project.createdAt,
    })

  const flattenTaskRecords = (tasks: Task[]): Array<{ id: string; data: Record<string, unknown> }> =>
    tasks.flatMap((task) => [{ id: task.id, data: serializeTaskData(task) }, ...flattenTaskRecords(task.subTasks || [])])

  const recordHistory = async (entry: Omit<ChangeHistoryEntry, "id" | "createdAt">) => {
    try {
      await addHistoryEntry(entry)
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

  const reorderTaskInTree = (
    tasks: Task[],
    draggedTaskId: string,
    targetTaskId: string,
    position: "before" | "after" | "child",
  ): { tasks: Task[]; taskUpdates: Array<{ id: string; updates: Partial<Task> }>; moved: boolean } => {
    const removed = removeTaskNode(tasks, draggedTaskId, 0)
    if (!removed.removed) return { tasks, taskUpdates: [], moved: false }

    const inserted = insertTaskAtTarget(removed.tasks, removed.removed, targetTaskId, position, 0, undefined)
    if (!inserted.inserted) return { tasks, taskUpdates: [], moved: false }

    const prevMap = collectTaskMap(tasks)
    const nextMap = collectTaskMap(inserted.tasks)
    const taskUpdates: Array<{ id: string; updates: Partial<Task> }> = []

    nextMap.forEach((nextTask, id) => {
      const prevTask = prevMap.get(id)
      if (!prevTask) return

      const updates: Partial<Task> = {}
      if ((prevTask.parentId || undefined) !== (nextTask.parentId || undefined)) updates.parentId = nextTask.parentId
      if ((prevTask.depth ?? 0) !== (nextTask.depth ?? 0)) updates.depth = nextTask.depth
      if ((prevTask.displayOrder ?? -1) !== (nextTask.displayOrder ?? -1)) updates.displayOrder = nextTask.displayOrder
      if (Boolean(prevTask.isSubTask) !== Boolean(nextTask.isSubTask)) updates.isSubTask = nextTask.isSubTask

      if (Object.keys(updates).length > 0) {
        taskUpdates.push({ id, updates })
      }
    })

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

    return list.sort((a, b) => {
      if (sortBy === "latest") {
        const orderA = typeof a.displayOrder === "number" ? a.displayOrder : Number.MAX_SAFE_INTEGER
        const orderB = typeof b.displayOrder === "number" ? b.displayOrder : Number.MAX_SAFE_INTEGER
        if (orderA !== orderB) return orderA - orderB
      }
      if (sortBy === "name") return a.name.localeCompare(b.name)
      if (sortBy === "type") return a.type.localeCompare(b.type)
      if (sortBy === "progress") {
        const getProgress = (p: Project) => {
          const tasks = flattenTasks(p.tasks)
          if (tasks.length === 0) return 0
          return tasks.filter((t) => t.status === "완료").length / tasks.length
        }
        return getProgress(b) - getProgress(a)
      }
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return timeB - timeA
    })
  }, [projectList, sortBy])

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
      await updateTaskInDB(id, updates)
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
    projectId: string,
    draggedTaskId: string,
    targetTaskId: string,
    position: "before" | "after" | "child",
  ) => {
    if (!draggedTaskId || !targetTaskId || draggedTaskId === targetTaskId) return

    let taskUpdates: Array<{ id: string; updates: Partial<Task> }> = []
    let moved = false

    setProjectList((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project
        const reordered = reorderTaskInTree(project.tasks, draggedTaskId, targetTaskId, position)
        moved = reordered.moved
        taskUpdates = reordered.taskUpdates
        return reordered.moved ? { ...project, tasks: reordered.tasks } : project
      }),
    )

    if (!moved || taskUpdates.length === 0) return

    try {
      await Promise.all(taskUpdates.map((item) => updateTaskInDB(item.id, item.updates)))
      await recordHistory({
        entityType: "batch",
        action: "batch_update",
        projectId,
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

  const counts = useMemo(() => {
    return {
      total: allTasksFlat.length,
      "완료": allTasksFlat.filter((t) => t.status === "완료").length,
      "진행": allTasksFlat.filter((t) => t.status === "진행").length,
      "대기": allTasksFlat.filter((t) => t.status === "대기").length,
      "보류": allTasksFlat.filter((t) => t.status === "보류").length,
      "미정": allTasksFlat.filter((t) => t.status === "미정").length,
    }
  }, [allTasksFlat])

  const today = new Date()
  const formattedDate = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-full items-center justify-between px-4 py-3 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm">
              <Building2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-bold text-card-foreground leading-tight">{"전략기획부 사업일정표"}</h1>
              <p className="text-xs text-muted-foreground">{"업무 관리 대시보드"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="mr-4 flex overflow-hidden rounded-md border border-border bg-background shadow-sm">
              <button
                onClick={() => setViewMode("gantt")}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium transition-colors",
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
                  "flex items-center gap-1.5 border-l border-border px-4 py-1.5 text-xs font-medium transition-colors",
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
                  "flex items-center gap-1.5 border-l border-border px-4 py-1.5 text-xs font-medium transition-colors",
                  viewMode === "card"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent",
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                {"카드"}
              </button>
            </div>
            <div className="flex items-center gap-1.5 font-medium">
              <CalendarDays className="h-4 w-4" />
              <span>{formattedDate}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="ml-2 h-8 gap-1.5 px-2 text-[11px]"
              onClick={handleRollbackLatest}
              disabled={isRollingBack || historyEntries.length === 0}
              title={historyEntries.length === 0 ? "롤백할 이력이 없습니다." : "가장 최근 변경을 되돌립니다."}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              최근 롤백
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-full px-4 py-6 lg:px-10">
        {loading ? (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="text-sm text-muted-foreground">데이터를 불러오는 중...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <StatusSummary counts={counts} />
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-card-foreground">
                  <History className="h-3.5 w-3.5" />
                  변경 이력
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => setIsHistoryOpen((prev) => !prev)}
                >
                  {isHistoryOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {isHistoryOpen ? "접기" : "펼치기"}
                </Button>
              </div>
              {isHistoryOpen && (
                <div className="mt-2">
                  {historyEntries.length === 0 ? (
                    <p className="text-xs text-muted-foreground">아직 저장된 변경 이력이 없습니다.</p>
                  ) : (
                    <div className="max-h-28 space-y-1 overflow-auto pr-1">
                      {historyEntries.slice(0, 8).map((entry) => (
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
            </div>
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
              onSortByChange={setSortBy}
              departments={departments}
              persons={persons}
              onAddProject={handleAddProject}
            />
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
                searchQuery={deferredSearchQuery}
                onAddTask={handleAddTask}
                onEditTask={handleEditTask}
                onDeleteTask={handleDeleteTask}
                onEditProject={handleEditProject}
                onDeleteProject={handleDeleteProject}
              />
            ) : viewMode === "gantt" ? (
              <GanttView
                projects={sortedProjects}
                statusFilter={statusFilter}
                departmentFilter={departmentFilter}
                personFilter={personFilter}
                searchQuery={deferredSearchQuery}
                onAddTask={handleAddTask}
                onEditTask={handleEditTask}
                onDeleteTask={handleDeleteTask}
                onMoveProject={handleMoveProject}
                onMoveTask={handleMoveTask}
                onReorderTask={handleReorderTask}
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
