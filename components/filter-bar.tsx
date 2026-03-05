"use client"

import { Search, Filter, X, ArrowUpDown } from "lucide-react"
import type { TaskStatus } from "@/lib/data"

export type ProjectSortType = "name" | "type" | "progress" | "latest"

interface FilterBarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  statusFilter: TaskStatus | "all"
  onStatusChange: (status: TaskStatus | "all") => void
  departmentFilter: string
  onDepartmentChange: (dept: string) => void
  personFilter: string
  onPersonChange: (person: string) => void
  sortBy: ProjectSortType
  onSortByChange: (sortBy: ProjectSortType) => void
  departments: string[]
  persons: string[]
}

const statusOptions: { value: TaskStatus | "all"; label: string }[] = [
  { value: "all", label: "전체 상태" },
  { value: "진행", label: "진행" },
  { value: "대기", label: "대기" },
  { value: "보류", label: "보류" },
  { value: "미정", label: "미정" },
  { value: "완료", label: "완료" },
]

const sortOptions: { value: ProjectSortType; label: string }[] = [
  { value: "latest", label: "최신순" },
  { value: "name", label: "프로젝트명순" },
  { value: "type", label: "구분순" },
  { value: "progress", label: "진행률순" },
]

export function FilterBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  departmentFilter,
  onDepartmentChange,
  personFilter,
  onPersonChange,
  sortBy,
  onSortByChange,
  departments,
  persons,
}: FilterBarProps) {
  const hasActiveFilters =
    statusFilter !== "all" || departmentFilter !== "all" || personFilter !== "all" || searchQuery !== ""

  const clearAll = () => {
    onSearchChange("")
    onStatusChange("all")
    onDepartmentChange("all")
    onPersonChange("all")
  }

  return (
    <div className="h-full rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex h-full items-center gap-2 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-card-foreground">필터 및 정렬</span>
          {hasActiveFilters && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <X className="h-3 w-3" />
              초기화
            </button>
          )}
        </div>

        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="프로젝트 또는 업무 검색..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as ProjectSortType)}
              className="bg-transparent text-sm text-foreground focus:outline-none"
            >
              {sortOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => onStatusChange(e.target.value as TaskStatus | "all")}
            className="h-9 shrink-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            value={departmentFilter}
            onChange={(e) => onDepartmentChange(e.target.value)}
            className="h-9 shrink-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">전체 부서</option>
            {departments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>

          <select
            value={personFilter}
            onChange={(e) => onPersonChange(e.target.value)}
            className="h-9 shrink-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">전체 담당자</option>
            {persons.map((person) => (
              <option key={person} value={person}>
                {person}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
