"use client"

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
  { key: "total" as const, label: "전체", color: "text-foreground" },
  { key: "완료" as const, label: "완료", color: "text-emerald-600" },
  { key: "진행" as const, label: "진행", color: "text-blue-600" },
  { key: "예정" as const, label: "예정", color: "text-amber-600" },
  { key: "보류" as const, label: "보류", color: "text-slate-500" },
  { key: "미정" as const, label: "미정", color: "text-rose-500" },
]

export function StatusSummary({ counts, showDescriptions = false }: StatusSummaryProps) {
  const items = showDescriptions
    ? summaryItems.filter((item) => item.key !== "total")
    : summaryItems

  if (showDescriptions) {
    // 간트뷰: 아이콘 없는 컴팩트 가로 카운트 바
    return (
      <div className="flex h-full overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {items.map((item, idx) => (
          <div
            key={item.key}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center px-2 py-2${idx > 0 ? " border-l border-border/50" : ""}`}
          >
            <span className="text-[10px] leading-none text-muted-foreground">{item.label}</span>
            <span className={`mt-0.5 text-base font-bold leading-none ${item.color}`}>
              {counts[item.key]}
            </span>
          </div>
        ))}
      </div>
    )
  }

  // 목록/카드 뷰: 아이콘 없는 숫자 그리드
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {items.map((item) => (
        <div
          key={item.key}
          className="flex flex-col items-center justify-center rounded-lg border border-border bg-card px-2 py-3"
        >
          <p className="text-[11px] text-muted-foreground">{item.label}</p>
          <p className={`text-xl font-bold leading-tight ${item.color}`}>
            {counts[item.key]}
          </p>
        </div>
      ))}
    </div>
  )
}
