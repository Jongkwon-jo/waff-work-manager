import { NextResponse } from "next/server"
import { deleteMaintenanceRecord, updateMaintenanceRecord } from "@/lib/vehicle-server"
import { requireVehicleRequestUser, vehicleApiErrorResponse, VehicleApiException } from "@/lib/vehicle-api-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ vehicleId: string; recordId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireVehicleRequestUser(request)
    const { vehicleId, recordId } = await context.params
    const body = await request.json().catch(() => {
      throw new VehicleApiException(400, "정비이력 입력값이 올바르지 않습니다.")
    })
    return NextResponse.json({ record: await updateMaintenanceRecord(vehicleId, recordId, body, user) })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireVehicleRequestUser(request)
    const { vehicleId, recordId } = await context.params
    await deleteMaintenanceRecord(vehicleId, recordId, user)
    return NextResponse.json({ success: true })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

