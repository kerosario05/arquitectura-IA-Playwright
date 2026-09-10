import assert from "node:assert";
import {
  getByProjectAndCase,
  replaceForProjectAndCase,
  type InputRequirement,
} from "./project-case-input-requirement-service";

class FakeConnection {
  slugToId = new Map<string, string>();
  store = new Map<string, Map<string, InputRequirement[]>>();
  beginCount = 0;
  commitCount = 0;
  rollbackCount = 0;
  queries: string[] = [];

  async beginTransaction(): Promise<void> {
    this.beginCount += 1;
  }
  async commit(): Promise<void> {
    this.commitCount += 1;
  }
  async rollback(): Promise<void> {
    this.rollbackCount += 1;
  }
  async close(): Promise<void> {
    /* no-op */
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.queries.push(sql);
    if (sql.includes("FROM dbo.Projects")) {
      const id = this.slugToId.get(String(params[0]));
      return (id ? [{ id }] : []) as T[];
    }
    if (sql.trim().startsWith("SELECT")) {
      const projectId = String(params[0]);
      const caseId = Number(params[1]);
      const reqs = this.store.get(projectId)?.get(String(caseId)) ?? [];
      return reqs.map((r) => ({
        key: r.key,
        label: r.label ?? null,
        controlType: r.controlType ?? null,
        required: r.required ? 1 : 0,
        sensitive: r.sensitive ? 1 : 0,
        allowedValues: r.allowedValues ? JSON.stringify(r.allowedValues) : null,
      })) as T[];
    }
    if (sql.trim().startsWith("DELETE")) {
      const projectId = String(params[0]);
      const caseId = Number(params[1]);
      this.store.get(projectId)?.delete(String(caseId));
      return [] as T[];
    }
    if (sql.trim().startsWith("INSERT")) {
      const [projectId, caseId, key, label, controlType, required, sensitive, allowedValues] = params;
      const perProject = this.store.get(String(projectId)) ?? new Map<string, InputRequirement[]>();
      const reqs = perProject.get(String(caseId)) ?? [];
      reqs.push({
        key: String(key),
        label: label == null ? undefined : String(label),
        controlType: controlType == null ? undefined : String(controlType),
        required: required === 1,
        sensitive: sensitive === 1,
        allowedValues: typeof allowedValues === "string" ? JSON.parse(allowedValues) : undefined,
      });
      perProject.set(String(caseId), reqs);
      this.store.set(String(projectId), perProject);
      return [] as T[];
    }
    return [] as T[];
  }
}

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(_name: string, fn: () => void): void {
  console.log(`\n${_name}`);
  fn();
}

describe("ProjectCaseInputRequirement service", () => {
  test("A: replace persists exactly 2 requirements for case A and get returns them", async () => {
    const conn = new FakeConnection();
    conn.slugToId.set("app-a", "p1");
    await replaceForProjectAndCase(
      "app-a",
      100,
      [
        { key: "auth.username", label: "Usuario", controlType: "text", required: true, sensitive: false },
        { key: "auth.password", controlType: "password", required: true, sensitive: true },
      ],
      conn as any,
    );
    const result = await getByProjectAndCase("app-a", 100, conn as any);
    assert.strictEqual(result.length, 2);
    assert.ok(result.some((r) => r.key === "auth.username"));
    assert.ok(result.some((r) => r.key === "auth.password"));
  });

  test("B: replacing case A does not affect case B", async () => {
    const conn = new FakeConnection();
    conn.slugToId.set("app-a", "p1");
    await replaceForProjectAndCase("app-a", 100, [{ key: "auth.username" }], conn as any);
    await replaceForProjectAndCase("app-a", 101, [{ key: "employee.document", sensitive: true }], conn as any);
    await replaceForProjectAndCase("app-a", 100, [{ key: "auth.password", sensitive: true }], conn as any);

    const forA = await getByProjectAndCase("app-a", 100, conn as any);
    const forB = await getByProjectAndCase("app-a", 101, conn as any);
    assert.deepStrictEqual(forA.map((r) => r.key), ["auth.password"]);
    assert.deepStrictEqual(forB.map((r) => r.key), ["employee.document"]);
    assert.strictEqual(forB[0].sensitive, true);
  });

  test("C: allowedValues round-trips as string[]", async () => {
    const conn = new FakeConnection();
    conn.slugToId.set("app-a", "p1");
    await replaceForProjectAndCase(
      "app-a",
      200,
      [{ key: "auth.role", controlType: "select", allowedValues: ["admin", "user", "auditor"] }],
      conn as any,
    );
    const result = await getByProjectAndCase("app-a", 200, conn as any);
    assert.deepStrictEqual(result[0].allowedValues, ["admin", "user", "auditor"]);
  });

  test("D: empty requirements delete existing requirements for the case", async () => {
    const conn = new FakeConnection();
    conn.slugToId.set("app-a", "p1");
    await replaceForProjectAndCase("app-a", 300, [{ key: "auth.username" }], conn as any);
    await replaceForProjectAndCase("app-a", 300, [], conn as any);
    const result = await getByProjectAndCase("app-a", 300, conn as any);
    assert.deepStrictEqual(result, []);
  });

  test("E: unknown project throws a controlled error and inserts nothing", async () => {
    const conn = new FakeConnection();
    conn.slugToId.set("app-a", "p1");
    await assert.rejects(
      replaceForProjectAndCase("missing-app", 400, [{ key: "auth.username" }], conn as any),
      /project not found/,
    );
    assert.strictEqual(conn.store.size, 0);
  });

  test("replace uses a transaction (begin/commit)", async () => {
    const conn = new FakeConnection();
    conn.slugToId.set("app-a", "p1");
    await replaceForProjectAndCase("app-a", 500, [{ key: "auth.username" }], conn as any);
    assert.ok(conn.beginCount >= 1);
    assert.ok(conn.commitCount >= 1);
  });

  test("read SELECT places namedProfileRef before allowedValues", async () => {
    const conn = new FakeConnection();
    conn.slugToId.set("app-a", "p1");
    await getByProjectAndCase("app-a", 600, conn as any);
    const select = conn.queries.find((sql) => sql.includes("FROM dbo.ProjectCaseInputRequirement"));
    assert.ok(select, "missing ProjectCaseInputRequirement SELECT");
    const namedProfileIndex = select.indexOf("namedProfileRef");
    const allowedValuesIndex = select.indexOf("allowedValues");
    assert.ok(namedProfileIndex >= 0, "missing namedProfileRef");
    assert.ok(allowedValuesIndex > namedProfileIndex, "allowedValues must follow namedProfileRef");
    assert.match(select.trim(), /allowedValues\s*\n\s+FROM\s+dbo\.ProjectCaseInputRequirement/i);
  });
});
