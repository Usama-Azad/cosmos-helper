# Cosmos Helpers

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# Cosmos BaseRepository

> 🚀 BaseRepository for Azure Cosmos DB  
> Supports functions like `count`, `create`, `update`, `delete`, `find`, `findFirst`, `findById` and `findWithPagination`.

---

# Cosmos Query Builder

> 🚀 Secure dynamic query builder for Azure Cosmos DB  
> Supports nested conditions, pagination, `LIKE`, `IN`, `NOT IN`, `IS NULL`, subqueries.

---

## Features

- ✅ Dynamic queries with nested `AND`/`OR` conditions
- ✅ Safe field name and operator validation
- ✅ Automatic pagination support
- ✅ Cosmos DB compatible syntax
- ✅ Subqueries inside `IN`, `NOT IN`
- ✅ `IS NULL` / `IS NOT NULL` support
- ✅ String length protection
- ✅ Fluent Chainable API

---

## Install Locally

```bash
npm install /path/to/cosmos-helper
npm install /path/to/cosmos-helper/cosmos-helper-1.0.0.tgz
```

## Quick Usage

### 1. Build Conditions

```js
import { FluentQueryBuilder, findWithPagination } from "cosmos-query-builder";

// Build conditions
const { condition } = new FluentQueryBuilder()
  .where("status", "=", "pending")
  .orWhere("status", "=", "accepted")
  .andWhere("type", "=", "invited")
  .build();
```

### 2. Execute Find With Pagination

```js
const results =
  (await findWithPagination) <
  User >
  (container, // Cosmos DB container
  condition, // Built condition
  {
    select: "id, status, type",
    limit: 10,
    offset: 0,
    orderBy: "createdAt",
    orderDirection: "desc",
  });
```

## Subquery Support

```js
const subquery = {
  type: "subquery",
  query: "SELECT c.userId FROM c WHERE c.role = 'admin'",
};

const { condition } = new FluentQueryBuilder()
  .where("id", "IN", subquery)
  .build();
```

## IS NULL/IS NOT NULL Support

```js
const { condition } = new FluentQueryBuilder()
  .where("deletedAt", "IS NULL")
  .build();
```
