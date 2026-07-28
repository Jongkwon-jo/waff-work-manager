import { NextResponse } from "next/server"
import { getFirebaseAdminAuth } from "@/lib/firebase-admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") || ""
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : ""
}

export async function GET(request: Request) {
  const token = getBearerToken(request)
  if (!token) {
    return NextResponse.json({ error: "인증 정보가 없습니다." }, { status: 401 })
  }

  try {
    const adminAuth = getFirebaseAdminAuth()
    const decodedToken = await adminAuth.verifyIdToken(token)
    if (!decodedToken.email) {
      return NextResponse.json({ error: "이메일 계정만 조회할 수 있습니다." }, { status: 403 })
    }

    const accountEmails = new Set<string>()
    const activeAccountEmails = new Set<string>()
    let pageToken: string | undefined

    do {
      const page = await adminAuth.listUsers(1000, pageToken)
      page.users.forEach((account) => {
        const email = account.email?.trim().toLowerCase()
        if (!email) return
        accountEmails.add(email)
        if (!account.disabled) activeAccountEmails.add(email)
      })
      pageToken = page.pageToken
    } while (pageToken)

    return NextResponse.json(
      {
        accountEmails: Array.from(accountEmails).sort((a, b) => a.localeCompare(b)),
        activeAccountEmails: Array.from(activeAccountEmails).sort((a, b) => a.localeCompare(b)),
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    )
  } catch (error) {
    console.error("Firebase Auth account directory error:", error)
    return NextResponse.json({ error: "인증 계정 목록을 확인할 수 없습니다." }, { status: 503 })
  }
}
