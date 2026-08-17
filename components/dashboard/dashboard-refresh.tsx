"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

export function DashboardRefresh() {
  const router = useRouter()
  const connected = useRef(false)

  useEffect(() => {
    const refresh = () => router.refresh()
    const updateStatus = (event: Event) => {
      connected.current = (event as CustomEvent<{ connected: boolean }>).detail.connected
    }

    window.addEventListener("ghostbuster:campaign-change", refresh)
    window.addEventListener("ghostbuster:realtime-status", updateStatus)
    const fallback = window.setInterval(() => {
      if (!connected.current) router.refresh()
    }, 15_000)

    return () => {
      window.removeEventListener("ghostbuster:campaign-change", refresh)
      window.removeEventListener("ghostbuster:realtime-status", updateStatus)
      window.clearInterval(fallback)
    }
  }, [router])

  return null
}
