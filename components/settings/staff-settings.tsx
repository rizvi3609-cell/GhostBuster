"use client"

import { useState, useTransition } from "react"

import { inviteStaffMember, updateStaffMember } from "@/app/actions/settings"
import type { StaffRole } from "@/lib/auth"

export type StaffSetting = Readonly<{
  active: boolean
  email: string
  fullName: string | null
  id: string
  role: StaffRole
}>

function StaffRow({ member }: Readonly<{ member: StaffSetting }>) {
  const [role, setRole] = useState(member.role)
  const [active, setActive] = useState(member.active)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(): void {
    startTransition(async () => {
      const result = await updateStaffMember({
        id: member.id,
        email: member.email,
        fullName: member.fullName ?? "",
        role,
        active,
      })
      setMessage(result.ok ? "Saved" : result.error)
    })
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[1fr_150px_auto] sm:items-end">
      <div>
        <p className="font-medium text-fg">{member.fullName ?? member.email}</p>
        <p className="mt-1 text-sm text-fg-muted">{member.email}</p>
      </div>
      <label className="text-xs text-fg-muted">Role
        <select value={role} onChange={(event) => setRole(event.target.value as StaffRole)} className="mt-1 min-h-10 w-full rounded-lg border border-border-strong bg-surface px-2 text-sm text-fg">
          <option value="OWNER">Owner</option>
          <option value="ADMIN">Admin</option>
          <option value="FRONT_DESK">Front desk</option>
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-10 items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="size-5 accent-brand" /> Active
        </label>
        <button type="button" disabled={pending} onClick={save} className="min-h-10 rounded-lg border border-border-strong px-3 text-sm font-medium text-fg disabled:opacity-50">Save</button>
        {message ? <span className="text-xs text-fg-muted">{message}</span> : null}
      </div>
    </div>
  )
}

export function StaffSettings({ members }: Readonly<{ members: readonly StaffSetting[] }>) {
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [role, setRole] = useState<StaffRole>("FRONT_DESK")
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function invite(): void {
    startTransition(async () => {
      const result = await inviteStaffMember({ email, fullName, role })
      setMessage(result.ok ? "Invitation sent." : result.error)
      if (result.ok) {
        setEmail("")
        setFullName("")
      }
    })
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-fg">Staff</h2>
        <p className="mt-1 text-sm text-fg-muted">Only owners can invite, change roles, or deactivate staff.</p>
      </div>
      <div className="space-y-3">
        {members.map((member) => <StaffRow key={member.id} member={member} />)}
      </div>
      <div className="rounded-lg border border-dashed border-border-strong p-4">
        <h3 className="font-semibold text-fg">Invite staff member</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="staff@clinic.com" aria-label="Staff email" className="min-h-11 rounded-lg border border-border-strong px-3" />
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Full name" aria-label="Staff full name" className="min-h-11 rounded-lg border border-border-strong px-3" />
          <select value={role} onChange={(event) => setRole(event.target.value as StaffRole)} aria-label="Staff role" className="min-h-11 rounded-lg border border-border-strong bg-surface px-3">
            <option value="FRONT_DESK">Front desk</option>
            <option value="ADMIN">Admin</option>
            <option value="OWNER">Owner</option>
          </select>
        </div>
        <button type="button" disabled={pending || !email.trim()} onClick={invite} className="mt-3 min-h-10 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50">{pending ? "Sending…" : "Send invitation"}</button>
        {message ? <span className="ml-3 text-sm text-fg-muted">{message}</span> : null}
      </div>
    </section>
  )
}
