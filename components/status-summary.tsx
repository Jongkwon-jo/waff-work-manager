"use client"

import { CheckCircle2, Clock, Pause, HelpCircle, PlayCircle, LayoutList } from "lucide-react"

interface StatusSummaryProps {
  counts: {
    total: number
    "완료": number
    "진행": number
    "대기": number
    "보류": number
    "미정": number
  }
}

const summaryItems = [
  { key: "total" as const, label: "전체", icon: LayoutList, color: "text-foreground", bg: "bg-card" },
  { key: "완료" as const, label: "완료", icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
  { key: "진행" as const, label: "진행", icon: PlayCircle, color: "text-blue-600", bg: "bg-blue-50" },
  { key: "대기" as const, label: "대기", icon: Clock, color: "text-amber-600", bg: "bg-amber-50" },
  { key: "보류" as const, label: "보류", icon: Pause, color: "text-slate-500", bg: "bg-slate-50" },
  { key: "미정" as const, label: "미정", icon: HelpCircle, color: "text-rose-500", bg: "bg-rose-50" },
]

export function StatusSummary({ counts }: StatusSummaryProps) {
  return (
    <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
      {summaryItems.map((item) => {
        const Icon = item.icon
        const count = counts[item.key]
        return (
          <div
            key={item.key}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.bg}`}>
              <Icon className={`h-4.5 w-4.5 ${item.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className={`text-lg font-bold leading-tight ${item.key === "total" ? "text-foreground" : item.color}`}>
                {count}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
