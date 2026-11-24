// src/QueryBuilder.ts

import {
  Condition,
  QueryParameter,
  SimpleCondition,
  CompoundCondition,
} from "./types";
import { isSimpleOrCompoundCondition, x } from "./helpers";
import { allowedOperators, typeCheckingOperators } from "./consts";

const FIELD = /^[a-zA-Z0-9_]+$/;
const MAX_STRING_LENGTH = 1000;

/**
 * Turns a condition into a parameterised Cosmos SQL WHERE clause. Field
 * names and operators are validated; every value is a query parameter, so no
 * value is ever written into the SQL text.
 *
 * Each `build` starts from a clean state, so one builder can be reused.
 */
export class QueryBuilder {
  private parameters: QueryParameter[] = [];
  private paramIndex = 0;

  build<T>(condition: Condition<T>): {
    whereClause: string;
    parameters: QueryParameter[];
  } {
    this.parameters = [];
    this.paramIndex = 0;
    const normalized = isSimpleOrCompoundCondition(condition)
      ? condition
      : x(condition);
    const whereClause = this.buildWhereClause(normalized);
    return { whereClause, parameters: this.parameters };
  }

  private buildWhereClause(
    condition: SimpleCondition | CompoundCondition
  ): string {
    if ("field" in condition) {
      return this.buildSimpleCondition(condition);
    }
    if (condition.logicOperator !== "AND" && condition.logicOperator !== "OR") {
      throw new Error(`Invalid logic operator: ${condition.logicOperator}`);
    }
    if (!Array.isArray(condition.conditions)) {
      throw new Error("A compound condition needs a conditions array");
    }
    // An empty AND matches everything, an empty OR matches nothing.
    if (condition.conditions.length === 0) {
      return condition.logicOperator === "AND" ? "true" : "false";
    }
    const subClauses = condition.conditions.map((sub) =>
      this.buildWhereClause(sub)
    );
    return `(${subClauses.join(` ${condition.logicOperator} `)})`;
  }

  private buildSimpleCondition(condition: SimpleCondition): string {
    if (typeof condition.field !== "string" || !FIELD.test(condition.field)) {
      throw new Error(`Invalid field name: ${condition.field}`);
    }
    if (allowedOperators.indexOf(condition.operator) === -1) {
      throw new Error(`Invalid operator: ${condition.operator}`);
    }

    const typeCheck = condition.operator.replace("IS_NOT_", "IS_");
    if (typeCheckingOperators.indexOf(typeCheck) !== -1) {
      const negate = condition.operator.startsWith("IS_NOT_") ? "NOT " : "";
      return `${negate}${typeCheck}(c.${condition.field})`;
    }

    if (condition.operator === "IN" || condition.operator === "NOT IN") {
      if (!Array.isArray(condition.value)) {
        throw new Error(`Value for ${condition.operator} must be an array`);
      }
      // `IN ()` is not valid SQL: nothing is in an empty list.
      if (condition.value.length === 0) {
        return condition.operator === "IN" ? "false" : "true";
      }
      const names = condition.value.map((value) =>
        this.addParameter(condition.field, value)
      );
      return `c.${condition.field} ${condition.operator} (${names.join(", ")})`;
    }

    const name = this.addParameter(condition.field, condition.value);
    return `c.${condition.field} ${condition.operator} ${name}`;
  }

  private addParameter(field: string, value: unknown): string {
    if (value === undefined) {
      // An undefined parameter is dropped by Cosmos, which turns the
      // comparison into a silent no-match (or an error): refuse it.
      throw new Error(`Value for ${field} is undefined`);
    }
    if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
      throw new Error(`Value too long for field ${field}`);
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      throw new Error(`Value for ${field} must be a primitive or an array`);
    }
    const name = `@param${this.paramIndex++}`;
    this.parameters.push({ name, value });
    return name;
  }
}
