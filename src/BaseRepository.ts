import {
  Resource,
  Container,
  BaseEntity,
  QueryOptions,
  SimpleCondition,
  PaginationResult,
  CompoundCondition,
} from "./types";
import { QueryBuilder } from "./QueryBuilder";

type CosmosResource<T> = T & Resource;

export abstract class BaseRepository<T extends BaseEntity> {
  protected container: Container;

  constructor(container: Container) {
    this.container = container;
  }

  async findById(id: string, partitionKey?: string): Promise<T> {
    try {
      const { resource } = await this.container
        .item(id, partitionKey)
        .read<CosmosResource<T>>();
      return resource as T;
    } catch (error) {
      throw error;
    }
  }

  async find(
    filters?: SimpleCondition | CompoundCondition,
    select?: string
  ): Promise<T[]> {
    // Validate and sanitize select fields
    select = select
      ? select
          .split(",")
          .map((field) => field.trim())
          .filter((field) => {
            // Sanitize field name to prevent SQL injection
            if (!/^[a-zA-Z0-9_]+$/.test(field)) {
              throw new Error(`Invalid characters in field name: ${field}`);
            }
            return true;
          })
          .map((field) => `c.${field}`)
          .join(", ")
      : "*";

    let whereClause = "1=1";
    let parameters: { name: string; value: any }[] = [];

    if (filters) {
      const builder = new QueryBuilder();
      const built = builder.build(filters);
      whereClause = built.whereClause;
      parameters = built.parameters;
    }

    const query = `SELECT ${select} FROM c WHERE ${whereClause}`;
    const { resources } = await this.container.items
      .query<CosmosResource<T>>({ query, parameters })
      .fetchAll();
    return resources as T[];
  }

  async create(item: T): Promise<T> {
    try {
      const now = new Date().toISOString();
      const itemWithDates = {
        ...item,
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
      const existingItem = await this.findById(id, partitionKey);
      const deletedItem = {
        ...existingItem,
        isDeleted: true,
        updatedAt: new Date().toISOString(),
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
    filters?: SimpleCondition | CompoundCondition,
    options?: QueryOptions
  ): Promise<PaginationResult<T>> {
    const {
      select,
      limit = 20,
      offset = 0,
      orderBy = "createdAt",
      orderDirection = "desc",
    } = options || {};

    const selectClause = select
      ? select
          .split(",")
          .map((field) => field.trim())
          .filter((field) => /^[a-zA-Z0-9_]+$/.test(field))
          .map((field) => `c.${field}`)
          .join(", ")
      : "*";

    if (!/^[a-zA-Z0-9_]+$/.test(orderBy)) {
      throw new Error(`Invalid characters in orderBy field name`);
    }

    let whereClause = "1=1";
    let parameters: { name: string; value: any }[] = [];

    if (filters) {
      const builder = new QueryBuilder();
      const built = builder.build(filters);
      whereClause = built.whereClause;
      parameters = built.parameters;
    }

    const countQuery = `SELECT VALUE COUNT(1) FROM c WHERE ${whereClause}`;
    const { resources: countResult } = await this.container.items
      .query<number>({ query: countQuery, parameters })
      .fetchAll();
    const total = countResult[0];

    const query = `SELECT ${selectClause} FROM c WHERE ${whereClause} ORDER BY c.${orderBy} ${orderDirection.toUpperCase()} OFFSET ${offset} LIMIT ${limit}`;
    const { resources } = await this.container.items
      .query<Resource>({ query, parameters })
      .fetchAll();

    return {
      items: resources as T[],
      total,
      limit,
      offset,
    };
  }
}
