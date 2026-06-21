import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      "./vitest.parallel.config.ts",
      "./vitest.serial.config.ts",
      "./vitest.spacetimedb-real.config.ts",
    ],
  },
})
