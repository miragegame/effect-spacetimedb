import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { testViewRowsLength } from "../helpers/array-bounds"
import type { BoundViewExport } from "../../src/server/handler-types-inputs.ts"
import type { Assert, IsEqual } from "./helpers"

const Author = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(16))),
)
const Post = Stdb.struct({ id: Stdb.string(), authorId: Author })

const ViewsModule = Stdb.StdbModule.make("view_params_types", {}).add(
  Stdb.StdbGroup.make("Views")
    .add(
      Stdb.StdbFn.anonymousView("postsByAuthor", {
        params: Stdb.struct({ authorId: Author }),
        returns: Stdb.array(Post, testViewRowsLength),
      }),
    )
    .add(
      Stdb.StdbFn.anonymousView("allPosts", {
        returns: Stdb.array(Post, testViewRowsLength),
      }),
    ),
)
type ViewsSpec = typeof ViewsModule.spec

// The handler receives the decoded arguments; a view without params, none.
const postsByAuthorArgs: Stdb.ViewArgsFor<typeof ViewsModule, "postsByAuthor"> =
  { authorId: "ada" }
const wrongPostsByAuthorArgs: Stdb.ViewArgsFor<
  typeof ViewsModule,
  "postsByAuthor"
  // @ts-expect-error the argument is named authorId
> = { author: "ada" }
type _allPostsArgs = Assert<
  IsEqual<keyof Stdb.ViewArgsFor<typeof ViewsModule, "allPosts">, never>
>
void postsByAuthorArgs
void wrongPostsByAuthorArgs

const targets = Stdb.project(ViewsModule.spec).targets
// A view with params projects a call; one without, the target itself.
void targets.views.postsByAuthor({ authorId: "ada" })
void targets.views.allPosts.kind
// @ts-expect-error a call names every argument
void targets.views.postsByAuthor({})
// @ts-expect-error a view without params is no call
void targets.views.allPosts({})

declare const session: ReturnType<
  typeof StdbTesting.ClientWs.make<ViewsSpec, unknown, unknown>
>

void session.viewGroup(["allPosts"] as const)
void session.viewGroup(["postsByAuthor", "allPosts"] as const, {
  args: { postsByAuthor: { authorId: "ada" } },
})
// @ts-expect-error a group holding a view with params needs its arguments
void session.viewGroup(["postsByAuthor"] as const)
void session.viewGroup(["allPosts"] as const, {
  // @ts-expect-error a group without views with params takes no arguments
  args: { allPosts: {} },
})
void session.streamViewRows("postsByAuthor", { args: { authorId: "ada" } })
// @ts-expect-error streaming a view with params needs its arguments
void session.streamViewRows("postsByAuthor")
void session.waitUntilView("postsByAuthor", (row) => row.authorId === "ada", {
  args: { authorId: "ada" },
})
// A key that may name a view with params needs arguments too.
declare const eitherKey: "postsByAuthor" | "allPosts"
// @ts-expect-error the key may name postsByAuthor
void session.streamViewRows(eitherKey)
// @ts-expect-error the key may name postsByAuthor
void session.waitUntilView(eitherKey, () => true)
// @ts-expect-error a union key's arguments satisfy every view it may name
void session.streamViewRows(eitherKey, { args: {} })
void session.streamViewRows(eitherKey, { args: { authorId: "ada" } })

// A bound server view is invoked with its decoded arguments.
declare const boundPostsByAuthor: BoundViewExport<ViewsSpec, "postsByAuthor">
declare const viewCtx: Parameters<typeof boundPostsByAuthor.invoke>[0]
void boundPostsByAuthor.invoke(viewCtx, { authorId: "ada" })
// @ts-expect-error the bound view needs its authorId
void boundPostsByAuthor.invoke(viewCtx, {})
