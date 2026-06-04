"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, CalendarIcon, Check } from "lucide-react"
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
import { calculateManDaysBetweenDates } from "@/lib/man-days"
import {
  DEFAULT_DEPARTMENT_PERSON_SETTINGS,
  resolveDepartmentPersonGroup,
  subscribeDepartmentPersonSettings,
} from "@/lib/firestore-service"
import type { Task, TaskStatus, TaskCategory } from "@/lib/data"

interface AddTaskDialogProps {
  projectId: string
  parentId?: string
  defaultPerson?: string
  defaultDepartment?: string
  onAddTask: (task: Task) => void
  trigger?: React.ReactNode
}

export function AddTaskDialog({
  projectId,
  parentId,
  defaultPerson = "",
  defaultDepartment = "전략",
  onAddTask,
  trigger,
}: AddTaskDialogProps) {
  const parseListValue = (value: string): string[] =>
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)

  const joinListValue = (values: string[]): string =>
    Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).join(", ")

  const [open, setOpen] = useState(false)
  const [taskName, setTaskName] = useState("")
  const [category, setCategory] = useState<TaskCategory>("일반")
  const [department, setDepartment] = useState(defaultDepartment)
  const [personList, setPersonList] = useState<string[]>(parseListValue(defaultPerson))
  const [status, setStatus] = useState<TaskStatus>("예정")
  const [manDays, setManDays] = useState("0")
  const [includeWeekends, setIncludeWeekends] = useState(false)
  const [startDate, setStartDate] = useState<Date | undefined>(new Date())
  const [endDate, setEndDate] = useState<Date | undefined>(new Date())
  const [departmentPersonSettings, setDepartmentPersonSettings] = useState(DEFAULT_DEPARTMENT_PERSON_SETTINGS)

  useEffect(() => {
    const unsubscribe = subscribeDepartmentPersonSettings(setDepartmentPersonSettings)
    return () => unsubscribe()
  }, [])

  const personOptions = useMemo(() => {
    const group = resolveDepartmentPersonGroup(department)
    return departmentPersonSettings[group] || []
  }, [department, departmentPersonSettings])

  const getAssignableDefaultPersons = (value: string, options: string[]) => {
    const optionSet = new Set(options)
    return parseListValue(value).filter((person) => optionSet.has(person))
  }

  useEffect(() => {
    if (!open) return
    const fromDefault = getAssignableDefaultPersons(defaultPerson, personOptions)
    if (fromDefault.length > 0) {
      setPersonList(fromDefault)
      return
    }
    setPersonList((prev) => {
      const activePrev = prev.filter((person) => personOptions.includes(person))
      return activePrev.length > 0 ? activePrev : personOptions.slice(0, 1)
    })
  }, [defaultPerson, open, personOptions])

  useEffect(() => {
    if (!open) return
    setDepartment(defaultDepartment)
  }, [defaultDepartment, open])

  const formatDate = (date: Date | undefined) => {
    if (!date) return ""
    return format(date, "MM월 dd일", { locale: ko })
  }

  const formatDateDisplay = (date: Date | undefined) => {
    if (!date) return ""
    return format(date, "yyyy-MM-dd", { locale: ko })
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
      person: joinListValue(personList),
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

  const handleAutoCalculateManDays = () => {
    if (!startDate || !endDate) return
    const calculated = calculateManDaysBetweenDates(startDate, endDate, includeWeekends)
    setManDays(String(calculated))
  }

  useEffect(() => {
    if (!startDate || !endDate) return
    const calculated = calculateManDaysBetweenDates(startDate, endDate, includeWeekends)
    setManDays(String(calculated))
  }, [startDate, endDate, includeWeekends])

  const resetForm = () => {
    setTaskName("")
    setCategory("일반")
    setDepartment(defaultDepartment)
    const defaultGroup = resolveDepartmentPersonGroup(defaultDepartment)
    const defaultGroupOptions = departmentPersonSettings[defaultGroup] || []
    const resetDefaultPersons = getAssignableDefaultPersons(defaultPerson, defaultGroupOptions)
    setPersonList(
      resetDefaultPersons.length > 0
        ? resetDefaultPersons
        : defaultGroupOptions[0]
          ? [defaultGroupOptions[0]]
          : [],
    )
    setStatus("예정")
    setManDays("0")
    setIncludeWeekends(false)
    setStartDate(new Date())
    setEndDate(new Date())
  }

  const togglePerson = (owner: string) => {
    setPersonList((prev) => {
      if (prev.includes(owner)) {
        return prev.filter((name) => name !== owner)
      }
      return [...prev, owner]
    })
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
                      <SelectItem value="기타">기타</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="person">담당자</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button id="person" type="button" variant="outline" className="w-full justify-start font-normal">
                      <span className="truncate">{personList.length > 0 ? joinListValue(personList) : "담당자 선택(복수 가능)"}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[260px] p-2" align="start">
                    <div className="max-h-56 space-y-1 overflow-auto">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                        onClick={() => setPersonList([])}
                      >
                        <span>담당자 미지정</span>
                        {personList.length === 0 && <Check className="h-3.5 w-3.5" />}
                      </button>
                      {personOptions.map((owner) => {
                        const checked = personList.includes(owner)
                        return (
                          <button
                            key={owner}
                            type="button"
                            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                            onClick={() => togglePerson(owner)}
                          >
                            <span>{owner}</span>
                            {checked && <Check className="h-3.5 w-3.5" />}
                          </button>
                        )
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="manDays">공수 (일)</Label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={includeWeekends}
                      onChange={(e) => setIncludeWeekends(e.target.checked)}
                    />
                    주말 포함
                  </label>
                </div>
                <div className="flex gap-2">
                  <Input id="manDays" type="number" step="0.5" value={manDays} onChange={(e) => setManDays(e.target.value)} />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={!startDate || !endDate}
                    onClick={handleAutoCalculateManDays}
                  >
                    자동 계산
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>시작일</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? formatDateDisplay(startDate) : <span>날짜 선택</span>}
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
                      {endDate ? formatDateDisplay(endDate) : <span>날짜 선택</span>}
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
                  <SelectItem value="예정">예정</SelectItem>
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
