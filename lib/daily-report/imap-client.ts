import { ImapFlow } from "imapflow";
import {
  simpleParser,
  type AddressObject,
  type ParsedMail,
} from "mailparser";

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox?: string;
}

export interface ImapFetchRequest {
  config: ImapConfig;
  limit?: number;
  unreadOnly?: boolean;
  since?: Date;
}

export interface EmailMessage {
  emailId: string;
  messageId: string;
  uid: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  receivedAt: string;
  plainText: string;
  attachmentNames: string[];
}

const normalizeText = (text: string): string =>
  text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

const stripHtml = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"');

const collectAddresses = (
  field: AddressObject | AddressObject[] | undefined,
): string[] => {
  if (!field) return [];
  const arr = Array.isArray(field) ? field : [field];
  const out: string[] = [];
  for (const obj of arr) {
    for (const entry of obj.value ?? []) {
      if (entry.address) out.push(entry.address);
    }
  }
  return out;
};

const extractBody = (parsed: ParsedMail): string => {
  if (parsed.text && parsed.text.trim()) return parsed.text;
  if (typeof parsed.html === "string" && parsed.html.trim()) {
    return stripHtml(parsed.html);
  }
  return "";
};

const toEmailMessage = (
  parsed: ParsedMail,
  uid: string,
  mailbox: string,
): EmailMessage => ({
  emailId: `${mailbox}:${uid}`,
  messageId: parsed.messageId ?? "",
  uid,
  from: parsed.from?.text ?? "",
  to: collectAddresses(parsed.to),
  cc: collectAddresses(parsed.cc),
  subject: parsed.subject ?? "",
  receivedAt: parsed.date
    ? parsed.date.toISOString()
    : new Date().toISOString(),
  plainText: normalizeText(extractBody(parsed)),
  attachmentNames: (parsed.attachments ?? [])
    .map((a) => a.filename ?? "")
    .filter(Boolean),
});

export async function fetchEmails(
  req: ImapFetchRequest,
): Promise<EmailMessage[]> {
  const mailbox = req.config.mailbox || "INBOX";
  const client = new ImapFlow({
    host: req.config.host,
    port: req.config.port,
    secure: req.config.secure,
    auth: { user: req.config.user, pass: req.config.password },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock(mailbox);
  try {
    const search: { seen?: boolean; since?: Date } = {};
    if (req.unreadOnly) search.seen = false;
    if (req.since) search.since = req.since;

    const uids = await client.search(search, { uid: true });
    if (!uids || uids.length === 0) return [];

    const limit = Math.max(1, req.limit ?? 20);
    const selected = [...uids].slice(-limit).reverse();

    const results: EmailMessage[] = [];
    for await (const msg of client.fetch(
      selected,
      { source: true, uid: true },
      { uid: true },
    )) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source);
      results.push(toEmailMessage(parsed, String(msg.uid), mailbox));
    }
    return results;
  } finally {
    lock.release();
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}
