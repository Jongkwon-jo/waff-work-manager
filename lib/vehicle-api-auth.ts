import "server-only"

import { NextResponse } from "next/server"
import { getFirebaseAdminAuth } from "@/lib/firebase-admin"
import { isAdminEmail, normalizeEmail } from "@/lib/page-access"

export type VehicleRequestUser = {
  uid: string
  email: string
  isAdmin: boolean
}

export class VehicleApiException extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "VehicleApiException"
  }
}

export async function requireVehicleRequestUser(request: Request): Promise<VehicleRequestUser> {
  const authorization = request.headers.get("authorization") || ""
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : ""
  if (!token) throw new VehicleApiException(401, "로그인 정보가 없습니다.")

  try {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(token)
    const email = normalizeEmail(decoded.email || "")
    if (!email) throw new VehicleApiException(403, "이메일 계정만 이용할 수 있습니다.")
    return { uid: decoded.uid, email, isAdmin: isAdminEmail(email) }
  } catch (error) {
    if (error instanceof VehicleApiException) throw error
    throw new VehicleApiException(401, "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.")
  }
}

export function requireVehicleAdmin(user: VehicleRequestUser) {
  if (!user.isAdmin) throw new VehicleApiException(403, "관리자 계정만 차량 정보를 변경할 수 있습니다.")
}

export function vehicleApiErrorResponse(error: unknown) {
  if (error instanceof VehicleApiException) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error("Vehicle API error:", error)
  return NextResponse.json({ error: "차량 관리 요청을 처리하지 못했습니다." }, { status: 500 })
}

