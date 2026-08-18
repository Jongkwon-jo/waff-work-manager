import { NextResponse } from "next/server"
import { requireVehicleRequestUser, vehicleApiErrorResponse, VehicleApiException } from "@/lib/vehicle-api-auth"
import type { AddressCandidate } from "@/lib/vehicle-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type NaverGeocodeAddress = {
  roadAddress?: unknown
  jibunAddress?: unknown
  englishAddress?: unknown
  x?: unknown
  y?: unknown
}

type NaverGeocodeResponse = {
  status?: unknown
  errorMessage?: unknown
  addresses?: unknown
}

type NaverLocalItem = {
  title?: unknown
  category?: unknown
  address?: unknown
  roadAddress?: unknown
  mapx?: unknown
  mapy?: unknown
}

type NaverLocalResponse = {
  items?: unknown
}

function mapsCredentials() {
  const keyId = process.env.NEXT_PUBLIC_NAVER_MAPS_NCP_KEY_ID?.trim()
  const secret = process.env.NAVER_MAPS_API_KEY_SECRET?.trim()
  if (!keyId || !secret) {
    throw new VehicleApiException(503, "네이버 지도 API 키가 아직 설정되지 않았습니다.")
  }
  return { keyId, secret }
}

function apiHubCredentials() {
  const keyId = process.env.NAVER_API_HUB_CLIENT_ID?.trim()
  const secret = process.env.NAVER_API_HUB_CLIENT_SECRET?.trim()
  return keyId && secret ? { keyId, secret } : null
}

function plainText(value: unknown) {
  if (typeof value !== "string") return ""
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function localCoordinate(value: unknown, limit: number) {
  const coordinate = Number(value)
  if (!Number.isFinite(coordinate)) return Number.NaN
  return Math.abs(coordinate) > limit ? coordinate / 10_000_000 : coordinate
}

async function searchAddresses(query: string, credentials: ReturnType<typeof mapsCredentials>) {
  const response = await fetch(
    `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`,
    {
      headers: {
        "x-ncp-apigw-api-key-id": credentials.keyId,
        "x-ncp-apigw-api-key": credentials.secret,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  )
  const body = (await response.json().catch(() => ({}))) as NaverGeocodeResponse
  if (!response.ok || body.status !== "OK") {
    throw new Error("Naver Maps geocoding request failed")
  }
  const addresses = Array.isArray(body.addresses) ? (body.addresses as NaverGeocodeAddress[]) : []
  return addresses
    .map((item) => {
      const roadAddress = typeof item.roadAddress === "string" ? item.roadAddress : ""
      const jibunAddress = typeof item.jibunAddress === "string" ? item.jibunAddress : ""
      const longitude = Number(item.x)
      const latitude = Number(item.y)
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || (!roadAddress && !jibunAddress)) return null
      return {
        label: roadAddress || jibunAddress,
        address: roadAddress || jibunAddress,
        roadAddress,
        jibunAddress,
        placeName: "",
        category: "",
        latitude,
        longitude,
        source: "address",
      } satisfies AddressCandidate
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

async function searchPlaces(query: string, credentials: NonNullable<ReturnType<typeof apiHubCredentials>>) {
  const response = await fetch(
    `https://naverapihub.apigw.ntruss.com/search/v1/local?query=${encodeURIComponent(query)}&display=5&start=1&sort=random&format=json`,
    {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": credentials.keyId,
        "X-NCP-APIGW-API-KEY": credentials.secret,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  )
  const body = (await response.json().catch(() => ({}))) as NaverLocalResponse
  if (!response.ok) throw new Error("NAVER API HUB local search request failed")
  const items = Array.isArray(body.items) ? (body.items as NaverLocalItem[]) : []
  return items
    .map((item) => {
      const placeName = plainText(item.title)
      const category = plainText(item.category)
      const roadAddress = plainText(item.roadAddress)
      const jibunAddress = plainText(item.address)
      const longitude = localCoordinate(item.mapx, 180)
      const latitude = localCoordinate(item.mapy, 90)
      if (!placeName || !Number.isFinite(longitude) || !Number.isFinite(latitude) || (!roadAddress && !jibunAddress)) return null
      return {
        label: placeName,
        placeName,
        category,
        address: roadAddress || jibunAddress,
        roadAddress,
        jibunAddress,
        latitude,
        longitude,
        source: "place",
      } satisfies AddressCandidate
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

function mergeCandidates(addresses: AddressCandidate[], places: AddressCandidate[]) {
  const seen = new Set<string>()
  return [...places, ...addresses].filter((candidate) => {
    const key = `${candidate.latitude.toFixed(6)}:${candidate.longitude.toFixed(6)}:${candidate.address}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function GET(request: Request) {
  try {
    await requireVehicleRequestUser(request)
    const query = new URL(request.url).searchParams.get("query")?.trim() || ""
    if (query.length < 2 || query.length > 150) {
      throw new VehicleApiException(400, "검색할 주소를 2자 이상 입력해 주세요.")
    }
    const hubCredentials = apiHubCredentials()
    const [addressResult, placeResult] = await Promise.allSettled([
      searchAddresses(query, mapsCredentials()),
      hubCredentials ? searchPlaces(query, hubCredentials) : Promise.resolve([]),
    ])
    const addresses = addressResult.status === "fulfilled" ? addressResult.value : []
    const places = placeResult.status === "fulfilled" ? placeResult.value : []
    if (addressResult.status === "rejected" && (!hubCredentials || placeResult.status === "rejected")) {
      throw new VehicleApiException(502, "네이버 주소·장소 검색에 실패했습니다. API 설정을 확인해 주세요.")
    }
    return NextResponse.json(
      { candidates: mergeCandidates(addresses, places), placeSearchConfigured: Boolean(hubCredentials) },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return vehicleApiErrorResponse(error)
  }
}
