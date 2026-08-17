import type { ReactNode } from "react"
import { redirect } from "next/navigation"

import { AccessDenied } from "@/components/app/access-denied"
import { AppShell } from "@/components/app/app-shell"
import { resolveStaffAuth } from "@/lib/auth"
import { getClinicConfig } from "@/lib/config"
import { db } from "@/lib/supabase/server"

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

  const [config, inboxResult] = await Promise.all([
    getClinicConfig(),
    db
      .from("unhandled_inbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "UNREAD"),
  ])

  if (inboxResult.error) {
    throw new Error("Unable to load application shell")
  }

  return (
    <AppShell
      automationPaused={config.automation_paused}
      clinicName={config.clinic_name}
      staffEmail={auth.data.staff.email}
      staffName={auth.data.staff.fullName}
      staffRole={auth.data.staff.role}
      unreadCount={inboxResult.count ?? 0}
    >
      {children}
    </AppShell>
  )
}
