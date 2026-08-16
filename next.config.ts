import type { NextConfig } from "next"

import { validateServerEnv } from "./lib/env-core"

validateServerEnv(process.env)

const nextConfig: NextConfig = {
  poweredByHeader: false,
}

export default nextConfig
