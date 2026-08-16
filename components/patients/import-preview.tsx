"use client"

import type { RejectedCsvRow } from "@/lib/csv-import"

function Metric({ label, value }: Readonly<{ label: string; value: number | string }>) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-2xl font-semibold tabular-nums text-fg">{value}</p>
      <p className="mt-1 text-sm text-fg-muted">{label}</p>
    </div>
  )
}

type ImportPreviewProps = Readonly<{
  duplicateCount: number
  error: string | null
  invalidCount: number
  isChecking: boolean
  isImporting: boolean
  onBack: () => void
  onConfirm: () => void
  onDownloadRejected: () => void
  progress: string | null
  rejectedRows: readonly RejectedCsvRow[]
  validCount: number
  willUpdate: number | null
}>

export function ImportPreview({
  duplicateCount,
  error,
  invalidCount,
  isChecking,
  isImporting,
  onBack,
  onConfirm,
  onDownloadRejected,
  progress,
  rejectedRows,
  validCount,
  willUpdate,
}: ImportPreviewProps) {
  return (
    <section aria-labelledby="preview-heading" className="space-y-6">
      <div>
        <h2 id="preview-heading" className="text-xl font-semibold text-fg">
          Review before importing
        </h2>
        <p className="mt-2 text-base text-fg-muted">
          Only valid, unique rows will be sent. Existing consent and opt-out settings are preserved.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Valid rows" value={validCount} />
        <Metric label="Invalid rows" value={invalidCount} />
        <Metric label="Duplicates skipped" value={duplicateCount} />
        <Metric
          label="Existing patients updated"
          value={isChecking ? "Checking…" : (willUpdate ?? "—")}
        />
      </div>

      {rejectedRows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h3 className="font-semibold text-fg">Rows needing attention</h3>
              <p className="mt-1 text-sm text-fg-muted">
                Showing {Math.min(100, rejectedRows.length)} of {rejectedRows.length}
              </p>
            </div>
            <button
              type="button"
              onClick={onDownloadRejected}
              className="min-h-11 rounded-lg border border-border-strong px-4 py-2 text-sm font-medium text-fg hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-brand"
            >
              Download invalid rows
            </button>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Invalid and duplicate CSV rows</caption>
              <thead className="sticky top-0 bg-surface-sunken text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Row</th>
                  <th scope="col" className="px-4 py-3 font-medium">Name</th>
                  <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                  <th scope="col" className="px-4 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rejectedRows.slice(0, 100).map((row) => (
                  <tr key={`${row.rowNumber}-${row.kind}`}>
                    <td className="px-4 py-3 tabular-nums text-fg-muted">{row.rowNumber}</td>
                    <td className="px-4 py-3 text-fg">{row.name || "—"}</td>
                    <td className="px-4 py-3 font-mono text-fg-muted">{row.phone || "—"}</td>
                    <td className="px-4 py-3 text-danger">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-danger">
          {error}
        </p>
      ) : null}

      {progress ? (
        <p aria-live="polite" className="text-sm font-medium text-brand">{progress}</p>
      ) : null}

      <div className="flex flex-wrap justify-between gap-3">
        <button
          type="button"
          disabled={isImporting}
          onClick={onBack}
          className="min-h-11 rounded-lg border border-border-strong px-5 py-2 font-medium text-fg hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          disabled={isChecking || isImporting || willUpdate === null}
          onClick={onConfirm}
          className="min-h-11 rounded-lg bg-brand px-5 py-2 font-medium text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isImporting ? "Importing…" : `Import ${validCount} valid rows`}
        </button>
      </div>
    </section>
  )
}
