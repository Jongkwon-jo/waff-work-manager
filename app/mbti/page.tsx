"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { useAuth } from "@/components/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { MBTI_TYPES, subscribeUserProfiles, type MbtiType, type UserProfile } from "@/lib/firestore-service"

const MBTI_COLORS: Record<MbtiType, { card: string; border: string; badge: string }> = {
  INTJ: { card: "from-violet-50 to-purple-50/60", border: "border-violet-200/60", badge: "bg-violet-100 text-violet-700" },
  INTP: { card: "from-violet-50 to-purple-50/60", border: "border-violet-200/60", badge: "bg-violet-100 text-violet-700" },
  ENTJ: { card: "from-violet-50 to-purple-50/60", border: "border-violet-200/60", badge: "bg-violet-100 text-violet-700" },
  ENTP: { card: "from-violet-50 to-purple-50/60", border: "border-violet-200/60", badge: "bg-violet-100 text-violet-700" },
  INFJ: { card: "from-emerald-50 to-green-50/60", border: "border-emerald-200/60", badge: "bg-emerald-100 text-emerald-700" },
  INFP: { card: "from-emerald-50 to-green-50/60", border: "border-emerald-200/60", badge: "bg-emerald-100 text-emerald-700" },
  ENFJ: { card: "from-emerald-50 to-green-50/60", border: "border-emerald-200/60", badge: "bg-emerald-100 text-emerald-700" },
  ENFP: { card: "from-emerald-50 to-green-50/60", border: "border-emerald-200/60", badge: "bg-emerald-100 text-emerald-700" },
  ISTJ: { card: "from-sky-50 to-blue-50/60", border: "border-sky-200/60", badge: "bg-sky-100 text-sky-700" },
  ISFJ: { card: "from-sky-50 to-blue-50/60", border: "border-sky-200/60", badge: "bg-sky-100 text-sky-700" },
  ESTJ: { card: "from-sky-50 to-blue-50/60", border: "border-sky-200/60", badge: "bg-sky-100 text-sky-700" },
  ESFJ: { card: "from-sky-50 to-blue-50/60", border: "border-sky-200/60", badge: "bg-sky-100 text-sky-700" },
  ISTP: { card: "from-amber-50 to-orange-50/60", border: "border-amber-200/60", badge: "bg-amber-100 text-amber-700" },
  ISFP: { card: "from-amber-50 to-orange-50/60", border: "border-amber-200/60", badge: "bg-amber-100 text-amber-700" },
  ESTP: { card: "from-amber-50 to-orange-50/60", border: "border-amber-200/60", badge: "bg-amber-100 text-amber-700" },
  ESFP: { card: "from-amber-50 to-orange-50/60", border: "border-amber-200/60", badge: "bg-amber-100 text-amber-700" },
}

const MBTI_LABELS: Record<MbtiType, string> = {
  INTJ: "전략가형",
  INTP: "논리 사색형",
  ENTJ: "지휘관형",
  ENTP: "발명가형",
  INFJ: "옹호자형",
  INFP: "중재자형",
  ENFJ: "선도자형",
  ENFP: "활동가형",
  ISTJ: "현실주의형",
  ISFJ: "수호자형",
  ESTJ: "경영자형",
  ESFJ: "친선도모형",
  ISTP: "장인형",
  ISFP: "예술가형",
  ESTP: "사업가형",
  ESFP: "연예인형",
}

const TEAM_STYLE_BY_MBTI: Record<MbtiType, string> = {
  INTJ: "전략 중심의 설계형",
  INTP: "분석 중심의 탐구형",
  ENTJ: "목표 주도 실행형",
  ENTP: "아이디어 확장형",
  INFJ: "의미 지향 조율형",
  INFP: "가치 중심 공감형",
  ENFJ: "관계 중심 리드형",
  ENFP: "변화 촉진 창의형",
  ISTJ: "체계 운영 안정형",
  ISFJ: "협업 지원 안정형",
  ESTJ: "성과 관리 추진형",
  ESFJ: "팀 케어 조정형",
  ISTP: "문제 해결 실무형",
  ISFP: "유연 대응 실천형",
  ESTP: "현장 대응 돌파형",
  ESFP: "에너지 확산 실행형",
}

function getDisplayName(profile: UserProfile): string {
  return profile.taskAliases?.[0] || profile.email
}

