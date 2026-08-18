import "server-only"

import { randomUUID } from "node:crypto"
import { FieldValue, Timestamp, type DocumentData, type DocumentReference } from "firebase-admin/firestore"
import { getFirebaseAdminAuth, getFirebaseAdminFirestore, getFirebaseAdminStorage } from "@/lib/firebase-admin"
import {
  driveRecordInputSchema,
  maintenanceRecordInputSchema,
  normalizePlateNumber,
  vehicleInputSchema,
  type DriveRecord,
  type DriveRecordInput,
  type MaintenanceRecord,
  type MaintenanceRecordInput,
  type Vehicle,
  type VehicleInput,
} from "@/lib/vehicle-types"
import { VehicleApiException, type VehicleRequestUser } from "@/lib/vehicle-api-auth"

const VEHICLES_COLLECTION = "vehicles"
const DRIVE_RECORDS_COLLECTION = "driveRecords"
const MAINTENANCE_RECORDS_COLLECTION = "maintenanceRecords"
const KOREA_TIME_OFFSET_MS = 9 * 60 * 60 * 1000

function firstValidationMessage(error: { issues: Array<{ message: string }> }) {
  return error.issues[0]?.message || "입력값을 확인해 주세요."
}

function toIsoString(value: unknown): string | undefined {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString()
  }
  return typeof value === "string" ? value : undefined
}

function cleanObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function serializeVehicle(id: string, data: DocumentData): Vehicle {
  return {
    id,
    plateNumber: String(data.plateNumber || ""),
    manufacturer: String(data.manufacturer || ""),
    model: String(data.model || ""),
    year: String(data.year || ""),
    fuelType: String(data.fuelType || ""),
    status: data.status === "retired" ? "retired" : "active",
    activityStatus: "waiting",
    baselineOdometerKm: Number(data.baselineOdometerKm || 0),
    currentOdometerKm: Number(data.currentOdometerKm || data.baselineOdometerKm || 0),
    primaryManagerEmail: String(data.primaryManagerEmail || ""),
    secondaryManagerEmail: String(data.secondaryManagerEmail || ""),
    memo: String(data.memo || ""),
    imagePath: typeof data.imagePath === "string" ? data.imagePath : undefined,
    createdByEmail: String(data.createdByEmail || ""),
    updatedByEmail: String(data.updatedByEmail || ""),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
    retiredAt: toIsoString(data.retiredAt),
  }
}

function serializeDriveRecord(id: string, data: DocumentData): DriveRecord {
  return {
    id,
    drivenAt: String(data.drivenAt || ""),
    driverEmail: String(data.driverEmail || ""),
    passengerEmails: Array.isArray(data.passengerEmails) ? data.passengerEmails.map(String) : [],
    guestPassengers: Array.isArray(data.guestPassengers) ? data.guestPassengers.map(String) : [],
    purpose: String(data.purpose || ""),
    origin: data.origin,
    destination: data.destination,
    roundTrip: data.roundTrip === true,
    naverDistanceKm: typeof data.naverDistanceKm === "number" ? data.naverDistanceKm : null,
    naverDurationMinutes: typeof data.naverDurationMinutes === "number" ? data.naverDurationMinutes : null,
    routeCalculatedAt: String(data.routeCalculatedAt || ""),
    recordedDistanceKm: Number(data.recordedDistanceKm || 0),
    distanceOverrideReason: String(data.distanceOverrideReason || ""),
    startOdometerKm: typeof data.startOdometerKm === "number" ? data.startOdometerKm : null,
    endOdometerKm: typeof data.endOdometerKm === "number" ? data.endOdometerKm : null,
    memo: String(data.memo || ""),
    createdByEmail: String(data.createdByEmail || ""),
    updatedByEmail: String(data.updatedByEmail || ""),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  }
}

