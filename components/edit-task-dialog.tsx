"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Pencil, CalendarIcon, Check, ChevronDown, Lock } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
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
import type { EditableTaskField, Task, TaskStatus, TaskCategory } from "@/lib/data"

interface EditTaskDialogProps {
  task: Task
  onEditTask: (task: Task) => void
  defaultDepartment?: string
  open?: boolean
  openOnDoubleClick?: boolean
  trigger?: React.ReactNode
  onOpenChange?: (open: boolean) => void
  editableFields?: ReadonlyArray<EditableTaskField>
  lockedFieldHint?: string
}

const LockIcon = ({ hint }: { hint: string }) => (
  <span
    className="inline-flex items-center text-muted-foreground"
    title={hint}
    aria-label={hint}
  >
    <Lock className="h-3 w-3" />
  </span>
)

function parseKoreanDate(value: string): Date | undefined {
  const text = (value || "").trim()
  if (!text) return undefined

  const currentYear = new Date().getFullYear()

  // YYYY.MM.DD, YYYY-MM-DD, YYYY/MM/DD
  const ymd = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (ymd) {
    return new Date(
      Number.parseInt(ymd[1], 10),
      Number.parseInt(ymd[2], 10) - 1,
      Number.parseInt(ymd[3], 10),
    )
  }

  // MM월 dd일, MM/DD, MM-DD
  const md = text.match(/(\d{1,2})\D+(\d{1,2})/)
  if (md) {
    return new Date(currentYear, Number.parseInt(md[1], 10) - 1, Number.parseInt(md[2], 10))
  }

  return undefined
}

