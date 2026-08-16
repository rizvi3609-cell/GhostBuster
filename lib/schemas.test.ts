import { describe, expect, it } from "vitest"

import {
  ColumnMappingSchema,
  ImportPatientBatchInput,
  PatientImportRowSchema,
  StartPatientImportInput,
} from "./schemas"

const validRow = {
  full_name: "Test Patient",
  phone_number: "+12125551234",
  last_visit_date: "2025-06-15",
  preferred_procedures: ["HYGIENE"],
}

describe("patient import schemas", () => {
  it("accepts valid normalized patient data", () => {
    expect(PatientImportRowSchema.safeParse(validRow).success).toBe(true)
    expect(
      PatientImportRowSchema.safeParse({ ...validRow, last_visit_date: null }).success,
    ).toBe(true)
  })

  it("rejects malformed phones, dates, procedures, and unknown fields", () => {
    expect(
      PatientImportRowSchema.safeParse({ ...validRow, phone_number: "212-555-1234" })
        .success,
    ).toBe(false)
    expect(
      PatientImportRowSchema.safeParse({ ...validRow, last_visit_date: "2025-02-30" })
        .success,
    ).toBe(false)
    expect(
      PatientImportRowSchema.safeParse({ ...validRow, preferred_procedures: ["Hygiene"] })
        .success,
    ).toBe(false)
    expect(PatientImportRowSchema.safeParse({ ...validRow, opted_out: false }).success).toBe(
      false,
    )
  })

  it("requires four distinct explicit column mappings", () => {
    const validMapping = {
      fullName: "Name",
      phone: "Phone",
      lastVisit: "Last Visit",
      procedure: "Procedure",
    }
    expect(ColumnMappingSchema.safeParse(validMapping).success).toBe(true)
    expect(
      ColumnMappingSchema.safeParse({ ...validMapping, phone: "Name" }).success,
    ).toBe(false)
  })

  it("enforces the 500-row server batch boundary and phone uniqueness", () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      ...validRow,
      phone_number: `+1997${String(index + 1).padStart(8, "0")}`,
    }))
    const input = {
      importBatchId: "00000000-0000-4000-8000-000000000901",
      batchNumber: 0,
      rows,
    }

    expect(ImportPatientBatchInput.safeParse(input).success).toBe(true)
    expect(
      ImportPatientBatchInput.safeParse({ ...input, rows: [...rows, validRow] }).success,
    ).toBe(false)
    expect(
      ImportPatientBatchInput.safeParse({ ...input, rows: [validRow, validRow] }).success,
    ).toBe(false)
  })

  it("keeps import summary counts internally consistent", () => {
    const input = {
      filename: "patients.csv",
      rowCount: 10,
      invalidCount: 2,
      skippedCount: 1,
      columnMapping: {
        fullName: "Name",
        phone: "Phone",
        lastVisit: "Last Visit",
        procedure: "Procedure",
      },
    }

    expect(StartPatientImportInput.safeParse(input).success).toBe(true)
    expect(
      StartPatientImportInput.safeParse({ ...input, invalidCount: 8, skippedCount: 3 })
        .success,
    ).toBe(false)
  })
})
