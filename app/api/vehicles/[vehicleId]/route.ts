import { NextResponse } from "next/server"
import { getVehicle, updateVehicle } from "@/lib/vehicle-server"
import {
  requireVehicleAdmin,
  requireVehicleRequestUser,
  vehicleApiErrorResponse,
  VehicleApiException,
} from "@/lib/vehicle-api-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ vehicleId: string }> }

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireVehicleRequestUser(request)
    const { vehicleId } = await context.params
    return NextResponse.json({ vehicle: await getVehicle(vehicleId) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireVehicleRequestUser(request)
    requireVehicleAdmin(user)
    const { vehicleId } = await context.params
    const body = await request.json().catch(() => {
      throw new VehicleApiException(400, "차량 입력값이 올바르지 않습니다.")
    })
    return NextResponse.json({ vehicle: await updateVehicle(vehicleId, body, user) })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

