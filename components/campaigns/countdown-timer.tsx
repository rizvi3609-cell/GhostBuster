"use client"

import { useEffect, useState } from "react"

function formatRemaining(milliseconds: number): string {
  if (milliseconds <= 0) return "due now"
  const totalSeconds = Math.ceil(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`
}

export function CountdownTimer({ target }: Readonly<{ target: string | null }>) {
  const [remaining, setRemaining] = useState(() =>
    target && target !== "infinity" ? new Date(target).getTime() - Date.now() : null,
  )

  useEffect(() => {
    if (!target || target === "infinity") return
    const update = () => setRemaining(new Date(target).getTime() - Date.now())
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [target])

  if (target === "infinity") return <span>preparing wave</span>
  if (remaining === null) return <span>not scheduled</span>
  return <span className="tabular-nums">{formatRemaining(remaining)}</span>
}
