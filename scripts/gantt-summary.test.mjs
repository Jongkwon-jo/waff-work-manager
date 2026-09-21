import assert from "node:assert/strict"
import { test } from "node:test"
import { buildGanttProjectSummaryRanges, buildGanttSummaryRanges, getGanttSummaryDaySpan } from "../lib/gantt-summary.ts"

const task = (id, overrides = {}) => ({
  id, projectId: "project", task: id, status: "진행", category: "일반",
  department: "", person: "", startDate: "09월 10일", endDate: "09월 12일",
  manDays: 3, ...overrides,
})
const ymd = (date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
const period = (map, id) => {
  const range = map.get(id)
  return range && [ymd(range.startDate), ymd(range.endDate)]
}
const september = Array.from({ length: 30 }, (_, i) => ({ year: 2026, month: 8, day: i + 1 }))

test("projects aggregate eligible roots and deep descendants independently", () => {
  const projects = [
    { id: "first", tasks: [
      task("root-leaf", { startDate: "09월 01일" }),
      task("done-parent", { status: "완료", startDate: "01월 01일", subTasks: [
        task("middle", { status: "취소", subTasks: [task("deep", { endDate: "09월 30일" })] }),
      ] }),
      task("hidden", { isHidden: true, startDate: "01월 01일", endDate: "12월 31일" }),
    ] },
    { id: "second", tasks: [task("second-root", { status: "미정" })] },
    { id: "empty", tasks: [] },
    { id: "done-only", tasks: [task("done", { status: "완료" })] },
  ]
  const before = JSON.stringify(projects)
  const ranges = buildGanttProjectSummaryRanges(projects, 2026)
  assert.deepEqual(period(ranges, "first"), [[2026, 9, 1], [2026, 9, 30]])
  assert.deepEqual(period(ranges, "second"), [[2026, 9, 10], [2026, 9, 12]])
  assert.equal(ranges.has("empty"), false)
  assert.equal(ranges.has("done-only"), false)
  assert.equal(JSON.stringify(projects), before)
  const hiddenRanges = buildGanttProjectSummaryRanges(projects, 2026, new Set(["done-parent"]))
  assert.deepEqual(period(hiddenRanges, "first"), [[2026, 9, 1], [2026, 9, 12]])
})

test("all descendant levels contribute, excluding each parent's own dates", () => {
  const root = task("root", { startDate: "01월 01일", endDate: "12월 31일", subTasks: [
    task("child", { startDate: "09월 03일", subTasks: [
      task("grandchild", { status: "미정", endDate: "09월 25일" }),
    ] }),
    task("planned", { status: "예정", startDate: "09월 01일" }),
  ] })
  const before = JSON.stringify(root)
  const ranges = buildGanttSummaryRanges([root], 2026)
  assert.deepEqual(period(ranges, "root"), [[2026, 9, 1], [2026, 9, 25]])
  assert.deepEqual(period(ranges, "child"), [[2026, 9, 10], [2026, 9, 25]])
  assert.equal(ranges.has("grandchild"), false)
  assert.equal(JSON.stringify(root), before)
})

test("completed and cancelled intermediates preserve active descendants", () => {
  const root = task("root", { subTasks: [
    task("done", { status: "완료", startDate: "01월 01일", endDate: "12월 31일", subTasks: [
      task("cancelled", { status: "취소", startDate: "01월 01일", endDate: "12월 31일", subTasks: [
        task("active"),
      ] }),
    ] }),
  ] })
  const ranges = buildGanttSummaryRanges([root], 2026)
  for (const id of ["root", "done", "cancelled"]) {
    assert.deepEqual(period(ranges, id), [[2026, 9, 10], [2026, 9, 12]])
  }
})

test("hidden subtrees are excluded even when descendants are not individually hidden", () => {
  const root = task("root", { subTasks: [
    task("visible"),
    task("hidden", { isHidden: true, subTasks: [task("hidden-descendant", { endDate: "12월 31일" })] }),
    task("hidden-by-id", { startDate: "01월 01일", subTasks: [task("also-hidden")] }),
  ] })
  const ranges = buildGanttSummaryRanges([root], 2026, new Set(["hidden-by-id"]))
  assert.deepEqual(period(ranges, "root"), [[2026, 9, 10], [2026, 9, 12]])
  assert.equal(ranges.has("hidden"), false)
  assert.equal(ranges.has("hidden-by-id"), false)
})

test("missing, malformed, impossible and reversed dates do not create summaries", () => {
  const invalid = [
    ["", "09월 12일"], ["09월 10일", ""], ["invalid", "09월 12일"],
    ["02월 30일", "09월 12일"], ["09월 31일", "10월 01일"],
    ["13월 01일", "13월 02일"], ["09월 20일", "09월 10일"],
    ["2025-02-29", "2025-03-01"],
  ]
  const root = task("root", { subTasks: invalid.map(([startDate, endDate], i) => task(String(i), { startDate, endDate })) })
  assert.equal(buildGanttSummaryRanges([root], 2026).size, 0)
  assert.equal(buildGanttSummaryRanges([task("leaf")], 2026).size, 0)
  assert.equal(buildGanttSummaryRanges([task("root", { subTasks: [task("done", { status: "완료" })] })], 2026).size, 0)
})

test("date formats, leap days and explicit year boundaries are respected", () => {
  const root = task("root", { subTasks: [
    task("leap", { startDate: "2024-02-29", endDate: "2024-02-29" }),
    task("year-end", { startDate: "2025년 12월 31일", endDate: "2026/01/02" }),
    task("short", { startDate: "9/1", endDate: "09.03" }),
  ] })
  assert.deepEqual(period(buildGanttSummaryRanges([root], 2026), "root"), [[2024, 2, 29], [2026, 9, 3]])
})

test("recomputation follows additions, edits, status changes, deletion, movement and hiding", () => {
  const root = task("root", { subTasks: [task("child")] })
  const destination = task("destination", { subTasks: [] })
  const read = () => buildGanttSummaryRanges([root, destination], 2026)
  root.subTasks.push(task("new", { endDate: "09월 30일" }))
  assert.deepEqual(period(read(), "root"), [[2026, 9, 10], [2026, 9, 30]])
  root.subTasks[1].startDate = "09월 01일"
  assert.deepEqual(period(read(), "root"), [[2026, 9, 1], [2026, 9, 30]])
  root.subTasks[1].status = "완료"
  assert.deepEqual(period(read(), "root"), [[2026, 9, 10], [2026, 9, 12]])
  root.subTasks.pop()
  destination.subTasks.push(root.subTasks.pop())
  assert.equal(read().has("root"), false)
  assert.deepEqual(period(read(), "destination"), [[2026, 9, 10], [2026, 9, 12]])
  destination.subTasks[0].isHidden = true
  assert.equal(read().has("destination"), false)
})

test("summary spans clip either edge, both edges and out-of-view periods", () => {
  const span = (startDate, endDate, days = september) => getGanttSummaryDaySpan(
    buildGanttSummaryRanges([task("root", { subTasks: [task("child", { startDate, endDate })] })], 2026).get("root"), days,
  )
  assert.deepEqual(span("08월 20일", "09월 05일"), { startIndex: 0, endIndex: 4 })
  assert.deepEqual(span("09월 25일", "10월 05일"), { startIndex: 24, endIndex: 29 })
  assert.deepEqual(span("08월 20일", "10월 05일"), { startIndex: 0, endIndex: 29 })
  assert.deepEqual(span("09월 10일", "09월 10일"), { startIndex: 9, endIndex: 9 })
  assert.equal(span("08월 01일", "08월 31일"), undefined)
  assert.equal(span("10월 01일", "10월 31일"), undefined)
  assert.equal(span("09월 01일", "09월 30일", []), undefined)
  assert.equal(getGanttSummaryDaySpan(undefined, september), undefined)
})
