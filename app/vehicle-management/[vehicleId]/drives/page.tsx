"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import type { User } from "firebase/auth"
import { AlertCircle, Loader2, Pencil, Plus, RefreshCw, Save, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { AddressSearchInput } from "@/components/vehicle/address-search-input"
import {
  AccountAliasMultiSelect,
  AccountAliasSelect,
  type AccountAliasOption,
} from "@/components/vehicle/account-alias-select"
import { NaverRouteMap } from "@/components/vehicle/naver-route-map"
import { VehicleRecordHeader } from "@/components/vehicle/vehicle-record-header"
import { useAuth } from "@/components/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useUserAccountDirectory } from "@/hooks/use-user-account-directory"
import { vehicleApiFetch } from "@/lib/vehicle-client"
import {
  driveRecordInputSchema,
  type AddressPoint,
  type DirectionsResult,
  type DriveRecord,
  type DriveRecordInput,
  type Vehicle,
} from "@/lib/vehicle-types"

const COLUMN_COUNT = 11

const COMPANY_ADDRESS: AddressPoint = {
  address: "경상남도 창원시 성산구 완암로 147",
  roadAddress: "경상남도 창원시 성산구 완암로 147",
  jibunAddress: "경상남도 창원시 성산구 내동 456-29",
  placeName: "회사",
  category: "",
  source: "place",
  latitude: 35.214476,
  longitude: 128.6684653,
}

type DriveDraft = {
  drivenAt: string
  driverEmail: string
  passengerEmails: string[]
  guestPassengersText: string
  purpose: string
  origin: AddressPoint | null
  destination: AddressPoint | null
  roundTrip: boolean
  naverDistanceKm: string
  naverDurationMinutes: string
  routeCalculatedAt: string
  recordedDistanceKm: string
  distanceOverrideReason: string
  startOdometerKm: string
  endOdometerKm: string
  memo: string
}

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function emptyDriveDraft(email: string): DriveDraft {
  return {
    drivenAt: localDateTimeValue(),
    driverEmail: email,
    passengerEmails: [],
    guestPassengersText: "",
    purpose: "",
    origin: null,
    destination: null,
    roundTrip: false,
    naverDistanceKm: "",
    naverDurationMinutes: "",
    routeCalculatedAt: "",
    recordedDistanceKm: "",
    distanceOverrideReason: "",
    startOdometerKm: "",
    endOdometerKm: "",
    memo: "",
  }
}

function recordToDraft(record: DriveRecord): DriveDraft {
  return {
    drivenAt: record.drivenAt,
    driverEmail: record.driverEmail,
    passengerEmails: record.passengerEmails,
    guestPassengersText: record.guestPassengers.join(", "),
    purpose: record.purpose,
    origin: record.origin,
    destination: record.destination,
    roundTrip: record.roundTrip,
    naverDistanceKm: record.naverDistanceKm === null ? "" : String(record.naverDistanceKm),
    naverDurationMinutes: record.naverDurationMinutes === null ? "" : String(record.naverDurationMinutes),
    routeCalculatedAt: record.routeCalculatedAt,
    recordedDistanceKm: String(record.recordedDistanceKm),
    distanceOverrideReason: record.distanceOverrideReason,
    startOdometerKm: record.startOdometerKm === null ? "" : String(record.startOdometerKm),
    endOdometerKm: record.endOdometerKm === null ? "" : String(record.endOdometerKm),
    memo: record.memo,
  }
}

function nullableNumber(value: string) {
  return value.trim() === "" ? null : Number(value)
}

function buildDriveInput(draft: DriveDraft): DriveRecordInput | null {
  if (!draft.origin || !draft.destination) return null
  return {
    drivenAt: draft.drivenAt,
    driverEmail: draft.driverEmail,
    passengerEmails: draft.passengerEmails,
    guestPassengers: draft.guestPassengersText.split(",").map((item) => item.trim()).filter(Boolean),
    purpose: draft.purpose,
    origin: draft.origin,
    destination: draft.destination,
    roundTrip: draft.roundTrip,
    naverDistanceKm: nullableNumber(draft.naverDistanceKm),
    naverDurationMinutes: nullableNumber(draft.naverDurationMinutes),
    routeCalculatedAt: draft.routeCalculatedAt,
    recordedDistanceKm: Number(draft.recordedDistanceKm),
    distanceOverrideReason: draft.distanceOverrideReason,
    startOdometerKm: nullableNumber(draft.startOdometerKm),
    endOdometerKm: nullableNumber(draft.endOdometerKm),
    memo: draft.memo,
  }
}

function DriveEditorRows({
  user,
  vehicle,
  record,
  accountOptions,
  onSaved,
  onCancel,
}: {
  user: User
  vehicle: Vehicle
  record?: DriveRecord
  accountOptions: AccountAliasOption[]
  onSaved: () => void
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState<DriveDraft>(() => record ? recordToDraft(record) : emptyDriveDraft(user.email || ""))
  const [saving, setSaving] = useState(false)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routePath, setRoutePath] = useState<Array<[number, number]>>([])
  const [routeRevision, setRouteRevision] = useState(0)

  const update = <K extends keyof DriveDraft>(key: K, value: DriveDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
  }

  const updateAddress = (key: "origin" | "destination", value: AddressPoint) => {
    setDraft((previous) => ({
      ...previous,
      [key]: value,
      naverDistanceKm: "",
      naverDurationMinutes: "",
      routeCalculatedAt: "",
      recordedDistanceKm: "",
    }))
    setRoutePath([])
    setRouteRevision((previous) => previous + 1)
  }

  const updateDriver = (email: string) => {
    setDraft((previous) => ({
      ...previous,
      driverEmail: email,
      passengerEmails: previous.passengerEmails.filter((passengerEmail) => passengerEmail !== email),
    }))
  }

  const updateRoundTrip = (checked: boolean) => {
    setDraft((previous) => {
      const previousMultiplier = previous.roundTrip ? 2 : 1
      const nextMultiplier = checked ? 2 : 1
      const distance = nullableNumber(previous.naverDistanceKm)
      const duration = nullableNumber(previous.naverDurationMinutes)
      const nextDistance = distance === null ? null : Math.round((distance / previousMultiplier) * nextMultiplier * 100) / 100
      const nextDuration = duration === null ? null : Math.round((duration / previousMultiplier) * nextMultiplier * 10) / 10
      return {
        ...previous,
        roundTrip: checked,
        naverDistanceKm: nextDistance === null ? "" : String(nextDistance),
        naverDurationMinutes: nextDuration === null ? "" : String(nextDuration),
        recordedDistanceKm: nextDistance === null ? previous.recordedDistanceKm : String(nextDistance),
        distanceOverrideReason: nextDistance === null ? previous.distanceOverrideReason : "",
      }
    })
  }

  useEffect(() => {
    if (routeRevision === 0 || !draft.origin || !draft.destination) return
    const controller = new AbortController()
    setRouteLoading(true)
    void vehicleApiFetch<{ result: DirectionsResult }>(user, "/api/naver-maps/directions", {
      method: "POST",
      body: JSON.stringify({ start: draft.origin, goal: draft.destination }),
      signal: controller.signal,
    })
      .then(({ result }) => {
        setDraft((previous) => {
          const multiplier = previous.roundTrip ? 2 : 1
          const effectiveDistance = Math.round(result.distanceKm * multiplier * 100) / 100
          const effectiveDuration = Math.round(result.durationMinutes * multiplier * 10) / 10
          return {
            ...previous,
            naverDistanceKm: String(effectiveDistance),
            naverDurationMinutes: String(effectiveDuration),
            routeCalculatedAt: result.calculatedAt,
            recordedDistanceKm: String(effectiveDistance),
            distanceOverrideReason: "",
          }
        })
        setRoutePath(result.path)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setDraft((previous) => ({ ...previous, naverDistanceKm: "", naverDurationMinutes: "", routeCalculatedAt: "" }))
        setRoutePath([])
        toast.error(error instanceof Error ? error.message : "자동 운행거리 계산에 실패했습니다.")
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouteLoading(false)
      })
    return () => controller.abort()
  }, [draft.destination, draft.origin, routeRevision, user])

  const save = async () => {
    const input = buildDriveInput(draft)
    if (!input) {
      toast.error("출발지와 도착지를 검색해 선택해 주세요.")
      return
    }
    if (!draft.naverDistanceKm || !draft.naverDurationMinutes) {
      toast.error("출발지와 도착지를 선택하고 네이버 거리 계산이 완료된 후 저장해 주세요.")
      return
    }
    const parsed = driveRecordInputSchema.safeParse(input)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "운행기록을 확인해 주세요.")
      return
    }
    setSaving(true)
    try {
      await vehicleApiFetch(user, record ? `/api/vehicles/${vehicle.id}/drives/${record.id}` : `/api/vehicles/${vehicle.id}/drives`, {
        method: record ? "PATCH" : "POST",
        body: JSON.stringify(parsed.data),
      })
      toast.success(record ? "운행기록이 수정되었습니다." : "운행기록이 등록되었습니다.")
      if (!record) setDraft(emptyDriveDraft(user.email || ""))
      setRoutePath([])
      setRouteRevision(0)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "운행기록을 저장하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  const authorEmail = record?.createdByEmail || user.email || ""
  const authorAlias = accountOptions.find((option) => option.email === authorEmail)?.alias || authorEmail

  return (
    <>
      <TableRow className="bg-cyan-50/50 align-top hover:bg-cyan-50/70">
        <TableCell>
          <Input type="datetime-local" value={draft.drivenAt} onChange={(event) => update("drivenAt", event.target.value)} className="h-8 w-44 text-xs" />
        </TableCell>
        <TableCell>
          <AccountAliasSelect value={draft.driverEmail} options={accountOptions} onChange={updateDriver} className="w-32" />
        </TableCell>
        <TableCell>
          <div className="w-40">
            <AccountAliasMultiSelect
              value={draft.passengerEmails}
              options={accountOptions.filter((option) => option.email !== draft.driverEmail)}
              onChange={(emails) => update("passengerEmails", emails)}
              className="w-full"
            />
          </div>
        </TableCell>
        <TableCell><Input value={draft.purpose} onChange={(event) => update("purpose", event.target.value)} className="h-8 w-44 text-xs" placeholder="운행 목적" /></TableCell>
        <TableCell>
          <div className="flex items-start gap-1">
            <AddressSearchInput user={user} value={draft.origin} onChange={(point) => updateAddress("origin", point)} placeholder="출발지 주소·장소명" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 border-cyan-200 bg-cyan-50 px-2 text-[11px] text-cyan-800 hover:bg-cyan-100"
              title={COMPANY_ADDRESS.address}
              onClick={() => updateAddress("origin", COMPANY_ADDRESS)}
            >
              [회사]
            </Button>
          </div>
        </TableCell>
        <TableCell><AddressSearchInput user={user} value={draft.destination} onChange={(point) => updateAddress("destination", point)} placeholder="도착지 주소·장소명" /></TableCell>
        <TableCell>
          <label className="flex h-8 w-20 cursor-pointer items-center gap-1.5 rounded-md border bg-white px-2 text-xs">
            <input type="checkbox" checked={draft.roundTrip} onChange={(event) => updateRoundTrip(event.target.checked)} className="h-4 w-4 accent-cyan-600" />
            왕복
          </label>
        </TableCell>
        <TableCell>
          <div className="w-28 text-xs">
            {routeLoading ? <span className="inline-flex items-center gap-1 text-cyan-700"><Loader2 className="h-3 w-3 animate-spin" /> 계산중</span> : draft.naverDistanceKm ? <><p className="font-semibold">{draft.naverDistanceKm} km</p><p className="text-slate-500">약 {draft.naverDurationMinutes}분</p>{draft.roundTrip && <p className="mt-0.5 text-[10px] text-cyan-700">편도 × 2</p>}</> : <span className="text-slate-400">경로 계산 대기</span>}
          </div>
        </TableCell>
        <TableCell><Input value={draft.memo} onChange={(event) => update("memo", event.target.value)} className="h-8 w-40 text-xs" placeholder="비고" /></TableCell>
        <TableCell className="max-w-32 truncate text-xs text-slate-600">{authorAlias}</TableCell>
        <TableCell>
          <div className="flex w-28 gap-1">
            <Button type="button" size="sm" className="h-8 px-2" onClick={() => void save()} disabled={saving || routeLoading}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 저장
            </Button>
            {onCancel && <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={onCancel}><X className="h-4 w-4" /><span className="sr-only">수정 취소</span></Button>}
          </div>
        </TableCell>
      </TableRow>
      <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
        <TableCell colSpan={COLUMN_COUNT} className="p-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.7fr)]">
            <NaverRouteMap origin={draft.origin} destination={draft.destination} path={routePath} />
            <div className="grid grid-cols-2 gap-2 rounded-xl border bg-white p-4 text-xs">
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-500">운행 구분</p><p className="mt-1 font-semibold">{draft.roundTrip ? "왕복 (편도 × 2)" : "편도"}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-500">네이버 산출거리</p><p className="mt-1 font-semibold">{draft.naverDistanceKm ? `${draft.naverDistanceKm} km` : "계산 대기"}</p></div>
              <div className="col-span-2 rounded-lg bg-cyan-50 p-3"><p className="text-cyan-700">예상 운행시간</p><p className="mt-1 font-semibold text-cyan-950">{draft.naverDurationMinutes ? `약 ${draft.naverDurationMinutes}분` : "계산 대기"}</p></div>
            </div>
          </div>
        </TableCell>
      </TableRow>
    </>
  )
}

export default function VehicleDrivesPage() {
  const params = useParams<{ vehicleId: string }>()
  const vehicleId = params.vehicleId
  const { user, isAdmin } = useAuth()
  const { activeAccountEmails, accountProfiles } = useUserAccountDirectory(user)
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [records, setRecords] = useState<DriveRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [editingId, setEditingId] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [driverFilter, setDriverFilter] = useState("all")
  const [routeQuery, setRouteQuery] = useState("")
  const [purposeQuery, setPurposeQuery] = useState("")

  const accountOptions = useMemo<AccountAliasOption[]>(() => {
    const values = new Set(activeAccountEmails || [])
    if (user?.email) values.add(user.email)
    records.forEach((record) => {
      values.add(record.driverEmail)
      values.add(record.createdByEmail)
      record.passengerEmails.forEach((email) => values.add(email))
    })
    const aliasByEmail = new Map(
      (accountProfiles || []).map((profile) => [profile.email, profile.taskAliases[0]?.trim() || profile.email]),
    )
    return Array.from(values)
      .map((email) => ({ email, alias: aliasByEmail.get(email) || email }))
      .filter((option) => Boolean(option.email))
      .sort((a, b) => a.alias.localeCompare(b.alias, "ko") || a.email.localeCompare(b.email))
  }, [accountProfiles, activeAccountEmails, records, user?.email])

  const accountAliasByEmail = useMemo(
    () => new Map(accountOptions.map((option) => [option.email, option.alias])),
    [accountOptions],
  )

  const loadData = useCallback(async () => {
    if (!user || !vehicleId) return
    setLoading(true)
    setError("")
    try {
      const [vehicleData, recordData] = await Promise.all([
        vehicleApiFetch<{ vehicle: Vehicle }>(user, `/api/vehicles/${vehicleId}`),
        vehicleApiFetch<{ records: DriveRecord[] }>(user, `/api/vehicles/${vehicleId}/drives`),
      ])
      setVehicle(vehicleData.vehicle)
      setRecords(recordData.records)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "운행기록을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [user, vehicleId])

  useEffect(() => { void loadData() }, [loadData])

  const filteredRecords = useMemo(() => records.filter((record) => {
    const day = record.drivenAt.slice(0, 10)
    if (dateFrom && day < dateFrom) return false
    if (dateTo && day > dateTo) return false
    if (driverFilter !== "all" && record.driverEmail !== driverFilter) return false
    const normalizedRouteQuery = routeQuery.trim().toLowerCase()
    if (normalizedRouteQuery && !`${record.origin.placeName || ""} ${record.origin.address} ${record.destination.placeName || ""} ${record.destination.address}`.toLowerCase().includes(normalizedRouteQuery)) return false
    if (purposeQuery.trim() && !record.purpose.toLowerCase().includes(purposeQuery.trim().toLowerCase())) return false
    return true
  }), [dateFrom, dateTo, driverFilter, purposeQuery, records, routeQuery])

  const removeRecord = async (record: DriveRecord) => {
    if (!user || !vehicle) return
    if (!window.confirm(`${record.drivenAt.replace("T", " ")} 운행기록을 삭제할까요?`)) return
    try {
      await vehicleApiFetch(user, `/api/vehicles/${vehicle.id}/drives/${record.id}`, { method: "DELETE" })
      toast.success("운행기록이 삭제되었습니다.")
      await loadData()
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "운행기록을 삭제하지 못했습니다.")
    }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-600" /></main>
  if (error || !vehicle || !user) return (
    <main className="flex min-h-screen items-center justify-center p-4"><Card className="max-w-lg border-rose-200"><CardContent className="flex flex-col items-center gap-3 p-8 text-center"><AlertCircle className="h-9 w-9 text-rose-500" /><p className="text-sm text-rose-700">{error || "차량 정보를 찾을 수 없습니다."}</p><Button onClick={() => void loadData()}>다시 시도</Button></CardContent></Card></main>
  )

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-6 lg:px-6">
      <div className="mx-auto max-w-[1900px] space-y-5">
        <VehicleRecordHeader vehicle={vehicle} section="drives" />
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div><CardTitle className="flex items-center gap-2 text-xl"><Plus className="h-5 w-5 text-cyan-600" /> 운행기록 엑셀형 입력</CardTitle><p className="mt-1 text-sm text-muted-foreground">주소 또는 장소명을 선택하면 거리와 예상시간을 계산하며, 왕복 선택 시 산출값을 2배로 저장합니다.</p></div>
              <Button type="button" variant="outline" onClick={() => void loadData()}><RefreshCw className="h-4 w-4" /> 새로고침</Button>
            </div>
            <div className="grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-[145px_145px_220px_minmax(180px,1fr)_minmax(180px,1fr)_auto]">
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-9 bg-white text-xs" aria-label="조회 시작일" />
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-9 bg-white text-xs" aria-label="조회 종료일" />
              <select value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)} className="h-9 rounded-md border bg-white px-2 text-xs" aria-label="운전자 필터"><option value="all">전체 운전자</option>{accountOptions.map((option) => <option key={option.email} value={option.email}>{option.alias}</option>)}</select>
              <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input value={routeQuery} onChange={(event) => setRouteQuery(event.target.value)} className="h-9 bg-white pl-8 text-xs" placeholder="출발지·도착지 검색" /></div>
              <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input value={purposeQuery} onChange={(event) => setPurposeQuery(event.target.value)} className="h-9 bg-white pl-8 text-xs" placeholder="운행목적 검색" /></div>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setDriverFilter("all"); setRouteQuery(""); setPurposeQuery("") }}>필터 초기화</Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0 pb-4">
            <Table className="min-w-[1900px] border-t">
              <TableHeader><TableRow className="bg-slate-100"><TableHead>운행일시</TableHead><TableHead>운전자</TableHead><TableHead>탑승자</TableHead><TableHead>운행목적</TableHead><TableHead>출발지</TableHead><TableHead>도착지</TableHead><TableHead>왕복</TableHead><TableHead>네이버 거리/시간</TableHead><TableHead>비고</TableHead><TableHead>작성자</TableHead><TableHead>관리</TableHead></TableRow></TableHeader>
              <TableBody>
                {vehicle.status === "active" && <DriveEditorRows key="new-drive-row" user={user} vehicle={vehicle} accountOptions={accountOptions} onSaved={() => void loadData()} />}
                {filteredRecords.map((record) => editingId === record.id ? (
                  <DriveEditorRows key={record.id} user={user} vehicle={vehicle} record={record} accountOptions={accountOptions} onSaved={() => { setEditingId(""); void loadData() }} onCancel={() => setEditingId("")} />
                ) : (
                  <TableRow key={record.id}>
                    <TableCell className="whitespace-nowrap text-xs">{record.drivenAt.replace("T", " ")}</TableCell>
                    <TableCell className="max-w-48 truncate text-xs">{accountAliasByEmail.get(record.driverEmail) || record.driverEmail}</TableCell>
                    <TableCell className="max-w-64 text-xs"><p className="truncate">{[...record.passengerEmails.map((email) => accountAliasByEmail.get(email) || email), ...record.guestPassengers].join(", ") || "-"}</p></TableCell>
                    <TableCell className="max-w-48 text-xs">{record.purpose}</TableCell>
                    <TableCell className="max-w-64 text-xs"><p className="font-medium">{record.origin.placeName || record.origin.address}</p>{record.origin.placeName && <p className="mt-0.5 text-[11px] text-slate-500">{record.origin.address}</p>}</TableCell>
                    <TableCell className="max-w-64 text-xs"><p className="font-medium">{record.destination.placeName || record.destination.address}</p>{record.destination.placeName && <p className="mt-0.5 text-[11px] text-slate-500">{record.destination.address}</p>}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{record.roundTrip ? <span className="rounded-full bg-cyan-100 px-2 py-1 font-medium text-cyan-800">왕복</span> : <span className="text-slate-500">편도</span>}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{record.naverDistanceKm === null ? "-" : `${record.naverDistanceKm.toLocaleString("ko-KR")} km / ${record.naverDurationMinutes || 0}분`}</TableCell>
                    <TableCell className="max-w-48 text-xs">{record.memo || record.distanceOverrideReason || "-"}</TableCell>
                    <TableCell className="max-w-32 truncate text-xs">{accountAliasByEmail.get(record.createdByEmail) || record.createdByEmail}</TableCell>
                    <TableCell>{vehicle.status === "active" && (isAdmin || record.createdByEmail === user.email) ? <div className="flex gap-1"><Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={() => setEditingId(record.id)}><Pencil className="h-3.5 w-3.5" /> 수정</Button><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-600" onClick={() => void removeRecord(record)}><Trash2 className="h-3.5 w-3.5" /><span className="sr-only">삭제</span></Button></div> : <span className="text-xs text-slate-400">조회만</span>}</TableCell>
                  </TableRow>
                ))}
                {filteredRecords.length === 0 && <TableRow><TableCell colSpan={COLUMN_COUNT} className="h-28 text-center text-sm text-muted-foreground">조건에 맞는 운행기록이 없습니다.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
