import { z } from "zod"

const e164Pattern = /^\+[1-9]\d{7,14}$/
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
const procedurePattern = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export const ColumnMappingSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(1).max(200),
    lastVisit: z.string().trim().min(1).max(200),
    procedure: z.string().trim().min(1).max(200),
  })
  .strict()
  .refine((mapping) => new Set(Object.values(mapping)).size === 4, {
    message: "Each patient field must use a different CSV column.",
  })

export type ColumnMapping = z.infer<typeof ColumnMappingSchema>

export const PatientImportRowSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200),
    phone_number: z.string().regex(e164Pattern),
    last_visit_date: z
      .string()
      .regex(isoDatePattern)
      .refine(isCalendarDate, "Invalid calendar date")
      .nullable(),
    preferred_procedures: z
      .array(z.string().regex(procedurePattern).max(80))
      .max(20),
  })
  .strict()

export type PatientImportRow = z.infer<typeof PatientImportRowSchema>

export const PreviewPatientPhonesInput = z
  .object({
    phones: z.array(z.string().regex(e164Pattern)).min(1).max(500),
  })
  .strict()
  .refine((input) => new Set(input.phones).size === input.phones.length, {
    message: "Phone numbers must be unique within a preview batch.",
  })

export const StartPatientImportInput = z
  .object({
    filename: z.string().trim().min(1).max(255),
    rowCount: z.number().int().nonnegative().max(100_000),
    invalidCount: z.number().int().nonnegative().max(100_000),
    skippedCount: z.number().int().nonnegative().max(100_000),
    columnMapping: ColumnMappingSchema,
  })
  .strict()
  .refine(
    (input) => input.invalidCount + input.skippedCount <= input.rowCount,
    { message: "Invalid and skipped counts cannot exceed the row count." },
  )

export const ImportPatientBatchInput = z
  .object({
    importBatchId: z.string().uuid(),
    batchNumber: z.number().int().nonnegative(),
    rows: z.array(PatientImportRowSchema).min(1).max(500),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.rows.map((row) => row.phone_number)).size === input.rows.length,
    { message: "Phone numbers must be unique within an import batch." },
  )

export const FinishPatientImportInput = z
  .object({ importBatchId: z.string().uuid() })
  .strict()

export const ImportCountsSchema = z.object({
  row_count: z.number().int().nonnegative(),
  inserted_count: z.number().int().nonnegative(),
  updated_count: z.number().int().nonnegative(),
  skipped_count: z.number().int().nonnegative(),
  invalid_count: z.number().int().nonnegative(),
})

export type ImportCounts = z.infer<typeof ImportCountsSchema>

export const CampaignPreviewInput = z
  .object({ templateId: z.string().uuid() })
  .strict()

export const CreateCampaignInput = z
  .object({
    templateId: z.string().uuid(),
    appointmentLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    wavePlan: z.unknown().optional(),
  })
  .strict()

export const CampaignIdInput = z
  .object({ campaignId: z.string().uuid() })
  .strict()

export const CancelCampaignInput = z
  .object({
    campaignId: z.string().uuid(),
    reason: z.string().trim().min(1).max(200),
  })
  .strict()

export const ManualAssignInput = z
  .object({
    campaignId: z.string().uuid(),
    patientId: z.string().uuid(),
  })
  .strict()
