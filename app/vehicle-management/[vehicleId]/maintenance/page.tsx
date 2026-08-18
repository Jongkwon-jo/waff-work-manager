"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import type { User } from "firebase/auth"
import { AlertCircle, Loader2, Pencil, Plus, RefreshCw, Save, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { VehicleRecordHeader } from "@/components/vehicle/vehicle-record-header"
import { useAuth } from "@/components/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { vehicleApiFetch } from "@/lib/vehicle-client"
import {
  maintenanceRecordInputSchema,
  type MaintenanceRecord,
  type MaintenanceRecordInput,
  type Vehicle,
} from "@/lib/vehicle-types"

const COLUMN_COUNT = 9

type MaintenanceDraft = {
  maintenanceDate: string
  odometerKm: string
  description: string
  costWon: string
  shopName: string
  maintenanceManager: string
  memo: string
}

function localDateValue() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function emptyMaintenanceDraft(currentOdometerKm: number): MaintenanceDraft {
  return {
    maintenanceDate: localDateValue(),
    odometerKm: String(currentOdometerKm),
    description: "",
    costWon: "",
    shopName: "",
    maintenanceManager: "",
    memo: "",
  }
}

function recordToDraft(record: MaintenanceRecord): MaintenanceDraft {
  return {
    maintenanceDate: record.maintenanceDate,
    odometerKm: String(record.odometerKm),
    description: record.description,
    costWon: String(record.costWon),
    shopName: record.shopName,
    maintenanceManager: record.maintenanceManager,
    memo: record.memo,
  }
}

function MaintenanceEditorRow({
  user,
  vehicle,
  record,
  onSaved,
  onCancel,
}: {
  user: User
  vehicle: Vehicle
  record?: MaintenanceRecord
  onSaved: () => void
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState<MaintenanceDraft>(() => record ? recordToDraft(record) : emptyMaintenanceDraft(vehicle.currentOdometerKm))
  const [saving, setSaving] = useState(false)

  const update = <K extends keyof MaintenanceDraft>(key: K, value: MaintenanceDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
  }

  const save = async () => {
    const input: MaintenanceRecordInput = {
      maintenanceDate: draft.maintenanceDate,
      odometerKm: Number(draft.odometerKm),
      description: draft.description,
      costWon: Number(draft.costWon),
      shopName: draft.shopName,
      maintenanceManager: draft.maintenanceManager,
      memo: draft.memo,
    }
    const parsed = maintenanceRecordInputSchema.safeParse(input)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "정비이력을 확인해 주세요.")
      return
    }
    setSaving(true)
    try {
      await vehicleApiFetch(
        user,
        record ? `/api/vehicles/${vehicle.id}/maintenance/${record.id}` : `/api/vehicles/${vehicle.id}/maintenance`,
        { method: record ? "PATCH" : "POST", body: JSON.stringify(parsed.data) },
      )
      toast.success(record ? "정비이력이 수정되었습니다." : "정비이력이 등록되었습니다.")
      if (!record) setDraft(emptyMaintenanceDraft(Math.max(vehicle.currentOdometerKm, parsed.data.odometerKm)))
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "정비이력을 저장하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <TableRow className="bg-amber-50/60 align-top hover:bg-amber-50/80">
      <TableCell><Input type="date" value={draft.maintenanceDate} onChange={(event) => update("maintenanceDate", event.target.value)} className="h-8 w-36 text-xs" /></TableCell>
      <TableCell><Input type="number" min={0} value={draft.odometerKm} onChange={(event) => update("odometerKm", event.target.value)} className="h-8 w-28 text-xs" placeholder="km" /></TableCell>
      <TableCell><Input value={draft.description} onChange={(event) => update("description", event.target.value)} className="h-8 w-72 text-xs" placeholder="정비내역" /></TableCell>
      <TableCell><Input type="number" min={0} step={1} value={draft.costWon} onChange={(event) => update("costWon", event.target.value)} className="h-8 w-32 text-xs" placeholder="원" /></TableCell>
      <TableCell><Input value={draft.shopName} onChange={(event) => update("shopName", event.target.value)} className="h-8 w-44 text-xs" placeholder="정비소" /></TableCell>
      <TableCell><Input value={draft.maintenanceManager} onChange={(event) => update("maintenanceManager", event.target.value)} className="h-8 w-40 text-xs" placeholder="정비담당자" /></TableCell>
      <TableCell><Input value={draft.memo} onChange={(event) => update("memo", event.target.value)} className="h-8 w-48 text-xs" placeholder="비고" /></TableCell>
      <TableCell className="max-w-48 truncate text-xs text-slate-500">{record?.createdByEmail || user.email}</TableCell>
      <TableCell>
        <div className="flex w-28 gap-1">
          <Button type="button" size="sm" className="h-8 px-2" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 저장
          </Button>
          {onCancel && <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel}><X className="h-4 w-4" /><span className="sr-only">수정 취소</span></Button>}
        </div>
      </TableCell>
    </TableRow>
  )
}

