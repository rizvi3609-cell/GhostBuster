import type { ReactNode } from "react"

type EmptyStateProps = Readonly<{
  description: string
  icon?: ReactNode
  title: string
}>

export function EmptyState({ description, icon, title }: EmptyStateProps) {
  return (
    <section className="rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-sunken text-fg-muted">
        {icon ?? <span aria-hidden="true">—</span>}
      </div>
      <h2 className="mt-4 text-lg font-semibold text-fg">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-base text-fg-muted">{description}</p>
    </section>
  )
}
