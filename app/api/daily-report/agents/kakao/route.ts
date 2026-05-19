import { NextResponse } from "next/server";

import { runKakaoAgent } from "@/lib/daily-report/kakao-agent";
import { parseKakaoText } from "@/lib/daily-report/kakao-parser";
import { buildSlimKakaoSnapshot } from "@/lib/daily-report/kakao-slim";
import { fetchUserTaskAliases } from "@/lib/daily-report/server-aliases";
import { hasPagePermission } from "@/lib/daily-report/server-permissions";
import { fetchUserOpenAiApiKey } from "@/lib/daily-report/server-secrets";
import {
  getOrCreateActiveRunId,
  mergeIntoRun,
} from "@/lib/daily-report/server-runs";

export const runtime = "nodejs";
export const maxDuration = 60;

interface KakaoPayload {
  actorEmail: string;
  runId?: string;
  options?: {
    windowDays?: number;
    maxGroups?: number;
  };
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "multipart/form-data 본문이 필요합니다." },
      { status: 400 },
    );
  }

  const payloadRaw = formData.get("payload");
  if (typeof payloadRaw !== "string") {
    return NextResponse.json(
      { error: "payload 필드가 누락되었습니다." },
      { status: 400 },
    );
  }
  let payload: KakaoPayload;
  try {
    payload = JSON.parse(payloadRaw) as KakaoPayload;
  } catch {
    return NextResponse.json(
      { error: "payload JSON 파싱 실패." },
      { status: 400 },
    );
  }
  const actorEmail = (payload.actorEmail || "").trim();
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

  const kakaoFile = formData.get("kakaoFile");
  if (!(kakaoFile instanceof File) || kakaoFile.size === 0) {
    return NextResponse.json(
      { error: "카카오톡 txt 파일이 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const raw = await kakaoFile.text();
    const messages = parseKakaoText(raw);
    const todayIso = new Date().toISOString().slice(0, 10);
    const aliases = await fetchUserTaskAliases(actorEmail);
    const snapshot = buildSlimKakaoSnapshot(messages, todayIso, {
      aliases,
      windowDays: payload.options?.windowDays,
      maxGroups: payload.options?.maxGroups,
    });

    const apiKey = await fetchUserOpenAiApiKey(actorEmail);
    const result = await runKakaoAgent({
      todayIso,
      ownerEmail: actorEmail,
      snapshot,
      apiKey,
    });

    const runId =
      payload.runId?.trim() ||
      (await getOrCreateActiveRunId(actorEmail)).id;
    const persisted = await mergeIntoRun({
      runId,
      ownerEmail: actorEmail,
      source: "kakao",
      items: result.items,
    });

    return NextResponse.json({
      runId: persisted.id,
      source: "kakao",
      items: result.items,
      stats: {
        messages: snapshot.totals.kept,
        items: result.items.length,
        totals: snapshot.totals,
        participants: snapshot.participants,
        selfName: snapshot.selfName,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "카카오 에이전트 실행 실패",
      },
      { status: 500 },
    );
  }
}
