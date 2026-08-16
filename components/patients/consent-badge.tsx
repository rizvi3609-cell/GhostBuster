type ConsentStatus = "UNKNOWN" | "GRANTED" | "REVOKED"

const styles: Record<ConsentStatus, string> = {
  GRANTED: "border-success/25 bg-success/10 text-success",
  UNKNOWN: "border-warning/25 bg-warning/10 text-fg",
  REVOKED: "border-danger/25 bg-danger/10 text-danger",
}

const labels: Record<ConsentStatus, string> = {
  GRANTED: "Granted",
  UNKNOWN: "Unknown",
  REVOKED: "Revoked",
}

export function ConsentBadge({ status }: Readonly<{ status: ConsentStatus }>) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}
