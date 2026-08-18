"use client"

import { useCallback, useEffect, useState } from "react"
import type { User } from "firebase/auth"
import { Loader2, MapPin, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { vehicleApiFetch } from "@/lib/vehicle-client"
import type { AddressCandidate, AddressPoint } from "@/lib/vehicle-types"

export function AddressSearchInput({
  user,
  value,
  onChange,
  placeholder,
}: {
  user: User
  value: AddressPoint | null
  onChange: (point: AddressPoint) => void
  placeholder: string
}) {
  const [query, setQuery] = useState(value?.placeName || value?.address || "")
  const [candidates, setCandidates] = useState<AddressCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const search = useCallback(async (searchQuery: string, signal?: AbortSignal) => {
    if (searchQuery.length < 2) {
      setError("주소 또는 장소명을 2자 이상 입력해 주세요.")
      return
    }
    setLoading(true)
    setError("")
    try {
      const data = await vehicleApiFetch<{
        candidates: AddressCandidate[]
        placeSearchConfigured?: boolean
        placeSearchError?: string
      }>(
        user,
        `/api/naver-maps/geocode?query=${encodeURIComponent(searchQuery)}`,
        { signal },
      )
      setCandidates(data.candidates)
      if (data.candidates.length === 0) {
        setError(
          data.placeSearchError || (data.placeSearchConfigured === false
            ? "검색 결과가 없습니다. 장소명 검색을 사용하려면 NAVER API HUB 키 설정이 필요합니다."
            : "검색 결과가 없습니다. 주소 또는 장소명을 확인해 주세요."),
        )
      }
    } catch (searchError) {
      if (signal?.aborted) return
      setCandidates([])
      setError(searchError instanceof Error ? searchError.message : "주소를 검색하지 못했습니다.")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [user])

  useEffect(() => {
    const searchQuery = query.trim()
    const selectedLabel = value?.placeName || value?.address || ""
    if (searchQuery.length < 2 || searchQuery === selectedLabel) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void search(searchQuery, controller.signal)
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, search, value?.address, value?.placeName])

  return (
    <div className="relative min-w-56 space-y-1">
      <div className="flex gap-1">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setCandidates([])
            setError("")
            setLoading(false)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void search(query.trim())
            }
          }}
          placeholder={placeholder}
          className="h-8 min-w-0 text-xs"
        />
        <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => void search(query.trim())} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          <span className="sr-only">주소 검색</span>
        </Button>
      </div>
      {value && (
        <p className="flex items-center gap-1 truncate text-[11px] font-medium text-emerald-700" title={value.placeName ? `${value.placeName} · ${value.address}` : value.address}>
          <MapPin className="h-3 w-3 shrink-0" /> 선택됨: {value.placeName ? `${value.placeName} · ${value.address}` : value.address}
        </p>
      )}
      {error && <p className="max-w-64 text-[11px] text-rose-600">{error}</p>}
      {candidates.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-52 w-80 overflow-y-auto rounded-lg border bg-white p-1 shadow-xl">
          {candidates.map((candidate, index) => (
            <button
              key={`${candidate.longitude}-${candidate.latitude}-${index}`}
              type="button"
              className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50"
              onClick={() => {
                setQuery(candidate.label)
                onChange(candidate)
                setCandidates([])
              }}
            >
              <span className="block text-xs font-medium text-slate-900">{candidate.label}</span>
              {candidate.source === "place" && candidate.category && (
                <span className="mt-0.5 block text-[10px] text-cyan-700">{candidate.category}</span>
              )}
              {candidate.source === "place" && (
                <span className="mt-0.5 block text-[11px] text-slate-600">{candidate.roadAddress || candidate.jibunAddress}</span>
              )}
              {candidate.jibunAddress && candidate.jibunAddress !== candidate.label && candidate.jibunAddress !== candidate.roadAddress && (
                <span className="mt-0.5 block text-[11px] text-slate-500">지번 {candidate.jibunAddress}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
