import * as Stdb from "effect-spacetimedb"

// @ts-expect-error internal IR must not be exported from the public root
void Stdb.ModuleIR

// @ts-expect-error client IR must not be exported from the public root
void Stdb.ClientIR

// @ts-expect-error internal module plan must not be exported from the public root
void Stdb.ModulePlan

// @ts-expect-error example modules must stay package-local
void Stdb.LiveModule
