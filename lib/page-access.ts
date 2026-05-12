export const ADMIN_EMAIL = "admin@waff.co.kr"

export const PAGE_PERMISSIONS = [
  { key: "myPage", label: "마이 워크", path: "/my-page" },
  { key: "strategyWorkManagement", label: "전략기획 사업부 스케줄", path: "/work-management" },
  { key: "strategyWorkManagementEdit", label: "전략기획 사업부 스케줄 수정", path: "/work-management" },
  { key: "strategyWeeklyWork", label: "전략기획 주간업무로드 현황", path: "/weekly-work" },
  { key: "faWorkManagement", label: "FA사업부 스케줄", path: "/fa-work-management" },
  { key: "faWorkManagementEdit", label: "FA사업부 스케줄 수정", path: "/fa-work-management" },
  { key: "faWeeklyWork", label: "FA 주간업무로드 현황", path: "/weekly-work" },
  { key: "ictWeeklyWork", label: "ICT 주간업무로드 현황", path: "/weekly-work" },
  { key: "gptTest", label: "GPT 테스트", path: "/gpt-test" },
  { key: "mbtiPage", label: "MBTI", path: "/mbti" },
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
  ictWeeklyWork: true,
  gptTest: true,
  mbtiPage: true,
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
    ictWeeklyWork:
      typeof raw?.ictWeeklyWork === "boolean" ? raw.ictWeeklyWork : DEFAULT_PAGE_PERMISSIONS.ictWeeklyWork,
    gptTest: typeof raw?.gptTest === "boolean" ? raw.gptTest : DEFAULT_PAGE_PERMISSIONS.gptTest,
    mbtiPage: typeof raw?.mbtiPage === "boolean" ? raw.mbtiPage : DEFAULT_PAGE_PERMISSIONS.mbtiPage,
    recentChangesWidget:
      typeof raw?.recentChangesWidget === "boolean"
        ? raw.recentChangesWidget
        : DEFAULT_PAGE_PERMISSIONS.recentChangesWidget,
  }
}

export function resolvePathToPermissionKey(pathname: string): PagePermissionKey | null {
  if (pathname.startsWith("/my-page")) return "myPage"
  if (pathname.startsWith("/work-management/weekly")) return "strategyWeeklyWork"
  if (pathname.startsWith("/work-management")) return "strategyWorkManagement"
  if (pathname.startsWith("/ict-work-management/weekly")) return "ictWeeklyWork"
  if (pathname.startsWith("/fa-work-management/weekly")) return "faWeeklyWork"
  if (pathname.startsWith("/fa-work-management")) return "faWorkManagement"
  if (pathname.startsWith("/gpt-test")) return "gptTest"
  if (pathname.startsWith("/mbti")) return "mbtiPage"
  return null
}

export function isAdminEmail(email?: string | null) {
  return normalizeEmail(email || "") === ADMIN_EMAIL
}
