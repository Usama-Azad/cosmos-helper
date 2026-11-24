import { Condition, SimpleCondition, CompoundCondition } from "./types";

/** The listed keys of `obj` (a comma-separated list) that it has. */
export function getObjectByKeys<T extends Record<string, any>>(
  obj: T,
  keysStr: string
): Partial<T> {
  return Object.fromEntries(
    keysStr
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k && k in obj)
      .map((k) => [k, obj[k]])
  ) as Partial<T>;
}

/**
 * Replaces `{name}` placeholders in the object's top-level string values.
 * A placeholder with no replacement is left as it is.
 */
export function objReplace<T extends Record<string, any>>(
  obj: T,
  replacements: Record<string, string | number>
): T {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      typeof value === "string"
        ? value.replace(/\{(\w+)\}/g, (whole, name) =>
            Object.prototype.hasOwnProperty.call(replacements, name)
              ? String(replacements[name])
              : whole
          )
        : value,
    ])
  ) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isSimpleCondition(
  condition: any
): condition is SimpleCondition {
  return isObject(condition) && "field" in condition && "operator" in condition;
}

export function isCompoundCondition(
  condition: any
): condition is CompoundCondition {
  return (
    isObject(condition) && "logicOperator" in condition && "conditions" in condition
  );
}

export function isSimpleOrCompoundCondition(
  condition: any
): condition is SimpleCondition | CompoundCondition {
  return isSimpleCondition(condition) || isCompoundCondition(condition);
}

function equals(filters: Record<string, any>): SimpleCondition[] {
  return Object.entries(filters).map(([field, value]) => {
    if (value === undefined) {
      throw new Error(`Filter value for ${field} is undefined`);
    }
    return { field, operator: "=", value };
  });
}

/**
 * An equality filter (`{ a: 1, b: 2 }`) as a condition: `a = 1 AND b = 2`.
 * An undefined value is refused: it would match nothing, silently.
 */
export function x(filters: Record<string, any>): SimpleCondition | CompoundCondition {
  if (!isObject(filters)) {
    throw new Error("Filters must be an object");
  }
  const conditions = equals(filters);
  if (conditions.length === 1) return conditions[0];
  return { logicOperator: "AND", conditions };
}

/**
 * `filter AND (field = value ...)`. The new conditions are ANDed with the
 * whole of `filter`, whatever it is (an OR group stays one group), so they
 * always restrict the result.
 */
export function appendCondition<T = any>(
  filter: Condition<T> | undefined,
  newFilter: Record<string, any>
): CompoundCondition {
  const conditions: (SimpleCondition | CompoundCondition)[] = equals(newFilter);
  if (filter === undefined) {
    return { logicOperator: "AND", conditions };
  }
  const existing = isSimpleOrCompoundCondition(filter) ? filter : x(filter as Record<string, any>);
  if (isCompoundCondition(existing) && existing.logicOperator === "AND") {
    return { logicOperator: "AND", conditions: [...conditions, ...existing.conditions] };
  }
  return { logicOperator: "AND", conditions: [...conditions, existing] };
}
