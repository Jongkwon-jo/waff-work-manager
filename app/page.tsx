"use client"

import { useState, useMemo, useEffect } from "react"
import type { Project, Task, TaskStatus } from "@/lib/data"
import { getDepartmentList } from "@/lib/data"
import { 
  fetchProjectsWithTasks, 
  addProjectToDB, 
  addTaskToDB, 
  updateTaskInDB, 
  deleteTaskFromDB
} from "@/lib/firestore-service"
import { StatusSummary } from "@/components/status-summary"
import { FilterBar } from "@/components/filter-bar"
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
  const [viewMode, setViewMode] = useState<"list" | "gantt" | "card">("list")

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const data = await fetchProjectsWithTasks()
      setProjectList(data)
    } catch (error) {
      console.error("Error loading data:", error)
      toast.error("데이터를 불러오는 중 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  const allTasks = useMemo(() => projectList.flatMap((p) => p.tasks), [projectList])
  const persons = useMemo(() => {
    const personSet = new Set<string>()
    allTasks.forEach((t) => {
      t.person.split(",").forEach((p) => {
        const trimmed = p.trim()
        if (trimmed) personSet.add(trimmed)
      })
    })
    return Array.from(personSet).sort()
  }, [allTasks])
  const departments = getDepartmentList()

  const handleAddProject = async (newProject: Project) => {
    try {
      const { id, tasks, ...projectData } = newProject
      const newId = await addProjectToDB(projectData)
      setProjectList((prev) => [{ ...newProject, id: newId }, ...prev])
      toast.success("프로젝트가 추가되었습니다.")
    } catch (error) {
      toast.error("프로젝트 추가 실패")
    }
  }

  const handleAddTask = async (newTask: Task) => {
    try {
      const { id, ...taskData } = newTask
      const newId = await addTaskToDB(taskData)
      setProjectList((prev) =>
        prev.map((p) => {
          if (p.id === newTask.projectId) {
            return { ...p, tasks: [...p.tasks, { ...newTask, id: newId }] }
          }
          return p
        })
      )
      toast.success("업무가 추가되었습니다.")
    } catch (error) {
      toast.error("업무 추가 실패")
    }
  }

  const handleEditTask = async (updatedTask: Task) => {
    try {
      const { id, ...updates } = updatedTask
      await updateTaskInDB(id, updates)
      setProjectList((prev) =>
        prev.map((p) => {
          if (p.id === updatedTask.projectId) {
            return {
              ...p,
              tasks: p.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
            }
          }
          return p
        })
      )
      toast.success("업무가 수정되었습니다.")
    } catch (error) {
      toast.error("업무 수정 실패")
    }
  }

  const handleDeleteTask = async (taskId: string, projectId: string) => {
    try {
      await deleteTaskFromDB(taskId)
      setProjectList((prev) =>
        prev.map((p) => {
          if (p.id === projectId) {
            return {
              ...p,
              tasks: p.tasks.filter((t) => t.id !== taskId),
            }
          }
          return p
        })
      )
      toast.success("업무가 삭제되었습니다.")
    } catch (error) {
      toast.error("업무 삭제 실패")
    }
  }

  const counts = useMemo(() => {
    return {
      total: allTasks.length,
      "완료": allTasks.filter((t) => t.status === "완료").length,
      "진행": allTasks.filter((t) => t.status === "진행").length,
      "대기": allTasks.filter((t) => t.status === "대기").length,
      "보류": allTasks.filter((t) => t.status === "보류").length,
      "미정": allTasks.filter((t) => t.status === "미정").length,
    }
  }, [allTasks])

  const today = new Date()
  const formattedDate = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <Building2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-bold text-card-foreground leading-tight">
                {"전략기획부 사업일정표"}
              </h1>
              <p className="text-xs text-muted-foreground">
                {"업무 관리 대시보드"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="mr-2 flex overflow-hidden rounded-md border border-border">
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                  viewMode === "list"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent"
                )}
              >
                <List className="h-3.5 w-3.5" />
                {"목록"}
              </button>
              <button
                onClick={() => setViewMode("gantt")}
                className={cn(
                  "flex items-center gap-1.5 border-l border-border px-3 py-1.5 text-xs font-medium transition-colors",
                  viewMode === "gantt"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent"
                )}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                {"간트"}
              </button>
              <button
                onClick={() => setViewMode("card")}
                className={cn(
                  "flex items-center gap-1.5 border-l border-border px-3 py-1.5 text-xs font-medium transition-colors",
                  viewMode === "card"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent"
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                {"카드"}
              </button>
            </div>
            <CalendarDays className="h-3.5 w-3.5" />
            <span>{formattedDate}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 lg:px-6">
        {loading ? (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="text-sm text-muted-foreground">데이터를 불러오는 중...</p>
          </div>
        ) : (
          <div className="space-y-5">
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
              departments={departments}
              persons={persons}
              onAddProject={handleAddProject}
            />
            {projectList.length === 0 ? (
              <div className="flex h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 text-center p-8">
                <Building2 className="h-10 w-10 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-semibold">표시할 데이터가 없습니다</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  새로운 프로젝트를 추가하여 업무 관리를 시작해 보세요.
                </p>
              </div>
            ) : viewMode === "list" ? (
              <ProjectList
                projects={projectList}
                statusFilter={statusFilter}
                departmentFilter={departmentFilter}
                personFilter={personFilter}
                searchQuery={searchQuery}
                onAddTask={handleAddTask}
                onEditTask={handleEditTask}
                onDeleteTask={handleDeleteTask}
              />
            ) : viewMode === "gantt" ? (
              <GanttView
                projects={projectList}
                statusFilter={statusFilter}
                departmentFilter={departmentFilter}
                personFilter={personFilter}
                searchQuery={searchQuery}
              />
            ) : (
              <ProjectCardView
                projects={projectList}
                statusFilter={statusFilter}
                departmentFilter={departmentFilter}
                personFilter={personFilter}
                searchQuery={searchQuery}
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
