import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createAuthServerClient: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock("server-only", () => ({}))

vi.mock("./supabase/auth-server", () => ({
  createAuthServerClient: mocks.createAuthServerClient,
}))

vi.mock("./supabase/server", () => ({
  db: { from: mocks.from },
}))

import { resolveStaffAuth, withStaffAuth } from "./auth"

const userId = "00000000-0000-4000-8000-000000000001"
const staffRow = {
  id: userId,
  email: "staff@example.test",
  full_name: "Test Staff",
  role: "FRONT_DESK",
  active: true,
}

function arrangeStaffQuery(): void {
  const secondEq = vi.fn(() => ({ maybeSingle: mocks.maybeSingle }))
  const firstEq = vi.fn(() => ({ eq: secondEq }))
  const select = vi.fn(() => ({ eq: firstEq }))
  mocks.from.mockReturnValue({ select })
}

describe("withStaffAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    arrangeStaffQuery()
    mocks.createAuthServerClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
    })
  })

  it("returns UNAUTHORIZED without touching the database when there is no session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const handler = vi.fn()
    const action = withStaffAuth(handler)

    await expect(action("input")).resolves.toEqual({
      ok: false,
      error: "You must sign in to continue.",
      code: "UNAUTHORIZED",
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it("fails closed without a database read when auth verification errors", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("auth") })

    await expect(resolveStaffAuth()).resolves.toMatchObject({
      ok: false,
      code: "UNAUTHORIZED",
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("fails closed when the auth client throws", async () => {
    mocks.getUser.mockRejectedValue(new Error("network"))

    await expect(resolveStaffAuth()).resolves.toMatchObject({
      ok: false,
      code: "UNAUTHORIZED",
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("passes a typed active-staff context to the handler", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: staffRow, error: null })
    const handler = vi.fn(async (context, input: string) => ({
      ok: true as const,
      data: { context, input },
    }))
    const action = withStaffAuth(handler)

    const result = await action("payload")

    expect(result).toMatchObject({
      ok: true,
      data: {
        context: {
          userId,
          staff: {
            id: userId,
            email: "staff@example.test",
            fullName: "Test Staff",
            role: "FRONT_DESK",
          },
        },
        input: "payload",
      },
    })
    expect(mocks.from).toHaveBeenCalledWith("staff")
    expect(handler).toHaveBeenCalledOnce()
  })

  it("rejects missing, inactive, or malformed staff records", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(resolveStaffAuth()).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    })

    mocks.maybeSingle.mockResolvedValue({
      data: { ...staffRow, active: false },
      error: null,
    })
    await expect(resolveStaffAuth()).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    })
  })

  it("enforces the requested staff roles", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: staffRow, error: null })

    await expect(
      resolveStaffAuth({ allowedRoles: ["OWNER", "ADMIN"] }),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" })
  })

  it("returns INTERNAL_ERROR when the staff lookup fails or throws", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: null, error: new Error("database") })

    await expect(resolveStaffAuth()).resolves.toMatchObject({
      ok: false,
      code: "INTERNAL_ERROR",
    })

    mocks.maybeSingle.mockRejectedValue(new Error("database"))
    await expect(resolveStaffAuth()).resolves.toMatchObject({
      ok: false,
      code: "INTERNAL_ERROR",
    })
  })

  it("converts handler exceptions into an error value", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: staffRow, error: null })
    const action = withStaffAuth(async () => {
      throw new Error("handler")
    })

    await expect(action()).resolves.toMatchObject({
      ok: false,
      code: "INTERNAL_ERROR",
    })
  })
})
