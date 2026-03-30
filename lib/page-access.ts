export const ADMIN_EMAIL = "admin@waff.co.kr"

export const PAGE_PERMISSIONS = [
  { key: "myPage", label: "마이 페이지", path: "/my-page" },
  { key: "strategyWorkManagement", label: "전략기획사업부 업무관리", path: "/work-management" },
  { key: "strategyWeeklyWork", label: "전략기획사업부 주간업무", path: "/work-management/weekly" },
  { key: "faWorkManagement", label: "FA사업부 업무관리", path: "/fa-work-management" },
  { key: "faWeeklyWork", label: "FA사업부 주간업무", path: "/fa-work-management/weekly" },
  { key: "gptTest", label: "GPT 테스트", path: "/gpt-test" },
] as const

export type PagePermissionKey = (typeof PAGE_PERMISSIONS)[number]["key"]

export type UserPagePermissions = Record<PagePermissionKey, boolean>

export const DEFAULT_PAGE_PERMISSIONS: UserPagePermissions = {
  myPage: true,
  strategyWorkManagement: true,
  strategyWeeklyWork: true,
  faWorkManagement: true,
  faWeeklyWork: true,
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
    strategyWeeklyWork:
      typeof raw?.strategyWeeklyWork === "boolean"
        ? raw.strategyWeeklyWork
        : DEFAULT_PAGE_PERMISSIONS.strategyWeeklyWork,
    faWorkManagement:
      typeof raw?.faWorkManagement === "boolean" ? raw.faWorkManagement : DEFAULT_PAGE_PERMISSIONS.faWorkManagement,
    faWeeklyWork:
      typeof raw?.faWeeklyWork === "boolean" ? raw.faWeeklyWork : DEFAULT_PAGE_PERMISSIONS.faWeeklyWork,
    gptTest: typeof raw?.gptTest === "boolean" ? raw.gptTest : DEFAULT_PAGE_PERMISSIONS.gptTest,
  }
}

export function resolvePathToPermissionKey(pathname: string): PagePermissionKey | null {
  if (pathname.startsWith("/my-page")) return "myPage"
  if (pathname.startsWith("/work-management/weekly")) return "strategyWeeklyWork"
  if (pathname.startsWith("/work-management")) return "strategyWorkManagement"
  if (pathname.startsWith("/fa-work-management/weekly")) return "faWeeklyWork"
  if (pathname.startsWith("/fa-work-management")) return "faWorkManagement"
  if (pathname.startsWith("/gpt-test")) return "gptTest"
  return null
}

export function isAdminEmail(email?: string | null) {
  return normalizeEmail(email || "") === ADMIN_EMAIL
}
