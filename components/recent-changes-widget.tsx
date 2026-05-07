"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Bell, ChevronDown, ChevronRight, RefreshCcw, RotateCcw, ArrowRight } from "lucide-react"
import type { Project, Task } from "@/lib/data"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface RecentChangeEntry {
  id: string
  entityType: string
  action: string
  actorEmail?: string
  entityId?: string
  projectId?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  createdAt?: Date
  source?: string
}

interface RecentChangesWidgetProps {
  loadEntries: () => Promise<RecentChangeEntry[]>
  rollbackEntry?: (entry: RecentChangeEntry) => Promise<void>
  projects: Project[]
  currentUserEmail?: string
  onJump?: (entry: RecentChangeEntry) => void
  refreshIntervalMs?: number
  title?: string
  description?: string
  emptyMessage?: string
}

const FIELD_LABELS: Record<string, string> = {
  task: "제목",
  status: "상태",
  startDate: "시작일",
  endDate: "종료일",
  manDays: "공수",
  memo: "메모",
  person: "담당자",
  category: "구분",
  department: "부서",
}

const SOURCE_LABELS: Record<string, string> = {
  "my-page": "마이페이지",
  "work-management": "전략기획 스케줄",
  "fa-work-management": "FA 스케줄",
  gantt: "간트뷰",
  other: "기타",
}

const formatRelativeTime = (date?: Date): string => {
  if (!date) return ""
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) return date.toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit" })
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return "방금 전"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}시간 전`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay}일 전`
  return date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })
}

const formatValueForDiff = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "string") return value.length > 30 ? `${value.slice(0, 27)}…` : value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

const findTaskInTree = (tasks: Task[], taskId: string): Task | undefined => {
  for (const task of tasks) {
    if (task.id === taskId) return task
    if (task.subTasks?.length) {
      const nested = findTaskInTree(task.subTasks, taskId)
      if (nested) return nested
    }
  }
  return undefined
}

const lookupTaskContext = (
  projects: Project[],
  projectId?: string,
  taskId?: string,
): { projectName: string; taskTitle: string } | null => {
  if (!taskId) return null
  for (const project of projects) {
    if (projectId && project.id !== projectId) continue
    const found = findTaskInTree(project.tasks, taskId)
    if (found) {
      return { projectName: project.name, taskTitle: found.task }
    }
  }
  if (!projectId) {
    for (const project of projects) {
      const found = findTaskInTree(project.tasks, taskId)
      if (found) return { projectName: project.name, taskTitle: found.task }
    }
  }
  return null
}

const getActionLabel = (entry: RecentChangeEntry) => {
  if (entry.entityType === "task" && entry.action === "create") return "업무 추가"
  if (entry.entityType === "task" && entry.action === "update") return "업무 수정"
  if (entry.entityType === "task" && entry.action === "delete") return "업무 삭제"
  if (entry.entityType === "project" && entry.action === "create") return "프로젝트 추가"
  if (entry.entityType === "project" && entry.action === "update") return "프로젝트 수정"
  if (entry.entityType === "project" && entry.action === "delete") return "프로젝트 삭제"
  if (entry.entityType === "batch") return "정렬/이동"
  return "변경"
}

const computeDiffFields = (entry: RecentChangeEntry): Array<{ key: string; before: unknown; after: unknown }> => {
  if (!entry.before || !entry.after) return []
  const keys = new Set<string>([...Object.keys(entry.before), ...Object.keys(entry.after)])
  const diffs: Array<{ key: string; before: unknown; after: unknown }> = []
  keys.forEach((key) => {
    const beforeValue = (entry.before || {})[key]
    const afterValue = (entry.after || {})[key]
    if (JSON.stringify(beforeValue ?? null) === JSON.stringify(afterValue ?? null)) return
    diffs.push({ key, before: beforeValue, after: afterValue })
  })
  return diffs
}

const formatActorName = (email?: string) => {
  if (!email) return "알 수 없음"
  const local = email.split("@")[0] || email
  return local
}

