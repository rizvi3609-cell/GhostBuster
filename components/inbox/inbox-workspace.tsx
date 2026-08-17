"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"

import {
  assignInboxMessage,
  getInboxSnapshot,
  getInboxThread,
  resolveInboxMessage,
  sendManualInboxReply,
  type InboxConversation,
  type InboxStaffOption,
  type InboxThreadMessage,
} from "@/app/actions/inbox"
import { useInboxRealtime } from "@/components/inbox/inbox-realtime-provider"

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function statusMark(message: InboxThreadMessage): string {
  if (message.direction === "INBOUND") return "Received"
  if (message.status === "DELIVERED") return "Delivered ✓✓"
  if (message.status === "FAILED" || message.status === "UNDELIVERED") {
    return `Failed${message.error_code ? ` · ${message.error_code}` : ""}`
  }
  return `${message.status.charAt(0)}${message.status.slice(1).toLowerCase()} ✓`
}

type InboxWorkspaceProps = Readonly<{
  initialConversations: readonly InboxConversation[]
  initialMessages: readonly InboxThreadMessage[]
  staff: readonly InboxStaffOption[]
}>

export function InboxWorkspace({
  initialConversations,
  initialMessages,
  staff: initialStaff,
}: InboxWorkspaceProps) {
  const { connected, revision } = useInboxRealtime()
  const [conversations, setConversations] = useState([...initialConversations])
  const [staff, setStaff] = useState([...initialStaff])
  const [selectedId, setSelectedId] = useState(initialConversations[0]?.inboxId ?? null)
  const [messages, setMessages] = useState([...initialMessages])
  const [message, setMessage] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [pending, startTransition] = useTransition()

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.inboxId === selectedId) ?? null,
    [conversations, selectedId],
  )

  const loadThread = useCallback(async (patientId: string | null) => {
    if (!patientId) {
      setMessages([])
      return
    }
    const result = await getInboxThread({ patientId })
    if (result.ok) setMessages(result.data.messages)
    else setError(result.error)
  }, [])

  const refresh = useCallback(async () => {
    const result = await getInboxSnapshot()
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConversations([...result.data.conversations])
    setStaff([...result.data.staff])
    const current = result.data.conversations.find(
      (conversation) => conversation.inboxId === selectedId,
    )
    const next = current ?? result.data.conversations[0] ?? null
    setSelectedId(next?.inboxId ?? null)
    await loadThread(next?.patientId ?? null)
  }, [loadThread, selectedId])

  useEffect(() => {
    if (revision > 0) void refresh()
  }, [refresh, revision])

  async function selectConversation(conversation: InboxConversation): Promise<void> {
    setSelectedId(conversation.inboxId)
    setError(null)
    await loadThread(conversation.patientId)
  }

  function assign(staffId: string): void {
    if (!selected || !staffId) return
    startTransition(async () => {
      const result = await assignInboxMessage({ inboxId: selected.inboxId, staffId })
      if (!result.ok) setError(result.error)
      else await refresh()
    })
  }

  function resolve(): void {
    if (!selected || !window.confirm("Resolve this conversation?")) return
    startTransition(async () => {
      const result = await resolveInboxMessage({ inboxId: selected.inboxId })
      if (!result.ok) setError(result.error)
      else await refresh()
    })
  }

  async function sendReply(): Promise<void> {
    if (!selected?.patientId || !message.trim() || sending) return
    setSending(true)
    setError(null)
    const requestId = crypto.randomUUID()
    const result = await sendManualInboxReply({
      inboxId: selected.inboxId,
      patientId: selected.patientId,
      requestId,
      message: message.trim(),
    })
    if (!result.ok) setError(result.error)
    else {
      setMessage("")
      await loadThread(selected.patientId)
    }
    setSending(false)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm lg:grid lg:min-h-[640px] lg:grid-cols-[360px_1fr]">
      <aside className="border-b border-border lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold text-fg">Conversations</h2>
          <span className={`text-xs ${connected ? "text-success" : "text-warning"}`}>
            {connected ? "Live" : "Polling"}
          </span>
        </div>
        <div className="max-h-[320px] overflow-y-auto lg:max-h-[590px]">
          {conversations.length ? (
            conversations.map((conversation) => (
              <button
                key={conversation.inboxId}
                type="button"
                onClick={() => selectConversation(conversation)}
                className={`w-full border-b border-border px-4 py-4 text-left hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand ${
                  selectedId === conversation.inboxId ? "bg-brand-subtle" : ""
                } ${conversation.status === "UNREAD" ? "border-l-4 border-l-brand" : ""}`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className={conversation.status === "UNREAD" ? "font-semibold text-fg" : "font-medium text-fg"}>
                    {conversation.patientName}
                  </span>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {relativeTime(conversation.receivedAt)}
                  </span>
                </span>
                <span className="mt-1 block truncate text-sm text-fg-muted">
                  {conversation.messagePreview}
                </span>
              </button>
            ))
          ) : (
            <p className="px-5 py-12 text-center text-sm text-fg-muted">No messages need attention.</p>
          )}
        </div>
      </aside>

      <section className="flex min-h-[520px] flex-col">
        {selected ? (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="font-semibold text-fg">{selected.patientName}</h2>
                <p className="mt-0.5 text-xs text-fg-muted">{selected.status === "UNREAD" ? "Unread" : "Open"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="assign-staff" className="sr-only">Assign to staff</label>
                <select
                  id="assign-staff"
                  value={selected.assignedTo ?? ""}
                  disabled={pending}
                  onChange={(event) => assign(event.target.value)}
                  className="min-h-10 rounded-lg border border-border-strong bg-surface px-3 text-sm text-fg"
                >
                  <option value="">Assign to…</option>
                  {staff.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
                </select>
                <button type="button" disabled={pending} onClick={resolve} className="min-h-10 rounded-lg border border-border-strong px-3 text-sm font-medium text-fg hover:bg-surface-sunken disabled:opacity-50">Resolve</button>
                {selected.patientId ? <Link href={`/patients?q=${encodeURIComponent(selected.patientName)}`} className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-brand hover:bg-brand-subtle">View patient</Link> : null}
              </div>
            </header>

            <div aria-live="polite" className="flex-1 space-y-3 overflow-y-auto bg-surface-sunken/50 px-5 py-5">
              {messages.map((item) => (
                <div key={item.id} className={`flex ${item.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-xl px-4 py-3 ${item.direction === "OUTBOUND" ? "bg-brand-subtle text-fg" : "border border-border bg-surface text-fg"}`}>
                    <p className="whitespace-pre-wrap text-sm">{item.message_body ?? "Message body redacted"}</p>
                    <p className="mt-1 text-right text-xs text-fg-subtle">{relativeTime(item.created_at)} · {statusMark(item)}</p>
                  </div>
                </div>
              ))}
              {!messages.length ? <p className="text-center text-sm text-fg-muted">No message history available.</p> : null}
            </div>

            <div className="border-t border-border p-4">
              {error ? <p role="alert" className="mb-3 rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p> : null}
              {selected.patientId ? (
                <div className="space-y-2">
                  <label htmlFor="manual-reply" className="sr-only">Reply to patient</label>
                  <textarea
                    id="manual-reply"
                    value={message}
                    maxLength={480}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Write a short reply without clinical details"
                    className="min-h-24 w-full resize-y rounded-lg border border-border-strong bg-surface p-3 text-base text-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className={`text-xs ${message.length > 160 ? "text-warning" : "text-fg-subtle"}`}>
                      {message.length}/480{message.length > 160 ? " · multiple SMS segments may cost more" : ""}
                    </p>
                    <button type="button" disabled={sending || !message.trim()} onClick={sendReply} className="min-h-11 rounded-lg bg-brand px-5 font-medium text-white hover:bg-brand-hover disabled:opacity-50">
                      {sending ? "Sending…" : "Send reply"}
                    </button>
                  </div>
                </div>
              ) : <p className="text-sm text-fg-muted">Unknown senders cannot receive a reply until matched to a patient.</p>}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-fg-muted">Select a conversation to view its messages.</div>
        )}
      </section>
    </div>
  )
}
