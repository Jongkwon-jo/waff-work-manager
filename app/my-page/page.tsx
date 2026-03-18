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
  Home,
  LogOut,
  Maximize2,
  Minimize2,
  Star,
  User,
  UserRoundSearch,
} from "lucide-react"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/components/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CategoryBadge, ProjectTypeBadge, StatusBadge } from "@/components/status-badge"
import { toast } from "sonner"
import {
  saveMyPageTaskPreferences,
  subscribeCurrentUserProfile,
  subscribeToData as subscribeStrategyData,
  type MyPageTaskPreference,
} from "@/lib/firestore-service"
import { subscribeToData as subscribeFaData } from "@/lib/firestore-service-fa"
import type { Project, Task } from "@/lib/data"
import { cn } from "@/lib/utils"

type GroupedProject = {
  id: string
  departmentPage: "전략사업부" | "FA 사업부"
  name: string
  type: string
  period?: string
  tasks: Task[]
}

type MyTaskItem = {
  key: string
  departmentPage: GroupedProject["departmentPage"]
  projectId: string
  projectName: string
  projectType: string
  task: Task
  sortTime: number
}

const DEFAULT_TASK_PREFERENCE: MyPageTaskPreference = {
  checked: false,
  priority: "medium",
  important: false,
}

const priorityMeta: Record<MyPageTaskPreference["priority"], { label: string; className: string; rank: number }> = {
  high: { label: "높음", className: "bg-rose-100 text-rose-700", rank: 0 },
  medium: { label: "보통", className: "bg-amber-100 text-amber-700", rank: 1 },
  low: { label: "낮음", className: "bg-slate-100 text-slate-700", rank: 2 },
}

function flattenTasks(tasks: Task[]): Task[] {
  return tasks.reduce((acc, task) => [...acc, task, ...flattenTasks(task.subTasks || [])], [] as Task[])
}

function buildAliasCandidates(email?: string | null, displayName?: string | null) {
  const normalizedEmail = (email || "").trim().toLowerCase()
  const localPart = normalizedEmail.split("@")[0] || ""
  const dotlessLocal = localPart.replaceAll(".", " ").trim()

  return Array.from(new Set([normalizedEmail, localPart, dotlessLocal, displayName?.trim() || ""].filter(Boolean)))
}

function hasAliasMatch(person: string, aliases: string[]) {
  const normalizedPerson = person.trim().toLowerCase()
  if (!normalizedPerson) return false

  const personTokens = person
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  return aliases.some((alias) => {
    const normalizedAlias = alias.trim().toLowerCase()
    if (!normalizedAlias) return false
    return normalizedPerson.includes(normalizedAlias) || personTokens.includes(normalizedAlias)
  })
}

function parseDateLabel(value?: string) {
  if (!value) return Number.MAX_SAFE_INTEGER
  const matched = value.match(/(\d{1,2})\D+(\d{1,2})/)
  if (!matched) return Number.MAX_SAFE_INTEGER
  const year = new Date().getFullYear()
  return new Date(year, Number(matched[1]) - 1, Number(matched[2])).getTime()
}

