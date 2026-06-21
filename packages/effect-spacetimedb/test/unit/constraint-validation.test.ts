// lint-ignore: stdb-string-columns-require-domain, stdb-numeric-columns-require-domain - interop tests intentionally exercise raw STDB schema constructors
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const makeModule = (membershipTable: ReturnType<typeof Stdb.table>) =>
  Stdb.StdbModule.make("constraint_validation", {
    settings: {
      caseConversionPolicy: "none",
    },
  }).addTables(membershipTable).spec

describe("constraint validation", (it) => {
  it.effect(
    "allows single-column unique constraints backed by an implicit primary-key index",
    () =>
      Effect.gen(function* () {
        expect(() =>
          makeModule(
            Stdb.table("membership", {
              columns: {
                id: Stdb.string().primaryKey(),
                email: Stdb.string(),
              },
              constraints: [
                Stdb.unique({
                  name: "membership_id_unique",
                  columns: ["id"],
                }),
              ],
            }),
          ),
        ).not.toThrow()
      }),
  )

  it.effect(
    "accepts composite unique constraints when a matching index exists even if the index column order differs",
    () =>
      Effect.gen(function* () {
        expect(() =>
          makeModule(
            Stdb.table("membership", {
              columns: {
                tenantId: Stdb.string(),
                email: Stdb.string(),
                note: Stdb.string(),
              },
              indexes: [
                Stdb.index({
                  name: "membership_emailTenant_idx",
                  columns: ["email", "tenantId"],
                }),
              ],
              constraints: [
                Stdb.unique({
                  name: "membership_tenant_email_unique",
                  columns: ["tenantId", "email"],
                }),
              ],
            }),
          ),
        ).not.toThrow()
      }),
  )

  it.effect(
    "rejects empty index column selections at module definition time",
    () =>
      Effect.gen(function* () {
        expect(() =>
          makeModule(
            Stdb.table("membership", {
              columns: {
                tenantId: Stdb.string(),
                email: Stdb.string(),
              },
              indexes: [
                Stdb.index({
                  name: "membership_empty_idx",
                  columns: [],
                }),
              ],
            }),
          ),
        ).toThrow(
          "Index membership_empty_idx on table membership must reference at least one column",
        )
      }),
  )

  it.effect(
    "rejects duplicate columns inside an index definition during normalization",
    () =>
      Effect.gen(function* () {
        expect(() =>
          makeModule(
            Stdb.table("membership", {
              columns: {
                tenantId: Stdb.string(),
                email: Stdb.string(),
              },
              indexes: [
                Stdb.index({
                  name: "membership_duplicate_idx",
                  columns: ["tenantId", "tenantId"],
                }),
              ],
            }),
          ),
        ).toThrow(
          "Index membership_duplicate_idx on table membership references duplicate column tenantId",
        )
      }),
  )

  it.effect("rejects empty unique constraints at module definition time", () =>
    Effect.gen(function* () {
      expect(() =>
        makeModule(
          Stdb.table("membership", {
            columns: {
              tenantId: Stdb.string(),
              email: Stdb.string(),
            },
            constraints: [
              Stdb.unique({
                name: "membership_empty_unique",
                columns: [],
              }),
            ],
          }),
        ),
      ).toThrow(
        "Constraint membership_empty_unique on table membership must reference at least one column",
      )
    }),
  )

  it.effect(
    "rejects duplicate columns inside a unique constraint during normalization",
    () =>
      Effect.gen(function* () {
        expect(() =>
          makeModule(
            Stdb.table("membership", {
              columns: {
                tenantId: Stdb.string(),
                email: Stdb.string(),
              },
              indexes: [
                Stdb.index({
                  name: "membership_tenant_email_idx",
                  columns: ["tenantId", "email"],
                }),
              ],
              constraints: [
                Stdb.unique({
                  name: "membership_duplicate_unique",
                  columns: ["tenantId", "tenantId"],
                }),
              ],
            }),
          ),
        ).toThrow(
          "Constraint membership_duplicate_unique on table membership references duplicate column tenantId",
        )
      }),
  )

  it.effect(
    "rejects unique constraints that are not backed by a matching effective index",
    () =>
      Effect.gen(function* () {
        expect(() =>
          makeModule(
            Stdb.table("membership", {
              columns: {
                tenantId: Stdb.string(),
                email: Stdb.string(),
                note: Stdb.string(),
              },
              indexes: [
                Stdb.index({
                  name: "membership_tenant_note_idx",
                  columns: ["tenantId", "note"],
                }),
              ],
              constraints: [
                Stdb.unique({
                  name: "membership_tenant_email_unique",
                  columns: ["tenantId", "email"],
                }),
              ],
            }),
          ),
        ).toThrow(
          "Unique constraint membership_tenant_email_unique on table membership must be backed by a matching index or primary key",
        )
      }),
  )
})
