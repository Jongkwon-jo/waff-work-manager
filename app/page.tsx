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
} from "@/lib/firestore-service"
import { StatusSummary } from "@/components/status-summary"
import { FilterBar, ProjectSortType } from "@/components/filter-bar"
import { ProjectList } from "@/components/project-list"
import { GanttView } from "@/components/gantt-view"
import { ProjectCardView } from "@/components/project-card-view"
import { CalendarDays, Building2, List, BarChart3, LayoutGrid } from "lucide-react"
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
  const deferredSearchQuery = useDeferredValue(searchQuery)

  useEffect(() => {
    setLoading(true)
    const unsubscribe = subscribeToData((data) => {
      setProjectList(data)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

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
      await addProjectToDB(projectData)
      toast.success("프로젝트가 추가되었습니다.")
    } catch (error) {
      toast.error("프로젝트 추가 실패")
    }
  }

  const handleEditProject = async (updatedProject: Project) => {
    try {
      const { id, tasks, ...projectData } = updatedProject
      await updateProjectInDB(id, projectData)
      toast.success("프로젝트 정보가 수정되었습니다.")
    } catch (error) {
      toast.error("프로젝트 수정 실패")
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    try {
      if (confirm("프로젝트를 삭제하면 모든 하위 업무도 함께 삭제됩니다. 계속하시겠습니까?")) {
        await deleteProjectFromDB(projectId)
        toast.success("프로젝트가 삭제되었습니다.")
      }
    } catch (error) {
      toast.error("프로젝트 삭제 실패")
    }
  }

  const handleAddTask = async (newTask: Task) => {
    const optimisticTask: Task = {
      ...newTask,
      subTasks: newTask.subTasks || [],
    }

    setProjectList((prev) =>
      prev.map((project) => {
        if (project.id !== newTask.projectId) return project

        if (newTask.parentId) {
          return {
            ...project,
            tasks: insertTaskIntoTree(project.tasks, newTask.parentId, optimisticTask),
          }
        }

        return {
          ...project,
          tasks: [optimisticTask, ...project.tasks],
        }
      }),
    )

    try {
      const { id, subTasks, ...taskData } = newTask
      const sanitizedTaskData = { ...taskData } as Omit<Task, "id">
      if (sanitizedTaskData.parentId === undefined) {
        delete sanitizedTaskData.parentId
      }
      if (sanitizedTaskData.isSubTask === undefined) {
        delete sanitizedTaskData.isSubTask
      }

      await addTaskToDB(sanitizedTaskData)
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
      const { id, subTasks, ...updates } = updatedTask
      await updateTaskInDB(id, updates)
      toast.success("업무가 수정되었습니다.")
    } catch (error) {
      toast.error("업무 수정 실패")
    }
  }

  const handleDeleteTask = async (taskId: string, projectId: string) => {
    try {
      await deleteTaskFromDB(taskId)
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
    let movedSiblingIds: string[] | null = null

    setProjectList((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project
        const moved = moveTaskInTree(project.tasks, taskId, direction)
        movedSiblingIds = moved.movedSiblingIds
        return { ...project, tasks: moved.tasks }
      }),
    )

    if (!movedSiblingIds) return

    try {
      await updateTaskOrdersInDB(movedSiblingIds)
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
