import { NextResponse } from "next/server";

import { fetchProjectsWithTasks as fetchStrategyProjects } from "@/lib/firestore-service";
import { fetchProjectsWithTasks as fetchFaProjects } from "@/lib/firestore-service-fa";
import { fetchProjectsWithTasks as fetchIctProjects } from "@/lib/firestore-service-ict";

import { runWbsAgent } from "@/lib/daily-report/wbs-agent";
import { buildSlimSnapshot } from "@/lib/daily-report/wbs-snapshot";
import { hasPagePermission } from "@/lib/daily-report/server-permissions";
import { fetchUserOpenAiApiKey } from "@/lib/daily-report/server-secrets";
import {
  getOrCreateActiveRunId,
  mergeIntoRun,
} from "@/lib/daily-report/server-runs";
import { fetchUserTaskAliases } from "@/lib/daily-report/server-aliases";

interface WbsRequest {
  actorEmail: string;
  runId?: string;
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: WbsRequest;
  try {
    body = (await request.json()) as WbsRequest;
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

  try {
    const [strategy, fa, ict] = await Promise.all([
      fetchStrategyProjects(),
      fetchFaProjects(),
      fetchIctProjects(),
    ]);
    const todayIso = new Date().toISOString().slice(0, 10);
    const aliases = await fetchUserTaskAliases(actorEmail);
    const snapshot = buildSlimSnapshot(todayIso, strategy, fa, ict, {
      aliases,
    });
    const apiKey = await fetchUserOpenAiApiKey(actorEmail);
    const result = await runWbsAgent({
      todayIso,
      ownerEmail: actorEmail,
      snapshot,
      apiKey,
    });

    const runId =
      body.runId?.trim() || (await getOrCreateActiveRunId(actorEmail)).id;
    const persisted = await mergeIntoRun({
      runId,
      ownerEmail: actorEmail,
      source: "wbs",
      items: result.items,
    });

    return NextResponse.json({
      runId: persisted.id,
      source: "wbs",
      items: result.items,
      stats: {
        projects: snapshot.totals.projects,
        tasks: snapshot.totals.tasks,
        truncated: snapshot.totals.truncated,
        aliasFiltered: snapshot.totals.aliasFiltered,
        aliasCount: snapshot.totals.aliases.length,
        items: result.items.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "WBS 에이전트 실행 실패",
      },
      { status: 500 },
    );
  }
}
