import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import type {} from "effect/unstable/httpapi/HttpApiSchema"
import * as ParseResult from "../compat/parse-result.ts"
import { StdbDecodeError } from "../decode-error.ts"
import { typedFromEntries } from "../utils.ts"
import type { AnyValueType } from "./type.ts"
import * as Type from "./type.ts"

export type TaggedErrorClass = Schema.Top & {
  readonly _tag?: string
  readonly httpStatus?: number | undefined
  readonly identifier: string
  new (...args: ReadonlyArray<never>): { readonly _tag: string }
}

type ErrorTagOf<ErrorClass extends TaggedErrorClass> =
  InstanceType<ErrorClass>["_tag"]

type ErrorFields = Readonly<Record<string, AnyValueType>>

export type ErrorSpec<
  Fields extends ErrorFields = ErrorFields,
  Status extends number | undefined = number | undefined,
> = {
  readonly kind: "error"
  readonly fields: Fields
  readonly status?: Status
}

type ErrorPayload<Fields extends ErrorFields> = {
  readonly [Key in keyof Fields]: Fields[Key]["Type"]
}

type GeneratedError<Tag extends string, Fields extends ErrorFields> = {
  readonly _tag: Tag
} & ErrorPayload<Fields> &
  Effect.Effect<never, GeneratedError<Tag, Fields>, never>

type GeneratedErrorClass<
  Tag extends string = string,
  Fields extends ErrorFields = ErrorFields,
  Status extends number | undefined = number | undefined,
> = Schema.Codec<GeneratedError<Tag, Fields>, unknown, never, never> & {
  readonly _tag: Tag
  readonly httpStatus: Status
  readonly identifier: string
  new (args: ErrorPayload<Fields>): GeneratedError<Tag, Fields>
}

type NamespacedTag<
  Namespace extends string,
  Key extends string,
> = `${Namespace}${Key}`

type ErrorStatusOf<Spec extends ErrorSpec> = Spec extends ErrorSpec<
  ErrorFields,
  infer Status
>
  ? Status
  : undefined

type ErrorClassRecord<
  Namespace extends string,
  Specs extends ErrorSpecRecord,
> = {
  readonly [Key in keyof Specs & string]: GeneratedErrorClass<
    NamespacedTag<Namespace, Key>,
    Specs[Key]["fields"],
    ErrorStatusOf<Specs[Key]>
  >
}

type ErrorSpecRecord = Readonly<Record<string, ErrorSpec>>

export type NamespacedErrorDefinition<
  Namespace extends string,
  Specs extends ErrorSpecRecord,
> = ErrorDefinition<
  ReadonlyArray<ErrorClassRecord<Namespace, Specs>[keyof Specs & string]>
> &
  ErrorClassRecord<Namespace, Specs>

type ErrorInstanceOf<Errors extends readonly TaggedErrorClass[]> = InstanceType<
  Errors[number]
>

type ProcedureDeclaredErrorType = ReturnType<typeof Type.string>

export type ProcedureDeclaredErrorCarrier = string

const DeclaredErrorEnvelopeVersion = 1 as const

export type ErrorDefinition<
  Errors extends readonly TaggedErrorClass[] = readonly TaggedErrorClass[],
> = {
  readonly errors: Errors
  readonly tags: ReadonlySet<ErrorTagOf<Errors[number]>>
  readonly schema: Schema.Codec<ErrorInstanceOf<Errors>, unknown, never, never>
  readonly type: ProcedureDeclaredErrorType
  readonly pick: <
    const Tags extends readonly [
      ErrorTagOf<Errors[number]>,
      ...ReadonlyArray<ErrorTagOf<Errors[number]>>,
    ],
  >(
    ...tags: Tags
  ) => ErrorDefinition<PickedErrorClasses<Errors, Tags[number]>>
}

export type AnyErrorDefinition = {
  readonly errors: readonly TaggedErrorClass[]
  readonly tags: ReadonlySet<string>
  readonly schema: Schema.Codec<unknown, unknown, never, never>
  readonly type: ProcedureDeclaredErrorType
}

type ErrorsInputItem = AnyErrorDefinition | TaggedErrorClass

export type ErrorsInput =
  | AnyErrorDefinition
  | TaggedErrorClass
  | readonly [ErrorsInputItem, ...ReadonlyArray<ErrorsInputItem>]

type ClassesOfItem<Item> = Item extends AnyErrorDefinition
  ? Item["errors"][number]
  : Item extends TaggedErrorClass
    ? Item
    : never

type ClassesOfInput<Input extends ErrorsInput> = Input extends readonly [
  ErrorsInputItem,
  ...ReadonlyArray<ErrorsInputItem>,
]
  ? ReadonlyArray<ClassesOfItem<Input[number]>>
  : ReadonlyArray<ClassesOfItem<Input>>

