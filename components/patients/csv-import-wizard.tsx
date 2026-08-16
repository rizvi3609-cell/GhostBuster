"use client"

import { useState } from "react"

import {
  finishPatientImport,
  importPatientBatch,
  previewPatientPhones,
  startPatientImport,
} from "@/app/actions/patients"
import { ColumnMapper } from "@/components/patients/column-mapper"
import { CsvDropzone } from "@/components/patients/csv-dropzone"
import { ImportPreview } from "@/components/patients/import-preview"
import { ImportResult } from "@/components/patients/import-result"
import {
  chunkValues,
  serializeRejectedRows,
  toPatientImportRows,
  validateMappedRows,
  type CsvRecord,
  type CsvValidationResult,
} from "@/lib/csv-import"
import type { ColumnMapping, ImportCounts } from "@/lib/schemas"

const maximumFileSize = 10 * 1024 * 1024
const batchSize = 500

const emptyMapping: ColumnMapping = {
  fullName: "",
  phone: "",
  lastVisit: "",
  procedure: "",
}

type CsvDataset = Readonly<{
  filename: string
  headers: readonly string[]
  rows: readonly CsvRecord[]
}>

async function parseFile(file: File): Promise<CsvDataset> {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    throw new Error("Choose a CSV file.")
  }
  if (file.size === 0) throw new Error("The CSV file is empty.")
  if (file.size > maximumFileSize) throw new Error("The CSV file is larger than 10 MB.")

  const Papa = (await import("papaparse")).default

  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim(),
      complete(results) {
        const headers = results.meta.fields?.filter(Boolean) ?? []
        if (headers.length === 0) {
          reject(new Error("The CSV needs a header row."))
          return
        }
        if (new Set(headers).size !== headers.length) {
          reject(new Error("CSV column names must be unique."))
          return
        }

        const fatalError = results.errors.find(
          (error) => error.type === "Quotes" || error.code === "UndetectableDelimiter",
        )
        if (fatalError) {
          reject(new Error(`Couldn't read the CSV: ${fatalError.message}`))
          return
        }

        const rows = results.data
          .map((row) =>
            Object.fromEntries(
              headers.map((header) => [header, String(row[header] ?? "")]),
            ),
          )
          .filter((row) => Object.values(row).some((value) => value.trim().length > 0))

        if (rows.length === 0) {
          reject(new Error("The CSV has no patient rows."))
          return
        }
        if (rows.length > 100_000) {
          reject(new Error("The CSV exceeds the 100,000-row safety limit."))
          return
        }

        resolve({ filename: file.name, headers, rows })
      },
      error() {
        reject(new Error("The CSV could not be read."))
      },
    })
  })
}

export function CsvImportWizard() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [dataset, setDataset] = useState<CsvDataset | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping)
  const [validation, setValidation] = useState<CsvValidationResult | null>(null)
  const [willUpdate, setWillUpdate] = useState<number | null>(null)
  const [counts, setCounts] = useState<ImportCounts | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  async function handleFile(file: File): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const parsed = await parseFile(file)
      setDataset(parsed)
      setMapping(emptyMapping)
      setValidation(null)
      setWillUpdate(null)
      setStep(2)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The CSV could not be read.")
    } finally {
      setBusy(false)
    }
  }

  async function preparePreview(): Promise<void> {
    if (!dataset) return

    const nextValidation = validateMappedRows(dataset.rows, mapping)
    setValidation(nextValidation)
    setWillUpdate(null)
    setError(null)
    setStep(3)
    setChecking(true)

    try {
      const existing = new Set<string>()
      for (const phoneBatch of chunkValues(
        nextValidation.validRows.map((row) => row.phone_number),
        batchSize,
      )) {
        const result = await previewPatientPhones({ phones: phoneBatch })
        if (!result.ok) throw new Error(result.error)
        result.data.existingPhones.forEach((phone) => existing.add(phone))
      }
      setWillUpdate(existing.size)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't check existing patients.")
    } finally {
      setChecking(false)
    }
  }

  async function runImport(): Promise<void> {
    if (!dataset || !validation || willUpdate === null) return

    setBusy(true)
    setError(null)
    setProgress("Starting import…")

    try {
      const started = await startPatientImport({
        filename: dataset.filename,
        rowCount: dataset.rows.length,
        invalidCount: validation.invalidCount,
        skippedCount: validation.duplicateCount,
        columnMapping: mapping,
      })
      if (!started.ok) throw new Error(started.error)

      const rowBatches = chunkValues(
        toPatientImportRows(validation.validRows),
        batchSize,
      )
      for (let index = 0; index < rowBatches.length; index += 1) {
        setProgress(`Importing batch ${index + 1} of ${rowBatches.length}…`)
        const imported = await importPatientBatch({
          importBatchId: started.data.importBatchId,
          batchNumber: index,
          rows: rowBatches[index],
        })
        if (!imported.ok) throw new Error(imported.error)
      }

      setProgress("Finalizing import…")
      const finished = await finishPatientImport({
        importBatchId: started.data.importBatchId,
      })
      if (!finished.ok) throw new Error(finished.error)

      setCounts(finished.data)
      setProgress(null)
      setStep(4)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The import could not be completed.")
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  function downloadRejected(): void {
    if (!validation) return
    const blob = new Blob([serializeRejectedRows(validation.rejectedRows)], {
      type: "text/csv;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "ghost-buster-invalid-rows.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-8">
      <ol aria-label="Import progress" className="grid grid-cols-4 gap-2">
        {["Choose file", "Map columns", "Preview", "Result"].map((label, index) => (
          <li key={label} className="text-center">
            <div className={`h-1.5 rounded-full ${step >= index + 1 ? "bg-brand" : "bg-border"}`} />
            <span className="mt-2 hidden text-xs text-fg-muted sm:block">{label}</span>
          </li>
        ))}
      </ol>

      {step === 1 ? <CsvDropzone busy={busy} error={error} onFile={handleFile} /> : null}
      {step === 2 && dataset ? (
        <ColumnMapper
          headers={dataset.headers}
          mapping={mapping}
          onBack={() => setStep(1)}
          onChange={setMapping}
          onContinue={preparePreview}
          sample={dataset.rows[0]}
        />
      ) : null}
      {step === 3 && validation ? (
        <ImportPreview
          duplicateCount={validation.duplicateCount}
          error={error}
          invalidCount={validation.invalidCount}
          isChecking={checking}
          isImporting={busy}
          onBack={() => setStep(2)}
          onConfirm={runImport}
          onDownloadRejected={downloadRejected}
          progress={progress}
          rejectedRows={validation.rejectedRows}
          validCount={validation.validRows.length}
          willUpdate={willUpdate}
        />
      ) : null}
      {step === 4 && counts ? <ImportResult counts={counts} /> : null}
    </div>
  )
}
