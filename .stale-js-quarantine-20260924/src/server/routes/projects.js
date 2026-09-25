"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectsRouter = void 0;
exports.createInputRequirementsHandlers = createInputRequirementsHandlers;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const project_repository_1 = require("../../db/project-repository");
const project_service_1 = require("../../db/project-service");
const project_reader_1 = require("../../db/project-reader");
const project_materializer_1 = require("../../db/project-materializer");
const apk_inspector_1 = require("../../utils/apk-inspector");
const sql_connection_1 = require("../../db/sql-connection");
const project_case_input_requirement_service_1 = require("../../db/project-case-input-requirement-service");
const testrail_input_requirements_sync_1 = require("../../testrail/testrail-input-requirements-sync");
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const project_generation_config_service_1 = require("../../db/project-generation-config-service");
exports.projectsRouter = (0, express_1.Router)();
const managedApkDir = path_1.default.resolve(process.cwd(), ".artifacts", "apks");
const apkUpload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => {
            try {
                fs_1.default.mkdirSync(managedApkDir, { recursive: true });
            }
            catch { }
            cb(null, managedApkDir);
        },
        filename: (_req, file, cb) => {
            const safe = file.originalname.toLowerCase().endsWith(".apk") ? file.originalname : "app.apk";
            // use uuid to avoid collisions, preserve no user path
            cb(null, `${crypto_1.default.randomUUID()}-${safe.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
        },
    }),
    fileFilter: (_req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith(".apk")) {
            cb(new apk_inspector_1.ApkInspectorError("invalid_apk_path", `APK file must end with .apk: ${file.originalname}`));
        }
        else
            cb(null, true);
    },
    limits: { fileSize: 250 * 1024 * 1024 },
});
function apkInspectMiddleware(req, res, next) {
    const ct = req.headers["content-type"] || "";
    if (ct.includes("multipart/form-data"))
        return apkUpload.single("apk")(req, res, next);
    next();
}
function publicProject(p) {
    return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        projectType: p.projectType,
        status: p.status,
        enabled: p.enabled,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
    };
}
function publicAggregate(cfg) {
    const web = cfg.web
        ? {
            baseUrl: cfg.web.baseUrl,
            loginMode: cfg.web.loginMode,
            username: cfg.web.username,
            ignoreHTTPSErrors: cfg.web.ignoreHTTPSErrors === true,
            testDataJson: cfg.web.testDataJson,
            testDataAliasesJson: cfg.web.testDataAliasesJson,
            missingInputBehavior: cfg.web.missingInputBehavior,
            extraLoginFieldsJson: cfg.web.extraLoginFieldsJson,
        }
        : null;
    const mobile = cfg.mobile;
    const otp = cfg.otp;
    const jira = cfg.jira
        ? {
            sharedConnectionId: cfg.jira.sharedConnectionId,
            projectKey: cfg.jira.projectKey,
            acceptanceCriteriaField: cfg.jira.acceptanceCriteriaField,
            defaultJql: cfg.jira.defaultJql,
            dryRun: cfg.jira.dryRun,
        }
        : null;
    const testRail = cfg.testrail;
    return {
        project: publicProject(cfg),
        webConfig: web,
        mobileConfig: mobile,
        otpConfig: otp,
        jiraConfig: jira,
        testRailConfig: testRail,
        knowledge: cfg.knowledge
            ? {
                schemaVersion: cfg.knowledge.schemaVersion,
                itemCount: cfg.knowledge.knowledgeJson ? countItems(cfg.knowledge.knowledgeJson) : 0,
            }
            : null,
    };
}
function countItems(json) {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed.items) ? parsed.items.length : 0;
    }
    catch {
        return 0;
    }
}
function sendError(res, status, code, message) {
    res.status(status).json({ ok: false, error: code, message });
}
function createInputRequirementsHandlers(service) {
    const svc = service ?? { getByProjectAndCase: project_case_input_requirement_service_1.getByProjectAndCase, replaceForProjectAndCase: project_case_input_requirement_service_1.replaceForProjectAndCase };
    function validateParams(req) {
        const projectSlug = String(req?.params?.projectSlug ?? "").trim();
        if (!projectSlug) {
            return { error: { status: 400, code: "invalid_project_slug", message: "projectSlug is required" } };
        }
        const caseId = Number(req?.params?.caseId);
        if (!Number.isInteger(caseId) || caseId <= 0) {
            return { error: { status: 400, code: "invalid_case_id", message: "caseId must be a positive integer" } };
        }
        return { projectSlug, caseId };
    }
    function isProjectNotFoundError(err) {
        return err instanceof Error && err.message.includes("project not found");
    }
    function isNamedProfileReferenceError(err) {
        return typeof err === "object" && err !== null && "code" in err && err.code === "named_profile_reference_not_configured";
    }
    async function getInputRequirements(req, res, next) {
        try {
            const parsed = validateParams(req);
            if (parsed.error) {
                sendError(res, parsed.error.status, parsed.error.code, parsed.error.message);
                return;
            }
            const inputRequirements = await svc.getByProjectAndCase(parsed.projectSlug, parsed.caseId);
            res.json({ projectSlug: parsed.projectSlug, caseId: parsed.caseId, inputRequirements });
        }
        catch (err) {
            if (isProjectNotFoundError(err)) {
                sendError(res, 404, "project_not_found", err instanceof Error ? err.message : String(err));
                return;
            }
            if (isNamedProfileReferenceError(err)) {
                sendError(res, 400, "named_profile_reference_not_configured", "named profile reference is not configured for this project");
                return;
            }
            next(err);
        }
    }
    async function putInputRequirements(req, res, next) {
        try {
            const parsed = validateParams(req);
            if (parsed.error) {
                sendError(res, parsed.error.status, parsed.error.code, parsed.error.message);
                return;
            }
            const inputRequirements = (req?.body ?? {})?.inputRequirements;
            if (!Array.isArray(inputRequirements)) {
                sendError(res, 400, "invalid_input_requirements", "inputRequirements must be an array");
                return;
            }
            await svc.replaceForProjectAndCase(parsed.projectSlug, parsed.caseId, inputRequirements);
            const persisted = await svc.getByProjectAndCase(parsed.projectSlug, parsed.caseId);
            res.json({ projectSlug: parsed.projectSlug, caseId: parsed.caseId, inputRequirements: persisted });
        }
        catch (err) {
            if (isProjectNotFoundError(err)) {
                sendError(res, 404, "project_not_found", err instanceof Error ? err.message : String(err));
                return;
            }
            if (isNamedProfileReferenceError(err)) {
                sendError(res, 400, "named_profile_reference_not_configured", "named profile reference is not configured for this project");
                return;
            }
            next(err);
        }
    }
    return { getInputRequirements, putInputRequirements };
}
const inputRequirementsHandlers = createInputRequirementsHandlers();
exports.projectsRouter.get("/:projectSlug/cases/:caseId/input-requirements", inputRequirementsHandlers.getInputRequirements);
exports.projectsRouter.put("/:projectSlug/cases/:caseId/input-requirements", inputRequirementsHandlers.putInputRequirements);
exports.projectsRouter.post("/:projectSlug/cases/:caseId/input-requirements/sync", async (req, res, next) => {
    try {
        const projectSlug = String(req?.params?.projectSlug ?? "").trim();
        const caseId = Number(req?.params?.caseId);
        const rawTestRailCase = req?.body?.rawTestRailCase;
        if (!projectSlug || !Number.isInteger(caseId) || caseId <= 0 || !rawTestRailCase || typeof rawTestRailCase !== "object") {
            sendError(res, 400, "invalid_input_requirements_sync", "projectSlug, caseId and rawTestRailCase are required");
            return;
        }
        const result = await (0, testrail_input_requirements_sync_1.syncTestRailInputRequirements)({ projectSlug, caseId, rawTestRailCase });
        res.json({ projectSlug, caseId, inputRequirements: result.requirements, persisted: result.persisted });
    }
    catch (err) {
        if (err instanceof Error && err.message.includes("project not found")) {
            sendError(res, 404, "project_not_found", err.message);
            return;
        }
        next(err);
    }
});
// The service layer signals bad input with plain Errors ("name is required",
// "loginMode=password requires username", "loginMode must be 1 ..."). Matching both
// "required" and "requires" matters — missing the latter turned validation into a 500.
const VALIDATION_ERROR = /\brequire[sd]\b|loginMode must/i;
function isValidationError(err) {
    return VALIDATION_ERROR.test(err?.message || "");
}
// GET /api/projects
exports.projectsRouter.get("/", async (_req, res, next) => {
    try {
        const projects = await (0, project_repository_1.listProjects)();
        res.json({ projects: projects.map(publicProject) });
    }
    catch (err) {
        next(err);
    }
});
exports.projectsRouter.get("/:projectId/generation-config", async (req, res, next) => {
    try {
        const config = await (0, project_generation_config_service_1.getProjectGenerationConfig)(req.params.projectId);
        if (!config) {
            sendError(res, 404, "generation_config_not_found", "project generation config not found");
            return;
        }
        res.json({ config });
    }
    catch (err) {
        if (/valid UUID/i.test(err?.message || "")) {
            sendError(res, 400, "invalid_project_id", err.message);
            return;
        }
        next(err);
    }
});
exports.projectsRouter.put("/:projectId/generation-config", async (req, res, next) => {
    try {
        const config = await (0, project_generation_config_service_1.upsertProjectGenerationConfig)(req.params.projectId, req.body ?? {});
        res.json({ config });
    }
    catch (err) {
        const code = err?.code;
        if (/valid UUID/i.test(err?.message || "")) {
            sendError(res, 400, "invalid_project_id", err.message);
            return;
        }
        if (code === "invalid_project_generation_config") {
            res.status(400).json({ ok: false, error: code, message: err.message, details: err.details });
            return;
        }
        next(err);
    }
});
// POST /api/projects/inspect-apk — supports both JSON {apkPath} and multipart file upload (field "apk")
exports.projectsRouter.post("/inspect-apk", apkInspectMiddleware, async (req, res) => {
    // LOG TEMPORAL COMPACTO requerido
    const hasFile = !!req.file;
    const hasApkPath = !!(req.body && typeof req.body.apkPath === "string" && req.body.apkPath.trim());
    const filename = req.file?.originalname || (hasApkPath ? String(req.body.apkPath).split(/[\\/]/).pop() : "-");
    const mode = hasFile ? "file" : hasApkPath ? "path" : "unknown";
    console.log(`[apk-inspect-request] mode=${mode} hasFile=${String(hasFile)} hasApkPath=${String(hasApkPath)} filename=${filename}`);
    try {
        let apkPath;
        // req.file existe cuando mode=file (multipart field "apk")
        if (req.file?.path) {
            apkPath = req.file.path;
        }
        else if (req.file && req.file.filename) {
            apkPath = path_1.default.join(managedApkDir, req.file.filename);
        }
        else {
            const b = req.body ?? {};
            const raw = typeof b.apkPath === "string" ? b.apkPath.trim() : "";
            if (raw)
                apkPath = raw;
        }
        if (!apkPath) {
            sendError(res, 400, "validation_error", "apkPath is required (provide file field 'apk' or JSON {apkPath})");
            return;
        }
        const result = (0, apk_inspector_1.inspectApk)(apkPath);
        res.json(result);
    }
    catch (err) {
        // cleanup uploaded file on failure to avoid orphan if inspection failed due to invalid apk
        if (req.file?.path && err instanceof apk_inspector_1.ApkInspectorError && err.code !== "aapt_not_found") {
            try {
                if (err.code === "invalid_apk_path" || err.code === "apk_not_found" || err.code === "apk_inspection_failed") { /* keep file for debugging? delete invalid */ }
            }
            catch { }
        }
        if (err instanceof apk_inspector_1.ApkInspectorError) {
            const status = err.code === "apk_not_found" || err.code === "invalid_apk_path" ? 400
                : err.code === "aapt_not_found" ? 500
                    : 422;
            sendError(res, status, err.code, err.message);
            return;
        }
        // multer fileFilter error wrapped
        if (err?.code === "LIMIT_FILE_SIZE") {
            sendError(res, 400, "invalid_apk_path", "APK file too large");
            return;
        }
        sendError(res, 500, "apk_inspection_failed", err?.message || "Unexpected error during APK inspection");
    }
});
// GET /api/projects/shared-connections
exports.projectsRouter.get("/shared-connections", async (_req, res, next) => {
    try {
        const conn = await (0, sql_connection_1.getConnection)();
        const rows = await conn.query("SELECT id, connectionType, name, baseUrl, email FROM dbo.SharedConnection ORDER BY connectionType, name");
        res.json({ connections: rows });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/projects/shared-connections
exports.projectsRouter.post("/shared-connections", async (req, res, next) => {
    try {
        const b = req.body ?? {};
        const connectionType = Number(b.connectionType);
        const name = typeof b.name === "string" ? b.name.trim() : "";
        const baseUrl = typeof b.baseUrl === "string" ? b.baseUrl.trim() : "";
        const credentialSecretRef = typeof b.credentialSecretRef === "string" ? b.credentialSecretRef.trim() : "";
        const email = typeof b.email === "string" ? b.email.trim() : null;
        if (![1, 2].includes(connectionType)) {
            sendError(res, 400, "validation_error", "connectionType must be 1 (Jira) or 2 (TestRail)");
            return;
        }
        if (!name) {
            sendError(res, 400, "validation_error", "name is required");
            return;
        }
        if (!baseUrl) {
            sendError(res, 400, "validation_error", "baseUrl is required");
            return;
        }
        if (!credentialSecretRef) {
            sendError(res, 400, "validation_error", "credentialSecretRef is required");
            return;
        }
        const conn = await (0, sql_connection_1.getConnection)();
        const dup = await conn.query("SELECT COUNT(*) AS n FROM dbo.SharedConnection WHERE connectionType = ? AND name = ?", [connectionType, name]);
        if (dup[0].n > 0) {
            sendError(res, 409, "duplicate_connection", `A connection with type ${connectionType} and name "${name}" already exists`);
            return;
        }
        const id = crypto_1.default.randomUUID();
        await conn.query("INSERT INTO dbo.SharedConnection (id, connectionType, name, baseUrl, credentialSecretRef, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, SYSUTCDATETIME(), SYSUTCDATETIME())", [id, connectionType, name, baseUrl, credentialSecretRef, email || null]);
        res.status(201).json({ ok: true, connection: { id: id.toUpperCase(), connectionType, name, baseUrl, email } });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/projects/shared-connections/:id
exports.projectsRouter.put("/shared-connections/:id", async (req, res, next) => {
    try {
        const { id } = req.params;
        const b = req.body ?? {};
        const conn = await (0, sql_connection_1.getConnection)();
        const existing = await conn.query("SELECT id, connectionType, name FROM dbo.SharedConnection WHERE id = ?", [id]);
        if (existing.length === 0) {
            sendError(res, 404, "connection_not_found", `Connection not found: ${id}`);
            return;
        }
        const connectionType = b.connectionType !== undefined ? Number(b.connectionType) : existing[0].connectionType;
        const name = typeof b.name === "string" ? b.name.trim() : existing[0].name;
        const baseUrl = typeof b.baseUrl === "string" ? b.baseUrl.trim() : undefined;
        const credentialSecretRef = typeof b.credentialSecretRef === "string" ? b.credentialSecretRef.trim() : undefined;
        const email = typeof b.email === "string" ? b.email.trim() : undefined;
        if (![1, 2].includes(connectionType)) {
            sendError(res, 400, "validation_error", "connectionType must be 1 (Jira) or 2 (TestRail)");
            return;
        }
        if (!name) {
            sendError(res, 400, "validation_error", "name is required");
            return;
        }
        const dup = await conn.query("SELECT COUNT(*) AS n FROM dbo.SharedConnection WHERE connectionType = ? AND name = ? AND id != ?", [connectionType, name, id]);
        if (dup[0].n > 0) {
            sendError(res, 409, "duplicate_connection", `A connection with type ${connectionType} and name "${name}" already exists`);
            return;
        }
        const sets = ["connectionType = ?", "name = ?", "updatedAt = SYSUTCDATETIME()"];
        const vals = [connectionType, name];
        if (baseUrl !== undefined) {
            sets.push("baseUrl = ?");
            vals.push(baseUrl);
        }
        if (credentialSecretRef !== undefined) {
            sets.push("credentialSecretRef = ?");
            vals.push(credentialSecretRef);
        }
        if (email !== undefined) {
            sets.push("email = ?");
            vals.push(email || null);
        }
        vals.push(id);
        await conn.query(`UPDATE dbo.SharedConnection SET ${sets.join(", ")} WHERE id = ?`, vals);
        const updated = await conn.query("SELECT id, connectionType, name, baseUrl, email FROM dbo.SharedConnection WHERE id = ?", [id]);
        res.json({ ok: true, connection: updated[0] });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/projects/:slug
exports.projectsRouter.get("/:slug", async (req, res, next) => {
    try {
        const cfg = await (0, project_reader_1.getProjectConfigurationBySlug)(req.params.slug);
        if (!cfg) {
            sendError(res, 404, "project_not_found", `project not found: ${req.params.slug}`);
            return;
        }
        res.json(publicAggregate(cfg));
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/projects/:slug
exports.projectsRouter.put("/:slug", async (req, res, next) => {
    try {
        const b = req.body ?? {};
        const result = await (0, project_service_1.updateProject)(req.params.slug, b);
        // Re-read aggregate after update for the response
        const cfg = await (0, project_reader_1.getProjectConfigurationBySlug)(req.params.slug);
        // Materialize if READY + enabled
        if (result.status === 1 && cfg) {
            const proj = publicProject(cfg);
            if (proj.enabled) {
                await (0, project_materializer_1.materializeProjectRuntime)({ slug: req.params.slug }).catch(() => { });
            }
        }
        res.json({
            slug: req.params.slug,
            status: result.status,
            reasons: result.reasons,
            project: cfg ? publicProject(cfg) : null,
        });
    }
    catch (err) {
        if (/project not found/i.test(err?.message || "")) {
            sendError(res, 404, "project_not_found", err.message);
            return;
        }
        if (isValidationError(err)) {
            sendError(res, 400, "validation_error", err.message);
            return;
        }
        next(err);
    }
});
// POST /api/projects/web
exports.projectsRouter.post("/web", async (req, res, next) => {
    try {
        const b = req.body ?? {};
        const project = await (0, project_service_1.createWebProject)({
            name: b.name,
            slug: b.slug,
            enabled: b.enabled,
            baseUrl: b.baseUrl,
            loginMode: b.loginMode,
            username: b.username,
            passwordSecretRef: b.passwordSecretRef,
            ignoreHTTPSErrors: b.ignoreHTTPSErrors,
        });
        res.status(201).json({ project: publicProject(project) });
    }
    catch (err) {
        if (/slug already exists/i.test(err?.message || "")) {
            sendError(res, 409, "duplicate_slug", err.message);
            return;
        }
        if (isValidationError(err)) {
            sendError(res, 400, "validation_error", err.message);
            return;
        }
        next(err);
    }
});
// POST /api/projects/mobile
exports.projectsRouter.post("/mobile", async (req, res, next) => {
    console.log(`[projects-mobile-wire] contentType=${req.headers['content-type']} contentLength=${req.headers['content-length']} bodyKeys=${Object.keys(req.body || {}).join(',')} namePresent=${String(!!req.body?.name)}`);
    try {
        const b = req.body ?? {};
        const project = await (0, project_service_1.createMobileProject)({
            name: b.name,
            slug: b.slug,
            enabled: b.enabled,
            apkPath: b.apkPath,
            packageName: b.packageName,
            mainActivity: b.mainActivity,
            appName: b.appName,
            framework: b.framework,
        });
        res.status(201).json({ project: publicProject(project) });
    }
    catch (err) {
        if (/slug already exists/i.test(err?.message || "")) {
            sendError(res, 409, "duplicate_slug", err.message);
            return;
        }
        if (isValidationError(err)) {
            sendError(res, 400, "validation_error", err.message);
            return;
        }
        next(err);
    }
});
// POST /api/projects/:slug/refresh-status
exports.projectsRouter.post("/:slug/refresh-status", async (req, res, next) => {
    try {
        const result = await (0, project_service_1.refreshProjectStatus)({ slug: req.params.slug });
        res.json({ slug: req.params.slug, status: result.status, reasons: result.reasons });
    }
    catch (err) {
        if (/project not found/i.test(err?.message || "")) {
            sendError(res, 404, "project_not_found", err.message);
            return;
        }
        next(err);
    }
});
// PUT /api/projects/:slug/jira
exports.projectsRouter.put("/:slug/jira", async (req, res, next) => {
    try {
        const b = req.body ?? {};
        const result = await (0, project_service_1.upsertJiraConfiguration)(req.params.slug, {
            sharedConnectionId: b.sharedConnectionId || undefined,
            projectKey: b.projectKey,
            acceptanceCriteriaField: b.acceptanceCriteriaField,
            defaultJql: b.defaultJql,
            dryRun: b.dryRun,
        });
        res.json({ ok: true, action: result.action, projectId: result.projectId });
    }
    catch (err) {
        const msg = err?.message || "";
        if (/project not found/i.test(msg)) {
            sendError(res, 404, "project_not_found", msg);
            return;
        }
        if (isValidationError(err)) {
            sendError(res, 400, "validation_error", msg);
            return;
        }
        if (/sharedConnection/i.test(msg)) {
            sendError(res, 400, "connection_error", msg);
            return;
        }
        next(err);
    }
});
// PUT /api/projects/:slug/testrail
exports.projectsRouter.put("/:slug/testrail", async (req, res, next) => {
    try {
        const b = req.body ?? {};
        const result = await (0, project_service_1.upsertTestRailConfiguration)(req.params.slug, {
            sharedConnectionId: b.sharedConnectionId || undefined,
            projectIdTr: b.projectIdTr,
            suiteId: b.suiteId,
            sectionId: b.sectionId,
            sessionId: b.sessionId,
        });
        res.json({ ok: true, action: result.action, projectId: result.projectId });
    }
    catch (err) {
        const msg = err?.message || "";
        if (/project not found/i.test(msg)) {
            sendError(res, 404, "project_not_found", msg);
            return;
        }
        if (isValidationError(err)) {
            sendError(res, 400, "validation_error", msg);
            return;
        }
        if (/sharedConnection/i.test(msg)) {
            sendError(res, 400, "connection_error", msg);
            return;
        }
        next(err);
    }
});
// POST /api/projects/:slug/materialize
exports.projectsRouter.post("/:slug/materialize", async (req, res, next) => {
    try {
        const result = await (0, project_materializer_1.materializeProjectRuntime)({ slug: req.params.slug });
        res.json({ slug: result.slug, filesWritten: result.filesWritten, warnings: result.warnings });
    }
    catch (err) {
        const code = err?.code;
        if (code === "project_not_ready" || code === "project_not_found" || code === "project_disabled") {
            const status = code === "project_not_found" ? 404 : 409;
            sendError(res, status, code, err.message);
            return;
        }
        next(err);
    }
});
// DELETE /api/projects/:slug
exports.projectsRouter.delete("/:slug", async (req, res, next) => {
    try {
        const result = await (0, project_service_1.deleteProject)(req.params.slug);
        res.json({ ok: true, projectDeleted: result.projectDeleted, ...(result.warning ? { warning: result.warning } : {}) });
    }
    catch (err) {
        const msg = err?.message || "";
        if (/project not found/i.test(msg)) {
            sendError(res, 404, "project_not_found", msg);
            return;
        }
        next(err);
    }
});
