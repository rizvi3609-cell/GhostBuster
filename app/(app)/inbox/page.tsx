import { EmptyState } from "@/components/ui/empty-state"

export default function InboxPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Inbox</h1>
        <p className="mt-1 text-base text-fg-muted">Messages that need a staff reply will appear here.</p>
      </header>
      <EmptyState
        title="No messages need attention"
        description="Inbound messages that are not recognized commands will be added to this inbox."
      />
    </div>
  )
}
