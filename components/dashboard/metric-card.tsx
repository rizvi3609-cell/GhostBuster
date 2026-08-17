type MetricCardProps = Readonly<{
  label: string
  note?: string
  value: string
}>

export function MetricCard({ label, note, value }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <p className="text-3xl font-semibold tabular-nums tracking-tight text-fg">{value}</p>
      <p className="mt-2 text-sm font-medium text-fg-muted">{label}</p>
      {note ? <p className="mt-1 text-xs text-danger">{note}</p> : null}
    </div>
  )
}
