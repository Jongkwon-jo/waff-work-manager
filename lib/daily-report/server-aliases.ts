import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { normalizeEmail, permissionDocId } from "@/lib/page-access";

const USER_PROFILES = "user_profiles";

/** 이메일 기반 fallback alias 후보 (taskAliases 가 비어 있을 때 사용). */
function fallbackAliases(email: string): string[] {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return [];
  const localPart = normalizedEmail.split("@")[0] ?? "";
  const candidates = [
    normalizedEmail,
    localPart,
    localPart.replaceAll(".", " "),
    localPart.replaceAll(".", ""),
  ]
    .map((v) => v.trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

/**
 * user_profiles 의 taskAliases 를 읽고, 비어 있으면 email 기반 fallback 을 반환한다.
 * - 마이워크 페이지가 사용하는 매칭과 일관되게 alias 후보를 만든다.
 * - 정규화: 소문자 trim.
 */
export async function fetchUserTaskAliases(email: string): Promise<string[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  try {
    const snap = await getDoc(
      doc(db, USER_PROFILES, permissionDocId(normalized)),
    );
    if (snap.exists()) {
      const raw = (snap.data() as { taskAliases?: unknown }).taskAliases;
      if (Array.isArray(raw)) {
        const aliases = raw
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter(Boolean);
        if (aliases.length > 0) {
          return Array.from(new Set(aliases.map((a) => a.toLowerCase())));
        }
      }
    }
  } catch (err) {
    console.error("fetchUserTaskAliases failed", err);
  }
  return fallbackAliases(normalized).map((a) => a.toLowerCase());
}

/**
 * Task.person 값이 사용자의 alias 중 하나에 매칭되는지 확인.
 * - person 이 "홍길동,김철수" 처럼 콤마로 다중 담당자일 수 있으니 split 처리.
 * - alias 가 0건이면 항상 false 반환 (안전).
 */
export function personMatchesAliases(
  person: string | undefined,
  aliases: string[],
): boolean {
  if (!aliases.length) return false;
  const p = (person ?? "").trim().toLowerCase();
  if (!p) return false;
  const tokens = p
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return aliases.some((rawAlias) => {
    const alias = rawAlias.trim().toLowerCase();
    if (!alias) return false;
    return tokens.includes(alias) || p.includes(alias);
  });
}
