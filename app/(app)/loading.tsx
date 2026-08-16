import { Skeleton } from "@/components/ui/skeleton"

export default function AppLoading() {
  return (
    <div className="min-h-screen bg-bg md:pl-20 lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-20 border-r border-border bg-surface p-4 md:block lg:w-60">
        <Skeleton className="size-10" />
        <div className="mt-10 space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
      </aside>
      <header className="min-h-16 border-b border-border bg-surface px-6 py-3">
        <Skeleton className="h-10 w-48" />
      </header>
      <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </main>
    </div>
  )
}
