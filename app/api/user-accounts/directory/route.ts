import { NextResponse } from "next/server"
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from "@/lib/firebase-admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type AccountDirectoryOperation = "initialize" | "verify-token" | "list-users" | "list-profiles"

const ACCOUNT_DIRECTORY_API_VERSION = "5"

function getBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") || ""
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : ""
}

function getSafeFirebaseErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return ""
  return /^[a-z0-9_/-]{1,80}$/i.test(error.code) ? error.code : ""
}

function getAccountDirectoryErrorMessage(error: unknown, operation: AccountDirectoryOperation): string {
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
    if (code === "invalid-private-key") {
      return "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON의 private_key가 손상되었거나 올바른 PEM 키가 아닙니다. JSON 값을 다시 등록해 주세요."
    }
  }

  const firebaseErrorCode = getSafeFirebaseErrorCode(error)
  if (firebaseErrorCode === "app/invalid-credential" || firebaseErrorCode === "auth/invalid-credential") {
    return "Vercel에 등록된 Firebase 서비스 계정 키가 유효하지 않거나 권한이 없습니다. JSON 값을 다시 등록해 주세요."
  }

  const errorCodeSuffix = firebaseErrorCode ? ` (오류 코드: ${firebaseErrorCode})` : ""
  if (operation === "verify-token") {
    return `로그인 토큰의 Firebase 프로젝트와 서버에 등록된 서비스 계정 프로젝트가 일치하지 않습니다.${errorCodeSuffix}`
  }
  if (operation === "list-users") {
    return `Firebase Auth 계정 목록 조회가 거부되었습니다. 서비스 계정의 프로젝트와 권한을 확인해 주세요.${errorCodeSuffix}`
  }
  if (operation === "list-profiles") {
    return `사용자 별칭 목록 조회가 거부되었습니다. 서비스 계정의 Firestore 권한을 확인해 주세요.${errorCodeSuffix}`
  }
  return `Firebase Admin 초기화에 실패했습니다.${errorCodeSuffix}`
}

export async function GET(request: Request) {
  const token = getBearerToken(request)
  if (!token) {
    return NextResponse.json({ error: "인증 정보가 없습니다." }, { status: 401 })
  }

  let operation: AccountDirectoryOperation = "initialize"

  try {
    const adminAuth = getFirebaseAdminAuth()
    operation = "verify-token"
    const decodedToken = await adminAuth.verifyIdToken(token)
    if (!decodedToken.email) {
      return NextResponse.json({ error: "이메일 계정만 조회할 수 있습니다." }, { status: 403 })
    }

    operation = "list-users"
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

    operation = "list-profiles"
    const profileSnapshot = await getFirebaseAdminFirestore().collection("user_profiles").get()
    const accountProfiles = profileSnapshot.docs
      .map((document) => {
        const data = document.data() as { email?: unknown; taskAliases?: unknown }
        const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : ""
        if (!email || !activeAccountEmails.has(email)) return null
        const taskAliases = Array.isArray(data.taskAliases)
          ? Array.from(
              new Set(
                data.taskAliases
                  .filter((alias): alias is string => typeof alias === "string")
                  .map((alias) => alias.trim())
                  .filter(Boolean),
              ),
            )
          : []
        return { email, taskAliases }
      })
      .filter((profile): profile is { email: string; taskAliases: string[] } => Boolean(profile))
      .sort((a, b) => a.email.localeCompare(b.email))

    return NextResponse.json(
      {
        accountEmails: Array.from(accountEmails).sort((a, b) => a.localeCompare(b)),
        activeAccountEmails: Array.from(activeAccountEmails).sort((a, b) => a.localeCompare(b)),
        accountProfiles,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-Account-Directory-Version": ACCOUNT_DIRECTORY_API_VERSION,
        },
      },
    )
  } catch (error) {
    console.error("Firebase Auth account directory error:", error)
    return NextResponse.json(
      {
        error: getAccountDirectoryErrorMessage(error, operation),
      },
      {
        status: 503,
        headers: {
          "X-Account-Directory-Version": ACCOUNT_DIRECTORY_API_VERSION,
        },
      },
    )
  }
}
