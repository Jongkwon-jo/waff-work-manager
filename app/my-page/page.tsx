"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { signOut } from "firebase/auth"
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock3,
  GripVertical,
  Home,
  LogOut,
  Pencil,
  Plus,
  Star,
  Trash2,
  User,
  UserRoundSearch,
} from "lucide-react"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/components/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CategoryBadge, ProjectTypeBadge, StatusBadge } from "@/components/status-badge"
import { toast } from "sonner"
import {
  addHistoryEntry as addStrategyHistoryEntry,
  DEFAULT_MY_PAGE_EDITABLE_FIELDS,
  isUserOwnerOfTask,
  saveMyPageMemo,
  saveMyPageCollapsedProjectGroups,
  saveMyPagePersonalTasks,
  saveMyPageTaskPreferences,
  subscribeCurrentUserProfile,
  subscribeMyPageEditableFields,
  subscribeToData as subscribeStrategyData,
  updateTaskInDB as updateStrategyTaskInDB,
  type MyPageEditableFieldsSettings,
  type MyPagePersonalTask,
  type MyPageTaskPreference,
} from "@/lib/firestore-service"
import {
  addHistoryEntry as addFaHistoryEntry,
  subscribeToData as subscribeFaData,
  updateTaskInDB as updateFaTaskInDB,
} from "@/lib/firestore-service-fa"
import type { Project, Task } from "@/lib/data"
import { EditTaskDialog } from "@/components/edit-task-dialog"
import { cn } from "@/lib/utils"

type GroupedProject = {
  id: string
  departmentPage: "전략사업부" | "FA 사업부"
  name: string
  type: string
  tasks: ProjectTaskItem[]
}

type ProjectTaskItem = {
  key: string
  departmentPage: GroupedProject["departmentPage"]
  projectName: string
  projectType: string
  task: Task
  sortTime: number
  depth: number
  ancestorNames: string[]
}

const DEFAULT_TASK_PREFERENCE: MyPageTaskPreference = {
  checked: false,
  priority: "medium",
  important: false,
  order: Number.MAX_SAFE_INTEGER,
}

const PROJECT_TASK_DND_MIME = "application/x-workhub-project-task"
const PERSONAL_TASK_DND_MIME = "application/x-workhub-personal-task"


const serializeTaskForHistory = (task: Task) => {
  const payload: Record<string, unknown> = {
    projectId: task.projectId,
    task: task.task,
    category: task.category,
    department: task.department,
    person: task.person,
    startDate: task.startDate,
    endDate: task.endDate,
    status: task.status,
    manDays: task.manDays,
  }
  if (task.parentId) payload.parentId = task.parentId
  if (task.memo !== undefined) payload.memo = task.memo
  if (task.isSubTask !== undefined) payload.isSubTask = task.isSubTask
  if (task.isHidden !== undefined) payload.isHidden = task.isHidden
  if (task.depth !== undefined) payload.depth = task.depth
  if (task.displayOrder !== undefined) payload.displayOrder = task.displayOrder
  return payload
}

const priorityMeta: Record<MyPageTaskPreference["priority"], { label: string; className: string; rank: number }> = {
  high: { label: "높음", className: "bg-rose-100 text-rose-700", rank: 0 },
  medium: { label: "보통", className: "bg-amber-100 text-amber-700", rank: 1 },
  low: { label: "낮음", className: "bg-slate-700 text-white", rank: 2 },
}

const parseDateLabel = (value?: string) => {
  const matched = value?.match(/(\d{1,2})\D+(\d{1,2})/)
  return matched ? new Date(new Date().getFullYear(), Number(matched[1]) - 1, Number(matched[2])).getTime() : Number.MAX_SAFE_INTEGER
}

const formatDateWithYear = (value?: string) => {
  const normalized = (value || "").trim()
  if (!normalized) return "-"
  if (/\d{4}/.test(normalized)) return normalized
  const matched = normalized.match(/(\d{1,2})\D+(\d{1,2})/)
  if (!matched) return normalized
  const year = new Date().getFullYear()
  const month = String(Number(matched[1])).padStart(2, "0")
  const day = String(Number(matched[2])).padStart(2, "0")
  return `${year}.${month}.${day}`
}

const buildAliasCandidates = (email?: string | null, displayName?: string | null) => {
  const normalizedEmail = (email || "").trim().toLowerCase()
  const localPart = normalizedEmail.split("@")[0] || ""
  return Array.from(new Set([normalizedEmail, localPart, localPart.replaceAll(".", " "), displayName?.trim() || ""].filter(Boolean)))
}

