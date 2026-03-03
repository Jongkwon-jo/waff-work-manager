"use client"

import { useState, useEffect } from "react"
import { Pencil, CalendarIcon } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format, parse } from "date-fns"
import { ko } from "date-fns/locale"
import { cn } from "@/lib/utils"
import type { Task, TaskStatus, TaskCategory } from "@/lib/data"

interface EditTaskDialogProps {
  task: Task
  onEditTask: (task: Task) => void
}

export function EditTaskDialog({ task, onEditTask }: EditTaskDialogProps) {
  const [open, setOpen] = useState(false)
  const [taskName, setTaskName] = useState(task.task)
  const [category, setCategory] = useState<TaskCategory>(task.category)
  const [department, setDepartment] = useState(task.department)
  const [person, setPerson] = useState(task.person)
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [manDays, setManDays] = useState(task.manDays.toString())
  
  const [startDate, setStartDate] = useState<Date | undefined>()
  const [endDate, setEndDate] = useState<Date | undefined>()

  useEffect(() => {
    if (open) {
      // 기존 "MM월 dd일" 형식을 Date 객체로 변환 시도
      try {
        const currentYear = new Date().getFullYear()
        const sDate = parse(`${currentYear}년 ${task.startDate}`, "yyyy년 MM월 dd일", new Date(), { locale: ko })
        const eDate = parse(`${currentYear}년 ${task.endDate}`, "yyyy년 MM월 dd일", new Date(), { locale: ko })
        if (!isNaN(sDate.getTime())) setStartDate(sDate)
        if (!isNaN(eDate.getTime())) setEndDate(eDate)
      } catch (e) {
        console.error("Date parsing error", e)
      }
    }
  }, [open, task.startDate, task.endDate])

  const formatDate = (date: Date | undefined) => {
    if (!date) return ""
    return format(date, "MM월 dd일", { locale: ko })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!taskName || !startDate || !endDate) return

    const updatedTask: Task = {
      ...task,
      task: taskName,
      category,
      department,
      person,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      status,
      manDays: parseFloat(manDays) || 0,
    }

    onEditTask(updatedTask)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
          <Pencil className="h-3.5 w-3.5" />
          <span className="sr-only">수정</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{"업무 수정"}</DialogTitle>
            <DialogDescription>
              {"세부 업무 정보를 수정합니다."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-task">{"업무내용"}</Label>
              <Input
                id="edit-task"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>{"구분"}</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as TaskCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="일반">{"일반"}</SelectItem>
                    <SelectItem value="중요">{"중요"}</SelectItem>
                    <SelectItem value="정기">{"정기"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{"부서"}</Label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="전략">{"전략"}</SelectItem>
                    <SelectItem value="ICT">{"ICT"}</SelectItem>
                    <SelectItem value="FA">{"FA"}</SelectItem>
                    <SelectItem value="기술고문">{"기술고문"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-person">{"담당자"}</Label>
                <Input
                  id="edit-person"
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-manDays">{"공수 (일)"}</Label>
                <Input
                  id="edit-manDays"
                  type="number"
                  step="0.5"
                  value={manDays}
                  onChange={(e) => setManDays(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>{"시작일"}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !startDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "PPP", { locale: ko }) : <span>날짜 선택</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="grid gap-2">
                <Label>{"종료일"}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !endDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "PPP", { locale: ko }) : <span>날짜 선택</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>{"상태"}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="대기">{"대기"}</SelectItem>
                  <SelectItem value="진행">{"진행"}</SelectItem>
                  <SelectItem value="완료">{"완료"}</SelectItem>
                  <SelectItem value="보류">{"보류"}</SelectItem>
                  <SelectItem value="미정">{"미정"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {"취소"}
            </Button>
            <Button type="submit">{"저장"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
