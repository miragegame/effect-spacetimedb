import { configDefaults, defineProject } from "vitest/config"
import { baseConfig, nativePackageTestPatterns } from "./vitest.shared.ts"

export default defineProject({
  ...baseConfig,
  test: {
    globalSetup: ["./vitest.self-link.ts"],
    name: "serial",
    include: ["./test/**/*.serial.{test,spec}.{ts,tsx,mts,cts}"],
    exclude: [...configDefaults.exclude, ...nativePackageTestPatterns],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
})
