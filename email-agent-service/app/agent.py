from __future__ import annotations

import json
import os
import re
from datetime import date

from pydantic_ai import Agent

from .config import settings
from .models import EmailAgentConfig, EmailAnalyzeRequest, EmailWorkAnalysis, ProjectSnapshot


AGENT_INSTRUCTIONS = """
당신은 사내 프로젝트 관리 보조 AI입니다.
이메일 내용을 현재 프로젝트/업무 일정과 비교해 업무 관련성을 판단하고, 사람이 승인할 수 있는 구조화된 업무 제안을 만드세요.

원칙:
- 확실하지 않으면 create_task/update_task 대신 needs_review를 제안하세요.
- 이미 존재하는 업무와 같은 요청이면 update_task를 우선 고려하세요.
- 날짜는 YYYY-MM-DD 형식으로만 반환하세요.
- 일정 충돌, 담당자 과부하, 마감 위험이 보이면 scheduleRisks에 요약하세요.
- Firestore에 직접 반영된다고 가정하지 말고, 검토용 제안만 작성하세요.
- reasoningSummary에는 짧고 검증 가능한 근거만 적고 긴 추론 과정은 쓰지 마세요.
"""


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip()


def _date_overlap(start: str, end: str, today: str) -> bool:
    try:
        start_date = date.fromisoformat(start)
        end_date = date.fromisoformat(end)
        today_date = date.fromisoformat(today)
    except ValueError:
        return False
    return start_date <= today_date <= end_date or end_date >= today_date


def select_relevant_projects(
    email_text: str,
    projects: list[ProjectSnapshot],
    analysis_date: str,
    max_projects: int = 8,
    max_tasks_per_project: int = 16,
) -> list[ProjectSnapshot]:
    haystack = _norm(email_text)
    scored: list[tuple[int, ProjectSnapshot]] = []

    for project in projects:
        score = 0
        project_name = _norm(project.project_name)
        if project_name and project_name in haystack:
            score += 18
        if project.pm_email and _norm(project.pm_email) in haystack:
            score += 8

        task_scores: list[tuple[int, object]] = []
        for task in project.tasks:
            task_score = 0
            if task.title and _norm(task.title) in haystack:
                task_score += 12
            if task.person and _norm(task.person) in haystack:
                task_score += 5
            if task.department and _norm(task.department) in haystack:
                task_score += 4
            if task.status != "완료":
                task_score += 2
            if _date_overlap(task.start_date, task.end_date, analysis_date):
                task_score += 2
            if task_score > 0:
                task_scores.append((task_score, task))
                score += task_score

        if score > 0:
            selected_tasks = [task for _, task in sorted(task_scores, key=lambda item: item[0], reverse=True)[:max_tasks_per_project]]
            scored.append((score, project.model_copy(update={"tasks": selected_tasks or project.tasks[:max_tasks_per_project]})))

    if not scored:
        return [
            project.model_copy(update={"tasks": project.tasks[:max_tasks_per_project]})
            for project in projects[: min(max_projects, len(projects))]
        ]

    return [project for _, project in sorted(scored, key=lambda item: item[0], reverse=True)[:max_projects]]


def _analysis_prompt(request: EmailAnalyzeRequest, relevant_projects: list[ProjectSnapshot]) -> str:
    payload = {
        "analysisDate": request.analysis_date,
        "email": request.email.model_dump(by_alias=True),
        "projectSnapshots": [project.model_dump(by_alias=True) for project in relevant_projects],
    }
    return (
        "아래 JSON 입력을 분석해 EmailWorkAnalysis 스키마로만 반환하세요.\n"
        "입력:\n"
        f"{json.dumps(payload, ensure_ascii=False)}"
    )


def _resolve_model_name(config: EmailAgentConfig | None) -> str:
    return (config.openai_model if config and config.openai_model else settings.openai_email_agent_model).strip() or "gpt-5.2"


def build_agent(config: EmailAgentConfig | None = None) -> Agent[None, EmailWorkAnalysis]:
    api_key = (config.openai_api_key if config and config.openai_api_key else settings.openai_api_key).strip()
    if api_key:
        os.environ["OPENAI_API_KEY"] = api_key

    return Agent(
        f"openai-responses:{_resolve_model_name(config)}",
        output_type=EmailWorkAnalysis,
        instructions=AGENT_INSTRUCTIONS,
    )


async def analyze_email(request: EmailAnalyzeRequest) -> EmailWorkAnalysis:
    relevant_projects = select_relevant_projects(
        email_text=f"{request.email.subject}\n\n{request.email.plain_text}",
        projects=request.project_snapshots,
        analysis_date=request.analysis_date,
    )
    agent = build_agent(request.config)
    result = await agent.run(_analysis_prompt(request, relevant_projects))
    return result.output
