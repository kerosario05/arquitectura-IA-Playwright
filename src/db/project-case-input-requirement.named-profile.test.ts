import assert from "node:assert/strict";
import test from "node:test";
import { getByProjectAndCase, replaceForProjectAndCase, type InputRequirement } from "./project-case-input-requirement-service";

class FakeConnection {
  slugToId = new Map<string, string>();
  requirements = new Map<string, InputRequirement[]>();
  configs = new Map<string, any>();
  configError: Error | undefined;

  async beginTransaction(): Promise<void> {}
  async commit(): Promise<void> {}
  async rollback(): Promise<void> {}
  async close(): Promise<void> {}

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (sql.includes("FROM dbo.Projects")) return (this.slugToId.has(String(params[0])) ? [{ id: this.slugToId.get(String(params[0])) }] : []) as T[];
    if (sql.includes("FROM dbo.ProjectGenerationConfig")) {
      if (this.configError) throw this.configError;
      const config = this.configs.get(String(params[0]));
      return config ? [{ projectId: String(params[0]), version: config.version, configJson: JSON.stringify(config) }] as T[] : [];
    }
    if (sql.trim().startsWith("SELECT")) {
      const rows = this.requirements.get(`${params[0]}:${params[1]}`) ?? [];
      return rows.map((r) => ({ key: r.key, label: r.label ?? null, controlType: r.controlType ?? null, required: r.required ? 1 : 0, sensitive: r.sensitive ? 1 : 0, allowedValues: r.allowedValues ? JSON.stringify(r.allowedValues) : null, namedProfileRef: r.namedProfileRef ?? null })) as T[];
    }
    if (sql.trim().startsWith("DELETE")) {
      const rows = this.requirements.get(`${params[0]}:${params[1]}`) ?? [];
      if (params.length > 2) {
        this.requirements.set(`${params[0]}:${params[1]}`, rows.filter((r) => r.key !== params[2]));
      } else {
        this.requirements.delete(`${params[0]}:${params[1]}`);
      }
      return [] as T[];
    }
    if (sql.trim().startsWith("INSERT")) {
      const [projectId, caseId, key, label, controlType, required, sensitive, allowedValues, namedProfileRef] = params;
      const rows = this.requirements.get(`${projectId}:${caseId}`) ?? [];
      rows.push({ key: String(key), label: label == null ? undefined : String(label), controlType: controlType == null ? undefined : String(controlType), required: required === 1, sensitive: sensitive === 1, allowedValues: typeof allowedValues === "string" ? JSON.parse(allowedValues) : undefined, namedProfileRef: namedProfileRef == null ? null : String(namedProfileRef) });
      this.requirements.set(`${projectId}:${caseId}`, rows);
      return [] as T[];
    }
    if (sql.trim().startsWith("UPDATE")) {
      const [label, controlType, required, sensitive, allowedValues] = params;
      const hasNamedProfileRef = params.length === 9;
      const namedProfileRef = hasNamedProfileRef ? params[5] : undefined;
      const projectId = params[hasNamedProfileRef ? 6 : 5];
      const caseId = params[hasNamedProfileRef ? 7 : 6];
      const key = params[hasNamedProfileRef ? 8 : 7];
      const rows = this.requirements.get(`${projectId}:${caseId}`) ?? [];
      const row = rows.find((r) => r.key === key);
      if (row) {
        row.label = label == null ? undefined : String(label);
        row.controlType = controlType == null ? undefined : String(controlType);
        row.required = required === 1;
        row.sensitive = sensitive === 1;
        row.allowedValues = typeof allowedValues === "string" ? JSON.parse(allowedValues) : undefined;
        if (namedProfileRef !== undefined) row.namedProfileRef = namedProfileRef == null ? null : String(namedProfileRef);
      }
      return [] as T[];
    }
    return [] as T[];
  }
}

const profile = { valueKind: "string", sourceMode: "synthetic" };

function setup(): FakeConnection {
  const conn = new FakeConnection();
  conn.slugToId.set("app-a", "project-a");
  conn.slugToId.set("app-b", "project-b");
  return conn;
}

test("namedProfileRef persistence validates same-project config and pending lifecycle", async (t) => {
  await t.test("null and valid refs round-trip, and null clears the binding", async () => {
    const conn = setup();
    conn.configs.set("project-a", { version: "v1", namedProfiles: { profile_a: profile } });
    await replaceForProjectAndCase("app-a", 1, [{ key: "field", namedProfileRef: "profile_a" }, { key: "other", namedProfileRef: "" }], conn as any);
    assert.deepEqual((await getByProjectAndCase("app-a", 1, conn as any)).map((r) => r.namedProfileRef), ["profile_a", null]);
    await replaceForProjectAndCase("app-a", 1, [{ key: "field", namedProfileRef: null }], conn as any);
    assert.equal((await getByProjectAndCase("app-a", 1, conn as any))[0].namedProfileRef, null);
  });

  await t.test("rejects an unknown ref when same-project config exists", async () => {
    const conn = setup();
    conn.configs.set("project-a", { version: "v1", namedProfiles: { other: profile } });
    await assert.rejects(replaceForProjectAndCase("app-a", 2, [{ key: "field", namedProfileRef: "missing" }], conn as any), (error: any) => error.code === "named_profile_reference_not_configured");
  });

  await t.test("allows pending ref when config is absent but propagates lookup errors", async () => {
    const conn = setup();
    await replaceForProjectAndCase("app-a", 3, [{ key: "field", namedProfileRef: "pending" }], conn as any);
    assert.equal((await getByProjectAndCase("app-a", 3, conn as any))[0].namedProfileRef, "pending");
    conn.configError = new Error("database unavailable");
    await assert.rejects(replaceForProjectAndCase("app-a", 4, [{ key: "field", namedProfileRef: "pending" }], conn as any), /database unavailable/);
  });

  await t.test("does not validate against another project's config", async () => {
    const conn = setup();
    conn.configs.set("project-a", { version: "v1", namedProfiles: {} });
    conn.configs.set("project-b", { version: "v1", namedProfiles: { foreign: profile } });
    await assert.rejects(replaceForProjectAndCase("app-a", 5, [{ key: "field", namedProfileRef: "foreign" }], conn as any), (error: any) => error.code === "named_profile_reference_not_configured");
  });

  await t.test("merges parser output while preserving local bindings and removing absent keys", async () => {
    const conn = setup();
    conn.requirements.set("project-a:6", [
      { key: "existing", label: "old", controlType: "text", required: false, sensitive: false, allowedValues: [], namedProfileRef: "profile-x" },
      { key: "removed", label: "remove", namedProfileRef: "profile-y" },
    ]);
    await replaceForProjectAndCase("app-a", 6, [
      { key: "existing", label: "new", controlType: "date", required: true, sensitive: true, allowedValues: ["A"] },
      { key: "new", label: "new key", controlType: "text", required: true, sensitive: false, allowedValues: [] },
      { key: "new", label: "duplicate", controlType: "text" },
    ], conn as any);

    const result = await getByProjectAndCase("app-a", 6, conn as any);
    assert.deepEqual(result, [
      { key: "existing", label: "new", controlType: "date", required: true, sensitive: true, allowedValues: ["A"], namedProfileRef: "profile-x" },
      { key: "new", label: "new key", controlType: "text", required: true, sensitive: false, allowedValues: [], namedProfileRef: null },
    ]);
  });
});
