import { defineProject } from "vitest/config"
import { baseConfig } from "./vitest.shared"

export default defineProject({
  ...baseConfig,
  test: {
    name: "serial",
    include: ["./test/**/*.serial.{test,spec}.{ts,tsx,mts,cts}"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
})
