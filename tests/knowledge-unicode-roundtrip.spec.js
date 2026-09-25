"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const sql_connection_1 = require("../src/db/sql-connection");
const project_materializer_1 = require("../src/db/project-materializer");
const hu_declared_persister_1 = require("../src/knowledge/hu-declared-persister");
const UNICODE_PAYLOAD = [
    "módulo de información",
    "autenticación",
    "gestión",
    "≥ 30 segundos",
    "áéíóúñ",
];
(0, test_1.test)("persist → dbo.ProjectKnowledge → SELECT → JSON.parse → materialize: exact round-trip", async () => {
    const slug = `unicode-rt-${Date.now()}`;
    const conn = await (0, sql_connection_1.getConnection)();
    let projectId = "";
    try {
        // 1. Apply idempotent migration — VARCHAR(MAX) → NVARCHAR(MAX). No-op when already nvarchar.
        await conn.query(`IF EXISTS (
         SELECT 1 FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
         WHERE t.name = 'ProjectKnowledge' AND t.schema_id = SCHEMA_ID('dbo')
           AND c.name = 'knowledgeJson' AND c.system_type_id = 167
       )
       ALTER TABLE dbo.ProjectKnowledge ALTER COLUMN knowledgeJson NVARCHAR(MAX) NOT NULL;`);
        // 2. Column contract is native Unicode (nvarchar system_type_id = 231)
        const col = await conn.query(`SELECT c.system_type_id FROM sys.columns c
       WHERE c.object_id = OBJECT_ID('dbo.ProjectKnowledge') AND c.name = 'knowledgeJson'`);
        (0, test_1.expect)(col[0].system_type_id).toBe(231);
        // 3. Seed a ready project so the SQL path + materialize succeed
        await conn.query(`INSERT INTO dbo.Projects (slug, name, projectType, status, enabled) VALUES (?, 'utf8-rt', 1, 1, 1)`, [slug]);
        projectId = (await conn.query(`SELECT id FROM dbo.Projects WHERE slug = ?`, [slug]))[0].id;
        await conn.query(`INSERT INTO dbo.WebProjectConfiguration (projectId, baseUrl, loginMode) VALUES (?, 'https://example.com', 2)`, [projectId]);
        await conn.query(`INSERT INTO dbo.ProjectKnowledge (projectId, schemaVersion, knowledgeJson) VALUES (?, 1, ?)`, [projectId, JSON.stringify({ version: 1, items: [] })]);
        // 4. Persist via the real hu-declared runtime path (UTF-16LE write fix)
        const reqs = UNICODE_PAYLOAD.map((text, i) => ({
            id: `r${i}`,
            sourceIssueKey: "UTF8-RT",
            category: "action",
            sourceText: text,
            status: "covered",
        }));
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
        await (0, hu_declared_persister_1.persistHuDeclaredKnowledge)(slug, accounting, [], "UTF8-RT");
        // 5. SELECT raw from SQL — exact BEFORE any repair; JSON.parse must succeed
        const read = await conn.query(`SELECT knowledgeJson FROM dbo.ProjectKnowledge WHERE projectId = ?`, [projectId]);
        (0, test_1.expect)(/Ã[³±²¹º°]|â[‰¥³]/.test(read[0].knowledgeJson)).toBe(false);
        const sqlParsed = JSON.parse(read[0].knowledgeJson);
        const sqlItems = sqlParsed.items.filter((i) => i.source === "hu_declared");
        (0, test_1.expect)(sqlItems.length).toBe(5);
        for (let i = 0; i < UNICODE_PAYLOAD.length; i++) {
            (0, test_1.expect)(sqlItems[i].sourceText).toBe(UNICODE_PAYLOAD[i]);
        }
        // 6. Materialize → app.knowledge.json → exact
        await (0, project_materializer_1.materializeProjectRuntime)({ slug });
        const kp = path.join(process.cwd(), "automations", "apps", slug, "app.knowledge.json");
        (0, test_1.expect)(fs.existsSync(kp)).toBe(true);
        const materialized = JSON.parse(fs.readFileSync(kp, "utf-8"));
        const matItems = materialized.items.filter((i) => i.source === "hu_declared");
        (0, test_1.expect)(matItems.length).toBe(5);
        for (let i = 0; i < UNICODE_PAYLOAD.length; i++) {
            (0, test_1.expect)(matItems[i].sourceText).toBe(UNICODE_PAYLOAD[i]);
        }
        // 7. Full chain equality: SQL-parse === materialized-parse === expected
        (0, test_1.expect)(JSON.stringify(sqlItems.map((i) => i.sourceText))).toBe(JSON.stringify(UNICODE_PAYLOAD));
        (0, test_1.expect)(JSON.stringify(matItems.map((i) => i.sourceText))).toBe(JSON.stringify(UNICODE_PAYLOAD));
    }
    finally {
        if (projectId) {
            await conn.query(`DELETE FROM dbo.Projects WHERE id = ?`, [projectId]);
        }
        const kp = path.join(process.cwd(), "automations", "apps", slug, "app.knowledge.json");
        if (fs.existsSync(kp))
            fs.unlinkSync(kp);
    }
});
