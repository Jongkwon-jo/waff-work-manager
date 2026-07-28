import "server-only"

import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"

function getFirebaseAdminCredential() {
  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim()
  if (!serviceAccountJson) return applicationDefault()

  const serviceAccount = JSON.parse(serviceAccountJson) as {
    project_id?: string
    client_email?: string
    private_key?: string
  }

  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON is missing required fields.")
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
