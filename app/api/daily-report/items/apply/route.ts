import { NextResponse } from "next/server";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  saveMyPagePersonalTasks,
  type MyPagePersonalTask,
} from "@/lib/firestore-service";
import { normalizeEmail, permissionDocId } from "@/lib/page-access";

import type { DailyReportItem } from "@/lib/daily-report/schemas";
import { hasPagePermission } from "@/lib/daily-report/server-permissions";

interface ApplyBody {
  actorEmail: string;
  runId: string;
  item: DailyReportItem;
}

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: ApplyBody;
  try {
    body = (await request.json()) as ApplyBody;
  } catch {
    return NextResponse.json(
      { error: "JSON 본문이 필요합니다." },
      { status: 400 },
    );
  }
  const actorEmail = (body.actorEmail || "").trim();
  if (!actorEmail || !body.runId || !body.item?.id) {
    return NextResponse.json(
      { error: "actorEmail, runId, item.id가 필요합니다." },
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

  const markerId = `${body.runId}_${body.item.id}`;
  const markerRef = doc(db, "dailyReportApplied", markerId);
  const markerSnap = await getDoc(markerRef);
  if (markerSnap.exists()) {
    return NextResponse.json(
      { error: "이미 반영된 항목입니다." },
      { status: 409 },
    );
  }

  const normalizedEmail = normalizeEmail(actorEmail);
  const profileSnap = await getDoc(
    doc(db, "user_profiles", permissionDocId(normalizedEmail)),
  );
  const profileData = profileSnap.exists()
    ? (profileSnap.data() as { myPagePersonalTasks?: unknown })
    : null;
  const existing: MyPagePersonalTask[] = Array.isArray(
    profileData?.myPagePersonalTasks,
  )
    ? (profileData!.myPagePersonalTasks as MyPagePersonalTask[])
    : [];

  const now = Date.now();
  const memoParts = [body.item.summary, body.item.suggestedAction].filter(
    (s) => typeof s === "string" && s.trim().length > 0,
  );
  const newTask: MyPagePersonalTask = {
    id: `daily-${body.runId}-${body.item.id}-${now}`,
    title: body.item.title,
    memo: memoParts.join("\n\n"),
    startDate: body.item.dueDate || undefined,
    endDate: body.item.dueDate || undefined,
    checked: false,
    priority: body.item.priority,
    important: body.item.priority === "high",
    order: existing.length,
    createdAt: now,
    updatedAt: now,
  };

  await saveMyPagePersonalTasks(actorEmail, [...existing, newTask]);
  await setDoc(markerRef, {
    runId: body.runId,
    itemId: body.item.id,
    actorEmail: normalizedEmail,
    appliedTaskId: newTask.id,
    appliedAt: serverTimestamp(),
  });

  return NextResponse.json({ appliedTaskId: newTask.id });
}
