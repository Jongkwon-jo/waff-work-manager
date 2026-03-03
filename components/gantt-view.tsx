"use client"

import { useMemo, useState, useRef, useEffect } from "react"
import type { Project, Task, TaskStatus } from "@/lib/data"
import { ProjectTypeBadge, StatusBadge } from "@/components/status-badge"
import { EditTaskDialog } from "./edit-task-dialog"
import { Button } from "./ui/button"
import { Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface GanttViewProps {
  projects: Project[]
  statusFilter: TaskStatus | "all"
  departmentFilter: string
  personFilter: string
  searchQuery: string
  onEditTask: (task: Task) => void
  onDeleteTask: (taskId: string, projectId: string) => void
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getDayOfWeek(year: number, month: number, day: number) {
  const days = ["일", "월", "화", "수", "목", "금", "토"]
  return days[new Date(year, month, day).getDay()]
}

function parseDate(dateStr: string): { month: number; day: number } | null {
  const match = dateStr.match(/(\d{1,2})월\s*(\d{1,2})일/)
  if (match) {
    return { month: parseInt(match[1]) - 1, day: parseInt(match[2]) }
  }
  return null
}

const CELL_WIDTH = 28
const MONTHS = [
  { year: 2026, month: 1, label: "2월" },
  { year: 2026, month: 2, label: "3월" },
  { year: 2026, month: 3, label: "4월" },
]

export function GanttView({
  projects,
  statusFilter,
  departmentFilter,
  personFilter,
  searchQuery,
  onEditTask,
  onDeleteTask,
}: GanttViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [dragInfo, setDragInfo] = useState<{
    taskId: string;
    type: "move" | "resize-left" | "resize-right";
    initialX: number;
    initialLeft: number;
    initialWidth: number;
  } | null>(null);

  const filteredProjects = useMemo(() => {
    return projects
      .map((project) => {
        const flattenWithDepth = (tasks: Task[], depth = 0): (Task & { depth: number })[] => {
          return tasks.reduce((acc, task) => {
            const taskWithDepth = { ...task, depth };
            return [...acc, taskWithDepth, ...flattenWithDepth(task.subTasks || [], depth + 1)];
          }, [] as (Task & { depth: number })[])
        }
        const allTasks = flattenWithDepth(project.tasks)
        const filteredTasks = allTasks.filter((task) => {
          if (statusFilter !== "all" && task.status !== statusFilter) return false
          if (departmentFilter !== "all" && !task.department.includes(departmentFilter)) return false
          if (personFilter !== "all" && !task.person.includes(personFilter)) return false
          if (searchQuery && !task.task.toLowerCase().includes(searchQuery.toLowerCase()) && !project.name.toLowerCase().includes(searchQuery.toLowerCase())) return false
          return true
        })
        return { ...project, tasks: filteredTasks }
      })
      .filter((project) => {
        if (searchQuery) return project.tasks.length > 0 || project.name.toLowerCase().includes(searchQuery.toLowerCase())
        if (statusFilter !== "all" || departmentFilter !== "all" || personFilter !== "all") return project.tasks.length > 0
        return true
      })
  }, [projects, statusFilter, departmentFilter, personFilter, searchQuery])

  const allDays = useMemo(() => {
    const today = new Date()
    const days: any[] = []
    for (const m of MONTHS) {
      const daysInMonth = getDaysInMonth(m.year, m.month)
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = getDayOfWeek(m.year, m.month, d)
        days.push({
          year: m.year,
          month: m.month,
          day: d,
          label: `${d}`,
          dow,
          isWeekend: dow === "토" || dow === "일",
          isToday: today.getFullYear() === m.year && today.getMonth() === m.month && today.getDate() === d,
        })
      }
    }
    return days
  }, [])

  const getBarPosition = (startStr: string, endStr: string) => {
    const start = parseDate(startStr)
    const end = parseDate(endStr)
    if (!start || !end) return null
    const startIdx = allDays.findIndex(d => d.month === start.month && d.day === start.day)
    const endIdx = allDays.findIndex(d => d.month === end.month && d.day === end.day)
    if (startIdx === -1 || endIdx === -1) return null
    return { left: startIdx * CELL_WIDTH, width: (endIdx - startIdx + 1) * CELL_WIDTH }
  }

  const handleMouseDown = (e: React.MouseEvent, task: Task, type: "move" | "resize-left" | "resize-right") => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getBarPosition(task.startDate, task.endDate);
    if (!pos) return;
    setDragInfo({
      taskId: task.id,
      type,
      initialX: e.clientX,
      initialLeft: pos.left,
      initialWidth: pos.width
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragInfo) return;
      const barElement = document.getElementById(`bar-${dragInfo.taskId}`);
      if (!barElement) return;
      const deltaX = e.clientX - dragInfo.initialX;
      
      if (dragInfo.type === "move") {
        barElement.style.left = `${dragInfo.initialLeft + deltaX}px`;
      } else if (dragInfo.type === "resize-left") {
        const newLeft = dragInfo.initialLeft + deltaX;
        const newWidth = dragInfo.initialWidth - deltaX;
        if (newWidth >= CELL_WIDTH) {
          barElement.style.left = `${newLeft}px`;
          barElement.style.width = `${newWidth}px`;
        }
      } else if (dragInfo.type === "resize-right") {
        const newWidth = dragInfo.initialWidth + deltaX;
        if (newWidth >= CELL_WIDTH) {
          barElement.style.width = `${newWidth}px`;
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragInfo) return;
      const deltaX = e.clientX - dragInfo.initialX;
      const daysDelta = Math.round(deltaX / CELL_WIDTH);
      
      // 모든 하위 업무를 포함한 전체 업무 리스트에서 탐색
      const allFlattenedTasks = projects.flatMap(p => {
        const flatten = (ts: Task[]): Task[] => ts.reduce((a, t) => [...a, t, ...flatten(t.subTasks || [])], [] as Task[]);
        return flatten(p.tasks);
      });
      
      const task = allFlattenedTasks.find(t => t.id === dragInfo.taskId);

      if (task && daysDelta !== 0) {
        const start = parseDate(task.startDate);
        const end = parseDate(task.endDate);
        if (start && end) {
          const startIdx = allDays.findIndex(d => d.month === start.month && d.day === start.day);
          const endIdx = allDays.findIndex(d => d.month === end.month && d.day === end.day);
          
          let nS = startIdx;
          let nE = endIdx;

          if (dragInfo.type === "move") {
            nS = Math.max(0, Math.min(startIdx + daysDelta, allDays.length - 1));
            nE = Math.max(nS, Math.min(endIdx + daysDelta, allDays.length - 1));
          } else if (dragInfo.type === "resize-left") {
            nS = Math.max(0, Math.min(startIdx + daysDelta, endIdx)); // 종료일보다 늦어질 수 없음
          } else if (dragInfo.type === "resize-right") {
            nE = Math.max(startIdx, Math.min(endIdx + daysDelta, allDays.length - 1)); // 시작일보다 빨라질 수 없음
          }

          onEditTask({
            ...task,
            startDate: `${allDays[nS].month + 1}월 ${allDays[nS].day}일`,
            endDate: `${allDays[nE].month + 1}월 ${allDays[nE].day}일`
          });
        }
      }
      setDragInfo(null);
    };

    if (dragInfo) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragInfo, allDays, onEditTask, projects]);

  const statusColor: Record<TaskStatus, string> = {
    "완료": "bg-emerald-400", "진행": "bg-blue-400", "대기": "bg-amber-400", "보류": "bg-slate-300", "미정": "bg-rose-300",
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden flex flex-col h-[65vh]">
      <div ref={scrollContainerRef} className="flex-1 overflow-auto custom-scrollbar">
        <div className="relative min-w-fit flex flex-col">
          <div className="sticky top-0 z-40 flex bg-card border-b border-border shadow-sm">
            <div className="sticky left-0 z-50 w-80 shrink-0 border-r border-border bg-card px-4 py-3 flex items-end">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{"Project & Task Details"}</span>
            </div>
            <div className="shrink-0">
              <div className="flex border-b border-border bg-muted/20">
                {MONTHS.map((m) => (
                  <div key={`${m.year}-${m.month}`} style={{ width: getDaysInMonth(m.year, m.month) * CELL_WIDTH }} className="border-r border-border px-2 py-2 text-center text-[10px] font-bold text-card-foreground">
                    {`${m.year}년 ${m.label}`}
                  </div>
                ))}
              </div>
              <div className="flex bg-card">
                {allDays.map((d, i) => (
                  <div key={i} style={{ width: CELL_WIDTH }} className={cn("shrink-0 border-r border-border py-1.5 text-center", d.isWeekend && "bg-muted/50", d.isToday && "bg-primary/10")}>
                    <div className="text-[10px] leading-tight font-medium text-muted-foreground">{d.label}</div>
                    <div className={cn("text-[8px] leading-tight font-bold", d.isWeekend ? "text-rose-400" : "text-muted-foreground/60")}>{d.dow}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col">
            {filteredProjects.map((project) => (
              <div key={project.id}>
                <div className="flex border-b border-border bg-muted/40 sticky top-[55px] z-30">
                  <div className="sticky left-0 z-30 flex w-80 shrink-0 items-center gap-3 border-r border-border bg-muted/40 px-4 py-1.5 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                    <ProjectTypeBadge type={project.type} />
                    <span className="truncate text-xs font-bold text-card-foreground">{project.name}</span>
                  </div>
                  <div style={{ width: allDays.length * CELL_WIDTH }} className="shrink-0 h-7" />
                </div>

                {project.tasks.map((task: any) => {
                  const bar = getBarPosition(task.startDate, task.endDate)
                  return (
                    <div key={task.id} className="group/task flex border-b border-border/50 transition-colors hover:bg-accent/5">
                      <div className="sticky left-0 z-20 flex w-80 shrink-0 items-center border-r border-border bg-card px-4 py-1.5 group-hover/task:bg-accent/10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] overflow-hidden">
                        <div className="flex items-center gap-2 w-full min-w-0">
                          <div style={{ width: task.depth * 12 }} className="shrink-0" />
                          {task.depth > 0 && <span className="text-[10px] text-muted-foreground/50 shrink-0">{"└"}</span>}
                          <EditTaskDialog task={task} onEditTask={onEditTask} trigger={
                            <button className="flex items-center gap-3 text-left hover:text-primary transition-colors min-w-0 flex-1 overflow-hidden">
                              <div className="shrink-0 w-[60px] flex justify-center"><StatusBadge status={task.status} /></div>
                              <span className="truncate text-xs text-foreground font-semibold" title={task.task}>{task.task}</span>
                            </button>
                          } />
                          <Button variant="ghost" size="icon" className="ml-1 h-6 w-6 shrink-0 opacity-0 group-hover/task:opacity-100" onClick={() => { if (confirm("삭제하시겠습니까?")) onDeleteTask(task.id, task.projectId) }}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      
                      <div style={{ width: allDays.length * CELL_WIDTH }} className="relative shrink-0 h-9">
                        {allDays.map((d, i) => (
                          <div key={i} className="absolute inset-y-0 pointer-events-none" style={{ left: i * CELL_WIDTH, width: CELL_WIDTH }}>
                            {d.isWeekend && <div className="absolute inset-0 bg-muted/15" />}
                            {d.isToday && (
                              <div className="absolute inset-0 bg-yellow-400/10 ring-1 ring-yellow-400/30 z-10" />
                            )}
                          </div>
                        ))}
                        
                        {bar && (
                          <div
                            id={`bar-${task.id}`}
                            className={cn(
                              "absolute top-1/2 -translate-y-1/2 rounded-md h-6 shadow-sm transition-all select-none cursor-grab active:cursor-grabbing",
                              statusColor[task.status as TaskStatus],
                              dragInfo?.taskId === task.id ? "opacity-100 scale-y-110 z-50 shadow-md ring-2 ring-white/50" : "opacity-90 hover:opacity-100"
                            )}
                            style={{ left: bar.left + 2, width: bar.width - 4 }}
                            onMouseDown={(e) => handleMouseDown(e, task, "move")}
                          >
                            {/* Resize Handle - Left */}
                            <div 
                              className="absolute left-0 top-0 bottom-0 w-3 cursor-w-resize hover:bg-black/10 rounded-l-md z-10" 
                              onMouseDown={(e) => handleMouseDown(e, task, "resize-left")} 
                            />
                            
                            {/* Resize Handle - Right */}
                            <div 
                              className="absolute right-0 top-0 bottom-0 w-3 cursor-e-resize hover:bg-black/10 rounded-r-md z-10" 
                              onMouseDown={(e) => handleMouseDown(e, task, "resize-right")} 
                            />
                            
                            <div className="px-3 text-[10px] text-white font-bold truncate h-full flex items-center pointer-events-none">
                              {task.task}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 5px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 5px; border: 2px solid #f1f1f1; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </div>
  )
}