// src/FluentQueryBuilder.ts

import {
  SimpleCondition,
  LogicalOperator,
  CompoundCondition,
  ConditionOperator,
} from "./types";

export class FluentQueryBuilder {
  private rootCondition: CompoundCondition = {
    logicOperator: "AND",
    conditions: [],
  };
  private currentGroup: CompoundCondition;

  constructor() {
    this.currentGroup = this.rootCondition;
  }

  private addCondition(
    field: string,
    operator: ConditionOperator,
    value?: any,
    logicOperator: LogicalOperator = "AND"
  ) {
    const condition: SimpleCondition = { field, operator, value };

    if (this.currentGroup.conditions.length === 0) {
      this.currentGroup.conditions.push(condition);
    } else {
      if (this.currentGroup.logicOperator !== logicOperator) {
        const lastCondition = this.currentGroup.conditions.pop()!;
        const newGroup: CompoundCondition = {
          logicOperator,
          conditions: [lastCondition, condition],
        };
        this.currentGroup.conditions.push(newGroup);
        this.currentGroup = newGroup;
      } else {
        this.currentGroup.conditions.push(condition);
      }
    }
  }

  where(field: string, operator: ConditionOperator, value?: any) {
    this.addCondition(field, operator, value, "AND");
    return this;
  }

  andWhere(field: string, operator: ConditionOperator, value?: any) {
    this.addCondition(field, operator, value, "AND");
    return this;
  }

  orWhere(field: string, operator: ConditionOperator, value?: any) {
    this.addCondition(field, operator, value, "OR");
    return this;
  }

  build(): { condition: CompoundCondition } {
    return { condition: this.rootCondition };
  }
}
