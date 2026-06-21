import * as StdbTesting from "effect-spacetimedb/testing"

type TestQueryRelation<Row> = StdbTesting.QueryRelation<Row> & {
  readonly where: <Predicate>(predicate: Predicate) => TestQueryRelation<Row>
}

export const makeQueryRelation = <Row>(sql = "SELECT * FROM user") => {
  const query: TestQueryRelation<Row> = {
    toSql: () => sql,
    build: () => query,
    where: () => query,
  } as unknown as TestQueryRelation<Row>

  return query
}
