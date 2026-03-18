export const ADMIN_EMAIL = "admin@waff.co.kr"

export const PAGE_PERMISSIONS = [
  { key: "myPage", label: "마이 페이지", path: "/my-page" },
  { key: "strategyWorkManagement", label: "전략사업부 업무관리", path: "/work-management" },
  { key: "faWorkManagement", label: "FA 사업부 업무관리", path: "/fa-work-management" },
  { key: "gptTest", label: "GPT 테스트", path: "/gpt-test" },
] as const

export type PagePermissionKey = (typeof PAGE_PERMISSIONS)[number]["key"]

export type UserPagePermissions = Record<PagePermissionKey, boolean>

export const DEFAULT_PAGE_PERMISSIONS: UserPagePermissions = {
  myPage: true,
  strategyWorkManagement: true,
  faWorkManagement: true,
  gptTest: true,
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function permissionDocId(email: string) {
  return encodeURIComponent(normalizeEmail(email))
}

export function normalizePermissions(raw?: Partial<Record<string, unknown>>): UserPagePermissions {
  const legacyWorkManagement =
    typeof raw?.strategyWorkManagement === "boolean"
      ? raw.strategyWorkManagement
      : typeof raw?.workManagement === "boolean"
        ? raw.workManagement
        : DEFAULT_PAGE_PERMISSIONS.strategyWorkManagement

  return {
    myPage: typeof raw?.myPage === "boolean" ? raw.myPage : DEFAULT_PAGE_PERMISSIONS.myPage,
    strategyWorkManagement: legacyWorkManagement,
    faWorkManagement:
      typeof raw?.faWorkManagement === "boolean" ? raw.faWorkManagement : DEFAULT_PAGE_PERMISSIONS.faWorkManagement,
    gptTest: typeof raw?.gptTest === "boolean" ? raw.gptTest : DEFAULT_PAGE_PERMISSIONS.gptTest,
  }
}

export function resolvePathToPermissionKey(pathname: string): PagePermissionKey | null {
  if (pathname.startsWith("/my-page")) return "myPage"
  if (pathname.startsWith("/work-management")) return "strategyWorkManagement"
  if (pathname.startsWith("/fa-work-management")) return "faWorkManagement"
  if (pathname.startsWith("/gpt-test")) return "gptTest"
  return null
}

export function isAdminEmail(email?: string | null) {
  return normalizeEmail(email || "") === ADMIN_EMAIL
}
