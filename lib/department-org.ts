export type OrgDepartmentGroup = "ICT" | "FA" | "전략기획" | "기타"

export type DepartmentOrgMember = {
  name: string
  title?: string
  active?: boolean
}

export type DepartmentOrgTeam = {
  name: string
  members: DepartmentOrgMember[]
}

export type DepartmentOrg = {
  group: OrgDepartmentGroup
  label: string
  leader?: DepartmentOrgMember
  advisors?: DepartmentOrgMember[]
  teams: DepartmentOrgTeam[]
}

export const UNCLASSIFIED_TEAM_NAME = "미분류"

export const DEPARTMENT_ORG_CHART: Record<OrgDepartmentGroup, DepartmentOrg> = {
  전략기획: {
    group: "전략기획",
    label: "전략사업부",
    leader: { name: "신기루", title: "부장" },
    teams: [
      {
        name: "1팀",
        members: [
          { name: "홍장표", title: "과장" },
          { name: "진종헌", title: "대리" },
        ],
      },
    ],
  },
  FA: {
    group: "FA",
    label: "FA사업부",
    leader: { name: "홍회철", title: "이사" },
    teams: [
      {
        name: "1팀",
        members: [
          { name: "김용환", title: "팀장" },
          { name: "장보성", title: "주임" },
          { name: "조종민" },
        ],
      },
      {
        name: "2팀",
        members: [{ name: "황현", title: "팀장" }, { name: "이승주" }, { name: "김동현" }],
      },
    ],
  },
  ICT: {
    group: "ICT",
    label: "ICT사업부",
    leader: { name: "김영락", title: "이사" },
    advisors: [{ name: "온부일", title: "이사" }],
    teams: [
      {
        name: "SW 개발 1팀",
        members: [
          { name: "이상식", title: "팀장" },
          { name: "박지완" },
          { name: "최강일" },
        ],
      },
      {
        name: "SW 개발 2팀",
        members: [
          { name: "조종권", title: "팀장" },
          { name: "배승우" },
          { name: "김성민" },
        ],
      },
    ],
  },
  기타: {
    group: "기타",
    label: "기타",
    teams: [],
  },
}

export const formatOrgMember = (member: DepartmentOrgMember) =>
  member.title ? `${member.name} ${member.title}` : member.name

export function isActiveDepartmentOrgMember(member?: DepartmentOrgMember): boolean {
  return member?.active !== false
}

function getDepartmentOrgMembersFromOrg(org: DepartmentOrg): DepartmentOrgMember[] {
  return [
    org.leader,
    ...(org.advisors || []),
    ...org.teams.flatMap((team) => team.members),
  ].filter((member): member is DepartmentOrgMember => Boolean(member?.name?.trim()))
}

export function getDepartmentOrgPersonNames(group: OrgDepartmentGroup): string[] {
  const org = DEPARTMENT_ORG_CHART[group]
  const names = getDepartmentOrgMembersFromOrg(org).map((member) => member.name)

  return Array.from(new Set(names))
}

export const DEFAULT_ORG_DEPARTMENT_PERSON_SETTINGS: Record<OrgDepartmentGroup, string[]> = {
  ICT: getDepartmentOrgPersonNames("ICT"),
  FA: getDepartmentOrgPersonNames("FA"),
  전략기획: getDepartmentOrgPersonNames("전략기획"),
  기타: [],
}

export function cloneDepartmentOrgChart(): Record<OrgDepartmentGroup, DepartmentOrg> {
  return Object.fromEntries(
    Object.entries(DEPARTMENT_ORG_CHART).map(([group, org]) => [
      group,
      {
        ...org,
        leader: org.leader ? { ...org.leader } : undefined,
        advisors: org.advisors?.map((member) => ({ ...member })) || [],
        teams: org.teams.map((team) => ({
          ...team,
          members: team.members.map((member) => ({ ...member })),
        })),
      },
    ]),
  ) as Record<OrgDepartmentGroup, DepartmentOrg>
}

export function getDepartmentOrgPersonNamesFromOrg(
  org: DepartmentOrg,
  options: { activeOnly?: boolean } = {},
): string[] {
  const names = getDepartmentOrgMembersFromOrg(org)
    .filter((member) => !options.activeOnly || isActiveDepartmentOrgMember(member))
    .map((member) => member.name)

  return Array.from(new Set(names.map((name) => name.trim())))
}

export function getActiveDepartmentOrgPersonNamesFromOrg(org: DepartmentOrg): string[] {
  return getDepartmentOrgPersonNamesFromOrg(org, { activeOnly: true })
}

export function getInactiveDepartmentOrgPersonNamesFromOrg(org: DepartmentOrg): string[] {
  const names = getDepartmentOrgMembersFromOrg(org)
    .filter((member) => !isActiveDepartmentOrgMember(member))
    .map((member) => member.name)

  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))
}

