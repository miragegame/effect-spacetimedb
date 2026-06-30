// Type-only imports keep Stryker's CLI-loaded packages visible to dependency lint.
import type {} from "@stryker-mutator/core"
import type {} from "@stryker-mutator/vitest-runner"
import { configDefaults, defineConfig } from "vitest/config"
import {
  baseConfig,
  liveTestPatterns,
  nativePackageTestPatterns,
} from "./vitest.shared"

export default defineConfig({
  ...baseConfig,
  test: {
    name: "mutation",
    hookTimeout: 10_000,
    testTimeout: 5_000,
    // Intentionally kept in lock-step with the parallel project. Stryker drives
    // this standalone config directly instead of selecting a Vitest project.
    include: [
      "./test/**/*.{test,spec}.{ts,tsx,mts,cts}",
      "./test/**/__tests__/**/*.{ts,tsx,mts,cts}",
    ],
    exclude: [
      ...configDefaults.exclude,
      "./test/**/*.serial.{test,spec}.{ts,tsx,mts,cts}",
      ...liveTestPatterns,
      ...nativePackageTestPatterns,
    ],
  },
})
