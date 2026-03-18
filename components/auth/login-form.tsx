"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
} from "firebase/auth"
import { LogIn } from "lucide-react"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

const REMEMBERED_EMAIL_KEY = "workhub.rememberedEmail"
const AUTO_LOGIN_KEY = "workhub.autoLogin"

export function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberEmail, setRememberEmail] = useState(false)
  const [autoLogin, setAutoLogin] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const savedEmail = window.localStorage.getItem(REMEMBERED_EMAIL_KEY)
    const savedAutoLogin = window.localStorage.getItem(AUTO_LOGIN_KEY) === "true"

    if (savedEmail) {
      setEmail(savedEmail)
      setRememberEmail(true)
    }

    setAutoLogin(savedAutoLogin)
  }, [])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedEmail = email.trim()

    if (!trimmedEmail || !password.trim()) {
      toast.error("이메일과 비밀번호를 입력해 주세요.")
      return
    }

    setSubmitting(true)

    try {
      await setPersistence(auth, autoLogin ? browserLocalPersistence : browserSessionPersistence)
      await signInWithEmailAndPassword(auth, trimmedEmail, password)

      if (rememberEmail) {
        window.localStorage.setItem(REMEMBERED_EMAIL_KEY, trimmedEmail)
      } else {
        window.localStorage.removeItem(REMEMBERED_EMAIL_KEY)
      }

      window.localStorage.setItem(AUTO_LOGIN_KEY, String(autoLogin))
      toast.success("로그인되었습니다.")
    } catch (error: any) {
      const code = typeof error?.code === "string" ? error.code : ""

      if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") {
        alert("이메일 또는 비밀번호가 올바르지 않습니다.")
      } else {
        alert("로그인 처리 중 오류가 발생했습니다.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_38%),linear-gradient(180deg,_hsl(var(--background))_0%,_hsl(var(--muted)/0.35)_100%)] px-4 py-12">
      <Card className="w-full max-w-md border-border/70 bg-card/95 shadow-xl backdrop-blur">
        <CardHeader>
          <div className="flex justify-center">
            <Image
              src="/placeholder-logo.png"
              alt="WorkHub 로고"
              width={220}
              height={64}
              className="h-16 w-auto object-contain"
              priority
            />
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">아이디</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@company.com"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                placeholder="비밀번호 입력"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={rememberEmail}
                  onCheckedChange={(checked) => setRememberEmail(checked === true)}
                  disabled={submitting}
                />
                아이디 기억하기
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={autoLogin}
                  onCheckedChange={(checked) => setAutoLogin(checked === true)}
                  disabled={submitting}
                />
                자동 로그인
              </label>
            </div>
            <Button type="submit" className="w-full gap-2" disabled={submitting}>
              <LogIn className="h-4 w-4" />
              {submitting ? "처리 중..." : "로그인"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
