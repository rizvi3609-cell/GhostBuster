import { describe, expect, it } from "vitest"

import { classifyInbound } from "./keywords"

describe("classifyInbound", () => {
  it.each(["yes", "Yes!", " Y ", "yep", "yeah.", "claim", "1"])(
    "classifies %s as affirmative",
    (body) => {
      expect(classifyInbound(body)).toBe("AFFIRMATIVE")
    },
  )

  it.each([
    "stop",
    "STOP.",
    "stopall",
    "unsubscribe",
    "cancel",
    "end",
    "quit",
  ])("classifies %s as opt-out", (body) => {
    expect(classifyInbound(body)).toBe("OPT_OUT")
  })

  it.each(["start", "UNSTOP!"])("classifies %s as opt-in", (body) => {
    expect(classifyInbound(body)).toBe("OPT_IN")
  })

  it.each(["help", "INFO..."])("classifies %s as help", (body) => {
    expect(classifyInbound(body)).toBe("HELP")
  })

  it.each(["help me", "help me please", "yes please", "stopping", "", "!YES"])(
    "classifies non-bare command %s as other",
    (body) => {
      expect(classifyInbound(body)).toBe("OTHER")
    },
  )
})
