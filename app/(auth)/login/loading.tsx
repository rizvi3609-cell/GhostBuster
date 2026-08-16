export default function LoginLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-md animate-pulse rounded-xl border border-border bg-surface p-8 shadow-lg">
        <div className="size-12 rounded-xl bg-surface-sunken" />
        <div className="mt-6 h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-3 h-8 w-64 rounded bg-surface-sunken" />
        <div className="mt-3 h-5 w-72 rounded bg-surface-sunken" />
        <div className="mt-8 h-12 rounded-lg bg-surface-sunken" />
        <div className="mt-5 h-12 rounded-lg bg-surface-sunken" />
        <div className="mt-6 h-12 rounded-lg bg-brand-subtle" />
      </div>
    </main>
  )
}
