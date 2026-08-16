import "server-only"

import { z } from "zod"

import { createAuthServerClient } from "./supabase/auth-server"
import { db } from "./supabase/server"

const StaffRecord = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string().nullable(),
  role: z.enum(["OWNER", "ADMIN", "FRONT_DESK"]),
  active: z.literal(true),
})

export type StaffRole = z.infer<typeof StaffRecord>["role"]

export type StaffAuthContext = Readonly<{
  userId: string
  staff: Readonly<{
    id: string
    email: string
    fullName: string | null
    role: StaffRole
  }>
}>

export type AuthFailure = Readonly<{
  ok: false
  error: string
  code: "UNAUTHORIZED" | "FORBIDDEN" | "INTERNAL_ERROR"
}>

export type StaffAuthResult =
  | { ok: true; data: StaffAuthContext }
  | AuthFailure

export type StaffAuthOptions = Readonly<{
  allowedRoles?: readonly StaffRole[]
}>

const unauthorized = (): AuthFailure => ({
  ok: false,
  error: "You must sign in to continue.",
  code: "UNAUTHORIZED",
})

const forbidden = (): AuthFailure => ({
  ok: false,
  error: "Your staff account does not have access.",
  code: "FORBIDDEN",
})

const internalError = (): AuthFailure => ({
  ok: false,
  error: "Unable to verify staff access.",
  code: "INTERNAL_ERROR",
})

export async function resolveStaffAuth(
  options: StaffAuthOptions = {},
): Promise<StaffAuthResult> {
  let userId: string

  try {
    const authClient = await createAuthServerClient()
    const { data, error } = await authClient.auth.getUser()

    if (error || !data.user) return unauthorized()
    userId = data.user.id
  } catch {
    return unauthorized()
  }

  try {
    const { data, error } = await db
      .from("staff")
      .select("id, email, full_name, role, active")
      .eq("id", userId)
      .eq("active", true)
      .maybeSingle()

    if (error) return internalError()

    const parsed = StaffRecord.safeParse(data)
    if (!parsed.success) return forbidden()

    const allowedRoles = options.allowedRoles ?? StaffRecord.shape.role.options
    if (!allowedRoles.includes(parsed.data.role)) return forbidden()

    return {
      ok: true,
      data: {
        userId,
        staff: {
          id: parsed.data.id,
          email: parsed.data.email,
          fullName: parsed.data.full_name,
          role: parsed.data.role,
        },
      },
    }
  } catch {
    return internalError()
  }
}

export function withStaffAuth<Arguments extends unknown[], Result>(
  handler: (
    context: StaffAuthContext,
    ...args: Arguments
  ) => Promise<Result>,
  options: StaffAuthOptions = {},
): (...args: Arguments) => Promise<Result | AuthFailure> {
  return async (...args: Arguments): Promise<Result | AuthFailure> => {
    const auth = await resolveStaffAuth(options)
    if (!auth.ok) return auth

    try {
      return await handler(auth.data, ...args)
    } catch {
      return internalError()
    }
  }
}
