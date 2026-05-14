"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
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
import { ProjectPmSelect } from "@/components/project-pm-select"
import type { Project, ProjectPmOption, ProjectType } from "@/lib/data"

interface AddProjectDialogProps {
  onAddProject: (project: Project) => void
  trigger?: React.ReactNode
  pmOptions?: ProjectPmOption[]
}

const UNASSIGNED_PM_VALUE = "__none__"

export function AddProjectDialog({ onAddProject, trigger, pmOptions = [] }: AddProjectDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState<ProjectType>("SI")
  const [period, setPeriod] = useState("")
  const [pmEmail, setPmEmail] = useState(UNASSIGNED_PM_VALUE)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name) return

    const newProject: Project = {
      id: `p${Date.now()}`,
      name,
      type,
      period,
      pmEmail: pmEmail === UNASSIGNED_PM_VALUE ? "" : pmEmail,
      isHidden: false,
      tasks: [],
    }

    onAddProject(newProject)
    setOpen(false)
    setName("")
    setType("SI")
    setPeriod("")
    setPmEmail(UNASSIGNED_PM_VALUE)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            새 프로젝트
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>새 프로젝트 추가</DialogTitle>
            <DialogDescription>
              새로운 프로젝트의 기본 정보를 입력하세요. 생성 후 업무를 추가할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">프로젝트명</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 차세대 시스템 구축"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="type">구분</Label>
              <Select value={type} onValueChange={(value) => setType(value as ProjectType)}>
                <SelectTrigger id="type">
                  <SelectValue placeholder="구분 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SI">SI</SelectItem>
                  <SelectItem value="R&D">R&D</SelectItem>
                  <SelectItem value="S/F">S/F</SelectItem>
                  <SelectItem value="공사">공사</SelectItem>
                  <SelectItem value="A/S">A/S</SelectItem>
                  <SelectItem value="Etc">Etc</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="period">기간</Label>
              <Input
                id="period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="예: 2026.03 ~ 2026.12"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pm">PM</Label>
              <ProjectPmSelect
                id="pm"
                value={pmEmail}
                onChange={setPmEmail}
                options={pmOptions}
                unassignedValue={UNASSIGNED_PM_VALUE}
              />
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
