"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Save, ShieldCheck, Users } from "lucide-react"
import { useAuth } from "@/components/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import {
  DEPARTMENT_PERSON_GROUPS,
  DEFAULT_DEPARTMENT_ORG_SETTINGS,
  DEFAULT_DEPARTMENT_PERSON_SETTINGS,
  DEFAULT_MY_PAGE_EDITABLE_FIELDS,
  MBTI_TYPES,
  saveDepartmentOrgSettings,
  saveGlobalSchedules,
  saveMyPageEditableFields,
  saveUserDepartment,
  saveUserMbti,
  saveUserPagePermissions,
  saveUserTaskAliases,
  subscribeAllUserPagePermissions,
  subscribeDepartmentOrgSettings,
  subscribeDepartmentPersonSettings,
  subscribeGlobalSchedules,
  subscribeMyPageEditableFields,
  subscribeUserProfiles,
  type GlobalSchedule,
  type DepartmentPersonGroup,
  type DepartmentOrgSettings,
  type DepartmentPersonSettings,
  type MbtiType,
  type MyPageEditableFieldsSettings,
  type UserPagePermissionEntry,
  type UserProfile,
} from "@/lib/firestore-service"
import { EDITABLE_TASK_FIELD_OPTIONS, type EditableTaskField } from "@/lib/data"
import { getDepartmentOrgPersonNamesFromOrg, type DepartmentOrg, type DepartmentOrgMember } from "@/lib/department-org"
import {
  DEFAULT_PAGE_PERMISSIONS,
  PAGE_PERMISSIONS,
  isAdminEmail,
  normalizeEmail,
  type UserPagePermissions,
} from "@/lib/page-access"

type DraftPermissionMap = Record<string, UserPagePermissions>
type DraftAliasMap = Record<string, string>
type DraftUserDepartmentMap = Record<string, DepartmentPersonGroup | "none">
type DraftUserMbtiMap = Record<string, MbtiType | "none">
type DraftDepartmentPersonMap = Record<DepartmentPersonGroup, string>
type DraftGlobalSchedule = Pick<GlobalSchedule, "id" | "title" | "type" | "startDate" | "endDate">

const WEEKLY_WORK_KEYS: Array<keyof UserPagePermissions> = ["strategyWeeklyWork", "faWeeklyWork", "ictWeeklyWork"]

const PAGE_PERMISSION_SHORT_LABELS: Record<string, string> = {
  myPage: "마이\n워크",
  strategyWorkManagement: "전략\n스케줄",
  strategyWorkManagementEdit: "전략\n업무수정",
  strategyWeeklyWork: "주간업무\n로드현황",
  faWorkManagement: "FA\n스케줄",
  faWorkManagementEdit: "FA\n업무수정",
  faWeeklyWork: "주간업무\n로드현황",
  ictWeeklyWork: "주간업무\n로드현황",
  gptTest: "GPT\n테스트",
  mbtiPage: "MBTI",
  recentChangesWidget: "최근 변경\n위젯",
}

type PermissionColumn = {
  id: string
  label: string
  shortLabel: string
  getValue: (permissions: UserPagePermissions) => boolean
  setValue: (permissions: UserPagePermissions, checked: boolean) => UserPagePermissions
}

const permissionColumns: PermissionColumn[] = PAGE_PERMISSIONS
  .filter((page) => page.key !== "faWeeklyWork" && page.key !== "ictWeeklyWork")
  .map((page) => {
    if (page.key === "strategyWeeklyWork") {
      return {
        id: "weeklyWorkUnified",
        label: "주간업무로드 현황",
        shortLabel: "주간업무\n로드현황",
        getValue: (permissions) => WEEKLY_WORK_KEYS.every((key) => permissions[key]),
        setValue: (permissions, checked) => {
          const next = { ...permissions }
          WEEKLY_WORK_KEYS.forEach((key) => {
            next[key] = checked
          })
          return next
        },
      } satisfies PermissionColumn
    }

    const key = page.key
    return {
      id: key,
      label: page.label,
      shortLabel: PAGE_PERMISSION_SHORT_LABELS[key] || page.label,
      getValue: (permissions) => permissions[key],
      setValue: (permissions, checked) => ({ ...permissions, [key]: checked }),
    } satisfies PermissionColumn
  })

