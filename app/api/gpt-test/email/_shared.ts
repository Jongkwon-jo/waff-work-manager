import { fetchProjectsWithTasks as fetchFaProjectsWithTasks } from "@/lib/firestore-service-fa"
import { fetchProjectsWithTasks as fetchStrategyProjectsWithTasks } from "@/lib/firestore-service"
import type {
  EmailAgentMessage,
  EmailAgentPreview,
  EmailAgentProjectSnapshot,
  EmailAgentProjectSource,
  EmailAgentSettings,
  EmailAgentTaskCategory,
  EmailAgentTaskSnapshot,
  EmailAgentTaskStatus,
  EmailWorkAnalysis,
} from "@/lib/email-agent-types"
import { isEmailAgentTaskCategory, isEmailAgentTaskStatus } from "@/lib/email-agent-types"
import type { Project, Task } from "@/lib/data"

type EmailAgentFetchResponse = {
  emails?: EmailAgentMessage[]
  detail?: string
  error?: string
}

type EmailAgentAnalyzeResponse = {
  analysis?: EmailWorkAnalysis
  detail?: string
  error?: string
}

export type ProjectWithSource = Project & {
  source: EmailAgentProjectSource
}

export const todayIsoDate = () => new Date().toISOString().slice(0, 10)

export function getEmailAgentServiceUrl(serviceUrl?: string) {
  return (serviceUrl || process.env.EMAIL_AGENT_SERVICE_URL || "http://127.0.0.1:8787").replace(/\/+$/, "")
}

function toEmailAgentServiceConfig(settings?: EmailAgentSettings) {
  if (!settings) return undefined
  return {
    openaiApiKey: settings.openaiApiKey,
    openaiModel: settings.openaiModel,
    imapHost: settings.imapHost,
    imapPort: settings.imapPort,
    imapUsername: settings.imapUsername,
    imapPassword: settings.imapPassword,
    imapUseSsl: settings.imapUseSsl,
    imapMailbox: settings.imapMailbox,
  }
}

async function postEmailAgent<T>(path: string, body: unknown, settings?: EmailAgentSettings): Promise<T> {
  const response = await fetch(`${getEmailAgentServiceUrl(settings?.serviceUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })

  const data = (await response.json().catch(() => ({}))) as T & { detail?: string; error?: string }
  if (!response.ok) {
    throw new Error(data.detail || data.error || "이메일 AI 서비스 호출에 실패했습니다.")
  }
  return data
}

export async function fetchEmailAgentMessages(input: {
  limit?: number
  mailbox?: string
  unreadOnly?: boolean
  since?: string
  settings?: EmailAgentSettings
}) {
  const data = await postEmailAgent<EmailAgentFetchResponse>("/emails/fetch-preview", {
    limit: input.limit || 10,
    mailbox: input.mailbox || input.settings?.imapMailbox || "INBOX",
    unread_only: Boolean(input.unreadOnly),
    since: input.since || null,
    config: toEmailAgentServiceConfig(input.settings),
  }, input.settings)

  return Array.isArray(data.emails) ? data.emails : []
}

export async function analyzeEmailWithAgent(input: {
  email: EmailAgentMessage
  projectSnapshots: EmailAgentProjectSnapshot[]
  analysisDate?: string
  settings?: EmailAgentSettings
}) {
  const data = await postEmailAgent<EmailAgentAnalyzeResponse>("/emails/analyze", {
    email: input.email,
    projectSnapshots: input.projectSnapshots,
    analysisDate: input.analysisDate || todayIsoDate(),
    config: toEmailAgentServiceConfig(input.settings),
  }, input.settings)

  if (!data.analysis) {
    throw new Error("이메일 AI 서비스가 분석 결과를 반환하지 않았습니다.")
  }

  return data.analysis
}

export function toEmailPreview(email: EmailAgentMessage): EmailAgentPreview {
  const normalizedText = (email.plainText || "").replace(/\s+/g, " ").trim()
  return {
    emailId: email.emailId,
    messageId: email.messageId || "",
    uid: email.uid,
    from: email.from || "",
    to: Array.isArray(email.to) ? email.to : [],
    cc: Array.isArray(email.cc) ? email.cc : [],
    subject: email.subject || "(제목 없음)",
    receivedAt: email.receivedAt || "",
    plainTextPreview: normalizedText.length > 220 ? `${normalizedText.slice(0, 220)}...` : normalizedText,
    hasAttachments: Array.isArray(email.attachmentNames) && email.attachmentNames.length > 0,
  }
}

function flattenTasks(tasks: Task[], depth = 0): Task[] {
  return tasks.flatMap((task) => [{ ...task, depth }, ...flattenTasks(task.subTasks || [], depth + 1)])
}

function normalizeStatus(value: string): EmailAgentTaskStatus {
  return isEmailAgentTaskStatus(value) ? value : "미정"
}

function normalizeCategory(value: string): EmailAgentTaskCategory {
  return isEmailAgentTaskCategory(value) ? value : "일반"
}

function toTaskSnapshot(task: Task): EmailAgentTaskSnapshot {
  return {
    taskId: task.id,
    title: task.task,
    department: task.department || "",
    person: task.person || "",
    status: normalizeStatus(task.status),
    category: normalizeCategory(task.category),
    startDate: task.startDate || "",
    endDate: task.endDate || "",
    manDays: typeof task.manDays === "number" ? task.manDays : 0,
    depth: typeof task.depth === "number" ? task.depth : 0,
  }
}

export async function fetchProjectSnapshotsForEmailAgent(): Promise<EmailAgentProjectSnapshot[]> {
  const [strategyProjects, faProjects] = await Promise.all([
    fetchStrategyProjectsWithTasks(),
    fetchFaProjectsWithTasks(),
  ])

  const mapProject = (source: EmailAgentProjectSource) => (project: Project): EmailAgentProjectSnapshot => ({
    source,
    projectId: project.id,
    projectName: project.name,
    projectType: project.type || "",
    pmEmail: project.pmEmail || "",
    tasks: flattenTasks(project.tasks || []).map(toTaskSnapshot),
  })

  return [
    ...strategyProjects.map(mapProject("work-management")),
    ...faProjects.map(mapProject("fa-work-management")),
  ]
}

export async function fetchProjectsWithSource(): Promise<ProjectWithSource[]> {
  const [strategyProjects, faProjects] = await Promise.all([
    fetchStrategyProjectsWithTasks(),
    fetchFaProjectsWithTasks(),
  ])

  return [
    ...strategyProjects.map((project) => ({ ...project, source: "work-management" as const })),
    ...faProjects.map((project) => ({ ...project, source: "fa-work-management" as const })),
  ]
}

export function findTaskInProjects(
  projects: ProjectWithSource[],
  taskId: string,
): { project: ProjectWithSource; task: Task } | null {
  for (const project of projects) {
    const stack = [...(project.tasks || [])]
    while (stack.length > 0) {
      const task = stack.shift()
      if (!task) continue
      if (task.id === taskId) return { project, task }
      stack.push(...(task.subTasks || []))
    }
  }
  return null
}
