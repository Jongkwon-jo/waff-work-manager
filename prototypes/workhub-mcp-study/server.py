"""2교시: Python 함수를 MCP 도구로 노출. stdout은 MCP 통신 전용입니다."""
import os
from typing import Literal

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from domain import WorkHubStudy

store = WorkHubStudy(os.environ.get("STUDY_VIEWER", "fa_reader"))
mcp = FastMCP("WorkHub Python Study", log_level="WARNING")
READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
Department = Literal["strategy", "fa", "ict"]
Status = Literal["완료", "진행", "예정", "취소", "미정"]


@mcp.tool(annotations=READ_ONLY)
def search_projects(keyword: str = "", department: Department | None = None) -> dict:
    """권한 내 가상 프로젝트 검색. 모호한 프로젝트명은 먼저 이 도구로 ID를 확인한다."""
    return store.search_projects(keyword, department)


@mcp.tool(annotations=READ_ONLY)
def list_tasks(department: Department | None = None, project_id: str | None = None,
               person: str | None = None, status: Status | None = None,
               start: str | None = None, end: str | None = None,
               overdue_only: bool = False, offset: int = 0, limit: int = 20) -> dict:
    """가상 최하위 업무 조회. 날짜 YYYY-MM-DD, 기간 겹침 기준. partial과 next_offset을 확인한다.

    실습 기준일은 2026-09-09(KST). 지연은 기준일 이전 마감 중 완료/취소 제외.
    person은 '가상 민수' 또는 '가상 지수' 등 정확한 이름. 통계는 get_project_metrics 사용.
    """
    return store.list_tasks(department, project_id, person, status, start, end, overdue_only, offset, limit)


@mcp.tool(annotations=READ_ONLY)
def get_project_metrics(department: Department | None = None, project_id: str | None = None) -> dict:
    """전체 조회 범위의 정확한 건수/완료율/지연/공수. 취소·상위 업무·중복·숨김은 집계 제외."""
    return store.get_project_metrics(department, project_id)


if __name__ == "__main__":
    mcp.run(transport="stdio")
