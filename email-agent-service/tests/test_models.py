import pytest
from pydantic import ValidationError

from app.models import EmailWorkAnalysis, ProposedAction


def test_rejects_invalid_date_order():
    with pytest.raises(ValidationError):
        ProposedAction(
            type="create_task",
            projectId="project-1",
            startDate="2026-05-20",
            endDate="2026-05-10",
        )


def test_low_confidence_adds_review_action():
    analysis = EmailWorkAnalysis(
        isWorkRelated=True,
        summary="검토 필요",
        detectedIntent="unclear",
        confidence=0.3,
        relatedProjectIds=[],
        proposedActions=[],
        scheduleRisks=[],
        missingInfo=["담당자"],
        reasoningSummary="정보 부족",
    )

    assert analysis.proposed_actions[0].type == "needs_review"
