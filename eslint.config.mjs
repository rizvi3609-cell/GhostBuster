import { FlatCompat } from "@eslint/eslintrc"
import { dirname } from "path"
import { fileURLToPath } from "url"

const filename = fileURLToPath(import.meta.url)
const directory = dirname(filename)
const compat = new FlatCompat({ baseDirectory: directory })

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".cache/**",
      ".config/**",
      ".git/**",
      ".local/**",
      ".next/**",
      ".npm/**",
      "coverage/**",
      "next-env.d.ts",
      "node_modules/**",
      "uploads/**",
    ],
  },
]

export default eslintConfig
