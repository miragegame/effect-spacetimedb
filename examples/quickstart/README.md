# effect-spacetimedb quickstart

A minimal SpaceTimeDB module built with `effect-spacetimedb`.

It shows the smallest authoring flow:

1. Declare one public table.
2. Declare one reducer in an endpoint group.
3. Implement the reducer with scoped `Db` access.
4. Build the module exports and default schema for the SpaceTimeDB module loader.

## Build

From this directory:

```sh
bun run build
```

To generate a TypeScript client from the same module contract:

```sh
bun run generate-client
```

Use this package as a starting point for a new module, then add tables,
reducers, procedures, views, HTTP routes, and subscriptions as the module grows.
