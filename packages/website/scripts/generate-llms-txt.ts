import path from "node:path"
import { fileURLToPath } from "node:url"
import type * as EffectSpacetimeDb from "effect-spacetimedb"

// Twoslash samples import the package from MDX code fences; this keeps the
// workspace dependency explicit to the repo dependency linter.
const twoslashPackageEntrypointAnchor = [] satisfies ReadonlyArray<
  keyof typeof EffectSpacetimeDb
>
void twoslashPackageEntrypointAnchor

const here = path.dirname(fileURLToPath(import.meta.url))
const docsDir = path.resolve(here, "../src/content/docs")
const publicDir = path.resolve(here, "../public")
const outFile = path.join(publicDir, "llms.txt")
const fullOutFile = path.join(publicDir, "llms-full.txt")
const siteUrl = "https://effect-stdb.dev"

interface Page {
  readonly href: string
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly order: number
}

interface Section {
  readonly heading: string
  readonly intro?: string
  readonly pages:
    | { readonly slugs: ReadonlyArray<string> }
    | { readonly directory: string }
}

const sections: ReadonlyArray<Section> = [
  {
    heading: "Start here",
    pages: { slugs: ["getting-started"] },
  },
  {
    heading: "Core Concepts",
    intro:
      "Mirrored SpacetimeDB Core Concepts pages that link upstream and document only the Effect delta.",
    pages: { directory: "core-concepts" },
  },
  {
    heading: "The Effect Layer",
    intro:
      "Effect-native design rationale and runtime constraints with no direct SpacetimeDB equivalent.",
    pages: { directory: "the-effect-layer" },
  },
  {
    heading: "Reference",
    pages: { slugs: ["reference", "spacetimedb-coverage"] },
  },
]

const header = `# effect-spacetimedb

> Effect-native builders and client wrappers for typed SpaceTimeDB modules.

This file indexes the documentation site at ${siteUrl}. Each docs page is listed with a URL and summary so agents can choose the right source quickly. Raw markdown is also emitted at matching \`.md\` paths.`

function parseFrontmatter(source: string): Record<string, string> {
  if (!source.startsWith("---")) return {}
  const end = source.indexOf("\n---", 3)
  if (end === -1) return {}
  const block = source.slice(3, end)
  const out: Record<string, string> = {}
  for (const rawLine of block.split("\n")) {
    const match = rawLine.trimEnd().match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[match[1]] = value
  }
  return out
}

function parseSidebarOrder(source: string): number {
  if (!source.startsWith("---")) return Number.POSITIVE_INFINITY
  const end = source.indexOf("\n---", 3)
  if (end === -1) return Number.POSITIVE_INFINITY
  const lines = source.slice(3, end).split("\n")
  for (let index = 0; index < lines.length; index++) {
    if (!/^sidebar:\s*$/.test(lines[index])) continue
    for (
      let nestedIndex = index + 1;
      nestedIndex < lines.length;
      nestedIndex++
    ) {
      if (/^\S/.test(lines[nestedIndex])) break
      const match = lines[nestedIndex].match(/^\s+order:\s*(-?[\d.]+)\s*$/)
      if (match) return Number.parseFloat(match[1])
    }
  }
  return Number.POSITIVE_INFINITY
}

async function loadPage(slug: string): Promise<Page> {
  for (const extension of [".mdx", ".md"]) {
    const filePath = path.join(docsDir, `${slug}${extension}`)
    if (await Bun.file(filePath).exists()) {
      const source = await Bun.file(filePath).text()
      const frontmatter = parseFrontmatter(source)
      const title = frontmatter.title
      if (!title)
        throw new Error(`Missing title in frontmatter: ${slug}${extension}`)
      return {
        href: `/${slug}`,
        slug,
        title,
        description: frontmatter.description ?? "",
        order: parseSidebarOrder(source),
      }
    }
  }
  throw new Error(`Page not found: ${slug}`)
}

async function listSlugs(directory: string): Promise<Array<string>> {
  const glob = new Bun.Glob(`${directory}/**/*.{md,mdx}`)
  const slugs: Array<string> = []
  for await (const rel of glob.scan({ cwd: docsDir, onlyFiles: true })) {
    const extension = path.extname(rel)
    slugs.push(rel.slice(0, -extension.length))
  }
  return slugs.sort()
}

function renderPage(page: Page): string {
  const description = page.description ? ` - ${page.description}` : ""
  return `- [${page.title}](${siteUrl}${page.href})${description}`
}

async function renderSection(section: Section): Promise<string> {
  const isDirectory = "directory" in section.pages
  const slugs = isDirectory
    ? await listSlugs(section.pages.directory)
    : [...section.pages.slugs]
  const pages = await Promise.all(slugs.map(loadPage))
  if (isDirectory)
    pages.sort((a, b) =>
      a.order === b.order ? a.title.localeCompare(b.title) : a.order - b.order,
    )
  return [
    `## ${section.heading}`,
    section.intro,
    pages.map(renderPage).join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n")
}

async function renderFullPage(slug: string): Promise<string> {
  for (const extension of [".mdx", ".md"]) {
    const filePath = path.join(docsDir, `${slug}${extension}`)
    if (await Bun.file(filePath).exists()) {
      const source = await Bun.file(filePath).text()
      return `# Source: /${slug}\n\n${source}`
    }
  }
  throw new Error(`Page not found: ${slug}`)
}

const allSlugs = async () => {
  const slugs = new Set<string>()
  for (const section of sections) {
    if ("directory" in section.pages) {
      for (const slug of await listSlugs(section.pages.directory))
        slugs.add(slug)
    } else {
      for (const slug of section.pages.slugs) slugs.add(slug)
    }
  }
  return [...slugs].sort()
}

async function main() {
  await Bun.write(
    outFile,
    `${[header, ...(await Promise.all(sections.map(renderSection)))].join("\n\n")}\n`,
  )

  const fullPages = await Promise.all((await allSlugs()).map(renderFullPage))
  const fullText = `${header}\n\n${fullPages.join("\n\n---\n\n")}`.trimEnd()
  await Bun.write(fullOutFile, `${fullText}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
