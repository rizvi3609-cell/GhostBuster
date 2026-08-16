import Link from "next/link"

import { EmptyState } from "@/components/ui/empty-state"

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Dashboard</h1>
          <p className="mt-1 text-base text-fg-muted">Open-slot activity will appear here.</p>
        </div>
        <Link
          href="/campaigns/new"
          className="inline-flex min-h-12 items-center rounded-lg bg-brand px-6 font-semibold text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Fill a chair
        </Link>
      </header>
      <EmptyState
        title="No open slots"
        description="When someone cancels, start here to contact the ranked waitlist."
      />
    </div>
  )
}