const hasAliasMatch = (person: string, aliases: string[]) => {
  const normalizedPerson = person.trim().toLowerCase()
  const tokens = person.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean)
  return aliases.some((alias) => normalizedPerson.includes(alias.trim().toLowerCase()) || tokens.includes(alias.trim().toLowerCase()))
}

const collectProjectTaskItems = (
  tasks: Task[],
  context: Pick<ProjectTaskItem, "departmentPage" | "projectName" | "projectType">,
  projectId: string,
  aliases: string[],
  ancestors: Task[] = [],
): ProjectTaskItem[] => {
  const collected: ProjectTaskItem[] = []

  tasks.forEach((task) => {
    const children = task.subTasks || []
    if (children.length > 0) {
      collected.push(...collectProjectTaskItems(children, context, projectId, aliases, [...ancestors, task]))
      return
    }

    if (!hasAliasMatch(task.person || "", aliases)) return

    collected.push({
      key: `${projectId}:${task.id}`,
      departmentPage: context.departmentPage,
      projectName: context.projectName,
      projectType: context.projectType,
      task,
      sortTime: parseDateLabel(task.startDate),
      depth: ancestors.length,
      ancestorNames: ancestors.map((entry) => entry.task),
    })
  })

  return collected
}

export default function MyPage() {
  const { user } = useAuth()
  const [strategyProjects, setStrategyProjects] = useState<Project[]>([])
  const [faProjects, setFaProjects] = useState<Project[]>([])
  const [aliases, setAliases] = useState<string[]>([])
  const [taskPreferences, setTaskPreferences] = useState<Record<string, MyPageTaskPreference>>({})
  const [personalTasks, setPersonalTasks] = useState<MyPagePersonalTask[]>([])
  const [draftTitle, setDraftTitle] = useState("")
  const [draftMemo, setDraftMemo] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const [editingMemo, setEditingMemo] = useState("")
  const [draggedProjectKey, setDraggedProjectKey] = useState<string | null>(null)
  const [draggedPersonalId, setDraggedPersonalId] = useState<string | null>(null)
  const [projectDropIndicator, setProjectDropIndicator] = useState<{ key: string; position: "before" | "after" } | null>(null)
  const [personalDropIndicator, setPersonalDropIndicator] = useState<{ id: string; position: "before" | "after" } | null>(null)
  const [isProjectTasksCollapsed, setIsProjectTasksCollapsed] = useState(false)
  const [isProjectActiveCollapsed, setIsProjectActiveCollapsed] = useState(false)
  const [isProjectCompletedCollapsed, setIsProjectCompletedCollapsed] = useState(false)
  const [selectedCompletedProjectTaskKeys, setSelectedCompletedProjectTaskKeys] = useState<string[]>([])
  const [collapsedProjectGroups, setCollapsedProjectGroups] = useState<Record<string, boolean>>({})
  const [isPersonalActiveCollapsed, setIsPersonalActiveCollapsed] = useState(false)
  const [isPersonalCompletedCollapsed, setIsPersonalCompletedCollapsed] = useState(false)
  const [myMemo, setMyMemo] = useState("")
  const [isSavingMemo, setIsSavingMemo] = useState(false)
  const [editableFieldsConfig, setEditableFieldsConfig] = useState<MyPageEditableFieldsSettings>([
    ...DEFAULT_MY_PAGE_EDITABLE_FIELDS,
  ])

  useEffect(() => {
    const unsubscribeStrategy = subscribeStrategyData(setStrategyProjects)
    const unsubscribeFa = subscribeFaData(setFaProjects)
    const unsubscribeEditableFields = subscribeMyPageEditableFields(setEditableFieldsConfig)
    return () => {
      unsubscribeStrategy()
      unsubscribeFa()
      unsubscribeEditableFields()
    }
  }, [])

  useEffect(() => {
    if (!user?.email) return
    const unsubscribe = subscribeCurrentUserProfile(user.email, (profile) => {
      setAliases(profile?.taskAliases?.length ? profile.taskAliases : buildAliasCandidates(user.email, user.displayName))
      setTaskPreferences(profile?.myPageTaskPreferences || {})
      setPersonalTasks((profile?.myPagePersonalTasks || []).slice().sort((a, b) => a.order - b.order))
      setMyMemo(profile?.myPageMemo || "")
      setCollapsedProjectGroups(profile?.myPageCollapsedProjectGroups || {})
    })
    return () => unsubscribe()
  }, [user])

  const groupedProjects = useMemo<GroupedProject[]>(() => {
    const toGrouped = (projects: Project[], departmentPage: GroupedProject["departmentPage"]) =>
      projects
        .map((project) => ({
          id: `${departmentPage}-${project.id}`,
          departmentPage,
          name: project.name,
          type: project.type,
          tasks: collectProjectTaskItems(
            project.tasks,
            { departmentPage, projectName: project.name, projectType: project.type },
            `${departmentPage}-${project.id}`,
            aliases,
          ).filter((item) => !(taskPreferences[item.key] || DEFAULT_TASK_PREFERENCE).deleted),
        }))
        .filter((project) => project.tasks.length > 0)

    return [...toGrouped(strategyProjects, "전략사업부"), ...toGrouped(faProjects, "FA 사업부")]
  }, [aliases, strategyProjects, faProjects, taskPreferences])

  const projectTasks = useMemo<ProjectTaskItem[]>(() => {
    return groupedProjects.flatMap((project) => project.tasks)
  }, [groupedProjects])

  const activeProjectTasks = useMemo(
    () => projectTasks.filter((item) => !(taskPreferences[item.key] || DEFAULT_TASK_PREFERENCE).checked),
    [projectTasks, taskPreferences],
  )
  const completedProjectTasks = useMemo(
    () => projectTasks.filter((item) => (taskPreferences[item.key] || DEFAULT_TASK_PREFERENCE).checked),
    [projectTasks, taskPreferences],
  )
  const groupTasksByProject = (items: ProjectTaskItem[]) =>
    Object.values(
      items.reduce(
        (acc, item) => {
          const key = `${item.departmentPage}::${item.projectName}`
          if (!acc[key]) {
            acc[key] = {
              key,
              departmentPage: item.departmentPage,
              projectName: item.projectName,
              projectType: item.projectType,
              items: [] as ProjectTaskItem[],
            }
          }
          acc[key].items.push(item)
          return acc
        },
        {} as Record<string, { key: string; departmentPage: string; projectName: string; projectType: string; items: ProjectTaskItem[] }>,
      ),
    )
  const activeProjectTaskGroups = useMemo(() => groupTasksByProject(activeProjectTasks), [activeProjectTasks])
  const completedProjectTaskGroups = useMemo(() => groupTasksByProject(completedProjectTasks), [completedProjectTasks])
  useEffect(() => {
    const completedSet = new Set(completedProjectTasks.map((item) => item.key))
    setSelectedCompletedProjectTaskKeys((prev) => prev.filter((key) => completedSet.has(key)))
  }, [completedProjectTasks])

  const orderedPersonalTasks = useMemo(() => personalTasks.slice().sort((a, b) => a.order - b.order), [personalTasks])
  const activePersonalTasks = useMemo(() => orderedPersonalTasks.filter((task) => !task.checked), [orderedPersonalTasks])
  const completedPersonalTasks = useMemo(() => orderedPersonalTasks.filter((task) => task.checked), [orderedPersonalTasks])

  const savePreferences = async (next: Record<string, MyPageTaskPreference>) => {
    setTaskPreferences(next)
    if (!user?.email) return
    try {
      await saveMyPageTaskPreferences(user.email, next)
    } catch {
      toast.error("프로젝트 업무 설정 저장에 실패했습니다.")
    }
  }

  const savePersonal = async (next: MyPagePersonalTask[]) => {
    setPersonalTasks(next)
    if (!user?.email) return
    try {
      await saveMyPagePersonalTasks(user.email, next)
    } catch {
      toast.error("개인 업무 저장에 실패했습니다.")
    }
  }

  const reorderProject = (dragged: string, target: string, position: "before" | "after" = "before") => {
    if (dragged === target) return
    const remaining = projectTasks.filter((item) => item.key !== dragged)
    const targetIndex = remaining.findIndex((item) => item.key === target)
    if (targetIndex < 0) return
    const draggedItem = projectTasks.find((item) => item.key === dragged)
    if (!draggedItem) return
    const insertIndex = position === "before" ? targetIndex : targetIndex + 1
    const next = [...remaining]
    next.splice(insertIndex, 0, draggedItem)
    const prefs = { ...taskPreferences }
    next.forEach((item, i) => {
      prefs[item.key] = { ...(prefs[item.key] || DEFAULT_TASK_PREFERENCE), order: i }
    })
    void savePreferences(prefs)
  }

  const updateProjectPref = (taskKey: string, updates: Partial<MyPageTaskPreference>) =>
    void savePreferences({ ...taskPreferences, [taskKey]: { ...(taskPreferences[taskKey] || DEFAULT_TASK_PREFERENCE), ...updates } })

  const handleProjectTaskEdit = async (
    item: ProjectTaskItem,
    updatedTask: Task,
  ) => {
    if (!user?.email) {
      toast.error("로그인 정보를 확인할 수 없습니다.")
      return
    }
    if (!isUserOwnerOfTask(item.task, aliases)) {
      toast.error("본인 담당 업무만 수정할 수 있습니다.")
      return
    }

    const allowedFieldSet = new Set(editableFieldsConfig)
    if (allowedFieldSet.size === 0) {
      toast.info("관리자가 편집을 허용한 항목이 없습니다.")
      return
    }
    const allowedUpdates: Partial<Task> = {}
    if (allowedFieldSet.has("status")) allowedUpdates.status = updatedTask.status
    if (allowedFieldSet.has("memo")) allowedUpdates.memo = updatedTask.memo
    if (allowedFieldSet.has("manDays")) allowedUpdates.manDays = updatedTask.manDays
    if (allowedFieldSet.has("startDate")) allowedUpdates.startDate = updatedTask.startDate
    if (allowedFieldSet.has("endDate")) allowedUpdates.endDate = updatedTask.endDate
    if (allowedFieldSet.has("task")) allowedUpdates.task = updatedTask.task
    if (allowedFieldSet.has("category")) allowedUpdates.category = updatedTask.category
    if (allowedFieldSet.has("department")) allowedUpdates.department = updatedTask.department
    if (allowedFieldSet.has("person")) allowedUpdates.person = updatedTask.person

    const isFa = item.departmentPage === "FA 사업부"
    const updateFn = isFa ? updateFaTaskInDB : updateStrategyTaskInDB
    const recordFn = isFa ? addFaHistoryEntry : addStrategyHistoryEntry

    try {
      await updateFn(item.task.id, allowedUpdates)
      const merged: Task = { ...item.task, ...allowedUpdates }
      try {
        await recordFn({
          entityType: "task",
          action: "update",
          entityId: item.task.id,
          projectId: item.task.projectId,
          before: serializeTaskForHistory(item.task),
          after: serializeTaskForHistory(merged),
          actorEmail: user.email,
          source: "my-page",
        })
      } catch (historyError) {
        console.error("History write failed:", historyError)
      }
      toast.success("업무가 수정되었습니다.")
    } catch (error) {
      console.error("Task update failed:", error)
      toast.error("업무 수정에 실패했습니다.")
    }
  }

  const toggleCompletedProjectTaskSelection = (taskKey: string, checked: boolean) => {
    setSelectedCompletedProjectTaskKeys((prev) => {
      if (checked) {
        if (prev.includes(taskKey)) return prev
        return [...prev, taskKey]
      }
      return prev.filter((key) => key !== taskKey)
    })
  }

  const deleteSelectedCompletedProjectTasks = () => {
    if (selectedCompletedProjectTaskKeys.length === 0) return
    const next = { ...taskPreferences }
    selectedCompletedProjectTaskKeys.forEach((taskKey) => {
      next[taskKey] = {
        ...(next[taskKey] || DEFAULT_TASK_PREFERENCE),
        checked: true,
        deleted: true,
      }
    })
    setSelectedCompletedProjectTaskKeys([])
    void savePreferences(next)
  }

  const deleteAllCompletedProjectTasks = () => {
    if (completedProjectTasks.length === 0) return
    const next = { ...taskPreferences }
    completedProjectTasks.forEach((item) => {
      next[item.key] = {
        ...(next[item.key] || DEFAULT_TASK_PREFERENCE),
        checked: true,
        deleted: true,
      }
    })
    setSelectedCompletedProjectTaskKeys([])
    void savePreferences(next)
  }

  const addPersonal = () => {
    const title = draftTitle.trim()
    if (!title) return
    const now = Date.now()
    const next: MyPagePersonalTask = {
      id: `personal-${now}`,
      title,
      memo: draftMemo.trim() || undefined,
      checked: false,
      priority: "medium",
      important: false,
      order: personalTasks.length,
      createdAt: now,
      updatedAt: now,
    }
    setDraftTitle("")
    setDraftMemo("")
    void savePersonal([...personalTasks, next])
  }

  const updatePersonal = (id: string, updates: Partial<MyPagePersonalTask>) =>
    void savePersonal(personalTasks.map((task) => (task.id === id ? { ...task, ...updates, updatedAt: Date.now() } : task)))

  const removePersonal = (id: string) =>
    void savePersonal(personalTasks.filter((task) => task.id !== id).map((task, i) => ({ ...task, order: i })))

  const reorderPersonal = (dragged: string, target: string, position: "before" | "after" = "before") => {
    if (dragged === target) return
    const remaining = orderedPersonalTasks.filter((task) => task.id !== dragged)
    const targetIndex = remaining.findIndex((task) => task.id === target)
    if (targetIndex < 0) return
    const draggedTask = orderedPersonalTasks.find((task) => task.id === dragged)
    if (!draggedTask) return
    const insertIndex = position === "before" ? targetIndex : targetIndex + 1
    const next = [...remaining]
    next.splice(insertIndex, 0, draggedTask)
    void savePersonal(next.map((task, i) => ({ ...task, order: i, updatedAt: Date.now() })))
  }

  const submitEdit = () => {
    if (!editingId || !editingTitle.trim()) return
    updatePersonal(editingId, { title: editingTitle.trim(), memo: editingMemo.trim() || undefined })
    setEditingId(null)
    setEditingTitle("")
    setEditingMemo("")
  }

  const logout = async () => {
    try {
      await signOut(auth)
      toast.success("로그아웃 되었습니다.")
    } catch {
      toast.error("로그아웃에 실패했습니다.")
    }
  }

  const saveMemo = async () => {
    if (!user?.email) return
    setIsSavingMemo(true)
    try {
      await saveMyPageMemo(user.email, myMemo)
      toast.success("메모가 저장되었습니다.")
    } catch {
      toast.error("메모 저장에 실패했습니다.")
    } finally {
      setIsSavingMemo(false)
    }
  }

  const toggleProjectGroupCollapsed = (groupKey: string) => {
    setCollapsedProjectGroups((prev) => {
      const next = { ...prev, [groupKey]: !prev[groupKey] }
      if (user?.email) {
        void saveMyPageCollapsedProjectGroups(user.email, next)
      }
      return next
    })
  }

  const renderProjectTaskCard = (item: ProjectTaskItem, options?: { selectableForDelete?: boolean }) => {
    const pref = taskPreferences[item.key] || DEFAULT_TASK_PREFERENCE
    const important = pref.important || item.task.category === "중요"
    const selectableForDelete = Boolean(options?.selectableForDelete)
    const selectedForDelete = selectedCompletedProjectTaskKeys.includes(item.key)
    return (
      <div
        key={item.key}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = "move"
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
          const position: "before" | "after" = e.clientY < rect.top + rect.height / 2 ? "before" : "after"
          if (!projectDropIndicator || projectDropIndicator.key !== item.key || projectDropIndicator.position !== position) {
            setProjectDropIndicator({ key: item.key, position })
          }
        }}
        onDragLeave={() => {
          if (projectDropIndicator?.key === item.key) setProjectDropIndicator(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          const droppedKey = draggedProjectKey || e.dataTransfer.getData(PROJECT_TASK_DND_MIME) || ""
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
          const position: "before" | "after" =
            projectDropIndicator?.key === item.key
              ? projectDropIndicator.position
              : e.clientY < rect.top + rect.height / 2
                ? "before"
                : "after"
          if (droppedKey) reorderProject(droppedKey, item.key, position)
          setDraggedProjectKey(null)
          setProjectDropIndicator(null)
        }}
        className={cn(
          "relative rounded-xl border px-2.5 py-2 transition-colors",
          important ? "border-red-300 bg-red-50/60" : "border-slate-200 bg-white",
          draggedProjectKey === item.key && "opacity-65 ring-1 ring-slate-300",
        )}
        style={{ marginLeft: `${Math.min(item.depth, 4) * 14}px` }}
      >
        {projectDropIndicator?.key === item.key && (
          <div
            className={cn(
              "pointer-events-none absolute left-0 right-0 z-20 h-0.5 bg-sky-500",
              projectDropIndicator.position === "before" ? "top-0" : "bottom-0",
            )}
          />
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {selectableForDelete ? (
            <label className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={selectedForDelete}
                onChange={(e) => toggleCompletedProjectTaskSelection(item.key, e.target.checked)}
              />
              선택
            </label>
          ) : null}
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              setDraggedProjectKey(item.key)
              e.dataTransfer.effectAllowed = "move"
              e.dataTransfer.setData(PROJECT_TASK_DND_MIME, item.key)
            }}
            onDragEnd={() => {
              setDraggedProjectKey(null)
              setProjectDropIndicator(null)
            }}
            className="inline-flex h-5 w-5 cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
            aria-label="업무 순서 이동"
            title="드래그로 순서 이동"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => updateProjectPref(item.key, { checked: !pref.checked })}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-sm border-2 transition-colors",
              pref.checked
                ? "border-emerald-600 bg-emerald-600 text-white shadow-[0_0_0_2px_rgba(16,185,129,0.2)]"
                : "border-slate-300 bg-white text-transparent hover:border-slate-400",
            )}
            aria-label={pref.checked ? "완료 해제" : "완료 처리"}
            title={pref.checked ? "완료 해제" : "완료 처리"}
          >
            <CheckCircle2 className="h-4 w-4" />
          </button>
          <Badge variant="outline">{item.departmentPage}</Badge>
          <ProjectTypeBadge type={item.projectType} />
          <CategoryBadge category={item.task.category} />
          <StatusBadge status={item.task.status} />
          <div className="ml-auto flex items-center gap-1">
            {(["high", "medium", "low"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => updateProjectPref(item.key, { priority: p })}
                className={cn("rounded-full px-2 py-0.5 text-[11px]", pref.priority === p ? priorityMeta[p].className : "bg-slate-100 text-slate-500")}
              >
                {priorityMeta[p].label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => updateProjectPref(item.key, { important: !pref.important })}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                important ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500",
              )}
            >
              <Star className={cn("h-3 w-3", important && "fill-current")} />중요
            </button>
            {editableFieldsConfig.length > 0 && (
              <EditTaskDialog
                task={item.task}
                onEditTask={(updated) => void handleProjectTaskEdit(item, updated)}
                defaultDepartment={item.task.department || (item.departmentPage === "FA 사업부" ? "FA" : "전략")}
                editableFields={editableFieldsConfig}
                trigger={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-700 hover:bg-sky-200"
                    title="업무 수정 (관리자가 허용한 항목만 편집 가능)"
                  >
                    <Pencil className="h-3 w-3" />수정
                  </button>
                }
              />
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-start justify-between gap-2">
          <p className={cn("text-sm font-semibold leading-5", pref.checked && "line-through")}>{item.task.task}</p>
          <p className="shrink-0 text-[11px] text-slate-500">
            상위업무: {item.ancestorNames.length > 0 ? item.ancestorNames.join(" > ") : "없음 (최상위)"}
          </p>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatDateWithYear(item.task.startDate)}</span>
          <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatDateWithYear(item.task.endDate)}</span>
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" />
            {item.task.person || "-"}
          </span>
        </div>
      </div>
    )
  }

  const renderPersonalTaskCard = (task: MyPagePersonalTask) => (
    <div
      key={task.id}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        const position: "before" | "after" = e.clientY < rect.top + rect.height / 2 ? "before" : "after"
        if (!personalDropIndicator || personalDropIndicator.id !== task.id || personalDropIndicator.position !== position) {
          setPersonalDropIndicator({ id: task.id, position })
        }
      }}
      onDragLeave={() => {
        if (personalDropIndicator?.id === task.id) setPersonalDropIndicator(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const droppedId = draggedPersonalId || e.dataTransfer.getData(PERSONAL_TASK_DND_MIME) || ""
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        const position: "before" | "after" =
          personalDropIndicator?.id === task.id
            ? personalDropIndicator.position
            : e.clientY < rect.top + rect.height / 2
              ? "before"
              : "after"
        if (droppedId) reorderPersonal(droppedId, task.id, position)
        setDraggedPersonalId(null)
        setPersonalDropIndicator(null)
      }}
      className={cn(
        "relative rounded-xl border p-3 transition-colors",
        task.important ? "border-red-300 bg-red-50/60" : "border-slate-200 bg-white",
        draggedPersonalId === task.id && "opacity-65 ring-1 ring-slate-300",
      )}
    >
      {personalDropIndicator?.id === task.id && (
        <div
          className={cn(
            "pointer-events-none absolute left-0 right-0 z-20 h-0.5 bg-sky-500",
            personalDropIndicator.position === "before" ? "top-0" : "bottom-0",
          )}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            setDraggedPersonalId(task.id)
            e.dataTransfer.effectAllowed = "move"
            e.dataTransfer.setData(PERSONAL_TASK_DND_MIME, task.id)
          }}
          onDragEnd={() => {
            setDraggedPersonalId(null)
            setPersonalDropIndicator(null)
          }}
          className="inline-flex h-5 w-5 cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
          aria-label="개인 업무 순서 이동"
          title="드래그로 순서 이동"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => updatePersonal(task.id, { checked: !task.checked })}
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded-sm border-2 transition-colors",
            task.checked
              ? "border-emerald-600 bg-emerald-600 text-white shadow-[0_0_0_2px_rgba(16,185,129,0.2)]"
              : "border-slate-300 bg-white text-transparent hover:border-slate-400",
          )}
          aria-label={task.checked ? "완료 해제" : "완료 처리"}
          title={task.checked ? "완료 해제" : "완료 처리"}
        >
          <CheckCircle2 className="h-4 w-4" />
        </button>
        <p className={cn("flex-1 font-semibold", task.checked && "line-through")}>{task.title}</p>
      </div>
      {task.memo ? <p className="mt-1 text-xs text-slate-500">{task.memo}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {(["high", "medium", "low"] as const).map((p) => (
          <button key={p} type="button" onClick={() => updatePersonal(task.id, { priority: p })} className={cn("rounded-full px-3 py-1 text-xs", task.priority === p ? priorityMeta[p].className : "bg-slate-100 text-slate-500")}>
            {priorityMeta[p].label}
          </button>
        ))}
        <button type="button" onClick={() => updatePersonal(task.id, { important: !task.important })} className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs", task.important ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500")}>
          <Star className={cn("h-3.5 w-3.5", task.important && "fill-current")} />중요
        </button>
        <Button type="button" variant="outline" size="sm" onClick={() => { setEditingId(task.id); setEditingTitle(task.title); setEditingMemo(task.memo || "") }}>
          <Pencil className="h-3.5 w-3.5" />수정
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => removePersonal(task.id)}>
          <Trash2 className="h-3.5 w-3.5" />삭제
        </Button>
      </div>
      {editingId === task.id ? (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <Input value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} />
          <Textarea value={editingMemo} onChange={(e) => setEditingMemo(e.target.value)} rows={3} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>취소</Button>
            <Button type="button" size="sm" onClick={submitEdit}>저장</Button>
          </div>
        </div>
      ) : null}
    </div>
  )

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(180deg,#f8fbff_0%,#f5f7fb_55%,#ffffff_100%)] px-3 py-6 lg:px-6">
      <div className="mx-auto w-full max-w-none space-y-4">
        <header className="flex flex-col gap-3 rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur lg:flex-row lg:items-center">
          <div>
            <p className="text-xl font-extrabold uppercase tracking-[0.12em] text-sky-600">WORKHUB</p>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">마이 페이지</h1>
            <p className="mt-2 text-sm text-slate-600">프로젝트 연동 업무와 개인 업무를 분리했습니다.</p>
          </div>
          <div className="flex flex-wrap gap-1.5 lg:ml-5">
            <Button asChild variant="outline"><Link href="/"><Home className="h-4 w-4" />메인</Link></Button>
            <Button type="button" variant="outline" onClick={logout}><LogOut className="h-4 w-4" />로그아웃</Button>
          </div>
          <Image
            src="/placeholder-logo.png"
            alt="WorkHub 로고"
            width={180}
            height={52}
            className="h-12 w-auto object-contain lg:ml-auto"
            priority
          />
        </header>

        <section className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <Card className="h-fit">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>프로젝트 연동 업무</CardTitle>
                  <CardDescription>완료/미완료가 분리되며 드래그앤드롭으로 우선순서를 조정합니다.</CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setIsProjectTasksCollapsed((prev) => !prev)} className="shrink-0">
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isProjectTasksCollapsed && "-rotate-90")} />
                  {isProjectTasksCollapsed ? "펼치기" : "접기"}
                </Button>
              </div>
            </CardHeader>
            {!isProjectTasksCollapsed && (
              <CardContent>
                {projectTasks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                    <UserRoundSearch className="mx-auto mb-2 h-6 w-6" />연동된 업무가 없습니다.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setIsProjectActiveCollapsed((prev) => !prev)}
                        className="flex items-center gap-1 text-xs font-semibold text-slate-500"
                      >
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isProjectActiveCollapsed && "-rotate-90")} />
                        진행 업무 ({activeProjectTasks.length})
                      </button>
                      {!isProjectActiveCollapsed &&
                        activeProjectTaskGroups.map((group) => (
                          <div key={`active-${group.key}`} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/40 p-2">
                            <button
                              type="button"
                              onClick={() => toggleProjectGroupCollapsed(`active-${group.key}`)}
                              className="flex w-full items-center justify-between gap-2 text-left"
                            >
                              <div className="flex items-center gap-2">
                                <ChevronDown
                                  className={cn(
                                    "h-3.5 w-3.5 text-slate-500 transition-transform",
                                    collapsedProjectGroups[`active-${group.key}`] && "-rotate-90",
                                  )}
                                />
                                <Badge variant="outline">{group.departmentPage}</Badge>
                                <ProjectTypeBadge type={group.projectType} />
                                <span className="text-base font-bold text-slate-800">{group.projectName}</span>
                              </div>
                            </button>
                            {!collapsedProjectGroups[`active-${group.key}`] ? (
                              <div className="space-y-2">{group.items.map((item) => renderProjectTaskCard(item))}</div>
                            ) : null}
                          </div>
                        ))}
                    </div>
                    <div className="border-t border-dashed border-slate-300 pt-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setIsProjectCompletedCollapsed((prev) => !prev)}
                          className="flex items-center gap-1 text-xs font-semibold text-slate-500"
                        >
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isProjectCompletedCollapsed && "-rotate-90")} />
                          완료 업무 ({completedProjectTasks.length})
                        </button>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={deleteSelectedCompletedProjectTasks}
                            disabled={selectedCompletedProjectTaskKeys.length === 0}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            선택삭제
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={deleteAllCompletedProjectTasks}
                            disabled={completedProjectTasks.length === 0}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            일괄삭제
                          </Button>
                        </div>
                      </div>
                      {!isProjectCompletedCollapsed && (
                        <div className="space-y-2">
                          {completedProjectTasks.length > 0 ? completedProjectTaskGroups.map((group) => (
                            <div key={`completed-${group.key}`} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/40 p-2">
                              <button
                                type="button"
                                onClick={() => toggleProjectGroupCollapsed(`completed-${group.key}`)}
                                className="flex w-full items-center justify-between gap-2 text-left"
                              >
                                <div className="flex items-center gap-2">
                                  <ChevronDown
                                    className={cn(
                                      "h-3.5 w-3.5 text-slate-500 transition-transform",
                                      collapsedProjectGroups[`completed-${group.key}`] && "-rotate-90",
                                    )}
                                  />
                                  <Badge variant="outline">{group.departmentPage}</Badge>
                                  <ProjectTypeBadge type={group.projectType} />
                                  <span className="text-base font-bold text-slate-800">{group.projectName}</span>
                                </div>
                              </button>
                              {!collapsedProjectGroups[`completed-${group.key}`] ? (
                                <div className="space-y-2">{group.items.map((item) => renderProjectTaskCard(item, { selectableForDelete: true }))}</div>
                              ) : null}
                            </div>
                          )) : (
                            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">완료된 업무가 없습니다.</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>개인 업무</CardTitle>
                <CardDescription>완료/미완료가 분리되며 개별 작성/수정/삭제가 가능합니다.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
                  <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="업무 제목" />
                  <Input value={draftMemo} onChange={(e) => setDraftMemo(e.target.value)} placeholder="메모 (선택)" />
                  <Button type="button" onClick={addPersonal}><Plus className="h-4 w-4" />추가</Button>
                </div>

                {personalTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">등록된 개인 업무가 없습니다.</div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setIsPersonalActiveCollapsed((prev) => !prev)}
                        className="flex items-center gap-1 text-xs font-semibold text-slate-500"
                      >
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isPersonalActiveCollapsed && "-rotate-90")} />
                        진행 업무 ({activePersonalTasks.length})
                      </button>
                      {!isPersonalActiveCollapsed && activePersonalTasks.map(renderPersonalTaskCard)}
                    </div>
                    <div className="border-t border-dashed border-slate-300 pt-3">
                      <button
                        type="button"
                        onClick={() => setIsPersonalCompletedCollapsed((prev) => !prev)}
                        className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-500"
                      >
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isPersonalCompletedCollapsed && "-rotate-90")} />
                        완료 업무 ({completedPersonalTasks.length})
                      </button>
                      {!isPersonalCompletedCollapsed && (
                        <div className="space-y-2">
                          {completedPersonalTasks.length > 0 ? completedPersonalTasks.map(renderPersonalTaskCard) : (
                            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">완료된 업무가 없습니다.</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader className="pb-3">
                <CardTitle>메모장</CardTitle>
                <CardDescription>필요한 내용을 자유롭게 입력하고 수정해 저장합니다.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={myMemo}
                  onChange={(e) => setMyMemo(e.target.value)}
                  placeholder="메모를 입력하세요"
                  rows={8}
                />
                <div className="flex justify-end">
                  <Button type="button" onClick={() => void saveMemo()} disabled={isSavingMemo}>
                    {isSavingMemo ? "저장 중..." : "메모 저장"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

        </section>
      </div>
    </main>
  )
}
