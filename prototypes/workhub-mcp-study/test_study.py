"""실습의 핵심 약속을 검증: 정확한 수치, 숨김/권한, 중복, 실제 MCP 왕복."""
import unittest

from domain import WorkHubStudy


class DomainTests(unittest.TestCase):
    def test_fa_metrics_exclude_parent_cancelled_and_hidden(self):
        result = WorkHubStudy().get_project_metrics("fa")
        self.assertEqual((result["total"], result["completed"], result["overdue"],
                          result["man_days"], result["completion_percent"]), (3, 1, 1, 6, 33.3))

    def test_hidden_project_and_hidden_ancestor(self):
        result = WorkHubStudy().list_tasks("fa")
        self.assertEqual({r["id"] for r in result["items"]}, {"fa-1", "fa-2", "fa-3", "fa-4"})

    def test_cross_department_permission(self):
        with self.assertRaises(PermissionError):
            WorkHubStudy().list_tasks("ict")
        with self.assertRaises(ValueError):
            WorkHubStudy().get_project_metrics(project_id="ict-demo")

    def test_linked_task_deduplication(self):
        result = WorkHubStudy("all_reader").get_project_metrics()
        self.assertEqual((result["total"], result["overdue"], result["man_days"]), (5, 2, 11))
        self.assertEqual(len(result["source_refs"]), len(set(result["source_refs"])))

    def test_pagination_preserves_total(self):
        store = WorkHubStudy()
        first = store.list_tasks(limit=2)
        second = store.list_tasks(limit=2, offset=first["next_offset"])
        self.assertEqual(first["total"], 4)
        self.assertTrue(first["partial"])
        self.assertIsNone(second["next_offset"])
        ids = [r["id"] for r in first["items"] + second["items"]]
        self.assertEqual(len(set(ids)), 4)

    def test_date_overlap_and_empty_results(self):
        store = WorkHubStudy()
        result = store.list_tasks(start="2026-09-09", end="2026-09-11")
        self.assertEqual([r["id"] for r in result["items"]], ["fa-2"])
        self.assertEqual(store.list_tasks(person="존재하지 않는 가상 담당자")["total"], 0)
        with self.assertRaises(ValueError):
            store.list_tasks(start="2026-09-11", end="2026-09-09")
        with self.assertRaises(ValueError):
            store.list_tasks(start="2026-02-30")

    def test_empty_metrics_have_no_percentage(self):
        store = WorkHubStudy()
        store.data["tasks"] = []
        self.assertIsNone(store.get_project_metrics()["completion_percent"])


class McpTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_stdio_discovery_call_and_errors(self):
        from client import connect, call
        async with connect() as session:
            tools = (await session.list_tools()).tools
            self.assertEqual({t.name for t in tools}, {"search_projects", "list_tasks", "get_project_metrics"})
            self.assertTrue(all(t.annotations.readOnlyHint for t in tools))
            metrics = await call(session, "get_project_metrics", {"department": "fa"})
            self.assertEqual(metrics["completion_percent"], 33.3)
            tasks = await call(session, "list_tasks", {"overdue_only": True})
            self.assertEqual([r["id"] for r in tasks["items"]], ["fa-1"])
            denied = await call(session, "list_tasks", {"department": "ict"})
            self.assertIn("error", denied)
            invalid = await call(session, "list_tasks", {"limit": 0})
            self.assertIn("error", invalid)


if __name__ == "__main__":
    unittest.main()