export default function MbtiPage() {
  const { isAdmin } = useAuth()
  const [profiles, setProfiles] = useState<UserProfile[]>([])

  useEffect(() => {
    const unsubscribe = subscribeUserProfiles(setProfiles)
    return () => unsubscribe()
  }, [])

  const mbtiCards = useMemo(() => {
    const grouped = Object.fromEntries(
      MBTI_TYPES.map((type) => [type, [] as UserProfile[]]),
    ) as Record<MbtiType, UserProfile[]>

    for (const profile of profiles) {
      if (profile.mbti) grouped[profile.mbti].push(profile)
    }

    const classifiedCount = profiles.filter((p) => p.mbti).length
    const cards = MBTI_TYPES.map((type) => ({ type, members: grouped[type], count: grouped[type].length }))
    cards.sort((a, b) => (b.count !== a.count ? b.count - a.count : a.type.localeCompare(b.type)))
    return { cards, classifiedCount }
  }, [profiles])

  const departmentMbti = useMemo(() => {
    type DepartmentStats = {
      department: string
      total: number
      members: Array<{ name: string; mbti: MbtiType }>
      distributions: Array<{ type: MbtiType; count: number }>
      teamStyle: string
    }

    const grouped = new Map<string, Array<{ name: string; mbti: MbtiType }>>()

    for (const profile of profiles) {
      if (!profile.mbti) continue
      const department = profile.department || "미지정"
      if (!grouped.has(department)) grouped.set(department, [])
      grouped.get(department)!.push({ name: getDisplayName(profile), mbti: profile.mbti })
    }

    const rows: DepartmentStats[] = []
    for (const [department, members] of grouped.entries()) {
      members.sort((a, b) => a.name.localeCompare(b.name, "ko"))
      const counts = members.reduce(
        (acc, member) => {
          acc[member.mbti] += 1
          return acc
        },
        Object.fromEntries(MBTI_TYPES.map((type) => [type, 0])) as Record<MbtiType, number>,
      )

      const distributions = MBTI_TYPES.map((type) => ({ type, count: counts[type] }))
        .filter((row) => row.count > 0)
        .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.type.localeCompare(b.type)))

      const teamStyle =
        distributions.length === 0
          ? "분석 가능한 MBTI 데이터가 없습니다."
          : distributions.length === 1
            ? `${TEAM_STYLE_BY_MBTI[distributions[0].type]} 성향이 뚜렷한 팀`
            : `${TEAM_STYLE_BY_MBTI[distributions[0].type]} + ${TEAM_STYLE_BY_MBTI[distributions[1].type]} 조합의 팀`

      rows.push({ department, total: members.length, members, distributions, teamStyle })
    }

    rows.sort((a, b) => (b.total !== a.total ? b.total - a.total : a.department.localeCompare(b.department)))
    return rows
  }, [profiles])

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(14,165,233,0.10),transparent),linear-gradient(180deg,#f0f6ff_0%,#f5f7fb_40%,#ffffff_100%)] px-4 py-10 lg:px-10">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.025]"
        style={{
          backgroundImage: "radial-gradient(circle, #64748b 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative mx-auto max-w-6xl space-y-8">
        <header className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/90 p-7 shadow-[0_8px_40px_rgba(15,23,42,0.07)] backdrop-blur-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">WorkHub</p>
            <p className="text-sm font-medium text-primary">직원 성향 분석</p>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">MBTI 분포</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              직원 {profiles.length}명 중 <span className="font-medium text-slate-700">{mbtiCards.classifiedCount}명</span>이 분류되었습니다.
              {isAdmin && (
                <span className="ml-2 text-slate-500">관리자 페이지에서 각 직원의 MBTI를 지정할 수 있습니다.</span>
              )}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              메인으로 돌아가기
            </Link>
          </Button>
        </header>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">부서별 MBTI 구성</h2>
            <p className="text-xs text-muted-foreground">MBTI 배지에 마우스를 올리면 인원 확인</p>
          </div>
          {departmentMbti.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-6 text-sm text-muted-foreground">부서별 MBTI 데이터가 없습니다.</CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {departmentMbti.map((item) => (
                <Card key={item.department} className="border-slate-200/70 bg-white/85">
                  <CardHeader className="space-y-2 pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">{item.department}</CardTitle>
                      <Badge variant="secondary">{item.total}명</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{item.teamStyle}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {item.distributions.map((row) => (
                        <HoverCard key={`${item.department}-${row.type}`}>
                          <HoverCardTrigger asChild>
                            <Badge className={`cursor-default border-0 text-[11px] ${MBTI_COLORS[row.type].badge}`}>
                              {row.type} {row.count}명
                            </Badge>
                          </HoverCardTrigger>
                          <HoverCardContent align="start" className="w-auto max-w-[320px] p-3">
                            <p className="mb-2 text-xs font-semibold text-slate-700">{row.type}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {item.members
                                .filter((member) => member.mbti === row.type)
                                .map((member) => (
                                  <Badge
                                    key={`${item.department}-${row.type}-${member.name}`}
                                    className={`border-0 text-[11px] ${MBTI_COLORS[member.mbti].badge}`}
                                  >
                                    {member.name}
                                  </Badge>
                                ))}
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {mbtiCards.cards.map(({ type, members, count }) => {
            const colors = MBTI_COLORS[type]
            return (
              <Card
                key={type}
                className={`overflow-hidden border bg-gradient-to-br ${colors.card} ${colors.border} shadow-sm transition-all duration-200 ${count === 0 ? "opacity-50" : ""}`}
              >
                <CardHeader className="px-5 pb-2 pt-5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-2xl font-bold tracking-tight text-slate-900">{type}</CardTitle>
                      <p className="mt-0.5 text-xs font-medium text-slate-500">({MBTI_LABELS[type]})</p>
                    </div>
                    <Badge className={`shrink-0 border-0 px-2 py-0.5 text-xs font-semibold ${colors.badge}`}>{count}명</Badge>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {count === 0 ? (
                    <p className="text-xs text-muted-foreground">미분류</p>
                  ) : (
                    <ul className="space-y-1">
                      {members.map((profile) => (
                        <li key={profile.email} className="truncate text-sm font-medium text-slate-700" title={profile.email}>
                          {getDisplayName(profile)}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </section>
      </div>
    </main>
  )
}
