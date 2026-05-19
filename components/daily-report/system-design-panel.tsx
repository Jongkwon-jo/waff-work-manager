"use client";

import {
  Brain,
  ChevronDown,
  Loader2,
  Mail,
  MessageSquare,
  Network,
  Play,
  Settings,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type {
  DailyReportItem,
  DailyReportSection,
  DailyReportSource,
} from "@/lib/daily-report/schemas";

export interface AgentStatSnapshot {
  items: number;
  ranAt: number;
  message?: string;
}

type AgentKey = "wbs" | "email" | "kakao" | "orchestrator";

interface AgentBoardProps {
  agentBusy: Record<AgentKey, boolean>;
  agentStats: Partial<Record<AgentKey, AgentStatSnapshot>>;
  items: DailyReportItem[];
  emailReady: boolean;
  kakaoReady: boolean;
  hasItems: boolean;
  running: boolean;
  activeFilter: DailyReportSource | null;
  onSelectFilter: (filter: DailyReportSource | null) => void;
  onOpenAgentSettings: (key: AgentKey) => void;
  onRunWbs: () => Promise<void> | void;
  onRunEmail: () => Promise<void> | void;
  onRunKakao: () => Promise<void> | void;
  onRunOrchestrator: () => Promise<void> | void;
  onRunAll: () => Promise<void> | void;
}

const SPECIALISTS: ReadonlyArray<{
  key: Exclude<AgentKey, "orchestrator">;
  label: string;
  description: string;
  icon: typeof Network;
  source: DailyReportSource;
  accent: string;
  iconTone: string;
}> = [
  {
    key: "wbs",
    label: "WBS Agent",
    description: "전략 · FA · ICT 프로젝트 스냅샷 분석",
    icon: Network,
    source: "wbs",
    accent: "from-amber-50 via-orange-50/40 to-white",
    iconTone: "text-amber-600",
  },
  {
    key: "email",
    label: "Email Agent",
    description: "IMAP 수집 후 5섹션 분류",
    icon: Mail,
    source: "email",
    accent: "from-sky-50 via-cyan-50/40 to-white",
    iconTone: "text-sky-600",
  },
  {
    key: "kakao",
    label: "Kakao Agent",
    description: "카카오톡 대화 액션/위험/참고 추출",
    icon: MessageSquare,
    source: "kakao",
    accent: "from-yellow-50 via-amber-50/40 to-white",
    iconTone: "text-yellow-600",
  },
];

const SECTION_LABEL: Record<DailyReportSection, string> = {
  immediate: "즉시",
  today: "오늘",
  atRisk: "위험",
  pending: "대기",
  reference: "참고",
};

const SECTION_ORDER: DailyReportSection[] = [
  "immediate",
  "today",
  "atRisk",
  "pending",
  "reference",
];

export function AgentBoard({
  agentBusy,
  agentStats,
  items,
  emailReady,
  kakaoReady,
  hasItems,
  running,
  activeFilter,
  onSelectFilter,
  onOpenAgentSettings,
  onRunWbs,
  onRunEmail,
  onRunKakao,
  onRunOrchestrator,
  onRunAll,
}: AgentBoardProps) {
  const anyBusy = running || Object.values(agentBusy).some(Boolean);

  const distribution = SECTION_ORDER.map((section) => ({
    section,
    count: items.filter((it) => it.section === section).length,
  }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="size-4" />
          멀티 에이전트 시스템 구성
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {SPECIALISTS.map((spec) => {
            const Icon = spec.icon;
            const busy = agentBusy[spec.key];
            const stat = agentStats[spec.key];
            const disabledReason =
              spec.key === "email" && !emailReady
                ? "설정에서 IMAP host/user 입력 필요"
                : spec.key === "kakao" && !kakaoReady
                  ? "설정에서 .txt 파일 선택 필요"
                  : undefined;
            const disabled = anyBusy || Boolean(disabledReason);
            const previewItems = items
              .filter((it) => it.source === spec.source)
              .slice(0, 3);
            const onRun =
              spec.key === "wbs"
                ? onRunWbs
                : spec.key === "email"
                  ? onRunEmail
                  : onRunKakao;
            const isActive = activeFilter === spec.source;
            return (
              <div
                key={spec.key}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                onClick={() =>
                  onSelectFilter(isActive ? null : spec.source)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectFilter(isActive ? null : spec.source);
                  }
                }}
                className={cn(
                  "flex h-full cursor-pointer flex-col gap-3 rounded-xl border bg-gradient-to-b p-4 transition-shadow hover:shadow-md",
                  spec.accent,
                  isActive && "ring-2 ring-primary/60",
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="rounded-lg border bg-white/70 p-1.5">
                    <Icon className={cn("size-4", spec.iconTone)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{spec.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {spec.description}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    aria-label={`${spec.label} 설정`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenAgentSettings(spec.key);
                    }}
                  >
                    <Settings className="size-3.5" />
                  </Button>
                </div>

                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRun();
                  }}
                  className="w-full gap-1.5"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  {busy ? "실행 중..." : "실행"}
                </Button>

                <div className="space-y-1 text-[11px]">
                  {stat ? (
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="secondary"
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {stat.items}건
                      </Badge>
                      <span className="text-muted-foreground">
                        <RelativeTime ts={stat.ranAt} />
                      </span>
                      {stat.message && (
                        <span className="truncate text-red-500">
                          · {stat.message}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="italic text-muted-foreground">
                      {disabledReason ?? "미실행"}
                    </div>
                  )}

                  {previewItems.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {previewItems.map((it) => (
                        <li
                          key={it.id}
                          className="truncate rounded bg-white/60 px-1.5 py-0.5 text-[11px] text-slate-700"
                          title={it.title}
                        >
                          · {it.title}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="rounded bg-white/40 px-1.5 py-1 text-[10px] italic text-muted-foreground">
                      결과 미리보기 없음
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-center text-muted-foreground">
          <ChevronDown className="size-4" />
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-pressed={activeFilter === null}
          onClick={() => onSelectFilter(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectFilter(null);
            }
          }}
          className={cn(
            "cursor-pointer rounded-xl border bg-gradient-to-b from-violet-50 via-purple-50/40 to-white p-4 transition-shadow hover:shadow-md",
            activeFilter === null && "ring-2 ring-primary/60",
          )}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
            <div className="flex items-start gap-2">
              <div className="rounded-lg border bg-white/70 p-1.5">
                <Brain className="size-4 text-violet-600" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">Orchestrator</div>
                <div className="text-xs text-muted-foreground">
                  드래그로 옮긴 섹션을 반영하고 우선순위와 요약을 재정리합니다. 클릭하면 전체 결과를 봅니다.
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                aria-label="Orchestrator 설정"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAgentSettings("orchestrator");
                }}
              >
                <Settings className="size-3.5" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
              <Button
                size="sm"
                disabled={anyBusy || !hasItems}
                onClick={(e) => {
                  e.stopPropagation();
                  onRunOrchestrator();
                }}
                className="gap-1.5"
              >
                {agentBusy.orchestrator ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Brain className="size-3.5" />
                )}
                Orchestrator 적용
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={anyBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  onRunAll();
                }}
                className="gap-1.5"
              >
                {running ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                전체 에이전트 실행
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {agentStats.orchestrator ? (
              <>
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  총 {agentStats.orchestrator.items}건
                </Badge>
                <span>
                  <RelativeTime ts={agentStats.orchestrator.ranAt} />
                </span>
                <span>·</span>
              </>
            ) : (
              <span className="italic">미실행</span>
            )}
            {distribution.map(({ section, count }) => (
              <span
                key={section}
                className="rounded-md bg-white/70 px-1.5 py-0.5"
              >
                {SECTION_LABEL[section]} {count}
              </span>
            ))}
            {agentStats.orchestrator?.message && (
              <span className="text-red-500">
                · {agentStats.orchestrator.message}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RelativeTime({ ts }: { ts: number }) {
  const elapsed = Math.max(0, Date.now() - ts);
  if (elapsed < 60_000) return <>방금</>;
  if (elapsed < 3_600_000) return <>{Math.floor(elapsed / 60_000)}분 전</>;
  return <>{Math.floor(elapsed / 3_600_000)}시간 전</>;
}
