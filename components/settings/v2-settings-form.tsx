"use client"

import { useState, useTransition } from "react"

import { saveV2Settings } from "@/app/actions/settings"
import type { ClinicConfig } from "@/lib/config"

export function V2SettingsForm({ config }: Readonly<{ config: ClinicConfig }>) {
  const [depositAmount, setDepositAmount] = useState(config.deposit_amount)
  const [reviewUrl, setReviewUrl] = useState(config.review_url)
  const [reviewCooldown, setReviewCooldown] = useState(config.review_cooldown_days)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(): void {
    startTransition(async () => {
      const result = await saveV2Settings({
        depositAmount,
        reviewUrl,
        reviewCooldownDays: reviewCooldown,
      })
      setMessage(result.ok ? "V2 settings saved." : result.error)
    })
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-fg">V2 automation</h2>
        <p className="mt-1 text-sm text-fg-muted">These values apply only when the corresponding feature flag and deployment flag are enabled.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-medium text-fg">Deposit amount
          <input type="number" min={0} step="0.01" value={depositAmount} onChange={(event) => setDepositAmount(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong px-3" />
        </label>
        <label className="text-sm font-medium text-fg sm:col-span-2">Public review URL
          <input type="url" value={reviewUrl} onChange={(event) => setReviewUrl(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong px-3" />
        </label>
        <label className="text-sm font-medium text-fg">Review cooldown days
          <input type="number" min={1} value={reviewCooldown} onChange={(event) => setReviewCooldown(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong px-3" />
        </label>
      </div>
      <button type="button" disabled={pending} onClick={save} className="min-h-11 rounded-lg bg-brand px-5 font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save V2 settings"}</button>
      {message ? <span className="ml-3 text-sm text-fg-muted">{message}</span> : null}
    </section>
  )
}
