export type LifecycleName = "init" | "clientConnected" | "clientDisconnected"

export type LifecycleSpec<N extends LifecycleName = LifecycleName> = {
  readonly kind: "lifecycle"
  readonly hook: N
}

export type LifecycleSpecs = Partial<{
  readonly [Name in LifecycleName]: LifecycleSpec<Name>
}>

export const isLifecycleName = (name: string): name is LifecycleName => {
  switch (name) {
    case "init":
    case "clientConnected":
    case "clientDisconnected":
      return true
  }
  return false
}

export const lifecycle = <const N extends LifecycleName>(
  hook: N,
): LifecycleSpec<N> => ({ kind: "lifecycle", hook })
