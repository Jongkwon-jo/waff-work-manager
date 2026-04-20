"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { useAuth } from "@/components/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
  INTP: "논리사고형",
  ENTJ: "지휘관형",
  ENTP: "변론가형",
  INFJ: "옹호자형",
  INFP: "중재자형",
  ENFJ: "주도자형",
  ENFP: "활동가형",
  ISTJ: "현실주의자형",
  ISFJ: "수호자형",
  ESTJ: "경영자형",
  ESFJ: "친선도모형",
  ISTP: "장인형",
  ISFP: "예술가형",
  ESTP: "활동가형",
  ESFP: "연예인형",
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
      if (profile.mbti) {
        grouped[profile.mbti].push(profile)
      }
    }

    const classifiedCount = profiles.filter((p) => p.mbti).length

    const cards = MBTI_TYPES.map((type) => ({
      type,
      members: grouped[type],
      count: grouped[type].length,
    }))

    cards.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.type.localeCompare(b.type)
    })

    return { cards, classifiedCount }
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
            <p className="text-sm font-medium text-primary">직원 현황</p>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">MBTI 분포</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              직원 {profiles.length}명 중{" "}
              <span className="font-medium text-slate-700">{mbtiCards.classifiedCount}명</span>이 분류되었습니다.
              {isAdmin && (
                <span className="ml-2 text-slate-500">
                  관리자 페이지에서 각 직원의 MBTI를 지정할 수 있습니다.
                </span>
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

        <section className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {mbtiCards.cards.map(({ type, members, count }) => {
            const colors = MBTI_COLORS[type]
            return (
            <Card
              key={type}
              className={`overflow-hidden border bg-gradient-to-br ${colors.card} ${colors.border} shadow-sm transition-all duration-200 ${count === 0 ? "opacity-50" : ""}`}
            >
              <CardHeader className="pb-2 pt-5 px-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-2xl font-bold tracking-tight text-slate-900">
                      {type}
                    </CardTitle>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">({MBTI_LABELS[type]})</p>
                  </div>
                  <Badge className={`border-0 ${colors.badge} text-xs font-semibold px-2 py-0.5 shrink-0`}>
                    {count}명
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {count === 0 ? (
                  <p className="text-xs text-muted-foreground">미분류</p>
                ) : (
                  <ul className="space-y-1">
                    {members.map((profile) => (
                      <li
                        key={profile.email}
                        className="text-sm text-slate-700 font-medium truncate"
                        title={profile.email}
                      >
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
