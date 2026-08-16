type PhoneDisplayProps = Readonly<{
  phone: string
  reveal?: boolean
}>

export function PhoneDisplay({ phone, reveal = false }: PhoneDisplayProps) {
  const display = reveal ? phone : `•••${phone.slice(-4)}`
  return <span className="font-mono text-sm tabular-nums">{display}</span>
}
