import { NextResponse } from "next/server"

import {
  addHistoryEntry as addFaHistoryEntry,
  addTaskToDB as addFaTaskToDB,
  updateTaskInDB as updateFaTaskInDB,
} from "@/lib/firestore-service-fa"
import {
  addHistoryEntry as addStrategyHistoryEntry,
  addTaskToDB as addStrategyTaskToDB,
  updateTaskInDB as updateStrategyTaskInDB,
} from "@/lib/firestore-service"
import type { Task } from "@/lib/data"
import type { EmailAgentProposedAction } from "@/lib/email-agent-types"
import { isEmailAgentTaskCategory, isEmailAgentTaskStatus } from "@/lib/email-agent-types"
import {
  fetchEmailWorkProposal,
  markEmailWorkProposalApplied,
} from "@/lib/gpt-test-email-proposals"

import { fetchProjectsWithSource, findTaskInProjects, todayIsoDate } from "../../../_shared"

function compactObject<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null)) as T
}

function normalizeDate(value?: string | null) {
  if (!value) return todayIsoDate()
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayIsoDate()
}

function normalizeAction(action: EmailAgentProposedAction): EmailAgentProposedAction {
  const startDate = normalizeDate(action.startDate)
  const endDate = normalizeDate(action.endDate || action.startDate)
  return {
    ...action,
    title: action.title?.trim() || "이메일 기반 신규 업무",
    department: action.department?.trim() || "기타",
    person: action.person?.trim() || "",
    status: isEmailAgentTaskStatus(action.status) ? action.status : "미정",
    category: isEmailAgentTaskCategory(action.category) ? action.category : "일반",
    startDate,
    endDate: startDate > endDate ? startDate : endDate,
    manDays: typeof action.manDays === "number" && Number.isFinite(action.manDays) && action.manDays >= 0 ? action.manDays : 0,
    memo: action.memo?.trim() || "",
  }
}

function serializeTaskData(task: Task) {
  const { subTasks, completionPhoto, ...rest } = task
  return compactObject({
    ...rest,
    completionPhoto,
  } as Record<string, unknown>)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ proposalId: string }> },
) {
  try {
    const { proposalId } = await context.params
    const body = (await request.json().catch(() => ({}))) as {
      actionIndex?: number
      actorEmail?: string
      actionOverride?: EmailAgentProposedAction
    }

    const proposal = await fetchEmailWorkProposal(proposalId)
    if (!proposal) {
      return NextResponse.json({ error: "이메일 업무 제안을 찾지 못했습니다." }, { status: 404 })
    }
    if (proposal.status !== "pending") {
      return NextResponse.json({ error: "이미 처리된 이메일 업무 제안입니다." }, { status: 409 })
    }

    const actionIndex = typeof body.actionIndex === "number" ? body.actionIndex : 0
    const baseAction = body.actionOverride || proposal.proposedActions[actionIndex]
    if (!baseAction || baseAction.type === "no_action" || baseAction.type === "needs_review") {
      return NextResponse.json({ error: "업무에 반영할 수 있는 제안이 아닙니다." }, { status: 400 })
    }

    const action = normalizeAction(baseAction)
    const projects = await fetchProjectsWithSource()
    let appliedTaskId = ""

    if (action.type === "create_task") {
      const targetProject = projects.find((project) => project.id === action.projectId)
      if (!targetProject) {
        return NextResponse.json({ error: "제안에 연결된 프로젝트를 찾지 못했습니다." }, { status: 404 })
      }

      const taskData: Omit<Task, "id"> = {
        projectId: targetProject.id,
        task: action.title || "이메일 기반 신규 업무",
        memo: action.memo || proposal.analysis.summary,
        category: action.category || "일반",
        department: action.department || "기타",
        person: action.person || "",
        startDate: action.startDate || todayIsoDate(),
        endDate: action.endDate || action.startDate || todayIsoDate(),
        status: action.status || "미정",
        manDays: action.manDays || 0,
        isSubTask: false,
        displayOrder: Date.now(),
      }

      appliedTaskId =
        targetProject.source === "fa-work-management"
          ? await addFaTaskToDB(taskData)
          : await addStrategyTaskToDB(taskData)

      const addHistoryEntry =
        targetProject.source === "fa-work-management" ? addFaHistoryEntry : addStrategyHistoryEntry
      await addHistoryEntry({
        entityType: "task",
        action: "create",
        actorEmail: body.actorEmail,
        entityId: appliedTaskId,
        projectId: targetProject.id,
        after: taskData as unknown as Record<string, unknown>,
        source: targetProject.source,
      })
    } else if (action.type === "update_task") {
      const found = action.taskId ? findTaskInProjects(projects, action.taskId) : null
      if (!found) {
        return NextResponse.json({ error: "수정 대상 업무를 찾지 못했습니다." }, { status: 404 })
      }

      const updates = compactObject({
        task: action.title,
        memo: action.memo || undefined,
        category: action.category,
        department: action.department,
        person: action.person,
        startDate: action.startDate,
        endDate: action.endDate,
        status: action.status,
        manDays: action.manDays,
      } as Record<string, unknown>) as Omit<Partial<Task>, "parentId"> & { parentId?: string | null }

      if (found.project.source === "fa-work-management") {
        await updateFaTaskInDB(found.task.id, updates)
      } else {
        await updateStrategyTaskInDB(found.task.id, updates)
      }

      appliedTaskId = found.task.id
      const addHistoryEntry = found.project.source === "fa-work-management" ? addFaHistoryEntry : addStrategyHistoryEntry
      await addHistoryEntry({
        entityType: "task",
        action: "update",
        actorEmail: body.actorEmail,
        entityId: found.task.id,
        projectId: found.project.id,
        before: serializeTaskData(found.task),
        after: compactObject({ ...serializeTaskData(found.task), ...updates } as Record<string, unknown>),
        source: found.project.source,
      })
    }

    await markEmailWorkProposalApplied({
      proposalId,
      actorEmail: body.actorEmail,
      appliedTaskId,
      appliedActionIndex: actionIndex,
      appliedAction: action,
    })

    return NextResponse.json({
      proposalId,
      appliedTaskId,
      action,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "이메일 업무 제안 반영 중 오류가 발생했습니다.",
      },
      { status: 500 },
    )
  }
}
