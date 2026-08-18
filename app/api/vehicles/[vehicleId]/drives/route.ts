import { NextResponse } from "next/server"
import { createDriveRecord, listDriveRecords } from "@/lib/vehicle-server"
import { requireVehicleRequestUser, vehicleApiErrorResponse, VehicleApiException } from "@/lib/vehicle-api-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ vehicleId: string }> }

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireVehicleRequestUser(request)
    const { vehicleId } = await context.params
    return NextResponse.json(
      { records: await listDriveRecords(vehicleId) },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireVehicleRequestUser(request)
    const { vehicleId } = await context.params
    const body = await request.json().catch(() => {
      throw new VehicleApiException(400, "운행기록 입력값이 올바르지 않습니다.")
    })
    return NextResponse.json({ record: await createDriveRecord(vehicleId, body, user) }, { status: 201 })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