export function getInactiveDepartmentOrgPersonNamesFromSettings(
  orgChart: Record<OrgDepartmentGroup, DepartmentOrg>,
): string[] {
  return Array.from(
    new Set(
      (Object.values(orgChart) as DepartmentOrg[])
        .flatMap((org) => getInactiveDepartmentOrgPersonNamesFromOrg(org))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  )
}

function normalizeOrgName(value: string): string {
  return value.trim().toLowerCase()
}

function aliasesMatchOrgName(name: string | undefined, aliases: string[]): boolean {
  const normalizedName = normalizeOrgName(name || "")
  if (!normalizedName) return false
  return aliases.some((rawAlias) => {
    const alias = normalizeOrgName(rawAlias)
    if (!alias) return false
    return normalizedName === alias || normalizedName.includes(alias) || alias.includes(normalizedName)
  })
}

function getProfileOrgAliases(profile: { email?: string; taskAliases?: string[] }): string[] {
  const email = (profile.email || "").trim()
  return Array.from(
    new Set(
      [
        ...(profile.taskAliases || []),
        email,
        email.includes("@") ? email.split("@")[0] : "",
      ]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  )
}

function getOrgActiveMatchStatus(
  aliases: string[],
  orgChart: Record<OrgDepartmentGroup, DepartmentOrg>,
): { hasActiveMatch: boolean; hasInactiveMatch: boolean } {
  let hasActiveMatch = false
  let hasInactiveMatch = false

  ;(Object.values(orgChart) as DepartmentOrg[]).forEach((org) => {
    getDepartmentOrgMembersFromOrg(org).forEach((member) => {
      if (!aliasesMatchOrgName(member.name, aliases)) return
      if (isActiveDepartmentOrgMember(member)) hasActiveMatch = true
      else hasInactiveMatch = true
    })
  })

  return { hasActiveMatch, hasInactiveMatch }
}

export function isActiveDepartmentOrgPersonName(
  person: string,
  orgChart: Record<OrgDepartmentGroup, DepartmentOrg>,
): boolean {
  const aliases = [person.trim()].filter(Boolean)
  if (aliases.length === 0) return true
  const { hasActiveMatch, hasInactiveMatch } = getOrgActiveMatchStatus(aliases, orgChart)
  if (hasActiveMatch) return true
  if (hasInactiveMatch) return false
  return true
}

export function isUserProfileActiveForOrg(
  profile: { email?: string; taskAliases?: string[] },
  orgChart: Record<OrgDepartmentGroup, DepartmentOrg>,
): boolean {
  const aliases = getProfileOrgAliases(profile)
  if (aliases.length === 0) return true
  const { hasActiveMatch, hasInactiveMatch } = getOrgActiveMatchStatus(aliases, orgChart)
  if (hasActiveMatch) return true
  if (hasInactiveMatch) return false
  return true
}

/**
 * Persons whose tasks the given user should see by default on the weekly board.
 * - Department leader (org.leader) → every named person in that department
 * - Team lead (member with title "팀장") → all members of that team
 * - Anyone else → an empty set (caller falls back to the user's own aliases)
 */
export function getTeamScopePersonsForAliases(
  aliases: string[],
  orgChart: Record<OrgDepartmentGroup, DepartmentOrg>,
): string[] {
  const cleanedAliases = aliases.map((value) => value.trim()).filter(Boolean)
  if (cleanedAliases.length === 0) return []

  const persons = new Set<string>()

  ;(Object.values(orgChart) as DepartmentOrg[]).forEach((org) => {
    if (isActiveDepartmentOrgMember(org.leader) && aliasesMatchOrgName(org.leader?.name, cleanedAliases)) {
      getActiveDepartmentOrgPersonNamesFromOrg(org).forEach((name) => persons.add(name))
      return
    }
    org.teams.forEach((team) => {
      const isTeamLead = team.members.some(
        (member) =>
          isActiveDepartmentOrgMember(member) &&
          member.title === "팀장" &&
          aliasesMatchOrgName(member.name, cleanedAliases),
      )
      if (isTeamLead) {
        team.members.forEach((member) => {
          if (isActiveDepartmentOrgMember(member) && member.name?.trim()) persons.add(member.name.trim())
        })
      }
    })
  })

  return Array.from(persons)
}

export function getOrgTeamForPerson(
  person: string,
  preferredGroup?: OrgDepartmentGroup,
  orgChart: Record<OrgDepartmentGroup, DepartmentOrg> = DEPARTMENT_ORG_CHART,
): { departmentGroup?: OrgDepartmentGroup; teamName: string; order: number } {
  const normalized = person.trim()
  if (!normalized) return { teamName: UNCLASSIFIED_TEAM_NAME, order: 999 }

  const groups = preferredGroup
    ? [preferredGroup, ...Object.keys(orgChart).filter((group) => group !== preferredGroup)]
    : Object.keys(orgChart)

  for (const group of groups as OrgDepartmentGroup[]) {
    const org = orgChart[group]
    if (org.leader?.name === normalized) {
      return { departmentGroup: group, teamName: "부서장", order: 0 }
    }
    if ((org.advisors || []).some((member) => member.name === normalized)) {
      return { departmentGroup: group, teamName: "고문", order: 1 }
    }
    const teamIndex = org.teams.findIndex((team) => team.members.some((member) => member.name === normalized))
    if (teamIndex >= 0) {
      return { departmentGroup: group, teamName: org.teams[teamIndex].name, order: teamIndex + 2 }
    }
  }

  return { departmentGroup: preferredGroup, teamName: UNCLASSIFIED_TEAM_NAME, order: 999 }
}
