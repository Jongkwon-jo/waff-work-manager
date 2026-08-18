"use client"

import { useEffect, useState } from "react"
import type { User } from "firebase/auth"

type UserAccountDirectoryResponse = {
  accountEmails?: unknown
  activeAccountEmails?: unknown
  accountProfiles?: unknown
  error?: unknown
}

export type UserAccountDirectoryProfile = {
  email: string
  taskAliases: string[]
}

type UserAccountDirectory = {
  accountEmails: ReadonlySet<string> | null
  activeAccountEmails: ReadonlySet<string> | null
  accountProfiles: readonly UserAccountDirectoryProfile[] | null
  loading: boolean
  error: string | null
}

type LoadedUserAccountDirectory = {
  uid: string
  accountEmails: ReadonlySet<string>
  activeAccountEmails: ReadonlySet<string>
  accountProfiles: readonly UserAccountDirectoryProfile[]
  error: string | null
}

function normalizeEmails(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(
    value
      .filter((email): email is string => typeof email === "string")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

function normalizeProfiles(value: unknown): UserAccountDirectoryProfile[] {
  if (!Array.isArray(value)) return []
  return value
    .map((profile) => {
      if (!profile || typeof profile !== "object" || !("email" in profile)) return null
      const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : ""
      if (!email) return null
      const rawAliases: unknown[] = "taskAliases" in profile && Array.isArray(profile.taskAliases) ? profile.taskAliases : []
      const taskAliases = Array.from(
        new Set(
          rawAliases
            .filter((alias): alias is string => typeof alias === "string")
            .map((alias) => alias.trim())
            .filter(Boolean),
        ),
      )
      return { email, taskAliases }
    })
    .filter((profile): profile is UserAccountDirectoryProfile => Boolean(profile))
    .sort((a, b) => a.email.localeCompare(b.email))
}

export function useUserAccountDirectory(user: User | null): UserAccountDirectory {
  const [loadedDirectory, setLoadedDirectory] = useState<LoadedUserAccountDirectory>({
    uid: "",
    accountEmails: new Set(),
    activeAccountEmails: new Set(),
    accountProfiles: [],
    error: null,
  })

  useEffect(() => {
    const controller = new AbortController()

    if (!user) return () => controller.abort()

    void (async () => {
      try {
        const idToken = await user.getIdToken()
        const response = await fetch("/api/user-accounts/directory", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          cache: "no-store",
          signal: controller.signal,
        })
        const responseBody = await response.text()
        let data: UserAccountDirectoryResponse

        try {
          data = responseBody ? (JSON.parse(responseBody) as UserAccountDirectoryResponse) : {}
        } catch {
          const contentType = response.headers.get("content-type") || ""
          const isHtmlResponse = contentType.includes("text/html") || responseBody.trimStart().startsWith("<!DOCTYPE")
          throw new Error(
            isHtmlResponse
              ? "계정 조회 API가 HTML 오류 페이지를 반환했습니다. Next.js 서버를 재시작한 뒤 다시 시도해 주세요."
              : `계정 조회 API가 올바르지 않은 응답을 반환했습니다. (HTTP ${response.status})`,
          )
        }

        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "인증 계정 목록 조회에 실패했습니다.")
        }
        if (controller.signal.aborted) return

        setLoadedDirectory({
          uid: user.uid,
          accountEmails: normalizeEmails(data.accountEmails),
          activeAccountEmails: normalizeEmails(data.activeAccountEmails),
          accountProfiles: normalizeProfiles(data.accountProfiles),
          error: null,
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setLoadedDirectory({
          uid: user.uid,
          accountEmails: new Set(),
          activeAccountEmails: new Set(),
          accountProfiles: [],
          error: error instanceof Error ? error.message : "인증 계정 목록 조회에 실패했습니다.",
        })
      }
    })()

    return () => controller.abort()
  }, [user])

  if (!user) {
    return {
      accountEmails: null,
      activeAccountEmails: null,
      accountProfiles: null,
      loading: false,
      error: null,
    }
  }

  if (loadedDirectory.uid !== user.uid) {
    return {
      accountEmails: null,
      activeAccountEmails: null,
      accountProfiles: null,
      loading: true,
      error: null,
    }
  }

  return {
    accountEmails: loadedDirectory.accountEmails,
    activeAccountEmails: loadedDirectory.activeAccountEmails,
    accountProfiles: loadedDirectory.accountProfiles,
    loading: false,
    error: loadedDirectory.error,
  }
}
