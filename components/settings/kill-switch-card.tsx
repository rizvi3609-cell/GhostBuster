"use client"

import { useState, useTransition } from "react"

import { toggleAutomation } from "@/app/actions/settings"

type KillSwitchCardProps = Readonly<{
  enabledBy: string | null
  enabledAt: string | null
  paused: boolean
}>

export function KillSwitchCard({ enabledAt, enabledBy, paused }: KillSwitchCardProps) {
  const [confirmation, setConfirmation] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const nextPaused = !paused
  const required = nextPaused ? "PAUSE" : "RESUME"

  function toggle(): void {
    startTransition(async () => {
      const result = await toggleAutomation({ paused: nextPaused, confirmation })
      setMessage(result.ok ? "Automation state updated." : result.error)
      if (result.ok) setConfirmation("")
    })
  }

  return (
    <section className="rounded-xl border-2 border-danger/40 bg-danger/5 p-5">
      <p className="text-sm font-semibold uppercase tracking-wide text-danger">Danger zone</p>
      <h2 className="mt-2 text-lg font-semibold text-fg">Pause all outgoing messages</h2>
      <p className="mt-2 text-base text-fg-muted">
        Automation is currently <strong className={paused ? "text-danger" : "text-success"}>{paused ? "paused" : "running"}</strong>.
      </p>
      {paused && enabledAt ? (
        <p className="mt-1 text-sm text-fg-muted">
          Enabled {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(enabledAt))}
          {enabledBy ? ` by ${enabledBy}` : ""}.
        </p>
      ) : null}
      <p className="mt-4 text-sm text-fg-muted">
        Type <strong>{required}</strong> to {nextPaused ? "stop all automated and manual outbound messages" : "allow outbound messages again"}.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <label htmlFor="kill-confirmation" className="sr-only">Type {required}</label>
        <input
          id="kill-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value.toUpperCase())}
          className="min-h-11 rounded-lg border border-danger/40 bg-surface px-3 font-mono text-fg"
        />
        <button
          type="button"
          disabled={pending || confirmation !== required}
          onClick={toggle}
          className="min-h-11 rounded-lg bg-danger px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Updating…" : nextPaused ? "Pause outgoing messages" : "Resume outgoing messages"}
        </button>
      </div>
      {message ? <p role="status" className="mt-3 text-sm text-fg-muted">{message}</p> : null}
    </section>
  )
}
