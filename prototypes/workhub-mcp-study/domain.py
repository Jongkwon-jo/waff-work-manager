"""1교시: MCP/AI와 독립적인 읽기 전용 업무 규칙. 실제 Firebase 접근은 없습니다."""
import json
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

KST = timezone(timedelta(hours=9))
DEPARTMENTS = {"strategy", "fa", "ict"}
STATUSES = {"완료", "진행", "예정", "취소", "미정"}
# 로컬 실습용 역할 선택일 뿐 실제 인증이 아닙니다. 사용자 입력 인자로 노출하지 않습니다.
SCOPES = {"fa_reader": {"fa"}, "all_reader": DEPARTMENTS}


class WorkHubStudy:
    def __init__(self, viewer="fa_reader"):
        if viewer not in SCOPES:
            raise ValueError("알 수 없는 실습 사용자")
        self.scope = SCOPES[viewer]
        self.data = json.loads(Path(__file__).with_name("sample_data.json").read_text(encoding="utf-8"))
        self.as_of = self.data["as_of"]

    def _projects(self, department=None):
        if department is not None:
            if department not in DEPARTMENTS:
                raise ValueError("department는 strategy, fa, ict 중 하나입니다.")
            if department not in self.scope:
                raise PermissionError("실습 사용자에게 해당 사업부 조회 권한이 없습니다.")
        return [p for p in self.data["projects"] if not p["hidden"]
                and p["department"] in self.scope
                and (department is None or p["department"] == department)]

    def _rows(self, department=None, project_id=None):
        projects = {p["id"]: p for p in self._projects(department)}
        if project_id is not None and project_id not in projects:
            raise ValueError("조회 가능한 프로젝트를 찾을 수 없습니다.")
        # 표시 화면(view)이 아니라 원본 프로젝트 + 업무 ID로 중복 제거합니다.
        canonical = {(t["project_id"], t["id"]): t for t in self.data["tasks"]}
        parent_keys = {(t["project_id"], t["parent_id"]) for t in canonical.values() if t.get("parent_id")}

        def visible(task):
            seen = set()
            while task:
                key = (task["project_id"], task["id"])
                if key in seen or task.get("hidden"):
                    return False
                seen.add(key)
                if not task.get("parent_id"):
                    return True
                task = canonical.get((task["project_id"], task["parent_id"]))
            return False  # 부모 없는 비정상 트리는 실습에서도 노출하지 않습니다.

        rows = []
        for key, task in canonical.items():
            pid = task["project_id"]
            if pid not in projects or (project_id and pid != project_id):
                continue
            if key in parent_keys or not visible(task):
                continue
            row = {k: v for k, v in task.items() if k not in {"view", "hidden"}}
            row.update(project_name=projects[pid]["name"], department=projects[pid]["department"],
                       source_ref=f"sample://{pid}/{task['id']}")
            rows.append(row)
        return sorted(rows, key=lambda r: (r["end"], r["project_id"], r["id"]))

    def _result(self, **content):
        return {"data_source": "synthetic_fixture", "as_of": self.as_of,
                "queried_at": datetime.now(KST).isoformat(timespec="seconds"),
                "scope": sorted(self.scope), **content}

    def search_projects(self, keyword="", department=None):
        projects = [p for p in self._projects(department) if keyword.casefold() in p["name"].casefold()]
        return self._result(items=projects, total=len(projects), partial=False)

    def list_tasks(self, department=None, project_id=None, person=None, status=None,
                   start=None, end=None, overdue_only=False, offset=0, limit=20):
        if status is not None and status not in STATUSES:
            raise ValueError("알 수 없는 업무 상태")
        if start:
            date.fromisoformat(start)
        if end:
            date.fromisoformat(end)
        if start and end and start > end:
            raise ValueError("시작일은 종료일보다 늦을 수 없습니다.")
        if offset < 0 or not 1 <= limit <= 50:
            raise ValueError("offset >= 0, 1 <= limit <= 50이어야 합니다.")
        rows = [r for r in self._rows(department, project_id)
                if (person is None or r["person"] == person)
                and (status is None or r["status"] == status)
                and (not start or r["end"] >= start)
                and (not end or r["start"] <= end)
                and (not overdue_only or self._overdue(r))]
        page = rows[offset:offset + limit]
        next_offset = offset + limit if offset + limit < len(rows) else None
        return self._result(items=page, total=len(rows), returned=len(page),
                            partial=len(page) < len(rows), next_offset=next_offset,
                            filters={"department": department, "project_id": project_id,
                                     "person": person, "status": status, "start": start,
                                     "end": end, "overdue_only": overdue_only},
                            rules="최하위 업무만 조회; 기간은 업무 기간과의 겹침 기준; 기준일은 as_of")

    def _overdue(self, row):
        return row["status"] not in {"완료", "취소"} and row["end"] < self.as_of

    def get_project_metrics(self, department=None, project_id=None):
        rows = self._rows(department, project_id)
        active = [r for r in rows if r["status"] != "취소"]
        completed = sum(r["status"] == "완료" for r in active)
        return self._result(total=len(active), completed=completed,
                            overdue=sum(self._overdue(r) for r in active),
                            completion_percent=round(100 * completed / len(active), 1) if active else None,
                            man_days=sum(r["man_days"] for r in active), partial=False,
                            source_refs=[r["source_ref"] for r in active],
                            rules="최하위 업무 건수 기준; 취소 제외; 공수는 저장값 합계; 빈 집합 완료율은 null")
