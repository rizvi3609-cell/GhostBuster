import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"

  return {
    createServerClient: vi.fn(),
    getUser: vi.fn(),
  }
})

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}))

import { middleware } from "./middleware"

describe("route protection middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: mocks.getUser },
    })
  })

  it("redirects a signed-out dashboard request to login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const request = new NextRequest("https://app.example.test/dashboard?view=active")

    const response = await middleware(request)
    const location = new URL(response.headers.get("location") ?? "")

    expect(response.status).toBe(307)
    expect(location.pathname).toBe("/login")
    expect(location.searchParams.get("next")).toBe("/dashboard?view=active")
  })

  it("allows the login route without a session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })

    const response = await middleware(
      new NextRequest("https://app.example.test/login"),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
  })

  it("allows protected routes with a verified session", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "verified-user" } },
      error: null,
    })

    const response = await middleware(
      new NextRequest("https://app.example.test/patients"),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
  })

  it("redirects a signed-in login request to the dashboard", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "verified-user" } },
      error: null,
    })

    const response = await middleware(
      new NextRequest("https://app.example.test/login?next=/patients"),
    )

    expect(response.status).toBe(307)
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/dashboard",
    )
  })

  it("fails closed when session verification throws", async () => {
    mocks.getUser.mockRejectedValue(new Error("network"))

    const response = await middleware(
      new NextRequest("https://app.example.test/settings"),
    )

    expect(response.status).toBe(307)
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login")
  })
})
