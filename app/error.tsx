"use client"

type RootErrorProps = Readonly<{
  error: Error & { digest?: string }
  reset: () => void
}>

export default function RootError({ reset }: RootErrorProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <section className="w-full max-w-lg rounded-xl border border-danger/25 bg-surface p-8 text-center shadow-md">
        <h1 className="text-2xl font-semibold text-fg">Ghost-Buster is unavailable</h1>
        <p className="mt-3 text-base text-fg-muted">
          Nothing was changed. Try loading the page again.
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
