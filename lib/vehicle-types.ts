import { z } from "zod"

export const vehicleStatusSchema = z.enum(["active", "retired"])
export type VehicleStatus = z.infer<typeof vehicleStatusSchema>

const optionalTrimmedString = (max: number) => z.string().trim().max(max).optional().default("")
const optionalNonNegativeNumber = z.number().finite().nonnegative().nullable().optional().default(null)

export const vehicleInputSchema = z
  .object({
    plateNumber: z.string().trim().min(1, "차량번호를 입력해 주세요.").max(30),
    manufacturer: optionalTrimmedString(50),
    model: z.string().trim().min(1, "차량 모델을 입력해 주세요.").max(80),
    year: optionalTrimmedString(10),
    fuelType: optionalTrimmedString(30),
    status: vehicleStatusSchema.default("active"),
    baselineOdometerKm: z.number().finite().nonnegative(),
    primaryManagerEmail: z.string().trim().email("정 담당자를 선택해 주세요."),
    secondaryManagerEmail: z.union([z.string().trim().email(), z.literal("")]).default(""),
    memo: optionalTrimmedString(500),
  })
  .superRefine((value, context) => {
    if (value.secondaryManagerEmail && value.secondaryManagerEmail === value.primaryManagerEmail) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["secondaryManagerEmail"],
        message: "정 담당자와 부 담당자는 서로 달라야 합니다.",
      })
    }
  })

export type VehicleInput = z.infer<typeof vehicleInputSchema>

export type Vehicle = VehicleInput & {
  id: string
  currentOdometerKm: number
  activityStatus: "driving" | "waiting"
  imagePath?: string
  imageUrl?: string
  createdByEmail: string
  updatedByEmail: string
  createdAt?: string
  updatedAt?: string
  retiredAt?: string
}

export const addressPointSchema = z.object({
  address: z.string().trim().min(1).max(250),
  roadAddress: optionalTrimmedString(250),
  jibunAddress: optionalTrimmedString(250),
  placeName: optionalTrimmedString(120),
  category: optionalTrimmedString(120),
  source: z.enum(["address", "place"]).optional(),
  latitude: z.number().finite(),
  longitude: z.number().finite(),
})

export type AddressPoint = z.infer<typeof addressPointSchema>

export type AddressCandidate = AddressPoint & {
  label: string
}

export const driveRecordInputSchema = z
  .object({
    drivenAt: z.string().trim().min(1, "운행일시를 입력해 주세요.").max(40),
    driverEmail: z.string().trim().email("운전자를 선택해 주세요."),
    passengerEmails: z.array(z.string().trim().email()).max(30).default([]),
    guestPassengers: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
    purpose: z.string().trim().min(1, "운행목적을 입력해 주세요.").max(200),
    origin: addressPointSchema,
    destination: addressPointSchema,
    roundTrip: z.boolean().default(false),
    naverDistanceKm: optionalNonNegativeNumber,
    naverDurationMinutes: optionalNonNegativeNumber,
    routeCalculatedAt: optionalTrimmedString(40),
    recordedDistanceKm: z.number().finite().positive("기록거리는 0보다 커야 합니다."),
    distanceOverrideReason: optionalTrimmedString(300),
    startOdometerKm: optionalNonNegativeNumber,
    endOdometerKm: optionalNonNegativeNumber,
    memo: optionalTrimmedString(500),
  })
  .superRefine((value, context) => {
    const hasStart = value.startOdometerKm !== null
    const hasEnd = value.endOdometerKm !== null
    if (hasStart !== hasEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasStart ? ["endOdometerKm"] : ["startOdometerKm"],
        message: "출발 km와 도착 km는 함께 입력해 주세요.",
      })
    }
    if (hasStart && hasEnd && Number(value.endOdometerKm) < Number(value.startOdometerKm)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endOdometerKm"],
        message: "도착 km는 출발 km 이상이어야 합니다.",
      })
    }
    const adjusted = value.naverDistanceKm === null || Math.abs(value.recordedDistanceKm - value.naverDistanceKm) >= 0.01
    if (adjusted && !value.distanceOverrideReason.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distanceOverrideReason"],
        message: "거리 수동 입력 또는 보정 사유를 입력해 주세요.",
      })
    }
  })

export type DriveRecordInput = z.infer<typeof driveRecordInputSchema>

export type DriveRecord = DriveRecordInput & {
  id: string
  createdByEmail: string
  updatedByEmail: string
  createdAt?: string
  updatedAt?: string
}

export const maintenanceRecordInputSchema = z.object({
  maintenanceDate: z.string().trim().min(1, "정비일을 입력해 주세요.").max(20),
  odometerKm: z.number().finite().nonnegative(),
  description: z.string().trim().min(1, "정비내역을 입력해 주세요.").max(500),
  costWon: z.number().int().nonnegative(),
  shopName: z.string().trim().min(1, "정비소를 입력해 주세요.").max(120),
  maintenanceManager: z.string().trim().min(1, "정비담당자를 입력해 주세요.").max(100),
  memo: optionalTrimmedString(500),
})

export type MaintenanceRecordInput = z.infer<typeof maintenanceRecordInputSchema>

export type MaintenanceRecord = MaintenanceRecordInput & {
  id: string
  createdByEmail: string
  updatedByEmail: string
  createdAt?: string
  updatedAt?: string
}

export type DirectionsResult = {
  distanceKm: number
  durationMinutes: number
  calculatedAt: string
  path: Array<[number, number]>
}

export function normalizePlateNumber(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "")
}
