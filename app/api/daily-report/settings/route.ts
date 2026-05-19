import { NextResponse } from "next/server";

import {
  deleteUserOpenAiApiKey,
  fetchUserOpenAiApiKey,
  maskApiKey,
  saveUserOpenAiApiKey,
} from "@/lib/daily-report/server-secrets";
import { hasPagePermission } from "@/lib/daily-report/server-permissions";

export const runtime = "nodejs";

const ensureAllowed = async (
  request: Request,
  bodyEmail?: string,
): Promise<{ ok: true; actorEmail: string } | { ok: false; res: Response }> => {
  const fromQuery = new URL(request.url).searchParams.get("actorEmail") || "";
  const actorEmail = (bodyEmail || fromQuery).trim();
  if (!actorEmail) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "actorEmail이 필요합니다." },
        { status: 400 },
      ),
    };
  }
  const allowed = await hasPagePermission(actorEmail, "dailyReport");
  if (!allowed) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Daily Report 권한이 없습니다." },
        { status: 403 },
      ),
    };
  }
  return { ok: true, actorEmail };
};

export async function GET(request: Request) {
  const auth = await ensureAllowed(request);
  if (!auth.ok) return auth.res;
  const key = await fetchUserOpenAiApiKey(auth.actorEmail);
  return NextResponse.json({
    hasKey: Boolean(key),
    masked: maskApiKey(key),
  });
}

export async function POST(request: Request) {
  let body: { actorEmail?: string; openaiApiKey?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "JSON 본문이 필요합니다." },
      { status: 400 },
    );
  }
  const auth = await ensureAllowed(request, body.actorEmail);
  if (!auth.ok) return auth.res;
  const apiKey = (body.openaiApiKey || "").trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "openaiApiKey가 비어 있습니다." },
      { status: 400 },
    );
  }
  try {
    await saveUserOpenAiApiKey(auth.actorEmail, apiKey);
    return NextResponse.json({
      hasKey: true,
      masked: maskApiKey(apiKey),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "저장 실패" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await ensureAllowed(request);
  if (!auth.ok) return auth.res;
  try {
    await deleteUserOpenAiApiKey(auth.actorEmail);
    return NextResponse.json({ hasKey: false, masked: null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "삭제 실패" },
      { status: 500 },
    );
  }
}
