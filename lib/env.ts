import "server-only"

import { validateServerEnv } from "@/lib/env-core"

export const env = validateServerEnv(process.env)
