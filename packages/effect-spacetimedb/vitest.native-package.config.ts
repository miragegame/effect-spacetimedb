import { defineProject } from "vitest/config"
import { nativePackageConfig, nativePackageTestPatterns } from "./vitest.shared"

export default defineProject({
  ...nativePackageConfig,
  test: {
    name: "native-package",
    include: nativePackageTestPatterns,
    server: {
      deps: {
        inline: ["spacetimedb"],
      },
    },
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
