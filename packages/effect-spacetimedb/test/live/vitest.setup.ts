import "./helpers/node-web-polyfills"

globalThis.process.env.EFFECT_SPACETIMEDB_PACKAGE_ROOT ??=
  globalThis.process.cwd()
