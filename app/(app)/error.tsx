"use client"

type AppErrorProps = Readonly<{
  error: Error & { digest?: string }
  reset: () => void
}>

export default function AppError({ reset }: AppErrorProps) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <section className="w-full max-w-lg rounded-xl border border-danger/25 bg-surface p-8 text-center shadow-md">
        <h1 className="text-2xl font-semibold text-fg">Couldn&apos;t load this page</h1>
        <p className="mt-3 text-base text-fg-muted">
          Check your connection and try again. If this continues, ask the clinic administrator
          to check Supabase.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 min-h-11 rounded-lg bg-brand px-5 py-2 font-medium text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Try again
        </button>
      </section>
    </main>
  )
}
