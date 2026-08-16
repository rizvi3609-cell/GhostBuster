import Link from "next/link"
import { z } from "zod"

import { ConsentBadge } from "@/components/patients/consent-badge"
import { PhoneDisplay } from "@/components/patients/phone-display"
import { EmptyState } from "@/components/ui/empty-state"
import { db } from "@/lib/supabase/server"

const pageSize = 50

const PatientRow = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  phone_number: z.string(),
  consent_status: z.enum(["UNKNOWN", "GRANTED", "REVOKED"]),
  opted_out: z.boolean(),
  reliability_score: z.number().int().min(0).max(100),
  last_visit_date: z.string().nullable(),
})

const SearchParams = z.object({
  q: z.string().trim().max(100).catch(""),
  page: z.coerce.number().int().positive().catch(1),
  filter: z.enum(["ALL", "ELIGIBLE", "OPTED_OUT", "NO_CONSENT", "DUE_RECALL"]).catch("ALL"),
})

type PatientsPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>
}>

const filters = [
  ["ALL", "All"],
  ["ELIGIBLE", "Eligible"],
  ["OPTED_OUT", "Opted out"],
  ["NO_CONSENT", "No consent"],
  ["DUE_RECALL", "Due for recall"],
] as const

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function patientUrl(q: string, filter: string, page: number): string {
  const params = new URLSearchParams()
  if (q) params.set("q", q)
  if (filter !== "ALL") params.set("filter", filter)
  if (page > 1) params.set("page", String(page))
  const query = params.toString()
  return query ? `/patients?${query}` : "/patients"
}

function displayDate(value: string | null): string {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

export default async function PatientsPage({ searchParams }: PatientsPageProps) {
  const raw = await searchParams
  const params = SearchParams.parse({
    q: firstValue(raw.q),
    page: firstValue(raw.page),
    filter: firstValue(raw.filter),
  })

  const from = (params.page - 1) * pageSize
  const to = from + pageSize - 1

  let query = db
    .from("patients")
    .select(
      "id, full_name, phone_number, consent_status, opted_out, reliability_score, last_visit_date",
      { count: "exact" },
    )
    .order("full_name", { ascending: true })
    .range(from, to)

  if (params.q) query = query.ilike("full_name", `%${escapeLike(params.q)}%`)
  if (params.filter === "ELIGIBLE") {
    query = query.eq("opted_out", false).eq("consent_status", "GRANTED")
  } else if (params.filter === "OPTED_OUT") {
    query = query.eq("opted_out", true)
  } else if (params.filter === "NO_CONSENT") {
    query = query.neq("consent_status", "GRANTED")
  } else if (params.filter === "DUE_RECALL") {
    const { data: config, error: configError } = await db
      .from("clinic_config")
      .select("recall_threshold_days")
      .eq("id", true)
      .single()
    const parsedConfig = z
      .object({ recall_threshold_days: z.number().int().positive() })
      .safeParse(config)
    if (configError || !parsedConfig.success) throw new Error("Unable to load recall settings")

    const cutoff = new Date()
    cutoff.setUTCDate(cutoff.getUTCDate() - parsedConfig.data.recall_threshold_days)
    query = query
      .eq("opted_out", false)
      .lte("last_visit_date", cutoff.toISOString().slice(0, 10))
  }

  const { data, error, count } = await query
  if (error) throw new Error("Unable to load patients")

  const rows = z.array(PatientRow).safeParse(data)
  if (!rows.success) throw new Error("Patient data is invalid")

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Patients</h1>
          <p className="mt-1 text-base text-fg-muted">
            {total.toLocaleString()} patient{total === 1 ? "" : "s"} found
          </p>
        </div>
        <Link
          href="/patients/import"
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 py-2 font-medium text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Import CSV
        </Link>
      </header>

      <form method="get" className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="patient-search" className="sr-only">Search patients by name</label>
        <input
          id="patient-search"
          name="q"
          type="search"
          defaultValue={params.q}
          placeholder="Search patient names"
          className="min-h-11 flex-1 rounded-lg border border-border-strong bg-surface px-3 text-base text-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {params.filter !== "ALL" ? <input type="hidden" name="filter" value={params.filter} /> : null}
        <button
          type="submit"
          className="min-h-11 rounded-lg border border-border-strong bg-surface px-5 py-2 font-medium text-fg hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-brand"
        >
          Search
        </button>
      </form>

      <nav aria-label="Patient filters" className="flex flex-wrap gap-2">
        {filters.map(([value, label]) => (
          <Link
            key={value}
            href={patientUrl(params.q, value, 1)}
            aria-current={params.filter === value ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium ${
              params.filter === value
                ? "border-brand bg-brand-subtle text-brand"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {rows.data.length === 0 ? (
        <EmptyState
          title={params.q || params.filter !== "ALL" ? "No matching patients" : "No patients yet"}
          description={params.q || params.filter !== "ALL" ? "Try another search or filter." : "Import a CSV to build the clinic waitlist."}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[880px] text-left text-sm">
            <caption className="sr-only">Clinic waitlist patients</caption>
            <thead className="bg-surface-sunken text-fg-muted">
              <tr>
                {[
                  "Name",
                  "Phone",
                  "Consent",
                  "Opted out",
                  "Reliability",
                  "Last visit",
                ].map((heading) => (
                  <th key={heading} scope="col" className="px-4 py-3 font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.data.map((patient) => (
                <tr key={patient.id} className="hover:bg-surface-sunken/60">
                  <td className="px-4 py-3 font-medium text-fg">{patient.full_name}</td>
                  <td className="px-4 py-3 text-fg-muted"><PhoneDisplay phone={patient.phone_number} /></td>
                  <td className="px-4 py-3"><ConsentBadge status={patient.consent_status} /></td>
                  <td className="px-4 py-3 text-fg-muted">{patient.opted_out ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-20 overflow-hidden rounded-full bg-border">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${patient.reliability_score}%` }} />
                      </div>
                      <span className="tabular-nums text-fg-muted">{patient.reliability_score}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{displayDate(patient.last_visit_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 text-sm text-fg-muted">
        <p>Page {params.page} of {totalPages}</p>
        <div className="flex gap-2">
          <Link
            href={patientUrl(params.q, params.filter, Math.max(1, params.page - 1))}
            aria-disabled={params.page <= 1}
            className={`inline-flex min-h-10 items-center rounded-lg border border-border px-4 ${params.page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-surface-sunken"}`}
          >
            Previous
          </Link>
          <Link
            href={patientUrl(params.q, params.filter, params.page + 1)}
            aria-disabled={params.page >= totalPages}
            className={`inline-flex min-h-10 items-center rounded-lg border border-border px-4 ${params.page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-surface-sunken"}`}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  )
}
