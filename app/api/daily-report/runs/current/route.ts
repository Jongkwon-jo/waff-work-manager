import { NextResponse } from "next/server";

import { hasPagePermission } from "@/lib/daily-report/server-permissions";
import { getOrCreateActiveRunId } from "@/lib/daily-report/server-runs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const actorEmail = (
    new URL(request.url).searchParams.get("actorEmail") || ""
  ).trim();
  if (!actorEmail) {
    return NextResponse.json(
      { error: "actorEmail 이 필요합니다." },
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
  try {
    const run = await getOrCreateActiveRunId(actorEmail);
    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "active run 조회 실패" },
      { status: 500 },
    );
  }
}
