"use client"

import { useMemo, useState } from "react"
import type { Project, TaskStatus } from "@/lib/data"
import { StatusBadge, CategoryBadge, ProjectTypeBadge } from "@/components/status-badge"
import {
  User,
  Calendar,
  Briefcase,
  Clock,
  CheckCircle2,
  Loader2,
  PauseCircle,
  HelpCircle,
  Timer,
  ChevronDown,
  Minimize2,
  Maximize2,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface ProjectCardViewProps {
  projects: Project[]
  statusFilter: TaskStatus | "all"
  departmentFilter: string
  personFilter: string
  searchQuery: string
}

export function ProjectCardView({
  projects,
  statusFilter,
  departmentFilter,
  personFilter,
  searchQuery,
}: ProjectCardViewProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const [allExpanded, setAllExpanded] = useState(false)

  const filteredProjects = useMemo(() => {
    return projects
      .map((project) => {
        const filteredTasks = project.tasks.filter((task) => {
          if (statusFilter === "all" && task.status === "완료" && (task.subTasks?.length || 0) === 0) return false
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
        if (searchQuery) {
          return project.tasks.length > 0 || project.name.toLowerCase().includes(searchQuery.toLowerCase())
        }
        if (statusFilter !== "all" || departmentFilter !== "all" || personFilter !== "all") {
          return project.tasks.length > 0
        }
        return true
      })
  }, [projects, statusFilter, departmentFilter, personFilter, searchQuery])

  const toggleCard = (id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedCards(new Set())
    } else {
      setExpandedCards(new Set(filteredProjects.map((p) => p.id)))
    }
    setAllExpanded(!allExpanded)
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
      <div className="flex justify-end">
        <button
          onClick={toggleAll}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {allExpanded ? (
            <>
              <Minimize2 className="h-3.5 w-3.5" />
              {"모두 접기"}
            </>
          ) : (
            <>
              <Maximize2 className="h-3.5 w-3.5" />
              {"모두 펼치기"}
            </>
          )}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredProjects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            expanded={expandedCards.has(project.id)}
            onToggle={() => toggleCard(project.id)}
          />
        ))}
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  expanded,
  onToggle,
}: {
  project: Project
  expanded: boolean
  onToggle: () => void
}) {
  const completedCount = project.tasks.filter((t) => t.status === "완료").length
  const inProgressCount = project.tasks.filter((t) => t.status === "진행").length
  const waitingCount = project.tasks.filter((t) => t.status === "대기").length
  const holdCount = project.tasks.filter((t) => t.status === "보류").length
  const undecidedCount = project.tasks.filter((t) => t.status === "미정").length
  const totalCount = project.tasks.length
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const totalManDays = project.tasks.reduce((sum, t) => sum + t.manDays, 0)

  const uniquePersons = useMemo(() => {
    const set = new Set<string>()
    project.tasks.forEach((t) => {
      t.person.split(",").forEach((p) => {
        const trimmed = p.trim()
        if (trimmed) set.add(trimmed)
      })
    })
    return Array.from(set)
  }, [project.tasks])

  const importantTasks = project.tasks.filter((t) => t.category === "중요")

  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-shadow hover:shadow-md">
      {/* Card Header - Always visible */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-start justify-between gap-2 border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <ProjectTypeBadge type={project.type} />
            <h3 className="truncate text-sm font-bold text-card-foreground">
              {project.name}
            </h3>
          </div>
          {/* Compact summary row */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium tabular-nums text-card-foreground">
              {progressPercent}%
            </span>
            <span className="h-3 w-px bg-border" />
            <span>{`${totalCount}건`}</span>
            {totalManDays > 0 && (
              <>
                <span className="h-3 w-px bg-border" />
                <span>{`${totalManDays}일`}</span>
              </>
            )}
          </div>
        </div>
        {/* Progress ring + chevron */}
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <MiniProgress percent={progressPercent} />
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground/50 transition-transform",
              expanded && "rotate-180"
            )}
          />
        </div>
      </button>

      {/* Compact status dots - Always visible */}
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="flex flex-1 flex-wrap gap-x-3 gap-y-1">
          {completedCount > 0 && (
            <StatusCount
              icon={<CheckCircle2 className="h-3 w-3 text-emerald-500" />}
              label="완료"
              count={completedCount}
              color="text-emerald-600"
            />
          )}
          {inProgressCount > 0 && (
            <StatusCount
              icon={<Loader2 className="h-3 w-3 text-blue-500" />}
              label="진행"
              count={inProgressCount}
              color="text-blue-600"
            />
          )}
          {waitingCount > 0 && (
            <StatusCount
              icon={<Clock className="h-3 w-3 text-amber-500" />}
              label="대기"
              count={waitingCount}
              color="text-amber-600"
            />
          )}
          {holdCount > 0 && (
            <StatusCount
              icon={<PauseCircle className="h-3 w-3 text-slate-400" />}
              label="보류"
              count={holdCount}
              color="text-slate-500"
            />
          )}
          {undecidedCount > 0 && (
            <StatusCount
              icon={<HelpCircle className="h-3 w-3 text-rose-400" />}
              label="미정"
              count={undecidedCount}
              color="text-rose-500"
            />
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {uniquePersons.slice(0, 3).map((person) => (
            <span
              key={person}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary"
              title={person}
            >
              {person.charAt(0)}
            </span>
          ))}
          {uniquePersons.length > 3 && (
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-muted-foreground">
              {`+${uniquePersons.length - 3}`}
            </span>
          )}
        </div>
      </div>

      {/* Expanded Detail Section */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-in-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          {/* Full progress bar */}
          <div className="border-t border-border px-4 py-3">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {project.period || "기간 미정"}
              </span>
              <span className="flex items-center gap-1">
                <Timer className="h-3 w-3" />
                {totalManDays > 0 ? `총 ${totalManDays}일 공수` : "공수 미정"}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  progressPercent === 100
                    ? "bg-emerald-500"
                    : progressPercent >= 50
                      ? "bg-blue-500"
                      : progressPercent > 0
                        ? "bg-amber-500"
                        : "bg-muted-foreground/20"
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Task list */}
          <div className="border-t border-border px-4 py-3">
            {importantTasks.length > 0 && (
              <div className="mb-3">
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-rose-600 uppercase">
                  {"주요 업무"}
                </p>
                <ul className="space-y-1.5">
                  {importantTasks.map((task) => (
                    <li key={task.id} className="flex items-start gap-2">
                      <CategoryBadge category={task.category} />
                      <span
                        className={cn(
                          "flex-1 text-xs font-medium leading-snug",
                          task.status === "완료" && (task.subTasks?.length || 0) === 0
                            ? "text-muted-foreground/50"
                            : "text-card-foreground",
                        )}
                      >
                        {task.task}
                      </span>
                      <StatusBadge status={task.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {importantTasks.length > 0 ? "기타 업무" : "업무 목록"}
              </p>
              <ul className="space-y-1">
                {project.tasks
                  .filter((t) => t.category !== "중요")
                  .map((task) => (
                    <li key={task.id} className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          task.status === "완료"
                            ? "bg-emerald-500"
                            : task.status === "진행"
                              ? "bg-blue-500"
                              : task.status === "대기"
                                ? "bg-amber-500"
                                : task.status === "보류"
                                  ? "bg-slate-400"
                                  : "bg-rose-400"
                        )}
                      />
                      <span
                        className={cn(
                          "flex-1 truncate text-xs",
                          task.status === "완료" && (task.subTasks?.length || 0) === 0
                            ? "text-muted-foreground/50"
                            : "text-muted-foreground",
                        )}
                      >
                        {task.task}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                        {task.startDate}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>

          {/* Assignees footer */}
          <div className="border-t border-border bg-muted/30 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <User className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              <div className="flex flex-wrap gap-1">
                {uniquePersons.map((person) => (
                  <span
                    key={person}
                    className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground"
                  >
                    {person}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MiniProgress({ percent }: { percent: number }) {
  const radius = 10
  const stroke = 2.5
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference
  const color =
    percent === 100
      ? "stroke-emerald-500"
      : percent >= 50
        ? "stroke-blue-500"
        : percent > 0
          ? "stroke-amber-500"
          : "stroke-muted-foreground/20"

  return (
    <svg width="28" height="28" className="shrink-0 -rotate-90">
      <circle
        cx="14"
        cy="14"
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="stroke-secondary"
      />
      <circle
        cx="14"
        cy="14"
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className={cn("transition-all duration-500", color)}
      />
    </svg>
  )
}

function StatusCount({
  icon,
  label,
  count,
  color,
}: {
  icon: React.ReactNode
  label: string
  count: number
  color: string
}) {
  return (
    <span className={cn("flex items-center gap-1 text-[11px] font-medium", color)}>
      {icon}
      {label} {count}
    </span>
  )
}
