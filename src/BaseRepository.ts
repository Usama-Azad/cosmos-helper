import { randomUUID } from "crypto";
import {
  Container,
  Condition,
  BaseEntity,
  PartitionKey,
  QueryOptions,
  QueryParameter,
  WhereClause,
  PaginationResult,
} from "./types";
import { QueryBuilder } from "./QueryBuilder";
import { getObjectByKeys, objReplace } from "./helpers";

const FIELD = /^[a-zA-Z0-9_]+$/;
/** The largest page `findWithPagination` returns. */
export const MAX_PAGE_SIZE = 1000;
/** How many times `update` / `softDelete` retry after another writer won. */
const WRITE_ATTEMPTS = 3;

/** An error with the HTTP-style status Cosmos uses (`code`). */
export class RepositoryError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
    this.name = "RepositoryError";
  }
}

/**
 * A repository over one Cosmos container.
 *
 * Every query and point operation names its partition key: this class never
 * runs a cross-partition query, and an empty key is refused before anything
 * is sent. Subclasses name the field their container is partitioned on
 * (`partitionKeyField`), so `create` can check for an existing item inside
 * the new item's own partition.
 */
export abstract class BaseRepository<T extends BaseEntity> {
  /** The document field the container is partitioned on, e.g. "teamId". */
  protected abstract readonly partitionKeyField: string;

  constructor(public container: Container) {}

  /** A point read. Undefined when there is no such item. */
  async findById<X extends T = T>(
    id: string,
    partitionKey: PartitionKey
  ): Promise<X | undefined> {
    const { resource } = await this.container
      .item(id, keyOf(partitionKey))
      .read<X>();
    return resource;
  }

  async count(partitionKey: PartitionKey, filters?: Condition<T>): Promise<number> {
    const { whereClause, parameters } = whereOf(filters);
    const rows = await this.query<number>(
      partitionKey,
      `SELECT VALUE COUNT(1) FROM c WHERE ${whereClause}`,
      parameters
    );
    return rows[0] ?? 0;
  }

  async find(
    partitionKey: PartitionKey,
    filters?: Condition<T>,
    select?: string
  ): Promise<T[]> {
    const { whereClause, parameters } = whereOf(filters);
    return this.query<T>(
      partitionKey,
      `SELECT ${selectOf(select)} FROM c WHERE ${whereClause}`,
      parameters
    );
  }

  /** The first match, or null. Reads one item, not every match. */
  async findFirst(
    partitionKey: PartitionKey,
    filters?: Condition<T>,
    optionsOrSelect?: Omit<QueryOptions, "limit"> | string
  ): Promise<T | null> {
    if (typeof optionsOrSelect === "object") {
      const page = await this.page<T>(partitionKey, filters, { ...optionsOrSelect, limit: 1 });
      return page[0] ?? null;
    }
    const { whereClause, parameters } = whereOf(filters);
    const rows = await this.query<T>(
      partitionKey,
      `SELECT TOP 1 ${selectOf(optionsOrSelect)} FROM c WHERE ${whereClause}`,
      parameters
    );
    return rows[0] ?? null;
  }

  /** One page and the total. The count and the page run at the same time. */
  async findWithPagination<R = T>(
    partitionKey: PartitionKey,
    filters?: Condition<any>,
    options: QueryOptions = {}
  ): Promise<PaginationResult<R>> {
    // Everything is validated before either query is sent.
    const { limit, offset } = pagingOf(options);
    selectOf(options.select);
    const { whereClause, parameters } = whereOf(filters);
    const [totals, items] = await Promise.all([
      this.query<number>(partitionKey, `SELECT VALUE COUNT(1) FROM c WHERE ${whereClause}`, parameters),
      this.page<R>(partitionKey, filters, options),
    ]);
    return { items, pagination: { total: totals[0] ?? 0, limit, offset } };
  }

