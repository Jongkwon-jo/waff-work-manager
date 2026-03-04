"use client"

import { useMemo, useState } from "react"
import { Plus, CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { getPersonList } from "@/lib/data"
import type { Task, TaskStatus, TaskCategory } from "@/lib/data"

interface AddTaskDialogProps {
  projectId: string
  parentId?: string
  onAddTask: (task: Task) => void
  trigger?: React.ReactNode
}

export function AddTaskDialog({ projectId, parentId, onAddTask, trigger }: AddTaskDialogProps) {
  const [open, setOpen] = useState(false)
  const [taskName, setTaskName] = useState("")
  const [category, setCategory] = useState<TaskCategory>("일반")
  const [department, setDepartment] = useState("전략")
  const [person, setPerson] = useState("")
  const [status, setStatus] = useState<TaskStatus>("대기")
  const [manDays, setManDays] = useState("0")
  const [startDate, setStartDate] = useState<Date | undefined>(new Date())
  const [endDate, setEndDate] = useState<Date | undefined>(new Date())

  const personOptions = useMemo(() => getPersonList(), [])

  const formatDate = (date: Date | undefined) => {
    if (!date) return ""
    return format(date, "MM월 dd일", { locale: ko })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!taskName || !startDate || !endDate) return

    const newTask: Task = {
      id: `t${Date.now()}`,
      projectId,
      parentId,
      task: taskName,
      category,
      department,
      person,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      status,
      manDays: parseFloat(manDays) || 0,
      isSubTask: !!parentId,
    }

    onAddTask(newTask)
    setOpen(false)
    resetForm()
  }

  const resetForm = () => {
    setTaskName("")
    setCategory("일반")
    setDepartment("전략")
    setPerson("")
    setStatus("대기")
    setManDays("0")
    setStartDate(new Date())
    setEndDate(new Date())
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]">
            <Plus className="h-3 w-3" />
            업무 추가
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{parentId ? "하위 업무 추가" : "새 업무 추가"}</DialogTitle>
            <DialogDescription>
              {parentId ? "선택한 업무의 하위 업무 정보를 입력하세요." : "프로젝트의 새 업무 정보를 입력하세요."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="task">업무내용</Label>
              <Input id="task" value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="수행할 업무를 입력하세요" required />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>구분</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as TaskCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="일반">일반</SelectItem>
                    <SelectItem value="중요">중요</SelectItem>
                    <SelectItem value="정기">정기</SelectItem>
                    <SelectItem value="상시">상시</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>부서</Label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="전략">전략</SelectItem>
                    <SelectItem value="ICT">ICT</SelectItem>
                    <SelectItem value="FA">FA</SelectItem>
                    <SelectItem value="기술고문">기술고문</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="person">담당자</Label>
                <Select value={person || "__none__"} onValueChange={(v) => setPerson(v === "__none__" ? "" : v)}>
                  <SelectTrigger id="person">
                    <SelectValue placeholder="담당자 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">담당자 미지정</SelectItem>
                    {personOptions.map((owner) => (
                      <SelectItem key={owner} value={owner}>
                        {owner}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="manDays">공수 (일)</Label>
                <Input id="manDays" type="number" step="0.5" value={manDays} onChange={(e) => setManDays(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>시작일</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "MM월 dd일", { locale: ko }) : <span>날짜 선택</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="grid gap-2">
                <Label>종료일</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !endDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "MM월 dd일", { locale: ko }) : <span>날짜 선택</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>상태</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="대기">대기</SelectItem>
                  <SelectItem value="진행">진행</SelectItem>
                  <SelectItem value="완료">완료</SelectItem>
                  <SelectItem value="보류">보류</SelectItem>
                  <SelectItem value="미정">미정</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="submit">저장</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
