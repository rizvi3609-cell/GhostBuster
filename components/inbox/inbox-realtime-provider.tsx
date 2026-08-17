"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { getUnreadInboxCount } from "@/app/actions/inbox"
import { getRealtimeClient } from "@/lib/supabase/client"

type InboxRealtimeContextValue = Readonly<{
  connected: boolean
  revision: number
  unreadCount: number
}>

const InboxRealtimeContext = createContext<InboxRealtimeContextValue | null>(null)

type InboxRealtimeProviderProps = Readonly<{
  children: ReactNode
  initialUnreadCount: number
}>

export function InboxRealtimeProvider({
  children,
  initialUnreadCount,
}: InboxRealtimeProviderProps) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [revision, setRevision] = useState(0)
  const [connected, setConnected] = useState(false)
  const connectedRef = useRef(false)

  const refresh = useCallback(async () => {
    const result = await getUnreadInboxCount()
    if (result.ok) setUnreadCount(result.data.count)
  }, [])

  useEffect(() => {
    let active = true
    const client = getRealtimeClient()
    const channel = client
      .channel("staff-inbox-shell")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "unhandled_inbox" },
        () => {
          if (!active) return
          setRevision((value) => value + 1)
          void refresh()
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "broadcast_campaigns" },
        () => {
          if (!active) return
          setRevision((value) => value + 1)
          window.dispatchEvent(new Event("ghostbuster:campaign-change"))
        },
      )
      .subscribe((status) => {
        if (!active) return
        const isConnected = status === "SUBSCRIBED"
        connectedRef.current = isConnected
        setConnected(isConnected)
        window.dispatchEvent(
          new CustomEvent("ghostbuster:realtime-status", {
            detail: { connected: isConnected },
          }),
        )
        if (!isConnected) void refresh()
      })

    const poll = window.setInterval(() => {
      if (!connectedRef.current) {
        setRevision((value) => value + 1)
        void refresh()
      }
    }, 15_000)

    return () => {
      active = false
      window.clearInterval(poll)
      void client.removeChannel(channel)
    }
  }, [refresh])

  return (
    <InboxRealtimeContext.Provider value={{ connected, revision, unreadCount }}>
      {children}
    </InboxRealtimeContext.Provider>
  )
}

export function useInboxRealtime(): InboxRealtimeContextValue {
  const value = useContext(InboxRealtimeContext)
  if (!value) throw new Error("useInboxRealtime must be used inside InboxRealtimeProvider")
  return value
}
