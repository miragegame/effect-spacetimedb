// lint-ignore: stdb-string-columns-require-domain, stdb-numeric-columns-require-domain - interop tests intentionally exercise raw STDB schema constructors
import * as StdbTesting from "effect-spacetimedb/testing"
import * as Stdb from "effect-spacetimedb"

void StdbTesting.ContractTypeCodec.ws.encode(Stdb.string(), "ok")
void StdbTesting.ContractTypeDescriptor.descriptor(Stdb.string())
void StdbTesting.ContractTypeSats.typeBuilderWithFactories
void StdbTesting.ContractTypeSchemaFallback.unsupportedTypeMessage(["root"])
void StdbTesting.ClientTransportCodec.ws
void StdbTesting.ClientGeneratedWsAdapter.configureGeneratedWsBuilder
