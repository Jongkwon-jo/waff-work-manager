import { NextResponse } from "next/server"
import { deleteDriveRecord, updateDriveRecord } from "@/lib/vehicle-server"
import { requireVehicleRequestUser, vehicleApiErrorResponse, VehicleApiException } from "@/lib/vehicle-api-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ vehicleId: string; recordId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireVehicleRequestUser(request)
    const { vehicleId, recordId } = await context.params
    const body = await request.json().catch(() => {
      throw new VehicleApiException(400, "운행기록 입력값이 올바르지 않습니다.")
    })
    return NextResponse.json({ record: await updateDriveRecord(vehicleId, recordId, body, user) })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireVehicleRequestUser(request)
    const { vehicleId, recordId } = await context.params
    await deleteDriveRecord(vehicleId, recordId, user)
    return NextResponse.json({ success: true })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

