import { NextResponse } from "next/server"
import { z } from "zod"
import { requireVehicleRequestUser, vehicleApiErrorResponse, VehicleApiException } from "@/lib/vehicle-api-auth"
import type { DirectionsResult } from "@/lib/vehicle-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const requestSchema = z.object({
  start: z.object({ latitude: z.number().finite(), longitude: z.number().finite() }),
  goal: z.object({ latitude: z.number().finite(), longitude: z.number().finite() }),
})

type NaverRoute = {
  summary?: { distance?: unknown; duration?: unknown }
  path?: unknown
}

type NaverDirectionsResponse = {
  code?: unknown
  message?: unknown
  currentDateTime?: unknown
  route?: { traoptimal?: unknown }
}

export async function POST(request: Request) {
  try {
    await requireVehicleRequestUser(request)
    const parsed = requestSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new VehicleApiException(400, "출발지와 도착지 좌표가 올바르지 않습니다.")
    const keyId = process.env.NEXT_PUBLIC_NAVER_MAPS_NCP_KEY_ID?.trim()
    const secret = process.env.NAVER_MAPS_API_KEY_SECRET?.trim()
    if (!keyId || !secret) throw new VehicleApiException(503, "네이버 지도 API 키가 아직 설정되지 않았습니다.")
    const start = `${parsed.data.start.longitude},${parsed.data.start.latitude}`
    const goal = `${parsed.data.goal.longitude},${parsed.data.goal.latitude}`
    const response = await fetch(
      `https://maps.apigw.ntruss.com/map-direction/v1/driving?start=${encodeURIComponent(start)}&goal=${encodeURIComponent(goal)}&option=traoptimal`,
      {
        headers: {
          "x-ncp-apigw-api-key-id": keyId,
          "x-ncp-apigw-api-key": secret,
        },
        cache: "no-store",
      },
    )
    const body = (await response.json().catch(() => ({}))) as NaverDirectionsResponse
    const routes = Array.isArray(body.route?.traoptimal) ? (body.route.traoptimal as NaverRoute[]) : []
    const route = routes[0]
    const distance = Number(route?.summary?.distance)
    const duration = Number(route?.summary?.duration)
    if (!response.ok || body.code !== 0 || !route || !Number.isFinite(distance) || !Number.isFinite(duration)) {
      throw new VehicleApiException(502, "자동 운행거리 계산에 실패했습니다. 기록거리와 사유를 직접 입력해 주세요.")
    }
    const path: Array<[number, number]> = Array.isArray(route.path)
      ? route.path
          .filter(
            (point): point is [number, number] =>
              Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])),
          )
          .map((point) => [Number(point[0]), Number(point[1])])
      : []
    const result: DirectionsResult = {
      distanceKm: Math.round((distance / 1000) * 100) / 100,
      durationMinutes: Math.round((duration / 60000) * 10) / 10,
      calculatedAt: typeof body.currentDateTime === "string" ? body.currentDateTime : new Date().toISOString(),
      path,
    }
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}
