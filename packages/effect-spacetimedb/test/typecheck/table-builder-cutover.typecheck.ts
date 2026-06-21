// lint-ignore: stdb-string-columns-require-domain - interop typecheck fixture intentionally exercises raw STDB schema constructors
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
const cutover_user = Stdb.table("cutover_user", {
  public: true,
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const raw_audit = Stdb.table("raw_audit", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})

const cutoverUserName: "cutover_user" = cutover_user.name
const rawAuditName: "raw_audit" = raw_audit.name
void cutoverUserName
void rawAuditName

const CutoverModule = Stdb.StdbModule.make(
  "table_builder_cutover_typecheck",
  {},
)
  .addTables(cutover_user)
  .addTables(raw_audit)

void CutoverModule.spec.tables.cutover_user
void CutoverModule.spec.tables.raw_audit

void Effect.gen(function* () {
  const db = yield* CutoverModule.Db
  void db.cutover_user.id.find
  void db.raw_audit.id.find
})

void Stdb.StdbModule.make("old_table_shape", {
  // @ts-expect-error StdbModule.make no longer accepts table records; use addTables.
  tables: {},
})

const scale_01 = Stdb.table("scale_01", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_02 = Stdb.table("scale_02", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_03 = Stdb.table("scale_03", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_04 = Stdb.table("scale_04", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_05 = Stdb.table("scale_05", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_06 = Stdb.table("scale_06", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_07 = Stdb.table("scale_07", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_08 = Stdb.table("scale_08", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_09 = Stdb.table("scale_09", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_10 = Stdb.table("scale_10", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_11 = Stdb.table("scale_11", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_12 = Stdb.table("scale_12", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_13 = Stdb.table("scale_13", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_14 = Stdb.table("scale_14", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_15 = Stdb.table("scale_15", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_16 = Stdb.table("scale_16", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_17 = Stdb.table("scale_17", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_18 = Stdb.table("scale_18", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_19 = Stdb.table("scale_19", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_20 = Stdb.table("scale_20", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_21 = Stdb.table("scale_21", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_22 = Stdb.table("scale_22", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_23 = Stdb.table("scale_23", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_24 = Stdb.table("scale_24", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_25 = Stdb.table("scale_25", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_26 = Stdb.table("scale_26", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_27 = Stdb.table("scale_27", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_28 = Stdb.table("scale_28", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_29 = Stdb.table("scale_29", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_30 = Stdb.table("scale_30", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_31 = Stdb.table("scale_31", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_32 = Stdb.table("scale_32", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_33 = Stdb.table("scale_33", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_34 = Stdb.table("scale_34", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_35 = Stdb.table("scale_35", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_36 = Stdb.table("scale_36", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_37 = Stdb.table("scale_37", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_38 = Stdb.table("scale_38", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_39 = Stdb.table("scale_39", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_40 = Stdb.table("scale_40", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_41 = Stdb.table("scale_41", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_42 = Stdb.table("scale_42", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_43 = Stdb.table("scale_43", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_44 = Stdb.table("scale_44", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_45 = Stdb.table("scale_45", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_46 = Stdb.table("scale_46", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_47 = Stdb.table("scale_47", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_48 = Stdb.table("scale_48", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_49 = Stdb.table("scale_49", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_50 = Stdb.table("scale_50", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_51 = Stdb.table("scale_51", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_52 = Stdb.table("scale_52", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_53 = Stdb.table("scale_53", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_54 = Stdb.table("scale_54", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_55 = Stdb.table("scale_55", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_56 = Stdb.table("scale_56", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_57 = Stdb.table("scale_57", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_58 = Stdb.table("scale_58", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_59 = Stdb.table("scale_59", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_60 = Stdb.table("scale_60", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_61 = Stdb.table("scale_61", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_62 = Stdb.table("scale_62", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_63 = Stdb.table("scale_63", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_64 = Stdb.table("scale_64", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_65 = Stdb.table("scale_65", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_66 = Stdb.table("scale_66", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_67 = Stdb.table("scale_67", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_68 = Stdb.table("scale_68", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_69 = Stdb.table("scale_69", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_70 = Stdb.table("scale_70", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_71 = Stdb.table("scale_71", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})
const scale_72 = Stdb.table("scale_72", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})

const scaleDomainA = [
  scale_01,
  scale_02,
  scale_03,
  scale_04,
  scale_05,
  scale_06,
  scale_07,
  scale_08,
  scale_09,
  scale_10,
  scale_11,
  scale_12,
  scale_13,
  scale_14,
  scale_15,
  scale_16,
  scale_17,
  scale_18,
  scale_19,
  scale_20,
  scale_21,
  scale_22,
  scale_23,
  scale_24,
] as const
const scaleDomainB = [
  scale_25,
  scale_26,
  scale_27,
  scale_28,
  scale_29,
  scale_30,
  scale_31,
  scale_32,
  scale_33,
  scale_34,
  scale_35,
  scale_36,
  scale_37,
  scale_38,
  scale_39,
  scale_40,
  scale_41,
  scale_42,
  scale_43,
  scale_44,
  scale_45,
  scale_46,
  scale_47,
  scale_48,
] as const
const scaleDomainC = [
  scale_49,
  scale_50,
  scale_51,
  scale_52,
  scale_53,
  scale_54,
  scale_55,
  scale_56,
  scale_57,
  scale_58,
  scale_59,
  scale_60,
  scale_61,
  scale_62,
  scale_63,
  scale_64,
  scale_65,
  scale_66,
  scale_67,
  scale_68,
  scale_69,
  scale_70,
  scale_71,
  scale_72,
] as const

const ScaleModule = Stdb.StdbModule.make("table_builder_scale_typecheck", {})
  .addTables(...scaleDomainA)
  .addTables(...scaleDomainB)
  .addTables(...scaleDomainC)

void Effect.gen(function* () {
  const db = yield* ScaleModule.Db
  void db.scale_01.id.find
  void db.scale_36.id.find
  void db.scale_72.id.find
})
