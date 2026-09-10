import assert from "node:assert/strict";
import test from "node:test";
import { getConfirmedRuntimeValues, persistConfirmedRuntimeValues } from "./project-case-runtime-value-service";

class FakeConnection {
  slugToId = new Map([["project-a", "project-id-a"]]);
  rows = new Map<string, any>();
  queries: Array<{ sql: string; params: unknown[] }> = [];
  async beginTransaction(): Promise<void> { /* no-op */ }
  async commit(): Promise<void> { /* no-op */ }
  async rollback(): Promise<void> { /* no-op */ }
  async close(): Promise<void> { /* no-op */ }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.queries.push({ sql, params });
    if (sql.includes("SELECT id FROM dbo.Projects")) {
      const id = this.slugToId.get(String(params[0]));
      return (id ? [{ id }] : []) as T[];
    }
    if (sql.includes("OBJECT_ID(N'dbo.ProjectCaseRuntimeValue'")) return [{ tableId: 1 }] as T[];
    if (sql.includes("SELECT [key] FROM dbo.ProjectCaseRuntimeValue")) {
      const row = this.rows.get(`${params[0]}:${params[1]}:${params[2]}`);
      return (row ? [{ key: row.key }] : []) as T[];
    }
    if (sql.includes("SELECT [key], semanticType")) {
      return [...this.rows.values()].filter((row) => row.projectId === params[0] && row.caseId === params[1]) as T[];
    }
    if (sql.trimStart().startsWith("UPDATE")) {
      const row = this.rows.get(`${params[8]}:${params[9]}:${params[10]}`);
      if (row) Object.assign(row, { semanticType: params[0], fieldKind: params[1], datasetIdentity: params[2], contractVersion: params[3], valueType: params[4], value: params[5], source: params[6], verified: params[7], confirmed: 1 });
      return [] as T[];
    }
    if (sql.trimStart().startsWith("INSERT")) {
      const [projectId, caseId, key, semanticType, fieldKind, datasetIdentity, contractVersion, type, value, source, verified] = params;
      this.rows.set(`${projectId}:${caseId}:${key}`, { projectId, caseId, key, semanticType, fieldKind, datasetIdentity, contractVersion, valueType: type, value, source, verified, confirmed: 1 });
      return [] as T[];
    }
    return [] as T[];
  }
}

test("persists confirmed non-secret values with semantic metadata and replays by project/case", async () => {
  const conn = new FakeConnection();
  const count = await persistConfirmedRuntimeValues({
    projectSlug: "project-a",
    caseId: 90001,
    conn: conn as any,
    values: [
      { key: "employee.document", value: "document-value", semanticType: "document_number", fieldKind: "text", datasetIdentity: "employee", contractVersion: "v1", verified: true },
      { key: "auth.password", value: "secret-value", verified: true },
    ],
  });
  assert.equal(count, 1);
  assert.equal(conn.rows.size, 1);
  assert.equal([...conn.rows.values()][0].value, "document-value");
  assert.ok(conn.queries.every(({ params }) => !params.includes("secret-value")));

  const replay = await getConfirmedRuntimeValues("project-id-a", 90001, conn as any);
  assert.deepEqual(replay, [{
    key: "employee.document",
    value: "document-value",
    semanticType: "document_number",
    fieldKind: "text",
    datasetIdentity: "employee",
    contractVersion: "v1",
    source: "confirmed_case_runtime",
    verified: true,
  }]);
});

test("confirmed runtime values are isolated by case and project", async () => {
  const conn = new FakeConnection();
  await persistConfirmedRuntimeValues({ projectSlug: "project-a", caseId: 1, conn: conn as any, values: [{ key: "x", value: "one" }] });
  assert.deepEqual(await getConfirmedRuntimeValues("project-id-a", 2, conn as any), []);
  assert.deepEqual(await getConfirmedRuntimeValues("other-project", 1, conn as any), []);
});
