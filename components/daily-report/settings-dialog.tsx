"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { parseKakaoText } from "@/lib/daily-report/kakao-parser";
import { buildSlimKakaoSnapshot } from "@/lib/daily-report/kakao-slim";

export type SettingsAgentKey = "wbs" | "email" | "kakao" | "orchestrator";

export interface ImapPayload {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  limit: number;
  unreadOnly: boolean;
  since: string;
}

export interface ApiKeyState {
  hasKey: boolean;
  masked: string | null;
}

export interface ImapStoredState {
  hasPassword: boolean;
}

export interface KakaoOptions {
  windowDays: number;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agent: SettingsAgentKey | null;
  imap: ImapPayload;
  onImapChange: (next: ImapPayload) => void;
  kakaoFile: File | null;
  onKakaoFileChange: (f: File | null) => void;
  apiKeyState: ApiKeyState;
  onSaveApiKey: (key: string) => Promise<void>;
  onDeleteApiKey: () => Promise<void>;
  imapStoredState: ImapStoredState;
  onSaveImapConfig: () => Promise<void>;
  onDeleteImapConfig: () => Promise<void>;
  kakaoOptions: KakaoOptions;
  onKakaoOptionsChange: (next: KakaoOptions) => void;
}

const AGENT_META: Record<
  SettingsAgentKey,
  { title: string; description: string }
> = {
  wbs: {
    title: "WBS Agent 설정",
    description:
      "WBS Agent는 전략 · FA · ICT 부서의 Firestore 데이터를 자동 수집합니다.",
  },
  email: {
    title: "Email Agent 설정",
    description:
      "IMAP 자격증명과 수집 범위를 설정합니다. 비밀번호는 브라우저에 저장하지 않습니다.",
  },
  kakao: {
    title: "Kakao Agent 설정",
    description:
      "카카오톡 대화 내보내기 .txt 파일을 업로드합니다. 서버에 영구 저장되지 않습니다.",
  },
  orchestrator: {
    title: "Orchestrator 설정",
    description:
      "Orchestrator는 현재 항목을 받아 우선순위와 5섹션을 재정리합니다.",
  },
};

