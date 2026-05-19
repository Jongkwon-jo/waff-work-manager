import { NextResponse } from "next/server";

import { runEmailAgent } from "@/lib/daily-report/email-agent";
import {
  fetchEmails,
  type ImapConfig,
} from "@/lib/daily-report/imap-client";
import { hasPagePermission } from "@/lib/daily-report/server-permissions";
import { fetchUserOpenAiApiKey } from "@/lib/daily-report/server-secrets";
import {
  getOrCreateActiveRunId,
  mergeIntoRun,
} from "@/lib/daily-report/server-runs";
import { fetchUserImapConfig } from "@/lib/daily-report/server-imap-config";

interface EmailAgentRequest {
  actorEmail: string;
  runId?: string;
  imap: ImapConfig & {
    limit?: number;
    unreadOnly?: boolean;
    since?: string;
  };
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: EmailAgentRequest;
  try {
    body = (await request.json()) as EmailAgentRequest;
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

  // 저장된 IMAP 설정과 body 값을 병합 (body가 우선, 빈 값은 저장값으로 보강)
  const stored = await fetchUserImapConfig(actorEmail);
  const host = body.imap?.host?.trim() || stored?.host || "";
  const user = body.imap?.user?.trim() || stored?.user || "";
  const password =
    body.imap?.password && body.imap.password.length > 0
      ? body.imap.password
      : stored?.password || "";
  if (!host || !user) {
    return NextResponse.json(
      { error: "imap.host와 imap.user가 필요합니다. 설정에서 등록해주세요." },
      { status: 400 },
    );
  }
  if (!password) {
    return NextResponse.json(
      { error: "IMAP 비밀번호가 비어 있습니다. 설정에서 저장해주세요." },
      { status: 400 },
    );
  }
  const mergedImap = {
    host,
    port:
      typeof body.imap?.port === "number" && body.imap.port > 0
        ? body.imap.port
        : stored?.port ?? 993,
    secure:
      typeof body.imap?.secure === "boolean"
        ? body.imap.secure
        : stored?.secure ?? true,
    user,
    password,
    mailbox: body.imap?.mailbox?.trim() || stored?.mailbox || "INBOX",
  };
  const mergedLimit =
    typeof body.imap?.limit === "number" && body.imap.limit > 0
      ? body.imap.limit
      : stored?.limit ?? 20;
  const mergedUnreadOnly =
    typeof body.imap?.unreadOnly === "boolean"
      ? body.imap.unreadOnly
      : stored?.unreadOnly ?? false;
  const mergedSince =
    body.imap?.since || stored?.since || "";

  try {
    const emails = await fetchEmails({
      config: mergedImap,
      limit: mergedLimit,
      unreadOnly: mergedUnreadOnly,
      since: mergedSince ? new Date(mergedSince) : undefined,
    });
    const todayIso = new Date().toISOString().slice(0, 10);
    const apiKey = await fetchUserOpenAiApiKey(actorEmail);
    const result = await runEmailAgent({
      todayIso,
      ownerEmail: actorEmail,
      emails,
      apiKey,
    });

    const runId =
      body.runId?.trim() || (await getOrCreateActiveRunId(actorEmail)).id;
    const persisted = await mergeIntoRun({
      runId,
      ownerEmail: actorEmail,
      source: "email",
      items: result.items,
    });

    return NextResponse.json({
      runId: persisted.id,
      source: "email",
      items: result.items,
      stats: { emails: emails.length, items: result.items.length },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "이메일 에이전트 실행 실패",
      },
      { status: 500 },
    );
  }
}
