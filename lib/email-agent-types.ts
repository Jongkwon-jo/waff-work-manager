export const TASK_STATUS_VALUES = ["완료", "진행", "예정", "취소", "미정"] as const
export type EmailAgentTaskStatus = (typeof TASK_STATUS_VALUES)[number]

export const TASK_CATEGORY_VALUES = ["일반", "중요", "정기", "상시"] as const
export type EmailAgentTaskCategory = (typeof TASK_CATEGORY_VALUES)[number]

export type EmailAgentProjectSource = "work-management" | "fa-work-management"
export type EmailAgentActionType = "create_task" | "update_task" | "no_action" | "needs_review"
export type EmailAgentRiskType =
  | "deadline_conflict"
  | "owner_overload"
  | "project_overlap"
  | "missing_due_date"
  | "stale_task"
export type EmailAgentRiskSeverity = "low" | "medium" | "high"

export type EmailAgentMessage = {
  emailId: string
  messageId: string
  uid: string
  from: string
  to: string[]
  cc: string[]
  subject: string
  receivedAt: string
  plainText: string
  attachmentNames: string[]
}

export type EmailAgentSettings = {
  serviceUrl: string
  openaiApiKey: string
  openaiModel: string
  imapHost: string
  imapPort: number
  imapUsername: string
  imapPassword: string
  imapUseSsl: boolean
  imapMailbox: string
}

export type EmailAgentPreview = Omit<EmailAgentMessage, "plainText" | "attachmentNames"> & {
  plainTextPreview: string
  hasAttachments: boolean
}

export type EmailAgentTaskSnapshot = {
  taskId: string
  title: string
  department: string
  person: string
  status: EmailAgentTaskStatus
  category: EmailAgentTaskCategory
  startDate: string
  endDate: string
  manDays: number
  depth: number
}

export type EmailAgentProjectSnapshot = {
  source: EmailAgentProjectSource
  projectId: string
  projectName: string
  projectType: string
  pmEmail: string
  tasks: EmailAgentTaskSnapshot[]
}

export type EmailAgentProposedAction = {
  type: EmailAgentActionType
  projectId?: string | null
  taskId?: string | null
  title?: string
  department?: string
  person?: string
  status?: EmailAgentTaskStatus
  category?: EmailAgentTaskCategory
  startDate?: string | null
  endDate?: string | null
  manDays?: number | null
  memo?: string
}

export type EmailAgentScheduleRisk = {
  type: EmailAgentRiskType
  severity: EmailAgentRiskSeverity
  message: string
  relatedTaskIds: string[]
}

export type EmailWorkAnalysis = {
  isWorkRelated: boolean
  summary: string
  detectedIntent: string
  confidence: number
  relatedProjectIds: string[]
  proposedActions: EmailAgentProposedAction[]
  scheduleRisks: EmailAgentScheduleRisk[]
  missingInfo: string[]
  reasoningSummary: string
}

export type EmailWorkProposalStatus = "pending" | "applied" | "rejected"

export type EmailWorkProposal = {
  id: string
  status: EmailWorkProposalStatus
  duplicateKey: string
  sourceEmail: EmailAgentPreview
  analysis: EmailWorkAnalysis
  proposedActions: EmailAgentProposedAction[]
  createdAt?: string
  reviewedBy?: string
  reviewedAt?: string
  appliedAt?: string
  appliedTaskId?: string
  appliedActionIndex?: number
  rejectedAt?: string
}

export const isEmailAgentTaskStatus = (value: unknown): value is EmailAgentTaskStatus =>
  typeof value === "string" && TASK_STATUS_VALUES.includes(value as EmailAgentTaskStatus)

export const isEmailAgentTaskCategory = (value: unknown): value is EmailAgentTaskCategory =>
  typeof value === "string" && TASK_CATEGORY_VALUES.includes(value as EmailAgentTaskCategory)
