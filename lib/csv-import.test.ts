import { describe, expect, it } from "vitest"

import {
  chunkValues,
  serializeRejectedRows,
  toPatientImportRows,
  validateMappedRows,
  type CsvRecord,
} from "./csv-import"
import type { ColumnMapping } from "./schemas"

const mapping: ColumnMapping = {
  fullName: "Patient Name",
  phone: "Mobile",
  lastVisit: "Last Visit",
  procedure: "Procedure",
}

function row(overrides: Partial<CsvRecord> = {}): CsvRecord {
  return {
    "Patient Name": "Test Patient",
    Mobile: "(212) 555-1234",
    "Last Visit": "06/15/2025",
    Procedure: "Hygiene",
    ...overrides,
  }
}

describe("validateMappedRows", () => {
  it("normalizes valid mapped rows", () => {
    const result = validateMappedRows([
      row(),
      row({
        "Patient Name": "International Patient",
        Mobile: "+44 20 7946 0018",
        "Last Visit": "2024-02-29",
        Procedure: "Crown; Emergency | Crown",
      }),
      row({
        "Patient Name": "No History",
        Mobile: "12125550199",
        "Last Visit": "",
        Procedure: "",
      }),
    ], mapping)

    expect(result.invalidCount).toBe(0)
    expect(result.duplicateCount).toBe(0)
    expect(result.validRows).toEqual([
      {
        rowNumber: 2,
        full_name: "Test Patient",
        phone_number: "+12125551234",
        last_visit_date: "2025-06-15",
        preferred_procedures: ["HYGIENE"],
      },
      {
        rowNumber: 3,
        full_name: "International Patient",
        phone_number: "+442079460018",
        last_visit_date: "2024-02-29",
        preferred_procedures: ["CROWN", "EMERGENCY"],
      },
      {
        rowNumber: 4,
        full_name: "No History",
        phone_number: "+12125550199",
        last_visit_date: null,
        preferred_procedures: [],
      },
    ])
  })

  it("reports names, phones, dates, procedures, and extensions precisely", () => {
    const result = validateMappedRows([
      row({ "Patient Name": "" }),
      row({ Mobile: "garbage" }),
      row({ Mobile: "2125551234 ext 5" }),
      row({ Mobile: "2125550101", "Last Visit": "02/30/2025" }),
      row({ Mobile: "2125550102", "Last Visit": "15 June" }),
      row({ Mobile: "2125550103", Procedure: `${"A".repeat(81)}` }),
    ], mapping)

    expect(result.invalidCount).toBe(6)
    expect(result.rejectedRows.map((item) => item.reason)).toEqual([
      "Missing or invalid name",
      "Not a valid phone number",
      "Phone extensions are not supported",
      "Invalid last visit date",
      "Invalid last visit date",
      "Invalid procedure list",
    ])
  })

  it("flags normalized in-file duplicates separately", () => {
    const result = validateMappedRows([
      row({ Mobile: "2125551234" }),
      row({ Mobile: "+1 (212) 555-1234", "Patient Name": "Duplicate" }),
    ], mapping)

    expect(result.validRows).toHaveLength(1)
    expect(result.invalidCount).toBe(0)
    expect(result.duplicateCount).toBe(1)
    expect(result.rejectedRows[0]).toMatchObject({
      rowNumber: 3,
      kind: "DUPLICATE",
      reason: "Duplicate phone number in file",
    })
  })

  it("can normalize national numbers using another default country", () => {
    const result = validateMappedRows(
      [row({ Mobile: "020 7946 0018" })],
      mapping,
      "GB",
    )

    expect(result.validRows[0]?.phone_number).toBe("+442079460018")
  })
})

describe("CSV import helpers", () => {
  it("splits a 5,000-row import into ten server-sized batches", () => {
    const rows = Array.from({ length: 5_000 }, (_, index) => index)
    const batches = chunkValues(rows, 500)

    expect(batches).toHaveLength(10)
    expect(batches.every((batch) => batch.length === 500)).toBe(true)
    expect(batches.flat()).toEqual(rows)
    expect(() => chunkValues(rows, 0)).toThrow("Chunk size must be a positive integer")
  })

  it("removes browser-only row numbers from server payloads", () => {
    const validated = validateMappedRows([row()], mapping)
    expect(toPatientImportRows(validated.validRows)).toEqual([
      {
        full_name: "Test Patient",
        phone_number: "+12125551234",
        last_visit_date: "2025-06-15",
        preferred_procedures: ["HYGIENE"],
      },
    ])
  })

  it("serializes rejected rows as escaped downloadable CSV", () => {
    const csv = serializeRejectedRows([
      {
        rowNumber: 8,
        name: 'Patient, "Quoted"',
        phone: "bad",
        kind: "INVALID",
        reason: "Missing or invalid name",
      },
    ])

    expect(csv).toBe(
      'Row,Name,Phone,Type,Reason\n8,"Patient, ""Quoted""",bad,INVALID,Missing or invalid name',
    )
  })
})
