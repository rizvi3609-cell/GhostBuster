import { getInboxSnapshot, getInboxThread } from "@/app/actions/inbox"
import { InboxWorkspace } from "@/components/inbox/inbox-workspace"

export const dynamic = "force-dynamic"

export default async function InboxPage() {
  const snapshot = await getInboxSnapshot()
  if (!snapshot.ok) throw new Error("Unable to load inbox")

  const initial = snapshot.data.conversations[0]
  const thread = initial?.patientId
    ? await getInboxThread({ patientId: initial.patientId })
    : null
  if (thread && !thread.ok) throw new Error("Unable to load inbox thread")

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Inbox</h1>
          <p className="mt-1 text-base text-fg-muted">
            Patient messages that need a staff response.
          </p>
        </div>
        <p className="text-sm text-fg-muted">
          {snapshot.data.conversations.length} open conversation
          {snapshot.data.conversations.length === 1 ? "" : "s"}
        </p>
      </header>
      <InboxWorkspace
        initialConversations={snapshot.data.conversations}
        initialMessages={thread?.ok ? thread.data.messages : []}
        staff={snapshot.data.staff}
      />
    </div>
  )
}
