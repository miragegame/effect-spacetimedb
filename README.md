# effect-spacetimedb

effect-spacetimedb is an Effect-first toolkit for building typed SpaceTimeDB
modules, clients, and generated bindings.

The library package lives in `packages/effect-spacetimedb`.

## Package

- `effect-spacetimedb` provides the core contract, server, client, compiler,
  polyfill, and testing entrypoints.
- `effect-spacetimedb/client` contains client-side connection and subscription
  helpers.
- `effect-spacetimedb/server` contains server-side module runtime helpers.
- `effect-spacetimedb/server-compiler` contains the host-only module compiler
  entrypoint used from module `src/index.ts` files.
- `effect-spacetimedb/server-polyfills` is a side-effect import for native
  SpaceTimeDB module bundles.

See `packages/effect-spacetimedb/README.md` for library usage details.

## Contributions and Releases

Issues, bug reports, and suggestions are welcome and credited when they lead to
fixes or improvements.

This project does not accept external pull requests. Releases are cut by the
maintainers.

## License

MIT
