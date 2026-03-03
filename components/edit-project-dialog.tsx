"use client"

import { useState, useEffect } from "react"
import { Pencil } from "lucide-react"
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
import type { Project, ProjectType } from "@/lib/data"

interface EditProjectDialogProps {
  project: Project
  onEditProject: (project: Project) => void
}

export function EditProjectDialog({ project, onEditProject }: EditProjectDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(project.name)
  const [type, setType] = useState<ProjectType>(project.type)
  const [period, setPeriod] = useState(project.period || "")

  useEffect(() => {
    if (open) {
      setName(project.name)
      setType(project.type)
      setPeriod(project.period || "")
    }
  }, [open, project])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name) return

    onEditProject({
      ...project,
      name,
      type,
      period,
    })
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
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{"프로젝트 정보 수정"}</DialogTitle>
            <DialogDescription>
              {"프로젝트의 기본 정보를 수정합니다."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">{"프로젝트명"}</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="프로젝트 이름을 입력하세요"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-type">{"구분"}</Label>
              <Select value={type} onValueChange={(v) => setType(v as ProjectType)}>
                <SelectTrigger id="edit-type">
                  <SelectValue placeholder="구분 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SI">{"SI"}</SelectItem>
                  <SelectItem value="R&D">{"R&D"}</SelectItem>
                  <SelectItem value="S/F">{"S/F"}</SelectItem>
                  <SelectItem value="Etc">{"Etc"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-period">{"기간"}</Label>
              <Input
                id="edit-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="예: 2025.04 ~ 2025.12"
              />
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
