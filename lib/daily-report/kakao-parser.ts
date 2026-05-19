export type KakaoMessageType = "text" | "file" | "noise" | "system";

export interface KakaoMessage {
  id: string;
  timestamp: string; // ISO "YYYY-MM-DDTHH:MM:00"
  date: string; // "YYYY-MM-DD"
  sender: string;
  content: string;
  messageType: KakaoMessageType;
}

const PC_DATE_RE = /^-+\s*(\d{4})년\s*(\d+)월\s*(\d+)일\s*[가-힣]+요일\s*-+\s*$/;
const PC_DATE_PLAIN_RE = /^(\d{4})년\s+(\d+)월\s+(\d+)일\s+[가-힣]+요일$/;
const PC_MSG_RE =
  /^\[(.+?)\]\s+\[(오전|오후)\s+(\d{1,2}):(\d{2})\]\s+(.*)$/;
const MOBILE_MSG_RE =
  /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{1,2}):(\d{2}),\s*(.+?)\s*:\s*(.*)$/;
const FILE_RE = /^파일:\s*(.+)$/;
const SEND_MONEY_RE = /^(.+?)님이\s+돈을\s+보냈어요!?$/;

// 카카오톡 자동 생성 / 미디어 placeholder
const NOISE_EXACT = new Set([
  "사진",
  "동영상",
  "이모티콘",
  "음성메시지",
  "음성 메시지",
  "지도",
  "연락처",
  "삭제된 메시지입니다.",
  "삭제된 메시지입니다",
  "샵검색",
]);
const NOISE_PREFIX = ["사진 ", "동영상 ", "음성메시지 "];

const SYSTEM_FOLLOWUP_PREFIXES = [
  "- 받는 사람",
  "- 받을 금액",
  "- 입금 기한",
  "- 보낸 사람",
];

const pad = (n: number): string => n.toString().padStart(2, "0");

const buildIso = (
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
): string => `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}:00`;

const buildDate = (y: number, m: number, d: number): string =>
  `${y}-${pad(m)}-${pad(d)}`;

function classifyContent(content: string): {
  type: KakaoMessageType;
  fileName?: string;
} {
  const trimmed = content.trim();
  if (!trimmed) return { type: "text" };

  const fileMatch = trimmed.match(FILE_RE);
  if (fileMatch) {
    return { type: "file", fileName: fileMatch[1].trim() };
  }

  if (SEND_MONEY_RE.test(trimmed)) return { type: "system" };

  if (NOISE_EXACT.has(trimmed)) return { type: "noise" };
  if (NOISE_PREFIX.some((prefix) => trimmed.startsWith(prefix))) {
    return { type: "noise" };
  }

  return { type: "text" };
}

function isSystemFollowup(line: string): boolean {
  const trimmed = line.trim();
  return SYSTEM_FOLLOWUP_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function parseKakaoText(raw: string): KakaoMessage[] {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const messages: KakaoMessage[] = [];
  let currentDate: { y: number; m: number; d: number } | null = null;
  let counter = 0;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const pcDateDashes = line.match(PC_DATE_RE);
    if (pcDateDashes) {
      currentDate = {
        y: Number(pcDateDashes[1]),
        m: Number(pcDateDashes[2]),
        d: Number(pcDateDashes[3]),
      };
      continue;
    }
    const pcDatePlain = line.match(PC_DATE_PLAIN_RE);
    if (pcDatePlain) {
      currentDate = {
        y: Number(pcDatePlain[1]),
        m: Number(pcDatePlain[2]),
        d: Number(pcDatePlain[3]),
      };
      continue;
    }

    const mobile = line.match(MOBILE_MSG_RE);
    if (mobile) {
      const [, y, mo, d, h, mi, sender, content] = mobile;
      const classification = classifyContent(content);
      messages.push({
        id: `kakao-${counter++}`,
        timestamp: buildIso(
          Number(y),
          Number(mo),
          Number(d),
          Number(h),
          Number(mi),
        ),
        date: buildDate(Number(y), Number(mo), Number(d)),
        sender: sender.trim(),
        content:
          classification.type === "file"
            ? classification.fileName ?? content.trim()
            : content.trim(),
        messageType: classification.type,
      });
      continue;
    }

    const pcMsg = line.match(PC_MSG_RE);
    if (pcMsg && currentDate) {
      const [, sender, ampm, hour, minute, content] = pcMsg;
      const hourNum = Number(hour) % 12;
      const adjustedHour = ampm === "오후" ? hourNum + 12 : hourNum;
      const classification = classifyContent(content);
      messages.push({
        id: `kakao-${counter++}`,
        timestamp: buildIso(
          currentDate.y,
          currentDate.m,
          currentDate.d,
          adjustedHour,
          Number(minute),
        ),
        date: buildDate(currentDate.y, currentDate.m, currentDate.d),
        sender: sender.trim(),
        content:
          classification.type === "file"
            ? classification.fileName ?? content.trim()
            : content.trim(),
        messageType: classification.type,
      });
      continue;
    }

    // 새 메시지 헤더가 아닌 라인 → 직전 메시지에 합치거나 무시
    if (messages.length === 0) continue;
    const last = messages[messages.length - 1];

    // 송금 같은 시스템 메시지의 후속 라인은 그냥 흡수
    if (last.messageType === "system" && isSystemFollowup(line)) {
      last.content = `${last.content}\n${line}`.trim();
      continue;
    }

    // text/file 메시지에 일반 라인이 이어지는 경우 (멀티라인 message body)
    if (last.messageType === "text" || last.messageType === "file") {
      last.content = `${last.content}\n${line}`.trim();
      continue;
    }

    // noise 메시지에 후속 라인은 무시 (예: 사진 본문은 없음)
  }

  return messages;
}
