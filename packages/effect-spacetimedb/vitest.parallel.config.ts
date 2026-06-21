import { configDefaults, defineProject } from "vitest/config"
import {
  baseConfig,
  liveTestPatterns,
  realServerTestPatterns,
} from "./vitest.shared"

export default defineProject({
  ...baseConfig,
  test: {
    name: "parallel",
    hookTimeout: 10_000,
    testTimeout: 5_000,
    include: [
      "./test/**/*.{test,spec}.{ts,tsx,mts,cts}",
      "./test/**/__tests__/**/*.{ts,tsx,mts,cts}",
    ],
    exclude: [
      ...configDefaults.exclude,
      "./test/**/*.serial.{test,spec}.{ts,tsx,mts,cts}",
      ...liveTestPatterns,
      ...realServerTestPatterns,
    ],
  },
})
