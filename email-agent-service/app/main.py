from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .agent import analyze_email
from .imap_client import fetch_email_previews
from .models import EmailAnalyzeRequest, EmailAnalyzeResponse, EmailFetchRequest

app = FastAPI(title="WorkHub Email Agent Service", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/emails/fetch-preview")
def fetch_preview(request: EmailFetchRequest) -> dict[str, object]:
    try:
        emails = fetch_email_previews(request)
        return {"emails": [email.model_dump(by_alias=True) for email in emails]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/emails/analyze", response_model=EmailAnalyzeResponse)
async def analyze(request: EmailAnalyzeRequest) -> EmailAnalyzeResponse:
    try:
        analysis = await analyze_email(request)
        return EmailAnalyzeResponse(analysis=analysis)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
