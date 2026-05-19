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
const FIELD = "openaiApiKey";

const profileRef = (email: string) =>
  doc(db, USER_PROFILES, permissionDocId(normalizeEmail(email)));

export async function saveUserOpenAiApiKey(
  email: string,
  apiKey: string,
): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("email이 필요합니다.");
  if (!apiKey || apiKey.trim().length < 8) {
    throw new Error("유효하지 않은 API key 입니다.");
  }
  await setDoc(
    profileRef(normalized),
    {
      email: normalized,
      [FIELD]: apiKey.trim(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function deleteUserOpenAiApiKey(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("email이 필요합니다.");
  await setDoc(
    profileRef(normalized),
    {
      email: normalized,
      [FIELD]: deleteField(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function fetchUserOpenAiApiKey(
  email: string,
): Promise<string | undefined> {
  const normalized = normalizeEmail(email);
  if (!normalized) return undefined;
  try {
    const snap = await getDoc(profileRef(normalized));
    if (!snap.exists()) return undefined;
    const raw = snap.data() as Record<string, unknown>;
    const value = raw[FIELD];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return undefined;
  } catch (err) {
    console.error("fetchUserOpenAiApiKey failed", err);
    return undefined;
  }
}

export function maskApiKey(key: string | undefined): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (trimmed.length < 8) return "****";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
