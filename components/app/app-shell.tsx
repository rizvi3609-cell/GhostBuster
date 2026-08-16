import type { ReactNode } from "react"

import { signOutAction } from "@/app/actions/auth"
import { KillSwitchBanner } from "@/components/app/kill-switch-banner"
import { NavLinks } from "@/components/app/nav-links"
import type { StaffRole } from "@/lib/auth"

type AppShellProps = Readonly<{
  automationPaused: boolean
  children: ReactNode
  clinicName: string
  staffEmail: string
  staffName: string | null
  staffRole: StaffRole
  unreadCount: number
}>

const roleLabels: Record<StaffRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  FRONT_DESK: "Front desk",
}

function BrandMark() {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M8.2 3.5c1.5 0 2.2.8 3.8.8s2.3-.8 3.8-.8c2.4 0 4.2 2 4.2 4.5 0 2.2-1.2 3.7-1.8 5.7-.8 2.8-1.2 6.8-3.2 6.8-1.4 0-1.4-3.6-3-3.6s-1.6 3.6-3 3.6c-2 0-2.4-4-3.2-6.8C5.2 11.7 4 10.2 4 8c0-2.5 1.8-4.5 4.2-4.5Z" />
      </svg>
    </span>
  )
}

export function AppShell({
  automationPaused,
  children,
  clinicName,
  staffEmail,
  staffName,
  staffRole,
  unreadCount,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-bg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 md:flex lg:w-60 lg:px-4">
        <div className="flex items-center gap-3 px-1">
          <BrandMark />
          <div className="hidden min-w-0 lg:block">
            <p className="truncate font-semibold text-sidebar-foreground">{clinicName}</p>
            <p className="text-xs text-fg-muted">Ghost-Buster</p>
          </div>
        </div>

        <nav aria-label="Primary" className="mt-8">
          <NavLinks unreadCount={unreadCount} placement="sidebar" />
        </nav>

        <div className="mt-auto hidden border-t border-sidebar-border pt-4 lg:block">
          <p className="truncate text-sm font-medium text-fg">{staffName ?? staffEmail}</p>
          <p className="mt-0.5 text-xs text-fg-muted">{roleLabels[staffRole]}</p>
        </div>
      </aside>

      <div className="min-h-screen md:pl-20 lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
          {automationPaused ? <KillSwitchBanner /> : null}
          <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <span className="md:hidden">
                <BrandMark />
              </span>
              <p className="truncate font-semibold text-fg">{clinicName}</p>
            </div>

            <details className="relative">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-2 text-left hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-brand">
                <span className="flex size-8 items-center justify-center rounded-full bg-brand-subtle text-sm font-semibold text-brand">
                  {(staffName ?? staffEmail).slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden sm:block">
                  <span className="block max-w-44 truncate text-sm font-medium text-fg">
                    {staffName ?? staffEmail}
                  </span>
                  <span className="block text-xs text-fg-muted">{roleLabels[staffRole]}</span>
                </span>
              </summary>
              <div className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-surface p-2 shadow-lg">
                <p className="truncate px-2 py-2 text-sm text-fg-muted">{staffEmail}</p>
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="min-h-11 w-full rounded-md px-2 text-left text-sm font-medium text-fg hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:py-8 md:pb-8">
          {children}
        </main>
      </div>

      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface md:hidden"
      >
        <NavLinks unreadCount={unreadCount} placement="bottom" />
      </nav>
    </div>
  )
}
