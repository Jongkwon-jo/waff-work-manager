import { NextResponse } from "next/server";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { normalizeEmail } from "@/lib/page-access";

import { hasPagePermission } from "@/lib/daily-report/server-permissions";

interface DismissBody {
  actorEmail: string;
  runId: string;
  itemId: string;
}

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  let body: DismissBody;
  try {
    body = (await request.json()) as DismissBody;
  } catch {
    return NextResponse.json(
      { error: "JSON 본문이 필요합니다." },
      { status: 400 },
    );
  }
  const actorEmail = (body.actorEmail || "").trim();
  if (!actorEmail || !body.runId || !body.itemId) {
    return NextResponse.json(
      { error: "actorEmail, runId, itemId가 필요합니다." },
      { status: 400 },
    );
  }
  const allowed = await hasPagePermission(actorEmail, "dailyReport");
  if (!allowed) {
    return NextResponse.json(
      { error: "Daily Report 권한이 없습니다." },
      { status: 403 },
    );
  }

  await setDoc(
    doc(db, "dailyReportDismissed", `${body.runId}_${body.itemId}`),
    {
      runId: body.runId,
      itemId: body.itemId,
      actorEmail: normalizeEmail(actorEmail),
      dismissedAt: serverTimestamp(),
    },
  );
  return NextResponse.json({ success: true });
}
