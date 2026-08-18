import { NextResponse } from "next/server"
import { deleteVehicleImage, saveVehicleImage } from "@/lib/vehicle-server"
import {
  requireVehicleAdmin,
  requireVehicleRequestUser,
  vehicleApiErrorResponse,
  VehicleApiException,
} from "@/lib/vehicle-api-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ vehicleId: string }> }

export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireVehicleRequestUser(request)
    requireVehicleAdmin(user)
    const { vehicleId } = await context.params
    const formData = await request.formData()
    const file = formData.get("image")
    if (!(file instanceof File)) throw new VehicleApiException(400, "등록할 차량 이미지를 선택해 주세요.")
    return NextResponse.json({ vehicle: await saveVehicleImage(vehicleId, file, user) })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireVehicleRequestUser(request)
    requireVehicleAdmin(user)
    const { vehicleId } = await context.params
    return NextResponse.json({ vehicle: await deleteVehicleImage(vehicleId, user) })
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}