export type DefinitionOfInput<Input extends ErrorsInput> =
  Input extends AnyErrorDefinition
    ? Input
    : ErrorDefinition<ClassesOfInput<Input>>

export type DefinitionOfInputOrUndefined<
  Input extends ErrorsInput | undefined,
> = Input extends ErrorsInput ? DefinitionOfInput<Input> : undefined

export type ErrorTags<Definition extends AnyErrorDefinition> = ErrorTagOf<
  Definition["errors"][number]
>

export type ErrorInstances<Definition extends AnyErrorDefinition> =
  InstanceType<Definition["errors"][number]>

type NonEmptyErrorDefinitions = readonly [
  AnyErrorDefinition,
  ...ReadonlyArray<AnyErrorDefinition>,
]

type MergedErrorClasses<Definitions extends NonEmptyErrorDefinitions> =
  ReadonlyArray<Definitions[number]["errors"][number]>

type PickedErrorClass<
  ErrorClass,
  Tags extends string,
> = ErrorClass extends TaggedErrorClass
  ? ErrorTagOf<ErrorClass> extends Tags
    ? ErrorClass
    : never
  : never

type PickedErrorClasses<
  Errors extends readonly TaggedErrorClass[],
  Tags extends string,
> = ReadonlyArray<PickedErrorClass<Errors[number], Tags>>

const ReservedDeclaredErrorTags = new Set([
  "DomainCallError",
  "RemoteRejectedError",
  "TransportError",
  "StdbDecodeError",
  "StdbHostCallError",
  "StdbUniqueAlreadyExistsError",
  "StdbAutoIncOverflowError",
  "StdbNoSuchRowError",
  "StdbScheduleDelayTooLongError",
  "StdbDeclaredErrorEncodingFailure",
  "StdbSenderFailure",
  "StdbValueCodecError",
  "ReducerAsyncNotAllowedError",
  "ReducerGlobalRandomNotAllowedError",
  "RemoteRejectedBody",
  "SubscriptionRejectedError",
  "SubscriptionTransportError",
  "SubscriptionInvalidatedError",
  "WsConnectError",
  "WsUnsupportedBuilderFeatureError",
])

export const isReservedDeclaredErrorTag = (tag: string): boolean =>
  ReservedDeclaredErrorTags.has(tag)

export const error = <
  const Fields extends ErrorFields,
  const Status extends number | undefined = undefined,
>(
  fields: Fields,
  options?: { readonly status?: Status },
): ErrorSpec<Fields, Status> => ({
  kind: "error",
  fields,
  ...(options?.status === undefined ? {} : { status: options.status }),
})

const resolveHttpApiStatus = SchemaAST.resolveAt<number>("httpApiStatus")

export const statusOf = (errorClass: TaggedErrorClass): number | undefined =>
  errorClass.httpStatus ?? resolveHttpApiStatus(errorClass.ast)

// Unknown future envelope versions intentionally fail this schema and are
// classified as opaque remote rejections rather than partially decoded.
const TaggedErrorEnvelopeStringSchema = Schema.fromJsonString(
  Schema.Struct({
    _effectSpacetimeDb: Schema.Literal("DeclaredError"),
    version: Schema.Literal(DeclaredErrorEnvelopeVersion),
    tag: Schema.String,
    error: Schema.Unknown,
  }),
)

const readTag = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || !("_tag" in value)) {
    return undefined
  }

  return typeof value._tag === "string" ? value._tag : undefined
}

const errorClassTag = (errorClass: TaggedErrorClass): string => {
  const existing = errorClass._tag
  if (typeof existing === "string") {
    return existing
  }

  const identifier = errorClass.identifier
  if (typeof identifier !== "string") {
    throw new Error("Declared error class is missing an Effect Schema tag")
  }

  return identifier
}

export const tagOf = (errorClass: TaggedErrorClass): string =>
  errorClassTag(errorClass)

const declaredErrorDecodeFailure = (
  input: unknown,
  message: string,
  declaredTag?: string,
): StdbDecodeError =>
  new StdbDecodeError({
    phase: "declaredError",
    cause: new Error(`${message}: ${String(readTag(input) ?? "")}`),
    ...(declaredTag != null ? { declaredTag } : {}),
  })

const declaredErrorSchemaFailure = (
  cause: ParseResult.ParseError,
  declaredTag?: string,
): StdbDecodeError =>
  new StdbDecodeError({
    phase: "declaredError",
    cause,
    ...(declaredTag != null ? { declaredTag } : {}),
  })

