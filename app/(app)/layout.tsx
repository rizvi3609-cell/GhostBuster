import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { z } from "zod"

import { AccessDenied } from "@/components/app/access-denied"
import { AppShell } from "@/components/app/app-shell"
import { resolveStaffAuth } from "@/lib/auth"
import { db } from "@/lib/supabase/server"

const ClinicConfig = z.object({
  clinic_name: z.string().min(1),
  automation_paused: z.boolean(),
})

type AppLayoutProps = Readonly<{
  children: ReactNode
}>

export default async function AppLayout({ children }: AppLayoutProps) {
  const auth = await resolveStaffAuth()

  if (!auth.ok) {
    if (auth.code === "UNAUTHORIZED") redirect("/login")
    if (auth.code === "FORBIDDEN") return <AccessDenied />
    throw new Error("Unable to load staff access")
  }

  const [configResult, inboxResult] = await Promise.all([
    db
      .from("clinic_config")
      .select("clinic_name, automation_paused")
      .eq("id", true)
      .single(),
    db
      .from("unhandled_inbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "UNREAD"),
  ])

  const config = ClinicConfig.safeParse(configResult.data)
  if (configResult.error || !config.success || inboxResult.error) {
    throw new Error("Unable to load application shell")
  }

  return (
    <AppShell
      automationPaused={config.data.automation_paused}
      clinicName={config.data.clinic_name}
      staffEmail={auth.data.staff.email}
      staffName={auth.data.staff.fullName}
      staffRole={auth.data.staff.role}
      unreadCount={inboxResult.count ?? 0}
    >
      {children}
    </AppShell>
  )
}
