import { rmSync } from "node:fs"
import * as Path from "node:path"
import { pathToFileURL } from "node:url"
import * as EffectVitest from "@effect/vitest"
import {
  bundleDocSamples,
  collectDocFences,
  declaresContract,
  docSamplesDirectory,
  type DocSampleFile,
  typecheckDocSamples,
  writeDocSamples,
} from "../helpers/doc-samples"

const { afterAll, beforeAll, describe, expect, it } = EffectVitest

/**
 * A fence this suite does not check says why in its info string. This ratchet
 * keeps that the exception: a new one has to come here too.
 */
const docSampleExceptionsMax = 0

type ContractValidator = {
  readonly contractProblems: (
    exports: Readonly<Record<string, unknown>>,
    contextExports: ReadonlyArray<string>,
  ) => ReadonlyArray<string>
}

describe("documentation samples", () => {
  const { fences, problems } = collectDocFences()
  let files: ReadonlyArray<DocSampleFile> = []

  beforeAll(() => {
    files = writeDocSamples(docSamplesDirectory, fences)
  })

  afterAll(() => {
    rmSync(docSamplesDirectory, { force: true, recursive: true })
  })

  it("checks every fence, or says why not", () => {
    const excepted = fences.flatMap((fence) =>
      fence.check.kind === "excepted"
        ? [`${fence.page}:${fence.line}: ${fence.check.reason}`]
        : [],
    )

    expect(problems).toEqual([])
    expect(fences.length).toBeGreaterThan(0)
    expect(files.length + excepted.length).toBe(fences.length)
    expect(excepted.length).toBeLessThanOrEqual(docSampleExceptionsMax)
    // Never run, so what it declared would go unvalidated.
    expect(
      files
        .filter((file) => file.body && file.declaresContract)
        .map((file) => `${file.page}:${file.line}`),
    ).toEqual([])
    process.stdout.write(
      `doc samples: ${files.length} checked, ${excepted.length} excepted\n`,
    )
  })

  it("finds a contract however its constructor call is spaced", () => {
    for (const code of [
      'Stdb.table ("t", {})',
      'Stdb.scheduledTable\n  ("t", {})',
      'Stdb.outboxTable ("t", {})',
      'Stdb.Module\n  .make("m", {})',
      'Stdb.Module . make("m", {})',
    ]) {
      expect(declaresContract(code), code).toBe(true)
    }
    expect(declaresContract("const tables = []")).toBe(false)
  })

  it("typechecks every sample", () => {
    expect(typecheckDocSamples(docSamplesDirectory, files)).toEqual([])
  })

  // The SDK replaces `console` while its server bundle loads, as it does on the
  // host, so each load restores the suite's.
  it("loads and validates every declared contract", async () => {
    const { samples, validator, world } = await bundleDocSamples(
      docSamplesDirectory,
      files,
    )
    const nativeConsole = globalThis.console
    const importBundled = async (path: string) => {
      try {
        return (await import(pathToFileURL(path).href)) as Record<
          string,
          unknown
        >
      } finally {
        globalThis.console = nativeConsole
      }
    }
    const { contractProblems } = (await importBundled(
      validator,
    )) as unknown as ContractValidator

    const failures = [
      ...contractProblems(await importBundled(world), []).map(
        (problem) => `${Path.basename(world)}: ${problem}`,
      ),
    ]
    for (const { file, url } of samples) {
      try {
        const exports = await importBundled(url)
        failures.push(
          ...contractProblems(exports, file.contextExports).map(
            (problem) => `${file.page}:${file.line}: ${problem}`,
          ),
        )
      } catch (cause) {
        failures.push(`${file.page}:${file.line}: ${String(cause)}`)
      }
    }

    expect(samples.length).toBeGreaterThan(0)
    expect(failures).toEqual([])
  })
})
