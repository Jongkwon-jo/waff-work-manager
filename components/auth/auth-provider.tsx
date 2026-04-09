"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { onAuthStateChanged, type User } from "firebase/auth"
import {
  DEFAULT_DEPARTMENT_PAGE_PERMISSIONS,
  subscribeCurrentUserProfile,
  subscribeCurrentUserPagePermissions,
  subscribeDepartmentPagePermissions,
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

    let userPermissions = DEFAULT_PAGE_PERMISSIONS
    let userDepartmentPermissions = DEFAULT_PAGE_PERMISSIONS
    let resolvedDepartment: keyof typeof DEFAULT_DEPARTMENT_PAGE_PERMISSIONS | null = null
    let hasUserPermissions = false
    let hasDepartmentPermissions = false
    let hasProfile = false

    const syncPermissions = () => {
      if (!hasUserPermissions || !hasDepartmentPermissions || !hasProfile) return

      setPagePermissions({
        myPage: userPermissions.myPage && userDepartmentPermissions.myPage,
        strategyWorkManagement: userPermissions.strategyWorkManagement && userDepartmentPermissions.strategyWorkManagement,
        strategyWorkManagementEdit: userPermissions.strategyWorkManagementEdit && userDepartmentPermissions.strategyWorkManagementEdit,
        strategyWeeklyWork: userPermissions.strategyWeeklyWork && userDepartmentPermissions.strategyWeeklyWork,
        faWorkManagement: userPermissions.faWorkManagement && userDepartmentPermissions.faWorkManagement,
        faWorkManagementEdit: userPermissions.faWorkManagementEdit && userDepartmentPermissions.faWorkManagementEdit,
        faWeeklyWork: userPermissions.faWeeklyWork && userDepartmentPermissions.faWeeklyWork,
        gptTest: userPermissions.gptTest && userDepartmentPermissions.gptTest,
      })
      setPermissionLoading(false)
    }

    const unsubscribeProfile = subscribeCurrentUserProfile(email, (profile) => {
      resolvedDepartment = profile?.department || null
      userDepartmentPermissions = resolvedDepartment
        ? DEFAULT_DEPARTMENT_PAGE_PERMISSIONS[resolvedDepartment]
        : DEFAULT_PAGE_PERMISSIONS
      hasProfile = true
      syncPermissions()
    })

    const unsubscribeDepartmentPermissions = subscribeDepartmentPagePermissions((permissions) => {
      userDepartmentPermissions = resolvedDepartment ? permissions[resolvedDepartment] : DEFAULT_PAGE_PERMISSIONS
      hasDepartmentPermissions = true
      syncPermissions()
    })

    const unsubscribePermissions = subscribeCurrentUserPagePermissions(email, (permissions) => {
      userPermissions = permissions
      hasUserPermissions = true
      syncPermissions()
    })

    return () => {
      unsubscribeProfile()
      unsubscribeDepartmentPermissions()
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