const getPermissionColumnById = (id: string) => permissionColumns.find((column) => column.id === id)

function DepartmentOrgEditor({
  org,
  onChange,
}: {
  org: DepartmentOrg
  onChange: (org: DepartmentOrg) => void
}) {
  const updateLeader = (updates: Partial<DepartmentOrgMember>) => {
    onChange({ ...org, leader: { name: org.leader?.name || "", title: org.leader?.title, ...updates } })
  }

  const updateAdvisor = (index: number, updates: Partial<DepartmentOrgMember>) => {
    const advisors = [...(org.advisors || [])]
    advisors[index] = { ...advisors[index], ...updates }
    onChange({ ...org, advisors })
  }

  const addAdvisor = () => {
    onChange({ ...org, advisors: [...(org.advisors || []), { name: "", title: "" }] })
  }

  const removeAdvisor = (index: number) => {
    onChange({ ...org, advisors: (org.advisors || []).filter((_, innerIndex) => innerIndex !== index) })
  }

  const updateTeam = (teamIndex: number, updates: Partial<DepartmentOrg["teams"][number]>) => {
    const teams = org.teams.map((team, index) => (index === teamIndex ? { ...team, ...updates } : team))
    onChange({ ...org, teams })
  }

  const updateTeamMember = (teamIndex: number, memberIndex: number, updates: Partial<DepartmentOrgMember>) => {
    const teams = org.teams.map((team, index) => {
      if (index !== teamIndex) return team
      const members = team.members.map((member, innerIndex) =>
        innerIndex === memberIndex ? { ...member, ...updates } : member,
      )
      return { ...team, members }
    })
    onChange({ ...org, teams })
  }

  const addTeam = () => {
    onChange({ ...org, teams: [...org.teams, { name: `팀 ${org.teams.length + 1}`, members: [] }] })
  }

  const removeTeam = (teamIndex: number) => {
    onChange({ ...org, teams: org.teams.filter((_, index) => index !== teamIndex) })
  }

  const addTeamMember = (teamIndex: number) => {
    const teams = org.teams.map((team, index) =>
      index === teamIndex ? { ...team, members: [...team.members, { name: "", title: "" }] } : team,
    )
    onChange({ ...org, teams })
  }

  const removeTeamMember = (teamIndex: number, memberIndex: number) => {
    const teams = org.teams.map((team, index) =>
      index === teamIndex
        ? { ...team, members: team.members.filter((_, innerIndex) => innerIndex !== memberIndex) }
        : team,
    )
    onChange({ ...org, teams })
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">{org.label} 조직도</p>
        <span className="text-[11px] text-slate-500">이름과 직책을 직접 수정할 수 있습니다.</span>
      </div>

      <div className="rounded-md bg-white p-2">
        <div className="mb-1 font-semibold text-slate-800">부서장</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={org.leader?.name || ""}
            onChange={(event) => updateLeader({ name: event.target.value })}
            className="h-8 bg-white text-xs"
            placeholder="이름"
          />
          <Input
            value={org.leader?.title || ""}
            onChange={(event) => updateLeader({ title: event.target.value })}
            className="h-8 bg-white text-xs"
            placeholder="직책"
          />
        </div>
      </div>

      <div className="rounded-md bg-white p-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="font-semibold text-slate-800">고문</div>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={addAdvisor}>
            추가
          </Button>
        </div>
        {(org.advisors || []).length > 0 ? (
          <div className="grid gap-2">
            {(org.advisors || []).map((advisor, index) => (
              <div key={`advisor-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={advisor.name}
                  onChange={(event) => updateAdvisor(index, { name: event.target.value })}
                  className="h-8 bg-white text-xs"
                  placeholder="이름"
                />
                <Input
                  value={advisor.title || ""}
                  onChange={(event) => updateAdvisor(index, { title: event.target.value })}
                  className="h-8 bg-white text-xs"
                  placeholder="직책"
                />
                <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => removeAdvisor(index)}>
                  삭제
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">등록된 고문이 없습니다.</p>
        )}
      </div>

      <div className="grid gap-2">
        {org.teams.map((team, teamIndex) => (
          <div key={`team-${teamIndex}`} className="rounded-md bg-white p-2">
            <div className="mb-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                value={team.name}
                onChange={(event) => updateTeam(teamIndex, { name: event.target.value })}
                className="h-8 bg-white text-xs font-semibold"
                placeholder="팀명"
              />
              <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => removeTeam(teamIndex)}>
                팀 삭제
              </Button>
            </div>
            <div className="grid gap-2">
              {team.members.map((member, memberIndex) => (
                <div key={`team-${teamIndex}-member-${memberIndex}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Input
                    value={member.name}
                    onChange={(event) => updateTeamMember(teamIndex, memberIndex, { name: event.target.value })}
                    className="h-8 bg-white text-xs"
                    placeholder="이름"
                  />
                  <Input
                    value={member.title || ""}
                    onChange={(event) => updateTeamMember(teamIndex, memberIndex, { title: event.target.value })}
                    className="h-8 bg-white text-xs"
                    placeholder="직책"
                  />
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => removeTeamMember(teamIndex, memberIndex)}>
                    삭제
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="h-8 justify-center text-xs" onClick={() => addTeamMember(teamIndex)}>
                팀원 추가
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="h-8 justify-center text-xs" onClick={addTeam}>
          팀 추가
        </Button>
      </div>
    </div>
  )
}


export default function AdminPage() {
  const { isAdmin } = useAuth()
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [permissionEntries, setPermissionEntries] = useState<UserPagePermissionEntry[]>([])
  const [departmentPersonSettings, setDepartmentPersonSettings] = useState<DepartmentPersonSettings>(
    DEFAULT_DEPARTMENT_PERSON_SETTINGS,
  )
  const [draftDepartmentOrg, setDraftDepartmentOrg] = useState<DepartmentOrgSettings>(DEFAULT_DEPARTMENT_ORG_SETTINGS)
  const [draftEmail, setDraftEmail] = useState("")
  const [draftPermissions, setDraftPermissions] = useState<DraftPermissionMap>({})
  const [draftAliases, setDraftAliases] = useState<DraftAliasMap>({})
  const [draftDepartments, setDraftDepartments] = useState<DraftUserDepartmentMap>({})
  const [draftMbti, setDraftMbti] = useState<DraftUserMbtiMap>({})
  const [draftDepartmentPersons, setDraftDepartmentPersons] = useState<DraftDepartmentPersonMap>({
    ICT: "",
    FA: "",
    전략기획: "",
    기타: "",
  })
  const [bulkTargetKey, setBulkTargetKey] = useState<string>(permissionColumns[0]?.id || "myPage")
  const [savingEmail, setSavingEmail] = useState<string | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [savingDepartmentPersons, setSavingDepartmentPersons] = useState(false)
  const [draftGlobalSchedules, setDraftGlobalSchedules] = useState<DraftGlobalSchedule[]>([])
  const [savingGlobalSchedules, setSavingGlobalSchedules] = useState(false)
  const [draftMyPageEditableFields, setDraftMyPageEditableFields] = useState<MyPageEditableFieldsSettings>([
    ...DEFAULT_MY_PAGE_EDITABLE_FIELDS,
  ])
  const [savingMyPageEditableFields, setSavingMyPageEditableFields] = useState(false)
  const [accountDepartmentFilter, setAccountDepartmentFilter] = useState<DepartmentPersonGroup | "none" | "all">("all")
  const [accountNameQuery, setAccountNameQuery] = useState("")

  useEffect(() => {
    if (!isAdmin) return

    const unsubscribeProfiles = subscribeUserProfiles(setProfiles)
    const unsubscribePermissions = subscribeAllUserPagePermissions(setPermissionEntries)
    const unsubscribeDepartmentPersons = subscribeDepartmentPersonSettings(setDepartmentPersonSettings)
    const unsubscribeDepartmentOrg = subscribeDepartmentOrgSettings(setDraftDepartmentOrg)
    const unsubscribeGlobalSchedules = subscribeGlobalSchedules((schedules) => {
      setDraftGlobalSchedules(
        schedules.map((item) => ({
          id: item.id,
          title: item.title,
          type: item.type,
          startDate: item.startDate,
          endDate: item.endDate,
        })),
      )
    })
    const unsubscribeMyPageEditableFields = subscribeMyPageEditableFields(setDraftMyPageEditableFields)

    return () => {
      unsubscribeProfiles()
      unsubscribePermissions()
      unsubscribeDepartmentPersons()
      unsubscribeDepartmentOrg()
      unsubscribeGlobalSchedules()
      unsubscribeMyPageEditableFields()
    }
  }, [isAdmin])

  const rows = useMemo(() => {
    const emails = new Set<string>()
    profiles.forEach((profile) => emails.add(profile.email))
    permissionEntries.forEach((entry) => emails.add(entry.email))

    return Array.from(emails)
      .filter((email) => !isAdminEmail(email))
      .sort((a, b) => a.localeCompare(b))
  }, [profiles, permissionEntries])

  const filteredRows = useMemo(() => {
    const query = accountNameQuery.trim().toLowerCase()
    return rows.filter((email) => {
      const department = draftDepartments[email] || "none"
      if (accountDepartmentFilter !== "all" && department !== accountDepartmentFilter) return false

      if (!query) return true
      const profile = profiles.find((entry) => entry.email === email)
      const aliasText = (profile?.taskAliases || []).join(" ").toLowerCase()
      const emailLocal = email.split("@")[0]?.toLowerCase() || ""
      return email.toLowerCase().includes(query) || emailLocal.includes(query) || aliasText.includes(query)
    })
  }, [accountDepartmentFilter, accountNameQuery, draftDepartments, profiles, rows])

  useEffect(() => {
    const nextDraftPermissions: DraftPermissionMap = {}
    const nextDraftAliases: DraftAliasMap = {}
    const nextDraftDepartments: DraftUserDepartmentMap = {}
    const nextDraftMbti: DraftUserMbtiMap = {}

    rows.forEach((email) => {
      const savedPermission = permissionEntries.find((entry) => entry.email === email)
      const profile = profiles.find((entry) => entry.email === email)

      nextDraftPermissions[email] = savedPermission?.permissions || DEFAULT_PAGE_PERMISSIONS
      nextDraftAliases[email] = (profile?.taskAliases || []).join(", ")
      nextDraftDepartments[email] = profile?.department || "none"
      nextDraftMbti[email] = profile?.mbti || "none"
    })

    setDraftPermissions(nextDraftPermissions)
    setDraftAliases(nextDraftAliases)
    setDraftDepartments(nextDraftDepartments)
    setDraftMbti(nextDraftMbti)
  }, [rows, permissionEntries, profiles])

  useEffect(() => {
    setDraftDepartmentPersons({
      ICT: (departmentPersonSettings.ICT || []).join(", "),
      FA: (departmentPersonSettings.FA || []).join(", "),
      전략기획: (departmentPersonSettings.전략기획 || []).join(", "),
      기타: (departmentPersonSettings.기타 || []).join(", "),
    })
  }, [departmentPersonSettings])

  useEffect(() => {
    setDraftDepartmentPersons({
      ICT: getDepartmentOrgPersonNamesFromOrg(draftDepartmentOrg.ICT).join(", "),
      FA: getDepartmentOrgPersonNamesFromOrg(draftDepartmentOrg.FA).join(", "),
      전략기획: getDepartmentOrgPersonNamesFromOrg(draftDepartmentOrg.전략기획).join(", "),
      기타: getDepartmentOrgPersonNamesFromOrg(draftDepartmentOrg.기타).join(", "),
    })
  }, [draftDepartmentOrg])

  const updateDraftDepartmentOrg = (group: DepartmentPersonGroup, org: DepartmentOrg) => {
    setDraftDepartmentOrg((prev) => ({
      ...prev,
      [group]: org,
    }))
  }

  const handleTogglePermission = (email: string, columnId: string, checked: boolean) => {
    const column = getPermissionColumnById(columnId)
    if (!column) return

    setDraftPermissions((prev) => ({
      ...prev,
      [email]: {
        ...column.setValue(prev[email] || DEFAULT_PAGE_PERMISSIONS, checked),
      },
    }))
  }

  const handleBulkTogglePermission = (columnId: string, checked: boolean) => {
    const column = getPermissionColumnById(columnId)
    if (!column) return

    setDraftPermissions((prev) => {
      const next = { ...prev }
      filteredRows.forEach((email) => {
        next[email] = column.setValue(prev[email] || DEFAULT_PAGE_PERMISSIONS, checked)
      })
      return next
    })
  }

  const handleSaveAllUsers = async () => {
    if (filteredRows.length === 0) return
    setSavingAll(true)
    try {
      await Promise.all(
        filteredRows.map((email) =>
          saveUserPagePermissions(email, draftPermissions[email] || DEFAULT_PAGE_PERMISSIONS),
        ),
      )
      toast.success(`${filteredRows.length}명의 페이지 권한이 일괄 저장되었습니다.`)
    } catch {
      toast.error("일괄 저장에 실패했습니다.")
    } finally {
      setSavingAll(false)
    }
  }

  const handleSaveUser = async (email: string) => {
    const normalized = normalizeEmail(email)
    if (!normalized) return

    setSavingEmail(normalized)

    try {
      await Promise.all([
        saveUserPagePermissions(normalized, draftPermissions[normalized] || DEFAULT_PAGE_PERMISSIONS),
        saveUserTaskAliases(
          normalized,
          (draftAliases[normalized] || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
        saveUserDepartment(
          normalized,
          draftDepartments[normalized] !== "none" ? draftDepartments[normalized] : undefined,
        ),
        saveUserMbti(
          normalized,
          draftMbti[normalized] !== "none" ? (draftMbti[normalized] as MbtiType) : undefined,
        ),
      ])
      toast.success("사용자 권한, 별칭, 소속 부서, MBTI가 저장되었습니다.")
    } catch {
      toast.error("사용자 설정 저장에 실패했습니다.")
    } finally {
      setSavingEmail(null)
    }
  }

  const handleAddUser = async () => {
    const normalized = normalizeEmail(draftEmail)
    if (!normalized) {
      toast.error("사용자 이메일을 입력해 주세요.")
      return
    }

    if (isAdminEmail(normalized)) {
      toast.error("관리자 계정은 별도 관리 항목입니다.")
      return
    }

    setDraftPermissions((prev) => ({
      ...prev,
      [normalized]: prev[normalized] || DEFAULT_PAGE_PERMISSIONS,
    }))
    setDraftAliases((prev) => ({
      ...prev,
      [normalized]: prev[normalized] || "",
    }))
    setDraftDepartments((prev) => ({
      ...prev,
      [normalized]: prev[normalized] || "none",
    }))
    setDraftEmail("")
    await handleSaveUser(normalized)
  }

  const handleSaveDepartmentPersons = async () => {
    setSavingDepartmentPersons(true)

    try {
      const nextSettings = await saveDepartmentOrgSettings(draftDepartmentOrg)

      const aliasToProfile = new Map<string, UserProfile>()
      profiles.forEach((profile) => {
        ;(profile.taskAliases || []).forEach((alias) => {
          const normalizedAlias = alias.trim()
          if (!normalizedAlias) return
          aliasToProfile.set(normalizedAlias, profile)
        })
      })

      const matchedByEmail = new Map<string, DepartmentPersonGroup>()
      const conflictedAliases: string[] = []
      const unmatchedAliases: string[] = []

      DEPARTMENT_PERSON_GROUPS.forEach((group) => {
        nextSettings[group].forEach((alias) => {
          const profile = aliasToProfile.get(alias)
          if (!profile) {
            unmatchedAliases.push(alias)
            return
          }

          const prevGroup = matchedByEmail.get(profile.email)
          if (prevGroup && prevGroup !== group) {
            conflictedAliases.push(alias)
            return
          }
          matchedByEmail.set(profile.email, group)
        })
      })

      await Promise.all(
        Array.from(matchedByEmail.entries()).map(([email, group]) => saveUserDepartment(email, group)),
      )

      toast.success(`부서별 담당자 설정이 저장되고 ${matchedByEmail.size}명의 소속 부서가 동기화되었습니다.`)

      if (unmatchedAliases.length > 0) {
        toast.info(`계정과 매칭되지 않은 이름 ${unmatchedAliases.length}건은 부서 동기화에서 제외되었습니다.`)
      }
      if (conflictedAliases.length > 0) {
        toast.info(`여러 부서에 중복된 이름 ${conflictedAliases.length}건은 첫 매칭 부서만 적용되었습니다.`)
      }
    } catch {
      toast.error("부서별 담당자 설정 저장에 실패했습니다.")
    } finally {
      setSavingDepartmentPersons(false)
    }
  }

  const addGlobalScheduleRow = () => {
    const nextId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `schedule-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    setDraftGlobalSchedules((prev) => [
      ...prev,
      {
        id: nextId,
        title: "",
        type: "holiday",
        startDate: "",
        endDate: "",
      },
    ])
  }

  const removeGlobalScheduleRow = (id: string) => {
    setDraftGlobalSchedules((prev) => prev.filter((item) => item.id !== id))
  }

  const updateGlobalScheduleRow = (id: string, updates: Partial<DraftGlobalSchedule>) => {
    setDraftGlobalSchedules((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    )
  }

  const handleToggleMyPageEditableField = (field: EditableTaskField, checked: boolean) => {
    setDraftMyPageEditableFields((prev) => {
      const without = prev.filter((value) => value !== field)
      return checked ? [...without, field] : without
    })
  }

  const handleSaveMyPageEditableFields = async () => {
    setSavingMyPageEditableFields(true)
    try {
      await saveMyPageEditableFields(draftMyPageEditableFields)
      toast.success("마이 워크 편집 가능 필드가 저장되었습니다.")
    } catch {
      toast.error("마이 워크 편집 가능 필드 저장에 실패했습니다.")
    } finally {
      setSavingMyPageEditableFields(false)
    }
  }

  const handleSaveGlobalSchedules = async () => {
    const normalized = draftGlobalSchedules
      .map((item) => ({
        ...item,
        title: item.title.trim(),
        startDate: item.startDate.trim(),
        endDate: item.endDate.trim(),
      }))
      .filter((item) => item.startDate && item.endDate)
      .map((item) => ({
        ...item,
        title: item.title || (item.type === "holiday" ? "공휴일" : "전체 연차"),
      }))

    setSavingGlobalSchedules(true)
    try {
      await saveGlobalSchedules(normalized)
      toast.success("공휴일/전체 연차 일정이 저장되었습니다.")
    } catch {
      toast.error("공휴일/전체 연차 일정 저장에 실패했습니다.")
    } finally {
      setSavingGlobalSchedules(false)
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 lg:px-10">
      <div className="mx-auto max-w-[1700px] space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">WorkHub</p>
            <p className="text-sm font-medium text-primary">관리자 전용</p>
            <h1 className="text-3xl font-bold tracking-tight">사용자 권한 및 부서 설정 관리</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              사용자별 페이지 접근 권한, 소속 부서, 업무 별칭과 부서별 기본 권한을 함께 관리합니다.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              메인으로 돌아가기
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">부서별 담당자 설정</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {DEPARTMENT_PERSON_GROUPS.map((group) => (
                <div key={group} className="space-y-2">
                  <p className="text-sm font-semibold text-foreground">{group}</p>
                  <DepartmentOrgEditor
                    org={draftDepartmentOrg[group]}
                    onChange={(org) => updateDraftDepartmentOrg(group, org)}
                  />
                  <Textarea
                    value={draftDepartmentPersons[group] || ""}
                    readOnly
                    className="min-h-20 bg-muted/40"
                    placeholder="예) 김철수, 이영희"
                  />
                  <p className="text-xs text-muted-foreground">
                    쉼표로 구분해서 입력하면 업무 생성 시 해당 부서 담당자 목록으로 사용됩니다.
                  </p>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={() => void handleSaveDepartmentPersons()} disabled={savingDepartmentPersons}>
                <Save className="h-4 w-4" />
                {savingDepartmentPersons ? "저장 중..." : "부서 담당자 저장"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">마이 워크 업무 수정 범위</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              사용자가 마이 워크에서 본인 담당 업무를 수정할 때 편집 가능한 필드를 선택합니다. 체크 해제된 필드는 자물쇠로 잠겨 관리자만 수정할 수 있습니다.
            </p>
            <div className="grid gap-2 md:grid-cols-3">
              {EDITABLE_TASK_FIELD_OPTIONS.map((option) => {
                const checked = draftMyPageEditableFields.includes(option.key)
                return (
                  <label
                    key={option.key}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => handleToggleMyPageEditableField(option.key, value === true)}
                    />
                    <span>{option.label}</span>
                  </label>
                )
              })}
            </div>
            {draftMyPageEditableFields.length === 0 && (
              <p className="text-xs text-amber-600">
                체크된 필드가 없으면 마이 워크의 "수정" 버튼이 표시되지 않습니다.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraftMyPageEditableFields([...DEFAULT_MY_PAGE_EDITABLE_FIELDS])}
              >
                기본값으로 되돌리기
              </Button>
              <Button
                type="button"
                onClick={() => void handleSaveMyPageEditableFields()}
                disabled={savingMyPageEditableFields}
              >
                <Save className="h-4 w-4" />
                {savingMyPageEditableFields ? "저장중..." : "수정 범위 저장"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">공휴일 / 전체 연차 일정</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {draftGlobalSchedules.length === 0 ? (
                <p className="text-sm text-muted-foreground">등록된 일정이 없습니다. 아래 버튼으로 추가해 주세요.</p>
              ) : (
                draftGlobalSchedules.map((item) => (
                  <div key={item.id} className="grid gap-2 rounded-md border border-border p-2 md:grid-cols-[130px_minmax(0,1fr)_140px_140px_72px]">
                    <Select
                      value={item.type}
                      onValueChange={(value) =>
                        updateGlobalScheduleRow(item.id, { type: value as DraftGlobalSchedule["type"] })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="holiday">공휴일</SelectItem>
                        <SelectItem value="annual_leave">전체 연차</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={item.title}
                      onChange={(event) => updateGlobalScheduleRow(item.id, { title: event.target.value })}
                      placeholder="예: 설날 연휴 / 전사 연차"
                    />
                    <Input
                      type="date"
                      value={item.startDate}
                      onChange={(event) => updateGlobalScheduleRow(item.id, { startDate: event.target.value })}
                    />
                    <Input
                      type="date"
                      value={item.endDate}
                      onChange={(event) => updateGlobalScheduleRow(item.id, { endDate: event.target.value })}
                    />
                    <Button type="button" variant="outline" onClick={() => removeGlobalScheduleRow(item.id)}>
                      삭제
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={addGlobalScheduleRow}>
                일정 추가
              </Button>
              <Button type="button" onClick={() => void handleSaveGlobalSchedules()} disabled={savingGlobalSchedules}>
                <Save className="h-4 w-4" />
                {savingGlobalSchedules ? "저장중..." : "일정 저장"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ShieldCheck className="h-5 w-5 text-primary" />
              사용자 추가
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row">
              <Input
                value={draftEmail}
                onChange={(event) => setDraftEmail(event.target.value)}
                placeholder="user@example.com"
              />
              <Button type="button" onClick={() => void handleAddUser()}>
                사용자 추가
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              아직 로그인하지 않은 사용자도 이메일만 알면 권한과 별칭, 소속 부서를 미리 저장할 수 있습니다.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-xl">계정별 설정</CardTitle>
              {rows.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleSaveAllUsers()}
                  disabled={savingAll}
                  className="shrink-0"
                >
                  <Users className="h-4 w-4" />
                  {savingAll ? "저장 중..." : `${filteredRows.length}/${rows.length}명 권한 설정`}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">아직 관리할 사용자가 없습니다.</p>
            ) : (
              <>
                <div className="mb-3 grid gap-2 rounded-lg border bg-muted/30 px-3 py-2 md:grid-cols-[150px_1fr_auto] md:items-center">
                  <Select
                    value={accountDepartmentFilter}
                    onValueChange={(value) => setAccountDepartmentFilter(value as DepartmentPersonGroup | "none" | "all")}
                  >
                    <SelectTrigger className="h-8 bg-white text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체 부서</SelectItem>
                      <SelectItem value="none">미지정</SelectItem>
                      {DEPARTMENT_PERSON_GROUPS.map((group) => (
                        <SelectItem key={group} value={group}>
                          {group}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={accountNameQuery}
                    onChange={(event) => setAccountNameQuery(event.target.value)}
                    className="h-8 bg-white text-xs"
                    placeholder="이름/이메일 검색 (별칭 포함)"
                  />
                  <p className="text-xs text-muted-foreground md:text-right">
                    {filteredRows.length} / {rows.length}명
                  </p>
                </div>

                {/* 일괄 권한 설정 툴바 */}
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <span className="shrink-0 text-xs font-semibold text-muted-foreground">일괄 권한 설정</span>
                  <Select
                    value={bulkTargetKey}
                    onValueChange={(v) => setBulkTargetKey(v)}
                  >
                    <SelectTrigger className="h-7 w-[200px] bg-white text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {permissionColumns.map((column) => (
                        <SelectItem key={column.id} value={column.id} className="text-xs">
                          {column.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => handleBulkTogglePermission(bulkTargetKey, true)}
                    className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    전체 허용
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkTogglePermission(bulkTargetKey, false)}
                    className="rounded border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100"
                  >
                    전체 해제
                  </button>
                </div>

                <Table className="min-w-[1300px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">사용자</TableHead>
                      <TableHead className="w-[120px]">소속 부서</TableHead>
                      {permissionColumns.map((column) => (
                        <TableHead key={column.id} className="w-16 text-center" title={column.label}>
                          <span className="block whitespace-pre-line text-[11px] font-semibold leading-snug text-foreground/80">
                            {column.shortLabel}
                          </span>
                        </TableHead>
                      ))}
                      <TableHead className="w-[110px]">MBTI</TableHead>
                      <TableHead className="w-[90px]">담당자명 별칭</TableHead>
                      <TableHead className="w-[72px] text-right">저장</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((email) => {
                      const permissions = draftPermissions[email] || DEFAULT_PAGE_PERMISSIONS
                      const profile = profiles.find((item) => item.email === email)
                      const department = draftDepartments[email] || "none"

                      return (
                        <TableRow key={email}>
                          <TableCell className="py-2 align-middle">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">{email}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {profile?.lastLoginAt
                                  ? profile.lastLoginAt.toLocaleString("ko-KR")
                                  : "로그인 기록 없음"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 align-middle">
                            <Select
                              value={department}
                              onValueChange={(value) =>
                                setDraftDepartments((prev) => ({
                                  ...prev,
                                  [email]: value as DepartmentPersonGroup | "none",
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 w-[108px] bg-white text-xs">
                                <SelectValue placeholder="부서 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">미지정</SelectItem>
                                {DEPARTMENT_PERSON_GROUPS.map((group) => (
                                  <SelectItem key={group} value={group}>
                                    {group}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {permissionColumns.map((column) => (
                            <TableCell key={column.id} className="py-2 text-center align-middle">
                              <div className="mx-auto flex h-8 w-12 items-center justify-center rounded-md" title={column.label}>
                                <Checkbox
                                  checked={column.getValue(permissions)}
                                  onCheckedChange={(checked) =>
                                    handleTogglePermission(email, column.id, checked === true)
                                  }
                                  title={column.label}
                                />
                              </div>
                            </TableCell>
                          ))}
                          <TableCell className="py-2 align-middle">
                            <Select
                              value={draftMbti[email] || "none"}
                              onValueChange={(value) =>
                                setDraftMbti((prev) => ({
                                  ...prev,
                                  [email]: value as MbtiType | "none",
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 w-[100px] bg-white text-xs">
                                <SelectValue placeholder="유형 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">미지정</SelectItem>
                                {MBTI_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {type}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="py-2 align-middle">
                            <Input
                              value={draftAliases[email] || ""}
                              onChange={(event) =>
                                setDraftAliases((prev) => ({ ...prev, [email]: event.target.value }))
                              }
                              className="h-8 w-[82px] text-xs"
                              placeholder="홍길동, 길동"
                              title={draftAliases[email] || ""}
                            />
                          </TableCell>
                          <TableCell className="py-2 text-right align-middle">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void handleSaveUser(email)}
                              disabled={savingEmail === email}
                              className="h-8 px-2"
                            >
                              <Save className="h-3.5 w-3.5" />
                              {savingEmail === email ? "…" : "저장"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
