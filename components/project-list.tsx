"use client"

import { useState, useMemo } from "react"
import type { Project, Task, TaskStatus } from "@/lib/data"
import { StatusBadge, CategoryBadge, ProjectTypeBadge } from "@/components/status-badge"
import { ChevronDown, ChevronRight, User, Trash2, Plus, Briefcase, ArrowUp, ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { AddTaskDialog } from "./add-task-dialog"
import { EditTaskDialog } from "./edit-task-dialog"
import { EditProjectDialog } from "./edit-project-dialog"
import { Button } from "./ui/button"

type TaskSortField = "task" | "startDate" | "endDate" | "status" | "manDays"
type SortDirection = "asc" | "desc"

interface ProjectListProps {
  projects: Project[]
  statusFilter: TaskStatus | "all"
  departmentFilter: string
  personFilter: string
  searchQuery: string
  onAddTask: (task: Task) => void
  onEditTask: (task: Task) => void
  onDeleteTask: (taskId: string, projectId: string) => void
  onEditProject: (project: Project) => void
  onDeleteProject: (projectId: string) => void
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
  onEditProject,
  onDeleteProject,
}: ProjectListProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(projects.map((p) => p.id))
  )
  
  // 업무 정렬 상태
  const [taskSortField, setTaskSortField] = useState<TaskSortField>("startDate")
  const [taskSortDirection, setTaskSortDirection] = useState<SortDirection>("asc")

  const handleTaskSort = (field: TaskSortField) => {
    if (taskSortField === field) {
      setTaskSortDirection(taskSortDirection === "asc" ? "desc" : "asc")
    } else {
      setTaskSortField(field)
      setTaskSortDirection("asc")
    }
  }

  const getAllTasksFlat = (tasks: Task[]): Task[] => {
    return tasks.reduce((acc, task) => {
      return [...acc, task, ...getAllTasksFlat(task.subTasks || [])]
    }, [] as Task[])
  }

  const filteredAndSortedProjects = useMemo(() => {
    return projects
      .map((project) => {
        const filterAndSortRecursive = (tasks: Task[]): Task[] => {
          // 1. 먼저 자식들을 정렬
          let processed = tasks.map(task => ({
            ...task,
            subTasks: filterAndSortRecursive(task.subTasks || [])
          }))

          // 2. 현재 레벨의 업무들을 정렬 기준에 따라 정렬
          processed.sort((a, b) => {
            let valA = a[taskSortField] || ""
            let valB = b[taskSortField] || ""
            
            // 상태 정렬을 위한 가중치 (선택 사항)
            if (taskSortField === "status") {
              const weights = { "진행": 1, "대기": 2, "미정": 3, "보류": 4, "완료": 5 }
              valA = weights[a.status as keyof typeof weights] || 9
              valB = weights[b.status as keyof typeof weights] || 9
            }

            if (valA < valB) return taskSortDirection === "asc" ? -1 : 1
            if (valA > valB) return taskSortDirection === "asc" ? 1 : -1
            return 0
          })

          // 3. 필터 적용
          return processed.filter(task => {
            const matchesFilter = (
              (statusFilter === "all" || task.status === statusFilter) &&
              (departmentFilter === "all" || task.department.includes(departmentFilter)) &&
              (personFilter === "all" || task.person.includes(personFilter)) &&
              (!searchQuery || task.task.toLowerCase().includes(searchQuery.toLowerCase()))
            )
            return matchesFilter || (task.subTasks && task.subTasks.length > 0)
          })
        }
        return { ...project, tasks: filterAndSortRecursive(project.tasks) }
      })
      .filter((project) => {
        if (searchQuery) {
          return project.tasks.length > 0 || project.name.toLowerCase().includes(searchQuery.toLowerCase())
        }
        if (statusFilter !== "all" || departmentFilter !== "all" || personFilter !== "all") {
          return project.tasks.length > 0
        }
        return true
      })
  }, [projects, statusFilter, departmentFilter, personFilter, searchQuery, taskSortField, taskSortDirection])

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const SortIcon = ({ field }: { field: TaskSortField }) => {
    if (taskSortField !== field) return null
    return taskSortDirection === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
  }

  if (filteredAndSortedProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card py-16">
        <Briefcase className="mb-3 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">{"검색 결과가 없습니다"}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {filteredAndSortedProjects.map((project) => {
        const isExpanded = expandedProjects.has(project.id)
        const flatTasks = getAllTasksFlat(project.tasks)
        const completedCount = flatTasks.filter((t) => t.status === "완료").length
        const totalCount = flatTasks.length
        const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

        return (
          <div key={project.id} className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div
              onClick={() => toggleProject(project.id)}
              className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
            >
              <span className="text-muted-foreground">
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
              <ProjectTypeBadge type={project.type} />
              <span className="font-semibold text-sm text-card-foreground">{project.name}</span>
              {project.period && (
                <span className="text-xs text-muted-foreground ml-2">
                  {project.period}
                  {(() => {
                    const match = project.period.match(/(\d{4})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})/)
                    if (match) {
                      const startYear = parseInt(match[1])
                      const startMonth = parseInt(match[2])
                      const endYear = parseInt(match[3])
                      const endMonth = parseInt(match[4])
                      const diffMonths = (endYear - startYear) * 12 + (endMonth - startMonth)
                      return ` (${diffMonths}개월)`
                    }
                    return ""
                  })()}
                </span>
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
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <AddTaskDialog projectId={project.id} onAddTask={onAddTask} />
                  <EditProjectDialog project={project} onEditProject={onEditProject} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onDeleteProject(project.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-border">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th 
                          className="px-4 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                          onClick={() => handleTaskSort("task")}
                        >
                          <div className="flex items-center">{"업무내용"}<SortIcon field="task" /></div>
                        </th>
                        <th className="w-14 px-2 py-2 text-center text-xs font-medium text-muted-foreground">{"구분"}</th>
                        <th className="w-16 px-2 py-2 text-center text-xs font-medium text-muted-foreground">{"부서"}</th>
                        <th className="w-32 px-2 py-2 text-left text-xs font-medium text-muted-foreground">{"담당자"}</th>
                        <th 
                          className="w-24 px-2 py-2 text-center text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                          onClick={() => handleTaskSort("startDate")}
                        >
                          <div className="flex items-center justify-center">{"시작일"}<SortIcon field="startDate" /></div>
                        </th>
                        <th 
                          className="w-24 px-2 py-2 text-center text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                          onClick={() => handleTaskSort("endDate")}
                        >
                          <div className="flex items-center justify-center">{"종료일"}<SortIcon field="endDate" /></div>
                        </th>
                        <th 
                          className="w-24 px-2 py-2 text-center text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                          onClick={() => handleTaskSort("status")}
                        >
                          <div className="flex items-center justify-center">{"상태"}<SortIcon field="status" /></div>
                        </th>
                        <th 
                          className="w-16 px-2 py-2 text-center text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                          onClick={() => handleTaskSort("manDays")}
                        >
                          <div className="flex items-center justify-center">{"공수"}<SortIcon field="manDays" /></div>
                        </th>
                        <th className="w-24 px-2 py-2 text-center text-xs font-medium text-muted-foreground">{"관리"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.tasks.map((task) => (
                        <RecursiveTaskRow
                          key={task.id}
                          task={task}
                          depth={0}
                          onEditTask={onEditTask}
                          onDeleteTask={onDeleteTask}
                          onAddTask={onAddTask}
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

function RecursiveTaskRow({
  task,
  depth,
  onEditTask,
  onDeleteTask,
  onAddTask,
}: {
  task: Task
  depth: number
  onEditTask: (task: Task) => void
  onDeleteTask: (taskId: string, projectId: string) => void
  onAddTask: (task: Task) => void
}) {
  const [isExpanded, setIsExpanded] = useState(true)
  const hasSubTasks = task.subTasks && task.subTasks.length > 0

  return (
    <>
      <tr className={cn(
        "border-b border-border/50 transition-colors last:border-b-0 hover:bg-accent/30",
        depth > 0 && "bg-muted/10"
      )}>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 20}px` }}>
            {hasSubTasks ? (
              <button onClick={() => setIsExpanded(!isExpanded)} className="flex h-4 w-4 items-center justify-center rounded hover:bg-accent">
                {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              </button>
            ) : (
              <div className="w-4" />
            )}
            
            <span className={cn(
              "text-sm leading-snug",
              hasSubTasks ? "font-semibold text-card-foreground" : "font-normal text-card-foreground",
              depth > 0 && "text-xs"
            )}>
              {task.task}
            </span>

            {depth < 3 && (
              <AddTaskDialog 
                projectId={task.projectId} 
                parentId={task.id} 
                onAddTask={onAddTask}
                trigger={
                  <Button variant="ghost" size="icon" className="ml-1 h-6 w-6 text-muted-foreground hover:text-primary">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                }
              />
            )}
          </div>
        </td>
        <td className="px-2 py-2.5 text-center"><CategoryBadge category={task.category} /></td>
        <td className="px-2 py-2.5 text-center"><span className="text-[10px] text-muted-foreground">{task.department}</span></td>
        <td className="px-2 py-2.5">
          <div className="flex items-center gap-1">
            <User className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{task.person}</span>
          </div>
        </td>
        <td className="px-2 py-2.5 text-center"><span className="text-[10px] tabular-nums text-muted-foreground">{task.startDate}</span></td>
        <td className="px-2 py-2.5 text-center"><span className="text-[10px] tabular-nums text-muted-foreground">{task.endDate}</span></td>
        <td className="px-2 py-2.5 text-center"><StatusBadge status={task.status} /></td>
        <td className="px-2 py-2.5 text-center">
          <span className="text-[10px] tabular-nums text-muted-foreground">{task.manDays > 0 ? `${task.manDays}일` : "-"}</span>
        </td>
        <td className="px-2 py-2.5 text-center">
          <div className="flex items-center justify-center gap-1">
            <EditTaskDialog task={task} onEditTask={onEditTask} />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => {
                if (confirm("이 업무(하위 업무 포함)를 삭제하시겠습니까?")) {
                  onDeleteTask(task.id, task.projectId)
                }
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </td>
      </tr>
      {isExpanded && hasSubTasks && (
        task.subTasks!.map((subTask) => (
          <RecursiveTaskRow
            key={subTask.id}
            task={subTask}
            depth={depth + 1}
            onEditTask={onEditTask}
            onDeleteTask={onDeleteTask}
            onAddTask={onAddTask}
          />
        ))
      )}
    </>
  )
}