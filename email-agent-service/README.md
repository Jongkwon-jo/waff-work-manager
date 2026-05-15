# Email Agent Service

FastAPI + Pydantic AI service for the WorkHub GPT test email workflow.

## Environment

Set these variables before running the service:

```bash
OPENAI_API_KEY=sk-...
OPENAI_EMAIL_AGENT_MODEL=gpt-5.2
IMAP_HOST=imap.example.com
IMAP_PORT=993
IMAP_USERNAME=user@example.com
IMAP_PASSWORD=app-password
IMAP_USE_SSL=true
```

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8787
```

The Next.js app expects `EMAIL_AGENT_SERVICE_URL=http://127.0.0.1:8787`.
