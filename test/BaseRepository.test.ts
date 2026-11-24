import { BaseRepository, RepositoryError, MAX_PAGE_SIZE } from "../src";

class Members extends BaseRepository<any> {
  protected readonly partitionKeyField = "teamId";
}

type Call = { spec: { query: string; parameters: { name: string; value: any }[] }; options: any };

function fakeContainer(opts: { rows?: unknown[][]; doc?: any; replace?: jest.Mock } = {}) {
  const calls: Call[] = [];
  const rows: any[][] = [...(opts.rows ?? [])];
  const doc = opts.doc;
  const replace = opts.replace ?? jest.fn(async (body: any) => ({ resource: body }));
  const container = {
    items: {
      query: jest.fn((spec: any, options: any) => {
        calls.push({ spec, options });
        const resources = rows.shift() ?? [];
        return { fetchAll: async () => ({ resources }) };
      }),
      create: jest.fn(async (body: any) => ({ resource: body })),
    },
    item: jest.fn((_id: string, _pk: string) => ({
      read: jest.fn(async () => ({ resource: typeof doc === "function" ? doc() : doc })),
      replace,
      delete: jest.fn(async () => ({ resource: undefined })),
    })),
  };
  return { repo: new Members(container as any), container, calls, replace };
}

describe("partition key", () => {
  it.each([
    ["find", (r: Members) => r.find("t1", { teamId: "t1", type: "member" })],
    ["findFirst", (r: Members) => r.findFirst("t1", { teamId: "t1" }, "id")],
    ["findFirst with options", (r: Members) => r.findFirst("t1", { teamId: "t1" }, { orderBy: "updatedAt" })],
    ["count", (r: Members) => r.count("t1", { status: "pending" })],
    ["findWithPagination", (r: Members) => r.findWithPagination("t1", { type: "member" }, { limit: 5 })],
  ])("%s queries only the named partition", async (_name, run) => {
    const { repo, calls } = fakeContainer({ rows: [[0], []] });
    await run(repo);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.options).toEqual({ partitionKey: "t1" });
  });

  it.each([[""], [undefined], [null], [42], [{ teamId: "t1" }]])(
    "refuses a missing or invalid key (%p) before any query",
    async (key) => {
      const { repo, calls, container } = fakeContainer();
      await expect(repo.find(key as any)).rejects.toThrow(/partition key is required/);
      await expect(repo.count(key as any)).rejects.toThrow(/partition key is required/);
      await expect(repo.findById("x", key as any)).rejects.toThrow(/partition key is required/);
      expect(calls).toHaveLength(0);
      expect(container.item).not.toHaveBeenCalled();
    }
  );
});

describe("queries", () => {
  it("findFirst reads one item with TOP 1, not every match", async () => {
    const { repo, calls } = fakeContainer({ rows: [[{ id: "a" }]] });
    expect(await repo.findFirst("t1", { userId: "u1" }, "id,status")).toEqual({ id: "a" });
    expect(calls[0].spec.query).toMatch(/^SELECT TOP 1 c\.id, c\.status FROM c WHERE c\.userId = @param0$/);
  });

  it("findWithPagination runs the count and the page together and returns the total", async () => {
    const { repo, calls } = fakeContainer({ rows: [[7], [{ id: "a" }]] });
    const page = await repo.findWithPagination("t1", { type: "member" }, { limit: 5, offset: 10, orderDirection: "asc" });
    expect(page).toEqual({ items: [{ id: "a" }], pagination: { total: 7, limit: 5, offset: 10 } });
    expect(calls.map((c) => c.spec.query)).toEqual([
      "SELECT VALUE COUNT(1) FROM c WHERE c.type = @param0",
      "SELECT * FROM c WHERE c.type = @param0 ORDER BY c.createdAt ASC OFFSET 10 LIMIT 5",
    ]);
  });

  it.each([
    [{ orderDirection: "desc; DROP" }, /orderDirection/],
    [{ orderBy: "a b" }, /orderBy/],
    [{ limit: 0 }, /limit/],
    [{ limit: MAX_PAGE_SIZE + 1 }, /limit/],
    [{ limit: "5 OFFSET 0" }, /limit/],
    [{ offset: -1 }, /offset/],
    [{ select: "id, c.x" }, /select/],
  ])("refuses unsafe paging options %p", async (options, message) => {
    const { repo, calls } = fakeContainer();
    await expect(repo.findWithPagination("t1", undefined, options as any)).rejects.toThrow(message);
    expect(calls).toHaveLength(0);
  });

  it("count is 0 when the query returns nothing", async () => {
    const { repo } = fakeContainer({ rows: [[]] });
    expect(await repo.count("t1")).toBe(0);
  });

  it("an empty filter matches everything", async () => {
    const { repo, calls } = fakeContainer({ rows: [[]] });
    await repo.find("t1", {});
    expect(calls[0].spec.query).toBe("SELECT * FROM c WHERE true");
  });

  it("repeated queries never carry another query's parameters", async () => {
    const { repo, calls } = fakeContainer();
    await repo.find("t1", { a: 1 });
    await repo.find("t1", { b: 2 });
    expect(calls[1].spec.parameters).toEqual([{ name: "@param0", value: 2 }]);
  });
});

