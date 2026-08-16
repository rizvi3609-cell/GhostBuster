import { EmptyState } from "@/components/ui/empty-state"

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Dashboard</h1>
        <p className="mt-1 text-base text-fg-muted">Open-slot activity will appear here.</p>
      </header>
      <EmptyState
        title="No open slots"
        description="When someone cancels, this dashboard will show the live waitlist campaign and its outcome."
      />
    </div>
  )
}
