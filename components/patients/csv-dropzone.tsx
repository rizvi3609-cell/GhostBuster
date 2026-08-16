"use client"

import { useRef, useState, type DragEvent } from "react"

type CsvDropzoneProps = Readonly<{
  busy: boolean
  error: string | null
  onFile: (file: File) => void
}>

export function CsvDropzone({ busy, error, onFile }: CsvDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function acceptFile(file: File | undefined): void {
    if (file) onFile(file)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setDragging(false)
    acceptFile(event.dataTransfer.files[0])
  }

  return (
    <section aria-labelledby="csv-drop-heading" className="space-y-4">
      <div
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
          dragging ? "border-brand bg-brand-subtle" : "border-border-strong bg-surface"
        }`}
      >
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-subtle text-brand">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4h14v-4" />
          </svg>
        </div>
        <h2 id="csv-drop-heading" className="mt-4 text-xl font-semibold text-fg">
          Drop your Dentrix or Eaglesoft export here
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-base text-fg-muted">
          Your file is read in your browser and never uploaded.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-6 min-h-11 rounded-lg bg-brand px-5 py-2 font-medium text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Reading CSV…" : "Choose CSV file"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          className="sr-only"
          onChange={(event) => acceptFile(event.target.files?.[0])}
        />
        <p className="mt-3 text-sm text-fg-subtle">CSV only · maximum 10 MB</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
