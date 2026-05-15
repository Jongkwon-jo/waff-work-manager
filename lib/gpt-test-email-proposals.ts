import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore"

import { db } from "./firebase"
import type {
  EmailAgentPreview,
  EmailAgentProposedAction,
  EmailWorkAnalysis,
  EmailWorkProposal,
  EmailWorkProposalStatus,
} from "./email-agent-types"

const EMAIL_WORK_PROPOSALS_COLLECTION = "ai_email_work_proposals"

function toIsoDate(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString()
  }
  return undefined
}

export function buildEmailDuplicateKey(email: Pick<EmailAgentPreview, "messageId" | "subject" | "receivedAt" | "from">) {
  const messageId = email.messageId.trim().toLowerCase()
  if (messageId) return `message:${messageId}`

  const receivedDay = email.receivedAt ? email.receivedAt.slice(0, 10) : "unknown-date"
  const subject = email.subject.trim().toLowerCase().replace(/\s+/g, " ")
  const from = email.from.trim().toLowerCase()
  return `fallback:${from}:${receivedDay}:${subject}`
}

function normalizeProposal(id: string, raw: Record<string, unknown>): EmailWorkProposal {
  const analysis = (raw.analysis || {}) as EmailWorkAnalysis
  return {
    id,
    status: (raw.status as EmailWorkProposalStatus) || "pending",
    duplicateKey: typeof raw.duplicateKey === "string" ? raw.duplicateKey : "",
    sourceEmail: (raw.sourceEmail || {}) as EmailAgentPreview,
    analysis,
    proposedActions: Array.isArray(raw.proposedActions)
      ? (raw.proposedActions as EmailAgentProposedAction[])
      : analysis.proposedActions || [],
    createdAt: toIsoDate(raw.createdAt),
    reviewedBy: typeof raw.reviewedBy === "string" ? raw.reviewedBy : undefined,
    reviewedAt: toIsoDate(raw.reviewedAt),
    appliedAt: toIsoDate(raw.appliedAt),
    appliedTaskId: typeof raw.appliedTaskId === "string" ? raw.appliedTaskId : undefined,
    appliedActionIndex: typeof raw.appliedActionIndex === "number" ? raw.appliedActionIndex : undefined,
    rejectedAt: toIsoDate(raw.rejectedAt),
  }
}

export async function fetchEmailWorkProposal(proposalId: string): Promise<EmailWorkProposal | null> {
  const snapshot = await getDoc(doc(db, EMAIL_WORK_PROPOSALS_COLLECTION, proposalId))
  if (!snapshot.exists()) return null
  return normalizeProposal(snapshot.id, snapshot.data())
}

export async function createPendingEmailWorkProposal(input: {
  sourceEmail: EmailAgentPreview
  analysis: EmailWorkAnalysis
}): Promise<{ proposal: EmailWorkProposal; duplicate: boolean }> {
  const duplicateKey = buildEmailDuplicateKey(input.sourceEmail)
  const existingQuery = query(
    collection(db, EMAIL_WORK_PROPOSALS_COLLECTION),
    where("duplicateKey", "==", duplicateKey),
    limit(1),
  )
  const existing = await getDocs(existingQuery)

  if (!existing.empty) {
    const first = existing.docs[0]
    return {
      proposal: normalizeProposal(first.id, first.data()),
      duplicate: true,
    }
  }

  const payload = {
    status: "pending" satisfies EmailWorkProposalStatus,
    duplicateKey,
    sourceEmail: input.sourceEmail,
    analysis: input.analysis,
    proposedActions: input.analysis.proposedActions || [],
    createdAt: serverTimestamp(),
  }
  const docRef = await addDoc(collection(db, EMAIL_WORK_PROPOSALS_COLLECTION), payload)

  return {
    proposal: {
      id: docRef.id,
      ...payload,
      status: "pending",
      createdAt: new Date().toISOString(),
    },
    duplicate: false,
  }
}

export async function markEmailWorkProposalApplied(input: {
  proposalId: string
  actorEmail?: string
  appliedTaskId: string
  appliedActionIndex: number
  appliedAction: EmailAgentProposedAction
}) {
  await updateDoc(doc(db, EMAIL_WORK_PROPOSALS_COLLECTION, input.proposalId), {
    status: "applied" satisfies EmailWorkProposalStatus,
    reviewedBy: input.actorEmail || null,
    reviewedAt: serverTimestamp(),
    appliedAt: serverTimestamp(),
    appliedTaskId: input.appliedTaskId,
    appliedActionIndex: input.appliedActionIndex,
    appliedAction: input.appliedAction,
  })
}

export async function markEmailWorkProposalRejected(input: {
  proposalId: string
  actorEmail?: string
}) {
  await updateDoc(doc(db, EMAIL_WORK_PROPOSALS_COLLECTION, input.proposalId), {
    status: "rejected" satisfies EmailWorkProposalStatus,
    reviewedBy: input.actorEmail || null,
    reviewedAt: serverTimestamp(),
    rejectedAt: serverTimestamp(),
  })
}
