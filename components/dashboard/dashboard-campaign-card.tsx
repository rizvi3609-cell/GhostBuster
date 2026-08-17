import Link from "next/link"

import { CampaignActions } from "@/components/campaigns/campaign-actions"
import { CountdownTimer } from "@/components/campaigns/countdown-timer"

export type DashboardCampaign = Readonly<{
  appointmentTime: string
  clinicTimezone: string
  currentWave: number
  deliveredCount: number
  durationMin: number
  failedCount: number
  id: string
  nextWaveAt: string | null
  procedureType: string
  recipientCount: number
  stalled: boolean
  status: string
  waveCount: number
}>

function appointment(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value))
}

export function DashboardCampaignCard({ campaign }: Readonly<{ campaign: DashboardCampaign }>) {
  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/campaigns/${campaign.id}`} className="text-lg font-semibold text-fg hover:text-brand">
            {appointment(campaign.appointmentTime, campaign.clinicTimezone)}
          </Link>
          <p className="mt-1 text-sm text-fg-muted">
            {campaign.procedureType} · {campaign.durationMin} min
          </p>
        </div>
        <span className="rounded-full border border-border-strong px-3 py-1 text-xs font-semibold text-fg">
          {campaign.status}
        </span>
      </div>

      <div className="mt-4 grid gap-3 text-sm text-fg-muted sm:grid-cols-3">
        <p>Wave {campaign.currentWave} of {campaign.waveCount}</p>
        <p>{campaign.recipientCount} recipients</p>
        <p>{campaign.deliveredCount} delivered · {campaign.failedCount} failed</p>
      </div>

      {campaign.status === "OPEN" || campaign.status === "ESCALATING" ? (
        <p className="mt-3 text-sm text-fg-muted">
          Next wave: <CountdownTimer target={campaign.nextWaveAt} />
        </p>
      ) : null}

      {campaign.stalled ? (
        <p role="alert" className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm font-medium text-fg">
          Wave may not have sent — check automation.
        </p>
      ) : null}

      <div className="mt-4 border-t border-border pt-4">
        <CampaignActions campaignId={campaign.id} recipients={[]} status={campaign.status} />
      </div>
    </article>
  )
}
