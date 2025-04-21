import { SimpleCondition, CompoundCondition } from "./types";

export function getObjectByKeys<T extends Record<string, any>>(
  obj: T,
  keysStr: string
): Partial<T> {
  return Object.fromEntries(
    keysStr
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k in obj)
      .map((k) => [k, obj[k]])
  ) as Partial<T>;
}

export function objReplace<T extends Record<string, any>>(
  obj: T,
  replacements: Record<string, string | number>
): T {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      typeof value === "string"
        ? value.replace(/\{(\w+)\}/g, (_, match) =>
            replacements.hasOwnProperty(match)
              ? String(replacements[match])
              : value
          )
        : value,
    ])
  ) as T;
}

export function isSimpleCondition(
  condition: any
): condition is SimpleCondition {
  return "field" in condition && "operator" in condition;
}

export function isCompoundCondition(
  condition: any
): condition is CompoundCondition {
  return "logicOperator" in condition && "conditions" in condition;
}

export function isSimpleOrCompoundCondition(
  condition: any
): condition is SimpleCondition | CompoundCondition {
  return isSimpleCondition(condition) || isCompoundCondition(condition);
}

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
  newFilter: Record<string, any>
): CompoundCondition {
  const conditions: SimpleCondition[] = Object.entries(newFilter).map(
    ([key, value]) => ({
      field: key,
      operator: "=",
      value: value,
    })
  );

  if (!filter) {
    return {
      logicOperator: "AND",
      conditions: conditions,
    };
  }
  if (filter.logicOperator === "AND") {
    return {
      logicOperator: "AND",
      conditions: [...conditions, ...filter.conditions],
    };
  }
  return {
    logicOperator: "AND",
    conditions: [...conditions, ...filter.conditions],
  };
}
