"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { resolveStaffAuth } from "@/lib/auth"
import { createAuthServerClient } from "@/lib/supabase/auth-server"

const LoginInput = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
  redirectTo: z.string().max(500),
})

export type LoginState = Readonly<{
  error: string | null
}>

function safeRedirectPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || /[\r\n]/.test(value)) {
    return "/dashboard"
  }

  return value === "/login" ? "/dashboard" : value
}

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginInput.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") ?? "/dashboard",
  })

  if (!parsed.success) {
    return { error: "Enter a valid email address and password." }
  }

  let authClient: Awaited<ReturnType<typeof createAuthServerClient>>

  try {
    authClient = await createAuthServerClient()
    const { error } = await authClient.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    })

    if (error) return { error: "Email or password is incorrect." }
  } catch {
    return { error: "Couldn't sign in. Check your connection and try again." }
  }

  const staffAuth = await resolveStaffAuth()
  if (!staffAuth.ok) {
    try {
      await authClient.auth.signOut()
    } catch {
      // The staff check still fails closed even if remote sign-out is unavailable.
    }
    return { error: "This account does not have active staff access." }
  }

  redirect(safeRedirectPath(parsed.data.redirectTo))
}

export async function signOutAction(): Promise<void> {
  const authClient = await createAuthServerClient()
  await authClient.auth.signOut()
  redirect("/login")
}
