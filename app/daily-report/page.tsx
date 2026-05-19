"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Home, UserRoundSearch } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import {
  AgentBoard,
  type AgentStatSnapshot,
} from "@/components/daily-report/system-design-panel";
import { SectionList } from "@/components/daily-report/section-list";
import {
  SettingsDialog,
  type ApiKeyState,
  type ImapPayload,
  type ImapStoredState,
  type KakaoOptions,
  type SettingsAgentKey,
} from "@/components/daily-report/settings-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  type DailyReportItem,
  type DailyReportRun,
  type DailyReportSection,
  type DailyReportSource,
  type StreamEvent,
} from "@/lib/daily-report/schemas";
import { readSSE } from "@/lib/daily-report/streaming";

type AgentKey = "wbs" | "email" | "kakao" | "orchestrator";

const DEFAULT_IMAP: ImapPayload = {
  host: "",
  port: 993,
  secure: true,
  user: "",
  password: "",
  mailbox: "INBOX",
  limit: 20,
  unreadOnly: false,
  since: "",
};

const newRunId = () =>
  `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const replaceItemsBySource = (
  prev: DailyReportItem[],
  source: DailyReportSource,
  next: DailyReportItem[],
): DailyReportItem[] => [
  ...prev.filter((it) => it.source !== source),
  ...next,
];

const buildImapForApi = (imap: ImapPayload) => ({
  host: imap.host,
  port: imap.port,
  secure: imap.secure,
  user: imap.user,
  password: imap.password,
  mailbox: imap.mailbox,
  limit: imap.limit,
  unreadOnly: imap.unreadOnly,
  since: imap.since || undefined,
});

export default function DailyReportPage() {
  const { user, isAdmin, pagePermissions } = useAuth();
  const actorEmail = (user?.email || "").trim();
  const canViewMyPage = isAdmin || pagePermissions.myPage;

  const [settingsAgent, setSettingsAgent] = useState<SettingsAgentKey | null>(
    null,
  );
  const [imap, setImap] = useState<ImapPayload>(DEFAULT_IMAP);
  const [kakaoFile, setKakaoFile] = useState<File | null>(null);
  const [kakaoOptions, setKakaoOptions] = useState<KakaoOptions>({
    windowDays: 14,
  });
  const [apiKeyState, setApiKeyState] = useState<ApiKeyState>({
    hasKey: false,
    masked: null,
  });

  useEffect(() => {
    if (!actorEmail) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/daily-report/settings?actorEmail=${encodeURIComponent(actorEmail)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as ApiKeyState;
        if (!cancelled) setApiKeyState(data);
      } catch {
        // ignore — fallback to env on server
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actorEmail]);

  const handleSaveApiKey = useCallback(
    async (key: string) => {
      if (!actorEmail) {
        toast.error("로그인이 필요합니다.");
        return;
      }
      const res = await fetch("/api/daily-report/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail, openaiApiKey: key }),
      });
      const data = (await res.json().catch(() => null)) as
        | (ApiKeyState & { error?: string })
        | null;
      if (!res.ok || !data) {
        toast.error(data?.error || "API key 저장 실패");
        return;
      }
      setApiKeyState({ hasKey: data.hasKey, masked: data.masked });
      toast.success("OpenAI API key를 저장했습니다.");
    },
    [actorEmail],
  );

  const handleDeleteApiKey = useCallback(async () => {
    if (!actorEmail) return;
    const res = await fetch(
      `/api/daily-report/settings?actorEmail=${encodeURIComponent(actorEmail)}`,
      { method: "DELETE" },
    );
    const data = (await res.json().catch(() => null)) as
      | (ApiKeyState & { error?: string })
      | null;
    if (!res.ok || !data) {
      toast.error(data?.error || "API key 삭제 실패");
      return;
    }
    setApiKeyState({ hasKey: data.hasKey, masked: data.masked });
    toast.success("OpenAI API key를 삭제했습니다.");
  }, [actorEmail]);

  const [imapStoredState, setImapStoredState] = useState<ImapStoredState>({
    hasPassword: false,
  });

  useEffect(() => {
    if (!actorEmail) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/daily-report/settings/email?actorEmail=${encodeURIComponent(actorEmail)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          config?: {
            host: string;
            port: number;
            secure: boolean;
            user: string;
            mailbox: string;
            limit: number;
            unreadOnly: boolean;
            since: string;
            hasPassword: boolean;
          };
        };
        if (cancelled || !data.config) return;
        const c = data.config;
        // password 는 응답에 없음 → 폼은 빈 문자열로 유지
        setImap({
          host: c.host,
          port: c.port,
          secure: c.secure,
          user: c.user,
          password: "",
          mailbox: c.mailbox,
          limit: c.limit,
          unreadOnly: c.unreadOnly,
          since: c.since,
        });
        setImapStoredState({ hasPassword: c.hasPassword });
      } catch (err) {
        console.warn("imap config restore failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actorEmail]);

  const handleSaveImapConfig = useCallback(async () => {
    if (!actorEmail) {
      toast.error("로그인이 필요합니다.");
      return;
    }
    const res = await fetch("/api/daily-report/settings/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorEmail,
        config: {
          host: imap.host,
          port: imap.port,
          secure: imap.secure,
          user: imap.user,
          // 빈 password 는 무시되고 기존 값 유지 → 새로 입력했을 때만 덮어쓰기
          password: imap.password,
          mailbox: imap.mailbox,
          limit: imap.limit,
          unreadOnly: imap.unreadOnly,
          since: imap.since,
        },
      }),
    });
    const data = (await res.json().catch(() => null)) as
      | { config?: { hasPassword: boolean }; error?: string }
      | null;
    if (!res.ok || !data?.config) {
      toast.error(data?.error || "IMAP 설정 저장 실패");
      return;
    }
    setImapStoredState({ hasPassword: data.config.hasPassword });
    // 저장 후 폼 password 는 비움 — 저장된 값 사용 표시로 전환
    if (imap.password.length > 0) {
      setImap((prev) => ({ ...prev, password: "" }));
    }
    toast.success("IMAP 설정을 계정에 저장했습니다.");
  }, [actorEmail, imap]);

  const handleDeleteImapConfig = useCallback(async () => {
    if (!actorEmail) return;
    const res = await fetch(
      `/api/daily-report/settings/email?actorEmail=${encodeURIComponent(actorEmail)}`,
      { method: "DELETE" },
    );
    const data = (await res.json().catch(() => null)) as
      | { config?: { hasPassword: boolean }; error?: string }
      | null;
    if (!res.ok || !data?.config) {
      toast.error(data?.error || "IMAP 설정 삭제 실패");
      return;
    }
    setImapStoredState({ hasPassword: false });
    toast.success("저장된 IMAP 설정을 삭제했습니다.");
  }, [actorEmail]);

  const [runId, setRunId] = useState<string>(() => newRunId());
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [items, setItems] = useState<DailyReportItem[]>([]);
  const [run, setRun] = useState<DailyReportRun | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  // 페이지 마운트 시 사용자의 활성 run 복원
  useEffect(() => {
    if (!actorEmail) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/daily-report/runs/current?actorEmail=${encodeURIComponent(actorEmail)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { run?: DailyReportRun };
        if (cancelled || !data.run) return;
        setRunId(data.run.id);
        setRun(data.run);
        setItems(data.run.items);
        if (data.run.items.length > 0) {
          // source별 마지막 실행 stats 복원 (대략적 — ranAt은 알 수 없으니 현재 시각으로 대체)
          const now = Date.now();
          const bySource = {
            wbs: data.run.items.filter((it) => it.source === "wbs").length,
            email: data.run.items.filter((it) => it.source === "email").length,
            kakao: data.run.items.filter((it) => it.source === "kakao").length,
            orchestrator: data.run.items.length,
          };
          setAgentStats({
            wbs: bySource.wbs > 0 ? { items: bySource.wbs, ranAt: now } : undefined,
            email:
              bySource.email > 0 ? { items: bySource.email, ranAt: now } : undefined,
            kakao:
              bySource.kakao > 0 ? { items: bySource.kakao, ranAt: now } : undefined,
            orchestrator:
              data.run.status === "succeeded" || data.run.status === "partial"
                ? { items: bySource.orchestrator, ranAt: now }
                : undefined,
          });
        }
      } catch (err) {
        console.warn("active run restore failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actorEmail]);

  const [viewFilter, setViewFilter] = useState<DailyReportSource | null>(null);
  const [agentBusy, setAgentBusy] = useState<Record<AgentKey, boolean>>({
    wbs: false,
    email: false,
    kakao: false,
    orchestrator: false,
  });
  const [agentStats, setAgentStats] = useState<
    Partial<Record<AgentKey, AgentStatSnapshot>>
  >({});

  const setBusy = (key: AgentKey, value: boolean) =>
    setAgentBusy((prev) => ({ ...prev, [key]: value }));

  const setStat = (key: AgentKey, stat: AgentStatSnapshot) =>
    setAgentStats((prev) => ({ ...prev, [key]: stat }));

  const handleRunWbs = useCallback(async () => {
    if (!actorEmail) {
      toast.error("로그인이 필요합니다.");
      return;
    }
    setBusy("wbs", true);
    try {
      const res = await fetch("/api/daily-report/agents/wbs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail, runId }),
      });
      const data = (await res.json()) as {
        runId?: string;
        items?: DailyReportItem[];
        error?: string;
      };
      if (!res.ok || !data.items) {
        throw new Error(data.error || "WBS 실행 실패");
      }
      if (data.runId && data.runId !== runId) setRunId(data.runId);
      setItems((prev) => replaceItemsBySource(prev, "wbs", data.items!));
      setStat("wbs", { items: data.items.length, ranAt: Date.now() });
      toast.success(`WBS 분석 완료 · ${data.items.length}건`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "WBS 실행 실패";
      setStat("wbs", { items: 0, ranAt: Date.now(), message });
      toast.error(message);
    } finally {
      setBusy("wbs", false);
    }
  }, [actorEmail, runId]);

  const handleRunEmail = useCallback(async () => {
    if (!actorEmail) {
      toast.error("로그인이 필요합니다.");
      return;
    }
    setBusy("email", true);
    try {
      const res = await fetch("/api/daily-report/agents/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorEmail,
          runId,
          imap: buildImapForApi(imap),
        }),
      });
      const data = (await res.json()) as {
        runId?: string;
        items?: DailyReportItem[];
        error?: string;
      };
      if (!res.ok || !data.items) {
        throw new Error(data.error || "Email 실행 실패");
      }
      if (data.runId && data.runId !== runId) setRunId(data.runId);
      setItems((prev) => replaceItemsBySource(prev, "email", data.items!));
      setStat("email", { items: data.items.length, ranAt: Date.now() });
      toast.success(`Email 분석 완료 · ${data.items.length}건`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Email 실행 실패";
      setStat("email", { items: 0, ranAt: Date.now(), message });
      toast.error(message);
    } finally {
      setBusy("email", false);
    }
  }, [actorEmail, imap, runId]);

  const handleRunKakao = useCallback(async () => {
    if (!actorEmail) {
      toast.error("로그인이 필요합니다.");
      return;
    }
    if (!kakaoFile) {
      toast.error("카카오톡 .txt 파일을 설정에서 선택해주세요.");
      return;
    }
    setBusy("kakao", true);
    try {
      const fd = new FormData();
      fd.append(
        "payload",
        JSON.stringify({
          actorEmail,
          runId,
          options: { windowDays: kakaoOptions.windowDays },
        }),
      );
      fd.append("kakaoFile", kakaoFile);
      const res = await fetch("/api/daily-report/agents/kakao", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        runId?: string;
        items?: DailyReportItem[];
        error?: string;
      };
      if (!res.ok || !data.items) {
        throw new Error(data.error || "Kakao 실행 실패");
      }
      if (data.runId && data.runId !== runId) setRunId(data.runId);
      setItems((prev) => replaceItemsBySource(prev, "kakao", data.items!));
      setStat("kakao", { items: data.items.length, ranAt: Date.now() });
      toast.success(`Kakao 분석 완료 · ${data.items.length}건`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Kakao 실행 실패";
      setStat("kakao", { items: 0, ranAt: Date.now(), message });
      toast.error(message);
    } finally {
      setBusy("kakao", false);
    }
  }, [actorEmail, kakaoFile, kakaoOptions.windowDays, runId]);

  const handleRunOrchestrator = useCallback(async () => {
    if (!actorEmail) {
      toast.error("로그인이 필요합니다.");
      return;
    }
    if (items.length === 0) {
      toast.error("정리할 항목이 없습니다.");
      return;
    }
    setBusy("orchestrator", true);
    try {
      const res = await fetch("/api/daily-report/orchestrator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorEmail, runId, candidates: items }),
      });
      const data = (await res.json()) as {
        run?: DailyReportRun;
        error?: string;
      };
      if (!res.ok || !data.run) {
        throw new Error(data.error || "Orchestrator 실행 실패");
      }
      setRun(data.run);
      setItems(data.run.items);
      setStat("orchestrator", {
        items: data.run.items.length,
        ranAt: Date.now(),
      });
      toast.success(`Orchestrator 적용 · ${data.run.items.length}건`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Orchestrator 실행 실패";
      setStat("orchestrator", { items: 0, ranAt: Date.now(), message });
      toast.error(message);
    } finally {
      setBusy("orchestrator", false);
    }
  }, [actorEmail, items, runId]);

  const handleRunAll = useCallback(async () => {
    if (!actorEmail) {
      toast.error("로그인이 필요합니다.");
      return;
    }
    setRunning(true);
    setEvents([]);
    setItems([]);
    setRun(null);
    setAppliedIds(new Set());
    setDismissedIds(new Set());

    const fd = new FormData();
    fd.append(
      "payload",
      JSON.stringify({
        actorEmail,
        runId,
        imap: buildImapForApi(imap),
        kakaoOptions: { windowDays: kakaoOptions.windowDays },
      }),
    );
    if (kakaoFile) fd.append("kakaoFile", kakaoFile);

    try {
      const res = await fetch("/api/daily-report/run", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const text = await res.text();
        toast.error(`실행 실패: ${text || res.statusText}`);
        setRunning(false);
        return;
      }

      for await (const event of readSSE(res)) {
        setEvents((prev) => [...prev, event]);
        if (event.phase === "agent_done" && event.items && event.source) {
          const evtItems = event.items;
          const evtSource = event.source;
          setItems((prev) => replaceItemsBySource(prev, evtSource, evtItems));
          if (
            evtSource === "wbs" ||
            evtSource === "email" ||
            evtSource === "kakao"
          ) {
            setStat(evtSource, {
              items: evtItems.length,
              ranAt: Date.now(),
            });
          }
        }
        if (event.phase === "orchestrator_done" || event.phase === "done") {
          if (event.run) {
            setRun(event.run);
            setRunId(event.run.id);
            setItems(event.run.items);
            setStat("orchestrator", {
              items: event.run.items.length,
              ranAt: Date.now(),
            });
          }
        }
        if (event.phase === "error" || event.phase === "agent_failed") {
          if (event.message) toast.error(event.message);
        }
      }
      toast.success("Daily Report 전체 분석 완료");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setRunning(false);
    }
  }, [actorEmail, imap, kakaoFile, kakaoOptions.windowDays, runId]);

  const handleMoveItem = useCallback(
    (itemId: string, section: DailyReportSection) => {
      setItems((prev) =>
        prev.map((it) => (it.id === itemId ? { ...it, section } : it)),
      );
    },
    [],
  );

  const handleApply = useCallback(
    async (item: DailyReportItem) => {
      if (!actorEmail) return;
      setBusyItemId(item.id);
      try {
        const res = await fetch("/api/daily-report/items/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorEmail,
            runId,
            item,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(data?.error || res.statusText);
        }
        setAppliedIds((prev) => new Set(prev).add(item.id));
        toast.success("내 업무에 추가했습니다.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "반영 실패");
      } finally {
        setBusyItemId(null);
      }
    },
    [actorEmail, runId],
  );

  const handleDismiss = useCallback(
    async (item: DailyReportItem) => {
      if (!actorEmail) return;
      setBusyItemId(item.id);
      try {
        const res = await fetch("/api/daily-report/items/dismiss", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorEmail,
            runId,
            itemId: item.id,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(data?.error || res.statusText);
        }
        setDismissedIds((prev) => new Set(prev).add(item.id));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "제외 실패");
      } finally {
        setBusyItemId(null);
      }
    },
    [actorEmail, runId],
  );

  const emailReady = Boolean(imap.host && imap.user);
  const kakaoReady = Boolean(kakaoFile);

  const filteredItems = viewFilter
    ? items.filter((it) => it.source === viewFilter)
    : items;

  const filterLabel: Record<DailyReportSource, string> = {
    wbs: "WBS",
    email: "Email",
    kakao: "Kakao",
    orchestrator: "Orchestrator",
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(180deg,#f8fbff_0%,#f5f7fb_55%,#ffffff_100%)] px-3 py-6 lg:px-6">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <header className="flex flex-col gap-3 rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur lg:flex-row lg:items-center">
          <div>
            <p className="text-xl font-extrabold uppercase tracking-[0.12em] text-sky-600">
              WORKHUB
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Daily Report
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              WBS · 이메일 · 카카오톡을 통합 분석해 5섹션으로 정리하고, 드래그 후 Orchestrator로 재정리합니다.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              {run && (
                <Badge
                  variant={
                    run.status === "succeeded" ? "default" : "secondary"
                  }
                >
                  {run.status}
                </Badge>
              )}
              <span className="rounded-md bg-slate-100 px-2 py-0.5">
                총 {items.length}건
              </span>
              {user?.email && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5">
                  {user.email}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 lg:ml-5">
            <Button asChild variant="outline">
              <Link href="/">
                <Home className="h-4 w-4" />
                메인
              </Link>
            </Button>
            {canViewMyPage && (
              <Button asChild variant="outline">
                <Link href="/my-page">
                  <UserRoundSearch className="h-4 w-4" />
                  마이 워크
                </Link>
              </Button>
            )}
          </div>
          <Image
            src="/placeholder-logo.png"
            alt="WorkHub 로고"
            width={180}
            height={52}
            className="h-12 w-auto object-contain lg:ml-auto"
            priority
          />
        </header>

      <AgentBoard
        agentBusy={agentBusy}
        agentStats={agentStats}
        items={items}
        emailReady={emailReady}
        kakaoReady={kakaoReady}
        hasItems={items.length > 0}
        running={running}
        activeFilter={viewFilter}
        onSelectFilter={setViewFilter}
        onOpenAgentSettings={(key) => setSettingsAgent(key)}
        onRunWbs={handleRunWbs}
        onRunEmail={handleRunEmail}
        onRunKakao={handleRunKakao}
        onRunOrchestrator={handleRunOrchestrator}
        onRunAll={handleRunAll}
      />

      <SettingsDialog
        open={settingsAgent !== null}
        onOpenChange={(v) => {
          if (!v) setSettingsAgent(null);
        }}
        agent={settingsAgent}
        imap={imap}
        onImapChange={setImap}
        kakaoFile={kakaoFile}
        onKakaoFileChange={setKakaoFile}
        apiKeyState={apiKeyState}
        onSaveApiKey={handleSaveApiKey}
        onDeleteApiKey={handleDeleteApiKey}
        imapStoredState={imapStoredState}
        onSaveImapConfig={handleSaveImapConfig}
        onDeleteImapConfig={handleDeleteImapConfig}
        kakaoOptions={kakaoOptions}
        onKakaoOptionsChange={setKakaoOptions}
      />

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">아직 결과 없음</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            상단의 멀티 에이전트 카드에서 각 에이전트를 개별 실행하거나 Orchestrator의 "전체 에이전트 실행" 버튼을 눌러주세요. 각 에이전트 카드 우측의 톱니바퀴에서 해당 에이전트 전용 설정을 변경할 수 있습니다.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">결과 보기:</span>
            {viewFilter ? (
              <>
                <Badge variant="default">
                  {filterLabel[viewFilter]} · {filteredItems.length}건
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setViewFilter(null)}
                >
                  전체 보기로
                </Button>
              </>
            ) : (
              <Badge variant="secondary">전체 · {items.length}건</Badge>
            )}
          </div>

          {filteredItems.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {viewFilter ? `${filterLabel[viewFilter]} 결과 없음` : "결과 없음"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                해당 에이전트의 결과가 비어 있습니다. 상단 카드의 "실행"을 눌러 분석을 진행하거나, Orchestrator 카드를 다시 클릭해 전체 결과를 보세요.
              </CardContent>
            </Card>
          ) : (
            <SectionList
              items={filteredItems}
              appliedIds={appliedIds}
              dismissedIds={dismissedIds}
              busyItemId={busyItemId}
              onApply={handleApply}
              onDismiss={handleDismiss}
              onMoveItem={handleMoveItem}
            />
          )}
        </>
      )}

      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">
              실행 로그
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-40 space-y-1 overflow-auto rounded-md border bg-muted/30 p-2 text-[11px]">
              {events.map((event, idx) => (
                <div key={idx} className="font-mono">
                  <span className="text-muted-foreground">{event.phase}</span>
                  {event.source && (
                    <span className="text-muted-foreground">
                      {" · "}
                      {event.source}
                    </span>
                  )}
                  {typeof event.stats?.count === "number" && (
                    <span> ({event.stats.count})</span>
                  )}
                  {event.message && (
                    <span className="text-red-500"> – {event.message}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </main>
  );
}
