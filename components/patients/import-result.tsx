import Link from "next/link"

import type { ImportCounts } from "@/lib/schemas"

function Count({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-2xl font-semibold tabular-nums text-fg">{value}</p>
      <p className="mt-1 text-sm text-fg-muted">{label}</p>
    </div>
  )
}

export function ImportResult({ counts }: Readonly<{ counts: ImportCounts }>) {
  return (
    <section aria-labelledby="result-heading" className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-success">Import complete</p>
        <h2 id="result-heading" className="mt-1 text-2xl font-semibold text-fg">
          Patient list updated
        </h2>
        <p className="mt-2 text-base text-fg-muted">
          Existing opt-out and consent settings were not changed.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Count label="Inserted" value={counts.inserted_count} />
        <Count label="Updated" value={counts.updated_count} />
        <Count label="Skipped" value={counts.skipped_count} />
        <Count label="Invalid" value={counts.invalid_count} />
      </div>

      <Link
        href="/patients"
        className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 py-2 font-medium text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        View patients
      </Link>
    </section>
  )
}
