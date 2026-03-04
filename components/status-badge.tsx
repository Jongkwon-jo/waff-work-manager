"use client"

import type { TaskStatus, TaskCategory } from "@/lib/data"
import { cn } from "@/lib/utils"

const statusConfig: Record<TaskStatus, { bg: string; text: string; dot: string }> = {
  "완료": { bg: "bg-slate-600", text: "text-slate-50", dot: "bg-slate-50" },
  "진행": { bg: "bg-blue-500", text: "text-blue-50", dot: "bg-blue-50" },
  "대기": { bg: "bg-gray-200", text: "text-gray-600", dot: "bg-gray-600" },
  "보류": { bg: "bg-yellow-200", text: "text-yellow-800", dot: "bg-yellow-800" },
  "미정": { bg: "bg-rose-50", text: "text-rose-600", dot: "bg-rose-600" },
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const config = statusConfig[status]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        config.bg,
        config.text
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {status}
    </span>
  )
}

const categoryConfig: Record<TaskCategory, { bg: string; text: string }> = {
  "일반": { bg: "bg-secondary", text: "text-secondary-foreground" },
  "중요": { bg: "bg-rose-50", text: "text-rose-700" },
  "정기": { bg: "bg-violet-50", text: "text-violet-700" },
}

export function CategoryBadge({ category }: { category: TaskCategory }) {
  const config = categoryConfig[category]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
        config.bg,
        config.text
      )}
    >
      {category}
    </span>
  )
}

const projectTypeConfig: Record<string, { bg: string; text: string }> = {
  "SI": { bg: "bg-blue-100", text: "text-blue-800" },
  "R&D": { bg: "bg-emerald-100", text: "text-emerald-800" },
  "S/F": { bg: "bg-orange-100", text: "text-orange-800" },
  "Etc": { bg: "bg-slate-100", text: "text-slate-700" },
}

export function ProjectTypeBadge({ type }: { type: string }) {
  const config = projectTypeConfig[type] || projectTypeConfig["Etc"]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold tracking-wide",
        config.bg,
        config.text
      )}
    >
      {type}
    </span>
  )
}
