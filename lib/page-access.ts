export const ADMIN_EMAIL = "admin@waff.co.kr"
export const MY_PAGE_TEST_ALLOWED_EMAILS = [ADMIN_EMAIL, "jongkwon.jo@waff.co.kr"] as const

export const PAGE_PERMISSIONS = [
  { key: "myPage", label: "마이 워크", path: "/my-page" },
  { key: "strategyWorkManagement", label: "전략기획 사업부 스케줄", path: "/work-management" },
  { key: "strategyWorkManagementEdit", label: "전략기획 사업부 스케줄 수정", path: "/work-management" },
  { key: "strategyWeeklyWork", label: "전략기획 주간업무로드 현황", path: "/weekly-work" },
  { key: "faWorkManagement", label: "FA사업부 스케줄", path: "/fa-work-management" },
  { key: "faWorkManagementEdit", label: "FA사업부 스케줄 수정", path: "/fa-work-management" },
  { key: "faWeeklyWork", label: "FA 주간업무로드 현황", path: "/weekly-work" },
  { key: "ictWorkManagement", label: "ICT 사업부 스케줄", path: "/ict-work-management" },
  { key: "ictWorkManagementEdit", label: "ICT 사업부 스케줄 수정", path: "/ict-work-management" },
  { key: "ictWeeklyWork", label: "ICT 주간업무로드 현황", path: "/weekly-work" },
  { key: "gptTest", label: "GPT 테스트", path: "/gpt-test" },
  { key: "mbtiPage", label: "MBTI", path: "/mbti" },
  { key: "dailyReport", label: "Daily Report", path: "/daily-report" },
  { key: "recentChangesWidget", label: "최근 사용자 변경 위젯", path: "" },
] as const

export type PagePermissionKey = (typeof PAGE_PERMISSIONS)[number]["key"]

export type UserPagePermissions = Record<PagePermissionKey, boolean>

export const DEFAULT_PAGE_PERMISSIONS: UserPagePermissions = {
  myPage: true,
  strategyWorkManagement: true,
  strategyWorkManagementEdit: true,
  strategyWeeklyWork: true,
  faWorkManagement: true,
  faWorkManagementEdit: true,
  faWeeklyWork: true,
  ictWorkManagement: true,
  ictWorkManagementEdit: true,
  ictWeeklyWork: true,
  gptTest: true,
  mbtiPage: true,
  dailyReport: false,
  recentChangesWidget: false,
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
    strategyWorkManagementEdit:
      typeof raw?.strategyWorkManagementEdit === "boolean"
        ? raw.strategyWorkManagementEdit
        : DEFAULT_PAGE_PERMISSIONS.strategyWorkManagementEdit,
    strategyWeeklyWork:
      typeof raw?.strategyWeeklyWork === "boolean"
        ? raw.strategyWeeklyWork
        : DEFAULT_PAGE_PERMISSIONS.strategyWeeklyWork,
    faWorkManagement:
      typeof raw?.faWorkManagement === "boolean" ? raw.faWorkManagement : DEFAULT_PAGE_PERMISSIONS.faWorkManagement,
    faWorkManagementEdit:
      typeof raw?.faWorkManagementEdit === "boolean"
        ? raw.faWorkManagementEdit
        : DEFAULT_PAGE_PERMISSIONS.faWorkManagementEdit,
    faWeeklyWork:
      typeof raw?.faWeeklyWork === "boolean" ? raw.faWeeklyWork : DEFAULT_PAGE_PERMISSIONS.faWeeklyWork,
    ictWorkManagement:
      typeof raw?.ictWorkManagement === "boolean" ? raw.ictWorkManagement : DEFAULT_PAGE_PERMISSIONS.ictWorkManagement,
    ictWorkManagementEdit:
      typeof raw?.ictWorkManagementEdit === "boolean"
        ? raw.ictWorkManagementEdit
        : DEFAULT_PAGE_PERMISSIONS.ictWorkManagementEdit,
    ictWeeklyWork:
      typeof raw?.ictWeeklyWork === "boolean" ? raw.ictWeeklyWork : DEFAULT_PAGE_PERMISSIONS.ictWeeklyWork,
    gptTest: typeof raw?.gptTest === "boolean" ? raw.gptTest : DEFAULT_PAGE_PERMISSIONS.gptTest,
    mbtiPage: typeof raw?.mbtiPage === "boolean" ? raw.mbtiPage : DEFAULT_PAGE_PERMISSIONS.mbtiPage,
    dailyReport:
      typeof raw?.dailyReport === "boolean" ? raw.dailyReport : DEFAULT_PAGE_PERMISSIONS.dailyReport,
    recentChangesWidget:
      typeof raw?.recentChangesWidget === "boolean"
        ? raw.recentChangesWidget
        : DEFAULT_PAGE_PERMISSIONS.recentChangesWidget,
  }
}

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export function resolvePathToPermissionKey(pathname: string): PagePermissionKey | null {
  if (matchesRoute(pathname, "/my-page")) return "myPage"
  if (matchesRoute(pathname, "/work-management/weekly")) return "strategyWeeklyWork"
  if (matchesRoute(pathname, "/work-management")) return "strategyWorkManagement"
  if (matchesRoute(pathname, "/ict-work-management/weekly")) return "ictWeeklyWork"
  if (matchesRoute(pathname, "/ict-work-management")) return "ictWorkManagement"
  if (matchesRoute(pathname, "/fa-work-management/weekly")) return "faWeeklyWork"
  if (matchesRoute(pathname, "/fa-work-management")) return "faWorkManagement"
  if (matchesRoute(pathname, "/gpt-test")) return "gptTest"
  if (matchesRoute(pathname, "/mbti")) return "mbtiPage"
  if (matchesRoute(pathname, "/daily-report")) return "dailyReport"
  return null
}

export function isAdminEmail(email?: string | null) {
  return normalizeEmail(email || "") === ADMIN_EMAIL
}

export function canAccessMyPageTest(email?: string | null) {
  const normalized = normalizeEmail(email || "")
  return MY_PAGE_TEST_ALLOWED_EMAILS.includes(normalized as (typeof MY_PAGE_TEST_ALLOWED_EMAILS)[number])
}
