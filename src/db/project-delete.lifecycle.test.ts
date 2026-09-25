import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DbConnection } from "./db-connection";
import {
  deleteProject,
  removeProjectArtifacts,
  type ProjectDeleteDependencies,
} from "./project-service";

process.env.DB_DRIVER = "sqlite";

const CORE_TABLES = [
  "ProjectConfigurationHistory",
  "ProjectJiraConfiguration",
  "ProjectTestRailConfiguration",
  "ProjectOtpConfiguration",
  "ProjectKnowledge",
  "WebProjectConfiguration",
  "MobileProjectConfiguration",
  "Projects",
];

type HarnessOptions = {
  tables?: string[];
  project?: boolean;
  failOn?: string;
};

function harness(options: HarnessOptions = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let rolledBack = false;
  let committed = false;
  const conn = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (sql.includes("FROM dbo.Projects WHERE slug")) {
        return (options.project === false ? [] : [{ id: "project-a", slug: "project-a" }]) as T[];
      }
      if (sql.includes("FROM sqlite_master")) {
        return (options.tables ?? CORE_TABLES).map((name) => ({ name })) as T[];
      }
      if (sql.startsWith("DELETE FROM dbo.")) {
        if (options.failOn && sql.includes(options.failOn)) throw new Error(`forced failure: ${options.failOn}`);
        statements.push({ sql, params });
      }
      return [] as T[];
    },
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    async close() {},
  } satisfies DbConnection;

  const dependencies: ProjectDeleteDependencies = {
    withTransaction: async <T>(fn: (connection: DbConnection) => Promise<T>) => {
      try {
        const result = await fn(conn);
        await conn.commit();
        return result;
      } catch (error) {
        await conn.rollback();
        throw error;
      }
    },
    removeArtifacts: () => [],
  };
  return { conn, dependencies, statements, get rolledBack() { return rolledBack; }, get committed() { return committed; } };
}

test("CASE 1: normal current schema deletes successfully", async () => {
  const h = harness();
  const result = await deleteProject("project-a", h.dependencies);
  assert.equal(result.projectDeleted, true);
  assert.equal(h.committed, true);
  assert.equal(h.rolledBack, false);
  assert.ok(h.statements.some(({ sql }) => sql.includes("DELETE FROM dbo.Projects")));
});

test("CASE 2: absent legacy/additive table does not block deletion", async () => {
  const h = harness();
  await deleteProject("project-a", h.dependencies);
  assert.equal(h.statements.some(({ sql }) => /ProjectCaseInputRequirement|ProjectCaseRuntimeValue|ProjectGenerationConfig/.test(sql)), false);
});

test("CASE 3: deleting project A binds only project A", async () => {
  const h = harness();
  await deleteProject("project-a", h.dependencies);
  assert.ok(h.statements.length > 0);
  assert.equal(h.statements.every(({ params }) => params[0] === "project-a"), true);
});

test("CASE 4: related configuration and knowledge are included in cleanup", async () => {
  const h = harness();
  await deleteProject("project-a", h.dependencies);
  for (const table of ["WebProjectConfiguration", "ProjectKnowledge", "ProjectConfigurationHistory"]) {
    assert.ok(h.statements.some(({ sql }) => sql.includes(`DELETE FROM dbo.${table}`)), `missing ${table} cleanup`);
  }
});

test("CASE 5: filesystem cleanup removes only the target project roots", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "project-delete-"));
  try {
    const appsRoot = path.join(temp, "apps");
    const dataRoot = path.join(temp, "projects");
    fs.mkdirSync(path.join(appsRoot, "project-a", "recordings"), { recursive: true });
    fs.mkdirSync(path.join(dataRoot, "project-a", "runtime"), { recursive: true });
    fs.mkdirSync(path.join(appsRoot, "project-b"), { recursive: true });
    fs.mkdirSync(path.join(dataRoot, "project-b"), { recursive: true });

    const warnings = removeProjectArtifacts("project-a", [
      { root: appsRoot, warning: "apps_cleanup_failed" },
      { root: dataRoot, warning: "data_cleanup_failed" },
    ]);
    assert.deepEqual(warnings, []);
    assert.equal(fs.existsSync(path.join(appsRoot, "project-a")), false);
    assert.equal(fs.existsSync(path.join(dataRoot, "project-a")), false);
    assert.equal(fs.existsSync(path.join(appsRoot, "project-b")), true);
    assert.equal(fs.existsSync(path.join(dataRoot, "project-b")), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("CASE 6: SQL failure before commit rolls back without partial relational delete", async () => {
  const h = harness({ failOn: "ProjectKnowledge" });
  await assert.rejects(() => deleteProject("project-a", h.dependencies), /forced failure/);
  assert.equal(h.committed, false);
  assert.equal(h.rolledBack, true);
});

test("CASE 7: nonexistent project returns a controlled not-found error", async () => {
  const h = harness({ project: false });
  await assert.rejects(() => deleteProject("missing", h.dependencies), /project not found: missing/);
  assert.equal(h.statements.length, 0);
  assert.equal(h.rolledBack, true);
});
