type SkeletonProps = Readonly<{
  className?: string
}>

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-surface-sunken ${className}`}
    />
  )
}
