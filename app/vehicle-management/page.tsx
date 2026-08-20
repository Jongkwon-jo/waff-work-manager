"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  ArrowLeft,
  CarFront,
  Fuel,
  Gauge,
  History,
  RefreshCw,
  Settings,
  UserRound,
  Wrench,
} from "lucide-react"
import { useAuth } from "@/components/auth/auth-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useUserAccountDirectory } from "@/hooks/use-user-account-directory"
import { vehicleApiFetch } from "@/lib/vehicle-client"
import type { Vehicle } from "@/lib/vehicle-types"
import { VehicleStaticImage } from "@/components/vehicle/vehicle-static-image"

function VehicleCard({ vehicle, managerAliasByEmail }: { vehicle: Vehicle; managerAliasByEmail: ReadonlyMap<string, string> }) {
  const driving = vehicle.activityStatus === "driving"
  const primaryManagerAlias = managerAliasByEmail.get(vehicle.primaryManagerEmail.toLowerCase()) || vehicle.primaryManagerEmail
  const secondaryManagerAlias = vehicle.secondaryManagerEmail
    ? managerAliasByEmail.get(vehicle.secondaryManagerEmail.toLowerCase()) || vehicle.secondaryManagerEmail
    : "미지정"

  return (
    <Card className="group overflow-hidden border-slate-200/80 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <div className="relative">
        <VehicleStaticImage
          plateNumber={vehicle.plateNumber}
          className="aspect-[16/9] w-full"
          imageClassName="transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <Badge variant="outline" className="absolute right-3 top-3 border-cyan-200 bg-white/95 text-cyan-800 shadow-sm">
          관리부서 · {vehicle.managementDepartment || "미지정"}
        </Badge>
      </div>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold tracking-tight text-slate-950">{vehicle.plateNumber}</h2>
            <p className="mt-1 truncate text-sm text-slate-500">
              {[vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(" · ") || "차량 상세정보 미지정"}
            </p>
          </div>
          <Badge variant={driving ? "default" : "secondary"} className={driving ? "shrink-0 bg-emerald-600" : "shrink-0"}>
            {driving ? "운행중" : "운행대기"}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Gauge className="h-3.5 w-3.5" /> 현재 주행거리
            </p>
            <p className="mt-1 font-semibold text-slate-900">{vehicle.currentOdometerKm.toLocaleString("ko-KR")} km</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Fuel className="h-3.5 w-3.5" /> 연료
            </p>
            <p className="mt-1 font-semibold text-slate-900">{vehicle.fuelType || "미지정"}</p>
          </div>
        </div>
        <div className="space-y-1.5 rounded-xl border border-slate-100 px-3 py-2.5 text-xs text-slate-600">
          <p className="flex items-center gap-2">
            <UserRound className="h-3.5 w-3.5 text-cyan-600" />
            <span className="w-6 font-semibold">정</span>
            <span className="truncate" title={vehicle.primaryManagerEmail}>{primaryManagerAlias}</span>
          </p>
          <p className="flex items-center gap-2">
            <UserRound className="h-3.5 w-3.5 text-slate-400" />
            <span className="w-6 font-semibold">부</span>
            <span className="truncate" title={vehicle.secondaryManagerEmail || undefined}>{secondaryManagerAlias}</span>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button asChild className="gap-1.5">
            <Link href={`/vehicle-management/${vehicle.id}/drives`}>
              <History className="h-4 w-4" /> 운행기록 입력
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-1.5">
            <Link href={`/vehicle-management/${vehicle.id}/maintenance`}>
              <Wrench className="h-4 w-4" /> 정비이력 입력
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function VehicleManagementPage() {
  const { user, isAdmin } = useAuth()
  const { accountProfiles } = useUserAccountDirectory(user)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const loadVehicles = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!user) return
    if (!silent) {
      setLoading(true)
      setError("")
    }
    try {
      const data = await vehicleApiFetch<{ vehicles: Vehicle[] }>(user, "/api/vehicles")
      setVehicles(data.vehicles)
    } catch (loadError) {
      if (!silent) setError(loadError instanceof Error ? loadError.message : "차량 목록을 불러오지 못했습니다.")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadVehicles()
    const intervalId = window.setInterval(() => void loadVehicles({ silent: true }), 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [loadVehicles])

  const visibleVehicles = useMemo(() => vehicles.filter((vehicle) => vehicle.status === "active"), [vehicles])
  const managerAliasByEmail = useMemo(
    () => new Map((accountProfiles || []).map((profile) => [profile.email, profile.taskAliases[0]?.trim() || profile.email])),
    [accountProfiles],
  )

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(6,182,212,0.13),transparent),linear-gradient(180deg,#f0f9ff_0%,#f8fafc_42%,#ffffff_100%)] px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
              <CarFront className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">WorkHub Fleet</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">법인차량 운행·정비이력</h1>
              <p className="mt-1 text-sm text-slate-500">차량을 선택해 운행기록 또는 정비이력을 입력하세요.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void loadVehicles()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 새로고침
            </Button>
            {isAdmin && (
              <Button asChild variant="outline">
                <Link href="/admin">
                  <Settings className="h-4 w-4" /> 차량 등록 관리
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" /> 메인으로
              </Link>
            </Button>
          </div>
        </header>

        {loading ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="차량 목록 불러오는 중">
            {[0, 1, 2].map((item) => (
              <Card key={item}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex justify-between gap-3">
                    <Skeleton className="h-7 w-32" />
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ))}
          </section>
        ) : error ? (
          <Card className="border-rose-200 bg-rose-50/80">
            <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
              <AlertCircle className="h-10 w-10 text-rose-500" />
              <div>
                <h2 className="font-semibold text-rose-900">차량 목록을 불러오지 못했습니다</h2>
                <p className="mt-1 text-sm text-rose-700">{error}</p>
              </div>
              <Button type="button" variant="outline" onClick={() => void loadVehicles()}>
                다시 시도
              </Button>
            </CardContent>
          </Card>
        ) : vehicles.length === 0 ? (
          <Card className="border-dashed border-slate-300 bg-white/80">
            <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                <CarFront className="h-8 w-8" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">등록된 차량이 없습니다</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {isAdmin ? "관리자 페이지에서 첫 차량을 등록해 주세요." : "관리자에게 차량 등록을 요청해 주세요."}
                </p>
              </div>
              {isAdmin && (
                <Button asChild>
                  <Link href="/admin">차량 등록 관리로 이동</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">차량 목록</h2>
                  <p className="text-sm text-slate-500">현재 표시 중인 차량 {visibleVehicles.length}대</p>
                </div>
              </div>
              {visibleVehicles.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleVehicles.map((vehicle) => (
                    <VehicleCard key={vehicle.id} vehicle={vehicle} managerAliasByEmail={managerAliasByEmail} />
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed bg-white/70 p-8 text-center text-sm text-slate-500">
                  현재 표시 중인 차량이 없습니다.{isAdmin ? " 차량 등록 관리에서 차량 보이기로 변경해 주세요." : ""}
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
