import { NextResponse } from "next/server"

import {
  fetchEmailWorkProposal,
  markEmailWorkProposalRejected,
} from "@/lib/gpt-test-email-proposals"

export async function PATCH(
  request: Request,
  context: { params: Promise<{ proposalId: string }> },
) {
  try {
    const { proposalId } = await context.params
    const body = (await request.json().catch(() => ({}))) as {
      status?: string
      actorEmail?: string
    }

    if (body.status !== "rejected") {
      return NextResponse.json({ error: "지원하지 않는 제안 상태입니다." }, { status: 400 })
    }

    const proposal = await fetchEmailWorkProposal(proposalId)
    if (!proposal) {
      return NextResponse.json({ error: "이메일 업무 제안을 찾지 못했습니다." }, { status: 404 })
    }
    if (proposal.status !== "pending") {
      return NextResponse.json({ error: "이미 처리된 이메일 업무 제안입니다." }, { status: 409 })
    }

    await markEmailWorkProposalRejected({
      proposalId,
      actorEmail: body.actorEmail,
    })

    return NextResponse.json({
      proposalId,
      status: "rejected",
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "이메일 업무 제안 거절 중 오류가 발생했습니다.",
      },
      { status: 500 },
    )
  }
}
