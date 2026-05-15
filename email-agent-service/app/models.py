from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


TaskStatus = Literal["완료", "진행", "예정", "보류", "미정"]
TaskCategory = Literal["일반", "중요", "정기", "상시"]
ActionType = Literal["create_task", "update_task", "no_action", "needs_review"]
RiskType = Literal["deadline_conflict", "owner_overload", "project_overlap", "missing_due_date", "stale_task"]
RiskSeverity = Literal["low", "medium", "high"]
ProjectSource = Literal["work-management", "fa-work-management"]


class EmailAgentConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    openai_api_key: str = Field(default="", alias="openaiApiKey")
    openai_model: str = Field(default="", alias="openaiModel")
    imap_host: str = Field(default="", alias="imapHost")
    imap_port: int = Field(default=993, ge=1, le=65535, alias="imapPort")
    imap_username: str = Field(default="", alias="imapUsername")
    imap_password: str = Field(default="", alias="imapPassword")
    imap_use_ssl: bool = Field(default=True, alias="imapUseSsl")
    imap_mailbox: str = Field(default="INBOX", alias="imapMailbox")


class EmailFetchRequest(BaseModel):
    limit: int = Field(default=10, ge=1, le=50)
    mailbox: str = Field(default="INBOX", min_length=1)
    since: str | None = None
    unread_only: bool = False
    config: EmailAgentConfig | None = None


class EmailMessage(BaseModel):
    email_id: str = Field(alias="emailId")
    message_id: str = Field(default="", alias="messageId")
    uid: str
    from_: str = Field(default="", alias="from")
    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    subject: str = ""
    received_at: str = Field(default="", alias="receivedAt")
    plain_text: str = Field(default="", alias="plainText")
    attachment_names: list[str] = Field(default_factory=list, alias="attachmentNames")


class TaskSnapshot(BaseModel):
    task_id: str = Field(alias="taskId")
    title: str
    department: str = ""
    person: str = ""
    status: TaskStatus = "미정"
    category: TaskCategory = "일반"
    start_date: str = Field(default="", alias="startDate")
    end_date: str = Field(default="", alias="endDate")
    man_days: float = Field(default=0, ge=0, alias="manDays")
    depth: int = Field(default=0, ge=0)


class ProjectSnapshot(BaseModel):
    source: ProjectSource
    project_id: str = Field(alias="projectId")
    project_name: str = Field(alias="projectName")
    project_type: str = Field(default="", alias="projectType")
    pm_email: str = Field(default="", alias="pmEmail")
    tasks: list[TaskSnapshot] = Field(default_factory=list)


class ProposedAction(BaseModel):
    type: ActionType
    project_id: str | None = Field(default=None, alias="projectId")
    task_id: str | None = Field(default=None, alias="taskId")
    title: str = ""
    department: str = ""
    person: str = ""
    status: TaskStatus = "미정"
    category: TaskCategory = "일반"
    start_date: str | None = Field(default=None, alias="startDate")
    end_date: str | None = Field(default=None, alias="endDate")
    man_days: float | None = Field(default=None, ge=0, alias="manDays")
    memo: str = ""

    @field_validator("start_date", "end_date")
    @classmethod
    def validate_date_string(cls, value: str | None) -> str | None:
        if not value:
            return None
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("dates must use YYYY-MM-DD") from exc
        return value

    @model_validator(mode="after")
    def validate_action(self) -> "ProposedAction":
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError("startDate must be before or equal to endDate")
        if self.type == "create_task" and not self.project_id:
            raise ValueError("create_task requires projectId")
        if self.type == "update_task" and not self.task_id:
            raise ValueError("update_task requires taskId")
        return self


class ScheduleRisk(BaseModel):
    type: RiskType
    severity: RiskSeverity = "medium"
    message: str
    related_task_ids: list[str] = Field(default_factory=list, alias="relatedTaskIds")


class EmailWorkAnalysis(BaseModel):
    is_work_related: bool = Field(alias="isWorkRelated")
    summary: str = ""
    detected_intent: str = Field(default="", alias="detectedIntent")
    confidence: float = Field(default=0, ge=0, le=1)
    related_project_ids: list[str] = Field(default_factory=list, alias="relatedProjectIds")
    proposed_actions: list[ProposedAction] = Field(default_factory=list, alias="proposedActions")
    schedule_risks: list[ScheduleRisk] = Field(default_factory=list, alias="scheduleRisks")
    missing_info: list[str] = Field(default_factory=list, alias="missingInfo")
    reasoning_summary: str = Field(default="", alias="reasoningSummary")

    @model_validator(mode="after")
    def add_review_for_low_confidence(self) -> "EmailWorkAnalysis":
        if self.confidence < 0.55 and not any(action.type == "needs_review" for action in self.proposed_actions):
            self.proposed_actions.append(
                ProposedAction(
                    type="needs_review",
                    memo="분석 신뢰도가 낮아 사람이 검토해야 합니다.",
                )
            )
        if not self.is_work_related and not self.proposed_actions:
            self.proposed_actions.append(ProposedAction(type="no_action", memo="업무 관련성이 낮습니다."))
        return self


class EmailAnalyzeRequest(BaseModel):
    email: EmailMessage
    project_snapshots: list[ProjectSnapshot] = Field(default_factory=list, alias="projectSnapshots")
    analysis_date: str = Field(alias="analysisDate")
    config: EmailAgentConfig | None = None


class EmailAnalyzeResponse(BaseModel):
    analysis: EmailWorkAnalysis
