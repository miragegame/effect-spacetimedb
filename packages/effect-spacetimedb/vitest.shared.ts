import * as path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const spacetimeSysStub = path.resolve(
  packageRoot,
  "src",
  "testing",
  "spacetime-sys.ts",
)

export const nativePackageTestPatterns = [
  "./test/native-package/**/*.{test,spec}.{ts,tsx,mts,cts}",
]

export const liveTestPatterns = [
  "./test/live/**/*.{test,spec}.{ts,tsx,mts,cts}",
]

export const spacetimeSysAlias = {
  "spacetime:sys@2.0": spacetimeSysStub,
  "spacetime:sys@2.1": spacetimeSysStub,
} as const

const fakeSpacetimeServerAlias = {
  "spacetimedb/server": path.resolve(
    packageRoot,
    "test",
    "helpers",
    "spacetimedb-server.ts",
  ),
} as const

export const baseConfig = {
  resolve: {
    alias: {
      ...spacetimeSysAlias,
      ...fakeSpacetimeServerAlias,
    },
  },
} as const

export const nativePackageConfig = {
  resolve: {
    alias: {
      ...spacetimeSysAlias,
    },
  },
} as const
