"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { createCampaign, getCampaignPreview } from "@/app/actions/campaigns"
import type { WavePlan } from "@/lib/wave-plan"

type Template = Readonly<{
  id: string
  label: string
  procedure_type: string
  duration_min: number
}>

type NewCampaignFormProps = Readonly<{
  defaultWavePlan: WavePlan
  initialLocalTime: string
  templates: readonly Template[]
  timezone: string
}>

export function NewCampaignForm({
  defaultWavePlan,
  initialLocalTime,
  templates,
  timezone,
}: NewCampaignFormProps) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [templateId, setTemplateId] = useState("")
  const [appointmentLocal, setAppointmentLocal] = useState(initialLocalTime)
  const [wavePlan, setWavePlan] = useState<WavePlan>(defaultWavePlan)
  const [customize, setCustomize] = useState(false)
  const [preview, setPreview] = useState<{ eligibleCount: number; firstWaveSize: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = templates.find((template) => template.id === templateId)

  async function chooseTemplate(id: string): Promise<void> {
    setTemplateId(id)
    setBusy(true)
    setError(null)
    const result = await getCampaignPreview({ templateId: id })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPreview({
      eligibleCount: result.data.eligibleCount,
      firstWaveSize: result.data.firstWaveSize,
    })
    setWavePlan(result.data.defaultWavePlan)
    setStep(2)
  }

  function updateWave(index: number, field: "size" | "delay_min", value: number): void {
    setWavePlan((current) =>
      current.map((wave, waveIndex) =>
        waveIndex === index ? { ...wave, [field]: value } : wave,
      ),
    )
  }

  async function submit(): Promise<void> {
    if (!templateId) return
    setBusy(true)
    setError(null)
    const result = await createCampaign({
      templateId,
      appointmentLocal,
      wavePlan: customize ? wavePlan : undefined,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      if ("campaignId" in result && result.campaignId) {
        router.push(`/campaigns/${result.campaignId}`)
      }
      return
    }
    router.push(`/campaigns/${result.data.campaignId}`)
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
      <ol className="grid grid-cols-3 gap-2" aria-label="Campaign setup progress">
        {["Slot", "Time", "Confirm"].map((label, index) => (
          <li key={label} className="text-center">
            <div className={`h-1.5 rounded-full ${step >= index + 1 ? "bg-brand" : "bg-border"}`} />
            <span className="mt-2 block text-xs text-fg-muted">{label}</span>
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <div className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold text-fg">What type of opening?</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                disabled={busy}
                onClick={() => chooseTemplate(template.id)}
                className="min-h-20 rounded-xl border border-border-strong bg-surface p-4 text-left hover:border-brand hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
              >
                <span className="block font-semibold text-fg">{template.label}</span>
                <span className="mt-1 block text-sm text-fg-muted">{template.duration_min} minutes</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-8 space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-fg">When is the appointment?</h2>
            <p className="mt-1 text-sm text-fg-muted">Times are interpreted in {timezone}.</p>
          </div>
          <div>
            <label htmlFor="appointment-time" className="block font-medium text-fg">Appointment time</label>
            <input
              id="appointment-time"
              type="datetime-local"
              value={appointmentLocal}
              onChange={(event) => setAppointmentLocal(event.target.value)}
              className="mt-2 min-h-12 w-full max-w-sm rounded-lg border border-border-strong bg-surface px-3 text-base text-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div className="flex justify-between gap-3">
            <button type="button" onClick={() => setStep(1)} className="min-h-11 rounded-lg border border-border-strong px-5 font-medium text-fg hover:bg-surface-sunken">Back</button>
            <button type="button" disabled={!appointmentLocal} onClick={() => setStep(3)} className="min-h-11 rounded-lg bg-brand px-5 font-medium text-white hover:bg-brand-hover disabled:opacity-50">Continue</button>
          </div>
        </div>
      ) : null}

      {step === 3 && selected && preview ? (
        <div className="mt-8 space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-fg">Confirm the send</h2>
            <p className="mt-2 text-base text-fg-muted">
              Wave 1 will contact {Math.min(wavePlan[0]?.size ?? 0, preview.eligibleCount)} of {preview.eligibleCount} eligible patients for {selected.label}.
            </p>
          </div>

          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={customize} onChange={(event) => setCustomize(event.target.checked)} className="size-5 accent-brand" />
            <span className="font-medium text-fg">Customize wave plan</span>
          </label>

          {customize ? (
            <div className="space-y-3 rounded-lg bg-surface-sunken p-4">
              {wavePlan.map((wave, index) => (
                <div key={index} className="grid grid-cols-[auto_1fr_1fr] items-end gap-3">
                  <span className="pb-3 text-sm font-semibold text-fg">Wave {index + 1}</span>
                  <label className="text-sm text-fg-muted">Patients<input type="number" min={1} value={wave.size} onChange={(event) => updateWave(index, "size", Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-fg" /></label>
                  <label className="text-sm text-fg-muted">Wait min<input type="number" min={1} value={wave.delay_min} onChange={(event) => updateWave(index, "delay_min", Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-fg" /></label>
                </div>
              ))}
            </div>
          ) : null}

          {error ? <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-danger">{error}</p> : null}
          <div className="flex justify-between gap-3">
            <button type="button" disabled={busy} onClick={() => setStep(2)} className="min-h-11 rounded-lg border border-border-strong px-5 font-medium text-fg hover:bg-surface-sunken disabled:opacity-50">Back</button>
            <button type="button" disabled={busy || preview.eligibleCount === 0} onClick={submit} className="min-h-12 rounded-lg bg-brand px-6 font-semibold text-white hover:bg-brand-hover disabled:opacity-50">{busy ? "Starting…" : "Send"}</button>
          </div>
        </div>
      ) : null}

      {error && step !== 3 ? <p role="alert" className="mt-5 rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-danger">{error}</p> : null}
    </section>
  )
}
