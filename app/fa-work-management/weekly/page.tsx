"use client"

import { WeeklyWorkBoard } from "@/components/weekly-work-board"
import { subscribeToData } from "@/lib/firestore-service-fa"

export default function FaWeeklyPage() {
  return (
    <WeeklyWorkBoard
      title="FA사업부 주간 업무로드현황"
      description="스케줄 페이지의 FA사업부 데이터를 기준으로, 이번 주 업무를 일주일 캘린더 형태로 보여줍니다."
      homeHref="/"
      managementHref="/fa-work-management"
      subscribeToData={subscribeToData}
      allowedDepartmentGroups={["FA"]}
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
