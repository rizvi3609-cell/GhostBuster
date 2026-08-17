"use client"

import { useState, useTransition } from "react"

import { saveClinicSettings } from "@/app/actions/settings"
import type { ClinicConfig } from "@/lib/config"
import type { WavePlan } from "@/lib/wave-plan"

export function ClinicSettingsForm({ config }: Readonly<{ config: ClinicConfig }>) {
  const [clinicName, setClinicName] = useState(config.clinic_name)
  const [timezone, setTimezone] = useState(config.timezone)
  const [quietStart, setQuietStart] = useState(config.quiet_hours_start.slice(0, 5))
  const [quietEnd, setQuietEnd] = useState(config.quiet_hours_end.slice(0, 5))
  const [weeklyCap, setWeeklyCap] = useState(config.max_messages_per_week)
  const [chairValue, setChairValue] = useState(config.estimated_chair_value)
  const [recallThreshold, setRecallThreshold] = useState(config.recall_threshold_days)
  const [recallCooldown, setRecallCooldown] = useState(config.recall_cooldown_days)
  const [wavePlan, setWavePlan] = useState<WavePlan>(config.default_wave_plan)
  const [stripe, setStripe] = useState(config.feature_stripe_deposits)
  const [recalls, setRecalls] = useState(config.feature_recalls)
  const [reviews, setReviews] = useState(config.feature_reviews)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function updateWave(index: number, field: "size" | "delay_min", value: number): void {
    setWavePlan((current) => current.map((wave, position) =>
      position === index ? { ...wave, [field]: value } : wave,
    ))
  }

  function save(): void {
    startTransition(async () => {
      setMessage(null)
      const result = await saveClinicSettings({
        clinicName,
        timezone,
        quietHoursStart: quietStart,
        quietHoursEnd: quietEnd,
        maxMessagesPerWeek: weeklyCap,
        estimatedChairValue: chairValue,
        recallThresholdDays: recallThreshold,
        recallCooldownDays: recallCooldown,
        defaultWavePlan: wavePlan,
        featureStripeDeposits: stripe,
        featureRecalls: recalls,
        featureReviews: reviews,
      })
      setMessage(result.ok ? "Settings saved." : result.error)
    })
  }

  return (
    <section className="space-y-6 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-fg">Clinic and sending</h2>
        <p className="mt-1 text-sm text-fg-muted">Changes apply to every new outbound automation check.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-fg">Clinic name
          <input value={clinicName} onChange={(event) => setClinicName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-base" />
        </label>
        <label className="text-sm font-medium text-fg">IANA timezone
          <input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/New_York" className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-base" />
        </label>
        <label className="text-sm font-medium text-fg">Sending starts
          <input type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3" />
        </label>
        <label className="text-sm font-medium text-fg">Sending ends
          <input type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3" />
        </label>
        <label className="text-sm font-medium text-fg">Weekly message cap
          <input type="number" min={1} max={20} value={weeklyCap} onChange={(event) => setWeeklyCap(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3" />
        </label>
        <label className="text-sm font-medium text-fg">Estimated chair value
          <input type="number" min={0} step="0.01" value={chairValue} onChange={(event) => setChairValue(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3" />
        </label>
        <label className="text-sm font-medium text-fg">Recall threshold days
          <input type="number" min={1} value={recallThreshold} onChange={(event) => setRecallThreshold(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3" />
        </label>
        <label className="text-sm font-medium text-fg">Recall cooldown days
          <input type="number" min={1} value={recallCooldown} onChange={(event) => setRecallCooldown(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3" />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-fg">Default wave plan</h3>
          <button type="button" onClick={() => setWavePlan((current) => [...current, { size: 3, delay_min: 7 }])} className="min-h-10 rounded-lg border border-border-strong px-3 text-sm font-medium">Add wave</button>
        </div>
        <div className="mt-3 space-y-3">
          {wavePlan.map((wave, index) => (
            <div key={index} className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-3 rounded-lg bg-surface-sunken p-3">
              <span className="pb-3 text-sm font-semibold">{index + 1}</span>
              <label className="text-xs text-fg-muted">Patients
                <input type="number" min={1} value={wave.size} onChange={(event) => updateWave(index, "size", Number(event.target.value))} className="mt-1 min-h-10 w-full rounded-lg border border-border-strong bg-surface px-2 text-base text-fg" />
              </label>
              <label className="text-xs text-fg-muted">Delay min
                <input type="number" min={1} value={wave.delay_min} onChange={(event) => updateWave(index, "delay_min", Number(event.target.value))} className="mt-1 min-h-10 w-full rounded-lg border border-border-strong bg-surface px-2 text-base text-fg" />
              </label>
              <button type="button" disabled={wavePlan.length === 1} onClick={() => setWavePlan((current) => current.filter((_, position) => position !== index))} className="min-h-10 px-2 text-sm text-danger disabled:opacity-30">Remove</button>
            </div>
          ))}
        </div>
      </div>

      <fieldset>
        <legend className="font-semibold text-fg">Feature flags</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            ["Stripe deposits", stripe, setStripe],
            ["Automated recalls", recalls, setRecalls],
            ["Review requests", reviews, setReviews],
          ].map(([label, checked, setter]) => (
            <label key={String(label)} className="flex min-h-11 items-center gap-3 rounded-lg border border-border p-3 text-sm font-medium text-fg">
              <input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} className="size-5 accent-brand" />
              {String(label)}
            </label>
          ))}
        </div>
      </fieldset>

      {message ? <p role="status" className="text-sm text-fg-muted">{message}</p> : null}
      <button type="button" disabled={pending} onClick={save} className="min-h-11 rounded-lg bg-brand px-5 font-medium text-white hover:bg-brand-hover disabled:opacity-50">
        {pending ? "Saving…" : "Save settings"}
      </button>
    </section>
  )
}
