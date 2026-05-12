"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { signOut } from "firebase/auth"
import { addDays, differenceInCalendarDays, endOfWeek, format, isWithinInterval, startOfWeek } from "date-fns"
import { ko } from "date-fns/locale"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/components/auth/auth-provider"
import {
  DEFAULT_DEPARTMENT_PERSON_SETTINGS,
  subscribeGlobalSchedules,
  subscribeDepartmentPersonSettings,
  subscribeCurrentUserProfile,
  type GlobalSchedule,
  type DepartmentPersonGroup,
  type DepartmentPersonSettings,
  type MyPagePersonalTask,
} from "@/lib/firestore-service"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CategoryBadge, ProjectTypeBadge, StatusBadge } from "@/components/status-badge"
import type { Project, Task } from "@/lib/data"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { CalendarDays, ChevronLeft, ChevronRight, Home, LogOut, Users } from "lucide-react"

type WeeklyTaskItem = {
  projectId: string
  projectName: string
  subProjectName: string
  projectType: string
  departmentGroup: DepartmentPersonGroup
  departmentLabel: string
  managementHref: string
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

type WeeklyGlobalScheduleItem = {
  id: string
  title: string
  type: GlobalSchedule["type"]
  startDate: Date
  endDate: Date
}

type ProjectMemoDialogPayload = {
  person: string
  projectName: string
  subProjectName: string
  memos: string[]
}

export type WeeklyWorkDataSource = {
  id: string
  label: string
  departmentGroup: DepartmentPersonGroup
  managementHref: string
  subscribeToData: (callback: (projects: Project[]) => void) => () => void
}

function getWeeklyStatusBarClass(status: Task["status"]) {
  switch (status) {
    case "완료":
      return "bg-slate-600 text-slate-50"
    case "진행":
      return "bg-blue-500 text-blue-50"
    case "예정":
      return "bg-gray-200 text-gray-700"
    case "보류":
      return "bg-yellow-200 text-yellow-800"
    default:
      return "bg-rose-50 text-rose-600"
  }
}

function flattenLeafTasksWithAncestors(tasks: Task[], ancestors: Task[] = []): Array<{ task: Task; ancestors: Task[] }> {
  return tasks.flatMap((task) => {
    const children = task.subTasks || []
    if (children.length === 0) return [{ task, ancestors }]
    return flattenLeafTasksWithAncestors(children, [...ancestors, task])
  })
}

function parseTaskDate(value?: string) {
  if (!value) return undefined
  const isoMatched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatched) return new Date(Number(isoMatched[1]), Number(isoMatched[2]) - 1, Number(isoMatched[3]))
  const matched = value.match(/(\d{1,2})\D+(\d{1,2})/)
  if (!matched) return undefined
  const year = new Date().getFullYear()
  return new Date(year, Number(matched[1]) - 1, Number(matched[2]))
}

function parseIsoDate(value?: string) {
  if (!value) return undefined
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return undefined
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
}

function toDayKey(date: Date) {
  return format(date, "yyyy-MM-dd")
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
  dataSources: WeeklyWorkDataSource[]
  tone: WeeklyBoardTone
}

