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
  DEFAULT_DEPARTMENT_PAGE_PERMISSIONS,
  DEFAULT_DEPARTMENT_PERSON_SETTINGS,
  MBTI_TYPES,
  saveDepartmentPagePermissions,
  saveDepartmentPersonSettings,
  saveGlobalSchedules,
  saveUserDepartment,
  saveUserMbti,
  saveUserPagePermissions,
  saveUserTaskAliases,
  subscribeAllUserPagePermissions,
  subscribeDepartmentPagePermissions,
  subscribeDepartmentPersonSettings,
  subscribeGlobalSchedules,
  subscribeUserProfiles,
  type GlobalSchedule,
  type DepartmentPagePermissions,
  type DepartmentPersonGroup,
  type DepartmentPersonSettings,
  type MbtiType,
  type UserPagePermissionEntry,
  type UserProfile,
} from "@/lib/firestore-service"
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

const PAGE_PERMISSION_SHORT_LABELS: Record<string, string> = {
  myPage: "마이\n페이지",
  strategyWorkManagement: "전략\n업무관리",
  strategyWorkManagementEdit: "전략\n업무수정",
  strategyWeeklyWork: "전략\n주간업무",
  faWorkManagement: "FA\n업무관리",
  faWorkManagementEdit: "FA\n업무수정",
  faWeeklyWork: "FA\n주간업무",
  ictWeeklyWork: "ICT\n주간업무",
  gptTest: "GPT\n테스트",
  mbtiPage: "MBTI",
}

