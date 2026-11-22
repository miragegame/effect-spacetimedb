import { makeAccessors } from "../../src/builder/module-accessors.ts"
import type { AnyModuleSpec } from "../../src/contract/module.ts"
import { bindModule } from "../../src/server/bind.ts"
import type {
  BindOptions,
  HandlerInputDefinitions,
  Handlers,
} from "../../src/server/handler-types.ts"

/**
 * A module's sections bound to a runtime, with the accessors a `Builder`
 * module offers. `Builder.group` requires every endpoint of a group, so this
 * is how a test exercises one handler, or a module with no groups at all.
 */
export const makeServer = <Module extends AnyModuleSpec, RuntimeR = never>(
  options: BindOptions<Module, RuntimeR>,
) => ({
  ...bindModule(options),
  ...makeAccessors<Module>(),
  handlers: (
    definitions: HandlerInputDefinitions<Module, RuntimeR>,
  ): Handlers<Module, RuntimeR> => definitions,
})

export type TestServer<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = ReturnType<typeof makeServer<Module, RuntimeR>>