export function WeeklyWorkBoard({
  title,
  description,
  homeHref,
  dataSources,
  tone,
}: WeeklyWorkBoardProps) {
  const { user } = useAuth()
  const [projectsBySource, setProjectsBySource] = useState<Record<string, Project[]>>({})
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentPersonGroup | "all">("all")
  const [selectedPerson, setSelectedPerson] = useState("all")
  const [profileDepartment, setProfileDepartment] = useState<DepartmentPersonGroup | "">("")
  const [profileDefaultPerson, setProfileDefaultPerson] = useState("")
  const [profilePersonalTasks, setProfilePersonalTasks] = useState<MyPagePersonalTask[]>([])
  const [selectedTaskItem, setSelectedTaskItem] = useState<WeeklyTaskItem | null>(null)
  const [selectedProjectMemo, setSelectedProjectMemo] = useState<ProjectMemoDialogPayload | null>(null)
  const [currentWeekAnchor, setCurrentWeekAnchor] = useState(() => new Date())
  const [globalSchedules, setGlobalSchedules] = useState<GlobalSchedule[]>([])
  const [departmentPersonSettings, setDepartmentPersonSettings] = useState<DepartmentPersonSettings>(
    DEFAULT_DEPARTMENT_PERSON_SETTINGS,
  )
  const hasAppliedProfileDepartmentRef = useRef(false)
  const hasAppliedProfileDefaultRef = useRef(false)

  useEffect(() => {
    setProjectsBySource({})
    const unsubscribes = dataSources.map((source) =>
      source.subscribeToData((projects) => {
        setProjectsBySource((prev) => ({ ...prev, [source.id]: projects }))
      }),
    )
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [dataSources])

  useEffect(() => {
    const unsubscribe = subscribeDepartmentPersonSettings(setDepartmentPersonSettings)
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const unsubscribe = subscribeGlobalSchedules(setGlobalSchedules)
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const email = user?.email || ""
    setProfileDepartment("")
    setProfileDefaultPerson("")
    setProfilePersonalTasks([])
    hasAppliedProfileDepartmentRef.current = false
    hasAppliedProfileDefaultRef.current = false
    if (!email) return

    const unsubscribe = subscribeCurrentUserProfile(email, (profile) => {
      setProfileDepartment(profile?.department || "")
      const preferred = (profile?.taskAliases || [])[0]?.trim() || ""
      setProfileDefaultPerson(preferred)
      setProfilePersonalTasks(profile?.myPagePersonalTasks || [])
    })
    return () => unsubscribe()
  }, [user?.email])

  const today = useMemo(() => new Date(), [])
  const weekStart = useMemo(() => startOfWeek(currentWeekAnchor, { weekStartsOn: 1 }), [currentWeekAnchor])
  const weekEnd = useMemo(() => endOfWeek(currentWeekAnchor, { weekStartsOn: 1 }), [currentWeekAnchor])

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

  const departmentOptions = useMemo(() => dataSources.map((source) => source.departmentGroup), [dataSources])

  useEffect(() => {
    if (hasAppliedProfileDepartmentRef.current) return
    if (!profileDepartment) return
    if (!departmentOptions.includes(profileDepartment)) return
    setSelectedDepartment(profileDepartment)
    hasAppliedProfileDepartmentRef.current = true
  }, [departmentOptions, profileDepartment])

  useEffect(() => {
    if (selectedDepartment === "all") return
    if (departmentOptions.includes(selectedDepartment)) return
    setSelectedDepartment("all")
  }, [departmentOptions, selectedDepartment])

  const selectedDataSources = useMemo(
    () =>
      selectedDepartment === "all"
        ? dataSources
        : dataSources.filter((source) => source.departmentGroup === selectedDepartment),
    [dataSources, selectedDepartment],
  )

  const allowedPersons = useMemo(
    () => {
      const people = selectedDataSources.flatMap((source) => departmentPersonSettings[source.departmentGroup] || [])
      const profilePerson = profileDefaultPerson || user?.email?.split("@")[0] || ""
      const shouldIncludePersonalPerson =
        profilePerson &&
        profilePersonalTasks.some((task) => task.startDate || task.endDate) &&
        (selectedDepartment === "all" || selectedDepartment === profileDepartment)
      if (shouldIncludePersonalPerson) people.push(profilePerson)
      return Array.from(new Set(people)).sort((a, b) => a.localeCompare(b, "ko"))
    },
    [departmentPersonSettings, profileDefaultPerson, profileDepartment, profilePersonalTasks, selectedDataSources, selectedDepartment, user?.email],
  )

  const allowedPersonSet = useMemo(() => new Set(allowedPersons), [allowedPersons])

  const weeklyTasks = useMemo<WeeklyTaskItem[]>(() => {
    const profilePerson = profileDefaultPerson || user?.email?.split("@")[0] || "개인"
    const shouldIncludePersonalTasks = selectedDepartment === "all" || selectedDepartment === profileDepartment
    const personalWeeklyTasks: WeeklyTaskItem[] = shouldIncludePersonalTasks
      ? profilePersonalTasks
          .filter((task) => task.startDate || task.endDate)
          .filter((task) =>
            isTaskInCurrentWeek(
              {
                id: task.id,
                projectId: "personal",
                task: task.title,
                memo: task.memo,
                category: task.important ? "중요" : "일반",
                department: profileDepartment || "기타",
                person: profilePerson,
                startDate: task.startDate || task.endDate || "",
                endDate: task.endDate || task.startDate || "",
                status: task.checked ? "완료" : "진행",
                manDays: 0,
              },
              weekStart,
              weekEnd,
            ),
          )
          .map((task) => ({
            projectId: `personal-${task.id}`,
            projectName: "개인 업무",
            subProjectName: "",
            projectType: "Etc",
            departmentGroup: profileDepartment || "기타",
            departmentLabel: "개인",
            managementHref: "/my-page",
            team: profileDepartment || "기타",
            person: profilePerson,
            task: {
              id: task.id,
              projectId: "personal",
              task: task.title,
              memo: task.memo,
              category: task.important ? "중요" : "일반",
              department: profileDepartment || "기타",
              person: profilePerson,
              startDate: task.startDate || task.endDate || "",
              endDate: task.endDate || task.startDate || "",
              status: task.checked ? "완료" : "진행",
              manDays: 0,
            },
            startTime: parseTaskDate(task.startDate || task.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER,
          }))
      : []

    return [
      ...selectedDataSources
      .flatMap((source) =>
        (projectsBySource[source.id] || [])
          .filter((project) => !project.isHidden)
          .flatMap((project) =>
            flattenLeafTasksWithAncestors(project.tasks)
              .filter(({ task }) => !task.isHidden)
              .filter(({ task }) => isTaskInCurrentWeek(task, weekStart, weekEnd))
              .flatMap(({ task, ancestors }) =>
                splitPersons(task.person)
                  .filter((person) => allowedPersonSet.has(person))
                  .map((person) => ({
                    projectId: `${source.id}-${project.id}`,
                    projectName: project.name,
                    subProjectName: ancestors[0]?.task || "",
                    projectType: project.type,
                    departmentGroup: source.departmentGroup,
                    departmentLabel: source.label,
                    managementHref: source.managementHref,
                    team: task.department || "기타",
                    person,
                    task,
                    startTime: getSortTime(task),
                  })),
              ),
          ),
      ),
      ...personalWeeklyTasks,
    ]
      .sort((a, b) => {
        const byDepartment = a.departmentLabel.localeCompare(b.departmentLabel, "ko")
        if (byDepartment !== 0) return byDepartment
        const byPerson = a.person.localeCompare(b.person, "ko")
        if (byPerson !== 0) return byPerson
        if (a.startTime !== b.startTime) return a.startTime - b.startTime
        const byTeam = a.team.localeCompare(b.team, "ko")
        if (byTeam !== 0) return byTeam
        return a.task.task.localeCompare(b.task.task, "ko")
      })
  }, [allowedPersonSet, profileDefaultPerson, profileDepartment, profilePersonalTasks, projectsBySource, selectedDataSources, selectedDepartment, user?.email, weekEnd, weekStart])

  const personOptions = allowedPersons

  useEffect(() => {
    if (hasAppliedProfileDefaultRef.current) return
    if (!profileDefaultPerson) return
    if (!personOptions.includes(profileDefaultPerson)) return
    setSelectedPerson(profileDefaultPerson)
    hasAppliedProfileDefaultRef.current = true
  }, [personOptions, profileDefaultPerson])

  useEffect(() => {
    if (selectedPerson === "all") return
    if (personOptions.includes(selectedPerson)) return
    setSelectedPerson("all")
  }, [personOptions, selectedPerson])

  const visibleTasks = useMemo(
    () => (selectedPerson === "all" ? weeklyTasks : weeklyTasks.filter((item) => item.person === selectedPerson)),
    [selectedPerson, weeklyTasks],
  )

  const groupedTasksByPersonProject = useMemo(() => {
    const personMap = new Map<
      string,
      Map<string, { projectName: string; subProjectName: string; projectType: string; departmentLabel: string; items: WeeklyTaskItem[] }>
    >()
    visibleTasks.forEach((item) => {
      if (!personMap.has(item.person)) personMap.set(item.person, new Map())
      const projectMap = personMap.get(item.person)!
      const projectKey = `${item.projectId}::${item.subProjectName || "_root"}`
      if (!projectMap.has(projectKey)) {
        projectMap.set(projectKey, {
          projectName: item.projectName,
          subProjectName: item.subProjectName,
          projectType: item.projectType,
          departmentLabel: item.departmentLabel,
          items: [],
        })
      }
      projectMap.get(projectKey)!.items.push(item)
    })

    return Array.from(personMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([person, projectMap]) => ({
        person,
        projects: Array.from(projectMap.entries())
          .map(([projectId, project]) => ({
            projectId,
            projectName: project.projectName,
            subProjectName: project.subProjectName,
            projectType: project.projectType,
            departmentLabel: project.departmentLabel,
            items: project.items.sort((a, b) => {
              if (a.startTime !== b.startTime) return a.startTime - b.startTime
              return a.task.task.localeCompare(b.task.task, "ko")
            }),
          }))
          .sort((a, b) => {
            const byProject = a.projectName.localeCompare(b.projectName, "ko")
            if (byProject !== 0) return byProject
            return a.subProjectName.localeCompare(b.subProjectName, "ko")
          }),
      }))
  }, [visibleTasks])

  const selectedManagementHref = selectedDataSources[0]?.managementHref || homeHref

  const weeklyGlobalSchedules = useMemo<WeeklyGlobalScheduleItem[]>(() => {
    return globalSchedules
      .map((item) => {
        const start = parseIsoDate(item.startDate)
        const end = parseIsoDate(item.endDate)
        if (!start || !end) return null
        const from = start <= end ? start : end
        const to = start <= end ? end : start
        return {
          id: item.id,
          title: item.title,
          type: item.type,
          startDate: from,
          endDate: to,
        } satisfies WeeklyGlobalScheduleItem
      })
      .filter((item): item is WeeklyGlobalScheduleItem => Boolean(item))
      .filter((item) => item.startDate <= weekEnd && item.endDate >= weekStart)
      .sort((a, b) => {
        const byStart = a.startDate.getTime() - b.startDate.getTime()
        if (byStart !== 0) return byStart
        return a.title.localeCompare(b.title, "ko")
      })
  }, [globalSchedules, weekEnd, weekStart])

  const weeklyGlobalScheduleDayKeys = useMemo(() => {
    const keys = new Set<string>()
    weeklyGlobalSchedules.forEach((item) => {
      const cursor = new Date(item.startDate.getFullYear(), item.startDate.getMonth(), item.startDate.getDate())
      let guard = 0
      while (cursor <= item.endDate && guard < 31) {
        keys.add(toDayKey(cursor))
        cursor.setDate(cursor.getDate() + 1)
        guard += 1
      }
    })
    return keys
  }, [weeklyGlobalSchedules])

  const weeklyGlobalSchedulesByDay = useMemo(() => {
    const map = new Map<string, WeeklyGlobalScheduleItem[]>()
    weeklyGlobalSchedules.forEach((item) => {
      const cursor = new Date(item.startDate.getFullYear(), item.startDate.getMonth(), item.startDate.getDate())
      let guard = 0
      while (cursor <= item.endDate && guard < 31) {
        const key = toDayKey(cursor)
        const list = map.get(key) || []
        list.push(item)
        map.set(key, list)
        cursor.setDate(cursor.getDate() + 1)
        guard += 1
      }
    })
    return map
  }, [weeklyGlobalSchedules])

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
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">WorkHub</p>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              </div>
	              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
	                <Badge variant="outline" className={`gap-1.5 ${tone.summaryBadge}`}>
	                  <CalendarDays className="h-3.5 w-3.5" />
	                  {format(weekStart, "yyyy년 M월 d일", { locale: ko })} - {format(weekEnd, "M월 d일", { locale: ko })}
	                </Badge>
	                <Badge variant="outline" className="gap-1.5">
	                  {selectedDepartment === "all" ? "전체 부서" : selectedDepartment}
	                </Badge>
	                <Badge variant="outline" className="gap-1.5">
	                  <Users className="h-3.5 w-3.5" />
	                  {selectedPerson === "all" ? "전체 인원" : selectedPerson} / {visibleTasks.length}개 업무
	                </Badge>
	              </div>
	            </div>
	
	            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:w-auto lg:grid-cols-none lg:auto-cols-max lg:grid-flow-col">
	              <Select value={selectedDepartment} onValueChange={(value) => setSelectedDepartment(value as DepartmentPersonGroup | "all")}>
	                <SelectTrigger className="h-10 w-full bg-white lg:w-[150px]">
	                  <SelectValue placeholder="부서 선택" />
	                </SelectTrigger>
	                <SelectContent>
	                  <SelectItem value="all">전체 부서</SelectItem>
	                  {dataSources.map((source) => (
	                    <SelectItem key={source.id} value={source.departmentGroup}>
	                      {source.label}
	                    </SelectItem>
	                  ))}
	                </SelectContent>
	              </Select>
	              <Select value={selectedPerson} onValueChange={setSelectedPerson}>
	                <SelectTrigger className="h-10 w-full bg-white lg:w-[180px]">
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
	                <Link href={selectedManagementHref}>스케줄</Link>
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
              <div className="pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setCurrentWeekAnchor(new Date())}>
                  이번주로 이동
                </Button>
              </div>
            </CardHeader>
          </Card>
        ) : (
          <>
          <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 shadow-sm md:hidden">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200/90 px-3 py-2">
              <span className="text-xs font-semibold text-slate-600">모바일 주간 업무로드현황</span>
              <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setCurrentWeekAnchor((prev) => addDays(prev, -7))}
                  aria-label="전주 보기"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-1.5 text-[10px]"
                  onClick={() => setCurrentWeekAnchor(new Date())}
                >
                  이번주
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setCurrentWeekAnchor((prev) => addDays(prev, 7))}
                  aria-label="다음주 보기"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="divide-y divide-slate-200/80">
              {groupedTasksByPersonProject.map((personGroup) => (
                <div key={`mobile-${personGroup.person}`} className="p-3">
                  <div className="mb-2 text-sm font-semibold text-slate-900">{personGroup.person}</div>
                  <div className="space-y-3">
                    {personGroup.projects.map((project) => {
                      const projectMemos = Array.from(
                        new Set(project.items.map((item) => item.task.memo?.trim() || "").filter(Boolean)),
                      )
                      return (
                        <div key={`mobile-${personGroup.person}-${project.projectId}`} className="rounded-xl border border-slate-200 bg-white p-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-start gap-1.5">
	                                <ProjectTypeBadge type={project.projectType} />
	                                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
	                                  {project.departmentLabel}
	                                </Badge>
	                                <div className="min-w-0">
                                  <span className="block truncate text-[13px] font-semibold leading-4 text-slate-900">{project.projectName}</span>
                                  {project.subProjectName && (
                                    <div className="mt-0.5 truncate text-[10px] leading-4 text-slate-500">하위: {project.subProjectName}</div>
                                  )}
                                </div>
                              </div>
                            </div>
                            {projectMemos.length > 0 && (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700"
                                onClick={() =>
                                  setSelectedProjectMemo({
                                    person: personGroup.person,
                                    projectName: project.projectName,
                                    subProjectName: project.subProjectName,
                                    memos: projectMemos,
                                  })
                                }
                              >
                                메모
                              </button>
                            )}
                          </div>

                          <div className="mt-2 grid grid-cols-7 overflow-hidden rounded-md border border-slate-200">
                            {weekDays.map((day) => (
                              <div
                                key={`mobile-head-${project.projectId}-${day.date.toISOString()}`}
                                className={cn(
                                  "px-1 py-1 text-center text-[10px] font-semibold",
                                  day.dayOfWeek === 0 ? "text-red-600" : day.dayOfWeek === 6 ? "text-blue-600" : "text-slate-500",
                                  weeklyGlobalScheduleDayKeys.has(toDayKey(day.date)) ? "bg-rose-50" : "bg-slate-50",
                                )}
                              >
                                {day.label}
                              </div>
                            ))}
                          </div>

                          <div className="mt-2 space-y-2">
                            {project.items.map((item) => {
                              const bar = getTaskBarSpan(item.task, weekStart, weekEnd)
                              return (
                                <button
                                  key={`mobile-task-${project.projectId}-${item.task.id}`}
                                  type="button"
                                  className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-left"
                                  onClick={() => setSelectedTaskItem(item)}
                                >
                                  <div className="mb-1 flex items-center gap-1.5">
                                    <StatusBadge status={item.task.status} />
                                    <CategoryBadge category={item.task.category} />
                                  </div>
                                  <div className="truncate text-xs font-semibold text-slate-900">{item.task.task}</div>
                                  <div className="mt-1 h-2 rounded-full bg-slate-200">
                                    <div
                                      className={cn("h-2 rounded-full", getWeeklyStatusBarClass(item.task.status).split(" ")[0])}
                                      style={{
                                        marginLeft: `${(bar.startOffset / 7) * 100}%`,
                                        width: `${(bar.span / 7) * 100}%`,
                                      }}
                                    />
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="hidden overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 shadow-sm md:block">
            <div className="grid grid-cols-[320px_repeat(7,minmax(90px,1fr))] border-b border-slate-200/90">
              <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-slate-700">
                <span>업무 정보</span>
                <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white/90 p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setCurrentWeekAnchor((prev) => addDays(prev, -7))}
                    aria-label="전주 보기"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setCurrentWeekAnchor(new Date())}
                  >
                    이번주
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setCurrentWeekAnchor((prev) => addDays(prev, 7))}
                    aria-label="다음주 보기"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {weekDays.map((day) => (
                <div
                  key={day.date.toISOString()}
                  className={`border-l border-slate-200/80 px-2 py-3 text-center ${tone.dayHeader} ${
                    weeklyGlobalScheduleDayKeys.has(toDayKey(day.date)) ? "bg-rose-100/60" : ""
                  }`}
                >
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
                      (() => {
                        const daySchedules = weeklyGlobalSchedulesByDay.get(toDayKey(day.date)) || []
                        if (daySchedules.length > 0) return "text-rose-700"
                        if (day.isToday) return "text-yellow-700"
                        if (day.dayOfWeek === 6) return "text-blue-600"
                        if (day.dayOfWeek === 0) return "text-red-600"
                        return "text-slate-500"
                      })()
                    }`}
                    title={(() => {
                      const daySchedules = weeklyGlobalSchedulesByDay.get(toDayKey(day.date)) || []
                      return daySchedules.map((schedule) => schedule.title).join(", ")
                    })()}
                  >
                    {(() => {
                      const daySchedules = weeklyGlobalSchedulesByDay.get(toDayKey(day.date)) || []
                      if (daySchedules.length === 0) return day.label
                      const shownTitles = daySchedules.slice(0, 2).map((schedule) => schedule.title)
                      const suffix = daySchedules.length > 2 ? ` 외 ${daySchedules.length - 2}` : ""
                      return `${day.label} (${shownTitles.join(", ")}${suffix})`
                    })()}
                  </div>
                </div>
              ))}
            </div>

            <div className="divide-y divide-slate-200/80">
              {groupedTasksByPersonProject.map((personGroup) => (
                <div key={personGroup.person}>
                  <div className="grid grid-cols-[320px_repeat(7,minmax(90px,1fr))] border-b border-slate-200 bg-slate-50/70">
                    <div className="px-4 py-1.5">
                      <div className="text-sm font-semibold text-slate-900">{personGroup.person}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {personGroup.projects.reduce((sum, project) => sum + project.items.length, 0)}개 업무 · {personGroup.projects.length}개 프로젝트
                      </div>
                    </div>
                    <div className="col-span-7" />
                  </div>

                  {personGroup.projects.map((project) => {
                    const projectMemos = Array.from(
                      new Set(project.items.map((item) => item.task.memo?.trim() || "").filter(Boolean)),
                    )
                    const rowHeight = Math.max(48, project.items.length * 26 + 8)
                    return (
                      <div key={`${personGroup.person}-${project.projectId}`} className="grid grid-cols-[320px_repeat(7,minmax(90px,1fr))] items-stretch">
                        <div className="flex px-3 py-0.5">
                          <div className={`flex min-h-[48px] w-full flex-col justify-center rounded-xl border px-2 py-1 text-left ${tone.taskCard}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-start gap-1.5">
	                                  <ProjectTypeBadge type={project.projectType} />
	                                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
	                                    {project.departmentLabel}
	                                  </Badge>
	                                  <div className="min-w-0">
                                    <div className="truncate text-xs font-semibold leading-4 text-slate-900">{project.projectName}</div>
                                    {project.subProjectName && (
                                      <div className="mt-0.5 truncate text-[10px] leading-4 text-slate-500">하위: {project.subProjectName}</div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {projectMemos.length > 0 && (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100"
                                  onClick={() =>
                                    setSelectedProjectMemo({
                                      person: personGroup.person,
                                      projectName: project.projectName,
                                      subProjectName: project.subProjectName,
                                      memos: projectMemos,
                                    })
                                  }
                                >
                                  메모
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="relative col-span-7 grid grid-cols-7 border-t border-b border-slate-200/60" style={{ minHeight: `${rowHeight}px` }}>
                          {weekDays.map((day) => (
                            <div
                              key={`${personGroup.person}-${project.projectId}-${day.date.toISOString()}`}
                              className={`relative border-l border-slate-200/80 ${
                                weeklyGlobalScheduleDayKeys.has(toDayKey(day.date))
                                  ? "bg-rose-100/55"
                                  : day.isToday
                                    ? "bg-yellow-50/80"
                                    : day.dayOfWeek === 6
                                      ? "bg-blue-50/60"
                                      : day.dayOfWeek === 0
                                        ? "bg-red-50/60"
                                        : "bg-white"
                              }`}
                            />
                          ))}

                          {project.items.map((item, index) => {
                            const bar = getTaskBarSpan(item.task, weekStart, weekEnd)
                            return (
                              <div
                                key={`${personGroup.person}-${project.projectId}-${item.task.id}`}
                                className="pointer-events-none absolute left-0 right-0"
                                style={{ top: `${5 + index * 26}px`, height: "20px" }}
                              >
                                <div
                                  className="pointer-events-none absolute"
                                  style={{
                                    left: `${(bar.startOffset / 7) * 100}%`,
                                    width: `${(bar.span / 7) * 100}%`,
                                  }}
                                >
                                  <button
                                    type="button"
                                    className={`pointer-events-auto h-5 w-full rounded-md px-2 text-left text-[10px] font-semibold shadow-sm ${getWeeklyStatusBarClass(item.task.status)}`}
                                    onClick={() => setSelectedTaskItem(item)}
                                    title={`${item.task.task} (${item.task.startDate} ~ ${item.task.endDate})`}
                                  >
                                    <span className="block truncate">{item.task.task}</span>
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>
          </>
        )}

        <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-xs text-slate-500 shadow-sm">
          주간 업무로드현황은 현재 날짜가 포함된 주간 범위와 겹치는 최하위 업무만 표시합니다. 숨김 처리된 프로젝트와 업무는 제외되며, 인원 목록은 부서 담당자 설정을 기준으로 노출됩니다.
        </div>
      </div>

      <Dialog open={!!selectedProjectMemo} onOpenChange={(open) => !open && setSelectedProjectMemo(null)}>
        <DialogContent className="sm:max-w-[520px]">
          {selectedProjectMemo ? (
            <>
              <DialogHeader>
                <DialogTitle>프로젝트 메모</DialogTitle>
                <DialogDescription>
                  {selectedProjectMemo.person} · {selectedProjectMemo.projectName}
                  {selectedProjectMemo.subProjectName ? ` · ${selectedProjectMemo.subProjectName}` : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="grid gap-2">
                    {selectedProjectMemo.memos.map((memo, index) => (
                      <div key={`${selectedProjectMemo.projectName}-memo-${index}`} className="rounded-lg bg-white p-3 text-sm text-slate-700">
                        {memo}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedTaskItem} onOpenChange={(open) => !open && setSelectedTaskItem(null)}>
        <DialogContent className="sm:max-w-[560px]">
          {selectedTaskItem ? (
            <>
              <DialogHeader>
                <DialogTitle>업무 상세</DialogTitle>
                <DialogDescription>
                  {selectedTaskItem.person} · {selectedTaskItem.projectName}
                  {selectedTaskItem.subProjectName ? ` · ${selectedTaskItem.subProjectName}` : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 text-sm">
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <div className="text-base font-semibold text-slate-900">{selectedTaskItem.task.task}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge status={selectedTaskItem.task.status} />
                    <CategoryBadge category={selectedTaskItem.task.category} />
                    <Badge variant="outline">{selectedTaskItem.task.department || "기타"}</Badge>
                  </div>
                  <div className="mt-2 text-slate-600">
                    {selectedTaskItem.task.startDate} ~ {selectedTaskItem.task.endDate}
                  </div>
                  <div className="mt-1 text-slate-600">공수: {selectedTaskItem.task.manDays}일</div>
                </div>
                {selectedTaskItem.task.memo ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-amber-900">
                    {selectedTaskItem.task.memo}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-slate-500">메모 없음</div>
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  )
}
