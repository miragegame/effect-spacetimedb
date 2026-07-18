// @ts-check
import mdx from "@astrojs/mdx"
import react from "@astrojs/react"
import sitemap from "@astrojs/sitemap"
import starlight from "@astrojs/starlight"
import tailwindcss from "@tailwindcss/vite"
import astroBrokenLinksChecker from "astro-broken-links-checker"
import { defineConfig } from "astro/config"
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Copies docs and page markdown into `dist` as raw `.md` files. The output
 * paths match the public HTML routes so coding agents can fetch source-shaped docs.
 *
 * @returns {import("astro").AstroIntegration}
 */
function copyMarkdownSources() {
  return {
    name: "copy-markdown-sources",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        const outDir = fileURLToPath(dir)

        /**
         * @param {string} srcDir
         * @param {{ lowercase?: boolean }} [opts]
         * @param {string} [relTo]
         */
        async function walk(srcDir, opts = {}, relTo = srcDir) {
          let entries
          try {
            entries = await fs.readdir(srcDir, { withFileTypes: true })
          } catch {
            return
          }

          for (const entry of entries) {
            const full = path.join(srcDir, entry.name)
            if (entry.isDirectory()) {
              await walk(full, opts, relTo)
              continue
            }
            if (!entry.isFile()) continue
            const ext = path.extname(entry.name).toLowerCase()
            if (ext !== ".md" && ext !== ".mdx") continue
            let rel = path.relative(relTo, full)
            rel = rel.slice(0, rel.length - ext.length) + ".md"
            if (opts.lowercase) rel = rel.toLowerCase()
            const target = path.join(outDir, rel)
            await fs.mkdir(path.dirname(target), { recursive: true })
            await fs.copyFile(full, target)
          }
        }

        await walk(
          fileURLToPath(new URL("./src/content/docs/", import.meta.url)),
          {
            lowercase: true,
          },
        )
        await walk(fileURLToPath(new URL("./src/pages/", import.meta.url)))
      },
    },
  }
}

/**
 * Checks site-local links with case-sensitive path matching. This catches links
 * that pass on macOS but would fail on Linux or in static hosting.
 *
 * @returns {import("astro").AstroIntegration}
 */
function caseSensitiveLinkChecker() {
  return {
    name: "case-sensitive-link-checker",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const distPath = fileURLToPath(dir)
        /** @type {Set<string>} */
        const paths = new Set()
        /** @type {Set<string>} */
        const dirs = new Set()

        /** @param {string} directory */
        async function walk(directory) {
          const entries = await fs.readdir(directory, { withFileTypes: true })
          for (const entry of entries) {
            const full = path.join(directory, entry.name)
            if (entry.isDirectory()) {
              dirs.add(`/${path.relative(distPath, full)}`)
              await walk(full)
            } else if (entry.isFile()) {
              paths.add(`/${path.relative(distPath, full)}`)
            }
          }
        }

        await walk(distPath)

        /** @type {Map<string, Set<string>>} */
        const broken = new Map()
        const htmlFiles = [...paths].filter((item) => item.endsWith(".html"))

        for (const htmlFile of htmlFiles) {
          const html = await fs.readFile(
            path.join(distPath, htmlFile.slice(1)),
            "utf8",
          )
          const links = [
            ...html.matchAll(/<a\s+[^>]*href="([^"#?]+)/gi),
            ...html.matchAll(/<img\s+[^>]*src="([^"#?]+)/gi),
          ].map((match) => match[1])

          for (const link of links) {
            if (!link.startsWith("/")) continue
            const clean = link.replace(/\/$/, "")
            const candidates = [clean, `${clean}/index.html`, `${clean}.html`]
            const exists =
              candidates.some((candidate) => paths.has(candidate)) ||
              dirs.has(clean)
            if (!exists) {
              if (!broken.has(link)) broken.set(link, new Set())
              broken.get(link)?.add(htmlFile)
            }
          }
        }

        if (broken.size > 0) {
          let message = "Case-sensitive broken links detected:\n"
          for (const [link, files] of broken.entries()) {
            message += `\n  ${link}\n    Found in:\n`
            for (const file of files) message += `      - ${file}\n`
          }
          logger.error(message)
          throw new Error(
            `Case-sensitive broken links detected (${broken.size})`,
          )
        }

        logger.info(
          `Case-sensitive link check passed (${htmlFiles.length} pages)`,
        )
      },
    },
  }
}

