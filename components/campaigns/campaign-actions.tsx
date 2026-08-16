"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  assignCampaignManually,
  cancelCampaign,
  pauseCampaign,
} from "@/app/actions/campaigns"

type RecipientOption = Readonly<{
  id: string
  label: string
}>

type CampaignActionsProps = Readonly<{
  campaignId: string
  recipients: readonly RecipientOption[]
  status: string
}>

export function CampaignActions({ campaignId, recipients, status }: CampaignActionsProps) {
  const router = useRouter()
  const [patientId, setPatientId] = useState(recipients[0]?.id ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const active = status === "OPEN" || status === "ESCALATING"
  const cancellable = status === "DRAFT" || active

  function pause(): void {
    if (!window.confirm("Pause this campaign? No later waves will send.")) return
    startTransition(async () => {
      const result = await pauseCampaign({ campaignId })
      if (!result.ok) setError(result.error)
      else router.refresh()
    })
  }

  function cancel(): void {
    const reason = window.prompt("Why is this campaign being cancelled?")?.trim()
    if (!reason) return
    startTransition(async () => {
      const result = await cancelCampaign({ campaignId, reason })
      if (!result.ok) setError(result.error)
      else router.refresh()
    })
  }

  function assign(): void {
    if (!patientId || !window.confirm("Assign this patient and stop all later waves?")) return
    startTransition(async () => {
      const result = await assignCampaignManually({ campaignId, patientId })
      if (!result.ok) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {active ? (
          <button type="button" disabled={pending} onClick={pause} className="min-h-11 rounded-lg border border-border-strong px-4 font-medium text-fg hover:bg-surface-sunken disabled:opacity-50">
            Pause
          </button>
        ) : null}
        {cancellable ? (
          <button type="button" disabled={pending} onClick={cancel} className="min-h-11 rounded-lg border border-danger/40 px-4 font-medium text-danger hover:bg-danger/5 disabled:opacity-50">
            Cancel
          </button>
        ) : null}
        {active && recipients.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <label htmlFor="manual-patient" className="sr-only">Patient to assign</label>
            <select id="manual-patient" value={patientId} onChange={(event) => setPatientId(event.target.value)} className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-fg">
              {recipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.label}</option>)}
            </select>
            <button type="button" disabled={pending || !patientId} onClick={assign} className="min-h-11 rounded-lg bg-success px-4 font-medium text-white disabled:opacity-50">
              Fill manually
            </button>
          </div>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  )
}
