import { NextResponse } from "next/server";

import {
  fetchEmails,
  type ImapConfig,
} from "@/lib/daily-report/imap-client";
import { hasPagePermission } from "@/lib/daily-report/server-permissions";

interface FetchPreviewBody {
  actorEmail: string;
  imap: ImapConfig;
  limit?: number;
  unreadOnly?: boolean;
  since?: string;
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: FetchPreviewBody;
  try {
    body = (await request.json()) as FetchPreviewBody;
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
  if (!body.imap?.host || !body.imap?.user) {
    return NextResponse.json(
      { error: "imap.host와 imap.user가 필요합니다." },
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
    const emails = await fetchEmails({
      config: body.imap,
      limit: body.limit,
      unreadOnly: body.unreadOnly,
      since: body.since ? new Date(body.since) : undefined,
    });
    return NextResponse.json({ emails });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "IMAP 수집 실패",
      },
      { status: 500 },
    );
  }
}
