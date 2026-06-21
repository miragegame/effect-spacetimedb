import { defineProject } from "vitest/config"
import {
  realServerTestPatterns,
  realSpacetimeServerConfig,
} from "./vitest.shared"

export default defineProject({
  ...realSpacetimeServerConfig,
  test: {
    name: "spacetimedb-real",
    include: realServerTestPatterns,
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
