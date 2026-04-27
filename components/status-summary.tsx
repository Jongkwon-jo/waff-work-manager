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
  { key: "total" as const, label: "전체", color: "text-foreground", description: "전체 업무 수" },
  { key: "완료" as const, label: "완료", color: "text-emerald-600", description: "현재 완료된 업무" },
  { key: "진행" as const, label: "진행", color: "text-blue-600", description: "현재 진행중 업무" },
  { key: "예정" as const, label: "예정", color: "text-amber-600", description: "진행 예정된 업무" },
  { key: "보류" as const, label: "보류", color: "text-slate-500", description: "진행 보류된 업무" },
  { key: "미정" as const, label: "미정", color: "text-rose-500", description: "일정이 정해지지 않은 업무" },
]

export function StatusSummary({ counts, showDescriptions = false }: StatusSummaryProps) {
  const items = showDescriptions
    ? summaryItems.filter((item) => item.key !== "total")
    : summaryItems

  if (showDescriptions) {
    // 간트뷰: 아이콘 없는 컴팩트 가로 배열 (label + description)
    return (
      <div className="flex h-full gap-1.5 overflow-x-auto pb-0.5">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex min-w-[110px] flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
          >
            <div className="min-w-0">
              <p className={`text-[11px] font-semibold leading-none ${item.color}`}>{item.label}</p>
              <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{item.description}</p>
            </div>
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
