"use client"

import Image from "next/image"
import { useCallback, useEffect, useMemo, useState } from "react"
import { CarFront, ImagePlus, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/components/auth/auth-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useUserAccountDirectory } from "@/hooks/use-user-account-directory"
import { vehicleApiFetch } from "@/lib/vehicle-client"
import { vehicleInputSchema, type Vehicle, type VehicleInput } from "@/lib/vehicle-types"

const emptyDraft: VehicleInput = {
  plateNumber: "",
  manufacturer: "",
  model: "",
  year: "",
  fuelType: "",
  status: "active",
  baselineOdometerKm: 0,
  primaryManagerEmail: "",
  secondaryManagerEmail: "",
  memo: "",
}

function vehicleToDraft(vehicle: Vehicle): VehicleInput {
  return {
    plateNumber: vehicle.plateNumber,
    manufacturer: vehicle.manufacturer,
    model: vehicle.model,
    year: vehicle.year,
    fuelType: vehicle.fuelType,
    status: vehicle.status,
    baselineOdometerKm: vehicle.baselineOdometerKm,
    primaryManagerEmail: vehicle.primaryManagerEmail,
    secondaryManagerEmail: vehicle.secondaryManagerEmail,
    memo: vehicle.memo,
  }
}

export function AdminVehicleManagement() {
  const { user } = useAuth()
  const { activeAccountEmails, loading: accountsLoading } = useUserAccountDirectory(user)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null)
  const [draft, setDraft] = useState<VehicleInput>({ ...emptyDraft })
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState("")

  const accountOptions = useMemo(
    () => Array.from(activeAccountEmails || []).sort((a, b) => a.localeCompare(b)),
    [activeAccountEmails],
  )

  const loadVehicles = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const data = await vehicleApiFetch<{ vehicles: Vehicle[] }>(user, "/api/vehicles")
      setVehicles(data.vehicles)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "차량 목록을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadVehicles()
  }, [loadVehicles])

  useEffect(() => {
    if (!imageFile) {
      setImagePreview("")
      return
    }
    const url = URL.createObjectURL(imageFile)
    setImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  const openCreate = () => {
    setEditingVehicle(null)
    setDraft({ ...emptyDraft })
    setImageFile(null)
    setDialogOpen(true)
  }

  const openEdit = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle)
    setDraft(vehicleToDraft(vehicle))
    setImageFile(null)
    setDialogOpen(true)
  }

  const updateDraft = <K extends keyof VehicleInput>(key: K, value: VehicleInput[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
  }

  const saveVehicle = async () => {
    if (!user) return
    const parsed = vehicleInputSchema.safeParse(draft)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "차량 정보를 확인해 주세요.")
      return
    }
    if (imageFile && imageFile.size > 5 * 1024 * 1024) {
      toast.error("차량 이미지는 5MB 이하로 등록해 주세요.")
      return
    }

    setSaving(true)
    try {
      const path = editingVehicle ? `/api/vehicles/${editingVehicle.id}` : "/api/vehicles"
      const data = await vehicleApiFetch<{ vehicle: Vehicle }>(user, path, {
        method: editingVehicle ? "PATCH" : "POST",
        body: JSON.stringify(parsed.data),
      })
      let savedVehicle = data.vehicle
      if (imageFile) {
        const formData = new FormData()
        formData.set("image", imageFile)
        try {
          const imageData = await vehicleApiFetch<{ vehicle: Vehicle }>(user, `/api/vehicles/${savedVehicle.id}/image`, {
            method: "PUT",
            body: formData,
          })
          savedVehicle = imageData.vehicle
        } catch (imageError) {
          setVehicles((previous) => {
            const next = previous.filter((vehicle) => vehicle.id !== savedVehicle.id)
            return [...next, savedVehicle].sort((a, b) => a.plateNumber.localeCompare(b.plateNumber))
          })
          setDialogOpen(false)
          toast.error(
            `차량 기본정보는 저장됐지만 이미지는 업로드되지 않았습니다. ${
              imageError instanceof Error ? imageError.message : "이미지 저장소 설정을 확인해 주세요."
            }`,
          )
          return
        }
      }
      setVehicles((previous) => {
        const next = previous.filter((vehicle) => vehicle.id !== savedVehicle.id)
        return [...next, savedVehicle].sort((a, b) => a.plateNumber.localeCompare(b.plateNumber))
      })
      setDialogOpen(false)
      toast.success(editingVehicle ? "차량 정보가 수정되었습니다." : "차량이 등록되었습니다.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "차량 정보를 저장하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  const removeImage = async () => {
    if (!user || !editingVehicle?.imagePath) return
    if (!window.confirm("등록된 차량 이미지를 삭제할까요?")) return
    setSaving(true)
    try {
      const data = await vehicleApiFetch<{ vehicle: Vehicle }>(user, `/api/vehicles/${editingVehicle.id}/image`, {
        method: "DELETE",
      })
      setEditingVehicle(data.vehicle)
      setVehicles((previous) => previous.map((vehicle) => (vehicle.id === data.vehicle.id ? data.vehicle : vehicle)))
      toast.success("차량 이미지가 삭제되었습니다.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "차량 이미지를 삭제하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <CarFront className="h-5 w-5 text-cyan-600" /> 차량 등록 관리
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                법인차량 기본정보, 정/부 담당자, 차량 이미지와 운행 상태를 관리합니다.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => void loadVehicles()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 새로고침
              </Button>
              <Button type="button" onClick={openCreate}>
                <Plus className="h-4 w-4" /> 차량 등록
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 차량 목록을 불러오는 중입니다.
            </div>
          ) : vehicles.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              등록된 차량이 없습니다. 차량 등록 버튼으로 첫 차량을 추가해 주세요.
            </p>
          ) : (
            <Table className="min-w-[1050px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[84px]">사진</TableHead>
                  <TableHead>차량번호</TableHead>
                  <TableHead>제조사 / 모델</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">현재 km</TableHead>
                  <TableHead>정 담당자</TableHead>
                  <TableHead>부 담당자</TableHead>
                  <TableHead className="w-[80px] text-right">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((vehicle) => (
                  <TableRow key={vehicle.id}>
                    <TableCell>
                      <div className="relative h-12 w-16 overflow-hidden rounded-md bg-slate-100">
                        {vehicle.imageUrl ? (
                          <Image src={vehicle.imageUrl} alt="" fill unoptimized className="object-cover" />
                        ) : (
                          <CarFront className="absolute inset-0 m-auto h-6 w-6 text-slate-300" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-semibold">{vehicle.plateNumber}</TableCell>
                    <TableCell>{[vehicle.manufacturer, vehicle.model].filter(Boolean).join(" ")}</TableCell>
                    <TableCell>
                      <Badge variant={vehicle.status === "active" ? "default" : "secondary"}>
                        {vehicle.status === "active" ? "운행중" : "운행종료"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{vehicle.currentOdometerKm.toLocaleString("ko-KR")}</TableCell>
                    <TableCell className="max-w-48 truncate text-xs">{vehicle.primaryManagerEmail}</TableCell>
                    <TableCell className="max-w-48 truncate text-xs">{vehicle.secondaryManagerEmail || "-"}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" size="sm" variant="outline" onClick={() => openEdit(vehicle)}>
                        <Pencil className="h-3.5 w-3.5" /> 수정
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => !saving && setDialogOpen(open)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingVehicle ? "차량 정보 수정" : "새 차량 등록"}</DialogTitle>
            <DialogDescription>차량 기본정보와 담당자를 입력하고 필요하면 대표 사진을 첨부합니다.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-2 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl border bg-slate-50">
                {imagePreview || editingVehicle?.imageUrl ? (
                  <Image
                    src={imagePreview || editingVehicle?.imageUrl || ""}
                    alt="차량 이미지 미리보기"
                    fill
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <CarFront className="absolute inset-0 m-auto h-16 w-16 text-slate-300" />
                )}
              </div>
              <Label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                <ImagePlus className="h-4 w-4" /> 이미지 선택
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => setImageFile(event.target.files?.[0] || null)}
                />
              </Label>
              <p className="text-center text-xs text-muted-foreground">JPEG · PNG · WebP / 최대 5MB</p>
              {editingVehicle?.imagePath && !imageFile && (
                <Button type="button" variant="ghost" size="sm" className="w-full text-destructive" onClick={() => void removeImage()}>
                  <Trash2 className="h-4 w-4" /> 등록 이미지 삭제
                </Button>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-plate">차량번호 *</Label>
                <Input id="vehicle-plate" value={draft.plateNumber} onChange={(event) => updateDraft("plateNumber", event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-model">모델 *</Label>
                <Input id="vehicle-model" value={draft.model} onChange={(event) => updateDraft("model", event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-manufacturer">제조사</Label>
                <Input id="vehicle-manufacturer" value={draft.manufacturer} onChange={(event) => updateDraft("manufacturer", event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-year">연식</Label>
                <Input id="vehicle-year" value={draft.year} onChange={(event) => updateDraft("year", event.target.value)} placeholder="2026" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-fuel">연료</Label>
                <Input id="vehicle-fuel" value={draft.fuelType} onChange={(event) => updateDraft("fuelType", event.target.value)} placeholder="휘발유 / 경유 / 전기" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-odometer">관리 기준 km *</Label>
                <Input
                  id="vehicle-odometer"
                  type="number"
                  min={0}
                  value={draft.baselineOdometerKm}
                  onChange={(event) => updateDraft("baselineOdometerKm", Math.max(0, Number(event.target.value)))}
                />
                {editingVehicle && (
                  <p className="text-[11px] text-muted-foreground">
                    기록 반영 현재 km: {editingVehicle.currentOdometerKm.toLocaleString("ko-KR")} km
                  </p>
                )}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>정 담당자 *</Label>
                <Select value={draft.primaryManagerEmail || undefined} onValueChange={(value) => updateDraft("primaryManagerEmail", value)}>
                  <SelectTrigger><SelectValue placeholder={accountsLoading ? "계정 불러오는 중" : "정 담당자 선택"} /></SelectTrigger>
                  <SelectContent>
                    {accountOptions.map((email) => <SelectItem key={email} value={email}>{email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>부 담당자</Label>
                <Select value={draft.secondaryManagerEmail || "none"} onValueChange={(value) => updateDraft("secondaryManagerEmail", value === "none" ? "" : value)}>
                  <SelectTrigger><SelectValue placeholder="부 담당자 선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">미지정</SelectItem>
                    {accountOptions.filter((email) => email !== draft.primaryManagerEmail).map((email) => <SelectItem key={email} value={email}>{email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>운행 상태</Label>
                <Select value={draft.status} onValueChange={(value) => updateDraft("status", value as VehicleInput["status"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">운행중</SelectItem>
                    <SelectItem value="retired">운행종료</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="vehicle-memo">메모</Label>
                <Textarea id="vehicle-memo" value={draft.memo} onChange={(event) => updateDraft("memo", event.target.value)} rows={3} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>취소</Button>
            <Button type="button" onClick={() => void saveVehicle()} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "저장 중..." : editingVehicle ? "수정 저장" : "차량 등록"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
