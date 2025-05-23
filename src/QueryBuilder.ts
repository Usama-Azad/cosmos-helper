// src/QueryBuilder.ts

import {
  Subquery,
  Condition,
  SimpleCondition,
  CompoundCondition,
} from "./types";
import { isSimpleOrCompoundCondition, x } from "./helpers";
import { allowedOperators, typeCheckingOperators } from "./consts";

export class QueryBuilder {
  private parameters: { name: string; value: any }[] = [];
  private paramIndex = 0;
  private readonly MAX_STRING_LENGTH = 1000;

  build<T>(condition: Condition<T>): {
    whereClause: string;
    parameters: { name: string; value: any }[];
  } {
    if (!isSimpleOrCompoundCondition(condition)) {
      condition = x(condition);
    }
    const whereClause = this.buildWhereClause(
      condition as SimpleCondition | CompoundCondition
    );
    return { whereClause, parameters: this.parameters };
  }

  private buildWhereClause(
    condition: SimpleCondition | CompoundCondition
  ): string {
    if ("field" in condition) {
      return this.buildSimpleCondition(condition);
    } else {
      const subClauses = condition.conditions.map((sub) =>
        this.buildWhereClause(sub)
      );
      const joined = subClauses.join(` ${condition.logicOperator} `);
      return `(${joined})`;
    }
  }

  private buildSimpleCondition(condition: SimpleCondition): string {
    if (!/^[a-zA-Z0-9_]+$/.test(condition.field)) {
      throw new Error(`Invalid field name: ${condition.field}`);
    }

    if (allowedOperators.indexOf(condition.operator) === -1) {
      throw new Error(`Invalid operator: ${condition.operator}`);
    }

    if (
      typeCheckingOperators.indexOf(
        condition.operator.replace("IS_NOT_", "IS_")
      ) !== -1
    ) {
      return `${
        condition.operator.startsWith("IS_NOT_") ? "NOT " : ""
      }${condition.operator.replace("IS_NOT_", "IS_")}(c.${condition.field})`;
    }

    const paramName = `@param${this.paramIndex++}`;

    const validateValue = (value: any) => {
      if (typeof value === "string" && value.length > this.MAX_STRING_LENGTH) {
        throw new Error(`Value too long for field ${condition.field}`);
      }
    };

    if (condition.operator === "IN" || condition.operator === "NOT IN") {
      if (Array.isArray(condition.value)) {
        const inParams = condition.value
          .map((_, idx) => `${paramName}_${idx}`)
          .join(", ");
        condition.value.forEach((val, idx) => {
          validateValue(val);
          this.parameters.push({ name: `${paramName}_${idx}`, value: val });
        });
        return `c.${condition.field} ${condition.operator} (${inParams})`;
      } else if (
        typeof condition.value === "object" &&
        (condition.value as Subquery).type === "subquery"
      ) {
        return `c.${condition.field} ${condition.operator} (${
          (condition.value as Subquery).query
        })`;
      } else {
        throw new Error(
          `Value for ${condition.operator} must be an array or subquery`
        );
      }
    } else {
      validateValue(condition.value);
      this.parameters.push({ name: paramName, value: condition.value });
      return `c.${condition.field} ${condition.operator} ${paramName}`;
    }
  }
}
