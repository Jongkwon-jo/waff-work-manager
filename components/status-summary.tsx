"use client"

interface StatusSummaryProps {
  counts: {
    total: number
    "완료": number
    "진행": number
    "예정": number
    "취소": number
    "미정": number
  }
  showDescriptions?: boolean
}

// 간트뷰 getStatusBarStyle 과 동일한 색상 체계
const summaryItems = [
  {
    key: "total" as const,
    label: "전체",
    strip: "bg-slate-300",
    labelColor: "text-foreground",
    numColor: "text-foreground",
    description: "전체 업무 수",
  },
  {
    key: "완료" as const,
    label: "완료",
    strip: "bg-slate-700",
    labelColor: "text-slate-700",
    numColor: "text-slate-700",
    description: "현재 완료된 업무",
  },
  {
    key: "진행" as const,
    label: "진행",
    strip: "bg-blue-500",
    labelColor: "text-blue-600",
    numColor: "text-blue-600",
    description: "현재 진행중 업무",
  },
  {
    key: "예정" as const,
    label: "예정",
    strip: "bg-gray-400",
    labelColor: "text-gray-500",
    numColor: "text-gray-500",
    description: "진행 예정된 업무",
  },
  {
    key: "취소" as const,
    label: "취소",
    strip: "bg-yellow-400",
    labelColor: "text-yellow-700",
    numColor: "text-yellow-700",
    description: "취소된 업무",
  },
  {
    key: "미정" as const,
    label: "미정",
    strip: "bg-rose-400",
    labelColor: "text-rose-600",
    numColor: "text-rose-600",
    description: "일정이 정해지지 않은 업무",
  },
]

export function StatusSummary({ counts, showDescriptions = false }: StatusSummaryProps) {
  const items = showDescriptions
    ? summaryItems.filter((item) => item.key !== "total")
    : summaryItems

  if (showDescriptions) {
    // 간트뷰: 왼쪽 컬러 스트립 + label + description, 컴팩트 크기
    return (
      <div className="flex items-stretch gap-1">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex min-h-[54px] min-w-[82px] shrink-0 overflow-hidden rounded-md border border-border bg-card sm:min-w-[96px]"
          >
            <div className={`w-1 shrink-0 ${item.strip}`} />
            <div className="flex h-full flex-col justify-center px-2 py-1 sm:px-2.5 sm:py-1.5">
              <p className={`text-[10px] font-semibold leading-none sm:text-xs ${item.labelColor}`}>{item.label}</p>
              <p className="mt-0.5 text-[9px] leading-tight text-muted-foreground sm:text-[10px]">{item.description}</p>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // 목록/카드 뷰: 컬러 스트립 + label + 숫자
  return (
    <div className="flex w-fit items-stretch gap-1">
      {items.map((item) => (
        <div
          key={item.key}
          className="flex min-h-[54px] overflow-hidden rounded-md border border-border bg-card"
        >
          <div className={`w-1 shrink-0 ${item.strip}`} />
          <div className="flex h-full flex-col items-center justify-center px-1.5 py-0.5 sm:px-2 sm:py-1">
            <p className="text-[9px] text-muted-foreground sm:text-xs">{item.label}</p>
            <p className={`text-sm font-bold leading-tight sm:text-lg ${item.numColor}`}>
              {counts[item.key]}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