describe("create", () => {
  it("checks for an existing item inside the new item's own partition", async () => {
    const { repo, calls, container } = fakeContainer({ rows: [[]] });
    const created = await repo.create({ teamId: "t9", userId: "u1", type: "member" } as any, {
      checkForExisting: "userId,teamId,type",
      prefixId: "member",
    });
    expect(calls[0].options).toEqual({ partitionKey: "t9" });
    expect(calls[0].spec.query).toMatch(/^SELECT TOP 1 c\.id FROM c WHERE/);
    expect(created.id).toMatch(/^member-[0-9a-f-]{36}$/);
    expect(created).toMatchObject({ teamId: "t9", deletedAt: null });
    expect(created.createdAt).toBe(created.updatedAt);
    expect(container.items.create).toHaveBeenCalledTimes(1);
  });

  it("refuses a duplicate with 409", async () => {
    const { repo, container } = fakeContainer({ rows: [[{ id: "old" }]] });
    const err = await repo
      .create({ teamId: "t9", userId: "u1" } as any, { checkForExisting: "userId,teamId" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(RepositoryError);
    expect(err).toMatchObject({ code: 409, message: "Item already exists" });
    expect(container.items.create).not.toHaveBeenCalled();
  });

  it("refuses checkForExisting without the partition-key field", async () => {
    const { repo, calls } = fakeContainer();
    await expect(repo.create({ userId: "u1" } as any, { checkForExisting: "userId" })).rejects.toThrow(/teamId/);
    expect(calls).toHaveLength(0);
  });

  it("fills {id} and {now} placeholders and leaves unknown ones", async () => {
    const { repo } = fakeContainer();
    const created = await repo.create({ teamId: "t1", path: "teams/{id}", note: "{other}" } as any);
    expect(created.path).toBe(`teams/${created.id}`);
    expect(created.note).toBe("{other}");
  });
});

describe("update and softDelete", () => {
  it("writes conditionally on the version read", async () => {
    const { repo, replace } = fakeContainer({ doc: { id: "m1", teamId: "t1", status: "pending", _etag: "e1" } });
    const out = await repo.update("m1", { status: "accepted" }, "t1");
    expect(out).toMatchObject({ id: "m1", status: "accepted" });
    expect(replace.mock.calls[0][1]).toEqual({ accessCondition: { type: "IfMatch", condition: "e1" } });
  });

  it("re-reads and retries when another writer changed the item first", async () => {
    let version = 0;
    const replace = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("precondition failed"), { code: 412 }))
      .mockImplementation(async (body: any) => ({ resource: body }));
    const { repo } = fakeContainer({
      replace,
      doc: () => ({ id: "m1", teamId: "t1", seats: ++version, _etag: `e${version}` }),
    });
    const out = await repo.update("m1", { status: "accepted" }, "t1");
    expect(replace).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ seats: 2, status: "accepted" });
    expect(replace.mock.calls[1][1].accessCondition.condition).toBe("e2");
  });

  it("gives up after 3 conflicts", async () => {
    const conflict = Object.assign(new Error("precondition failed"), { code: 412 });
    const replace = jest.fn().mockRejectedValue(conflict);
    const { repo } = fakeContainer({ replace, doc: { id: "m1", _etag: "e" } });
    await expect(repo.update("m1", {}, "t1")).rejects.toBe(conflict);
    expect(replace).toHaveBeenCalledTimes(3);
  });

  it("404s on a missing item instead of creating a partial one", async () => {
    const { repo, replace } = fakeContainer({ doc: undefined });
    await expect(repo.update("nope", { a: 1 } as any, "t1")).rejects.toMatchObject({ code: 404 });
    await expect(repo.softDelete("nope", "t1")).rejects.toMatchObject({ code: 404 });
    expect(replace).not.toHaveBeenCalled();
  });

  it("softDelete stamps deletedAt", async () => {
    const { repo } = fakeContainer({ doc: { id: "m1", _etag: "e" } });
    const out = await repo.softDelete("m1", "t1");
    expect(out.deletedAt).toBe(out.updatedAt);
  });
});
