// Type-only import keeps Vitest's CLI-loaded coverage provider visible to dependency lint.
import type {} from "@vitest/coverage-v8"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      "./vitest.parallel.config.ts",
      "./vitest.serial.config.ts",
      "./vitest.native-package.config.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        // Test-support shim exported for consumers and aliased into tests; not product runtime code.
        "src/testing/**",
        // Covered by the serial/native-package project, which is out of the coverage run.
        "src/server-polyfills.ts",
      ],
      reporter: ["text", "text-summary", "html"],
      reportsDirectory: "coverage",
      thresholds: {
        // Stable 2026-06-26 baseline: statements 83.4, branches 70.9, functions 81.5, lines 83.4; thresholds are floor(metric) - 2.
        lines: 81,
        functions: 79,
        branches: 68,
        statements: 81,
      },
    },
  },
})
