import { SimpleCondition, CompoundCondition } from "./types";

export function x(filters: any): SimpleCondition | CompoundCondition {
  const entries = Object.entries(filters);
  const len = entries.length;
  if (len === 1) {
    const [key, value] = entries[0];
    return {
      field: key,
      operator: "=",
      value: value,
    };
  }
  return {
    logicOperator: "AND",
    conditions: entries.map(([key, value]) => {
      return {
        field: key,
        operator: "=",
        value: value,
      };
    }),
  };
}

export function appendCondition(
  filter: CompoundCondition | undefined,
  newFilter: any
): CompoundCondition {
  const [key, value] = Object.entries(newFilter)[0];
  const newCondition: SimpleCondition = {
    field: key,
    operator: "=",
    value: value,
  };

  if (!filter) {
    return {
      logicOperator: "AND",
      conditions: [newCondition],
    };
  }
  if (filter.logicOperator === "AND") {
    return {
      logicOperator: "AND",
      conditions: [newCondition, ...filter.conditions],
    };
  }
  return {
    logicOperator: "AND",
    conditions: [newCondition, filter],
  };
}
