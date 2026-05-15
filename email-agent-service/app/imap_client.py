from __future__ import annotations

import email
import imaplib
import re
from datetime import datetime
from email.header import decode_header, make_header
from email.message import Message
from email.utils import getaddresses, parsedate_to_datetime
from html import unescape

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover - service still works without bs4.
    BeautifulSoup = None

from .config import settings
from .models import EmailAgentConfig, EmailFetchRequest, EmailMessage


def _decode_header(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value))).strip()
    except Exception:
        return value.strip()


def _decode_payload(part: Message) -> str:
    payload = part.get_payload(decode=True)
    if not payload:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def _html_to_text(html: str) -> str:
    if BeautifulSoup:
        return BeautifulSoup(html, "html.parser").get_text("\n")
    without_tags = re.sub(r"<[^>]+>", " ", html)
    return unescape(without_tags)


def _normalize_text(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", text)).strip()


def _addresses(message: Message, header_name: str) -> list[str]:
    raw = message.get_all(header_name, [])
    return [addr for _, addr in getaddresses(raw) if addr]


def parse_email_message(raw: bytes, uid: str, mailbox: str) -> EmailMessage:
    message = email.message_from_bytes(raw)
    subject = _decode_header(message.get("Subject"))
    message_id = (message.get("Message-ID") or "").strip()
    from_value = _decode_header(message.get("From"))
    received_at = ""

    try:
        parsed_date = parsedate_to_datetime(message.get("Date"))
        if parsed_date:
            received_at = parsed_date.isoformat()
    except Exception:
        received_at = datetime.utcnow().isoformat()

    plain_parts: list[str] = []
    html_parts: list[str] = []
    attachment_names: list[str] = []

    for part in message.walk():
        if part.is_multipart():
            continue

        content_disposition = (part.get("Content-Disposition") or "").lower()
        filename = part.get_filename()
        if filename:
            attachment_names.append(_decode_header(filename))

        content_type = part.get_content_type()
        if "attachment" in content_disposition:
            continue
        if content_type == "text/plain":
            plain_parts.append(_decode_payload(part))
        elif content_type == "text/html":
            html_parts.append(_html_to_text(_decode_payload(part)))

    text = "\n\n".join(plain_parts).strip() or "\n\n".join(html_parts).strip()

    return EmailMessage(
        emailId=f"{mailbox}:{uid}",
        messageId=message_id,
        uid=uid,
        **{"from": from_value},
        to=_addresses(message, "To"),
        cc=_addresses(message, "Cc"),
        subject=subject,
        receivedAt=received_at,
        plainText=_normalize_text(text),
        attachmentNames=[name for name in attachment_names if name],
    )


def _resolve_imap_config(config: EmailAgentConfig | None) -> EmailAgentConfig:
    return EmailAgentConfig(
        imapHost=config.imap_host if config and config.imap_host else settings.imap_host,
        imapPort=config.imap_port if config else settings.imap_port,
        imapUsername=config.imap_username if config and config.imap_username else settings.imap_username,
        imapPassword=config.imap_password if config and config.imap_password else settings.imap_password,
        imapUseSsl=config.imap_use_ssl if config else settings.imap_use_ssl,
        imapMailbox=config.imap_mailbox if config and config.imap_mailbox else settings.imap_default_mailbox,
    )


def fetch_email_previews(request: EmailFetchRequest) -> list[EmailMessage]:
    imap_config = _resolve_imap_config(request.config)

    if not imap_config.imap_host or not imap_config.imap_username or not imap_config.imap_password:
        raise RuntimeError("IMAP 환경변수(IMAP_HOST, IMAP_USERNAME, IMAP_PASSWORD)가 필요합니다.")

    mailbox = request.mailbox or imap_config.imap_mailbox
    client_cls = imaplib.IMAP4_SSL if imap_config.imap_use_ssl else imaplib.IMAP4
    client = client_cls(imap_config.imap_host, imap_config.imap_port)

    try:
        client.login(imap_config.imap_username, imap_config.imap_password)
        status, _ = client.select(mailbox)
        if status != "OK":
            raise RuntimeError(f"IMAP mailbox를 열 수 없습니다: {mailbox}")

        criteria: list[str] = ["UNSEEN" if request.unread_only else "ALL"]
        if request.since:
            criteria.extend(["SINCE", request.since])

        status, search_data = client.uid("SEARCH", None, *criteria)
        if status != "OK" or not search_data:
            return []

        uids = search_data[0].split()
        selected_uids = list(reversed(uids))[: request.limit]
        emails: list[EmailMessage] = []

        for uid_bytes in selected_uids:
            uid = uid_bytes.decode("ascii", errors="ignore")
            status, fetch_data = client.uid("FETCH", uid, "(RFC822)")
            if status != "OK":
                continue
            for item in fetch_data:
                if not isinstance(item, tuple):
                    continue
                emails.append(parse_email_message(item[1], uid=uid, mailbox=mailbox))
                break

        return emails
    finally:
        try:
            client.logout()
        except Exception:
            pass
