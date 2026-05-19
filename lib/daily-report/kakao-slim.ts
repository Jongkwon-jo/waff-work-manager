import { personMatchesAliases } from "./server-aliases";
import type { KakaoMessage } from "./kakao-parser";

export type SlimMessageRole = "self" | "other";

export interface SlimMessage {
  id: string;
  timestamp: string;
  date: string;
  sender: string;
  role: SlimMessageRole;
  content: string;
  attachments: string[];
}

export interface SlimKakaoTotals {
  raw: number;
  afterWindow: number;
  afterNoise: number;
  kept: number;
  truncated: number;
  sinceIso: string;
  windowDays: number;
}

export interface SlimKakaoSnapshot {
  todayIso: string;
  messages: SlimMessage[];
  participants: string[];
  selfName: string | null;
  totals: SlimKakaoTotals;
}

export interface BuildKakaoSlimOptions {
  aliases?: string[];
  windowDays?: number;
  maxGroups?: number;
  groupGapMinutes?: number;
}

const addDaysIso = (iso: string, days: number): string => {
  if (!iso) return iso;
  const base = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return iso;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const minutesBetween = (aIso: string, bIso: string): number => {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 60_000;
};

export function buildSlimKakaoSnapshot(
  raw: KakaoMessage[],
  todayIso: string,
  options: BuildKakaoSlimOptions = {},
): SlimKakaoSnapshot {
  const aliases = (options.aliases ?? [])
    .map((a) => a.trim())
    .filter(Boolean);
  const windowDays = options.windowDays ?? 14;
  const maxGroups = options.maxGroups ?? 300;
  const groupGapMinutes = options.groupGapMinutes ?? 5;

  const sinceIso = addDaysIso(todayIso, -Math.max(0, windowDays));

  // 1) 윈도우 필터
  const windowed =
    windowDays > 0
      ? raw.filter((m) => !m.date || m.date >= sinceIso)
      : raw.slice();

  // 2) 노이즈 / 시스템 제거. file 은 유지
  const cleaned = windowed.filter(
    (m) => m.messageType === "text" || m.messageType === "file",
  );

  // 3) role 매핑 + participants / selfName 집계
  const participants = new Set<string>();
  let selfName: string | null = null;
  const tagged = cleaned.map((m) => {
    const role: SlimMessageRole =
      aliases.length > 0 && personMatchesAliases(m.sender, aliases)
        ? "self"
        : "other";
    if (m.sender) participants.add(m.sender);
    if (role === "self" && !selfName) selfName = m.sender;
    return { msg: m, role };
  });

  // 4) 같은 sender + groupGap 이내 연속 메시지 그룹화. file 메시지는 attachments 로.
  const grouped: SlimMessage[] = [];
  for (const { msg, role } of tagged) {
    const last = grouped[grouped.length - 1];
    const sameSender = last && last.sender === msg.sender;
    const closeEnough =
      sameSender &&
      minutesBetween(last.timestamp, msg.timestamp) <= groupGapMinutes;

    if (last && sameSender && closeEnough) {
      if (msg.messageType === "file") {
        last.attachments.push(msg.content);
      } else {
        last.content = last.content
          ? `${last.content}\n${msg.content}`
          : msg.content;
      }
      continue;
    }

    if (msg.messageType === "file") {
      grouped.push({
        id: msg.id,
        timestamp: msg.timestamp,
        date: msg.date,
        sender: msg.sender,
        role,
        content: "",
        attachments: [msg.content],
      });
    } else {
      grouped.push({
        id: msg.id,
        timestamp: msg.timestamp,
        date: msg.date,
        sender: msg.sender,
        role,
        content: msg.content,
        attachments: [],
      });
    }
  }

  // 5) cap — 가장 오래된 그룹부터 제거 (배열은 시간순)
  let truncated = 0;
  while (grouped.length > maxGroups) {
    grouped.shift();
    truncated += 1;
  }

  return {
    todayIso,
    messages: grouped,
    participants: Array.from(participants),
    selfName,
    totals: {
      raw: raw.length,
      afterWindow: windowed.length,
      afterNoise: cleaned.length,
      kept: grouped.length,
      truncated,
      sinceIso,
      windowDays,
    },
  };
}
