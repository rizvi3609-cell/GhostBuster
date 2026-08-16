import { Skeleton } from "@/components/ui/skeleton"

export default function PatientsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-36" />
          <Skeleton className="mt-2 h-5 w-64" />
        </div>
        <Skeleton className="h-11 w-32" />
      </div>
      <Skeleton className="h-11 w-full" />
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <Skeleton className="h-12 rounded-none" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="mx-4 my-3 h-10" />
        ))}
      </div>
    </div>
  )
}
