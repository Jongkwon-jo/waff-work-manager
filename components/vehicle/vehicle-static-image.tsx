"use client"

import Image from "next/image"
import { useState } from "react"
import { CarFront } from "lucide-react"
import { cn } from "@/lib/utils"
import { normalizePlateNumber } from "@/lib/vehicle-types"

export function getVehicleStaticImageUrl(plateNumber: string) {
  const fileName = encodeURIComponent(normalizePlateNumber(plateNumber))
  return `/vehicle-images/${fileName}.webp`
}

export function getVehicleStaticImageCandidates(plateNumber: string) {
  const fileName = encodeURIComponent(normalizePlateNumber(plateNumber))
  return ["webp", "jpg", "jpeg", "png"].map((extension) => `/vehicle-images/${fileName}.${extension}`)
}

export function VehicleStaticImage({
  plateNumber,
  className,
  imageClassName,
}: {
  plateNumber: string
  className?: string
  imageClassName?: string
}) {
  const imageCandidates = getVehicleStaticImageCandidates(plateNumber)
  const [failedImageUrls, setFailedImageUrls] = useState<string[]>([])
  const imageUrl = imageCandidates.find((candidate) => !failedImageUrls.includes(candidate))

  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br from-slate-100 to-cyan-50", className)}>
      {!imageUrl ? (
        <CarFront className="absolute inset-0 m-auto h-1/3 w-1/3 max-h-20 max-w-20 text-slate-300" aria-hidden="true" />
      ) : (
        <Image
          src={imageUrl}
          alt={`${plateNumber} 차량`}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, 33vw"
          className={cn("object-cover", imageClassName)}
          onError={() => setFailedImageUrls((previous) => previous.includes(imageUrl) ? previous : [...previous, imageUrl])}
        />
      )}
    </div>
  )
}
