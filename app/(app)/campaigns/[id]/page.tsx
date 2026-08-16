import { EmptyState } from "@/components/ui/empty-state"

export default function CampaignDetailPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Campaign detail</h1>
        <p className="mt-1 text-base text-fg-muted">Wave progress and recipient delivery will appear here.</p>
      </header>
      <EmptyState
        title="No campaign detail yet"
        description="Campaign creation and the live wave timeline are implemented in the campaign phase."
      />
    </div>
  )
}
