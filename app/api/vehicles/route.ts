import { NextResponse } from "next/server"
import { createVehicle, listVehicles } from "@/lib/vehicle-server"
import {
  requireVehicleAdmin,
  requireVehicleRequestUser,
  vehicleApiErrorResponse,
  VehicleApiException,
} from "@/lib/vehicle-api-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    await requireVehicleRequestUser(request)
    return NextResponse.json({ vehicles: await listVehicles() }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireVehicleRequestUser(request)
    requireVehicleAdmin(user)
    const body = await request.json().catch(() => {
      throw new VehicleApiException(400, "차량 입력값이 올바르지 않습니다.")
    })
    return NextResponse.json({ vehicle: await createVehicle(body, user) }, { status: 201 })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