export function EditTaskDialog({
  task,
  onEditTask,
  defaultDepartment = "전략",
  open: controlledOpen,
  openOnDoubleClick = false,
  trigger,
  onOpenChange,
  editableFields,
  lockedFieldHint = "관리자만 수정할 수 있는 항목입니다.",
}: EditTaskDialogProps) {
  const editableFieldSet = useMemo(
    () => (editableFields ? new Set<EditableTaskField>(editableFields) : null),
    [editableFields],
  )
  const isFieldEditable = (field: EditableTaskField) =>
    editableFieldSet === null || editableFieldSet.has(field)
  const hasFieldRestriction = editableFieldSet !== null
  const parseListValue = (value: string): string[] =>
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)

  const joinListValue = (values: string[]): string =>
    Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).join(", ")

  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const [taskName, setTaskName] = useState(task.task)
  const [category, setCategory] = useState<TaskCategory>(task.category)
  const [memo, setMemo] = useState(task.memo || "")
  const [department, setDepartment] = useState(task.department || defaultDepartment)
  const [personList, setPersonList] = useState<string[]>(parseListValue(task.person))
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [manDays, setManDays] = useState(task.manDays.toString())
  const [includeWeekends, setIncludeWeekends] = useState(false)
  const [startDate, setStartDate] = useState<Date | undefined>()
  const [endDate, setEndDate] = useState<Date | undefined>()
  const [departmentPersonSettings, setDepartmentPersonSettings] = useState(DEFAULT_DEPARTMENT_PERSON_SETTINGS)
  const initializedForCurrentOpenRef = useRef(false)

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setInternalOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }

  useEffect(() => {
    const unsubscribe = subscribeDepartmentPersonSettings(setDepartmentPersonSettings)
    return () => unsubscribe()
  }, [])

  const personOptions = useMemo(() => {
    const group = resolveDepartmentPersonGroup(department)
    return departmentPersonSettings[group] || []
  }, [department, departmentPersonSettings])
  const personOptionValues = useMemo(
    () => Array.from(new Set([...personOptions, ...personList])).filter(Boolean),
    [personList, personOptions],
  )

  useEffect(() => {
    if (!open) {
      initializedForCurrentOpenRef.current = false
      return
    }
    if (initializedForCurrentOpenRef.current) return

    setTaskName(task.task)
    setCategory(task.category)
    setMemo(task.memo || "")
    setDepartment(task.department || defaultDepartment)
    setPersonList(parseListValue(task.person))
    setStatus(task.status)
    setManDays(task.manDays.toString())
    setIncludeWeekends(false)
    setStartDate(parseKoreanDate(task.startDate))
    setEndDate(parseKoreanDate(task.endDate))
    initializedForCurrentOpenRef.current = true
  }, [defaultDepartment, open, task])

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
    if (!taskName) return

    const updatedTask: Task = {
      ...task,
      task: isFieldEditable("task") ? taskName : task.task,
      memo: isFieldEditable("memo") ? memo.trim() : task.memo,
      category: isFieldEditable("category") ? category : task.category,
      department: isFieldEditable("department") ? department : task.department,
      person: isFieldEditable("person") ? joinListValue(personList) : task.person,
      startDate: isFieldEditable("startDate")
        ? (startDate ? formatDate(startDate) : task.startDate)
        : task.startDate,
      endDate: isFieldEditable("endDate")
        ? (endDate ? formatDate(endDate) : task.endDate)
        : task.endDate,
      status: isFieldEditable("status") ? status : task.status,
      manDays: isFieldEditable("manDays") ? (parseFloat(manDays) || 0) : task.manDays,
    }

    onEditTask(updatedTask)
    handleDialogOpenChange(false)
  }

  const handleAutoCalculateManDays = () => {
    if (!startDate || !endDate) return
    const calculated = calculateManDaysBetweenDates(startDate, endDate, includeWeekends)
    setManDays(String(calculated))
  }

  useEffect(() => {
    if (!startDate || !endDate) return
    if (!isFieldEditable("manDays")) return
    const calculated = calculateManDaysBetweenDates(startDate, endDate, includeWeekends)
    setManDays(String(calculated))
  }, [startDate, endDate, includeWeekends, editableFieldSet])

  const togglePerson = (owner: string) => {
    setPersonList((prev) => {
      if (prev.includes(owner)) {
        return prev.filter((name) => name !== owner)
      }
      return [...prev, owner]
    })
  }

  const shouldRenderTrigger = controlledOpen === undefined || trigger !== undefined
  const triggerNode =
    trigger === undefined ? (
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
        <Pencil className="h-3.5 w-3.5" />
        <span className="sr-only">수정</span>
      </Button>
    ) : (
      trigger
    )

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      {shouldRenderTrigger
        ? openOnDoubleClick
          ? (
              <div onDoubleClick={() => handleDialogOpenChange(true)}>
                {triggerNode}
              </div>
            )
          : (
              <DialogTrigger asChild>
                {triggerNode}
              </DialogTrigger>
            )
        : null}
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>업무 수정</DialogTitle>
            <DialogDescription>
              {hasFieldRestriction
                ? "내가 편집할 수 있는 항목만 활성화됩니다. 잠금 표시된 항목은 관리자만 수정할 수 있습니다."
                : "업무 정보를 수정합니다."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-task" className="flex items-center gap-1.5">
                업무내용
                {!isFieldEditable("task") && <LockIcon hint={lockedFieldHint} />}
              </Label>
              <Input
                id="edit-task"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                required
                disabled={!isFieldEditable("task")}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5">
                  구분
                  {!isFieldEditable("category") && <LockIcon hint={lockedFieldHint} />}
                </Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as TaskCategory)}
                  disabled={!isFieldEditable("category")}
                >
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
                <Label className="flex items-center gap-1.5">
                  부서
                  {!isFieldEditable("department") && <LockIcon hint={lockedFieldHint} />}
                </Label>
                <Select value={department} onValueChange={setDepartment} disabled={!isFieldEditable("department")}>
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
                <Label htmlFor="edit-person" className="flex items-center gap-1.5">
                  담당자
                  {!isFieldEditable("person") && <LockIcon hint={lockedFieldHint} />}
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="edit-person"
                      type="button"
                      variant="outline"
                      className="w-full justify-between font-normal"
                      disabled={!isFieldEditable("person")}
                    >
                      <span className="truncate">{personList.length > 0 ? joinListValue(personList) : "담당자 선택(복수 가능)"}</span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-2" align="start">
                    <div className="max-h-56 space-y-1 overflow-auto">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                        onClick={() => setPersonList([])}
                      >
                        <span>담당자 미지정</span>
                        {personList.length === 0 && <Check className="h-3.5 w-3.5" />}
                      </button>
                      {personOptionValues.map((owner) => {
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
                  <Label htmlFor="edit-manDays" className="flex items-center gap-1.5">
                    공수 (일)
                    {!isFieldEditable("manDays") && <LockIcon hint={lockedFieldHint} />}
                  </Label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={includeWeekends}
                      onChange={(e) => setIncludeWeekends(e.target.checked)}
                      disabled={!isFieldEditable("manDays")}
                    />
                    주말 포함
                  </label>
                </div>
                <div className="flex gap-2">
                  <Input
                    id="edit-manDays"
                    type="number"
                    step="0.5"
                    value={manDays}
                    onChange={(e) => setManDays(e.target.value)}
                    disabled={!isFieldEditable("manDays")}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={!startDate || !endDate || !isFieldEditable("manDays")}
                    onClick={handleAutoCalculateManDays}
                  >
                    자동 계산
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5">
                  시작일
                  {!isFieldEditable("startDate") && <LockIcon hint={lockedFieldHint} />}
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")}
                      disabled={!isFieldEditable("startDate")}
                    >
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
                <Label className="flex items-center gap-1.5">
                  종료일
                  {!isFieldEditable("endDate") && <LockIcon hint={lockedFieldHint} />}
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !endDate && "text-muted-foreground")}
                      disabled={!isFieldEditable("endDate")}
                    >
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
              <Label className="flex items-center gap-1.5">
                상태
                {!isFieldEditable("status") && <LockIcon hint={lockedFieldHint} />}
              </Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as TaskStatus)}
                disabled={!isFieldEditable("status")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="예정">예정</SelectItem>
                  <SelectItem value="진행">진행</SelectItem>
                  <SelectItem value="완료">완료</SelectItem>
                  <SelectItem value="취소">취소</SelectItem>
                  <SelectItem value="미정">미정</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-memo" className="flex items-center gap-1.5">
                메모
                {!isFieldEditable("memo") && <LockIcon hint={lockedFieldHint} />}
              </Label>
              <Textarea
                id="edit-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="업무 관련 메모를 입력하세요"
                rows={3}
                disabled={!isFieldEditable("memo")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
              취소
            </Button>
            <Button type="submit">저장</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
