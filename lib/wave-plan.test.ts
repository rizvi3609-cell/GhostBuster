import { describe, expect, it } from "vitest"

import { nextWave, parseWavePlan, type WavePlan } from "./wave-plan"

const plan: WavePlan = [
  { size: 3, delay_min: 7 },
  { size: 5, delay_min: 10 },
]

describe("parseWavePlan", () => {
  it("parses a valid wave plan", () => {
    expect(parseWavePlan(plan)).toEqual({ ok: true, plan })
  })

  it("rejects a non-array and an empty plan", () => {
    const nonArray = parseWavePlan({ size: 3, delay_min: 7 })
    const empty = parseWavePlan([])

    expect(nonArray.ok).toBe(false)
    expect(nonArray).toMatchObject({ reason: expect.stringContaining("wave_plan") })
    expect(empty.ok).toBe(false)
  })

  it.each([
    [[{ size: 0, delay_min: 7 }], "0.size"],
    [[{ size: 1.5, delay_min: 7 }], "0.size"],
    [[{ size: 3, delay_min: 0 }], "0.delay_min"],
    [[{ size: 3, delay_min: 1.5 }], "0.delay_min"],
    [[{ size: 3, delay_min: 7, extra: true }], "0"],
  ])("rejects malformed plan %#", (input, path) => {
    const result = parseWavePlan(input)

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: expect.stringContaining(path) })
  })
})

describe("nextWave", () => {
  it("returns the next wave using the zero-based current-wave count", () => {
    expect(nextWave(plan, 0)).toEqual({ size: 3, delayMin: 7 })
    expect(nextWave(plan, 1)).toEqual({ size: 5, delayMin: 10 })
  })

  it("returns null when the plan is exhausted", () => {
    expect(nextWave(plan, 2)).toBeNull()
  })

  it("returns null for an invalid current wave", () => {
    expect(nextWave(plan, -1)).toBeNull()
    expect(nextWave(plan, 0.5)).toBeNull()
  })
})
