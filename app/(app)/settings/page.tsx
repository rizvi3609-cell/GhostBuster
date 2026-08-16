import { EmptyState } from "@/components/ui/empty-state"

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Settings</h1>
        <p className="mt-1 text-base text-fg-muted">Clinic and messaging controls will be managed here.</p>
      </header>
      <EmptyState
        title="Settings are coming in a later phase"
        description="Current configuration is loaded from the database and environment without exposing secrets."
      />
    </div>
  )
}
