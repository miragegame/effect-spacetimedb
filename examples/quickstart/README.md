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

From this directory:

```sh
bun run typecheck
bun run smoke:client-import
bun run build
```

To generate a TypeScript client from the same module contract:

```sh
bun run generate-client
```

Use this package as a starting point for a new module, then add tables,
reducers, procedures, views, HTTP routes, and subscriptions as the module grows.
