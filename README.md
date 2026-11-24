# cosmos-helper

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A small repository base class and a safe query builder for Azure Cosmos DB.

**Every query runs inside one partition.** Each query and point operation takes the partition key, and an empty key is refused before anything is sent. This package never runs a cross-partition query.

## Install

```bash
npm install github:Usama-Azad/cosmos-helper#v0.1.0
```

## BaseRepository

```ts
import { BaseRepository } from "cosmos-helper";

class TeamMemberRepository extends BaseRepository<TeamMember> {
  // The field the container is partitioned on.
  protected readonly partitionKeyField = "teamId";

  constructor() {
    super(getDbContainer("Teams"));
  }
}

const repo = new TeamMemberRepository();

await repo.findById(memberId, teamId);                          // point read; undefined if missing
await repo.find(teamId, { teamId, type: "member" });             // all matches
await repo.findFirst(teamId, { teamId, userId }, "id,status");   // SELECT TOP 1
await repo.count(teamId, { teamId, status: "pending" });
await repo.findWithPagination(teamId, filter, { limit: 20, offset: 0, orderBy: "createdAt", orderDirection: "desc" });
await repo.create(member, { prefixId: "member", checkForExisting: "userId,teamId,type" });
await repo.update(memberId, { status: "accepted" }, teamId);
await repo.softDelete(memberId, teamId);
await repo.delete(memberId, teamId);
```

The methods behave as follows:

- **Partition key:** every query method takes the partition key first. Point operations take it last, after the id.
- **`findFirst`:** reads one item (`SELECT TOP 1`), not every match.
- **`findWithPagination`:** sends the count query and the page query at the same time. It validates `limit` (1–1000), `offset`, `orderBy`, `orderDirection` and `select` before sending anything.
- **`create` with `checkForExisting`:** looks for a duplicate in the new item's own partition, read from `partitionKeyField`. A duplicate is refused with a `RepositoryError` (`code: 409`). The check is not atomic: give items a deterministic id when two creates may race.
- **`update` and `softDelete`:**
  - They write only if the item hasn't changed since it was read (an ETag `IfMatch` check).
  - If another writer changed it first, they read it again and re-apply the change, up to 3 attempts.
  - A missing item throws a `RepositoryError` with `code: 404`.
- **Custom queries in a subclass:** use `this.query(partitionKey, sql, parameters)`.

## Conditions

There are three ways to write a filter:

- **A plain object** means "every field equals its value": `{ teamId, type: "member" }`.
- **A simple condition:** `{ field: "status", operator: "IN", value: ["a", "b"] }`.
- **A compound condition:** `{ logicOperator: "OR", conditions: [...] }`. These can be nested.

Supported operators:

- **Comparisons:** `=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`.
- **Lists:** `IN` and `NOT IN`, which take an array.
- **Type checks:** `IS_DEFINED`, `IS_NULL`, `IS_STRING` and the rest, plus an `IS_NOT_` form of each.

Field names and operators are validated, and every value is sent as a query parameter. These are refused:

- an `undefined` value, because it would silently match nothing;
- an object value;
- a string longer than 1000 characters.

These have defined results:

- An empty `IN` list matches nothing, and an empty `NOT IN` list matches everything.
- An empty AND group matches everything, and an empty OR group matches nothing.

```ts
import { x, appendCondition, FluentQueryBuilder } from "cosmos-helper";

x({ teamId, status: "pending" });                 // teamId = @p0 AND status = @p1
appendCondition(clientFilter, { ownerId });        // ownerId = @p AND (clientFilter), whatever clientFilter is

const { condition } = new FluentQueryBuilder()
  .where("status", "=", "pending")
  .orWhere("status", "=", "accepted")
  .build();
```

`appendCondition` always ANDs the new fields with the *whole* existing filter, so a client's OR filter can't widen a scope you add.

## Changes in 0.1.0 (breaking)

- **Partition key required everywhere.** Query methods take it as their first argument, and point operations take it as required. Subclasses declare `partitionKeyField`.
- **Query parameters no longer leak between queries.** Before, one `QueryBuilder` kept every past query's parameters and sent them with every later query.
- **`appendCondition` keeps an OR filter as one group.** Before, it flattened the group into ANDed conditions.
- **Subqueries removed.** `IN` with a raw SQL subquery wrote that SQL text into the query.
- **Paging options validated.** `orderDirection` was written into the SQL unchecked.
- **`update` and `softDelete` are conditional writes,** and they return a 404 for a missing item.
- **`findFirst` reads one item.** The count and page queries run in parallel.
- **`objReplace` leaves an unknown `{placeholder}` as it is.** Before, it repeated the whole string.
- **`create` uses `crypto.randomUUID`,** so there is no `uuid` dependency.
- **Tests added** (`npm test`).