export default defineConfig({
  site: "https://effect-stdb.dev",
  prefetch: true,
  trailingSlash: "ignore",
  integrations: [
    react(),
    copyMarkdownSources(),
    astroBrokenLinksChecker({
      checkExternalLinks: false,
      throwError: true,
    }),
    caseSensitiveLinkChecker(),
    sitemap({
      filter: (page) =>
        !page.endsWith(".html") &&
        !page.endsWith(".md") &&
        !page.endsWith(".mdx"),
    }),
    starlight({
      title: "effect-spacetimedb",
      customCss: ["./src/styles/global.css"],
      components: {
        Header: "./src/components/marketing/Nav.astro",
        ThemeProvider: "./src/components/ThemeProvider.astro",
        Footer: "./src/components/marketing/DocsFooter.astro",
      },
      prerender: true,
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/miragegame/effect-spacetimedb",
        },
      ],
      editLink: {
        baseUrl:
          "https://github.com/miragegame/effect-spacetimedb/edit/main/packages/website",
      },
      sidebar: [
        { label: "Getting Started", link: "/getting-started" },
        {
          label: "Core Concepts",
          collapsed: false,
          items: [
            {
              label: "Tables",
              collapsed: false,
              items: [
                {
                  label: "Column Types",
                  link: "/core-concepts/tables/column-types",
                },
                {
                  label: "Constraints",
                  link: "/core-concepts/tables/constraints",
                },
                { label: "Indexes", link: "/core-concepts/tables/indexes" },
                {
                  label: "Auto-Increment",
                  link: "/core-concepts/tables/auto-increment",
                },
                {
                  label: "Default Values",
                  link: "/core-concepts/tables/default-values",
                },
                {
                  label: "Scheduled Tables",
                  link: "/core-concepts/tables/scheduled-tables",
                },
                {
                  label: "Event Tables",
                  link: "/core-concepts/tables/event-tables",
                },
                {
                  label: "Access Permissions",
                  link: "/core-concepts/tables/access-permissions",
                },
                {
                  label: "File Storage",
                  link: "/core-concepts/tables/file-storage",
                },
                {
                  label: "Performance",
                  link: "/core-concepts/tables/performance",
                },
              ],
            },
            {
              label: "Functions",
              collapsed: false,
              items: [
                {
                  label: "Reducers",
                  link: "/core-concepts/functions/reducers",
                },
                {
                  label: "Reducer Context",
                  link: "/core-concepts/functions/reducer-context",
                },
                {
                  label: "Lifecycle",
                  link: "/core-concepts/functions/lifecycle",
                },
                {
                  label: "Procedures",
                  link: "/core-concepts/functions/procedures",
                },
                { label: "Views", link: "/core-concepts/functions/views" },
                {
                  label: "HTTP Handlers",
                  link: "/core-concepts/functions/http-handlers",
                },
                {
                  label: "Error Handling",
                  link: "/core-concepts/functions/error-handling",
                },
              ],
            },
            {
              label: "Subscriptions",
              link: "/core-concepts/subscriptions",
            },
            {
              label: "Clients",
              collapsed: false,
              items: [
                { label: "Codegen", link: "/core-concepts/clients/codegen" },
                {
                  label: "Connection",
                  link: "/core-concepts/clients/connection",
                },
                { label: "SDK API", link: "/core-concepts/clients/sdk-api" },
              ],
            },
            {
              label: "Databases",
              collapsed: false,
              items: [
                {
                  label: "Transactions & Atomicity",
                  link: "/core-concepts/databases/transactions-atomicity",
                },
                {
                  label: "Dev & Publish",
                  link: "/core-concepts/databases/dev-publish",
                },
                {
                  label: "Migrations",
                  link: "/core-concepts/databases/migrations",
                },
              ],
            },
          ],
        },
        {
          label: "The Effect Layer",
          collapsed: false,
          items: [
            {
              label: "Value-Type Design",
              link: "/the-effect-layer/value-type-design",
            },
            {
              label: "Value Representations",
              link: "/the-effect-layer/value-representations",
            },
            {
              label: "Value Types",
              link: "/the-effect-layer/value-types",
            },
            {
              label: "Option vs Optional",
              link: "/the-effect-layer/option-vs-optional",
            },
            {
              label: "Runtime Model",
              link: "/the-effect-layer/runtime-model",
            },
            {
              label: "Randomness & Determinism",
              link: "/the-effect-layer/randomness-and-determinism",
            },
            {
              label: "Migrating From Native SDK",
              link: "/the-effect-layer/migrating-from-native-sdk",
            },
          ],
        },
        {
          label: "Reference",
          collapsed: false,
          items: [
            { label: "API Reference", link: "/reference" },
            {
              label: "SpacetimeDB Coverage",
              link: "/spacetimedb-coverage",
            },
          ],
        },
      ],
    }),
    mdx(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
})