function serializeMaintenanceRecord(id: string, data: DocumentData): MaintenanceRecord {
  return {
    id,
    maintenanceDate: String(data.maintenanceDate || ""),
    odometerKm: Number(data.odometerKm || 0),
    description: String(data.description || ""),
    costWon: Number(data.costWon || 0),
    shopName: String(data.shopName || ""),
    maintenanceManager: String(data.maintenanceManager || ""),
    memo: String(data.memo || ""),
    createdByEmail: String(data.createdByEmail || ""),
    updatedByEmail: String(data.updatedByEmail || ""),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  }
}

async function getVehicleDocument(vehicleId: string) {
  const ref = getFirebaseAdminFirestore().collection(VEHICLES_COLLECTION).doc(vehicleId)
  const snapshot = await ref.get()
  if (!snapshot.exists) throw new VehicleApiException(404, "차량 정보를 찾을 수 없습니다.")
  return { ref, snapshot, vehicle: serializeVehicle(snapshot.id, snapshot.data() || {}) }
}

async function validateManagerAccounts(input: VehicleInput) {
  const emails = [input.primaryManagerEmail, input.secondaryManagerEmail].filter(Boolean)
  await Promise.all(
    emails.map(async (email) => {
      try {
        const account = await getFirebaseAdminAuth().getUserByEmail(email)
        if (account.disabled) throw new Error("disabled")
      } catch {
        throw new VehicleApiException(400, `${email} 계정은 활성 담당자 계정이 아닙니다.`)
      }
    }),
  )
}

async function ensureUniquePlate(plateNumber: string, excludeVehicleId?: string) {
  const plateNumberKey = normalizePlateNumber(plateNumber)
  const snapshot = await getFirebaseAdminFirestore()
    .collection(VEHICLES_COLLECTION)
    .where("plateNumberKey", "==", plateNumberKey)
    .limit(2)
    .get()
  if (snapshot.docs.some((document) => document.id !== excludeVehicleId)) {
    throw new VehicleApiException(409, "이미 등록된 차량번호입니다.")
  }
  return plateNumberKey
}

async function signedImageUrl(imagePath?: string) {
  if (!imagePath) return undefined
  try {
    const [url] = await getFirebaseAdminStorage()
      .bucket()
      .file(imagePath)
      .getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 })
    return url
  } catch (error) {
    console.error("Vehicle image signed URL error:", error)
    return undefined
  }
}

function koreaLocalDateTimeValue(date = new Date()) {
  return new Date(date.getTime() + KOREA_TIME_OFFSET_MS).toISOString().slice(0, 16)
}

function parseKoreaLocalDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value)
  if (!match) return Number.NaN
  const [, year, month, day, hour, minute, second = "0"] = match
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 9,
    Number(minute),
    Number(second),
  )
}

