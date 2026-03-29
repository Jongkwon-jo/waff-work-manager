"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { signOut } from "firebase/auth"
import { addDays, differenceInCalendarDays, endOfWeek, format, isWithinInterval, startOfWeek } from "date-fns"
import { ko } from "date-fns/locale"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/components/auth/auth-provider"
import {
  DEFAULT_DEPARTMENT_PERSON_SETTINGS,
  subscribeDepartmentPersonSettings,
  type DepartmentPersonGroup,
  type DepartmentPersonSettings,
} from "@/lib/firestore-service"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CategoryBadge, ProjectTypeBadge, StatusBadge } from "@/components/status-badge"
import type { Project, Task } from "@/lib/data"
import { toast } from "sonner"
import { CalendarDays, Home, LogOut, Users } from "lucide-react"

type WeeklyTaskItem = {
  projectId: string
  projectName: string
  projectType: string
  team: string
  person: string
  task: Task
  startTime: number
}

type WeeklyBoardTone = {
  pageBackground: string
  summaryBadge: string
  dayHeader: string
  taskCard: string
  noteCard: string
}

type WeekDay = {
  date: Date
  label: string
  fullDateLabel: string
  dayNumber: string
  isToday: boolean
  dayOfWeek: number
}

function flattenLeafTasks(tasks: Task[]): Task[] {
  return tasks.flatMap((task) => {
    const children = task.subTasks || []
    if (children.length === 0) return [task]
    return flattenLeafTasks(children)
  })
}

function parseTaskDate(value?: string) {
  if (!value) return undefined
  const matched = value.match(/(\d{1,2})\D+(\d{1,2})/)
  if (!matched) return undefined
  const year = new Date().getFullYear()
  return new Date(year, Number(matched[1]) - 1, Number(matched[2]))
}

function splitPersons(value?: string) {
  const normalized = (value || "").trim()
  if (!normalized) return ["미지정"]

  const values = normalized
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

  return values.length > 0 ? values : ["미지정"]
}

function getSortTime(task: Task) {
  return parseTaskDate(task.startDate)?.getTime() ?? Number.MAX_SAFE_INTEGER
}

function isTaskInCurrentWeek(task: Task, weekStart: Date, weekEnd: Date) {
  const start = parseTaskDate(task.startDate)
  const end = parseTaskDate(task.endDate)

  if (start && end) return start <= weekEnd && end >= weekStart
  if (start) return isWithinInterval(start, { start: weekStart, end: weekEnd })
  if (end) return isWithinInterval(end, { start: weekStart, end: weekEnd })
  return false
}

function getTaskBarSpan(task: Task, weekStart: Date, weekEnd: Date) {
  const start = parseTaskDate(task.startDate) ?? weekStart
  const end = parseTaskDate(task.endDate) ?? start
  const clampedStart = start < weekStart ? weekStart : start
  const clampedEnd = end > weekEnd ? weekEnd : end

  const startOffset = Math.max(0, differenceInCalendarDays(clampedStart, weekStart))
  const endOffset = Math.max(startOffset, differenceInCalendarDays(clampedEnd, weekStart))

  return {
    startOffset,
    span: endOffset - startOffset + 1,
  }
}

interface WeeklyWorkBoardProps {
  title: string
  description: string
  homeHref: string
  managementHref: string
  subscribeToData: (callback: (projects: Project[]) => void) => () => void
  allowedDepartmentGroups: DepartmentPersonGroup[]
  tone: WeeklyBoardTone
}

