import { LoginForm } from "@/components/auth/login-form"
import { env } from "@/lib/env"

type LoginPageProps = Readonly<{
  searchParams: Promise<{ next?: string | string[] }>
}>

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams
  const redirectTo = typeof next === "string" ? next : "/dashboard"

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <section
        aria-labelledby="login-heading"
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg sm:p-8"
      >
        <div className="flex size-12 items-center justify-center rounded-xl bg-brand-subtle text-brand">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M8.2 3.5c1.5 0 2.2.8 3.8.8s2.3-.8 3.8-.8c2.4 0 4.2 2 4.2 4.5 0 2.2-1.2 3.7-1.8 5.7-.8 2.8-1.2 6.8-3.2 6.8-1.4 0-1.4-3.6-3-3.6s-1.6 3.6-3 3.6c-2 0-2.4-4-3.2-6.8C5.2 11.7 4 10.2 4 8c0-2.5 1.8-4.5 4.2-4.5Z" />
          </svg>
        </div>

        <p className="mt-6 text-sm font-medium text-brand">{env.CLINIC_NAME}</p>
        <h1 id="login-heading" className="mt-1 text-2xl font-semibold tracking-tight text-fg">
          Sign in to Ghost-Buster
        </h1>
        <p className="mt-2 text-base text-fg-muted">
          Use your clinic staff account to continue.
        </p>

        <LoginForm redirectTo={redirectTo} />
      </section>
    </main>
  )
}
