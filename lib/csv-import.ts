import type { CountryCode } from "libphonenumber-js"

import { normalizeToE164 } from "./phone"
import type { ColumnMapping, PatientImportRow } from "./schemas"

export type CsvRecord = Readonly<Record<string, string>>

export type ValidatedPatientRow = PatientImportRow &
  Readonly<{ rowNumber: number }>

export type RejectedCsvRow = Readonly<{
  kind: "INVALID" | "DUPLICATE"
  name: string
  phone: string
  reason: string
  rowNumber: number
}>

export type CsvValidationResult = Readonly<{
  duplicateCount: number
  invalidCount: number
  rejectedRows: readonly RejectedCsvRow[]
  validRows: readonly ValidatedPatientRow[]
}>

function parseIsoDate(value: string): string | null | undefined {
  const input = value.trim()
  if (input.length === 0) return null

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input)
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input)

  const parts = isoMatch
    ? [Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])]
    : usMatch
      ? [Number(usMatch[3]), Number(usMatch[1]), Number(usMatch[2])]
      : null

  if (!parts) return undefined

  const [year, month, day] = parts
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined
  }

  return [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join(
    "-",
  )
}

function parseProcedures(value: string): string[] | undefined {
  const procedures = Array.from(
    new Set(
      value
        .split(/[;,|]/)
        .map((item) =>
          item
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, "_")
            .replace(/^_+|_+$/g, ""),
        )
        .filter(Boolean),
    ),
  )

  if (procedures.length > 20 || procedures.some((item) => item.length > 80)) {
    return undefined
  }

  return procedures
}

function rejection(
  rowNumber: number,
  row: CsvRecord,
  mapping: ColumnMapping,
  reason: string,
  kind: RejectedCsvRow["kind"] = "INVALID",
): RejectedCsvRow {
  return {
    rowNumber,
    name: row[mapping.fullName]?.trim() ?? "",
    phone: row[mapping.phone]?.trim() ?? "",
    reason,
    kind,
  }
}

export function validateMappedRows(
  rows: readonly CsvRecord[],
  mapping: ColumnMapping,
  defaultCountry: CountryCode = "US",
): CsvValidationResult {
  const validRows: ValidatedPatientRow[] = []
  const rejectedRows: RejectedCsvRow[] = []
  const seenPhones = new Set<string>()

  rows.forEach((row, index) => {
    const rowNumber = index + 2
    const fullName = row[mapping.fullName]?.trim() ?? ""
    if (fullName.length === 0 || fullName.length > 200) {
      rejectedRows.push(rejection(rowNumber, row, mapping, "Missing or invalid name"))
      return
    }

    const phoneResult = normalizeToE164(row[mapping.phone] ?? "", defaultCountry)
    if (!phoneResult.ok) {
      const reason =
        phoneResult.reason === "EXTENSION_NOT_ALLOWED"
          ? "Phone extensions are not supported"
          : "Not a valid phone number"
      rejectedRows.push(rejection(rowNumber, row, mapping, reason))
      return
    }

    if (seenPhones.has(phoneResult.phone)) {
      rejectedRows.push(
        rejection(
          rowNumber,
          row,
          mapping,
          "Duplicate phone number in file",
          "DUPLICATE",
        ),
      )
      return
    }
    seenPhones.add(phoneResult.phone)

    const lastVisitDate = parseIsoDate(row[mapping.lastVisit] ?? "")
    if (lastVisitDate === undefined) {
      rejectedRows.push(rejection(rowNumber, row, mapping, "Invalid last visit date"))
      return
    }

    const procedures = parseProcedures(row[mapping.procedure] ?? "")
    if (!procedures) {
      rejectedRows.push(rejection(rowNumber, row, mapping, "Invalid procedure list"))
      return
    }

    validRows.push({
      rowNumber,
      full_name: fullName,
      phone_number: phoneResult.phone,
      last_visit_date: lastVisitDate,
      preferred_procedures: procedures,
    })
  })

  return {
    validRows,
    rejectedRows,
    invalidCount: rejectedRows.filter((row) => row.kind === "INVALID").length,
    duplicateCount: rejectedRows.filter((row) => row.kind === "DUPLICATE").length,
  }
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function serializeRejectedRows(rows: readonly RejectedCsvRow[]): string {
  const header = ["Row", "Name", "Phone", "Type", "Reason"]
  const body = rows.map((row) => [
    row.rowNumber,
    row.name,
    row.phone,
    row.kind,
    row.reason,
  ])

  return [header, ...body].map((row) => row.map(csvCell).join(",")).join("\n")
}

export function chunkValues<Value>(
  values: readonly Value[],
  size: number,
): Value[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError("Chunk size must be a positive integer")
  }

  const result: Value[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

export function toPatientImportRows(
  rows: readonly ValidatedPatientRow[],
): PatientImportRow[] {
  return rows.map((row) => ({
    full_name: row.full_name,
    phone_number: row.phone_number,
    last_visit_date: row.last_visit_date,
    preferred_procedures: row.preferred_procedures,
  }))
}
