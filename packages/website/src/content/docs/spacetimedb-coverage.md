---
draft: false
title: SpacetimeDB Coverage
description: Manual upstream-to-effect-spacetimedb Core Concepts coverage map.
sidebar:
  order: 98
---

This map tracks the latest SpacetimeDB Core Concepts taxonomy against these docs.
Every upstream topic should have exactly one row.

| Upstream Core Concept topic | Upstream link | Our status | Our page / note |
| --- | --- | --- | --- |
| Core Concepts index | [SpacetimeDB -> Core Concepts](https://spacetimedb.com/docs/core-concepts) | mirrored | Covered by the [Core Concepts sidebar](/core-concepts/tables/column-types) and this map. |
| Databases | [SpacetimeDB -> Databases](https://spacetimedb.com/docs/databases) | mirrored | Section root represented by the Databases sidebar group. |
| Databases / Transactions & Atomicity | [SpacetimeDB -> Transactions & Atomicity](https://spacetimedb.com/docs/databases/transactions-atomicity) | mirrored | [Transactions & Atomicity](/core-concepts/databases/transactions-atomicity) |
| Databases / spacetime dev | [SpacetimeDB -> spacetime dev](https://spacetimedb.com/docs/databases/developing) | mirrored | [Dev & Publish](/core-concepts/databases/dev-publish) |
| Databases / spacetime publish | [SpacetimeDB -> spacetime publish](https://spacetimedb.com/docs/databases/building-publishing) | mirrored | [Dev & Publish](/core-concepts/databases/dev-publish) |
| Databases / Cheat Sheet | [SpacetimeDB -> Cheat Sheet](https://spacetimedb.com/docs/databases/cheat-sheet) | mirrored | Covered by [Getting Started](/getting-started) and [Reference](/reference); no separate Effect delta. |
| Databases / Migrations / Automatic Migrations | [SpacetimeDB -> Automatic Migrations](https://spacetimedb.com/docs/databases/automatic-migrations) | mirrored | [Migrations](/core-concepts/databases/migrations) |
| Databases / Migrations / Incremental Migrations | [SpacetimeDB -> Incremental Migrations](https://spacetimedb.com/docs/databases/incremental-migrations) | mirrored | [Migrations](/core-concepts/databases/migrations) |
| Functions | [SpacetimeDB -> Functions](https://spacetimedb.com/docs/functions) | mirrored | Section root represented by the Functions sidebar group. |
| Functions / Reducers | [SpacetimeDB -> Reducers](https://spacetimedb.com/docs/functions/reducers) | mirrored | [Reducers](/core-concepts/functions/reducers) |
| Functions / Reducers / Reducer Context | [SpacetimeDB -> Reducer Context](https://spacetimedb.com/docs/functions/reducers/reducer-context) | mirrored | [Reducer Context](/core-concepts/functions/reducer-context) |
| Functions / Reducers / Lifecycle | [SpacetimeDB -> Lifecycle](https://spacetimedb.com/docs/functions/reducers/lifecycle) | mirrored | [Lifecycle](/core-concepts/functions/lifecycle) |
| Functions / Reducers / Error Handling | [SpacetimeDB -> Error Handling](https://spacetimedb.com/docs/functions/reducers/error-handling) | mirrored | [Error Handling](/core-concepts/functions/error-handling) |
| Functions / Procedures | [SpacetimeDB -> Procedures](https://spacetimedb.com/docs/functions/procedures) | mirrored | [Procedures](/core-concepts/functions/procedures) |
| Functions / Views | [SpacetimeDB -> Views](https://spacetimedb.com/docs/functions/views) | mirrored | [Views](/core-concepts/functions/views) |
| Functions / HTTP Handlers | [SpacetimeDB -> Functions](https://spacetimedb.com/docs/functions) | mirrored | [HTTP Handlers](/core-concepts/functions/http-handlers); a dedicated upstream HTTP handlers page is not published yet. |
| Tables | [SpacetimeDB -> Tables](https://spacetimedb.com/docs/tables) | mirrored | Section root represented by the Tables sidebar group. |
| Tables / Column Types | [SpacetimeDB -> Column Types](https://spacetimedb.com/docs/tables/column-types) | mirrored | [Column Types](/core-concepts/tables/column-types) |
| Tables / File Storage | [SpacetimeDB -> File Storage](https://spacetimedb.com/docs/tables/file-storage) | mirrored | [File Storage](/core-concepts/tables/file-storage) |
| Tables / Auto-Increment | [SpacetimeDB -> Auto-Increment](https://spacetimedb.com/docs/tables/auto-increment) | mirrored | [Auto-Increment](/core-concepts/tables/auto-increment) |
| Tables / Constraints | [SpacetimeDB -> Constraints](https://spacetimedb.com/docs/tables/constraints) | mirrored | [Constraints](/core-concepts/tables/constraints) |
| Tables / Default Values | [SpacetimeDB -> Default Values](https://spacetimedb.com/docs/tables/default-values) | mirrored | [Default Values](/core-concepts/tables/default-values) |
| Tables / Indexes | [SpacetimeDB -> Indexes](https://spacetimedb.com/docs/tables/indexes) | mirrored | [Indexes](/core-concepts/tables/indexes) |
| Tables / Access Permissions | [SpacetimeDB -> Access Permissions](https://spacetimedb.com/docs/tables/access-permissions) | not-supported | [Access Permissions](/core-concepts/tables/access-permissions); RLS / `clientVisibilityFilter` is not supported. |
| Tables / Scheduled Tables | [SpacetimeDB -> Scheduled Tables](https://spacetimedb.com/docs/tables/schedule-tables) | mirrored | [Scheduled Tables](/core-concepts/tables/scheduled-tables) |
| Tables / Event Tables | [SpacetimeDB -> Event Tables](https://spacetimedb.com/docs/tables/event-tables) | mirrored | [Event Tables](/core-concepts/tables/event-tables) |
| Tables / Performance | [SpacetimeDB -> Performance](https://spacetimedb.com/docs/tables/performance) | mirrored | [Performance](/core-concepts/tables/performance) |
| Clients / Subscriptions | [SpacetimeDB -> Subscriptions](https://spacetimedb.com/docs/clients/subscriptions) | mirrored | [Subscriptions](/core-concepts/subscriptions) |
| Clients / Subscriptions / Semantics | [SpacetimeDB -> Subscription Semantics](https://spacetimedb.com/docs/clients/subscriptions/semantics) | mirrored | [Subscriptions](/core-concepts/subscriptions) |
| Authentication | [SpacetimeDB -> Authentication](https://spacetimedb.com/docs/core-concepts/authentication) | not-supported | effect-spacetimedb does not wrap SpacetimeAuth/Auth0/Clerk/BetterAuth; authenticate through the native SpacetimeDB client/runtime. |
| Authentication / SpacetimeAuth | [SpacetimeDB -> SpacetimeAuth](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/) | not-supported | No Effect-specific API. |
| Authentication / SpacetimeAuth / Creating a Project | [SpacetimeDB -> Creating a Project](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/creating-a-project) | not-supported | No Effect-specific API. |
| Authentication / SpacetimeAuth / Configuring a Project | [SpacetimeDB -> Configuring a Project](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/configuring-a-project) | not-supported | No Effect-specific API. |
| Authentication / SpacetimeAuth / Testing | [SpacetimeDB -> Testing](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/testing) | not-supported | No Effect-specific API. |
| Authentication / SpacetimeAuth / React Integration | [SpacetimeDB -> React Integration](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/react-integration) | not-supported | No Effect-specific API. |
| Authentication / SpacetimeAuth / Steam | [SpacetimeDB -> Steam](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/steam) | not-supported | No Effect-specific API. |
| Authentication / Auth0 | [SpacetimeDB -> Auth0](https://spacetimedb.com/docs/core-concepts/authentication/Auth0) | not-supported | No Effect-specific API. |
| Authentication / Clerk | [SpacetimeDB -> Clerk](https://spacetimedb.com/docs/core-concepts/authentication/Clerk) | not-supported | No Effect-specific API. |
| Authentication / BetterAuth | [SpacetimeDB -> Authentication](https://spacetimedb.com/docs/core-concepts/authentication) | not-supported | No dedicated upstream BetterAuth page is present in the live sitemap; no Effect-specific API. |
| Authentication / Usage | [SpacetimeDB -> Usage](https://spacetimedb.com/docs/core-concepts/authentication/usage) | not-supported | No Effect-specific API. |
| Clients | [SpacetimeDB -> Clients](https://spacetimedb.com/docs/clients) | mirrored | Section root represented by the Clients sidebar group. |
| Clients / Codegen | [SpacetimeDB -> Codegen](https://spacetimedb.com/docs/clients/codegen) | mirrored | [Codegen](/core-concepts/clients/codegen) |
| Clients / Connection | [SpacetimeDB -> Connection](https://spacetimedb.com/docs/clients/connection) | mirrored | [Connection](/core-concepts/clients/connection) |
| Clients / API | [SpacetimeDB -> API](https://spacetimedb.com/docs/clients/api) | mirrored | [SDK API](/core-concepts/clients/sdk-api) |
| Clients / Rust | [SpacetimeDB -> Rust](https://spacetimedb.com/docs/clients/rust) | not-supported | effect-spacetimedb targets TypeScript/Effect. |
| Clients / C# | [SpacetimeDB -> C#](https://spacetimedb.com/docs/clients/c-sharp) | not-supported | effect-spacetimedb targets TypeScript/Effect. |
| Clients / TypeScript | [SpacetimeDB -> TypeScript](https://spacetimedb.com/docs/clients/typescript) | mirrored | [Connection](/core-concepts/clients/connection) and [SDK API](/core-concepts/clients/sdk-api) cover the TypeScript Effect delta. |
| Clients / Unreal | [SpacetimeDB -> Unreal](https://spacetimedb.com/docs/clients/unreal) | not-supported | effect-spacetimedb targets TypeScript/Effect. |
| Effect Layer / Value-Type Design | N/A | native | [Value-Type Design](/the-effect-layer/value-type-design) |
| Effect Layer / Value Representations | N/A | native | [Value Representations](/the-effect-layer/value-representations) |
| Effect Layer / Value Types | N/A | native | [Value Types](/the-effect-layer/value-types) |
| Effect Layer / Option vs Optional | N/A | native | [Option vs Optional](/the-effect-layer/option-vs-optional) |
| Effect Layer / Runtime Model | N/A | native | [Runtime Model](/the-effect-layer/runtime-model) |
| Effect Layer / Randomness & Determinism | N/A | native | [Randomness & Determinism](/the-effect-layer/randomness-and-determinism) |
| Effect Layer / Migrating From Native SDK | N/A | native | [Migrating From Native SDK](/the-effect-layer/migrating-from-native-sdk) |
