import { CsvImportWizard } from "@/components/patients/csv-import-wizard"

export default function PatientImportPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-brand">Patients</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">Import CSV</h1>
        <p className="mt-1 text-base text-fg-muted">
          Validate, map, and preview every row before changing the patient list.
        </p>
      </header>
      <CsvImportWizard />
    </div>
  )
}
