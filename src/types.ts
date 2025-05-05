// src/types.ts

export type ConditionOperator =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "IN"
  | "NOT IN"
  | "LIKE"
  | "IS_BOOL"
  | "IS_NULL"
  | "IS_ARRAY"
  | "IS_NUMBER"
  | "IS_OBJECT"
  | "IS_STRING"
  | "IS_INTEGER"
  | "IS_DEFINED"
  | "IS_PRIMITIVE"
  | "IS_FINITE_NUMBER"
  | "IS_NOT_BOOL"
  | "IS_NOT_NULL"
  | "IS_NOT_ARRAY"
  | "IS_NOT_NUMBER"
  | "IS_NOT_OBJECT"
  | "IS_NOT_STRING"
  | "IS_NOT_INTEGER"
  | "IS_NOT_DEFINED"
  | "IS_NOT_PRIMITIVE"
  | "IS_NOT_FINITE_NUMBER";

export type LogicalOperator = "AND" | "OR";

export interface SimpleCondition {
  field: string;
  operator: ConditionOperator;
  value?: any;
}

export interface CompoundCondition {
  logicOperator: LogicalOperator;
  conditions: (SimpleCondition | CompoundCondition)[];
}

export type Condition<T> = SimpleCondition | CompoundCondition | Partial<T>;

export type Subquery = {
  type: "subquery";
  query: string;
  parameters?: { name: string; value: any }[];
};

export interface QueryOptions {
  select?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
}

export interface PaginationResult<T> {
  items: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface BaseEntity {
  id: string;
  [key: string]: any;
}

export interface Resource {
  id: string;
  _ts: number;
  _rid: string;
  _self: string;
  _etag: string;
  [key: string]: any;
}

export type CosmosResource<T> = T & Resource;

export interface QueryResponse<T> {
  resources: T[];
}

export type WhereClause = {
  whereClause: string;
  parameters: { name: string; value: any }[];
};

export declare class Container {
  items: {
    create<T>(body: T, options?: any): Promise<any>;
    query<T>(query: string): {
      fetchAll(): Promise<QueryResponse<T>>;
    };
    query<T>(options: {
      query: string;
      parameters: Array<{ name: string; value: any }>;
    }): {
      fetchAll(): Promise<QueryResponse<T>>;
    };
  };

  item(id: string, partitionKeyValue?: any): Container;

  read<T>(options?: any): Promise<any>;

  replace(body: any, options?: any): Promise<any>;

  delete(options?: any): Promise<any>;
}