export default function VehicleMaintenancePage() {
  const params = useParams<{ vehicleId: string }>()
  const vehicleId = params.vehicleId
  const { user, isAdmin } = useAuth()
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [records, setRecords] = useState<MaintenanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [editingId, setEditingId] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [query, setQuery] = useState("")

  const loadData = useCallback(async () => {
    if (!user || !vehicleId) return
    setLoading(true)
    setError("")
    try {
      const [vehicleData, recordData] = await Promise.all([
        vehicleApiFetch<{ vehicle: Vehicle }>(user, `/api/vehicles/${vehicleId}`),
        vehicleApiFetch<{ records: MaintenanceRecord[] }>(user, `/api/vehicles/${vehicleId}/maintenance`),
      ])
      setVehicle(vehicleData.vehicle)
      setRecords(recordData.records)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "정비이력을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [user, vehicleId])

  useEffect(() => { void loadData() }, [loadData])

  const filteredRecords = useMemo(() => records.filter((record) => {
    if (dateFrom && record.maintenanceDate < dateFrom) return false
    if (dateTo && record.maintenanceDate > dateTo) return false
    const normalized = query.trim().toLowerCase()
    if (normalized && !`${record.description} ${record.shopName} ${record.maintenanceManager} ${record.memo}`.toLowerCase().includes(normalized)) return false
    return true
  }), [dateFrom, dateTo, query, records])

  const totalCost = useMemo(() => filteredRecords.reduce((sum, record) => sum + record.costWon, 0), [filteredRecords])

  const removeRecord = async (record: MaintenanceRecord) => {
    if (!user || !vehicle) return
    if (!window.confirm(`${record.maintenanceDate} 정비이력을 삭제할까요?`)) return
    try {
      await vehicleApiFetch(user, `/api/vehicles/${vehicle.id}/maintenance/${record.id}`, { method: "DELETE" })
      toast.success("정비이력이 삭제되었습니다.")
      await loadData()
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "정비이력을 삭제하지 못했습니다.")
    }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-amber-600" /></main>
  if (error || !vehicle || !user) return (
    <main className="flex min-h-screen items-center justify-center p-4"><Card className="max-w-lg border-rose-200"><CardContent className="flex flex-col items-center gap-3 p-8 text-center"><AlertCircle className="h-9 w-9 text-rose-500" /><p className="text-sm text-rose-700">{error || "차량 정보를 찾을 수 없습니다."}</p><Button onClick={() => void loadData()}>다시 시도</Button></CardContent></Card></main>
  )

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-6 lg:px-6">
      <div className="mx-auto max-w-[1700px] space-y-5">
        <VehicleRecordHeader vehicle={vehicle} section="maintenance" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">조회 정비 건수</p><p className="mt-1 text-2xl font-bold">{filteredRecords.length.toLocaleString("ko-KR")}건</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">조회 수리비 합계</p><p className="mt-1 text-2xl font-bold text-amber-700">{totalCost.toLocaleString("ko-KR")}원</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">차량 현재 km</p><p className="mt-1 text-2xl font-bold">{vehicle.currentOdometerKm.toLocaleString("ko-KR")} km</p></CardContent></Card>
        </div>
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div><CardTitle className="flex items-center gap-2 text-xl"><Plus className="h-5 w-5 text-amber-600" /> 정비이력 입력</CardTitle><p className="mt-1 text-sm text-muted-foreground">정비 시점의 km와 비용을 기록하면 차량 현재 km에 자동 반영됩니다.</p></div>
              <Button type="button" variant="outline" onClick={() => void loadData()}><RefreshCw className="h-4 w-4" /> 새로고침</Button>
            </div>
            <div className="grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-[150px_150px_minmax(220px,1fr)_auto]">
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-9 bg-white text-xs" aria-label="정비 조회 시작일" />
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-9 bg-white text-xs" aria-label="정비 조회 종료일" />
              <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 bg-white pl-8 text-xs" placeholder="정비내역·정비소·담당자 검색" /></div>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setQuery("") }}>필터 초기화</Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0 pb-4">
            <Table className="min-w-[1450px] border-t">
              <TableHeader><TableRow className="bg-slate-100"><TableHead>정비일</TableHead><TableHead>현재 km</TableHead><TableHead>정비내역</TableHead><TableHead>수리비용</TableHead><TableHead>정비소</TableHead><TableHead>정비담당자</TableHead><TableHead>비고</TableHead><TableHead>작성자</TableHead><TableHead>관리</TableHead></TableRow></TableHeader>
              <TableBody>
                {vehicle.status === "active" && <MaintenanceEditorRow key="new-maintenance-row" user={user} vehicle={vehicle} onSaved={() => void loadData()} />}
                {filteredRecords.map((record) => editingId === record.id ? (
                  <MaintenanceEditorRow key={record.id} user={user} vehicle={vehicle} record={record} onSaved={() => { setEditingId(""); void loadData() }} onCancel={() => setEditingId("")} />
                ) : (
                  <TableRow key={record.id}>
                    <TableCell className="whitespace-nowrap text-xs">{record.maintenanceDate}</TableCell>
                    <TableCell className="font-semibold">{record.odometerKm.toLocaleString("ko-KR")} km</TableCell>
                    <TableCell className="max-w-96 text-sm">{record.description}</TableCell>
                    <TableCell className="whitespace-nowrap font-semibold text-amber-700">{record.costWon.toLocaleString("ko-KR")}원</TableCell>
                    <TableCell>{record.shopName}</TableCell>
                    <TableCell>{record.maintenanceManager}</TableCell>
                    <TableCell className="max-w-64 text-xs">{record.memo || "-"}</TableCell>
                    <TableCell className="max-w-48 truncate text-xs">{record.createdByEmail}</TableCell>
                    <TableCell>{vehicle.status === "active" && (isAdmin || record.createdByEmail === user.email) ? <div className="flex gap-1"><Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={() => setEditingId(record.id)}><Pencil className="h-3.5 w-3.5" /> 수정</Button><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-600" onClick={() => void removeRecord(record)}><Trash2 className="h-3.5 w-3.5" /><span className="sr-only">삭제</span></Button></div> : <span className="text-xs text-slate-400">조회만</span>}</TableCell>
                  </TableRow>
                ))}
                {filteredRecords.length === 0 && <TableRow><TableCell colSpan={COLUMN_COUNT} className="h-28 text-center text-sm text-muted-foreground">조건에 맞는 정비이력이 없습니다.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