const declaredSchemaFor = <Definition extends AnyErrorDefinition>(
  definition: Definition,
  error: unknown,
): Definition["errors"][number] | undefined => {
  const tag = readTag(error)
  return tag != null
    ? definition.errors.find((candidate) => tagOf(candidate) === tag)
    : undefined
}

const defineBase = <const Errors extends readonly TaggedErrorClass[]>(
  ...errors: Errors
): ErrorDefinition<Errors> => {
  if (errors.length === 0) {
    throw new Error("Error.define(...) requires at least one tagged error")
  }

  const tags = errors.map((error) => tagOf(error))
  const duplicateTag = tags.find((tag, index) => tags.indexOf(tag) !== index)
  if (duplicateTag != null) {
    throw new Error(
      `Error.define(...) received duplicate error tag ${duplicateTag}`,
    )
  }

  const reservedTag = tags.find((tag) => ReservedDeclaredErrorTags.has(tag))
  if (reservedTag != null) {
    throw new Error(
      `Error.define(...) cannot declare reserved wrapper error tag ${reservedTag}`,
    )
  }

  const unionSchema = Schema.Union(errors) as Schema.Top
  const schema = unionSchema as Schema.Codec<
    ErrorInstanceOf<Errors>,
    unknown,
    never,
    never
  >
  const type = Type.string()

  const definition = {
    errors,
    tags: new Set(tags) as ReadonlySet<ErrorTagOf<Errors[number]>>,
    schema,
    type,
    pick: (...pickedTags) => {
      const selected = errors.filter((error) =>
        (pickedTags as ReadonlyArray<string>).includes(tagOf(error)),
      )

      if (selected.length !== pickedTags.length) {
        throw new Error(
          `Error.define(...).pick(...) received an unknown error tag`,
        )
      }

      return define(
        ...(selected as unknown as PickedErrorClasses<
          Errors,
          (typeof pickedTags)[number]
        >),
      )
    },
  } satisfies ErrorDefinition<Errors>

  return definition
}

const makeGeneratedErrorClass = <
  const Tag extends string,
  const Fields extends ErrorFields,
  const Status extends number | undefined,
>(
  tag: Tag,
  fields: Fields,
  status: Status,
): GeneratedErrorClass<Tag, Fields, Status> => {
  const schemaFields = typedFromEntries(
    Object.entries(fields).map(([key, value]) => [key, value.schema] as const),
  )
  const annotations =
    typeof status === "number" ? { httpApiStatus: status } : undefined
  const Tagged = Schema.TaggedErrorClass<GeneratedError<Tag, Fields>>()(
    tag,
    schemaFields as never,
    annotations,
  ) as unknown as GeneratedErrorClass<Tag, Fields, Status>

  Object.defineProperty(Tagged, "_tag", {
    configurable: true,
    enumerable: true,
    value: tag,
  })
  Object.defineProperty(Tagged, "httpStatus", {
    configurable: true,
    enumerable: true,
    value: status,
  })

  return Tagged
}

export const namespace =
  <const Namespace extends string>(namespaceName: Namespace) =>
  <const Specs extends ErrorSpecRecord>(
    specs: Specs,
  ): NamespacedErrorDefinition<Namespace, Specs> => {
    const classes = Object.fromEntries(
      Object.entries(specs).map(([key, spec]) => [
        key,
        makeGeneratedErrorClass(
          `${namespaceName}${key}`,
          spec.fields,
          spec.status,
        ),
      ]),
    ) as ErrorClassRecord<Namespace, Specs>

    const definition = defineBase(...Object.values(classes)) as ErrorDefinition<
      ReadonlyArray<ErrorClassRecord<Namespace, Specs>[keyof Specs & string]>
    >

    return Object.assign(definition, classes)
  }

export const merge = <const Definitions extends NonEmptyErrorDefinitions>(
  ...defs: Definitions
): ErrorDefinition<MergedErrorClasses<Definitions>> => {
  const seen = new Set<TaggedErrorClass>()
  const classes: Array<Definitions[number]["errors"][number]> = []

  for (const definition of defs) {
    for (const errorClass of definition.errors) {
      if (!seen.has(errorClass)) {
        seen.add(errorClass)
        classes.push(errorClass)
      }
    }
  }

  return defineBase(...classes)
}

const isErrorDefinition = (
  input: ErrorsInputItem,
): input is AnyErrorDefinition =>
  typeof input === "object" && Array.isArray(input.errors)

