import "server-only"

import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"

type ServiceAccountJson = {
  project_id?: string
  client_email?: string
  private_key?: string
}

export type FirebaseAdminConfigurationErrorCode =
  | "missing-service-account"
  | "invalid-service-account-json"
  | "incomplete-service-account"

export class FirebaseAdminConfigurationError extends Error {
  constructor(
    readonly code: FirebaseAdminConfigurationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "FirebaseAdminConfigurationError"
  }
}

function parseServiceAccountJson(value: string): ServiceAccountJson {
  let parsed: unknown

  try {
    parsed = JSON.parse(value)
    // Some secret managers store a JSON object as a quoted JSON string.
    if (typeof parsed === "string") parsed = JSON.parse(parsed)
  } catch {
    throw new FirebaseAdminConfigurationError(
      "invalid-service-account-json",
      "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is not valid JSON.",
    )
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FirebaseAdminConfigurationError(
      "invalid-service-account-json",
      "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON must contain a JSON object.",
    )
  }

  return parsed as ServiceAccountJson
}

function getFirebaseAdminCredential() {
  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim()
  if (!serviceAccountJson) {
    if (process.env.VERCEL) {
      throw new FirebaseAdminConfigurationError(
        "missing-service-account",
        "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is not configured in Vercel.",
      )
    }
    return applicationDefault()
  }

  const serviceAccount = parseServiceAccountJson(serviceAccountJson)

  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new FirebaseAdminConfigurationError(
      "incomplete-service-account",
      "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is missing required fields.",
    )
  }

  return cert({
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key.replace(/\\n/g, "\n"),
  })
}

function getFirebaseAdminApp() {
  const existingApp = getApps()[0]
  if (existingApp) return existingApp

  return initializeApp({
    credential: getFirebaseAdminCredential(),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  })
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp())
}
