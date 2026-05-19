import { NextResponse } from "next/server";

import { hasPagePermission } from "@/lib/daily-report/server-permissions";
import {
  deleteUserImapConfig,
  fetchUserImapConfig,
  maskImapConfig,
  saveUserImapConfig,
  type StoredImapConfig,
} from "@/lib/daily-report/server-imap-config";

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
        { error: "actorEmail 이 필요합니다." },
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
  const cfg = await fetchUserImapConfig(auth.actorEmail);
  return NextResponse.json({ config: maskImapConfig(cfg) });
}

export async function POST(request: Request) {
  let body: { actorEmail?: string; config?: Partial<StoredImapConfig> };
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
  if (!body.config || typeof body.config !== "object") {
    return NextResponse.json(
      { error: "config 본문이 필요합니다." },
      { status: 400 },
    );
  }
  try {
    const saved = await saveUserImapConfig(auth.actorEmail, body.config);
    return NextResponse.json({ config: maskImapConfig(saved) });
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
    await deleteUserImapConfig(auth.actorEmail);
    return NextResponse.json({ config: maskImapConfig(null) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "삭제 실패" },
      { status: 500 },
    );
  }
}
