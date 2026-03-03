"use client"

import { useState, useMemo } from "react"
import type { Project, Task, TaskStatus } from "@/lib/data"
import { StatusBadge, CategoryBadge, ProjectTypeBadge } from "@/components/status-badge"
import { ChevronDown, ChevronRight, User, Calendar, Briefcase, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { AddTaskDialog } from "./add-task-dialog"
import { EditTaskDialog } from "./edit-task-dialog"
import { Button } from "./ui/button"

interface ProjectListProps {
  projects: Project[]
  statusFilter: TaskStatus | "all"
  departmentFilter: string
  personFilter: string
  searchQuery: string
  onAddTask: (task: Task) => void
  onEditTask: (task: Task) => void
  onDeleteTask: (taskId: string, projectId: string) => void
}

export function ProjectList({
  projects,
  statusFilter,
  departmentFilter,
  personFilter,
  searchQuery,
  onAddTask,
  onEditTask,
  onDeleteTask,
}: ProjectListProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(projects.map((p) => p.id))
  )

  const filteredProjects = useMemo(() => {
    return projects
      .map((project) => {
        const filteredTasks = project.tasks.filter((task) => {
          if (statusFilter !== "all" && task.status !== statusFilter) return false
          if (departmentFilter !== "all" && !task.department.includes(departmentFilter))
            return false
          if (personFilter !== "all" && !task.person.includes(personFilter)) return false
          if (
            searchQuery &&
            !task.task.toLowerCase().includes(searchQuery.toLowerCase()) &&
            !project.name.toLowerCase().includes(searchQuery.toLowerCase())
          )
            return false
          return true
        })
        return { ...project, tasks: filteredTasks }
      })
      .filter((project) => {
        // 검색어가 있을 때: 업무가 검색되거나 프로젝트명이 검색되는 경우 표시
        if (searchQuery) {
          return project.tasks.length > 0 || project.name.toLowerCase().includes(searchQuery.toLowerCase())
        }
        // 다른 필터가 있을 때: 해당 필터에 맞는 업무가 있는 프로젝트만 표시
        if (statusFilter !== "all" || departmentFilter !== "all" || personFilter !== "all") {
          return project.tasks.length > 0
        }
        // 필터가 없을 때: 모든 프로젝트 표시
        return true
      })
  }, [projects, statusFilter, departmentFilter, personFilter, searchQuery])

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (filteredProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card py-16">
        <Briefcase className="mb-3 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">
          {"검색 결과가 없습니다"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          {"필터 조건을 변경해 보세요"}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {filteredProjects.map((project) => {
        const isExpanded = expandedProjects.has(project.id)
        const completedCount = project.tasks.filter((t) => t.status === "완료").length
        const totalCount = project.tasks.length
        const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

        return (
          <div
            key={project.id}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <div
              onClick={() => toggleProject(project.id)}
              className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
            >
              <span className="text-muted-foreground">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </span>
              <ProjectTypeBadge type={project.type} />
              <span className="font-semibold text-sm text-card-foreground">{project.name}</span>
              {project.period && (
                <span className="text-xs text-muted-foreground">{project.period}</span>
              )}
              <div className="ml-auto flex items-center gap-4">
                <div className="hidden items-center gap-2 sm:flex">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {completedCount}/{totalCount}
                  </span>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <AddTaskDialog projectId={project.id} onAddTask={onAddTask} />
                </div>
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-border">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px]">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                          {"업무내용"}
                        </th>
                        <th className="w-14 px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                          {"구분"}
                        </th>
                        <th className="w-16 px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                          {"부서"}
                        </th>
                        <th className="w-32 px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                          {"담당자"}
                        </th>
                        <th className="w-24 px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                          {"시작일"}
                        </th>
                        <th className="w-24 px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                          {"종료일"}
                        </th>
                        <th className="w-16 px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                          {"상태"}
                        </th>
                        <th className="w-14 px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                          {"공수"}
                        </th>
                        <th className="w-20 px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                          {"관리"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          onEditTask={onEditTask}
                          onDeleteTask={onDeleteTask}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TaskRow({
  task,
  onEditTask,
  onDeleteTask,
}: {
  task: Task
  onEditTask: (task: Task) => void
  onDeleteTask: (taskId: string, projectId: string) => void
}) {
  return (
    <tr className="border-b border-border/50 transition-colors last:border-b-0 hover:bg-accent/30">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          {task.isSubTask && (
            <span className="mr-1 text-xs text-primary">{"●"}</span>
          )}
          <span
            className={cn(
              "text-sm leading-snug",
              task.category === "중요" ? "font-semibold text-card-foreground" : "text-card-foreground"
            )}
          >
            {task.task}
          </span>
        </div>
      </td>
      <td className="px-2 py-2.5 text-center">
        <CategoryBadge category={task.category} />
      </td>
      <td className="px-2 py-2.5 text-center">
        <span className="text-xs text-muted-foreground">{task.department}</span>
      </td>
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-1.5">
          <User className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          <span className="text-xs text-muted-foreground">{task.person}</span>
        </div>
      </td>
      <td className="px-2 py-2.5 text-center">
        <span className="text-xs tabular-nums text-muted-foreground">{task.startDate}</span>
      </td>
      <td className="px-2 py-2.5 text-center">
        <span className="text-xs tabular-nums text-muted-foreground">{task.endDate}</span>
      </td>
      <td className="px-2 py-2.5 text-center">
        <StatusBadge status={task.status} />
      </td>
      <td className="px-2 py-2.5 text-center">
        <span className="text-xs tabular-nums text-muted-foreground">
          {task.manDays > 0 ? `${task.manDays}일` : "-"}
        </span>
      </td>
      <td className="px-2 py-2.5 text-center">
        <div className="flex items-center justify-center gap-1">
          <EditTaskDialog task={task} onEditTask={onEditTask} />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => {
              if (confirm("이 업무를 삭제하시겠습니까?")) {
                onDeleteTask(task.id, task.projectId)
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="sr-only">삭제</span>
          </Button>
        </div>
      </td>
    </tr>
  )
}
