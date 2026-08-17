"use client"

import { useState, useTransition } from "react"

import { saveSlotTemplate, setSlotTemplateActive } from "@/app/actions/settings"
import type { WavePlan } from "@/lib/wave-plan"

export type SlotTemplateSetting = Readonly<{
  active: boolean
  durationMin: number
  id: string
  label: string
  procedureType: string
  requiresDeposit: boolean
  sortOrder: number
  wavePlan: WavePlan | null
}>

function TemplateEditor({ template }: Readonly<{ template: SlotTemplateSetting }>) {
  const [label, setLabel] = useState(template.label)
  const [procedure, setProcedure] = useState(template.procedureType)
  const [duration, setDuration] = useState(template.durationMin)
  const [deposit, setDeposit] = useState(template.requiresDeposit)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(): void {
    startTransition(async () => {
      const result = await saveSlotTemplate({
        id: template.id,
        label,
        procedureType: procedure,
        durationMin: duration,
        wavePlan: template.wavePlan,
        requiresDeposit: deposit,
        sortOrder: template.sortOrder,
      })
      setMessage(result.ok ? "Saved" : result.error)
    })
  }

  function toggle(): void {
    startTransition(async () => {
      const result = await setSlotTemplateActive({ id: template.id, active: !template.active })
      setMessage(result.ok ? "Updated" : result.error)
    })
  }

  return (
    <div className={`rounded-lg border border-border p-4 ${template.active ? "bg-surface" : "bg-surface-sunken opacity-70"}`}>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr_120px_auto]">
        <label className="text-xs text-fg-muted">Label
          <input value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-fg" />
        </label>
        <label className="text-xs text-fg-muted">Procedure
          <input value={procedure} onChange={(event) => setProcedure(event.target.value.toUpperCase())} className="mt-1 min-h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-fg" />
        </label>
        <label className="text-xs text-fg-muted">Minutes
          <input type="number" min={1} value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="mt-1 min-h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-fg" />
        </label>
        <label className="flex min-h-10 items-center gap-2 self-end text-sm text-fg">
          <input type="checkbox" checked={deposit} onChange={(event) => setDeposit(event.target.checked)} className="size-5 accent-brand" /> Deposit
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} onClick={save} className="min-h-10 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50">Save</button>
        <button type="button" disabled={pending} onClick={toggle} className="min-h-10 rounded-lg border border-border-strong px-4 text-sm font-medium text-fg disabled:opacity-50">
          {template.active ? "Deactivate" : "Reactivate"}
        </button>
        {message ? <span className="text-sm text-fg-muted">{message}</span> : null}
      </div>
    </div>
  )
}

export function SlotTemplateSettings({ templates }: Readonly<{ templates: readonly SlotTemplateSetting[] }>) {
  const [label, setLabel] = useState("")
  const [procedure, setProcedure] = useState("")
  const [duration, setDuration] = useState(60)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add(): void {
    startTransition(async () => {
      const result = await saveSlotTemplate({
        id: null,
        label,
        procedureType: procedure,
        durationMin: duration,
        wavePlan: null,
        requiresDeposit: false,
        sortOrder: templates.length + 1,
      })
      setMessage(result.ok ? "Template added." : result.error)
      if (result.ok) {
        setLabel("")
        setProcedure("")
      }
    })
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-fg">Slot templates</h2>
        <p className="mt-1 text-sm text-fg-muted">Templates inherit the clinic wave plan unless overridden.</p>
      </div>
      <div className="space-y-3">
        {templates.map((template) => <TemplateEditor key={template.id} template={template} />)}
      </div>
      <div className="rounded-lg border border-dashed border-border-strong p-4">
        <h3 className="font-semibold text-fg">Add template</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Hygiene — 60 min" aria-label="Template label" className="min-h-11 rounded-lg border border-border-strong px-3" />
          <input value={procedure} onChange={(event) => setProcedure(event.target.value.toUpperCase())} placeholder="HYGIENE" aria-label="Procedure type" className="min-h-11 rounded-lg border border-border-strong px-3" />
          <input type="number" min={1} value={duration} onChange={(event) => setDuration(Number(event.target.value))} aria-label="Duration minutes" className="min-h-11 rounded-lg border border-border-strong px-3" />
        </div>
        <button type="button" disabled={pending || !label.trim() || !procedure.trim()} onClick={add} className="mt-3 min-h-10 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50">Add template</button>
        {message ? <span className="ml-3 text-sm text-fg-muted">{message}</span> : null}
      </div>
    </section>
  )
}
