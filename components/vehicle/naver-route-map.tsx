"use client"

import { useEffect, useRef, useState } from "react"
import { AlertCircle, Map } from "lucide-react"
import type { AddressPoint } from "@/lib/vehicle-types"

type NaverMapInstance = {
  fitBounds: (bounds: unknown, margin?: unknown) => void
  setCenter: (position: unknown) => void
}

type NaverMapApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => NaverMapInstance
  LatLng: new (latitude: number, longitude: number) => unknown
  LatLngBounds: new () => { extend: (position: unknown) => void }
  Marker: new (options: Record<string, unknown>) => { setMap: (map: NaverMapInstance | null) => void }
  Polyline: new (options: Record<string, unknown>) => { setMap: (map: NaverMapInstance | null) => void }
}

declare global {
  interface Window {
    naver?: { maps: NaverMapApi }
    __workhubNaverMapsPromise?: Promise<NaverMapApi>
  }
}

function loadNaverMaps() {
  if (window.naver?.maps) return Promise.resolve(window.naver.maps)
  if (window.__workhubNaverMapsPromise) return window.__workhubNaverMapsPromise
  const keyId = process.env.NEXT_PUBLIC_NAVER_MAPS_NCP_KEY_ID
  if (!keyId) return Promise.reject(new Error("네이버 지도 키가 설정되지 않았습니다."))

  window.__workhubNaverMapsPromise = new Promise<NaverMapApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-workhub-naver-maps]")
    if (existing) {
      existing.addEventListener("load", () => window.naver?.maps ? resolve(window.naver.maps) : reject(new Error("지도 로드 실패")), { once: true })
      existing.addEventListener("error", () => reject(new Error("지도 로드 실패")), { once: true })
      return
    }
    const script = document.createElement("script")
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(keyId)}`
    script.async = true
    script.dataset.workhubNaverMaps = "true"
    script.onload = () => window.naver?.maps ? resolve(window.naver.maps) : reject(new Error("지도 로드 실패"))
    script.onerror = () => reject(new Error("지도 로드 실패"))
    document.head.appendChild(script)
  })
  return window.__workhubNaverMapsPromise
}

export function NaverRouteMap({
  origin,
  destination,
  path,
}: {
  origin: AddressPoint | null
  destination: AddressPoint | null
  path: Array<[number, number]>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<NaverMapInstance | null>(null)
  const overlaysRef = useRef<Array<{ setMap: (map: NaverMapInstance | null) => void }>>([])
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    if (!containerRef.current || (!origin && !destination)) return
    void loadNaverMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return
        setError("")
        const centerPoint = origin || destination
        if (!centerPoint) return
        if (!mapRef.current) {
          mapRef.current = new maps.Map(containerRef.current, {
            center: new maps.LatLng(centerPoint.latitude, centerPoint.longitude),
            zoom: 12,
          })
        }
        overlaysRef.current.forEach((overlay) => overlay.setMap(null))
        overlaysRef.current = []
        const bounds = new maps.LatLngBounds()
        if (origin) {
          const position = new maps.LatLng(origin.latitude, origin.longitude)
          bounds.extend(position)
          overlaysRef.current.push(new maps.Marker({ position, map: mapRef.current, title: `출발: ${origin.address}` }))
        }
        if (destination) {
          const position = new maps.LatLng(destination.latitude, destination.longitude)
          bounds.extend(position)
          overlaysRef.current.push(new maps.Marker({ position, map: mapRef.current, title: `도착: ${destination.address}` }))
        }
        if (path.length > 1) {
          const routePath = path.map(([longitude, latitude]) => {
            const position = new maps.LatLng(latitude, longitude)
            bounds.extend(position)
            return position
          })
          overlaysRef.current.push(
            new maps.Polyline({
              map: mapRef.current,
              path: routePath,
              strokeColor: "#0891b2",
              strokeWeight: 6,
              strokeOpacity: 0.85,
              strokeLineCap: "round",
              strokeLineJoin: "round",
            }),
          )
        }
        if (origin && destination) mapRef.current.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
        else mapRef.current.setCenter(new maps.LatLng(centerPoint.latitude, centerPoint.longitude))
      })
      .catch(() => {
        if (!cancelled) setError("지도를 표시하지 못했습니다. 네이버 지도 키와 등록 URL을 확인해 주세요.")
      })
    return () => {
      cancelled = true
    }
  }, [destination, origin, path])

  if (!origin && !destination) {
    return (
      <div className="flex h-56 items-center justify-center gap-2 rounded-xl border border-dashed bg-slate-50 text-sm text-slate-500">
        <Map className="h-5 w-5" /> 출발지와 도착지를 선택하면 경로가 표시됩니다.
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-xl border bg-slate-100">
      <div ref={containerRef} className="h-64 w-full" aria-label="운행 경로 지도" />
      {error && (
        <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-xs text-rose-700 shadow">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
    </div>
  )
}