export default function AdminPage() {
  const { isAdmin } = useAuth()
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [permissionEntries, setPermissionEntries] = useState<UserPagePermissionEntry[]>([])
  const [departmentPersonSettings, setDepartmentPersonSettings] = useState<DepartmentPersonSettings>(
    DEFAULT_DEPARTMENT_PERSON_SETTINGS,
  )
  const [departmentPagePermissions, setDepartmentPagePermissions] = useState<DepartmentPagePermissions>(
    DEFAULT_DEPARTMENT_PAGE_PERMISSIONS,
  )
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
  const [draftDepartmentPermissions, setDraftDepartmentPermissions] = useState<DepartmentPagePermissions>(
    DEFAULT_DEPARTMENT_PAGE_PERMISSIONS,
  )
  const [bulkTargetKey, setBulkTargetKey] = useState<keyof UserPagePermissions>(PAGE_PERMISSIONS[0].key)
  const [savingEmail, setSavingEmail] = useState<string | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [savingDepartmentPersons, setSavingDepartmentPersons] = useState(false)
  const [savingDepartmentPermissions, setSavingDepartmentPermissions] = useState(false)
  const [draftGlobalSchedules, setDraftGlobalSchedules] = useState<DraftGlobalSchedule[]>([])
  const [savingGlobalSchedules, setSavingGlobalSchedules] = useState(false)

  useEffect(() => {
    if (!isAdmin) return

    const unsubscribeProfiles = subscribeUserProfiles(setProfiles)
    const unsubscribePermissions = subscribeAllUserPagePermissions(setPermissionEntries)
    const unsubscribeDepartmentPersons = subscribeDepartmentPersonSettings(setDepartmentPersonSettings)
    const unsubscribeDepartmentPagePermissions = subscribeDepartmentPagePermissions(setDepartmentPagePermissions)
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

    return () => {
      unsubscribeProfiles()
      unsubscribePermissions()
      unsubscribeDepartmentPersons()
      unsubscribeDepartmentPagePermissions()
      unsubscribeGlobalSchedules()
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
    setDraftDepartmentPermissions(departmentPagePermissions)
  }, [departmentPagePermissions])

  const handleTogglePermission = (email: string, key: keyof UserPagePermissions, checked: boolean) => {
    setDraftPermissions((prev) => ({
      ...prev,
      [email]: {
        ...(prev[email] || DEFAULT_PAGE_PERMISSIONS),
        [key]: checked,
      },
    }))
  }

  const handleBulkTogglePermission = (key: keyof UserPagePermissions, checked: boolean) => {
    setDraftPermissions((prev) => {
      const next = { ...prev }
      rows.forEach((email) => {
        next[email] = {
          ...(prev[email] || DEFAULT_PAGE_PERMISSIONS),
          [key]: checked,
        }
      })
      return next
    })
  }

  const handleSaveAllUsers = async () => {
    if (rows.length === 0) return
    setSavingAll(true)
    try {
      await Promise.all(
        rows.map((email) =>
          saveUserPagePermissions(email, draftPermissions[email] || DEFAULT_PAGE_PERMISSIONS),
        ),
      )
      toast.success(`${rows.length}명의 페이지 권한이 일괄 저장되었습니다.`)
    } catch {
      toast.error("일괄 저장에 실패했습니다.")
    } finally {
      setSavingAll(false)
    }
  }

  const handleToggleDepartmentPermission = (
    group: DepartmentPersonGroup,
    key: keyof UserPagePermissions,
    checked: boolean,
  ) => {
    setDraftDepartmentPermissions((prev) => ({
      ...prev,
      [group]: {
        ...prev[group],
        [key]: checked,
      },
    }))
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
      await saveDepartmentPersonSettings({
        ICT: draftDepartmentPersons.ICT.split(",").map((value) => value.trim()).filter(Boolean),
        FA: draftDepartmentPersons.FA.split(",").map((value) => value.trim()).filter(Boolean),
        전략기획: draftDepartmentPersons.전략기획.split(",").map((value) => value.trim()).filter(Boolean),
        기타: draftDepartmentPersons.기타.split(",").map((value) => value.trim()).filter(Boolean),
      })
      toast.success("부서별 담당자 설정이 저장되었습니다.")
    } catch {
      toast.error("부서별 담당자 설정 저장에 실패했습니다.")
    } finally {
      setSavingDepartmentPersons(false)
    }
  }

  const handleSaveDepartmentPermissions = async () => {
    setSavingDepartmentPermissions(true)

    try {
      await saveDepartmentPagePermissions(draftDepartmentPermissions)
      toast.success("부서별 페이지 권한이 저장되었습니다.")
    } catch {
      toast.error("부서별 페이지 권한 저장에 실패했습니다.")
    } finally {
      setSavingDepartmentPermissions(false)
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
                  <Textarea
                    value={draftDepartmentPersons[group] || ""}
                    onChange={(event) =>
                      setDraftDepartmentPersons((prev) => ({ ...prev, [group]: event.target.value }))
                    }
                    className="min-h-24"
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
            <CardTitle className="text-xl">부서별 페이지 권한</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="min-w-[1300px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">부서</TableHead>
                  {PAGE_PERMISSIONS.map((page) => (
                    <TableHead key={page.key}>{page.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {DEPARTMENT_PERSON_GROUPS.map((group) => (
                  <TableRow key={group}>
                    <TableCell className="font-medium">{group}</TableCell>
                    {PAGE_PERMISSIONS.map((page) => (
                      <TableCell key={page.key}>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={draftDepartmentPermissions[group]?.[page.key]}
                            onCheckedChange={(checked) =>
                              handleToggleDepartmentPermission(group, page.key, checked === true)
                            }
                          />
                          허용
                        </label>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                onClick={() => void handleSaveDepartmentPermissions()}
                disabled={savingDepartmentPermissions}
              >
                <Save className="h-4 w-4" />
                {savingDepartmentPermissions ? "저장 중..." : "부서 권한 저장"}
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
                  {savingAll ? "저장 중..." : `전체 ${rows.length}명 권한 저장`}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">아직 관리할 사용자가 없습니다.</p>
            ) : (
              <>
                {/* 일괄 권한 설정 툴바 */}
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <span className="shrink-0 text-xs font-semibold text-muted-foreground">일괄 권한 설정</span>
                  <Select
                    value={bulkTargetKey}
                    onValueChange={(v) => setBulkTargetKey(v as keyof UserPagePermissions)}
                  >
                    <SelectTrigger className="h-7 w-[200px] bg-white text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_PERMISSIONS.map((page) => (
                        <SelectItem key={page.key} value={page.key} className="text-xs">
                          {page.label}
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
                      {PAGE_PERMISSIONS.map((page) => (
                        <TableHead key={page.key} className="w-16 text-center" title={page.label}>
                          <span className="block whitespace-pre-line text-[11px] font-semibold leading-snug text-foreground/80">
                            {PAGE_PERMISSION_SHORT_LABELS[page.key]}
                          </span>
                        </TableHead>
                      ))}
                      <TableHead className="w-[110px]">MBTI</TableHead>
                      <TableHead className="w-[90px]">담당자명 별칭</TableHead>
                      <TableHead className="w-[72px] text-right">저장</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((email) => {
                      const permissions = draftPermissions[email] || DEFAULT_PAGE_PERMISSIONS
                      const profile = profiles.find((item) => item.email === email)

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
                              value={draftDepartments[email] || "none"}
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
                          {PAGE_PERMISSIONS.map((page) => (
                            <TableCell key={page.key} className="py-2 text-center align-middle">
                              <Checkbox
                                checked={permissions[page.key]}
                                onCheckedChange={(checked) =>
                                  handleTogglePermission(email, page.key, checked === true)
                                }
                                title={page.label}
                              />
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
