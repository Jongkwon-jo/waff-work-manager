import { NextResponse } from "next/server"

import type { EmailAgentSettings } from "@/lib/email-agent-types"
import { createPendingEmailWorkProposal } from "@/lib/gpt-test-email-proposals"

import {
  analyzeEmailWithAgent,
  fetchEmailAgentMessages,
  fetchProjectSnapshotsForEmailAgent,
  toEmailPreview,
  todayIsoDate,
} from "../_shared"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      emailIds?: string[]
      limit?: number
      mailbox?: string
      unreadOnly?: boolean
      settings?: EmailAgentSettings
    }

    const selectedEmailIds = Array.isArray(body.emailIds)
      ? body.emailIds.filter((emailId): emailId is string => typeof emailId === "string" && emailId.trim().length > 0)
      : []

    if (selectedEmailIds.length === 0) {
      return NextResponse.json({ error: "분석할 이메일을 선택해 주세요." }, { status: 400 })
    }

    const fetchLimit = Math.min(Math.max(body.limit || 20, selectedEmailIds.length), 50)
    const [emails, projectSnapshots] = await Promise.all([
      fetchEmailAgentMessages({
        limit: fetchLimit,
        mailbox: body.mailbox || body.settings?.imapMailbox || "INBOX",
        unreadOnly: Boolean(body.unreadOnly),
        settings: body.settings,
      }),
      fetchProjectSnapshotsForEmailAgent(),
    ])

    const selectedEmails = emails.filter((email) => selectedEmailIds.includes(email.emailId))
    if (selectedEmails.length === 0) {
      return NextResponse.json({ error: "선택한 이메일을 다시 찾지 못했습니다. 목록을 새로고침해 주세요." }, { status: 404 })
    }

    const analysisDate = todayIsoDate()
    const proposals = []

    for (const email of selectedEmails) {
      const analysis = await analyzeEmailWithAgent({
        email,
        projectSnapshots,
        analysisDate,
        settings: body.settings,
      })
      const result = await createPendingEmailWorkProposal({
        sourceEmail: toEmailPreview(email),
        analysis,
      })

      proposals.push({
        proposal: result.proposal,
        duplicate: result.duplicate,
      })
    }

    return NextResponse.json({
      proposals,
      analyses: proposals.map((item) => item.proposal.analysis),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "이메일 분석 중 오류가 발생했습니다.",
      },
      { status: 500 },
    )
  }
}
