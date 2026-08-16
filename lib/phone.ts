import { parsePhoneNumberWithError, type CountryCode } from "libphonenumber-js"

export type PhoneNormalizationFailure =
  | "EMPTY"
  | "EXTENSION_NOT_ALLOWED"
  | "INVALID_CHARACTERS"
  | "INVALID_COUNTRY"
  | "INVALID_PHONE"

export type PhoneNormalizationResult =
  | { ok: true; phone: string }
  | { ok: false; reason: PhoneNormalizationFailure }

const extensionPattern =
  /(?:\b(?:ext(?:ension)?|x)\.?\s*:?\s*\d+|;ext=\d+|#\s*\d+)\s*$/i
const permittedPhoneCharacters = /^\+?[\d\s().-]+$/

export function normalizeToE164(
  input: string,
  defaultCountry: CountryCode,
): PhoneNormalizationResult {
  const candidate = input.trim()

  if (candidate.length === 0) return { ok: false, reason: "EMPTY" }

  if (extensionPattern.test(candidate)) {
    return { ok: false, reason: "EXTENSION_NOT_ALLOWED" }
  }

  if (!permittedPhoneCharacters.test(candidate)) {
    return { ok: false, reason: "INVALID_CHARACTERS" }
  }

  try {
    const parsed = parsePhoneNumberWithError(candidate, defaultCountry)

    if (!parsed.isValid()) return { ok: false, reason: "INVALID_PHONE" }

    return { ok: true, phone: parsed.number }
  } catch (error) {
    if (String(error).endsWith("INVALID_COUNTRY")) {
      return { ok: false, reason: "INVALID_COUNTRY" }
    }

    return { ok: false, reason: "INVALID_PHONE" }
  }
}
