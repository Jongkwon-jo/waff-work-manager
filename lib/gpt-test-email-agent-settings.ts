import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore"

import { db } from "./firebase"
import type { EmailAgentSettings } from "./email-agent-types"
import { normalizeEmail, permissionDocId } from "./page-access"

const EMAIL_AGENT_SETTINGS_COLLECTION = "gpt_email_agent_settings"

export const DEFAULT_EMAIL_AGENT_SETTINGS: EmailAgentSettings = {
  serviceUrl: "http://127.0.0.1:8787",
  openaiApiKey: "",
  openaiModel: "gpt-5.2",
  imapHost: "",
  imapPort: 993,
  imapUsername: "",
  imapPassword: "",
  imapUseSsl: true,
  imapMailbox: "INBOX",
}

function toString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function toPort(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(1, Math.min(65535, Math.round(value)))
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.max(1, Math.min(65535, Math.round(parsed)))
  }
  return DEFAULT_EMAIL_AGENT_SETTINGS.imapPort
}

export function normalizeEmailAgentSettings(raw?: Partial<Record<keyof EmailAgentSettings, unknown>>): EmailAgentSettings {
  return {
    serviceUrl: toString(raw?.serviceUrl, DEFAULT_EMAIL_AGENT_SETTINGS.serviceUrl).trim() || DEFAULT_EMAIL_AGENT_SETTINGS.serviceUrl,
    openaiApiKey: toString(raw?.openaiApiKey).trim(),
    openaiModel: toString(raw?.openaiModel, DEFAULT_EMAIL_AGENT_SETTINGS.openaiModel).trim() || DEFAULT_EMAIL_AGENT_SETTINGS.openaiModel,
    imapHost: toString(raw?.imapHost).trim(),
    imapPort: toPort(raw?.imapPort),
    imapUsername: toString(raw?.imapUsername).trim(),
    imapPassword: toString(raw?.imapPassword),
    imapUseSsl: typeof raw?.imapUseSsl === "boolean" ? raw.imapUseSsl : DEFAULT_EMAIL_AGENT_SETTINGS.imapUseSsl,
    imapMailbox: toString(raw?.imapMailbox, DEFAULT_EMAIL_AGENT_SETTINGS.imapMailbox).trim() || DEFAULT_EMAIL_AGENT_SETTINGS.imapMailbox,
  }
}

export function subscribeCurrentUserEmailAgentSettings(
  email: string,
  callback: (settings: EmailAgentSettings) => void,
) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    callback({ ...DEFAULT_EMAIL_AGENT_SETTINGS })
    return () => {}
  }

  return onSnapshot(
    doc(db, EMAIL_AGENT_SETTINGS_COLLECTION, permissionDocId(normalizedEmail)),
    (snapshot) => {
      callback(normalizeEmailAgentSettings(snapshot.data() as Partial<Record<keyof EmailAgentSettings, unknown>> | undefined))
    },
    (error) => {
      console.error("Email agent settings snapshot error:", error)
      callback({ ...DEFAULT_EMAIL_AGENT_SETTINGS })
    },
  )
}

export async function saveCurrentUserEmailAgentSettings(email: string, settings: EmailAgentSettings) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return

  await setDoc(
    doc(db, EMAIL_AGENT_SETTINGS_COLLECTION, permissionDocId(normalizedEmail)),
    {
      ...normalizeEmailAgentSettings(settings),
      email: normalizedEmail,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}
