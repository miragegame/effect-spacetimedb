// Module ids and `spec.name` are the same by construction: StdbModule.make
// assembles the spec from the module state id. This brand is compile-time only.
export declare const ModuleBrandTypeId: unique symbol

export type ModuleBrand<Name extends string> = {
  readonly [ModuleBrandTypeId]: Name
}
