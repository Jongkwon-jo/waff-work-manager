from email.message import EmailMessage as StdEmailMessage

from app.imap_client import parse_email_message


def test_parse_korean_html_email():
    message = StdEmailMessage()
    message["Subject"] = "=?utf-8?b?7JeF66y0IOyalOyyrQ==?="
    message["From"] = "pm@example.com"
    message["To"] = "team@example.com"
    message["Message-ID"] = "<sample@example.com>"
    message["Date"] = "Thu, 14 May 2026 10:00:00 +0900"
    message.set_content("plain body")
    message.add_alternative("<html><body><p>HTML 본문</p></body></html>", subtype="html")

    parsed = parse_email_message(message.as_bytes(), uid="42", mailbox="INBOX")

    assert parsed.email_id == "INBOX:42"
    assert parsed.message_id == "<sample@example.com>"
    assert "plain body" in parsed.plain_text