async function getVehicleActivityStatus(vehicleRef: DocumentReference, vehicle: Vehicle): Promise<Vehicle["activityStatus"]> {
  if (vehicle.status !== "active") return "waiting"

  try {
    const now = new Date()
    const snapshot = await vehicleRef
      .collection(DRIVE_RECORDS_COLLECTION)
      .where("drivenAt", "<=", koreaLocalDateTimeValue(now))
      .orderBy("drivenAt", "desc")
      .limit(1)
      .get()
    const record = snapshot.docs[0]?.data()
    if (!record) return "waiting"

    const startedAt = parseKoreaLocalDateTime(String(record.drivenAt || ""))
    const durationMinutes = Number(record.naverDurationMinutes)
    if (!Number.isFinite(startedAt) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return "waiting"

    const nowValue = now.getTime()
    return nowValue >= startedAt && nowValue < startedAt + durationMinutes * 60 * 1000 ? "driving" : "waiting"
  } catch (error) {
    console.error("Vehicle activity status error:", error)
    return "waiting"
  }
}

export async function listVehicles(): Promise<Vehicle[]> {
  const snapshot = await getFirebaseAdminFirestore().collection(VEHICLES_COLLECTION).orderBy("plateNumberKey", "asc").get()
  return Promise.all(
    snapshot.docs.map(async (document) => {
      const vehicle = serializeVehicle(document.id, document.data())
      const [imageUrl, activityStatus] = await Promise.all([
        signedImageUrl(vehicle.imagePath),
        getVehicleActivityStatus(document.ref, vehicle),
      ])
      vehicle.imageUrl = imageUrl
      vehicle.activityStatus = activityStatus
      return vehicle
    }),
  )
}

export async function getVehicle(vehicleId: string): Promise<Vehicle> {
  const { ref, vehicle } = await getVehicleDocument(vehicleId)
  const [imageUrl, activityStatus] = await Promise.all([
    signedImageUrl(vehicle.imagePath),
    getVehicleActivityStatus(ref, vehicle),
  ])
  vehicle.imageUrl = imageUrl
  vehicle.activityStatus = activityStatus
  return vehicle
}

export async function createVehicle(raw: unknown, user: VehicleRequestUser): Promise<Vehicle> {
  const parsed = vehicleInputSchema.safeParse(raw)
  if (!parsed.success) throw new VehicleApiException(400, firstValidationMessage(parsed.error))
  await validateManagerAccounts(parsed.data)
  const plateNumberKey = await ensureUniquePlate(parsed.data.plateNumber)
  const ref = getFirebaseAdminFirestore().collection(VEHICLES_COLLECTION).doc()
  const now = FieldValue.serverTimestamp()
  await ref.set({
    ...parsed.data,
    plateNumberKey,
    currentOdometerKm: parsed.data.baselineOdometerKm,
    createdByEmail: user.email,
    updatedByEmail: user.email,
    createdAt: now,
    updatedAt: now,
  })
  return getVehicle(ref.id)
}

export async function updateVehicle(vehicleId: string, raw: unknown, user: VehicleRequestUser): Promise<Vehicle> {
  const parsed = vehicleInputSchema.safeParse(raw)
  if (!parsed.success) throw new VehicleApiException(400, firstValidationMessage(parsed.error))
  await validateManagerAccounts(parsed.data)
  const plateNumberKey = await ensureUniquePlate(parsed.data.plateNumber, vehicleId)
  const { ref, vehicle } = await getVehicleDocument(vehicleId)
  const statusChangedToRetired = vehicle.status !== "retired" && parsed.data.status === "retired"
  const statusChangedToActive = vehicle.status === "retired" && parsed.data.status === "active"

  await ref.update(
    cleanObject({
      ...parsed.data,
      plateNumberKey,
      updatedByEmail: user.email,
      updatedAt: FieldValue.serverTimestamp(),
      retiredAt: statusChangedToRetired ? FieldValue.serverTimestamp() : statusChangedToActive ? FieldValue.delete() : undefined,
    }),
  )
  await recalculateVehicleOdometer(ref)
  return getVehicle(vehicleId)
}

export async function saveVehicleImage(vehicleId: string, file: File, user: VehicleRequestUser): Promise<Vehicle> {
  const allowedTypes: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }
  const extension = allowedTypes[file.type]
  if (!extension) throw new VehicleApiException(400, "JPEG, PNG, WebP 이미지만 등록할 수 있습니다.")
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
    throw new VehicleApiException(400, "차량 이미지는 5MB 이하로 등록해 주세요.")
  }

  const { ref, vehicle } = await getVehicleDocument(vehicleId)
  const imagePath = `vehicle-images/${vehicleId}/${randomUUID()}.${extension}`
  const target = getFirebaseAdminStorage().bucket().file(imagePath)
  try {
    await target.save(Buffer.from(await file.arrayBuffer()), {
      resumable: false,
      metadata: { contentType: file.type, cacheControl: "private, max-age=3600" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
    console.error("Vehicle image upload error:", { code, message })
    if (code === "404" || /bucket.*(does not exist|not found)|notfound/i.test(message)) {
      throw new VehicleApiException(
        503,
        "Firebase Storage가 아직 생성되지 않았습니다. Firebase 콘솔의 Storage에서 버킷을 먼저 생성해 주세요.",
      )
    }
    if (code === "403" || /permission|forbidden|denied/i.test(message)) {
      throw new VehicleApiException(
        503,
        "Firebase Storage 업로드 권한이 없습니다. 서버 서비스 계정에 Storage Object Admin 권한을 확인해 주세요.",
      )
    }
    throw new VehicleApiException(502, "차량 이미지 저장소에 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.")
  }

  try {
    await ref.update({ imagePath, updatedByEmail: user.email, updatedAt: FieldValue.serverTimestamp() })
  } catch (error) {
    await target.delete({ ignoreNotFound: true }).catch(console.error)
    throw error
  }
  if (vehicle.imagePath && vehicle.imagePath !== imagePath) {
    await getFirebaseAdminStorage().bucket().file(vehicle.imagePath).delete({ ignoreNotFound: true }).catch(console.error)
  }
  return getVehicle(vehicleId)
}

export async function deleteVehicleImage(vehicleId: string, user: VehicleRequestUser): Promise<Vehicle> {
  const { ref, vehicle } = await getVehicleDocument(vehicleId)
  await ref.update({
    imagePath: FieldValue.delete(),
    updatedByEmail: user.email,
    updatedAt: FieldValue.serverTimestamp(),
  })
  if (vehicle.imagePath) {
    await getFirebaseAdminStorage().bucket().file(vehicle.imagePath).delete({ ignoreNotFound: true }).catch(console.error)
  }
  return getVehicle(vehicleId)
}

async function computeOdometerMaximum(
  vehicleRef: DocumentReference,
  override?: { kind: "drive" | "maintenance"; recordId: string; value: number | null },
) {
  const [vehicleSnapshot, driveSnapshot, maintenanceSnapshot] = await Promise.all([
    vehicleRef.get(),
    vehicleRef.collection(DRIVE_RECORDS_COLLECTION).get(),
    vehicleRef.collection(MAINTENANCE_RECORDS_COLLECTION).get(),
  ])
  if (!vehicleSnapshot.exists) throw new VehicleApiException(404, "차량 정보를 찾을 수 없습니다.")
  const vehicle = serializeVehicle(vehicleSnapshot.id, vehicleSnapshot.data() || {})
  const values = [vehicle.baselineOdometerKm]
  driveSnapshot.docs.forEach((document) => {
    const value = override?.kind === "drive" && override.recordId === document.id ? override.value : document.data().endOdometerKm
    if (typeof value === "number") values.push(value)
  })
  maintenanceSnapshot.docs.forEach((document) => {
    const value =
      override?.kind === "maintenance" && override.recordId === document.id ? override.value : document.data().odometerKm
    if (typeof value === "number") values.push(value)
  })
  return { vehicle, maximum: Math.max(...values) }
}

async function recalculateVehicleOdometer(vehicleRef: DocumentReference) {
  const { maximum } = await computeOdometerMaximum(vehicleRef)
  await vehicleRef.update({ currentOdometerKm: maximum, updatedAt: FieldValue.serverTimestamp() })
  return maximum
}

function ensureVehicleActive(vehicle: Vehicle) {
  if (vehicle.status !== "active") {
    throw new VehicleApiException(409, "숨김 차량은 기록을 변경할 수 없습니다. 관리자에게 차량 보이기를 요청해 주세요.")
  }
}

function ensureRecordOwner(record: DocumentData, user: VehicleRequestUser) {
  if (!user.isAdmin && record.createdByEmail !== user.email) {
    throw new VehicleApiException(403, "본인이 작성한 기록만 수정하거나 삭제할 수 있습니다.")
  }
}

async function rejectNonAdminOdometerDecrease(
  vehicleRef: DocumentReference,
  user: VehicleRequestUser,
  override: { kind: "drive" | "maintenance"; recordId: string; value: number | null },
) {
  if (user.isAdmin) return
  const { vehicle, maximum } = await computeOdometerMaximum(vehicleRef, override)
  if (maximum < vehicle.currentOdometerKm) {
    throw new VehicleApiException(403, "차량 현재 km를 낮추는 정정은 관리자만 할 수 있습니다.")
  }
}

export async function listDriveRecords(vehicleId: string): Promise<DriveRecord[]> {
  const { ref } = await getVehicleDocument(vehicleId)
  const snapshot = await ref.collection(DRIVE_RECORDS_COLLECTION).orderBy("drivenAt", "desc").get()
  return snapshot.docs.map((document) => serializeDriveRecord(document.id, document.data()))
}

export async function createDriveRecord(vehicleId: string, raw: unknown, user: VehicleRequestUser) {
  const parsed = driveRecordInputSchema.safeParse(raw)
  if (!parsed.success) throw new VehicleApiException(400, firstValidationMessage(parsed.error))
  const { ref: vehicleRef, vehicle } = await getVehicleDocument(vehicleId)
  ensureVehicleActive(vehicle)
  const recordRef = vehicleRef.collection(DRIVE_RECORDS_COLLECTION).doc()
  await getFirebaseAdminFirestore().runTransaction(async (transaction) => {
    const latestVehicleSnapshot = await transaction.get(vehicleRef)
    const latestVehicle = serializeVehicle(latestVehicleSnapshot.id, latestVehicleSnapshot.data() || {})
    ensureVehicleActive(latestVehicle)
    transaction.set(recordRef, {
      ...parsed.data,
      createdByEmail: user.email,
      updatedByEmail: user.email,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (parsed.data.endOdometerKm !== null && parsed.data.endOdometerKm > latestVehicle.currentOdometerKm) {
      transaction.update(vehicleRef, {
        currentOdometerKm: parsed.data.endOdometerKm,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  })
  const snapshot = await recordRef.get()
  return serializeDriveRecord(snapshot.id, snapshot.data() || {})
}

export async function updateDriveRecord(vehicleId: string, recordId: string, raw: unknown, user: VehicleRequestUser) {
  const parsed = driveRecordInputSchema.safeParse(raw)
  if (!parsed.success) throw new VehicleApiException(400, firstValidationMessage(parsed.error))
  const { ref: vehicleRef, vehicle } = await getVehicleDocument(vehicleId)
  ensureVehicleActive(vehicle)
  const recordRef = vehicleRef.collection(DRIVE_RECORDS_COLLECTION).doc(recordId)
  const snapshot = await recordRef.get()
  if (!snapshot.exists) throw new VehicleApiException(404, "운행기록을 찾을 수 없습니다.")
  ensureRecordOwner(snapshot.data() || {}, user)
  await rejectNonAdminOdometerDecrease(vehicleRef, user, { kind: "drive", recordId, value: parsed.data.endOdometerKm })
  await recordRef.update({ ...parsed.data, updatedByEmail: user.email, updatedAt: FieldValue.serverTimestamp() })
  await recalculateVehicleOdometer(vehicleRef)
  return serializeDriveRecord(recordId, (await recordRef.get()).data() || {})
}

export async function deleteDriveRecord(vehicleId: string, recordId: string, user: VehicleRequestUser) {
  const { ref: vehicleRef, vehicle } = await getVehicleDocument(vehicleId)
  ensureVehicleActive(vehicle)
  const recordRef = vehicleRef.collection(DRIVE_RECORDS_COLLECTION).doc(recordId)
  const snapshot = await recordRef.get()
  if (!snapshot.exists) throw new VehicleApiException(404, "운행기록을 찾을 수 없습니다.")
  ensureRecordOwner(snapshot.data() || {}, user)
  await rejectNonAdminOdometerDecrease(vehicleRef, user, { kind: "drive", recordId, value: null })
  await recordRef.delete()
  await recalculateVehicleOdometer(vehicleRef)
}

export async function listMaintenanceRecords(vehicleId: string): Promise<MaintenanceRecord[]> {
  const { ref } = await getVehicleDocument(vehicleId)
  const snapshot = await ref.collection(MAINTENANCE_RECORDS_COLLECTION).orderBy("maintenanceDate", "desc").get()
  return snapshot.docs.map((document) => serializeMaintenanceRecord(document.id, document.data()))
}

export async function createMaintenanceRecord(vehicleId: string, raw: unknown, user: VehicleRequestUser) {
  const parsed = maintenanceRecordInputSchema.safeParse(raw)
  if (!parsed.success) throw new VehicleApiException(400, firstValidationMessage(parsed.error))
  const { ref: vehicleRef, vehicle } = await getVehicleDocument(vehicleId)
  ensureVehicleActive(vehicle)
  const recordRef = vehicleRef.collection(MAINTENANCE_RECORDS_COLLECTION).doc()
  await getFirebaseAdminFirestore().runTransaction(async (transaction) => {
    const latestVehicleSnapshot = await transaction.get(vehicleRef)
    const latestVehicle = serializeVehicle(latestVehicleSnapshot.id, latestVehicleSnapshot.data() || {})
    ensureVehicleActive(latestVehicle)
    transaction.set(recordRef, {
      ...parsed.data,
      createdByEmail: user.email,
      updatedByEmail: user.email,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (parsed.data.odometerKm > latestVehicle.currentOdometerKm) {
      transaction.update(vehicleRef, {
        currentOdometerKm: parsed.data.odometerKm,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  })
  return serializeMaintenanceRecord(recordRef.id, (await recordRef.get()).data() || {})
}

export async function updateMaintenanceRecord(
  vehicleId: string,
  recordId: string,
  raw: unknown,
  user: VehicleRequestUser,
) {
  const parsed = maintenanceRecordInputSchema.safeParse(raw)
  if (!parsed.success) throw new VehicleApiException(400, firstValidationMessage(parsed.error))
  const { ref: vehicleRef, vehicle } = await getVehicleDocument(vehicleId)
  ensureVehicleActive(vehicle)
  const recordRef = vehicleRef.collection(MAINTENANCE_RECORDS_COLLECTION).doc(recordId)
  const snapshot = await recordRef.get()
  if (!snapshot.exists) throw new VehicleApiException(404, "정비이력을 찾을 수 없습니다.")
  ensureRecordOwner(snapshot.data() || {}, user)
  await rejectNonAdminOdometerDecrease(vehicleRef, user, {
    kind: "maintenance",
    recordId,
    value: parsed.data.odometerKm,
  })
  await recordRef.update({ ...parsed.data, updatedByEmail: user.email, updatedAt: FieldValue.serverTimestamp() })
  await recalculateVehicleOdometer(vehicleRef)
  return serializeMaintenanceRecord(recordId, (await recordRef.get()).data() || {})
}

export async function deleteMaintenanceRecord(vehicleId: string, recordId: string, user: VehicleRequestUser) {
  const { ref: vehicleRef, vehicle } = await getVehicleDocument(vehicleId)
  ensureVehicleActive(vehicle)
  const recordRef = vehicleRef.collection(MAINTENANCE_RECORDS_COLLECTION).doc(recordId)
  const snapshot = await recordRef.get()
  if (!snapshot.exists) throw new VehicleApiException(404, "정비이력을 찾을 수 없습니다.")
  ensureRecordOwner(snapshot.data() || {}, user)
  await rejectNonAdminOdometerDecrease(vehicleRef, user, { kind: "maintenance", recordId, value: null })
  await recordRef.delete()
  await recalculateVehicleOdometer(vehicleRef)
}

export function parseDriveInput(raw: DriveRecordInput) {
  return driveRecordInputSchema.parse(raw)
}

export function parseMaintenanceInput(raw: MaintenanceRecordInput) {
  return maintenanceRecordInputSchema.parse(raw)
}
