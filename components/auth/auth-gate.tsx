"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { ShieldAlert } from "lucide-react"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { LoginForm } from "@/components/auth/login-form"
import { useAuth } from "@/components/auth/auth-provider"
import { resolvePathToPermissionKey } from "@/lib/page-access"

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { user, loading, permissionLoading, isAdmin, pagePermissions } = useAuth()

  if (loading || (user && permissionLoading)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">로그인 상태를 확인하는 중...</p>
      </div>
    )
  }

  if (!user) {
    return <LoginForm />
  }

  if (pathname.startsWith("/admin") && !isAdmin) {
    return <AccessDenied message="관리자 계정만 관리자 페이지에 접근할 수 있습니다." />
  }

  const permissionKey = resolvePathToPermissionKey(pathname)
  if (
    pathname.startsWith("/weekly-work") &&
    !isAdmin &&
    !pagePermissions.strategyWeeklyWork &&
    !pagePermissions.faWeeklyWork &&
    !pagePermissions.ictWeeklyWork
  ) {
    return <AccessDenied message="이 페이지를 볼 수 있는 권한이 없습니다." />
  }
  if (permissionKey && !isAdmin && !pagePermissions[permissionKey]) {
    return <AccessDenied message="이 페이지를 볼 수 있는 권한이 없습니다." />
  }

  return <>{children}</>
}

function AccessDenied({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-card-foreground">접근 권한 없음</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Button asChild className="mt-6">
          <Link href="/">메인으로 이동</Link>
        </Button>
      </div>
    </div>
  )
}