export function RecentChangesWidget({
  loadEntries,
  rollbackEntry,
  projects,
  currentUserEmail,
  onJump,
  refreshIntervalMs = 60_000,
  title = "최근 사용자 변경",
  description = "사용자가 마이페이지 등에서 직접 편집한 업무를 확인합니다.",
  emptyMessage = "최근 사용자 변경이 없습니다.",
}: RecentChangesWidgetProps) {
  const [entries, setEntries] = useState<RecentChangeEntry[]>([])
  const [isOpen, setIsOpen] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [rollingBackId, setRollingBackId] = useState<string | null>(null)
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const next = await loadEntries()
      setEntries(next)
    } catch (error) {
      console.error("RecentChangesWidget load failed:", error)
    } finally {
      setIsLoading(false)
    }
  }, [loadEntries])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return
    const id = window.setInterval(() => {
      void refresh()
    }, refreshIntervalMs)
    return () => window.clearInterval(id)
  }, [refresh, refreshIntervalMs])

  const filteredEntries = useMemo(() => {
    const normalizedCurrent = (currentUserEmail || "").trim().toLowerCase()
    return entries.filter((entry) => {
      if (entry.entityType !== "task") return false
      if (entry.action !== "update" && entry.action !== "create" && entry.action !== "delete") return false
      const actor = (entry.actorEmail || "").trim().toLowerCase()
      if (normalizedCurrent && actor === normalizedCurrent) return false
      return true
    })
  }, [entries, currentUserEmail])

  const newCount = useMemo(
    () => filteredEntries.reduce((acc, entry) => (seenIds.has(entry.id) ? acc : acc + 1), 0),
    [filteredEntries, seenIds],
  )

  const handleToggleOpen = () => {
    setIsOpen((prev) => {
      const next = !prev
      if (next) {
        setSeenIds(new Set(filteredEntries.map((entry) => entry.id)))
      }
      return next
    })
  }

  useEffect(() => {
    if (isOpen) {
      setSeenIds(new Set(filteredEntries.map((entry) => entry.id)))
    }
  }, [isOpen, filteredEntries])

  const handleRollback = async (entry: RecentChangeEntry) => {
    if (!rollbackEntry) return
    if (!window.confirm(`이 변경(${getActionLabel(entry)})을 롤백하시겠습니까?`)) return
    setRollingBackId(entry.id)
    try {
      await rollbackEntry(entry)
      await refresh()
    } catch (error) {
      console.error("Rollback failed:", error)
    } finally {
      setRollingBackId(null)
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={handleToggleOpen}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {isOpen ? <ChevronDown className="h-4 w-4 text-amber-700" /> : <ChevronRight className="h-4 w-4 text-amber-700" />}
          <Bell className="h-4 w-4 text-amber-700" />
          <span className="text-sm font-semibold text-amber-900">{title}</span>
          <Badge variant="outline" className="border-amber-300 bg-white text-amber-800">
            {filteredEntries.length}
          </Badge>
          {newCount > 0 && !isOpen && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
              {newCount}
            </span>
          )}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={isLoading}
          className="h-7 px-2 text-xs text-amber-800 hover:bg-amber-100"
          title="새로고침"
        >
          <RefreshCcw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
      </div>
      {isOpen && (
        <div className="border-t border-amber-200/80 px-3 pb-3 pt-2">
          <p className="mb-2 text-[11px] text-amber-800/80">{description}</p>
          {filteredEntries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-amber-200 bg-white px-3 py-4 text-center text-xs text-amber-700">
              {emptyMessage}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {filteredEntries.slice(0, 12).map((entry) => {
                const context = lookupTaskContext(projects, entry.projectId, entry.entityId)
                const diffs = computeDiffFields(entry)
                const sourceLabel = entry.source ? SOURCE_LABELS[entry.source] || entry.source : null
                return (
                  <li
                    key={entry.id}
                    className="rounded-lg border border-amber-100 bg-white px-3 py-2 text-xs shadow-sm"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-800">{formatActorName(entry.actorEmail)}</span>
                      <span className="text-slate-500">{getActionLabel(entry)}</span>
                      {sourceLabel && (
                        <Badge variant="outline" className="border-sky-200 bg-sky-50 text-[10px] text-sky-700">
                          {sourceLabel}
                        </Badge>
                      )}
                      <span className="ml-auto text-[10px] text-slate-400">{formatRelativeTime(entry.createdAt)}</span>
                    </div>
                    {context && (
                      <div className="mt-1 flex items-center gap-1 text-slate-700">
                        <span className="text-slate-500">{context.projectName}</span>
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                        <span className="font-medium">{context.taskTitle}</span>
                      </div>
                    )}
                    {diffs.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {diffs.slice(0, 4).map((diff) => (
                          <li key={diff.key} className="text-[11px] text-slate-600">
                            <span className="font-medium text-slate-700">{FIELD_LABELS[diff.key] || diff.key}: </span>
                            <span className="text-slate-400 line-through">{formatValueForDiff(diff.before)}</span>
                            <span className="mx-1 text-slate-400">→</span>
                            <span className="text-slate-800">{formatValueForDiff(diff.after)}</span>
                          </li>
                        ))}
                        {diffs.length > 4 && (
                          <li className="text-[10px] text-slate-400">… {diffs.length - 4}개 항목 추가 변경</li>
                        )}
                      </ul>
                    )}
                    <div className="mt-2 flex items-center justify-end gap-1">
                      {onJump && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => onJump(entry)}
                        >
                          이동
                        </Button>
                      )}
                      {rollbackEntry && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          disabled={rollingBackId === entry.id}
                          onClick={() => void handleRollback(entry)}
                        >
                          <RotateCcw className="h-3 w-3" />
                          롤백
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
              {filteredEntries.length > 12 && (
                <li className="text-center text-[10px] text-amber-700/70">… 최신 12건만 표시 중 (전체 {filteredEntries.length}건)</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
