import { NextResponse } from "next/server";

import { runOrchestrator } from "@/lib/daily-report/orchestrator";
import { hasPagePermission } from "@/lib/daily-report/server-permissions";
import { fetchUserOpenAiApiKey } from "@/lib/daily-report/server-secrets";
import {
  getOrCreateActiveRunId,
  mergeIntoRun,
  sanitizeCandidates,
} from "@/lib/daily-report/server-runs";

interface OrchestratorRequest {
  actorEmail: string;
  candidates: unknown;
  runId?: string;
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: OrchestratorRequest;
  try {
    body = (await request.json()) as OrchestratorRequest;
  } catch {
    return NextResponse.json(
      { error: "JSON 본문이 필요합니다." },
      { status: 400 },
    );
  }
  const actorEmail = (body.actorEmail || "").trim();
  if (!actorEmail) {
    return NextResponse.json(
      { error: "actorEmail이 필요합니다." },
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

  const parsed = sanitizeCandidates(body.candidates);
  if (parsed.length === 0) {
    return NextResponse.json(
      { error: "유효한 candidates가 없습니다." },
      { status: 400 },
    );
  }

  try {
    const todayIso = new Date().toISOString().slice(0, 10);
    const apiKey = await fetchUserOpenAiApiKey(actorEmail);
    const items = await runOrchestrator({
      todayIso,
      ownerEmail: actorEmail,
      candidates: parsed,
      apiKey,
    });

    const runId =
      body.runId?.trim() || (await getOrCreateActiveRunId(actorEmail)).id;
    const run = await mergeIntoRun({
      runId,
      ownerEmail: actorEmail,
      items, // source 없음 → 전체 교체
      status: "succeeded",
    });

    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "오케스트레이터 실행 실패",
      },
      { status: 500 },
    );
  }
}
