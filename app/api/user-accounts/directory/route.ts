import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") || ""
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : ""
}

function getAccountDirectoryErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "name" in error && error.name === "FirebaseAdminConfigurationError") {
    const code = "code" in error ? error.code : undefined
    if (code === "missing-service-account") {
      return "Vercel Production 환경에 FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON이 없습니다. 환경변수를 저장한 뒤 재배포해 주세요."
    }
    if (code === "invalid-service-account-json") {
      return "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON 값이 올바른 JSON이 아닙니다. 서비스 계정 JSON 파일의 전체 내용을 다시 입력해 주세요."
    }
    if (code === "incomplete-service-account") {
      return "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON에 project_id, client_email 또는 private_key가 없습니다."
    }
  }

  const firebaseErrorCode =
    error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : ""
  if (firebaseErrorCode === "app/invalid-credential" || firebaseErrorCode === "auth/invalid-credential") {
    return "Vercel에 등록된 Firebase 서비스 계정 키가 유효하지 않거나 권한이 없습니다. JSON 값을 다시 등록해 주세요."
  }

  return "Firebase 인증 계정 목록을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."
}

export async function GET(request: Request) {
  const token = getBearerToken(request)
  if (!token) {
    return NextResponse.json({ error: "인증 정보가 없습니다." }, { status: 401 })
  }

  try {
    const { getFirebaseAdminAuth } = await import("@/lib/firebase-admin")
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
    return NextResponse.json(
      {
        error: getAccountDirectoryErrorMessage(error),
      },
      { status: 503 },
    )
  }
}
