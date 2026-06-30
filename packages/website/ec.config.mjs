import { defineEcConfig } from "@astrojs/starlight/expressive-code"
import ecTwoSlash from "expressive-code-twoslash"
import { spacetimedbShikiTheme } from "./src/styles/spacetimedb-shiki-theme.js"

export default defineEcConfig({
  themes: [spacetimedbShikiTheme],
  useStarlightUiThemeColors: false,
  styleOverrides: {
    borderRadius: "6px",
    borderColor: "var(--site-border)",
    codeFontFamily: "var(--site-font-mono)",
    codeFontSize: "11.7px",
    codeLineHeight: "18px",
    frames: {
      editorActiveTabBackground: "var(--site-code-bg)",
      editorActiveTabForeground: "var(--site-text-strong)",
      editorActiveTabBorderColor: "var(--site-border)",
      editorActiveTabIndicatorTopColor: "var(--site-accent)",
      editorActiveTabIndicatorBottomColor: "transparent",
      editorTabBarBackground: "var(--site-surface)",
      editorTabBarBorderColor: "var(--site-border)",
      editorTabBarBorderBottomColor: "var(--site-border)",
      editorBackground: "var(--site-code-bg)",
      terminalTitlebarBackground: "var(--site-surface)",
      terminalTitlebarBorderBottomColor: "var(--site-border)",
      terminalTitlebarDotsForeground: "var(--site-text-muted)",
      terminalTitlebarDotsOpacity: "0.42",
      terminalTitlebarForeground: "var(--site-text-muted)",
      terminalBackground: "var(--site-code-bg)",
      frameBoxShadowCssValue: "0 18px 64px rgba(0, 0, 0, 0.28)",
    },
  },
  plugins: [
    ecTwoSlash({
      twoslashOptions: {
        compilerOptions: {
          module: "esnext",
          moduleResolution: "bundler",
          target: "es2022",
          strict: true,
        },
      },
    }),
  ],
})
