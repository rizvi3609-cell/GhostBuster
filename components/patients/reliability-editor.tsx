"use client"

import { useState, useTransition } from "react"

import {
  clearPatientReliabilityOverride,
  overridePatientReliability,
} from "@/app/actions/patients"

export function ReliabilityEditor({
  currentScore,
  hasOverride,
  patientId,
}: Readonly<{
  currentScore: number
  hasOverride: boolean
  patientId: string
}>) {
  const [score, setScore] = useState(currentScore)
  const [reason, setReason] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(): void {
    startTransition(async () => {
      const result = await overridePatientReliability({ patientId, score, reason })
      setMessage(result.ok ? "Reliability override saved." : result.error)
      if (result.ok) setReason("")
    })
  }

  function clear(): void {
    startTransition(async () => {
      const result = await clearPatientReliabilityOverride({ patientId })
      setMessage(result.ok ? "Override cleared." : result.error)
    })
  }

  return (
    <div className="mt-5 rounded-lg border border-border bg-surface-sunken p-4">
      <h3 className="font-semibold text-fg">Staff override</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[120px_1fr_auto] sm:items-end">
        <label className="text-xs text-fg-muted">Score
          <input type="number" min={0} max={100} value={score} onChange={(event) => setScore(Number(event.target.value))} className="mt-1 min-h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-fg" />
        </label>
        <label className="text-xs text-fg-muted">Reason
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why staff changed the score" className="mt-1 min-h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-fg" />
        </label>
        <button type="button" disabled={pending || reason.trim().length < 3} onClick={save} className="min-h-10 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50">Save override</button>
      </div>
      {hasOverride ? <button type="button" disabled={pending} onClick={clear} className="mt-3 min-h-10 text-sm font-medium text-danger disabled:opacity-50">Clear existing override</button> : null}
      {message ? <p role="status" className="mt-2 text-sm text-fg-muted">{message}</p> : null}
    </div>
  )
}
