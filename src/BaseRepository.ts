import {
  Container,
  Condition,
  BaseEntity,
  WhereClause,
  QueryOptions,
  PaginationResult,
} from "./types";
import { v4 as uuidv4 } from "uuid";
import { QueryBuilder } from "./QueryBuilder";
import { getObjectByKeys, objReplace } from "./helpers";

export abstract class BaseRepository<T extends BaseEntity> {
  public container: Container;
  private builder: QueryBuilder;

  constructor(container: Container) {
    this.container = container;
    this.builder = new QueryBuilder();
  }

  private buildSelect(select?: string): string {
    return select
      ? select
          .split(",")
          .map((field) => field.trim())
          .filter((field) => /^[a-zA-Z0-9_]+$/.test(field))
          .map((field) => `c.${field}`)
          .join(", ")
      : "*";
  }

  private buildWhere(filters?: Condition<T>): WhereClause {
    if (filters) {
      return this.builder.build(filters);
    }
    return { whereClause: "1=1", parameters: [] };
  }

  async count(filters?: Condition<T>): Promise<number> {
    const { whereClause, parameters } = this.buildWhere(filters);

    const query = `SELECT VALUE COUNT(1) FROM c WHERE ${whereClause}`;
    const { resources } = await this.container.items
      .query<number>({ query, parameters })
      .fetchAll();

    return resources[0];
  }

  async findById<X extends T>(id: string, partitionKey?: string): Promise<X> {
    try {
      const { resource } = await this.container
        .item(id, partitionKey)
        .read<X>();
      return resource as X;
    } catch (error) {
      throw error;
    }
  }

  async find(filters?: Condition<T>, select?: string): Promise<T[]> {
    const { whereClause, parameters } = this.buildWhere(filters);

    const query = `SELECT ${this.buildSelect(
      select
    )} FROM c WHERE ${whereClause}`;
    const { resources } = await this.container.items
      .query<T>({ query, parameters })
      .fetchAll();
    return resources as T[];
  }

  async findFirst(
    filters?: Condition<T>,
    optionsOrSelect?: Omit<QueryOptions, "limit"> | string
  ): Promise<T | null> {
    // If optionsOrSelect is a string, it's a select clause
    if (!optionsOrSelect || typeof optionsOrSelect === "string") {
      const items = await this.find(filters, optionsOrSelect);
      return items.length > 0 ? items[0] : null;
    }
    // Otherwise it's query options
    else {
      const items = await this.findWithPagination<T>(filters, {
        ...optionsOrSelect,
        limit: 1,
      });
      return items.items.length > 0 ? items.items[0] : null;
    }
  }

  async create(
    item: Partial<Pick<T, "id" | "createdAt" | "updatedAt" | "deletedAt">> &
      Omit<T, "id" | "createdAt" | "updatedAt" | "deletedAt">,
    options: { prefixId?: string; checkForExisting?: string } = {}
  ): Promise<T> {
    try {
      if (options.checkForExisting) {
        const existingItem = await this.findFirst(
          getObjectByKeys(item as any, options.checkForExisting),
          "id"
        );
        if (existingItem) {
          throw new Error(`Item already exists`);
        }
      }

      const date = new Date();
      const now = date.toISOString();
      const id = `${options.prefixId ? options.prefixId + "-" : ""}${uuidv4()}`;
      const items = objReplace(item, { id, now });
      const itemWithDates = {
        ...{ id },
        ...items,
        createdAt: now,
        updatedAt: now,
      };

      const { resource } = await this.container.items.create(itemWithDates);
      return resource as T;
    } catch (error) {
      throw error;
    }
  }

  async update(
    id: string,
    data: Partial<T>,
    partitionKey?: string
  ): Promise<T> {
    try {
      const existingItem = await this.findById(id, partitionKey);
      const updatedItem = {
        ...existingItem,
        ...data,
        updatedAt: new Date().toISOString(),
      };

      const { resource } = await this.container
        .item(id, partitionKey)
        .replace(updatedItem);

      return resource as T;
    } catch (error) {
      throw error;
    }
  }

  async delete(id: string, partitionKey?: string): Promise<T> {
    const { resource } = await this.container.item(id, partitionKey).delete();
    return resource as T;
  }

  async softDelete(id: string, partitionKey?: string): Promise<T> {
    try {
      const now = new Date().toISOString();
      const existingItem = await this.findById(id, partitionKey);
      const deletedItem = {
        ...existingItem,
        updatedAt: now,
        deletedAt: now,
      };

      const { resource } = await this.container
        .item(id, partitionKey)
        .replace(deletedItem);

      return resource as T;
    } catch (error) {
      throw error;
    }
  }

  async findWithPagination<T>(
    filters?: Condition<T>,
    options?: QueryOptions
  ): Promise<PaginationResult<T>> {
    const {
      select,
      limit = 20,
      offset = 0,
      orderBy = "createdAt",
      orderDirection = "desc",
    } = options || {};

    const selectClause = this.buildSelect(select);

    if (!/^[a-zA-Z0-9_]+$/.test(orderBy)) {
      throw new Error(`Invalid characters in orderBy field name`);
    }

    const { whereClause, parameters } = this.buildWhere(filters as any);

    const countQuery = `SELECT VALUE COUNT(1) FROM c WHERE ${whereClause}`;
    const { resources: countResult } = await this.container.items
      .query<number>({ query: countQuery, parameters })
      .fetchAll();
    const total = countResult[0];

    const query = `SELECT ${selectClause} FROM c WHERE ${whereClause} ORDER BY c.${orderBy} ${orderDirection.toUpperCase()} OFFSET ${offset} LIMIT ${limit}`;
    const { resources } = await this.container.items
      .query<T>({ query, parameters })
      .fetchAll();

    return {
      items: resources as T[],
      pagination: {
        total,
        limit,
        offset,
      },
    };
  }
}
