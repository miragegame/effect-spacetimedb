import { defineConfig } from "vitest/config"
import { liveTestPatterns, nativePackageConfig } from "./vitest.shared"

// Tag definitions for this package's live tests. Tags let a runner select
// subsets (for example only tests that need local-mode resources).
const liveTestTagDefinitions = [
  {
    name: "local-only",
    description: "Tests that require local-mode resources.",
  },
  {
    name: "spacetimedb",
    description:
      "SpaceTimeDB-focused live tests. Combine with local-only for a concrete run.",
  },
] as const

export default defineConfig({
  ...nativePackageConfig,
  test: {
    name: "effect-spacetimedb-live",
    include: liveTestPatterns,
    setupFiles: ["./test/live/vitest.setup.ts"],
    hookTimeout: 300_000,
    testTimeout: 300_000,
    retry: 1,
    fileParallelism: false,
    strictTags: true,
    tags: [...liveTestTagDefinitions],
  },
})
