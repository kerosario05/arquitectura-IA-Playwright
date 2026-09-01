import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getConnection } from "../src/db/sql-connection";
import { materializeProjectRuntime } from "../src/db/project-materializer";
import { persistHuDeclaredKnowledge } from "../src/knowledge/hu-declared-persister";
import type { FunctionalRequirementAccount } from "../src/scenarios/scenario-types";

const UNICODE_PAYLOAD = [
  "módulo de información",
  "autenticación",
  "gestión",
  "≥ 30 segundos",
  "áéíóúñ",
];

test("persist → dbo.ProjectKnowledge → SELECT → JSON.parse → materialize: exact round-trip", async () => {
  const slug = `unicode-rt-${Date.now()}`;
  const conn = await getConnection();
  let projectId = "";

  try {
    // 1. Apply idempotent migration — VARCHAR(MAX) → NVARCHAR(MAX). No-op when already nvarchar.
    await conn.query(
      `IF EXISTS (
         SELECT 1 FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
         WHERE t.name = 'ProjectKnowledge' AND t.schema_id = SCHEMA_ID('dbo')
           AND c.name = 'knowledgeJson' AND c.system_type_id = 167
       )
       ALTER TABLE dbo.ProjectKnowledge ALTER COLUMN knowledgeJson NVARCHAR(MAX) NOT NULL;`,
    );

    // 2. Column contract is native Unicode (nvarchar system_type_id = 231)
    const col = await conn.query<{ system_type_id: number }>(
      `SELECT c.system_type_id FROM sys.columns c
       WHERE c.object_id = OBJECT_ID('dbo.ProjectKnowledge') AND c.name = 'knowledgeJson'`,
    );
    expect(col[0].system_type_id).toBe(231);

    // 3. Seed a ready project so the SQL path + materialize succeed
    await conn.query(
      `INSERT INTO dbo.Projects (slug, name, projectType, status, enabled) VALUES (?, 'utf8-rt', 1, 1, 1)`,
      [slug],
    );
    projectId = (await conn.query<{ id: string }>(
      `SELECT id FROM dbo.Projects WHERE slug = ?`,
      [slug],
    ))[0].id;
    await conn.query(
      `INSERT INTO dbo.WebProjectConfiguration (projectId, baseUrl, loginMode) VALUES (?, 'https://example.com', 2)`,
      [projectId],
    );
    await conn.query(
      `INSERT INTO dbo.ProjectKnowledge (projectId, schemaVersion, knowledgeJson) VALUES (?, 1, ?)`,
      [projectId, JSON.stringify({ version: 1, items: [] })],
    );

    // 4. Persist via the real hu-declared runtime path (UTF-16LE write fix)
    const reqs: FunctionalRequirementAccount[] = UNICODE_PAYLOAD.map(
      (text, i) => ({
        id: `r${i}`,
        sourceIssueKey: "UTF8-RT",
        category: "action",
        sourceText: text,
        status: "covered",
      }),
    );
    const accounting = {
      requirements: reqs,
      summary: {
        total: 5,
        covered: 5,
        adaptive: 0,
        nonAutomatable: 0,
        incompleteRequirement: 0,
      },
    };
    await persistHuDeclaredKnowledge(slug, accounting, [], "UTF8-RT");

    // 5. SELECT raw from SQL — exact BEFORE any repair; JSON.parse must succeed
    const read = await conn.query<{ knowledgeJson: string }>(
      `SELECT knowledgeJson FROM dbo.ProjectKnowledge WHERE projectId = ?`,
      [projectId],
    );
    expect(/Ã[³±²¹º°]|â[‰¥³]/.test(read[0].knowledgeJson)).toBe(false);
    const sqlParsed = JSON.parse(read[0].knowledgeJson);
    const sqlItems = sqlParsed.items.filter(
      (i: any) => i.source === "hu_declared",
    );
    expect(sqlItems.length).toBe(5);
    for (let i = 0; i < UNICODE_PAYLOAD.length; i++) {
      expect(sqlItems[i].sourceText).toBe(UNICODE_PAYLOAD[i]);
    }

    // 6. Materialize → app.knowledge.json → exact
    await materializeProjectRuntime({ slug });
    const kp = path.join(process.cwd(), "automations", "apps", slug, "app.knowledge.json");
    expect(fs.existsSync(kp)).toBe(true);
    const materialized = JSON.parse(fs.readFileSync(kp, "utf-8"));
    const matItems = materialized.items.filter(
      (i: any) => i.source === "hu_declared",
    );
    expect(matItems.length).toBe(5);
    for (let i = 0; i < UNICODE_PAYLOAD.length; i++) {
      expect(matItems[i].sourceText).toBe(UNICODE_PAYLOAD[i]);
    }

    // 7. Full chain equality: SQL-parse === materialized-parse === expected
    expect(JSON.stringify(sqlItems.map((i: any) => i.sourceText))).toBe(
      JSON.stringify(UNICODE_PAYLOAD),
    );
    expect(JSON.stringify(matItems.map((i: any) => i.sourceText))).toBe(
      JSON.stringify(UNICODE_PAYLOAD),
    );
  } finally {
    if (projectId) {
      await conn.query(`DELETE FROM dbo.Projects WHERE id = ?`, [projectId]);
    }
    const kp = path.join(process.cwd(), "automations", "apps", slug, "app.knowledge.json");
    if (fs.existsSync(kp)) fs.unlinkSync(kp);
  }
});