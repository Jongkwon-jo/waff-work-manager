import { NextResponse } from "next/server";

import { fetchProjectsWithTasks as fetchStrategyProjects } from "@/lib/firestore-service";
import { fetchProjectsWithTasks as fetchFaProjects } from "@/lib/firestore-service-fa";
import { fetchProjectsWithTasks as fetchIctProjects } from "@/lib/firestore-service-ict";

import { runEmailAgent } from "@/lib/daily-report/email-agent";
import { runKakaoAgent } from "@/lib/daily-report/kakao-agent";
import { runOrchestrator } from "@/lib/daily-report/orchestrator";
import { runWbsAgent } from "@/lib/daily-report/wbs-agent";
import {
  fetchEmails,
  type EmailMessage,
  type ImapConfig,
} from "@/lib/daily-report/imap-client";
import { parseKakaoText } from "@/lib/daily-report/kakao-parser";
import {
  computeSectionStats,
  type AgentRunStatus,
  type DailyReportError,
  type DailyReportItem,
  type DailyReportRun,
} from "@/lib/daily-report/schemas";
import { hasPagePermission } from "@/lib/daily-report/server-permissions";
import { fetchUserOpenAiApiKey } from "@/lib/daily-report/server-secrets";
import {
  getOrCreateActiveRunId,
  mergeIntoRun,
} from "@/lib/daily-report/server-runs";
import { fetchUserTaskAliases } from "@/lib/daily-report/server-aliases";
import { fetchUserImapConfig } from "@/lib/daily-report/server-imap-config";
import {
  buildSlimKakaoSnapshot,
  type SlimKakaoSnapshot,
} from "@/lib/daily-report/kakao-slim";
import {
  buildSlimSnapshot,
  type SlimSnapshot,
} from "@/lib/daily-report/wbs-snapshot";
import { createSSEResponse } from "@/lib/daily-report/streaming";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface RunPayload {
  actorEmail: string;
  runId?: string;
  imap?: ImapConfig & {
    limit?: number;
    unreadOnly?: boolean;
    since?: string;
  };
  kakaoOptions?: {
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
  let payload: RunPayload;
  try {
    payload = JSON.parse(payloadRaw) as RunPayload;
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
  const kakaoRaw =
    kakaoFile instanceof File && kakaoFile.size > 0
      ? await kakaoFile.text()
      : "";

  const imap = payload.imap;

  return createSSEResponse(async (sse) => {
    const runId =
      payload.runId?.trim() ||
      (await getOrCreateActiveRunId(actorEmail)).id;
    const todayIso = new Date().toISOString().slice(0, 10);
    const errors: DailyReportError[] = [];
    const apiKey = await fetchUserOpenAiApiKey(actorEmail);

    const aliases = await fetchUserTaskAliases(actorEmail);
    let wbsSnapshot: SlimSnapshot | null = null;
    try {
      const [strategy, fa, ict] = await Promise.all([
        fetchStrategyProjects(),
        fetchFaProjects(),
        fetchIctProjects(),
      ]);
      wbsSnapshot = buildSlimSnapshot(todayIso, strategy, fa, ict, {
        aliases,
      });
      sse.send({
        phase: "wbs_loaded",
        source: "wbs",
        stats: { count: wbsSnapshot.totals.tasks },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ source: "wbs", message });
      sse.send({ phase: "agent_failed", source: "wbs", message });
    }

    const stored = await fetchUserImapConfig(actorEmail);
    const host = imap?.host?.trim() || stored?.host || "";
    const user = imap?.user?.trim() || stored?.user || "";
    const password =
      imap?.password && imap.password.length > 0
        ? imap.password
        : stored?.password || "";

    let emails: EmailMessage[] = [];
    if (host && user && password) {
      try {
        emails = await fetchEmails({
          config: {
            host,
            port:
              typeof imap?.port === "number" && imap.port > 0
                ? imap.port
                : stored?.port ?? 993,
            secure:
              typeof imap?.secure === "boolean"
                ? imap.secure
                : stored?.secure ?? true,
            user,
            password,
            mailbox: imap?.mailbox?.trim() || stored?.mailbox || "INBOX",
          },
          limit:
            typeof imap?.limit === "number" && imap.limit > 0
              ? imap.limit
              : stored?.limit ?? 20,
          unreadOnly:
            typeof imap?.unreadOnly === "boolean"
              ? imap.unreadOnly
              : stored?.unreadOnly ?? false,
          since:
            (imap?.since || stored?.since)
              ? new Date(imap?.since || stored?.since || "")
              : undefined,
        });
        sse.send({
          phase: "email_fetched",
          source: "email",
          stats: { count: emails.length },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ source: "email", message });
        sse.send({ phase: "agent_failed", source: "email", message });
      }
    } else if (host || user || password) {
      const message =
        "IMAP 설정이 부족합니다. 설정에서 host/user/비밀번호를 모두 등록해주세요.";
      errors.push({ source: "email", message });
      sse.send({ phase: "agent_failed", source: "email", message });
    }

    let kakaoSnapshot: SlimKakaoSnapshot | null = null;
    if (kakaoRaw) {
      const rawMessages = parseKakaoText(kakaoRaw);
      kakaoSnapshot = buildSlimKakaoSnapshot(rawMessages, todayIso, {
        aliases,
        windowDays: payload.kakaoOptions?.windowDays,
        maxGroups: payload.kakaoOptions?.maxGroups,
      });
      sse.send({
        phase: "kakao_parsed",
        source: "kakao",
        stats: { count: kakaoSnapshot.totals.kept },
      });
    }

    sse.send({ phase: "agent_started" });

    const agentResults = await Promise.allSettled([
      wbsSnapshot
        ? runWbsAgent({
            todayIso,
            ownerEmail: actorEmail,
            snapshot: wbsSnapshot,
            apiKey,
          })
        : Promise.resolve({ items: [] as DailyReportItem[] }),
      emails.length > 0
        ? runEmailAgent({
            todayIso,
            ownerEmail: actorEmail,
            emails,
            apiKey,
          })
        : Promise.resolve({ items: [] as DailyReportItem[] }),
      kakaoSnapshot && kakaoSnapshot.messages.length > 0
        ? runKakaoAgent({
            todayIso,
            ownerEmail: actorEmail,
            snapshot: kakaoSnapshot,
            apiKey,
          })
        : Promise.resolve({ items: [] as DailyReportItem[] }),
    ]);

    const sources = ["wbs", "email", "kakao"] as const;
    const candidates: DailyReportItem[] = [];
    for (let i = 0; i < agentResults.length; i += 1) {
      const result = agentResults[i];
      const source = sources[i];
      if (result.status === "fulfilled") {
        candidates.push(...result.value.items);
        sse.send({
          phase: "agent_done",
          source,
          items: result.value.items,
          stats: { count: result.value.items.length },
        });
        try {
          await mergeIntoRun({
            runId,
            ownerEmail: actorEmail,
            source,
            items: result.value.items,
          });
        } catch (persistErr) {
          console.error(`run: specialist ${source} persist failed`, persistErr);
        }
      } else {
        const message =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        errors.push({ source, message });
        sse.send({ phase: "agent_failed", source, message });
      }
    }

    let finalItems: DailyReportItem[] = candidates;
    try {
      finalItems = await runOrchestrator({
        todayIso,
        ownerEmail: actorEmail,
        candidates,
        apiKey,
      });
      sse.send({
        phase: "orchestrator_done",
        source: "orchestrator",
        stats: { count: finalItems.length },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ source: "orchestrator", message });
      sse.send({ phase: "agent_failed", source: "orchestrator", message });
    }

    const status: AgentRunStatus =
      errors.length === 0
        ? "succeeded"
        : finalItems.length > 0
          ? "partial"
          : "failed";

    let run: DailyReportRun;
    try {
      run = await mergeIntoRun({
        runId,
        ownerEmail: actorEmail,
        items: finalItems, // source 없음 → 전체 교체
        appendErrors: errors,
        status,
      });
    } catch (persistErr) {
      console.error("dailyReportRuns final persist failed", persistErr);
      run = {
        id: runId,
        requestedAt: new Date().toISOString(),
        requestedBy: actorEmail,
        status,
        items: finalItems,
        errors,
        sectionStats: computeSectionStats(finalItems),
      };
    }

    sse.send({ phase: "done", run });
  });
}
