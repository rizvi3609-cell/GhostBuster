import { signOutAction } from "@/app/actions/auth"

export function AccessDenied() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <section className="w-full max-w-lg rounded-xl border border-danger/25 bg-surface p-8 text-center shadow-md">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <span aria-hidden="true" className="text-xl font-bold">
            !
          </span>
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-fg">Staff access is unavailable</h1>
        <p className="mt-3 text-base text-fg-muted">
          Your login is valid, but this account is not an active clinic staff account. Ask an
          administrator to restore access.
        </p>
        <form action={signOutAction} className="mt-6">
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-brand px-5 py-2 font-medium text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Sign out
          </button>
        </form>
      </section>
    </main>
  )
}
