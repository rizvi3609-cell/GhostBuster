import { createHmac, timingSafeEqual } from "node:crypto"

export function computeTwilioSignature(
  authToken: string,
  webhookUrl: string,
  parameters: Readonly<Record<string, string>>,
): string {
  const payload = Object.keys(parameters)
    .sort()
    .reduce((value, key) => `${value}${key}${parameters[key]}`, webhookUrl)

  return createHmac("sha1", authToken).update(payload).digest("base64")
}

export function verifyTwilioSignature(
  authToken: string,
  webhookUrl: string,
  parameters: Readonly<Record<string, string>>,
  suppliedSignature: string,
): boolean {
  const expected = computeTwilioSignature(authToken, webhookUrl, parameters)
  const supplied = Buffer.from(suppliedSignature)
  const calculated = Buffer.from(expected)
  return supplied.length === calculated.length && timingSafeEqual(supplied, calculated)
}
