"use client"

import { WeeklyWorkBoard } from "@/components/weekly-work-board"
import { subscribeToData } from "@/lib/firestore-service"

export default function IctWeeklyPage() {
  return (
    <WeeklyWorkBoard
      title="ICT사업부 주간 업무로드현황"
      description="스케줄 페이지의 ICT사업부 데이터를 기준으로, 이번 주 업무를 일주일 캘린더 형태로 보여줍니다."
      homeHref="/"
      managementHref="/work-management"
      subscribeToData={subscribeToData}
      allowedDepartmentGroups={["ICT"]}
      tone={{
        pageBackground:
          "bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.14),_transparent_30%),linear-gradient(180deg,#f4fbff_0%,#eef8ff_52%,#ffffff_100%)]",
        summaryBadge: "border-cyan-200 bg-cyan-50 text-cyan-700",
        dayHeader: "bg-cyan-50/80",
        taskCard: "border-cyan-100 bg-cyan-50/45",
        noteCard: "bg-white",
      }}
    />
  )
}
