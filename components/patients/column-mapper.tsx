"use client"

import type { ColumnMapping } from "@/lib/schemas"
import type { CsvRecord } from "@/lib/csv-import"

const fields = [
  { key: "fullName", label: "Patient name", hint: "Required" },
  { key: "phone", label: "Mobile phone", hint: "Required" },
  { key: "lastVisit", label: "Last visit date", hint: "Column required; values may be blank" },
  { key: "procedure", label: "Procedure", hint: "Column required; values may be blank" },
] as const

type ColumnMapperProps = Readonly<{
  headers: readonly string[]
  mapping: ColumnMapping
  onBack: () => void
  onChange: (mapping: ColumnMapping) => void
  onContinue: () => void
  sample: CsvRecord | undefined
}>

export function ColumnMapper({
  headers,
  mapping,
  onBack,
  onChange,
  onContinue,
  sample,
}: ColumnMapperProps) {
  const mappedHeaders = Object.values(mapping).filter(Boolean)
  const complete = mappedHeaders.length === 4 && new Set(mappedHeaders).size === 4

  return (
    <section aria-labelledby="mapping-heading" className="space-y-6">
      <div>
        <h2 id="mapping-heading" className="text-xl font-semibold text-fg">
          Map your columns
        </h2>
        <p className="mt-2 text-base text-fg-muted">
          Choose a different CSV column for each patient field. Nothing imports until you confirm.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="hidden grid-cols-[1fr_1fr] gap-6 border-b border-border bg-surface-sunken px-5 py-3 text-sm font-semibold text-fg-muted sm:grid">
          <span>Ghost-Buster field</span>
          <span>Your CSV column</span>
        </div>
        <div className="divide-y divide-border">
          {fields.map((field) => (
            <div key={field.key} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_1fr] sm:gap-6">
              <div>
                <label htmlFor={`mapping-${field.key}`} className="font-medium text-fg">
                  {field.label}
                </label>
                <p className="mt-1 text-sm text-fg-muted">{field.hint}</p>
              </div>
              <div>
                <select
                  id={`mapping-${field.key}`}
                  value={mapping[field.key]}
                  onChange={(event) =>
                    onChange({ ...mapping, [field.key]: event.target.value })
                  }
                  className="min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                >
                  <option value="">Select a column</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
                {mapping[field.key] ? (
                  <p className="mt-1 truncate text-sm text-fg-subtle">
                    Sample: {sample?.[mapping[field.key]] || "Blank"}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!complete && mappedHeaders.length > 0 ? (
        <p className="text-sm text-warning">
          Map all four fields and do not reuse a CSV column.
        </p>
      ) : null}

      <div className="flex flex-wrap justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-lg border border-border-strong px-5 py-2 font-medium text-fg hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-brand"
        >
          Back
        </button>
        <button
          type="button"
          disabled={!complete}
          onClick={onContinue}
          className="min-h-11 rounded-lg bg-brand px-5 py-2 font-medium text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          Preview rows
        </button>
      </div>
    </section>
  )
}
