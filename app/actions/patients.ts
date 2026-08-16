"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { withStaffAuth } from "@/lib/auth"
import {
  FinishPatientImportInput,
  ImportCountsSchema,
  ImportPatientBatchInput,
  PreviewPatientPhonesInput,
  StartPatientImportInput,
} from "@/lib/schemas"
import { db } from "@/lib/supabase/server"

const ImportBatchId = z.object({ id: z.string().uuid() })
const BatchCounts = z.object({
  inserted_count: z.number().int().nonnegative(),
  updated_count: z.number().int().nonnegative(),
  skipped_count: z.number().int().nonnegative(),
})

type ActionErrorCode = "INVALID_INPUT" | "DATABASE_ERROR"

type ActionFailure = Readonly<{
  ok: false
  error: string
  code: ActionErrorCode
}>

function invalidInput(): ActionFailure {
  return {
    ok: false,
    error: "The import data is invalid. Review the file and try again.",
    code: "INVALID_INPUT",
  }
}

function databaseError(): ActionFailure {
  return {
    ok: false,
    error: "The import could not be saved. Try again.",
    code: "DATABASE_ERROR",
  }
}

export const previewPatientPhones = withStaffAuth(async (_context, raw: unknown) => {
  const parsed = PreviewPatientPhonesInput.safeParse(raw)
  if (!parsed.success) return invalidInput()

  const { data, error } = await db
    .from("patients")
    .select("phone_number")
    .in("phone_number", parsed.data.phones)

  if (error) return databaseError()

  const rows = z.array(z.object({ phone_number: z.string() })).safeParse(data)
  if (!rows.success) return databaseError()

  return {
    ok: true as const,
    data: { existingPhones: rows.data.map((row) => row.phone_number) },
  }
})

export const startPatientImport = withStaffAuth(async (context, raw: unknown) => {
  const parsed = StartPatientImportInput.safeParse(raw)
  if (!parsed.success) return invalidInput()

  const { data, error } = await db
    .from("import_batches")
    .insert({
      imported_by: context.staff.id,
      filename: parsed.data.filename,
      row_count: parsed.data.rowCount,
      inserted_count: 0,
      updated_count: 0,
      skipped_count: parsed.data.skippedCount,
      invalid_count: parsed.data.invalidCount,
      column_mapping: parsed.data.columnMapping,
    })
    .select("id")
    .single()

  if (error) return databaseError()

  const batch = ImportBatchId.safeParse(data)
  if (!batch.success) return databaseError()

  return {
    ok: true as const,
    data: { importBatchId: batch.data.id },
  }
})

export const importPatientBatch = withStaffAuth(async (context, raw: unknown) => {
  const parsed = ImportPatientBatchInput.safeParse(raw)
  if (!parsed.success) return invalidInput()

  const { data, error } = await db.rpc("import_patient_batch", {
    p_import_batch_id: parsed.data.importBatchId,
    p_imported_by: context.staff.id,
    p_batch_number: parsed.data.batchNumber,
    p_rows: parsed.data.rows,
  })

  if (error) return databaseError()

  const counts = z.array(BatchCounts).length(1).safeParse(data)
  if (!counts.success) return databaseError()

  return { ok: true as const, data: counts.data[0] }
})

export const finishPatientImport = withStaffAuth(async (context, raw: unknown) => {
  const parsed = FinishPatientImportInput.safeParse(raw)
  if (!parsed.success) return invalidInput()

  const { data, error } = await db.rpc("finalize_patient_import", {
    p_import_batch_id: parsed.data.importBatchId,
    p_imported_by: context.staff.id,
  })

  if (error) return databaseError()

  const counts = z.array(ImportCountsSchema).length(1).safeParse(data)
  if (!counts.success) return databaseError()

  revalidatePath("/patients")
  return { ok: true as const, data: counts.data[0] }
})
