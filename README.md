# effect-spacetimedb

effect-spacetimedb is an Effect-first toolkit for building typed SpaceTimeDB
modules, clients, and generated bindings.

The library package lives in `packages/effect-spacetimedb`.

## Documentation

Full documentation, guides, and the API reference are at
**https://effect-stdb.dev**.

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
- `effect-spacetimedb/dev-server` starts a temporary local SpaceTimeDB runtime
  and publishes a prebuilt bundle for tests and tools.
- `effect-spacetimedb/testing` and `effect-spacetimedb/testing/spacetime-sys`
  contain regression-test helpers and the off-host `spacetime:sys` stub.

See `packages/effect-spacetimedb/README.md` for library usage details.

## Contributions and Releases

Issues, bug reports, pull requests, and suggestions are welcome and credited when
they lead to fixes or improvements.

Releases are cut by the maintainers.

## License

MIT
