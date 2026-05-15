"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { onAuthStateChanged, type User } from "firebase/auth"
import {
  subscribeCurrentUserPagePermissions,
  upsertUserProfile,
} from "@/lib/firestore-service"
import { auth } from "@/lib/firebase"
import {
  DEFAULT_PAGE_PERMISSIONS,
  isAdminEmail,
  normalizeEmail,
  type UserPagePermissions,
} from "@/lib/page-access"

type AuthContextValue = {
  user: User | null
  loading: boolean
  permissionLoading: boolean
  isAdmin: boolean
  pagePermissions: UserPagePermissions
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [permissionLoading, setPermissionLoading] = useState(true)
  const [pagePermissions, setPagePermissions] = useState<UserPagePermissions>(DEFAULT_PAGE_PERMISSIONS)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!user?.email) {
      setPagePermissions(DEFAULT_PAGE_PERMISSIONS)
      setPermissionLoading(false)
      return
    }

    const email = normalizeEmail(user.email)
    setPermissionLoading(true)
    void upsertUserProfile(email)

    const unsubscribePermissions = subscribeCurrentUserPagePermissions(email, (permissions) => {
      setPagePermissions(permissions)
      setPermissionLoading(false)
    })

    return () => {
      unsubscribePermissions()
    }
  }, [user])

  const value: AuthContextValue = {
    user,
    loading,
    permissionLoading,
    isAdmin: isAdminEmail(user?.email),
    pagePermissions,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }

  return context
}
