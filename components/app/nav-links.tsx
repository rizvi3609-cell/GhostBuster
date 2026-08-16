"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/patients", label: "Patients", icon: "patients" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const

type IconName = (typeof navigation)[number]["icon"]

function NavIcon({ name }: Readonly<{ name: IconName }>) {
  const path = {
    dashboard: "M4 4h6v6H4V4Zm10 0h6v10h-6V4ZM4 14h6v6H4v-6Zm10 4h6v2h-6v-2Z",
    inbox: "M4 5h16v13H4V5Zm0 9h4l2 2h4l2-2h4",
    patients: "M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87m-2-12a4 4 0 0 1 0 7.75",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-12 1 2.1 2.3.5 1.7-1.6 2.5 2.5-1.6 1.7.5 2.3 2.1 1-2.1 1-.5 2.3 1.6 1.7-2.5 2.5-1.7-1.6-2.3.5-1 2.1-1-2.1-2.3-.5-1.7 1.6-2.5-2.5 1.6-1.7-.5-2.3-2.1-1 2.1-1 .5-2.3-1.6-1.7L7 4.5l1.7 1.6 2.3-.5 1-2.1Z",
  }[name]

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  )
}

type NavLinksProps = Readonly<{
  unreadCount: number
  placement: "sidebar" | "bottom"
}>

export function NavLinks({ unreadCount, placement }: NavLinksProps) {
  const pathname = usePathname()
  const isBottom = placement === "bottom"

  return (
    <ul className={isBottom ? "grid grid-cols-4" : "space-y-1"}>
      {navigation.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        const showBadge = item.href === "/inbox" && unreadCount > 0

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                isBottom
                  ? `flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-xs font-medium ${
                      active ? "text-brand" : "text-fg-muted hover:text-fg"
                    }`
                  : `flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                      active
                        ? "bg-brand-subtle text-brand"
                        : "text-fg-muted hover:bg-surface-sunken hover:text-fg"
                    }`
              }
            >
              <span className="relative">
                <NavIcon name={item.icon} />
                {showBadge && isBottom ? (
                  <span className="absolute -right-2 -top-2 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </span>
              <span className={isBottom ? "block" : "hidden lg:block"}>{item.label}</span>
              {showBadge && !isBottom ? (
                <span className="ml-auto hidden min-w-6 rounded-full bg-danger px-1.5 text-center text-xs leading-6 text-white lg:block">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
