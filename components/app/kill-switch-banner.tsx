export function KillSwitchBanner() {
  return (
    <div
      role="alert"
      className="border-b border-danger/25 bg-danger/10 px-4 py-2 text-center text-sm font-semibold text-danger"
    >
      All outgoing automation is paused. No automated messages will be sent.
    </div>
  )
}