  /**
   * Creates an item with a new id (`<prefixId>-<uuid>`) and timestamps.
   * `checkForExisting` (comma-separated fields) refuses the create when an
   * item with the same values exists in the new item's partition. That
   * check is not atomic: give items a deterministic id when two creates may
   * race.
   */
  async create(
    item: Partial<Pick<T, "id" | "createdAt" | "updatedAt" | "deletedAt">> &
      Omit<T, "id" | "createdAt" | "updatedAt" | "deletedAt">,
    options: { prefixId?: string; checkForExisting?: string } = {}
  ): Promise<T> {
    if (options.checkForExisting) {
      const partitionKey = (item as Record<string, unknown>)[this.partitionKeyField];
      if (typeof partitionKey !== "string" || partitionKey.length === 0) {
        throw new Error(
          `create: checkForExisting needs the item's partition key (${this.partitionKeyField})`
        );
      }
      const existing = await this.findFirst(
        partitionKey,
        getObjectByKeys(item as Record<string, any>, options.checkForExisting) as Condition<T>,
        "id"
      );
      if (existing) {
        throw new RepositoryError("Item already exists", 409);
      }
    }

    const now = new Date().toISOString();
    const id = `${options.prefixId ? options.prefixId + "-" : ""}${randomUUID()}`;
    const { resource } = await this.container.items.create({
      id,
      ...objReplace(item as Record<string, any>, { id, now }),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return resource as T;
  }

  /**
   * Merges `data` into the item. The write is conditional on the version
   * read, so a concurrent change is never overwritten: on a conflict the item
   * is read again and the merge re-applied (up to 3 attempts).
   */
  async update(id: string, data: Partial<T>, partitionKey: PartitionKey): Promise<T> {
    return this.rewrite(id, partitionKey, (existing) => ({
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    }));
  }

  async delete(id: string, partitionKey: PartitionKey): Promise<T> {
    const { resource } = await this.container.item(id, keyOf(partitionKey)).delete();
    return resource as T;
  }

  async softDelete(id: string, partitionKey: PartitionKey): Promise<T> {
    return this.rewrite(id, partitionKey, (existing) => {
      const now = new Date().toISOString();
      return { ...existing, updatedAt: now, deletedAt: now };
    });
  }

  /**
   * A query inside one partition: the building block for a subclass's own
   * queries. Values go in `parameters`, never into the SQL text.
   */
  protected async query<R>(
    partitionKey: PartitionKey,
    query: string,
    parameters: QueryParameter[] = []
  ): Promise<R[]> {
    const { resources } = await this.container.items
      .query<R>({ query, parameters }, { partitionKey: keyOf(partitionKey) })
      .fetchAll();
    return resources;
  }

  private async page<R>(
    partitionKey: PartitionKey,
    filters: Condition<any> | undefined,
    options: QueryOptions
  ): Promise<R[]> {
    const { limit, offset, orderBy, orderDirection } = pagingOf(options);
    const { whereClause, parameters } = whereOf(filters);
    return this.query<R>(
      partitionKey,
      `SELECT ${selectOf(options.select)} FROM c WHERE ${whereClause} ` +
        `ORDER BY c.${orderBy} ${orderDirection} OFFSET ${offset} LIMIT ${limit}`,
      parameters
    );
  }

  private async rewrite(
    id: string,
    partitionKey: PartitionKey,
    change: (existing: T) => T
  ): Promise<T> {
    const item = this.container.item(id, keyOf(partitionKey));
    for (let attempt = 1; ; attempt++) {
      const { resource: existing } = await item.read<T & { _etag?: string }>();
      if (!existing) {
        throw new RepositoryError(`Item ${id} not found`, 404);
      }
      try {
        const options = existing._etag
          ? { accessCondition: { type: "IfMatch", condition: existing._etag } }
          : undefined;
        const { resource } = await item.replace(change(existing), options);
        return resource as T;
      } catch (error) {
        if (statusOf(error) !== 412 || attempt >= WRITE_ATTEMPTS) throw error;
      }
    }
  }
}

/** A partition key, never empty: an empty one would mean every partition. */
function keyOf(partitionKey: PartitionKey): PartitionKey {
  if (typeof partitionKey !== "string" || partitionKey.length === 0) {
    throw new Error("A partition key is required: cross-partition queries are not allowed");
  }
  return partitionKey;
}

function whereOf(filters?: Condition<any>): WhereClause {
  if (filters === undefined || filters === null) {
    return { whereClause: "true", parameters: [] };
  }
  return new QueryBuilder().build(filters);
}

function selectOf(select?: string): string {
  if (!select) return "*";
  const fields = select.split(",").map((field) => field.trim()).filter(Boolean);
  for (const field of fields) {
    if (!FIELD.test(field)) throw new Error(`Invalid field name in select: ${field}`);
  }
  return fields.length ? fields.map((field) => `c.${field}`).join(", ") : "*";
}

function pagingOf(options: QueryOptions) {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const orderBy = options.orderBy ?? "createdAt";
  const direction = (options.orderDirection ?? "desc").toString().toLowerCase();
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new Error(`limit must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }
  if (!FIELD.test(orderBy)) {
    throw new Error("Invalid characters in orderBy field name");
  }
  if (direction !== "asc" && direction !== "desc") {
    throw new Error('orderDirection must be "asc" or "desc"');
  }
  return { limit, offset, orderBy, orderDirection: direction.toUpperCase() };
}

function statusOf(error: unknown): number | undefined {
  const e = error as { code?: unknown; statusCode?: unknown } | null;
  const status = e?.code ?? e?.statusCode;
  return typeof status === "number" ? status : undefined;
}
