"use client"

import Link from "next/link"
import { ArrowLeft, CarFront, Gauge, History, Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Vehicle } from "@/lib/vehicle-types"

export function VehicleRecordHeader({ vehicle, section }: { vehicle: Vehicle; section: "drives" | "maintenance" }) {
  return (
    <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
            {section === "drives" ? <History className="h-6 w-6" /> : <Wrench className="h-6 w-6" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight text-slate-950">
                {vehicle.plateNumber} · {section === "drives" ? "차량운행 기록" : "정비이력"}
              </h1>
              <Badge variant={vehicle.status === "active" ? "default" : "secondary"}>
                {vehicle.status === "active" ? "운행중" : "운행종료"}
              </Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span>{[vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(" · ")}</span>
              <span className="inline-flex items-center gap-1">
                <Gauge className="h-3.5 w-3.5" /> {vehicle.currentOdometerKm.toLocaleString("ko-KR")} km
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant={section === "drives" ? "default" : "outline"}>
            <Link href={`/vehicle-management/${vehicle.id}/drives`}>
              <History className="h-4 w-4" /> 운행기록
            </Link>
          </Button>
          <Button asChild variant={section === "maintenance" ? "default" : "outline"}>
            <Link href={`/vehicle-management/${vehicle.id}/maintenance`}>
              <Wrench className="h-4 w-4" /> 정비이력
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/vehicle-management">
              <ArrowLeft className="h-4 w-4" /> 차량 선택
            </Link>
          </Button>
        </div>
      </div>
      {vehicle.status === "retired" && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <CarFront className="h-4 w-4" /> 운행종료 차량은 과거 이력만 조회할 수 있습니다.
        </div>
      )}
    </header>
  )
}