export function WeeklyWorkBoard({
  title,
  description,
  homeHref,
  managementHref,
  subscribeToData,
  allowedDepartmentGroups,
  tone,
}: WeeklyWorkBoardProps) {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedPerson, setSelectedPerson] = useState("all")
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [departmentPersonSettings, setDepartmentPersonSettings] = useState<DepartmentPersonSettings>(
    DEFAULT_DEPARTMENT_PERSON_SETTINGS,
  )

  useEffect(() => {
    const unsubscribe = subscribeToData(setProjects)
    return () => unsubscribe()
  }, [subscribeToData])

  useEffect(() => {
    const unsubscribe = subscribeDepartmentPersonSettings(setDepartmentPersonSettings)
    return () => unsubscribe()
  }, [])

  const today = useMemo(() => new Date(), [])
  const weekStart = useMemo(() => startOfWeek(today, { weekStartsOn: 1 }), [today])
  const weekEnd = useMemo(() => endOfWeek(today, { weekStartsOn: 1 }), [today])

  const weekDays = useMemo<WeekDay[]>(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = addDays(weekStart, index)
        return {
          date,
          label: format(date, "EEE", { locale: ko }),
          fullDateLabel: format(date, "MM월 dd일", { locale: ko }),
          dayNumber: format(date, "d"),
          isToday: format(date, "yyyy-MM-dd") === format(today, "yyyy-MM-dd"),
          dayOfWeek: date.getDay(),
        }
      }),
    [today, weekStart],
  )

  const allowedPersons = useMemo(
    () =>
      Array.from(new Set(allowedDepartmentGroups.flatMap((group) => departmentPersonSettings[group] || []))).sort((a, b) =>
        a.localeCompare(b, "ko"),
      ),
    [allowedDepartmentGroups, departmentPersonSettings],
  )

  const allowedPersonSet = useMemo(() => new Set(allowedPersons), [allowedPersons])

  const weeklyTasks = useMemo<WeeklyTaskItem[]>(() => {
    return projects
      .filter((project) => !project.isHidden)
      .flatMap((project) =>
        flattenLeafTasks(project.tasks)
          .filter((task) => !task.isHidden)
          .filter((task) => isTaskInCurrentWeek(task, weekStart, weekEnd))
          .flatMap((task) =>
            splitPersons(task.person)
              .filter((person) => allowedPersonSet.has(person))
              .map((person) => ({
                projectId: project.id,
                projectName: project.name,
                projectType: project.type,
                team: task.department || "기타",
                person,
                task,
                startTime: getSortTime(task),
              })),
          ),
      )
      .sort((a, b) => {
        const byPerson = a.person.localeCompare(b.person, "ko")
        if (byPerson !== 0) return byPerson
        if (a.startTime !== b.startTime) return a.startTime - b.startTime
        const byTeam = a.team.localeCompare(b.team, "ko")
        if (byTeam !== 0) return byTeam
        return a.task.task.localeCompare(b.task.task, "ko")
      })
  }, [allowedPersonSet, projects, weekEnd, weekStart])

  const personOptions = allowedPersons

  useEffect(() => {
    if (selectedPerson === "all") return
    if (personOptions.includes(selectedPerson)) return
    setSelectedPerson("all")
  }, [personOptions, selectedPerson])

  const visibleTasks = useMemo(
    () => (selectedPerson === "all" ? weeklyTasks : weeklyTasks.filter((item) => item.person === selectedPerson)),
    [selectedPerson, weeklyTasks],
  )
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const selectedProject = selectedProjectId ? projectById.get(selectedProjectId) || null : null

  const tasksByPerson = useMemo(
    () =>
      Array.from(
        visibleTasks.reduce((map, item) => {
          if (!map.has(item.person)) map.set(item.person, [])
          map.get(item.person)!.push(item)
          return map
        }, new Map<string, WeeklyTaskItem[]>()),
      ),
    [visibleTasks],
  )

  const handleLogout = async () => {
    try {
      await signOut(auth)
      toast.success("로그아웃되었습니다.")
    } catch {
      toast.error("로그아웃에 실패했습니다.")
    }
  }

  return (
    <main className={`min-h-screen ${tone.pageBackground} px-4 py-8 lg:px-10`}>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-4">
              <Image src="/placeholder-logo.png" alt="WorkHub 로고" width={180} height={52} className="h-12 w-auto object-contain" priority />
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <Badge variant="outline" className={`gap-1.5 ${tone.summaryBadge}`}>
                  <CalendarDays className="h-3.5 w-3.5" />
                  {format(weekStart, "yyyy년 M월 d일", { locale: ko })} - {format(weekEnd, "M월 d일", { locale: ko })}
                </Badge>
                <Badge variant="outline" className="gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {selectedPerson === "all" ? "전체 인원" : selectedPerson} / {visibleTasks.length}개 업무
                </Badge>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Select value={selectedPerson} onValueChange={setSelectedPerson}>
                <SelectTrigger className="h-10 min-w-[180px] bg-white">
                  <SelectValue placeholder="담당자 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 인원</SelectItem>
                  {personOptions.map((person) => (
                    <SelectItem key={person} value={person}>
                      {person}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button asChild variant="outline">
                <Link href={homeHref}>
                  <Home className="h-4 w-4" />
                  메인
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={managementHref}>업무관리</Link>
              </Button>
              <Button type="button" variant="outline" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                로그아웃
              </Button>
            </div>
          </div>
        </header>

        {visibleTasks.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>이번 주 업무가 없습니다.</CardTitle>
              <CardDescription>현재 날짜 기준 주간 범위에 해당하는 최하위 업무가 없거나, 선택한 담당자에게 배정된 업무가 없습니다.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 shadow-sm">
            <div className="grid grid-cols-[320px_repeat(7,minmax(90px,1fr))] border-b border-slate-200/90">
              <div className="px-4 py-3 text-sm font-semibold text-slate-700">업무 정보</div>
              {weekDays.map((day) => (
                <div key={day.date.toISOString()} className={`border-l border-slate-200/80 px-2 py-3 text-center ${tone.dayHeader}`}>
                  <div
                    className={`mt-0.5 text-[11px] font-bold ${
                      day.isToday
                        ? "text-yellow-700"
                        : day.dayOfWeek === 6
                          ? "text-blue-700"
                          : day.dayOfWeek === 0
                            ? "text-red-700"
                            : "text-slate-800"
                    }`}
                  >
                    {day.fullDateLabel}
                  </div>
                  <div
                    className={`mt-0.5 text-[11px] font-semibold ${
                      day.isToday
                        ? "text-yellow-700"
                        : day.dayOfWeek === 6
                          ? "text-blue-600"
                          : day.dayOfWeek === 0
                            ? "text-red-600"
                            : "text-slate-500"
                    }`}
                  >
                    {day.label}
                  </div>
                </div>
              ))}
            </div>

            <div className="divide-y divide-slate-200/80">
              {tasksByPerson.map(([person, personTasks]) => (
                <div key={person}>
                  <div className="grid grid-cols-[320px_repeat(7,minmax(90px,1fr))] border-b border-slate-200 bg-slate-50/70">
                    <div className="px-4 py-1.5">
                      <div className="text-sm font-semibold text-slate-900">{person}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{personTasks.length}개 업무</div>
                    </div>
                    <div className="col-span-7" />
                  </div>

                  {personTasks.map((item) => {
                    const bar = getTaskBarSpan(item.task, weekStart, weekEnd)
                    return (
                      <div
                        key={`${item.projectId}-${item.task.id}-${item.person}`}
                        className="grid grid-cols-[320px_repeat(7,minmax(90px,1fr))] items-stretch"
                      >
                        <div className="flex px-4 py-0.5">
                          <button
                            type="button"
                            className={`flex min-h-[64px] w-full flex-col justify-center rounded-xl border px-2 py-1.5 text-left transition-shadow hover:shadow-sm ${tone.taskCard}`}
                            onClick={() => setSelectedProjectId(item.projectId)}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <ProjectTypeBadge type={item.projectType} />
                              <StatusBadge status={item.task.status} />
                              <CategoryBadge category={item.task.category} />
                            </div>
                            <div className="mt-0.5 text-[13px] font-semibold text-slate-900">{item.projectName}</div>
                            {item.task.memo ? (
                              <div className={`mt-0.5 rounded-lg px-2 py-1 text-xs leading-4 text-slate-600 ${tone.noteCard}`}>
                                {item.task.memo}
                              </div>
                            ) : null}
                          </button>
                        </div>

                        <div className="relative col-span-7 grid min-h-[64px] grid-cols-7 border-t border-b border-slate-200/60">
                          {weekDays.map((day) => (
                            <div
                              key={`${item.projectId}-${item.task.id}-${item.person}-${day.date.toISOString()}`}
                              className={`relative min-h-[64px] border-l border-slate-200/80 ${
                                day.isToday
                                  ? "bg-yellow-50/80"
                                  : day.dayOfWeek === 6
                                    ? "bg-blue-50/60"
                                    : day.dayOfWeek === 0
                                      ? "bg-red-50/60"
                                      : "bg-white"
                              }`}
                            >
                              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-slate-200/50" />
                            </div>
                          ))}
                          <div
                            className="pointer-events-none absolute inset-y-0 grid py-1.5"
                            style={{
                              left: `${(bar.startOffset / 7) * 100}%`,
                              width: `${(bar.span / 7) * 100}%`,
                            }}
                          >
                            <button
                              type="button"
                              className="pointer-events-auto mx-1 my-auto rounded-lg bg-blue-600 px-2 py-1 text-left text-[11px] font-semibold text-white shadow-sm"
                              onClick={() => setSelectedProjectId(item.projectId)}
                            >
                              <div className="truncate">{item.task.task}</div>
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-xs text-slate-500 shadow-sm">
          주간업무는 현재 날짜가 포함된 주간 범위와 겹치는 최하위 업무만 표시합니다. 숨김 처리된 프로젝트와 업무는 제외되며, 인원 목록은 부서 담당자 설정을 기준으로 노출됩니다.
        </div>
      </div>

      <Dialog open={!!selectedProject} onOpenChange={(open) => !open && setSelectedProjectId(null)}>
        <DialogContent className="sm:max-w-[520px]">
          {selectedProject ? (
            <>
              <DialogHeader>
                <DialogTitle>프로젝트 상세</DialogTitle>
                <DialogDescription>선택한 업무가 속한 프로젝트의 기본 정보를 보여줍니다.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <ProjectTypeBadge type={selectedProject.type} />
                    <Badge variant="outline">{selectedProject.isHidden ? "숨김 프로젝트" : "표시 중"}</Badge>
                  </div>
                  <div className="mt-3 text-lg font-semibold text-slate-900">{selectedProject.name}</div>
                  <div className="mt-2 grid gap-1 text-sm text-slate-600">
                    <span>기간: {selectedProject.period || "미입력"}</span>
                    <span>총 최하위 업무 수: {flattenLeafTasks(selectedProject.tasks).length}개</span>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  )
}
