"use client"

import Image from "next/image"
import Link from "next/link"
import { signOut } from "firebase/auth"
import {
  ArrowRight,
  Brain,
  BriefcaseBusiness,
  CalendarDays,
  Cpu,
  LogOut,
  ShieldCheck,
  Sparkles,
  UserRoundSearch,
} from "lucide-react"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/components/auth/auth-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export default function HomePage() {
  const { user, isAdmin, pagePermissions } = useAuth()

  const handleLogout = async () => {
    try {
      await signOut(auth)
      toast.success("로그아웃되었습니다.")
    } catch {
      toast.error("로그아웃에 실패했습니다.")
    }
  }

  const cards = [
    {
      href: "/my-page",
      title: "마이 페이지",
      description: "내 업무를 모아서 빠르게 확인합니다.",
      icon: UserRoundSearch,
      visible: isAdmin || pagePermissions.myPage,
      tone: "from-rose-50 via-pink-50/60 to-white",
      iconColor: "text-rose-500",
      iconBg: "bg-white/60",
    },
    {
      href: "/work-management",
      title: "전략기획사업부 업무관리",
      description: "전략기획사업부 프로젝트와 업무를 관리합니다.",
      icon: BriefcaseBusiness,
      visible: isAdmin || pagePermissions.strategyWorkManagement,
      tone: "from-amber-50 via-orange-50/60 to-white",
      iconColor: "text-amber-500",
      iconBg: "bg-white/60",
    },
    {
      href: "/work-management/weekly",
      title: "전략기획사업부 주간업무",
      description: "전략기획사업부의 이번 주 업무를 팀과 담당자 기준으로 확인합니다.",
      icon: CalendarDays,
      visible: isAdmin || pagePermissions.strategyWeeklyWork,
      tone: "from-amber-50 via-orange-50/60 to-white",
      iconColor: "text-amber-500",
      iconBg: "bg-white/60",
    },
    {
      href: "/fa-work-management",
      title: "FA사업부 업무관리",
      description: "FA사업부 프로젝트와 업무를 관리합니다.",
      icon: Cpu,
      visible: isAdmin || pagePermissions.faWorkManagement,
      tone: "from-violet-50 via-indigo-50/60 to-white",
      iconColor: "text-violet-500",
      iconBg: "bg-white/60",
    },
    {
      href: "/fa-work-management/weekly",
      title: "FA사업부 주간업무",
      description: "FA사업부의 이번 주 업무를 팀과 담당자 기준으로 확인합니다.",
      icon: CalendarDays,
      visible: isAdmin || pagePermissions.faWeeklyWork,
      tone: "from-violet-50 via-indigo-50/60 to-white",
      iconColor: "text-violet-500",
      iconBg: "bg-white/60",
    },
    {
      href: "/gpt-test",
      title: "GPT 테스트",
      description: "벡터 스토어와 채팅 기록 기반으로 문서 질의를 테스트합니다.",
      icon: Sparkles,
      visible: isAdmin || pagePermissions.gptTest,
      tone: "from-sky-50 via-cyan-50/60 to-white",
      iconColor: "text-sky-500",
      iconBg: "bg-white/60",
    },
    {
      href: "/mbti",
      title: "MBTI 분포",
      description: "직원들의 MBTI 유형별 분포를 확인합니다.",
      icon: Brain,
      visible: isAdmin || pagePermissions.mbtiPage,
      tone: "from-fuchsia-50 via-purple-50/60 to-white",
      iconColor: "text-fuchsia-500",
      iconBg: "bg-white/60",
    },
    {
      href: "/admin",
      title: "관리자",
      description: "사용자 권한과 부서/담당자 설정을 관리합니다.",
      icon: ShieldCheck,
      visible: isAdmin,
      tone: "from-emerald-50 via-green-50/60 to-white",
      iconColor: "text-emerald-500",
      iconBg: "bg-white/60",
    },
  ].filter((card) => card.visible)

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
        <header className="flex flex-col gap-5 rounded-3xl border border-slate-200/70 bg-white/90 p-7 shadow-[0_8px_40px_rgba(15,23,42,0.07)] backdrop-blur-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
              <Image
                src="/placeholder-logo.png"
                alt="WorkHub 로고"
                width={36}
                height={36}
                className="h-8 w-auto object-contain"
                priority
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">WorkHub</h1>
              <p className="mt-0.5 text-sm text-slate-500">사용 가능한 기능을 선택해서 바로 이동할 수 있습니다.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 lg:justify-end">
            <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600">
              {user?.email || "로그인 사용자"}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="gap-1.5 text-slate-600 hover:text-slate-900"
            >
              <LogOut className="h-3.5 w-3.5" />
              로그아웃
            </Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon

            return (
              <Link key={card.href} href={card.href} className="group block">
                <Card
                  className={`
                    h-full overflow-hidden border-slate-200/60 bg-gradient-to-br ${card.tone}
                    shadow-sm transition-all duration-200
                    group-hover:-translate-y-1 group-hover:shadow-[0_16px_48px_rgba(15,23,42,0.11)]
                    group-hover:border-slate-300/60
                  `}
                >
                  <CardHeader className="space-y-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className={`
                          flex h-11 w-11 items-center justify-center rounded-xl
                          ${card.iconBg} ${card.iconColor}
                          ring-1 ring-black/5 shadow-sm
                          transition-transform duration-200 group-hover:scale-110
                        `}
                      >
                        <Icon className="h-5 w-5" />
                      </div>

                      <div className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors duration-150 group-hover:border-slate-300 group-hover:text-slate-700">
                        페이지 열기
                        <ArrowRight className="h-3 w-3 transition-transform duration-150 group-hover:translate-x-0.5" />
                      </div>
                    </div>

                    <div>
                      <CardTitle className="text-xl font-semibold tracking-tight text-slate-900">{card.title}</CardTitle>
                      <CardDescription className="mt-1.5 text-sm leading-relaxed text-slate-500">
                        {card.description}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent />
                </Card>
              </Link>
            )
          })}
        </section>
      </div>
    </main>
  )
}
