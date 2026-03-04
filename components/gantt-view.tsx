"use client"

import { useMemo, useState, useRef, useEffect } from "react"
import type { Project, Task, TaskStatus, TaskCategory } from "@/lib/data"
import { getDepartmentList } from "@/lib/data"
import { ProjectTypeBadge } from "@/components/status-badge"
import { EditTaskDialog } from "./edit-task-dialog"
import { AddTaskDialog } from "./add-task-dialog"
import { Button } from "./ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { Calendar } from "./ui/calendar"
import {
  Trash2,
  ChevronDown,
  ChevronRight,
  PanelRight,
  CalendarIcon,
  Plus,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface GanttViewProps {
  projects: Project[]
  statusFilter: TaskStatus | "all"
  departmentFilter: string
  personFilter: string
  searchQuery: string
  onAddTask: (task: Task) => void
  onEditTask: (task: Task) => void
  onDeleteTask: (taskId: string, projectId: string) => void
  onMoveProject: (projectId: string, direction: "up" | "down") => void
  onMoveTask: (projectId: string, taskId: string, direction: "up" | "down") => void
}

type FlattenedTask = Task & {
  depth: number
  hasChildren: boolean
}

type FilteredProject = Omit<Project, "tasks"> & {
  tasks: FlattenedTask[]
}

const CELL_WIDTH = 28
const LEFT_PANEL_MIN_WIDTH = 320
const LEFT_PANEL_MAX_WIDTH = 680
const DETAIL_PANEL_MIN_WIDTH = 700
const DETAIL_PANEL_MAX_WIDTH = 1100
const HEADER_APPROX_HEIGHT = 110
const PROJECT_ROW_HEIGHT = 36
const TASK_ROW_HEIGHT = 36
const VIRTUAL_OVERSCAN_ROWS = 20
let textMeasureCanvas: HTMLCanvasElement | null = null
const textWidthCache = new Map<string, number>()
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getDayOfWeek(year: number, month: number, day: number) {
  const days = ["일", "월", "화", "수", "목", "금", "토"]
  return days[new Date(year, month, day).getDay()]
}

function parseDate(dateStr: string): { month: number; day: number } | null {
  const match = dateStr.match(/(\d{1,2})\D+(\d{1,2})/)
  if (!match) return null
  return { month: Number.parseInt(match[1], 10) - 1, day: Number.parseInt(match[2], 10) }
}

function parseDateToDate(dateStr: string): Date | undefined {
  const parsed = parseDate(dateStr)
  if (!parsed) return undefined
  const year = new Date().getFullYear()
  return new Date(year, parsed.month, parsed.day)
}

function formatDateKorean(date: Date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${mm}\uC6D4 ${dd}\uC77C`
}

function parseListValue(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function joinListValue(values: string[]): string {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).join(", ")
}

function getMeasuredTextWidth(text: string, font: string) {
  if (typeof document === "undefined") {
    return text.length * 8
  }

  const cacheKey = `${font}__${text}`
  const cached = textWidthCache.get(cacheKey)
  if (cached !== undefined) return cached

  if (!textMeasureCanvas) textMeasureCanvas = document.createElement("canvas")
  const context = textMeasureCanvas.getContext("2d")
  if (!context) return text.length * 8
  context.font = font
  const width = context.measureText(text).width
  textWidthCache.set(cacheKey, width)
  return width
}

function getStatusBarStyle(status: string): { barClass: string; textClass: string } {
  const normalized = status.trim().toLowerCase()

  if (normalized === "?꾨즺" || normalized.includes("done")) {
    return { barClass: "bg-slate-500", textClass: "text-slate-50" }
  }
  if (normalized === "吏꾪뻾" || normalized.includes("progress")) {
    return { barClass: "bg-blue-500", textClass: "text-blue-50" }
  }
  if (normalized === "대기" || normalized.includes("wait")) {
    return { barClass: "bg-gray-300", textClass: "text-gray-900" }
  }
  if (normalized === "蹂대쪟" || normalized.includes("hold")) {
    return { barClass: "bg-yellow-200", textClass: "text-yellow-800" }
  }
  return { barClass: "bg-rose-600", textClass: "text-rose-50" }
}

export function GanttView({
  projects,
  statusFilter,
  departmentFilter,
  personFilter,
  searchQuery,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onMoveProject,
  onMoveTask,
}: GanttViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef<number | null>(null)
  const pendingScrollTopRef = useRef(0)

  const [dragInfo, setDragInfo] = useState<{
    taskId: string
    type: "move" | "resize-left" | "resize-right"
    initialX: number
    initialLeft: number
    initialWidth: number
  } | null>(null)

  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(new Set())
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set())
  const [collapsedCompletedParentIds, setCollapsedCompletedParentIds] = useState<Set<string>>(new Set())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(700)
  const [isDetailColumnsOpen, setIsDetailColumnsOpen] = useState(false)
  const [recentlyAddedTaskId, setRecentlyAddedTaskId] = useState<string | null>(null)
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0)

  const allProjectIds = useMemo(() => projects.map((project) => project.id), [projects])
  const allCollapsibleTaskIds = useMemo(() => {
    const ids: string[] = []
    const walk = (tasks: Task[]) => {
      tasks.forEach((task) => {
        if ((task.subTasks?.length || 0) > 0) ids.push(task.id)
        walk(task.subTasks || [])
      })
    }
    projects.forEach((project) => walk(project.tasks))
    return ids
  }, [projects])

  const departmentOptions = useMemo(() => {
    const base = getDepartmentList()
    const extra = new Set<string>()
    projects.forEach((p) => {
      const walk = (tasks: Task[]) => {
        tasks.forEach((t) => {
          parseListValue(t.department || "").forEach((department) => extra.add(department))
          walk(t.subTasks || [])
        })
      }
      walk(p.tasks)
    })
    return Array.from(new Set([...base, ...Array.from(extra)])).filter(Boolean)
  }, [projects])

  const ownerOptions = useMemo(() => {
    const owners = new Set<string>()
    projects.forEach((p) => {
      const walk = (tasks: Task[]) => {
        tasks.forEach((t) => {
          t.person
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((o) => owners.add(o))
          walk(t.subTasks || [])
        })
      }
      walk(p.tasks)
    })
    return Array.from(owners).sort((a, b) => a.localeCompare(b))
  }, [projects])

  const toggleProjectCollapse = (projectId: string) => {
    setCollapsedProjectIds((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const toggleTaskCollapse = (taskId: string) => {
    setCollapsedTaskIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const toggleCompletedCollapse = (taskId: string) => {
    setCollapsedCompletedParentIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const updateTaskInline = (task: Task, updates: Partial<Task>) => {
    onEditTask({ ...task, ...updates })
  }

  const handleAddProjectLevelTask = (newTask: Task) => {
    const normalizedTask: Task = {
      ...newTask,
      parentId: undefined,
      isSubTask: false,
    }

    setCollapsedProjectIds((prev) => {
      if (!prev.has(normalizedTask.projectId)) return prev
      const next = new Set(prev)
      next.delete(normalizedTask.projectId)
      return next
    })

    setRecentlyAddedTaskId(normalizedTask.id)
    onAddTask(normalizedTask)
  }

  const handleAddNestedSubTask = (newTask: Task) => {
    if (!newTask.parentId) return

    const normalizedTask: Task = {
      ...newTask,
      isSubTask: true,
    }

    setCollapsedProjectIds((prev) => {
      if (!prev.has(normalizedTask.projectId)) return prev
      const next = new Set(prev)
      next.delete(normalizedTask.projectId)
      return next
    })

    setCollapsedTaskIds((prev) => {
      if (!prev.has(normalizedTask.parentId!)) return prev
      const next = new Set(prev)
      next.delete(normalizedTask.parentId!)
      return next
    })

    setRecentlyAddedTaskId(normalizedTask.id)
    onAddTask(normalizedTask)
  }

  useEffect(() => {
    if (!recentlyAddedTaskId) return
    const target = document.getElementById(`task-row-${recentlyAddedTaskId}`)
    if (!target) return

    target.scrollIntoView({ behavior: "smooth", block: "center" })
    setRecentlyAddedTaskId(null)
  }, [projects, recentlyAddedTaskId])

  const filteredProjects = useMemo<FilteredProject[]>(() => {
    const lowerQuery = searchQuery.trim().toLowerCase()

    return projects
      .map((project) => {
        const projectMatchesSearch = lowerQuery.length > 0 && project.name.toLowerCase().includes(lowerQuery)

        const collectVisibleRows = (tasks: Task[], depth = 0, showCompleted = false): FlattenedTask[] => {
          return tasks.reduce((acc, task) => {
            const hasChildren = (task.subTasks?.length || 0) > 0
            if (!showCompleted && statusFilter === "all" && task.status === "완료" && !hasChildren) {
              return acc
            }

            const nextShowCompleted = showCompleted || collapsedCompletedParentIds.has(task.id)
            const childRows = collectVisibleRows(
              task.subTasks || [],
              depth + 1,
              nextShowCompleted,
            )

            const matchesStatus =
              statusFilter === "all"
                ? task.status !== "완료" || showCompleted || hasChildren
                : task.status === statusFilter
            const matchesDepartment = departmentFilter === "all" || task.department.includes(departmentFilter)
            const matchesPerson = personFilter === "all" || task.person.includes(personFilter)
            const matchesSearch =
              lowerQuery.length === 0 || task.task.toLowerCase().includes(lowerQuery) || projectMatchesSearch

            const matchesCurrentTask = matchesStatus && matchesDepartment && matchesPerson && matchesSearch

            if (!matchesCurrentTask && childRows.length === 0) {
              return acc
            }

            acc.push({ ...task, depth, hasChildren })

            if (hasChildren && !collapsedTaskIds.has(task.id)) {
              acc.push(...childRows)
            }

            return acc
          }, [] as FlattenedTask[])
        }

        return {
          ...project,
          tasks: collectVisibleRows(project.tasks),
        }
      })
      .filter((project) => {
        if (lowerQuery.length > 0) {
          return project.tasks.length > 0 || project.name.toLowerCase().includes(lowerQuery)
        }
        if (statusFilter !== "all" || departmentFilter !== "all" || personFilter !== "all") {
          return project.tasks.length > 0
        }
        return true
      })
  }, [projects, statusFilter, departmentFilter, personFilter, searchQuery, collapsedTaskIds, collapsedCompletedParentIds])

  const months = useMemo(() => {
    const now = new Date()
    const baseYear = now.getFullYear()
    const baseMonth = now.getMonth()

    return Array.from({ length: 7 }, (_, i) => {
      const offset = i - 3
      const d = new Date(baseYear, baseMonth + offset, 1)
      return {
        year: d.getFullYear(),
        month: d.getMonth(),
        label: `${d.getFullYear()}년 ${d.getMonth() + 1}월`,
      }
    })
  }, [])

  const { leftPanelWidth, detailPanelWidth, detailGridTemplate } = useMemo(() => {
    const font = typeof document !== "undefined" ? getComputedStyle(document.body).font : "12px sans-serif"
    const leftTexts = [
      "Project & Task Details",
      ...projects.map((project) => project.name),
      ...projects.flatMap((project) => {
        const flattenTaskNames = (tasks: Task[]): string[] =>
          tasks.flatMap((task) => [task.task, ...flattenTaskNames(task.subTasks || [])])
        return flattenTaskNames(project.tasks)
      }),
    ]
    const maxLeftTextWidth = Math.max(...leftTexts.map((text) => getMeasuredTextWidth(text, font)), 200)
    const computedLeftPanelWidth = Math.min(
      LEFT_PANEL_MAX_WIDTH,
      Math.max(LEFT_PANEL_MIN_WIDTH, Math.ceil(maxLeftTextWidth + 170)),
    )

    const maxCategoryTextWidth = Math.max(
      getMeasuredTextWidth("Category", font),
      ...projects
        .flatMap((project) => {
          const flattenCategories = (tasks: Task[]): string[] =>
            tasks.flatMap((task) => [task.category || "", ...flattenCategories(task.subTasks || [])])
          return flattenCategories(project.tasks)
        })
        .map((text) => getMeasuredTextWidth(text, font)),
    )

    const maxDepartmentTextWidth = Math.max(
      getMeasuredTextWidth("Department", font),
      ...departmentOptions.map((text) => getMeasuredTextWidth(text, font)),
      ...projects.flatMap((project) => {
        const flattenDepartments = (tasks: Task[]): string[] =>
          tasks.flatMap((task) => [task.department || "", ...flattenDepartments(task.subTasks || [])])
        return flattenDepartments(project.tasks)
      }).map((text) => getMeasuredTextWidth(text, font)),
    )

    const maxOwnerTextWidth = Math.max(
      getMeasuredTextWidth("Owner", font),
      ...ownerOptions.map((text) => getMeasuredTextWidth(text, font)),
      ...projects.flatMap((project) => {
        const flattenOwners = (tasks: Task[]): string[] =>
          tasks.flatMap((task) => [task.person || "", ...flattenOwners(task.subTasks || [])])
        return flattenOwners(project.tasks)
      }).map((text) => getMeasuredTextWidth(text, font)),
    )

    const categoryColumnWidth = Math.max(68, Math.min(96, Math.ceil(maxCategoryTextWidth + 24)))
    const departmentColumnWidth = Math.max(108, Math.min(240, Math.ceil(maxDepartmentTextWidth + 42)))
    const ownerColumnWidth = Math.max(190, Math.min(380, Math.ceil(maxOwnerTextWidth + 54)))
    const startColumnWidth = Math.max(110, Math.ceil(getMeasuredTextWidth("12월 30일", font) + 48))
    const endColumnWidth = Math.max(110, Math.ceil(getMeasuredTextWidth("12월 30일", font) + 48))
    const manDayColumnWidth = Math.max(40, Math.ceil(getMeasuredTextWidth("99.5", font) + 28))

    const computedDetailPanelWidth = Math.min(
      DETAIL_PANEL_MAX_WIDTH,
      Math.max(
        DETAIL_PANEL_MIN_WIDTH,
        categoryColumnWidth +
          departmentColumnWidth +
          ownerColumnWidth +
          startColumnWidth +
          endColumnWidth +
          manDayColumnWidth +
          40,
      ),
    )

    return {
      leftPanelWidth: computedLeftPanelWidth,
      detailPanelWidth: computedDetailPanelWidth,
      detailGridTemplate: `${categoryColumnWidth}px ${departmentColumnWidth}px ${ownerColumnWidth}px ${startColumnWidth}px ${endColumnWidth}px ${manDayColumnWidth}px`,
    }
  }, [projects, departmentOptions, ownerOptions])

  const allDays = useMemo(() => {
    const today = new Date()
    const days: Array<{
      year: number
      month: number
      day: number
      label: string
      dow: string
      isWeekend: boolean
      isToday: boolean
    }> = []

    for (const m of months) {
      const daysInMonth = getDaysInMonth(m.year, m.month)
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = getDayOfWeek(m.year, m.month, d)
        days.push({
          year: m.year,
          month: m.month,
          day: d,
          label: `${d}`,
          dow,
          isWeekend: dow === "토" || dow === "일",
          isToday:
            today.getFullYear() === m.year && today.getMonth() === m.month && today.getDate() === d,
        })
      }
    }
    return days
  }, [months])

  const dayIndexByMonthDay = useMemo(() => {
    const map = new Map<string, number>()
    allDays.forEach((d, index) => {
      map.set(`${d.month}-${d.day}`, index)
    })
    return map
  }, [allDays])

  const taskById = useMemo(() => {
    const map = new Map<string, Task>()
    const walk = (tasks: Task[]) => {
      tasks.forEach((task) => {
        map.set(task.id, task)
        if (task.subTasks?.length) walk(task.subTasks)
      })
    }
    projects.forEach((project) => walk(project.tasks))
    return map
  }, [projects])

  const timelineWidth = allDays.length * CELL_WIDTH
  const showDetailColumns = isDetailColumnsOpen
  const isAllExpanded = collapsedProjectIds.size === 0 && collapsedTaskIds.size === 0

  const toggleAllRows = () => {
    if (isAllExpanded) {
      setCollapsedProjectIds(new Set(allProjectIds))
      setCollapsedTaskIds(new Set(allCollapsibleTaskIds))
      return
    }

    setCollapsedProjectIds(new Set())
    setCollapsedTaskIds(new Set())
  }

  useEffect(() => {
    const timelineScroller = timelineScrollRef.current
    if (!timelineScroller) return

    const daysBeforeCurrentMonth = months
      .slice(0, 3)
      .reduce((sum, m) => sum + getDaysInMonth(m.year, m.month), 0)

    const currentMonthStartX = daysBeforeCurrentMonth * CELL_WIDTH
    const targetScrollLeft = Math.max(0, currentMonthStartX - CELL_WIDTH * 2)

    requestAnimationFrame(() => {
      timelineScroller.scrollLeft = targetScrollLeft
      setTimelineScrollLeft(targetScrollLeft)
    })
  }, [months])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const flushScrollState = () => {
      scrollRafRef.current = null
      setScrollTop((prev) => (prev === pendingScrollTopRef.current ? prev : pendingScrollTopRef.current))
    }

    const onScroll = () => {
      pendingScrollTopRef.current = container.scrollTop
      if (scrollRafRef.current !== null) return
      scrollRafRef.current = window.requestAnimationFrame(flushScrollState)
    }

    const updateViewportHeight = () => {
      setViewportHeight((prev) => (prev === container.clientHeight ? prev : container.clientHeight))
    }

    pendingScrollTopRef.current = container.scrollTop
    setScrollTop(container.scrollTop)
    updateViewportHeight()

    container.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", updateViewportHeight)
    return () => {
      container.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", updateViewportHeight)
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [])

  const virtualizedBody = useMemo(() => {
    const overscanPx = VIRTUAL_OVERSCAN_ROWS * TASK_ROW_HEIGHT
    const bodyScrollTop = Math.max(0, scrollTop - HEADER_APPROX_HEIGHT)
    const windowTop = Math.max(0, bodyScrollTop - overscanPx)
    const windowBottom = bodyScrollTop + viewportHeight + overscanPx

    type Item = {
      project: FilteredProject
      isProjectCollapsed: boolean
      topTaskSpacer: number
      bottomTaskSpacer: number
      startTaskIndex: number
      endTaskIndex: number
      startY: number
      endY: number
    }

    const items: Item[] = []
    let cursorY = 0

    for (const project of filteredProjects) {
      const isProjectCollapsed = collapsedProjectIds.has(project.id)
      const taskCount = isProjectCollapsed ? 0 : project.tasks.length
      const projectStartY = cursorY
      const projectEndY = projectStartY + PROJECT_ROW_HEIGHT + taskCount * TASK_ROW_HEIGHT
      cursorY = projectEndY

      if (projectEndY < windowTop || projectStartY > windowBottom) continue

      let startTaskIndex = 0
      let endTaskIndex = taskCount
      let topTaskSpacer = 0
      let bottomTaskSpacer = 0

      if (!isProjectCollapsed && taskCount > 0) {
        const tasksStartY = projectStartY + PROJECT_ROW_HEIGHT
        const rawStart = Math.floor((windowTop - tasksStartY) / TASK_ROW_HEIGHT)
        const rawEnd = Math.ceil((windowBottom - tasksStartY) / TASK_ROW_HEIGHT)
        startTaskIndex = Math.max(0, Math.min(taskCount, rawStart))
        endTaskIndex = Math.max(startTaskIndex, Math.min(taskCount, rawEnd))
        topTaskSpacer = startTaskIndex * TASK_ROW_HEIGHT
        bottomTaskSpacer = (taskCount - endTaskIndex) * TASK_ROW_HEIGHT
      }

      items.push({
        project,
        isProjectCollapsed,
        topTaskSpacer,
        bottomTaskSpacer,
        startTaskIndex,
        endTaskIndex,
        startY: projectStartY,
        endY: projectEndY,
      })
    }

    const totalHeight = cursorY
    const topSpacer = items.length > 0 ? items[0].startY : totalHeight
    const bottomSpacer = items.length > 0 ? Math.max(0, totalHeight - items[items.length - 1].endY) : 0

    return { items, topSpacer, bottomSpacer }
  }, [filteredProjects, collapsedProjectIds, scrollTop, viewportHeight])

  const getBarPosition = (startStr: string, endStr: string) => {
    const start = parseDate(startStr)
    const end = parseDate(endStr)

    if (!start || !end) return null

    const startIdx = dayIndexByMonthDay.get(`${start.month}-${start.day}`) ?? -1
    const endIdx = dayIndexByMonthDay.get(`${end.month}-${end.day}`) ?? -1

    if (startIdx === -1 || endIdx === -1) return null

    return {
      left: startIdx * CELL_WIDTH,
      width: (endIdx - startIdx + 1) * CELL_WIDTH,
    }
  }

  const handleMouseDown = (
    e: React.MouseEvent,
    task: Task,
    type: "move" | "resize-left" | "resize-right",
  ) => {
    e.preventDefault()
    e.stopPropagation()

    const pos = getBarPosition(task.startDate, task.endDate)
    if (!pos) return

    setDragInfo({
      taskId: task.id,
      type,
      initialX: e.clientX,
      initialLeft: pos.left,
      initialWidth: pos.width,
    })
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragInfo) return

      const barElement = document.getElementById(`bar-${dragInfo.taskId}`)
      if (!barElement) return

      const deltaX = e.clientX - dragInfo.initialX

      if (dragInfo.type === "move") {
        barElement.style.left = `${dragInfo.initialLeft + deltaX}px`
      } else if (dragInfo.type === "resize-left") {
        const newLeft = dragInfo.initialLeft + deltaX
        const newWidth = dragInfo.initialWidth - deltaX

        if (newWidth >= CELL_WIDTH) {
          barElement.style.left = `${newLeft}px`
          barElement.style.width = `${newWidth}px`
        }
      } else if (dragInfo.type === "resize-right") {
        const newWidth = dragInfo.initialWidth + deltaX

        if (newWidth >= CELL_WIDTH) {
          barElement.style.width = `${newWidth}px`
        }
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragInfo) return

      const deltaX = e.clientX - dragInfo.initialX
      const daysDelta = Math.round(deltaX / CELL_WIDTH)

      const task = taskById.get(dragInfo.taskId)

      if (task && daysDelta !== 0) {
        const start = parseDate(task.startDate)
        const end = parseDate(task.endDate)

        if (start && end) {
          const startIdx = allDays.findIndex((d) => d.month === start.month && d.day === start.day)
          const endIdx = allDays.findIndex((d) => d.month === end.month && d.day === end.day)

          let nextStart = startIdx
          let nextEnd = endIdx

          if (dragInfo.type === "move") {
            nextStart = Math.max(0, Math.min(startIdx + daysDelta, allDays.length - 1))
            nextEnd = Math.max(nextStart, Math.min(endIdx + daysDelta, allDays.length - 1))
          } else if (dragInfo.type === "resize-left") {
            nextStart = Math.max(0, Math.min(startIdx + daysDelta, endIdx))
          } else if (dragInfo.type === "resize-right") {
            nextEnd = Math.max(startIdx, Math.min(endIdx + daysDelta, allDays.length - 1))
          }

          onEditTask({
            ...task,
            startDate: formatDateKorean(new Date(new Date().getFullYear(), allDays[nextStart].month, allDays[nextStart].day)),
            endDate: formatDateKorean(new Date(new Date().getFullYear(), allDays[nextEnd].month, allDays[nextEnd].day)),
          })
        }
      }

      setDragInfo(null)
    }

    if (dragInfo) {
      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", handleMouseUp)
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [dragInfo, allDays, dayIndexByMonthDay, onEditTask, taskById])

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden flex flex-col h-[65vh]">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
        <div className="relative min-w-fit flex flex-col isolate">
          <div className="sticky top-0 z-40 flex bg-card border-b border-border shadow-sm">
            <div
              className="sticky left-0 z-[80] shrink-0 border-r border-border bg-card px-4 py-3 flex items-end overflow-hidden"
              style={{ width: leftPanelWidth }}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  Project & Task Details
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={toggleAllRows}
                >
                  {isAllExpanded ? <ChevronsUp className="h-3.5 w-3.5" /> : <ChevronsDown className="h-3.5 w-3.5" />}
                  {isAllExpanded ? "전체 접기" : "전체 펼치기"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => setIsDetailColumnsOpen((prev) => !prev)}
                >
                  <PanelRight className="h-3.5 w-3.5" />
                  {showDetailColumns ? "상세 숨기기" : "상세 보기"}
                </Button>
              </div>
            </div>

            {showDetailColumns && (
              <div
                className="sticky z-50 shrink-0 border-r border-border bg-card px-3 py-2"
                style={{ left: leftPanelWidth, width: detailPanelWidth }}
              >
                <div
                  className="grid gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                  style={{ gridTemplateColumns: detailGridTemplate }}
                >
                  <span>Category</span>
                  <span>Department</span>
                  <span>Owner</span>
                  <span>Start</span>
                  <span>End</span>
                  <span>Man-day</span>
                </div>
              </div>
            )}

            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="border-b border-border bg-muted/20">
                <div
                  className="flex will-change-transform"
                  style={{ width: timelineWidth, transform: `translateX(-${timelineScrollLeft}px)` }}
                >
                  {months.map((m) => (
                    <div
                      key={`${m.year}-${m.month}`}
                      style={{ width: getDaysInMonth(m.year, m.month) * CELL_WIDTH }}
                      className="border-r border-border px-2 py-2 text-center text-[10px] font-bold text-card-foreground"
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-card">
                <div
                  className="flex will-change-transform"
                  style={{ width: timelineWidth, transform: `translateX(-${timelineScrollLeft}px)` }}
                >
                  {allDays.map((d, i) => (
                    <div
                      key={i}
                      style={{ width: CELL_WIDTH }}
                      className={cn(
                        "shrink-0 border-r border-border/40 py-1.5 text-center",
                        d.isWeekend && "bg-muted/50",
                        d.isToday && "bg-yellow-100",
                      )}
                    >
                      <div className="text-[10px] leading-tight font-medium text-muted-foreground">{d.label}</div>
                      <div
                        className={cn(
                          "text-[8px] leading-tight font-bold",
                          d.isToday ? "text-yellow-700" : d.isWeekend ? "text-rose-400" : "text-muted-foreground/60",
                        )}
                      >
                        {d.dow}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col">
            {virtualizedBody.topSpacer > 0 && <div style={{ height: virtualizedBody.topSpacer }} />}
            {virtualizedBody.items.map((virtualItem) => {
              const project = virtualItem.project
              const isProjectCollapsed = virtualItem.isProjectCollapsed

              return (
                <div key={project.id}>
                  <div className="flex min-h-9 border-b border-border bg-muted/40 sticky top-[70px] z-30">
                    <div
                      className="sticky left-0 z-30 flex shrink-0 items-center gap-2 border-r border-border bg-muted/40 px-4 py-1.5 shadow-[2px_0_5px_rgba(0,0,0,0.05)] overflow-hidden"
                      style={{ width: leftPanelWidth }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleProjectCollapse(project.id)}
                        className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent"
                        aria-label={isProjectCollapsed ? "Expand project" : "Collapse project"}
                      >
                        {isProjectCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </button>
                      <ProjectTypeBadge type={project.type} />
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate text-xs font-bold text-card-foreground">{project.name}</span>
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                          <AddTaskDialog
                            projectId={project.id}
                            onAddTask={handleAddProjectLevelTask}
                            trigger={
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 shrink-0 px-2 text-[10px]"
                              >
                                업무 추가
                              </Button>
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => onMoveProject(project.id, "up")}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => onMoveProject(project.id, "down")}
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {showDetailColumns && (
                      <div
                        className="sticky z-30 shrink-0 border-r border-border bg-muted/40 px-3 py-1.5"
                        style={{ left: leftPanelWidth, width: detailPanelWidth }}
                      />
                    )}

                    <div className="min-w-0 flex-1 h-7" />
                  </div>

                  {!isProjectCollapsed && (
                    <>
                      {virtualItem.topTaskSpacer > 0 && <div style={{ height: virtualItem.topTaskSpacer }} />}
                      {project.tasks
                        .slice(virtualItem.startTaskIndex, virtualItem.endTaskIndex)
                        .map((task) => {
                      const bar = getBarPosition(task.startDate, task.endDate)
                      const isTaskCollapsed = collapsedTaskIds.has(task.id)
                      const barStyle = getStatusBarStyle(task.status)
                      const isParentTask = task.hasChildren

                      const currentOwners = parseOwners(task.person || "")
                      const ownerValues = Array.from(new Set([...ownerOptions, ...currentOwners])).filter(Boolean)
                      const currentDepartments = parseDepartments(task.department || "")
                      const departmentValues = Array.from(new Set([...departmentOptions, ...currentDepartments])).filter(Boolean)

                          return (
                        <div key={task.id} id={`task-row-${task.id}`}>
                          <div className="group/task flex border-b border-border/50 transition-colors hover:bg-accent/5">
                            <div
                              className="sticky left-0 z-20 flex shrink-0 items-center border-r border-border bg-card px-4 py-1.5 group-hover/task:bg-accent/10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] overflow-hidden"
                              style={{ width: leftPanelWidth }}
                            >
                              <div className="flex items-center gap-1.5 w-full min-w-0">
                                <div style={{ width: task.depth * 12 }} className="shrink-0" />

                                {task.hasChildren ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleTaskCollapse(task.id)}
                                    className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent"
                                    aria-label={isTaskCollapsed ? "Expand sub tasks" : "Collapse sub tasks"}
                                  >
                                    {isTaskCollapsed ? (
                                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                    ) : (
                                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="w-5" />
                                )}

                                {isParentTask ? (
                                  <div className="flex min-w-0 flex-1 items-center">
                                    <button
                                      type="button"
                                      onClick={() => toggleCompletedCollapse(task.id)}
                                      className="order-last ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[11px] leading-none text-muted-foreground hover:bg-accent"
                                      title={collapsedCompletedParentIds.has(task.id) ? "완료 업무 접기" : "완료 업무 펼치기"}
                                    >
                                      {collapsedCompletedParentIds.has(task.id) ? "-" : "+"}
                                    </button>
                                    <span
                                      className={cn(
                                        "truncate text-xs font-bold",
                                        task.category === "중요" ? "text-red-600" : "text-foreground",
                                      )}
                                      title={task.task}
                                    >
                                      {task.task}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <EditTaskDialog
                                      task={task}
                                      onEditTask={onEditTask}
                                      trigger={
                                        <button className="min-w-0 flex-1 truncate text-left text-xs font-normal transition-colors hover:text-primary">
                                          <span
                                            className={cn(
                                              "truncate",
                                              task.category === "중요"
                                                ? "text-red-600"
                                                : task.status === "완료"
                                                  ? "text-muted-foreground/50"
                                                  : "text-foreground",
                                            )}
                                            title={task.task}
                                          >
                                            {task.task}
                                          </span>
                                        </button>
                                      }
                                    />
                                    <div className="w-[66px] shrink-0">
                                      <StatusInlineSelect
                                        value={task.status}
                                        onChange={(value) => updateTaskInline(task, { status: value })}
                                      />
                                    </div>
                                  </div>
                                )}

                                <AddTaskDialog
                                  projectId={task.projectId}
                                  parentId={task.id}
                                  onAddTask={handleAddNestedSubTask}
                                  trigger={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 shrink-0 opacity-0 group-hover/task:opacity-100"
                                    >
                                      <Plus className="h-3 w-3" />
                                    </Button>
                                  }
                                />

                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="ml-0.5 h-6 w-6 shrink-0 opacity-0 group-hover/task:opacity-100"
                                  onClick={() => {
                                    if (confirm("Delete this task?")) {
                                      onDeleteTask(task.id, task.projectId)
                                    }
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0 opacity-0 group-hover/task:opacity-100"
                                  onClick={() => onMoveTask(task.projectId, task.id, "up")}
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0 opacity-0 group-hover/task:opacity-100"
                                  onClick={() => onMoveTask(task.projectId, task.id, "down")}
                                >
                                  <ArrowDown className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>

                            {showDetailColumns && (
                              <div
                                className="sticky z-20 shrink-0 border-r border-border px-3 py-1 shadow-[2px_0_5px_rgba(0,0,0,0.03)] bg-background group-hover/task:bg-accent/10 overflow-hidden"
                                style={{ left: leftPanelWidth, width: detailPanelWidth }}
                              >
                                {!isParentTask ? (
                                  <div
                                    className="grid gap-1 text-[11px] text-foreground"
                                    style={{ gridTemplateColumns: detailGridTemplate }}
                                  >
                                    <CategorySingleSelect
                                      value={task.category}
                                      onChange={(value) => updateTaskInline(task, { category: value })}
                                    />

                                    <DepartmentMultiSelect
                                      value={task.department || ""}
                                      options={departmentValues}
                                      onChange={(value) => updateTaskInline(task, { department: value })}
                                    />

                                    <OwnerMultiSelect
                                      value={task.person || ""}
                                      options={ownerValues}
                                      onChange={(value) => updateTaskInline(task, { person: value })}
                                    />

                                    <DateCell
                                      value={task.startDate}
                                      onChange={(value) => updateTaskInline(task, { startDate: value })}
                                    />

                                    <DateCell
                                      value={task.endDate}
                                      onChange={(value) => updateTaskInline(task, { endDate: value })}
                                    />

                                    <input
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      value={Number.isFinite(task.manDays) ? task.manDays : 0}
                                      onChange={(e) => {
                                        const next = Number.parseFloat(e.target.value)
                                        updateTaskInline(task, { manDays: Number.isNaN(next) ? 0 : next })
                                      }}
                                      className="h-7 w-full rounded-md border border-input bg-background px-2 text-[11px]"
                                    />
                                  </div>
                                ) : (
                                  <div className="h-7" />
                                )}
                              </div>
                            )}

                            <div className="relative z-0 min-w-0 flex-1 h-9 overflow-hidden">
                              <div
                                className="relative h-full will-change-transform"
                                style={{ width: timelineWidth, transform: `translateX(-${timelineScrollLeft}px)` }}
                              >
                                {allDays.map((d, i) => (
                                  <div
                                    key={i}
                                    className="absolute inset-y-0 pointer-events-none border-r border-border/25"
                                    style={{ left: i * CELL_WIDTH, width: CELL_WIDTH }}
                                  >
                                    {d.isWeekend && <div className="absolute inset-0 bg-muted/15" />}
                                    {d.isToday && (
                                      <div className="absolute inset-0 bg-yellow-400/10 ring-1 ring-yellow-400/30 z-10" />
                                    )}
                                  </div>
                                ))}

                                {bar && !isParentTask && (
                                  <div
                                    id={`bar-${task.id}`}
                                    title={`${task.task} (${task.startDate} ~ ${task.endDate})`}
                                    className={cn(
                                      "absolute top-1/2 -translate-y-1/2 rounded-md h-6 shadow-sm transition-all select-none cursor-grab active:cursor-grabbing",
                                      barStyle.barClass,
                                      dragInfo?.taskId === task.id
                                        ? "opacity-100 scale-y-110 z-10 shadow-md ring-2 ring-white/50"
                                        : "opacity-90 hover:opacity-100",
                                    )}
                                    style={{ left: bar.left + 2, width: bar.width - 4 }}
                                    onMouseDown={(e) => handleMouseDown(e, task, "move")}
                                  >
                                    <div
                                      className="absolute left-0 top-0 bottom-0 w-3 cursor-w-resize hover:bg-black/10 rounded-l-md z-10"
                                      onMouseDown={(e) => handleMouseDown(e, task, "resize-left")}
                                    />
                                    <div
                                      className="absolute right-0 top-0 bottom-0 w-3 cursor-e-resize hover:bg-black/10 rounded-r-md z-10"
                                      onMouseDown={(e) => handleMouseDown(e, task, "resize-right")}
                                    />
                                    <div
                                      className={cn(
                                        "px-3 text-[10px] font-bold truncate h-full flex items-center pointer-events-none",
                                        barStyle.textClass,
                                      )}
                                    >
                                      {task.task}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                          )
                        })}
                      {virtualItem.bottomTaskSpacer > 0 && <div style={{ height: virtualItem.bottomTaskSpacer }} />}
                    </>
                  )}
                </div>
              )
            })}
            {virtualizedBody.bottomSpacer > 0 && <div style={{ height: virtualizedBody.bottomSpacer }} />}
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-card/80 px-3 py-1">
        <div
          ref={timelineScrollRef}
          className="overflow-x-auto overflow-y-hidden custom-scrollbar"
          onScroll={(e) => setTimelineScrollLeft((e.currentTarget as HTMLDivElement).scrollLeft)}
        >
          <div style={{ width: timelineWidth, height: 1 }} />
        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 5px;
          border: 2px solid #f1f1f1;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  )
}

function DateCell({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = parseDateToDate(value)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-7 justify-start px-2 text-[11px] font-normal">
          <CalendarIcon className="mr-1 h-3.5 w-3.5" />
          <span className="truncate">{value || "날짜 선택"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (!date) return
            onChange(formatDateKorean(date))
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}

function CategorySingleSelect({
  value,
  onChange,
}: {
  value: TaskCategory
  onChange: (value: TaskCategory) => void
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as TaskCategory)}>
      <SelectTrigger className="h-7 w-full justify-between px-2 text-[11px] font-normal">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="일반">일반</SelectItem>
        <SelectItem value="중요">중요</SelectItem>
        <SelectItem value="정기">정기</SelectItem>
        <SelectItem value="상시">상시</SelectItem>
      </SelectContent>
    </Select>
  )
}

function StatusInlineSelect({
  value,
  onChange,
}: {
  value: TaskStatus
  onChange: (value: TaskStatus) => void
}) {
  const statusClass =
    value === "완료"
      ? "bg-slate-100 text-slate-700"
      : value === "진행"
        ? "bg-blue-100 text-blue-700"
        : value === "대기"
          ? "bg-gray-100 text-gray-700"
          : value === "보류"
            ? "bg-yellow-100 text-yellow-800"
            : "bg-rose-100 text-rose-700"

  return (
    <Select value={value} onValueChange={(next) => onChange(next as TaskStatus)}>
      <SelectTrigger
        className={cn(
          "!h-5 w-10 justify-center rounded-full border-0 px-1.5 text-[10px] font-bold shadow-none ring-0 transition-colors [&>svg]:hidden",
          statusClass,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="진행">진행</SelectItem>
        <SelectItem value="대기">대기</SelectItem>
        <SelectItem value="보류">보류</SelectItem>
        <SelectItem value="미정">미정</SelectItem>
        <SelectItem value="완료">완료</SelectItem>
      </SelectContent>
    </Select>
  )
}

function parseOwners(value: string): string[] {
  return parseListValue(value)
}

function joinOwners(values: string[]): string {
  return joinListValue(values)
}

function parseDepartments(value: string): string[] {
  return parseListValue(value)
}

function joinDepartments(values: string[]): string {
  return joinListValue(values)
}

function DepartmentMultiSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  const selected = parseDepartments(value)
  const allOptions = Array.from(new Set([...options, ...selected])).filter(Boolean)

  const toggleDepartment = (department: string) => {
    const selectedSet = new Set(selected)
    if (selectedSet.has(department)) selectedSet.delete(department)
    else selectedSet.add(department)
    onChange(joinDepartments(Array.from(selectedSet)))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-7 w-full justify-between px-2 text-[11px] font-normal">
          <span className="truncate">{selected.length > 0 ? selected.join(", ") : "부서 선택"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-2">
        <div className="max-h-44 space-y-1 overflow-auto pr-1">
          {allOptions.map((department) => {
            const checked = selected.includes(department)
            return (
              <button
                key={department}
                type="button"
                onClick={() => toggleDepartment(department)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <input type="checkbox" readOnly checked={checked} className="h-3.5 w-3.5" />
                <span className="truncate">{department}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function OwnerMultiSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  const [newOwner, setNewOwner] = useState("")
  const selected = parseOwners(value)
  const allOptions = Array.from(new Set([...options, ...selected])).filter(Boolean)

  const toggleOwner = (owner: string) => {
    const selectedSet = new Set(selected)
    if (selectedSet.has(owner)) selectedSet.delete(owner)
    else selectedSet.add(owner)
    onChange(joinOwners(Array.from(selectedSet)))
  }

  const addCustomOwner = () => {
    const trimmed = newOwner.trim()
    if (!trimmed) return
    onChange(joinOwners([...selected, trimmed]))
    setNewOwner("")
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-7 w-full justify-between px-2 text-[11px] font-normal">
          <span className="truncate">{selected.length > 0 ? selected.join(", ") : "담당자 선택"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-2">
        <div className="mb-2 flex gap-1.5">
          <input
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addCustomOwner()
              }
            }}
            placeholder="직접 입력"
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          />
          <Button type="button" size="sm" className="h-8 px-2 text-xs" onClick={addCustomOwner}>
            추가
          </Button>
        </div>
        <div className="max-h-44 space-y-1 overflow-auto pr-1">
          {allOptions.map((owner) => {
            const checked = selected.includes(owner)
            return (
              <button
                key={owner}
                type="button"
                onClick={() => toggleOwner(owner)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <input type="checkbox" readOnly checked={checked} className="h-3.5 w-3.5" />
                <span className="truncate">{owner}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}


