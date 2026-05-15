"use client"

import { WeeklyWorkBoard, type WeeklyWorkDataSource } from "@/components/weekly-work-board"
import { subscribeToData as subscribeStrategyData } from "@/lib/firestore-service"
import { subscribeToData as subscribeFaData } from "@/lib/firestore-service-fa"
import { subscribeToData as subscribeIctData } from "@/lib/firestore-service-ict"

const ALL_WEEKLY_DATA_SOURCES: WeeklyWorkDataSource[] = [
  {
    id: "strategy",
    label: "전략기획",
    departmentGroup: "전략기획",
    managementHref: "/work-management",
    subscribeToData: subscribeStrategyData,
  },
  {
    id: "fa",
    label: "FA",
    departmentGroup: "FA",
    managementHref: "/fa-work-management",
    subscribeToData: subscribeFaData,
  },
  {
    id: "ict",
    label: "ICT",
    departmentGroup: "ICT",
    managementHref: "/ict-work-management",
    subscribeToData: subscribeIctData,
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
