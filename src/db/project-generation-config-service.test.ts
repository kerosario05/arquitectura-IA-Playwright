import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createProjectGenerationConfigService } from "./project-generation-config-service";
import { buildProjectDeleteStatements } from "./project-service";

const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";
const config = {
  version: "1",
  valueSets: { generic: { values: ["CONFIG_VALUE"], selectionStrategy: "seeded" as const } },
  namedProfiles: { reusable: { valueKind: "string" as const, sourceMode: "configured_values" as const, valueSetRef: "generic", semanticHint: "informational" } },
};

function fakeDb() {
  const rows = new Map<string, { projectId: string; version: string; configJson: string; createdAt: Date; updatedAt: Date }>();
  const queries: string[] = [];
  return {
    rows,
    queries,
    withConnection: async <T>(fn: (connection: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>) => fn({
      query: async (sql, params = []) => {
        queries.push(sql);
        const projectId = String(params[0] ?? "");
        if (/SELECT projectId/i.test(sql)) return rows.get(projectId) ? [rows.get(projectId)] : [];
        if (/DELETE FROM/i.test(sql)) { rows.delete(projectId); return []; }
        if (/\bUPDATE\b/i.test(sql)) {
          const current = rows.get(String(params[2]))!;
          current.version = String(params[0]); current.configJson = String(params[1]); current.updatedAt = new Date();
          return [];
        }
        if (/INSERT/i.test(sql)) {
          rows.set(projectId, { projectId, version: String(params[1]), configJson: String(params[2]), createdAt: new Date(), updatedAt: new Date() });
          return [];
        }
        return [];
      },
    }),
    logger: (message: string) => { if (message.includes("CONFIG_VALUE")) throw new Error("secret logged"); },
  };
}

test("upserts canonical config per project and rejects invalid or corrupt data", async () => {
  const db = fakeDb();
  const service = createProjectGenerationConfigService(db);
  assert.deepEqual(await service.upsertProjectGenerationConfig(A, config), config);
  assert.deepEqual(await service.getProjectGenerationConfig(A), config);
  await assert.rejects(() => service.upsertProjectGenerationConfig(A, { version: "1", valueSets: { bad: { values: [] } } } as never));
  assert.equal(db.rows.get(A)?.configJson.includes("CONFIG_VALUE"), true);
  db.rows.get(A)!.configJson = "{";
  await assert.rejects(() => service.getProjectGenerationConfig(A), /corrupt|invalid/i);
  assert.equal(await service.getProjectGenerationConfig(B), undefined);
});

test("normalizes legacy input, isolates projects, logs metadata only and supports delete", async () => {
  const db = fakeDb();
  const service = createProjectGenerationConfigService(db);
  await service.upsertProjectGenerationConfig(A, { version: "legacy", pools: { old: { values: ["LEGACY_VALUE"] } } } as never);
  assert.deepEqual(Object.keys((await service.getProjectGenerationConfig(A))?.valueSets ?? {}), ["old"]);
  await service.upsertProjectGenerationConfig(B, config);
  assert.equal((await service.getProjectGenerationConfig(B))?.version, "1");
  assert.equal((await service.getProjectGenerationConfig(A))?.version, "legacy");
  assert.ok(db.queries.every((query) => !query.includes("CONFIG_VALUE") && !query.includes("LEGACY_VALUE")));
  assert.ok(buildProjectDeleteStatements(A).some((query) => query.includes("ProjectGenerationConfig")));
});

test("ships an idempotent project generation config migration", () => {
  const sql = fs.readFileSync("sql/schema/002-project-generation-config.sql", "utf8");
  assert.match(sql, /IF OBJECT_ID/);
  assert.match(sql, /PK_ProjectGenerationConfig/);
  assert.match(sql, /FK_ProjectGenerationConfig_Projects/);
});
