"use client"

import { CheckCircle2, Clock, Pause, HelpCircle, PlayCircle, LayoutList } from "lucide-react"

interface StatusSummaryProps {
  counts: {
    total: number
    "완료": number
    "진행": number
    "예정": number
    "보류": number
    "미정": number
  }
  showDescriptions?: boolean
}

const summaryItems = [
  { key: "total" as const, label: "전체", icon: LayoutList, color: "text-foreground", bg: "bg-card", description: "전체 업무 수" },
  { key: "완료" as const, label: "완료", icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50", description: "현재 완료된 업무" },
  { key: "진행" as const, label: "진행", icon: PlayCircle, color: "text-blue-600", bg: "bg-blue-50", description: "현재 진행중 업무" },
  { key: "예정" as const, label: "예정", icon: Clock, color: "text-amber-600", bg: "bg-amber-50", description: "진행 예정된 업무" },
  { key: "보류" as const, label: "보류", icon: Pause, color: "text-slate-500", bg: "bg-slate-50", description: "진행 보류된 업무" },
  { key: "미정" as const, label: "미정", icon: HelpCircle, color: "text-rose-500", bg: "bg-rose-50", description: "일정이 정해지지 않은 업무" },
]

export function StatusSummary({ counts, showDescriptions = false }: StatusSummaryProps) {
  const items = showDescriptions ? summaryItems.filter((item) => item.key !== "total") : summaryItems

  return (
    <div>
      <div className={showDescriptions ? "flex gap-1.5 overflow-x-auto pb-1" : "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"}>
        {items.map((item) => {
          const Icon = item.icon
          const count = counts[item.key]

          return (
            <div
              key={item.key}
              className={showDescriptions ? "flex min-w-[130px] flex-1 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5" : "flex items-center gap-3 rounded-lg border border-border bg-card p-3"}
            >
              <div className={`${showDescriptions ? "h-6 w-6 rounded" : "h-9 w-9 rounded-lg"} flex shrink-0 items-center justify-center ${item.bg}`}>
                <Icon className={`${showDescriptions ? "h-3 w-3" : "h-4.5 w-4.5"} ${item.color}`} />
              </div>
              <div className="min-w-0">
                <p className={showDescriptions ? "text-[10px] text-muted-foreground" : "text-xs text-muted-foreground"}>{item.label}</p>
                {showDescriptions ? (
                  <p className="text-[10px] font-medium leading-tight text-foreground">{item.description}</p>
                ) : (
                  <p className={`text-lg font-bold leading-tight ${item.key === "total" ? "text-foreground" : item.color}`}>
                    {count}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
