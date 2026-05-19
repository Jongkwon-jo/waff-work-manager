import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  normalizePermissions,
  permissionDocId,
  type PagePermissionKey,
} from "@/lib/page-access";

export async function hasPagePermission(
  email: string,
  key: PagePermissionKey,
): Promise<boolean> {
  const normalized = email.trim();
  if (!normalized) return false;
  try {
    const snap = await getDoc(
      doc(db, "user_page_permissions", permissionDocId(normalized)),
    );
    const raw = snap.exists()
      ? (snap.data() as Partial<Record<string, unknown>>)
      : undefined;
    const perms = normalizePermissions(raw);
    return perms[key] === true;
  } catch (err) {
    console.error(`hasPagePermission(${key}) failed`, err);
    return false;
  }
}
