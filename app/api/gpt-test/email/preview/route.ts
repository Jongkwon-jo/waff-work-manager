import { NextResponse } from "next/server"

import type { EmailAgentSettings } from "@/lib/email-agent-types"

import { fetchEmailAgentMessages, toEmailPreview } from "../_shared"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Number(searchParams.get("limit") || 10)
    const mailbox = searchParams.get("mailbox") || "INBOX"
    const unreadOnly = searchParams.get("unreadOnly") === "true"
    const since = searchParams.get("since") || undefined

    const emails = await fetchEmailAgentMessages({
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 10,
      mailbox,
      unreadOnly,
      since,
    })

    return NextResponse.json({
      emails: emails.map(toEmailPreview),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "이메일 미리보기를 불러오지 못했습니다.",
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      limit?: number
      mailbox?: string
      unreadOnly?: boolean
      since?: string
      settings?: EmailAgentSettings
    }

    const limit = Number(body.limit || 10)
    const emails = await fetchEmailAgentMessages({
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 10,
      mailbox: body.mailbox || body.settings?.imapMailbox || "INBOX",
      unreadOnly: Boolean(body.unreadOnly),
      since: body.since,
      settings: body.settings,
    })

    return NextResponse.json({
      emails: emails.map(toEmailPreview),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "이메일 미리보기를 불러오지 못했습니다.",
      },
      { status: 500 },
    )
  }
}
