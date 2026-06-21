import { defineConfig } from "vitest/config"
import { liveTestPatterns, realSpacetimeServerConfig } from "./vitest.shared"

// Keep local tag names aligned with the repo live-test taxonomy without
// importing across package boundaries from this package-local Vitest config.
const liveTestTagDefinitions = [
  {
    name: "local-only",
    description: "Tests that require local-mode resources.",
  },
  {
    name: "spacetimedb",
    description:
      "SpaceTimeDB-focused live tests. Combine with local-only or cloud for a concrete run.",
  },
] as const

export default defineConfig({
  ...realSpacetimeServerConfig,
  test: {
    name: "effect-spacetimedb-live",
    include: liveTestPatterns,
    setupFiles: ["./test/live/vitest.setup.ts"],
    hookTimeout: 300_000,
    testTimeout: 300_000,
    fileParallelism: false,
    strictTags: true,
    tags: [...liveTestTagDefinitions],
  },
})
