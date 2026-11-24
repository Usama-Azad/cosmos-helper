import { QueryBuilder, appendCondition, x, objReplace, getObjectByKeys } from "../src";

const build = (c: any) => new QueryBuilder().build(c);

describe("QueryBuilder", () => {
  it("parameterises every value", () => {
    expect(build({ teamId: "t1", status: "pending" })).toEqual({
      whereClause: "(c.teamId = @param0 AND c.status = @param1)",
      parameters: [
        { name: "@param0", value: "t1" },
        { name: "@param1", value: "pending" },
      ],
    });
  });

  it("starts each build from a clean state", () => {
    const qb = new QueryBuilder();
    qb.build({ a: 1 });
    expect(qb.build({ b: 2 })).toEqual({ whereClause: "c.b = @param0", parameters: [{ name: "@param0", value: 2 }] });
  });

  it("nests compound conditions", () => {
    const where = build({
      logicOperator: "AND",
      conditions: [
        { field: "teamId", operator: "=", value: "t1" },
        {
          logicOperator: "OR",
          conditions: [
            { field: "status", operator: "=", value: "a" },
            { field: "status", operator: "=", value: "b" },
          ],
        },
      ],
    }).whereClause;
    expect(where).toBe("(c.teamId = @param0 AND (c.status = @param1 OR c.status = @param2))");
  });

  it("handles IN, NOT IN and empty lists", () => {
    expect(build({ field: "s", operator: "IN", value: ["a", "b"] }).whereClause).toBe("c.s IN (@param0, @param1)");
    expect(build({ field: "s", operator: "IN", value: [] }).whereClause).toBe("false");
    expect(build({ field: "s", operator: "NOT IN", value: [] }).whereClause).toBe("true");
  });

  it("handles type checks", () => {
    expect(build({ field: "deletedAt", operator: "IS_NULL" }).whereClause).toBe("IS_NULL(c.deletedAt)");
    expect(build({ field: "deletedAt", operator: "IS_NOT_DEFINED" }).whereClause).toBe("NOT IS_DEFINED(c.deletedAt)");
  });

  it("treats empty groups as match-all (AND) or match-nothing (OR)", () => {
    expect(build({}).whereClause).toBe("true");
    expect(build({ logicOperator: "OR", conditions: [] }).whereClause).toBe("false");
  });

  it.each([
    [{ field: "a b", operator: "=", value: 1 }, /field/],
    [{ field: "a", operator: "= 1 OR 1", value: 1 }, /operator/],
    [{ logicOperator: "XOR", conditions: [] }, /logic operator/],
    [{ field: "a", operator: "IN", value: { type: "subquery", query: "SELECT VALUE 1" } }, /array/],
    [{ field: "a", operator: "=", value: { $gt: 1 } }, /primitive/],
    [{ a: undefined }, /undefined/],
    [{ field: "a", operator: "=", value: "x".repeat(1001) }, /too long/],
  ])("refuses %p", (condition, message) => {
    expect(() => build(condition)).toThrow(message);
  });
});

describe("helpers", () => {
  it("x builds equality conditions and refuses undefined", () => {
    expect(x({ a: 1 })).toEqual({ field: "a", operator: "=", value: 1 });
    expect(() => x({ a: 1, b: undefined })).toThrow(/undefined/);
  });

  it("appendCondition ANDs with the whole filter, keeping an OR group intact", () => {
    const or = { logicOperator: "OR" as const, conditions: [{ field: "s", operator: "=" as const, value: "a" }, { field: "s", operator: "=" as const, value: "b" }] };
    expect(appendCondition(or, { ownerId: "o1" })).toEqual({
      logicOperator: "AND",
      conditions: [{ field: "ownerId", operator: "=", value: "o1" }, or],
    });
    expect(build(appendCondition(or, { ownerId: "o1" })).whereClause).toBe(
      "(c.ownerId = @param0 AND (c.s = @param1 OR c.s = @param2))"
    );
  });

  it("appendCondition accepts a simple condition, a plain object or nothing", () => {
    expect(appendCondition({ field: "a", operator: "=", value: 1 }, { b: 2 }).conditions).toHaveLength(2);
    expect(appendCondition({ a: 1 } as any, { b: 2 }).conditions).toHaveLength(2);
    expect(appendCondition(undefined, { b: 2 })).toEqual({ logicOperator: "AND", conditions: [{ field: "b", operator: "=", value: 2 }] });
  });

  it("objReplace leaves unknown placeholders", () => {
    expect(objReplace({ a: "{id}-{x}" }, { id: "1" })).toEqual({ a: "1-{x}" });
  });

  it("getObjectByKeys picks the listed keys it has", () => {
    expect(getObjectByKeys({ a: 1, b: 2 }, "a, c")).toEqual({ a: 1 });
  });
});
