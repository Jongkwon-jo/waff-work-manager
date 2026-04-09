"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Save, ShieldCheck } from "lucide-react"
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
  saveDepartmentPagePermissions,
  saveDepartmentPersonSettings,
  saveUserDepartment,
  saveUserPagePermissions,
  saveUserTaskAliases,
  subscribeAllUserPagePermissions,
  subscribeDepartmentPagePermissions,
  subscribeDepartmentPersonSettings,
  subscribeUserProfiles,
  type DepartmentPagePermissions,
  type DepartmentPersonGroup,
  type DepartmentPersonSettings,
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
type DraftDepartmentPersonMap = Record<DepartmentPersonGroup, string>

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
  const [draftDepartmentPersons, setDraftDepartmentPersons] = useState<DraftDepartmentPersonMap>({
    ICT: "",
    FA: "",
    전략기획: "",
    기타: "",
  })
  const [draftDepartmentPermissions, setDraftDepartmentPermissions] = useState<DepartmentPagePermissions>(
    DEFAULT_DEPARTMENT_PAGE_PERMISSIONS,
  )
  const [savingEmail, setSavingEmail] = useState<string | null>(null)
  const [savingDepartmentPersons, setSavingDepartmentPersons] = useState(false)
  const [savingDepartmentPermissions, setSavingDepartmentPermissions] = useState(false)

  useEffect(() => {
    if (!isAdmin) return

    const unsubscribeProfiles = subscribeUserProfiles(setProfiles)
    const unsubscribePermissions = subscribeAllUserPagePermissions(setPermissionEntries)
    const unsubscribeDepartmentPersons = subscribeDepartmentPersonSettings(setDepartmentPersonSettings)
    const unsubscribeDepartmentPagePermissions = subscribeDepartmentPagePermissions(setDepartmentPagePermissions)

    return () => {
      unsubscribeProfiles()
      unsubscribePermissions()
      unsubscribeDepartmentPersons()
      unsubscribeDepartmentPagePermissions()
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

    rows.forEach((email) => {
      const savedPermission = permissionEntries.find((entry) => entry.email === email)
      const profile = profiles.find((entry) => entry.email === email)

      nextDraftPermissions[email] = savedPermission?.permissions || DEFAULT_PAGE_PERMISSIONS
      nextDraftAliases[email] = (profile?.taskAliases || []).join(", ")
      nextDraftDepartments[email] = profile?.department || "none"
    })

    setDraftPermissions(nextDraftPermissions)
    setDraftAliases(nextDraftAliases)
    setDraftDepartments(nextDraftDepartments)
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
      ])
      toast.success("사용자 권한, 별칭, 소속 부서가 저장되었습니다.")
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
            <CardTitle className="text-xl">계정별 설정</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">아직 관리할 사용자가 없습니다.</p>
            ) : (
              <Table className="min-w-[1700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[240px]">사용자</TableHead>
                    <TableHead className="w-[180px]">소속 부서</TableHead>
                    {PAGE_PERMISSIONS.map((page) => (
                      <TableHead key={page.key}>{page.label}</TableHead>
                    ))}
                    <TableHead className="min-w-[260px]">담당자명 별칭</TableHead>
                    <TableHead className="w-[140px] text-right">저장</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((email) => {
                    const permissions = draftPermissions[email] || DEFAULT_PAGE_PERMISSIONS
                    const profile = profiles.find((item) => item.email === email)

                    return (
                      <TableRow key={email}>
                        <TableCell className="align-top">
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">{email}</p>
                            <p className="text-xs text-muted-foreground">
                              {profile?.lastLoginAt
                                ? `최근 로그인 ${profile.lastLoginAt.toLocaleString("ko-KR")}`
                                : "아직 로그인 기록 없음"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <Select
                            value={draftDepartments[email] || "none"}
                            onValueChange={(value) =>
                              setDraftDepartments((prev) => ({
                                ...prev,
                                [email]: value as DepartmentPersonGroup | "none",
                              }))
                            }
                          >
                            <SelectTrigger className="w-[160px] bg-white">
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
                          <TableCell key={page.key} className="align-top">
                            <label className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={permissions[page.key]}
                                onCheckedChange={(checked) =>
                                  handleTogglePermission(email, page.key, checked === true)
                                }
                              />
                              허용
                            </label>
                          </TableCell>
                        ))}
                        <TableCell className="align-top">
                          <Textarea
                            value={draftAliases[email] || ""}
                            onChange={(event) =>
                              setDraftAliases((prev) => ({ ...prev, [email]: event.target.value }))
                            }
                            className="min-h-24"
                            placeholder="예) admin@waff.co.kr, admin, 관리자"
                          />
                          <p className="mt-2 text-xs text-muted-foreground">
                            쉼표로 구분해서 여러 담당자명 별칭을 입력해 주세요.
                          </p>
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleSaveUser(email)}
                            disabled={savingEmail === email}
                          >
                            <Save className="h-4 w-4" />
                            {savingEmail === email ? "저장 중..." : "저장"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
