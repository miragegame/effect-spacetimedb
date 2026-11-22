# effect-spacetimedb quickstart

A minimal SpaceTimeDB module built with `effect-spacetimedb`. The shared module
contract lives in `src/contract.ts`, so `src/client.ts` never imports or
evaluates the host-only compiler in `src/index.ts`.

It shows the smallest authoring flow:

1. Declare one public table.
2. Declare a reducer and procedure in an endpoint group.
3. Implement both handlers with scoped `Db` access.
4. Build the module exports and default schema for the SpaceTimeDB module loader.
5. Call the procedure through the typed HTTP client.
6. Open a filtered WebSocket subscription with the native query DSL.

## Build

For a standalone project, copy this entire directory, including `patches/`.
The manifest pins `effect-spacetimedb` to 0.9.0 and the SDK to 2.16.1.
Bun applies the included SDK patch through `patchedDependencies`. Install the
2.16.1 SpacetimeDB CLI and use a matching local host.

From the copied directory:

```sh
bun install
bun run typecheck
bun run smoke:client-import
bun run build
```

To generate a TypeScript client in `src/module_bindings` from the same module contract:

```sh
bun run generate-client
```

To publish it to a local server started with `spacetime start`:

```sh
spacetime publish --server local --yes effect-spacetimedb-quickstart
```

Use this package as a starting point for a new module, then add tables,
reducers, procedures, views, HTTP routes, and subscriptions as the module grows.
