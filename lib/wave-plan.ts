import { z } from "zod"

export const WaveSchema = z
  .object({
    size: z.number().int().positive(),
    delay_min: z.number().int().positive(),
  })
  .strict()

export const WavePlanSchema = z.array(WaveSchema).min(1)

export type WavePlan = z.infer<typeof WavePlanSchema>
export type NextWave = Readonly<{
  size: number
  delayMin: number
}>

export type WavePlanParseResult =
  | { ok: true; plan: WavePlan }
  | { ok: false; reason: string }

export function parseWavePlan(input: unknown): WavePlanParseResult {
  const parsed = WavePlanSchema.safeParse(input)

  if (parsed.success) return { ok: true, plan: parsed.data }

  const reason = parsed.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "wave_plan"
      return `${path}: ${issue.message}`
    })
    .join("; ")

  return { ok: false, reason }
}

export function nextWave(plan: WavePlan, currentWave: number): NextWave | null {
  if (!Number.isInteger(currentWave) || currentWave < 0) return null

  const wave = plan[currentWave]
  if (!wave) return null

  return { size: wave.size, delayMin: wave.delay_min }
}
