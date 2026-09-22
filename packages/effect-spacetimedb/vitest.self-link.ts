import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = path.dirname(fileURLToPath(import.meta.url))

/**
 * Guarantees `node_modules/effect-spacetimedb` inside this package.
 *
 * The package imports itself by name across its test, typecheck and example
 * trees -- a legal package self-reference through its `exports` map, and how
 * `examples/publishable-module` demonstrates real consumption. Only a real
 * `node_modules` entry honours that map: the subpaths are not a prefix of
 * `src/` (`./testing/example-module` resolves into `examples/`), so a resolver
 * alias cannot stand in for it.
 *
 * It cannot come from the manifest -- a `workspace:*` self-entry makes
 * `bun pm pack` fail -- and it cannot rely on an install lifecycle script,
 * which CI installs commonly skip. So the test runner makes it itself.
 */
export function setup(): void {
  const nodeModulesDir = path.join(packageRoot, "node_modules")
  const selfLink = path.join(nodeModulesDir, "effect-spacetimedb")
  // Self-healing, not create-if-absent: `existsSync` follows the link, so a
  // dangling one reads as absent and a wrong-but-resolvable one reads as fine.
  // Compare the target instead, and replace anything that disagrees.
  if (
    lstatSync(selfLink, { throwIfNoEntry: false })?.isSymbolicLink() === true
  ) {
    if (readlinkSync(selfLink) === "..") return
    rmSync(selfLink, { force: true })
  } else if (existsSync(selfLink)) {
    rmSync(selfLink, { force: true, recursive: true })
  }
  mkdirSync(nodeModulesDir, { recursive: true })
  symlinkSync("..", selfLink)
}
