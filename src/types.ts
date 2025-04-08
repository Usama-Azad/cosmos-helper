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
  | "IS NULL"
  | "IS NOT NULL";

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
  total: number;
  limit: number;
  offset: number;
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

export interface QueryResponse<T> {
  resources: T[];
}

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
