"use client"

import type { User } from "firebase/auth"

type ApiErrorBody = { error?: unknown; details?: unknown }

export class VehicleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "VehicleApiError"
  }
}

export async function vehicleApiFetch<T>(user: User, input: string, init?: RequestInit): Promise<T> {
  const token = await user.getIdToken()
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${token}`)
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(input, {
    ...init,
    headers,
    cache: "no-store",
  })

  const text = await response.text()
  let body: ApiErrorBody & T
  try {
    body = text ? (JSON.parse(text) as ApiErrorBody & T) : ({} as ApiErrorBody & T)
  } catch {
    throw new VehicleApiError(`서버가 올바르지 않은 응답을 반환했습니다. (HTTP ${response.status})`, response.status)
  }

  if (!response.ok) {
    throw new VehicleApiError(typeof body.error === "string" ? body.error : "요청을 처리하지 못했습니다.", response.status)
  }

  return body
}