export const normalizeErrorsInput = <const Input extends ErrorsInput>(
  input: Input,
): DefinitionOfInput<Input> => {
  if (!Array.isArray(input)) {
    const item = input as ErrorsInputItem
    if (isErrorDefinition(item)) {
      return item as DefinitionOfInput<Input>
    }
  }

  const items = (
    Array.isArray(input) ? input : [input]
  ) as ReadonlyArray<ErrorsInputItem>
  const seen = new Set<TaggedErrorClass>()
  const classes: Array<TaggedErrorClass> = []

  for (const item of items) {
    if (isErrorDefinition(item)) {
      for (const errorClass of item.errors) {
        if (!seen.has(errorClass)) {
          seen.add(errorClass)
          classes.push(errorClass)
        }
      }
    } else if (!seen.has(item)) {
      seen.add(item)
      classes.push(item)
    }
  }

  return defineBase(...classes) as unknown as DefinitionOfInput<Input>
}

export const define = Object.assign(defineBase, { namespace, merge })

export const matchEffect = <Definition extends AnyErrorDefinition>(
  definition: Definition,
  error: unknown,
): Effect.Effect<
  Option.Option<ErrorInstances<Definition>>,
  StdbDecodeError,
  never
> => {
  const schema = declaredSchemaFor(definition, error)
  if (schema == null) {
    return Effect.succeed(Option.none())
  }

  return Schema.decodeUnknownEffect(
    schema as unknown as Schema.Codec<
      ErrorInstances<Definition>,
      unknown,
      never,
      never
    >,
  )(error).pipe(
    Effect.map((decoded) => Option.some(decoded)),
    Effect.mapError(
      (cause) =>
        new StdbDecodeError({
          phase: "declaredError",
          declaredTag: tagOf(schema),
          cause,
        }),
    ),
  )
}

// lint-ignore: string-param-only-decoded - SpaceTimeDB reducer failures arrive as encoded strings.
export const peekStringEnvelopeTag = (value: string): string | undefined => {
  const decoded = Schema.decodeUnknownOption(TaggedErrorEnvelopeStringSchema)(
    value,
  )
  return Option.match(decoded, {
    onNone: () => undefined,
    onSome: (envelope) => envelope.tag,
  })
}

export const encodeString = <Definition extends AnyErrorDefinition>(
  definition: Definition,
  error: ErrorInstances<Definition>,
): Effect.Effect<string, StdbDecodeError, never> =>
  Schema.encodeEffect(Schema.toCodecJson(definition.schema))(error).pipe(
    Effect.mapError((cause) =>
      declaredErrorSchemaFailure(cause, readTag(error)),
    ),
    Effect.flatMap((encoded) => {
      const encodedTag = readTag(encoded)
      const runtimeTag = readTag(error)
      if (encodedTag == null) {
        return Effect.fail(
          declaredErrorDecodeFailure(
            encoded,
            "Declared error encoding did not include a _tag",
          ),
        )
      }

      if (runtimeTag != null && runtimeTag !== encodedTag) {
        return Effect.fail(
          declaredErrorDecodeFailure(
            encoded,
            "Declared error encoding produced a _tag that does not match the runtime error tag",
            encodedTag,
          ),
        )
      }

      return Schema.encodeEffect(TaggedErrorEnvelopeStringSchema)({
        _effectSpacetimeDb: "DeclaredError",
        version: DeclaredErrorEnvelopeVersion,
        tag: encodedTag,
        error: encoded,
      }).pipe(
        Effect.mapError((cause) =>
          declaredErrorSchemaFailure(cause, encodedTag),
        ),
      )
    }),
    Effect.map((value) => value),
  )

// lint-ignore: string-param-only-decoded - declared reducer errors are transported as encoded strings.
export const decodeString = <Definition extends AnyErrorDefinition>(
  definition: Definition,
  value: string,
): Effect.Effect<ErrorInstances<Definition>, StdbDecodeError, never> =>
  Schema.decodeUnknownEffect(TaggedErrorEnvelopeStringSchema)(value).pipe(
    Effect.mapError((cause) => declaredErrorSchemaFailure(cause)),
    Effect.flatMap((envelope) => {
      const schema = definition.errors.find(
        (candidate) => tagOf(candidate) === envelope.tag,
      )
      const innerTag = readTag(envelope.error)

      if (schema == null) {
        return Effect.fail(
          declaredErrorDecodeFailure(
            envelope,
            "Declared error envelope tag is not declared by this definition",
            envelope.tag,
          ),
        )
      }

      if (innerTag !== envelope.tag) {
        return Effect.fail(
          declaredErrorDecodeFailure(
            envelope,
            "Declared error envelope tag does not match a declared payload tag",
            envelope.tag,
          ),
        )
      }

      return Schema.decodeUnknownEffect(
        Schema.toCodecJson(
          schema as unknown as Schema.Codec<
            ErrorInstances<Definition>,
            unknown,
            never,
            never
          >,
        ),
      )(envelope.error).pipe(
        Effect.mapError((cause) =>
          declaredErrorSchemaFailure(cause, envelope.tag),
        ),
      )
    }),
    Effect.map((decoded) => decoded),
  )