export default function MyPage() {
  const { user } = useAuth()
  const [strategyProjects, setStrategyProjects] = useState<Project[]>([])
  const [faProjects, setFaProjects] = useState<Project[]>([])
  const [aliases, setAliases] = useState<string[]>([])
  const [taskPreferences, setTaskPreferences] = useState<Record<string, MyPageTaskPreference>>({})
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const [allExpanded, setAllExpanded] = useState(false)

  useEffect(() => {
    const unsubscribeStrategy = subscribeStrategyData(setStrategyProjects)
    const unsubscribeFa = subscribeFaData(setFaProjects)

    return () => {
      unsubscribeStrategy()
      unsubscribeFa()
    }
  }, [])

  useEffect(() => {
    if (!user?.email) return

    const unsubscribe = subscribeCurrentUserProfile(user.email, (profile) => {
      const suggestedAliases = buildAliasCandidates(user.email, user.displayName)
      setAliases(profile?.taskAliases?.length ? profile.taskAliases : suggestedAliases)
      setTaskPreferences(profile?.myPageTaskPreferences || {})
    })

    return () => unsubscribe()
  }, [user])

  const groupedProjects = useMemo<GroupedProject[]>(() => {
    const toGroupedProjects = (projects: Project[], departmentPage: GroupedProject["departmentPage"]) =>
      projects
        .map((project) => ({
          id: `${departmentPage}-${project.id}`,
          departmentPage,
          name: project.name,
          type: project.type,
          period: project.period,
          tasks: flattenTasks(project.tasks).filter((task) => hasAliasMatch(task.person || "", aliases)),
        }))
        .filter((project) => project.tasks.length > 0)

    return [...toGroupedProjects(strategyProjects, "전략사업부"), ...toGroupedProjects(faProjects, "FA 사업부")]
  }, [aliases, faProjects, strategyProjects])

  const todoItems = useMemo<MyTaskItem[]>(() => {
    return groupedProjects
      .flatMap((project) =>
        project.tasks.map((task) => ({
          key: `${project.id}:${task.id}`,
          departmentPage: project.departmentPage,
          projectId: project.id,
          projectName: project.name,
          projectType: project.type,
          task,
          sortTime: parseDateLabel(task.startDate),
        })),
      )
      .sort((a, b) => {
        const aPreference = taskPreferences[a.key] || DEFAULT_TASK_PREFERENCE
        const bPreference = taskPreferences[b.key] || DEFAULT_TASK_PREFERENCE
        if (aPreference.checked !== bPreference.checked) return Number(aPreference.checked) - Number(bPreference.checked)
        if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime
        if (priorityMeta[aPreference.priority].rank !== priorityMeta[bPreference.priority].rank) {
          return priorityMeta[aPreference.priority].rank - priorityMeta[bPreference.priority].rank
        }
        return a.task.task.localeCompare(b.task.task, "ko")
      })
  }, [groupedProjects, taskPreferences])

  const totalTaskCount = todoItems.length
  const uncheckedTaskCount = todoItems.filter((item) => !(taskPreferences[item.key] || DEFAULT_TASK_PREFERENCE).checked).length
  const importantTaskCount = todoItems.filter((item) => {
    const preference = taskPreferences[item.key] || DEFAULT_TASK_PREFERENCE
    return preference.important || item.task.category === "중요"
  }).length

  const toggleCard = (id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedCards(new Set())
    } else {
      setExpandedCards(new Set(groupedProjects.map((project) => project.id)))
    }
    setAllExpanded(!allExpanded)
  }

  const savePreference = async (nextPreferences: Record<string, MyPageTaskPreference>) => {
    setTaskPreferences(nextPreferences)
    if (!user?.email) return

    try {
      await saveMyPageTaskPreferences(user.email, nextPreferences)
    } catch (error) {
      toast.error("To-Do 설정 저장에 실패했습니다.")
    }
  }

  const handlePreferenceChange = (taskKey: string, updates: Partial<MyPageTaskPreference>) => {
    const current = taskPreferences[taskKey] || DEFAULT_TASK_PREFERENCE
    const nextPreferences = {
      ...taskPreferences,
      [taskKey]: {
        ...current,
        ...updates,
      },
    }

    void savePreference(nextPreferences)
  }

  const handleLogout = async () => {
    try {
      await signOut(auth)
      toast.success("로그아웃되었습니다.")
    } catch (error) {
      toast.error("로그아웃에 실패했습니다.")
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(180deg,#f8fbff_0%,#f5f7fb_55%,#ffffff_100%)] px-4 py-8 lg:px-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-4">
            <Image src="/placeholder-logo.png" alt="WorkHub 로고" width={180} height={52} className="h-12 w-auto object-contain" priority />
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">마이 페이지</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                오늘 해야 할 업무를 시간순으로 정리하고, 우선순위와 중요 표시를 함께 관리할 수 있습니다.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/">
                <Home className="h-4 w-4" />
                메인
              </Link>
            </Button>
            <Button type="button" variant="outline" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              로그아웃
            </Button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardHeader className="space-y-1 pb-2">
              <CardDescription className="text-[11px]">전체 To-Do</CardDescription>
              <CardTitle className="text-2xl leading-none">{totalTaskCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="space-y-1 pb-2">
              <CardDescription className="text-[11px]">미완료</CardDescription>
              <CardTitle className="text-2xl leading-none">{uncheckedTaskCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="space-y-1 pb-2">
              <CardDescription className="text-[11px]">중요 표시</CardDescription>
              <CardTitle className="text-2xl leading-none">{importantTaskCount}</CardTitle>
            </CardHeader>
          </Card>
        </section>

        <Card className="border-slate-200/80 bg-white/90 shadow-[0_20px_70px_rgba(15,23,42,0.08)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl text-slate-900">
              <CheckCircle2 className="h-5 w-5 text-sky-600" />
              To-Do List
            </CardTitle>
            <CardDescription>업무를 시간순으로 보고 체크, 우선순위, 중요 표시를 관리할 수 있습니다.</CardDescription>
          </CardHeader>
          <CardContent>
            {todoItems.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center">
                <UserRoundSearch className="h-8 w-8 text-slate-400" />
                <div>
                  <p className="font-semibold text-slate-900">담당 업무를 찾지 못했습니다.</p>
                  <p className="text-sm text-slate-500">관리자에게 담당자 별칭이나 업무 담당자 설정을 요청해 주세요.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {todoItems.map((item) => {
                  const preference = taskPreferences[item.key] || DEFAULT_TASK_PREFERENCE
                  const isImportant = preference.important || item.task.category === "중요"

                  return (
                    <div
                      key={item.key}
                      className={cn(
                        "rounded-2xl border bg-white p-4 transition-colors",
                        preference.checked ? "border-slate-200 opacity-70" : "border-slate-200 shadow-sm",
                        isImportant && "border-amber-300 bg-amber-50/60",
                      )}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex min-w-0 flex-1 gap-3">
                          <button
                            type="button"
                            onClick={() => handlePreferenceChange(item.key, { checked: !preference.checked })}
                            className={cn(
                              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                              preference.checked
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : "border-slate-300 bg-white text-transparent",
                            )}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{item.departmentPage}</Badge>
                              <ProjectTypeBadge type={item.projectType} />
                              <CategoryBadge category={item.task.category} />
                              <StatusBadge status={item.task.status} />
                              <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", priorityMeta[preference.priority].className)}>
                                우선순위 {priorityMeta[preference.priority].label}
                              </span>
                            </div>
                            <p className={cn("text-base font-semibold text-slate-900", preference.checked && "line-through")}>
                              {item.task.task}
                            </p>
                            <div className="mt-2 grid gap-2 text-xs text-slate-500 md:grid-cols-2 xl:grid-cols-4">
                              <span className="flex items-center gap-1">
                                <Clock3 className="h-3.5 w-3.5" />
                                {item.task.startDate || "일정 미정"}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3.5 w-3.5" />
                                {item.task.endDate || "일정 미정"}
                              </span>
                              <span className="flex items-center gap-1">
                                <User className="h-3.5 w-3.5" />
                                {item.task.person || "-"}
                              </span>
                              <span>{item.projectName}</span>
                            </div>
                            {item.task.memo ? (
                              <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{item.task.memo}</p>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                          {(["high", "medium", "low"] as const).map((priority) => (
                            <button
                              key={priority}
                              type="button"
                              onClick={() => handlePreferenceChange(item.key, { priority })}
                              className={cn(
                                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                                preference.priority === priority
                                  ? priorityMeta[priority].className
                                  : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                              )}
                            >
                              {priorityMeta[priority].label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => handlePreferenceChange(item.key, { important: !preference.important })}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                              isImportant ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                            )}
                          >
                            <Star className={cn("h-3.5 w-3.5", isImportant && "fill-current")} />
                            중요
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {groupedProjects.length > 0 ? (
          <section className="space-y-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={toggleAll}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {allExpanded ? (
                  <>
                    <Minimize2 className="h-3.5 w-3.5" />
                    모두 접기
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-3.5 w-3.5" />
                    모두 펼치기
                  </>
                )}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {groupedProjects.map((project) => (
                <MyProjectCard
                  key={project.id}
                  project={project}
                  expanded={expandedCards.has(project.id)}
                  onToggle={() => toggleCard(project.id)}
                  taskPreferences={taskPreferences}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}

function MyProjectCard({
  project,
  expanded,
  onToggle,
  taskPreferences,
}: {
  project: GroupedProject
  expanded: boolean
  onToggle: () => void
  taskPreferences: Record<string, MyPageTaskPreference>
}) {
  const completedCount = project.tasks.filter((task) => task.status === "완료").length
  const totalCount = project.tasks.length
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const importantCount = project.tasks.filter(
    (task) => task.category === "중요" || taskPreferences[`${project.id}:${task.id}`]?.important,
  ).length

  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-2 border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <Badge variant="outline">{project.departmentPage}</Badge>
            <ProjectTypeBadge type={project.type} />
            {importantCount > 0 ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                중요 {importantCount}
              </span>
            ) : null}
          </div>
          <h3 className="truncate text-sm font-bold text-card-foreground">{project.name}</h3>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium tabular-nums text-card-foreground">{progressPercent}%</span>
            <span className="h-3 w-px bg-border" />
            <span>{`${totalCount}건`}</span>
          </div>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform", expanded && "rotate-180")} />
      </button>

      <div className={cn("grid transition-[grid-template-rows] duration-300 ease-in-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className="border-t border-border px-4 py-3">
            <ul className="space-y-3">
              {project.tasks.map((task) => {
                const preference = taskPreferences[`${project.id}:${task.id}`]
                const isImportant = task.category === "중요" || preference?.important

                return (
                  <li
                    key={task.id}
                    className={cn(
                      "rounded-lg border border-border/80 bg-muted/20 p-3",
                      isImportant && "border-amber-300 bg-amber-50/60",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <CategoryBadge category={task.category} />
                      <StatusBadge status={task.status} />
                      {preference ? (
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", priorityMeta[preference.priority].className)}>
                          {priorityMeta[preference.priority].label}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-card-foreground">{task.task}</p>
                    <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                      <span className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {task.person || "-"}
                      </span>
                      <span>{task.department || "-"}</span>
                      <span>{`${task.startDate} ~ ${task.endDate}`}</span>
                      <span>{`공수 ${task.manDays}`}</span>
                    </div>
                    {task.memo ? <p className="mt-2 whitespace-pre-wrap rounded-md bg-white px-2.5 py-2 text-xs text-slate-600">{task.memo}</p> : null}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
