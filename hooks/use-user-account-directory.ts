"use client"

import { useEffect, useState } from "react"
import type { User } from "firebase/auth"

type UserAccountDirectoryResponse = {
  accountEmails?: unknown
  activeAccountEmails?: unknown
  error?: unknown
}

type UserAccountDirectory = {
  accountEmails: ReadonlySet<string> | null
  activeAccountEmails: ReadonlySet<string> | null
  loading: boolean
  error: string | null
}

type LoadedUserAccountDirectory = {
  uid: string
  accountEmails: ReadonlySet<string>
  activeAccountEmails: ReadonlySet<string>
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

export function useUserAccountDirectory(user: User | null): UserAccountDirectory {
  const [loadedDirectory, setLoadedDirectory] = useState<LoadedUserAccountDirectory>({
    uid: "",
    accountEmails: new Set(),
    activeAccountEmails: new Set(),
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
        const data = (await response.json()) as UserAccountDirectoryResponse
        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "인증 계정 목록 조회에 실패했습니다.")
        }
        if (controller.signal.aborted) return

        setLoadedDirectory({
          uid: user.uid,
          accountEmails: normalizeEmails(data.accountEmails),
          activeAccountEmails: normalizeEmails(data.activeAccountEmails),
          error: null,
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setLoadedDirectory({
          uid: user.uid,
          accountEmails: new Set(),
          activeAccountEmails: new Set(),
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
      loading: false,
      error: null,
    }
  }

  if (loadedDirectory.uid !== user.uid) {
    return {
      accountEmails: null,
      activeAccountEmails: null,
      loading: true,
      error: null,
    }
  }

  return {
    accountEmails: loadedDirectory.accountEmails,
    activeAccountEmails: loadedDirectory.activeAccountEmails,
    loading: false,
    error: loadedDirectory.error,
  }
}
