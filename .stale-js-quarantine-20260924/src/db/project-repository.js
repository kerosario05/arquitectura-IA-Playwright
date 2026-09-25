"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConnection = void 0;
exports.createProject = createProject;
exports.getProjectById = getProjectById;
exports.getProjectBySlug = getProjectBySlug;
exports.getProjectByTestRailProjectId = getProjectByTestRailProjectId;
exports.listProjects = listProjects;
const sql_connection_1 = require("./sql-connection");
Object.defineProperty(exports, "getConnection", { enumerable: true, get: function () { return sql_connection_1.getConnection; } });
function mapRow(row) {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        projectType: row.projectType,
        status: row.status,
        enabled: row.enabled === true || row.enabled === 1 || row.enabled === "1",
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
async function createProject(input, conn) {
    const c = conn ?? (await (0, sql_connection_1.getConnection)());
    const enabled = input.enabled === false ? 0 : 1;
    const status = input.status ?? 0;
    const result = await c.query(`INSERT INTO dbo.Projects (slug, name, projectType, status, enabled)
     OUTPUT INSERTED.id, INSERTED.slug, INSERTED.name, INSERTED.projectType,
            INSERTED.status, INSERTED.enabled, INSERTED.createdAt, INSERTED.updatedAt
     VALUES (?, ?, ?, ?, ?)`, [input.slug, input.name, input.projectType, status, enabled]);
    return mapRow(result[0]);
}
async function getProjectById(id) {
    const conn = await (0, sql_connection_1.getConnection)();
    const result = await conn.query(`SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
     FROM dbo.Projects WHERE id = ?`, [id]);
    return result.length > 0 ? mapRow(result[0]) : null;
}
async function getProjectBySlug(slug) {
    const conn = await (0, sql_connection_1.getConnection)();
    const result = await conn.query(`SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
     FROM dbo.Projects WHERE slug = ?`, [slug]);
    return result.length > 0 ? mapRow(result[0]) : null;
}
async function getProjectByTestRailProjectId(testRailProjectId) {
    const conn = await (0, sql_connection_1.getConnection)();
    const result = await conn.query(`SELECT p.id, p.slug, p.name, p.projectType, p.status, p.enabled, p.createdAt, p.updatedAt
       FROM dbo.Projects p
       JOIN dbo.ProjectTestRailConfiguration tr ON tr.projectId = p.id
      WHERE tr.projectIdTr = ?`, [testRailProjectId]);
    return result.length > 0 ? mapRow(result[0]) : null;
}
async function listProjects() {
    const conn = await (0, sql_connection_1.getConnection)();
    const result = await conn.query(`SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
     FROM dbo.Projects ORDER BY createdAt, slug`);
    return result.map(mapRow);
}