export function SettingsDialog({
  open,
  onOpenChange,
  agent,
  imap,
  onImapChange,
  kakaoFile,
  onKakaoFileChange,
  apiKeyState,
  onSaveApiKey,
  onDeleteApiKey,
  imapStoredState,
  onSaveImapConfig,
  onDeleteImapConfig,
  kakaoOptions,
  onKakaoOptionsChange,
}: SettingsDialogProps) {
  const update = <K extends keyof ImapPayload>(
    key: K,
    value: ImapPayload[K],
  ) => onImapChange({ ...imap, [key]: value });

  const meta = agent ? AGENT_META[agent] : null;

  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyBusy, setApiKeyBusy] = useState(false);

  const handleSaveApiKey = async () => {
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) return;
    setApiKeyBusy(true);
    try {
      await onSaveApiKey(trimmed);
      setApiKeyDraft("");
    } finally {
      setApiKeyBusy(false);
    }
  };

  const handleDeleteApiKey = async () => {
    setApiKeyBusy(true);
    try {
      await onDeleteApiKey();
    } finally {
      setApiKeyBusy(false);
    }
  };

  const [imapBusy, setImapBusy] = useState(false);

  const handleSaveImap = async () => {
    setImapBusy(true);
    try {
      await onSaveImapConfig();
    } finally {
      setImapBusy(false);
    }
  };

  const handleDeleteImap = async () => {
    setImapBusy(true);
    try {
      await onDeleteImapConfig();
    } finally {
      setImapBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{meta?.title ?? "설정"}</DialogTitle>
          {meta && <DialogDescription>{meta.description}</DialogDescription>}
        </DialogHeader>

        {agent === "email" && (
          <div className="space-y-6">
            <section className="space-y-2">
              <div className="text-sm font-medium">IMAP 연결</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Host">
                  <Input
                    value={imap.host}
                    placeholder="imap.gmail.com"
                    onChange={(e) => update("host", e.target.value)}
                  />
                </Field>
                <Field label="Port">
                  <Input
                    type="number"
                    value={imap.port}
                    onChange={(e) =>
                      update("port", Number(e.target.value) || 993)
                    }
                  />
                </Field>
                <Field label="Mailbox">
                  <Input
                    value={imap.mailbox}
                    placeholder="INBOX"
                    onChange={(e) => update("mailbox", e.target.value)}
                  />
                </Field>
                <Field label="사용자">
                  <Input
                    value={imap.user}
                    autoComplete="username"
                    onChange={(e) => update("user", e.target.value)}
                  />
                </Field>
                <Field label="비밀번호">
                  <Input
                    type="password"
                    value={imap.password}
                    placeholder={
                      imapStoredState.hasPassword
                        ? "저장된 비밀번호 사용 중 (변경하려면 입력)"
                        : "비밀번호 입력 후 저장"
                    }
                    autoComplete="current-password"
                    onChange={(e) => update("password", e.target.value)}
                  />
                </Field>
                <Field label="옵션">
                  <div className="flex h-9 flex-wrap items-center gap-3 text-sm">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={imap.secure}
                        onChange={(e) => update("secure", e.target.checked)}
                      />
                      <span>SSL</span>
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={imap.unreadOnly}
                        onChange={(e) =>
                          update("unreadOnly", e.target.checked)
                        }
                      />
                      <span>안 읽은 것만</span>
                    </label>
                  </div>
                </Field>
              </div>
            </section>

            <section className="space-y-2">
              <div className="text-sm font-medium">수집 범위</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="최대 메일 수">
                  <Input
                    type="number"
                    value={imap.limit}
                    min={1}
                    max={100}
                    onChange={(e) =>
                      update("limit", Number(e.target.value) || 20)
                    }
                  />
                </Field>
                <Field label="이후 날짜">
                  <Input
                    type="date"
                    value={imap.since}
                    onChange={(e) => update("since", e.target.value)}
                  />
                </Field>
              </div>
            </section>

            <section className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">계정별 저장 상태:</span>
                {imapStoredState.hasPassword ? (
                  <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-700">
                    저장됨 (비밀번호 포함)
                  </span>
                ) : (
                  <span className="italic text-muted-foreground">
                    아직 저장되지 않음
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                저장된 설정은 Firestore 의 본인 user_profiles 문서에만 기록되며, 비밀번호는 응답으로 다시 노출되지 않습니다. 실행 시 비밀번호 입력란이 비어 있으면 저장된 값이 자동으로 사용됩니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveImap}
                  disabled={imapBusy || !imap.host || !imap.user}
                  className="gap-1.5"
                >
                  {imapBusy && <Loader2 className="size-3.5 animate-spin" />}
                  이 설정을 계정에 저장
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDeleteImap}
                  disabled={imapBusy || !imapStoredState.hasPassword}
                >
                  저장된 설정 삭제
                </Button>
              </div>
            </section>
          </div>
        )}

        {agent === "kakao" && (
          <KakaoSection
            kakaoFile={kakaoFile}
            onKakaoFileChange={onKakaoFileChange}
            kakaoOptions={kakaoOptions}
            onKakaoOptionsChange={onKakaoOptionsChange}
          />
        )}

        {agent === "wbs" && (
          <div className="space-y-6">
            <section className="space-y-3">
              <div className="text-sm font-medium">OpenAI API Key</div>
              <p className="text-xs text-muted-foreground">
                계정별로 Firestore에 안전하게 저장됩니다. 입력된 키는 모든 에이전트(WBS / Email / Kakao / Orchestrator) 호출에 공통으로 사용됩니다. 미설정 시 서버 환경변수 <code>OPENAI_API_KEY</code>로 폴백합니다.
              </p>
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                현재 상태:{" "}
                {apiKeyState.hasKey ? (
                  <span className="font-mono text-emerald-700">
                    {apiKeyState.masked ?? "저장됨"}
                  </span>
                ) : (
                  <span className="italic text-muted-foreground">
                    저장된 키 없음 (서버 환경변수 사용)
                  </span>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={apiKeyDraft}
                  autoComplete="off"
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={handleSaveApiKey}
                  disabled={apiKeyBusy || apiKeyDraft.trim().length < 8}
                  className="gap-1.5"
                >
                  {apiKeyBusy && <Loader2 className="size-3.5 animate-spin" />}
                  저장
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDeleteApiKey}
                  disabled={apiKeyBusy || !apiKeyState.hasKey}
                >
                  삭제
                </Button>
              </div>
            </section>

            <section className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              <p>
                WBS Agent는 외부 입력 없이 Firestore의 전략 · FA · ICT 프로젝트와 태스크를 자동으로 수집합니다.
              </p>
              <p className="text-xs">
                향후 부서 필터, 담당자 필터, 분석 모델 선택 등의 옵션이 추가될 예정입니다.
              </p>
            </section>
          </div>
        )}

        {agent === "orchestrator" && (
          <section className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
            <p>
              현재 Orchestrator는 외부 옵션을 받지 않습니다. specialist들이 만든 항목과 사용자가 드래그로 옮긴 섹션을 입력으로 받아 우선순위 / 중복 제거 / 요약을 재정리합니다.
            </p>
            <p className="text-xs">
              향후 섹션별 최대 항목 수, 사용 모델, 우선순위 가중치를 노출할 예정입니다.
            </p>
          </section>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">닫기</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

const WINDOW_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "최근 7일", value: 7 },
  { label: "최근 14일", value: 14 },
  { label: "최근 30일", value: 30 },
  { label: "전체", value: 0 },
];

function KakaoSection({
  kakaoFile,
  onKakaoFileChange,
  kakaoOptions,
  onKakaoOptionsChange,
}: {
  kakaoFile: File | null;
  onKakaoFileChange: (f: File | null) => void;
  kakaoOptions: KakaoOptions;
  onKakaoOptionsChange: (next: KakaoOptions) => void;
}) {
  const [rawText, setRawText] = useState<string | null>(null);

  useEffect(() => {
    if (!kakaoFile) {
      setRawText(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const text = await kakaoFile.text();
        if (!cancelled) setRawText(text);
      } catch {
        if (!cancelled) setRawText(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kakaoFile]);

  const preview = useMemo(() => {
    if (!rawText) return null;
    const messages = parseKakaoText(rawText);
    const todayIso = new Date().toISOString().slice(0, 10);
    return buildSlimKakaoSnapshot(messages, todayIso, {
      windowDays: kakaoOptions.windowDays,
    });
  }, [rawText, kakaoOptions.windowDays]);

  return (
    <section className="space-y-3">
      <div className="text-sm font-medium">카카오톡 대화 (.txt)</div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <Input
          type="file"
          accept=".txt,text/plain"
          onChange={(e) => onKakaoFileChange(e.target.files?.[0] ?? null)}
        />
        <div className="text-xs text-muted-foreground sm:text-right">
          {kakaoFile
            ? `${kakaoFile.name} · ${Math.round(kakaoFile.size / 1024)}KB`
            : "선택된 파일 없음"}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">분석 윈도우</Label>
        <div className="flex flex-wrap gap-1.5">
          {WINDOW_OPTIONS.map((opt) => {
            const active = kakaoOptions.windowDays === opt.value;
            return (
              <Button
                key={opt.value}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => onKakaoOptionsChange({ windowDays: opt.value })}
              >
                {opt.label}
              </Button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          기본 14일. 너무 길게 잡으면 토큰 한도를 초과할 수 있습니다.
        </p>
      </div>

      {preview && (
        <div className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">미리보기</span>
            <span className="rounded-md bg-white/70 px-1.5 py-0.5">
              원본 {preview.totals.raw}건
            </span>
            <span className="rounded-md bg-white/70 px-1.5 py-0.5">
              윈도우 적용 {preview.totals.afterWindow}건
            </span>
            <span className="rounded-md bg-white/70 px-1.5 py-0.5">
              노이즈 제거 후 {preview.totals.afterNoise}건
            </span>
            <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-emerald-700">
              최종 그룹 {preview.totals.kept}건
            </span>
            {preview.totals.truncated > 0 && (
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-700">
                cap 으로 {preview.totals.truncated}건 잘림
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">참여자:</span>
            {preview.participants.length === 0 ? (
              <span className="italic text-muted-foreground">없음</span>
            ) : (
              preview.participants.map((p) => (
                <span
                  key={p}
                  className={
                    preview.selfName === p
                      ? "rounded-md bg-blue-100 px-1.5 py-0.5 text-blue-700"
                      : "rounded-md bg-white/70 px-1.5 py-0.5"
                  }
                >
                  {p}
                  {preview.selfName === p ? " (나)" : ""}
                </span>
              ))
            )}
          </div>
          {preview.totals.afterWindow > 0 && preview.totals.windowDays > 0 && (
            <div className="text-[11px] text-muted-foreground">
              윈도우 시작일: {preview.totals.sinceIso}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        PC / 모바일 카카오톡 내보내기 형식을 모두 지원합니다. 업로드한 내용은 분석 요청 범위에서만 사용되며 서버에 영구 저장되지 않습니다.
      </p>
    </section>
  );
}
