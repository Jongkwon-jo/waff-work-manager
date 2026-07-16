"use client"

import { WeeklyWorkBoard, type WeeklyWorkDataSource } from "@/components/weekly-work-board"
import {
  addHistoryEntry as addStrategyHistoryEntry,
  subscribeProjectsWithTasksByPersonKeys as subscribeStrategyScopedData,
  subscribeToData as subscribeStrategyData,
  updateTaskInDB as updateStrategyTask,
} from "@/lib/firestore-service"
import {
  addHistoryEntry as addFaHistoryEntry,
  subscribeProjectsWithTasksByPersonKeys as subscribeFaScopedData,
  subscribeToData as subscribeFaData,
  updateTaskInDB as updateFaTask,
} from "@/lib/firestore-service-fa"
import {
  addHistoryEntry as addIctHistoryEntry,
  subscribeProjectsWithTasksByPersonKeys as subscribeIctScopedData,
  subscribeToData as subscribeIctData,
  updateTaskInDB as updateIctTask,
} from "@/lib/firestore-service-ict"

const ALL_WEEKLY_DATA_SOURCES: WeeklyWorkDataSource[] = [
  {
    id: "strategy",
    label: "전략기획",
    departmentGroup: "전략기획",
    managementHref: "/work-management",
    permissionKey: "strategyWeeklyWork",
    editPermissionKey: "strategyWorkManagementEdit",
    defaultTaskDepartment: "전략",
    historySource: "work-management",
    updateTask: updateStrategyTask,
    addHistoryEntry: (entry) => addStrategyHistoryEntry({ ...entry, source: "work-management" }),
    subscribeToData: subscribeStrategyData,
    subscribeScopedToData: (personKeys, callback, options) =>
      subscribeStrategyScopedData(personKeys, callback, { ...options, resolveLeafStateOnce: true }),
  },
  {
    id: "fa",
    label: "FA",
    departmentGroup: "FA",
    managementHref: "/fa-work-management",
    permissionKey: "faWeeklyWork",
    editPermissionKey: "faWorkManagementEdit",
    defaultTaskDepartment: "FA",
    historySource: "fa-work-management",
    updateTask: updateFaTask,
    addHistoryEntry: (entry) => addFaHistoryEntry({ ...entry, source: "fa-work-management" }),
    subscribeToData: subscribeFaData,
    subscribeScopedToData: (personKeys, callback, options) =>
      subscribeFaScopedData(personKeys, callback, { ...options, resolveLeafStateOnce: true }),
  },
  {
    id: "ict",
    label: "ICT",
    departmentGroup: "ICT",
    managementHref: "/ict-work-management",
    permissionKey: "ictWeeklyWork",
    editPermissionKey: "ictWorkManagementEdit",
    defaultTaskDepartment: "ICT",
    historySource: "ict-work-management",
    updateTask: updateIctTask,
    addHistoryEntry: (entry) => addIctHistoryEntry({ ...entry, source: "ict-work-management" }),
    subscribeToData: subscribeIctData,
    subscribeScopedToData: (personKeys, callback, options) =>
      subscribeIctScopedData(personKeys, callback, { ...options, resolveLeafStateOnce: true }),
  },
]

export default function WeeklyWorkPage() {
  return (
    <WeeklyWorkBoard
      title="주간업무로드 현황"
      description="부서별 스케줄 데이터를 한 화면에서 필터링하고, 이번 주 담당자별 업무로드를 확인합니다."
      homeHref="/"
      dataSources={ALL_WEEKLY_DATA_SOURCES}
      tone={{
        pageBackground:
          "bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_30%),linear-gradient(180deg,#f8fbff_0%,#f1f6ff_52%,#ffffff_100%)]",
        summaryBadge: "border-sky-200 bg-sky-50 text-sky-700",
        dayHeader: "bg-sky-50/80",
        taskCard: "border-sky-100 bg-sky-50/45",
        noteCard: "bg-white",
      }}
    />
  )
}
