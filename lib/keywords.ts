export type InboundClassification =
  | "AFFIRMATIVE"
  | "OPT_OUT"
  | "OPT_IN"
  | "HELP"
  | "OTHER"

const affirmativeKeywords = new Set(["YES", "Y", "YEP", "YEAH", "CLAIM", "1"])
const optOutKeywords = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
])
const optInKeywords = new Set(["START", "UNSTOP"])
const helpKeywords = new Set(["HELP", "INFO"])

function normalizeKeyword(body: string): string {
  return body.trim().toUpperCase().replace(/[.!?,;:]+$/g, "").trim()
}

export function classifyInbound(body: string): InboundClassification {
  const keyword = normalizeKeyword(body)

  if (affirmativeKeywords.has(keyword)) return "AFFIRMATIVE"
  if (optOutKeywords.has(keyword)) return "OPT_OUT"
  if (optInKeywords.has(keyword)) return "OPT_IN"
  if (helpKeywords.has(keyword)) return "HELP"

  return "OTHER"
}
