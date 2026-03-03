"use client"

import { useMemo } from "react"
import type { Project, TaskStatus } from "@/lib/data"
import { ProjectTypeBadge, StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"

interface GanttViewProps {
  projects: Project[]
  statusFilter: TaskStatus | "all"
  departmentFilter: string
  personFilter: string
  searchQuery: string
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getDayOfWeek(year: number, month: number, day: number) {
  const days = ["일", "월", "화", "수", "목", "금", "토"]
  return days[new Date(year, month, day).getDay()]
}

function parseDate(dateStr: string): { month: number; day: number } | null {
  const match = dateStr.match(/(\d{1,2})월\s*(\d{1,2})일/)
  if (match) {
    return { month: parseInt(match[1]) - 1, day: parseInt(match[2]) }
  }
  return null
}

const CELL_WIDTH = 28
const MONTHS = [
  { year: 2026, month: 1, label: "2월" },
  { year: 2026, month: 2, label: "3월" },
  { year: 2026, month: 3, label: "4월" },
]

export function GanttView({
  projects,
  statusFilter,
  departmentFilter,
  personFilter,
  searchQuery,
}: GanttViewProps) {
  const filteredProjects = useMemo(() => {
    return projects
      .map((project) => {
        const filteredTasks = project.tasks.filter((task) => {
          if (statusFilter !== "all" && task.status !== statusFilter) return false
          if (departmentFilter !== "all" && !task.department.includes(departmentFilter)) return false
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
        if (searchQuery) {
          return project.tasks.length > 0 || project.name.toLowerCase().includes(searchQuery.toLowerCase())
        }
        if (statusFilter !== "all" || departmentFilter !== "all" || personFilter !== "all") {
          return project.tasks.length > 0
        }
        return true
      })
  }, [projects, statusFilter, departmentFilter, personFilter, searchQuery])

  const allDays: { year: number; month: number; day: number; label: string; dow: string; isWeekend: boolean; isToday: boolean }[] = useMemo(() => {
    const today = new Date()
    const days: typeof allDays = []
    for (const m of MONTHS) {
      const daysInMonth = getDaysInMonth(m.year, m.month)
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = getDayOfWeek(m.year, m.month, d)
        const isWeekend = dow === "토" || dow === "일"
        const isToday =
          today.getFullYear() === m.year && today.getMonth() === m.month && today.getDate() === d
        days.push({
          year: m.year,
          month: m.month,
          day: d,
          label: `${d}`,
          dow,
          isWeekend,
          isToday,
        })
      }
    }
    return days
  }, [])

  const getBarPosition = (startStr: string, endStr: string) => {
    const start = parseDate(startStr)
    const end = parseDate(endStr)
    if (!start || !end) return null

    const startIdx = allDays.findIndex(
      (d) => d.month === start.month && d.day === start.day
    )
    const endIdx = allDays.findIndex(
      (d) => d.month === end.month && d.day === end.day
    )

    if (startIdx === -1 || endIdx === -1) return null
    return { left: startIdx * CELL_WIDTH, width: Math.max((endIdx - startIdx + 1) * CELL_WIDTH - 4, 8) }
  }

  const statusColor: Record<TaskStatus, string> = {
    "완료": "bg-emerald-400",
    "진행": "bg-blue-400",
    "대기": "bg-amber-400",
    "보류": "bg-slate-300",
    "미정": "bg-rose-300",
  }

  const totalWidth = allDays.length * CELL_WIDTH

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <div className="min-w-fit">
          {/* Header */}
          <div className="flex border-b border-border">
            <div className="sticky left-0 z-20 w-72 shrink-0 border-r border-border bg-card px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">{"업무내용"}</span>
            </div>
            <div style={{ width: totalWidth }} className="shrink-0">
              {/* Month headers */}
              <div className="flex border-b border-border">
                {MONTHS.map((m) => {
                  const days = getDaysInMonth(m.year, m.month)
                  return (
                    <div
                      key={`${m.year}-${m.month}`}
                      style={{ width: days * CELL_WIDTH }}
                      className="border-r border-border px-2 py-1 text-center text-xs font-semibold text-card-foreground"
                    >
                      {`${m.year}년 ${m.label}`}
                    </div>
                  )
                })}
              </div>
              {/* Day headers */}
              <div className="flex">
                {allDays.map((d, i) => (
                  <div
                    key={i}
                    style={{ width: CELL_WIDTH }}
                    className={cn(
                      "shrink-0 border-r border-border py-0.5 text-center",
                      d.isWeekend && "bg-muted/50",
                      d.isToday && "bg-primary/10"
                    )}
                  >
                    <div className="text-[9px] leading-tight text-muted-foreground">{d.label}</div>
                    <div
                      className={cn(
                        "text-[8px] leading-tight",
                        d.isWeekend ? "text-rose-400" : "text-muted-foreground/60"
                      )}
                    >
                      {d.dow}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Body */}
          {filteredProjects.map((project) => (
            <div key={project.id}>
              {/* Project header row */}
              <div className="flex border-b border-border bg-muted/30">
                <div className="sticky left-0 z-20 flex w-72 shrink-0 items-center gap-2 border-r border-border bg-muted/30 px-3 py-1.5">
                  <ProjectTypeBadge type={project.type} />
                  <span className="truncate text-xs font-semibold text-card-foreground">
                    {project.name}
                  </span>
                </div>
                <div style={{ width: totalWidth }} className="shrink-0" />
              </div>

              {/* Task rows */}
              {project.tasks.map((task) => {
                const bar = getBarPosition(task.startDate, task.endDate)
                return (
                  <div
                    key={task.id}
                    className="group flex border-b border-border/50 transition-colors hover:bg-accent/20"
                  >
                    <div className="sticky left-0 z-20 flex w-72 shrink-0 items-center gap-2 border-r border-border bg-card px-3 py-1.5 group-hover:bg-accent/20">
                      <StatusBadge status={task.status} />
                      <span className="truncate text-xs text-card-foreground" title={task.task}>
                        {task.task}
                      </span>
                    </div>
                    <div style={{ width: totalWidth }} className="relative shrink-0">
                      {/* Weekend background stripes */}
                      {allDays.map((d, i) =>
                        d.isWeekend ? (
                          <div
                            key={i}
                            className="absolute inset-y-0 bg-muted/30"
                            style={{ left: i * CELL_WIDTH, width: CELL_WIDTH }}
                          />
                        ) : d.isToday ? (
                          <div
                            key={i}
                            className="absolute inset-y-0 bg-primary/5"
                            style={{ left: i * CELL_WIDTH, width: CELL_WIDTH }}
                          />
                        ) : null
                      )}
                      {/* Gantt bar */}
                      {bar && (
                        <div
                          className={cn(
                            "absolute top-1/2 -translate-y-1/2 rounded-sm h-4",
                            statusColor[task.status],
                            "opacity-80 transition-opacity group-hover:opacity-100"
                          )}
                          style={{ left: bar.left + 2, width: bar.width }}
                          title={`${task.task} (${task.startDate} ~ ${task.endDate})`}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
