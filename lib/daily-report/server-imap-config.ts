import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { normalizeEmail, permissionDocId } from "@/lib/page-access";

const USER_PROFILES = "user_profiles";
const FIELD = "dailyReportImapConfig";

export interface StoredImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  limit: number;
  unreadOnly: boolean;
  since: string;
}

export interface MaskedImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  mailbox: string;
  limit: number;
  unreadOnly: boolean;
  since: string;
  hasPassword: boolean;
}

const DEFAULTS: StoredImapConfig = {
  host: "",
  port: 993,
  secure: true,
  user: "",
  password: "",
  mailbox: "INBOX",
  limit: 20,
  unreadOnly: false,
  since: "",
};

const ref = (email: string) =>
  doc(db, USER_PROFILES, permissionDocId(normalizeEmail(email)));

function coerce(raw: unknown): StoredImapConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as Partial<StoredImapConfig>;
  return {
    host: typeof cfg.host === "string" ? cfg.host : DEFAULTS.host,
    port: typeof cfg.port === "number" && cfg.port > 0 ? cfg.port : DEFAULTS.port,
    secure: typeof cfg.secure === "boolean" ? cfg.secure : DEFAULTS.secure,
    user: typeof cfg.user === "string" ? cfg.user : DEFAULTS.user,
    password: typeof cfg.password === "string" ? cfg.password : DEFAULTS.password,
    mailbox: typeof cfg.mailbox === "string" ? cfg.mailbox : DEFAULTS.mailbox,
    limit: typeof cfg.limit === "number" && cfg.limit > 0 ? cfg.limit : DEFAULTS.limit,
    unreadOnly:
      typeof cfg.unreadOnly === "boolean" ? cfg.unreadOnly : DEFAULTS.unreadOnly,
    since: typeof cfg.since === "string" ? cfg.since : DEFAULTS.since,
  };
}

export async function fetchUserImapConfig(
  email: string,
): Promise<StoredImapConfig | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  try {
    const snap = await getDoc(ref(normalized));
    if (!snap.exists()) return null;
    const raw = (snap.data() as Record<string, unknown>)[FIELD];
    return coerce(raw);
  } catch (err) {
    console.error("fetchUserImapConfig failed", err);
    return null;
  }
}

/**
 * 부분 업데이트:
 * - password 가 비어있는 string 으로 들어오면 기존 password 유지.
 * - password 가 새 값으로 들어오면 덮어쓰기.
 * - 나머지 필드는 명시적으로 전달된 것만 갱신, 미전달 필드는 기존값 유지.
 */
export async function saveUserImapConfig(
  email: string,
  patch: Partial<StoredImapConfig>,
): Promise<StoredImapConfig> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("email 이 필요합니다.");
  const existing = (await fetchUserImapConfig(normalized)) ?? DEFAULTS;
  const merged: StoredImapConfig = {
    host: typeof patch.host === "string" ? patch.host.trim() : existing.host,
    port: typeof patch.port === "number" && patch.port > 0 ? patch.port : existing.port,
    secure: typeof patch.secure === "boolean" ? patch.secure : existing.secure,
    user: typeof patch.user === "string" ? patch.user.trim() : existing.user,
    password:
      typeof patch.password === "string" && patch.password.length > 0
        ? patch.password
        : existing.password,
    mailbox:
      typeof patch.mailbox === "string" && patch.mailbox.trim().length > 0
        ? patch.mailbox.trim()
        : existing.mailbox,
    limit:
      typeof patch.limit === "number" && patch.limit > 0
        ? patch.limit
        : existing.limit,
    unreadOnly:
      typeof patch.unreadOnly === "boolean" ? patch.unreadOnly : existing.unreadOnly,
    since: typeof patch.since === "string" ? patch.since : existing.since,
  };
  await setDoc(
    ref(normalized),
    {
      email: normalized,
      [FIELD]: merged,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return merged;
}

export async function deleteUserImapConfig(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("email 이 필요합니다.");
  await setDoc(
    ref(normalized),
    {
      email: normalized,
      [FIELD]: deleteField(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function maskImapConfig(cfg: StoredImapConfig | null): MaskedImapConfig {
  if (!cfg) {
    return {
      host: DEFAULTS.host,
      port: DEFAULTS.port,
      secure: DEFAULTS.secure,
      user: DEFAULTS.user,
      mailbox: DEFAULTS.mailbox,
      limit: DEFAULTS.limit,
      unreadOnly: DEFAULTS.unreadOnly,
      since: DEFAULTS.since,
      hasPassword: false,
    };
  }
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    mailbox: cfg.mailbox,
    limit: cfg.limit,
    unreadOnly: cfg.unreadOnly,
    since: cfg.since,
    hasPassword: Boolean(cfg.password && cfg.password.length > 0),
  };
}
