"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"

import { loginAction, type LoginState } from "@/app/actions/auth"

const initialState: LoginState = { error: null }

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 py-3 font-medium text-white shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  )
}

type LoginFormProps = Readonly<{
  redirectTo: string
}>

export function LoginForm({ redirectTo }: LoginFormProps) {
  const [state, action] = useActionState(loginAction, initialState)

  return (
    <form action={action} className="mt-8 space-y-5">
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div className="space-y-2">
        <label htmlFor="email" className="block font-medium text-fg">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          aria-describedby={state.error ? "login-error" : undefined}
          className="min-h-12 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-fg shadow-sm outline-none transition-colors placeholder:text-fg-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          placeholder="you@clinic.com"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="block font-medium text-fg">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={200}
          required
          aria-describedby={state.error ? "login-error" : undefined}
          className="min-h-12 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-fg shadow-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {state.error ? (
        <p
          id="login-error"
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  )
}
