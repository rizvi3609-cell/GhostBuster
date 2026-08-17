import Link from "next/link"
import { z } from "zod"

import {
  DashboardCampaignCard,
  type DashboardCampaign,
} from "@/components/dashboard/dashboard-campaign-card"
import { DashboardRefresh } from "@/components/dashboard/dashboard-refresh"
import { MetricCard } from "@/components/dashboard/metric-card"
import { EmptyState } from "@/components/ui/empty-state"
import { db } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const Metrics = z.object({
  chairs_filled_month: z.coerce.number().int().nonnegative(),
  median_fill_seconds: z.coerce.number().nonnegative(),
  estimated_revenue: z.coerce.number().nonnegative(),
  delivered_count: z.coerce.number().int().nonnegative(),
  failed_count: z.coerce.number().int().nonnegative(),
  delivery_rate: z.coerce.number().nonnegative(),
})
const Campaign = z.object({
  id: z.string().uuid(),
  appointment_time: z.string(),
  clinic_timezone: z.string(),
  procedure_type: z.string(),
  duration_min: z.number().int(),
  status: z.enum(["DRAFT", "OPEN", "ESCALATING", "PENDING_PAYMENT"]),
  current_wave: z.number().int(),
  wave_count: z.number().int(),
  next_wave_at: z.string().nullable(),
  updated_at: z.string(),
  recipient_count: z.coerce.number().int(),
  delivered_count: z.coerce.number().int(),
  failed_count: z.coerce.number().int(),
})
const Outcome = z.object({
  id: z.string().uuid(),
  appointment_time: z.string(),
  clinic_timezone: z.string(),
  procedure_type: z.string(),
  status: z.enum(["FILLED", "EXPIRED", "CANCELLED"]),
  winner_name: z.string().nullable(),
  resolved_at: z.string(),
})

function duration(seconds: number): string {
  if (seconds <= 0) return "—"
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`
}

function dateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value))
}

function isStalled(value: z.infer<typeof Campaign>): boolean {
  if (value.status !== "OPEN" && value.status !== "ESCALATING") return false
  const cutoff = Date.now() - 2 * 60_000
  if (value.next_wave_at === "infinity") return new Date(value.updated_at).getTime() < cutoff
  return Boolean(value.next_wave_at && new Date(value.next_wave_at).getTime() < cutoff)
}

export default async function DashboardPage() {
  const [metricsResult, campaignsResult, outcomesResult, unreadResult] = await Promise.all([
    db.rpc("get_dashboard_metrics"),
    db.rpc("get_dashboard_campaigns"),
    db.rpc("get_recent_campaign_outcomes"),
    db
      .from("unhandled_inbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "UNREAD"),
  ])
  if (
    metricsResult.error ||
    campaignsResult.error ||
    outcomesResult.error ||
    unreadResult.error
  ) {
    throw new Error("Unable to load dashboard")
  }

  const metrics = z.array(Metrics).length(1).safeParse(metricsResult.data)
  const campaigns = z.array(Campaign).safeParse(campaignsResult.data)
  const outcomes = z.array(Outcome).safeParse(outcomesResult.data)
  if (!metrics.success || !campaigns.success || !outcomes.success) {
    throw new Error("Dashboard data is invalid")
  }

  const active: DashboardCampaign[] = campaigns.data.map((campaign) => ({
    id: campaign.id,
    appointmentTime: campaign.appointment_time,
    clinicTimezone: campaign.clinic_timezone,
    procedureType: campaign.procedure_type,
    durationMin: campaign.duration_min,
    status: campaign.status,
    currentWave: campaign.current_wave,
    waveCount: campaign.wave_count,
    nextWaveAt: campaign.next_wave_at,
    recipientCount: campaign.recipient_count,
    deliveredCount: campaign.delivered_count,
    failedCount: campaign.failed_count,
    stalled: isStalled(campaign),
  }))
  const groups = ["OPEN", "ESCALATING", "DRAFT", "PENDING_PAYMENT"] as const
  const value = metrics.data[0]

  return (
    <div className="space-y-8">
      <DashboardRefresh />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Dashboard</h1>
          <p className="mt-1 text-base text-fg-muted">Live cancellation recovery activity.</p>
        </div>
        <Link href="/campaigns/new" className="inline-flex min-h-12 items-center rounded-lg bg-brand px-6 font-semibold text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          Fill a chair
        </Link>
      </header>

      <section aria-label="Monthly performance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Chairs filled this month" value={value.chairs_filled_month.toLocaleString()} />
        <MetricCard label="Median time to fill" value={duration(value.median_fill_seconds)} />
        <div title="Estimate: chairs filled × configured chair value">
          <MetricCard label="Est. revenue recovered" value={value.estimated_revenue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} />
        </div>
        <MetricCard label="Delivery rate" value={`${value.delivery_rate}%`} note={value.failed_count ? `${value.failed_count} failed or undelivered` : undefined} />
      </section>

      <section className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-fg">Active campaigns</h2>
          <p className="text-sm text-fg-muted">{unreadResult.count ?? 0} unread inbox messages</p>
        </div>
        {active.length ? (
          groups.map((status) => {
            const rows = active.filter((campaign) => campaign.status === status)
            return rows.length ? (
              <div key={status} className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">{status.replace("_", " ")}</h3>
                <div className="grid gap-4 xl:grid-cols-2">
                  {rows.map((campaign) => <DashboardCampaignCard key={campaign.id} campaign={campaign} />)}
                </div>
              </div>
            ) : null
          })
        ) : (
          <EmptyState title="No open slots" description="When someone cancels, start a campaign to contact the ranked waitlist." />
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-fg">Recent outcomes</h2>
        </div>
        {outcomes.data.length ? (
          <div className="divide-y divide-border">
            {outcomes.data.map((outcome) => (
              <Link key={outcome.id} href={`/campaigns/${outcome.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-surface-sunken">
                <span>
                  <span className="font-medium text-fg">{dateTime(outcome.appointment_time, outcome.clinic_timezone)}</span>
                  <span className="ml-2 text-sm text-fg-muted">{outcome.procedure_type}</span>
                </span>
                <span className="text-sm font-medium text-fg-muted">
                  {outcome.status}{outcome.winner_name ? ` — ${outcome.winner_name}` : ""}
                </span>
              </Link>
            ))}
          </div>
        ) : <p className="px-5 py-8 text-center text-sm text-fg-muted">No resolved campaigns yet.</p>}
      </section>
    </div>
  )
}
