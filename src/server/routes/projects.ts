import { Router } from "express";
import crypto from "crypto";
import { listProjects } from "../../db/project-repository";
import {
  createWebProject,
  createMobileProject,
  refreshProjectStatus,
  updateProject,
  upsertJiraConfiguration,
  upsertTestRailConfiguration,
  deleteProject,
} from "../../db/project-service";
import {
  getProjectConfigurationBySlug,
  type ProjectConfiguration,
} from "../../db/project-reader";
import { materializeProjectRuntime } from "../../db/project-materializer";
import { inspectApk, ApkInspectorError } from "../../utils/apk-inspector";
import { getConnection } from "../../db/sql-connection";
import multer from "multer";
import fs from "fs";
import path from "path";

export const projectsRouter = Router();

const managedApkDir = path.resolve(process.cwd(), ".artifacts", "apks");
const apkUpload = multer({
  storage: multer.diskStorage({
    destination: (_req: any, _file: any, cb: any) => {
      try { fs.mkdirSync(managedApkDir, { recursive: true }); } catch {}
      cb(null, managedApkDir);
    },
    filename: (_req: any, file: any, cb: any) => {
      const safe = file.originalname.toLowerCase().endsWith(".apk") ? file.originalname : "app.apk";
      // use uuid to avoid collisions, preserve no user path
      cb(null, `${crypto.randomUUID()}-${safe.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
    },
  }),
  fileFilter: (_req: any, file: any, cb: any) => {
    if (!file.originalname.toLowerCase().endsWith(".apk")) {
      cb(new ApkInspectorError("invalid_apk_path", `APK file must end with .apk: ${file.originalname}`));
    } else cb(null, true);
  },
  limits: { fileSize: 250 * 1024 * 1024 },
});

function apkInspectMiddleware(req: any, res: any, next: any) {
  const ct: string = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) return (apkUpload.single("apk") as any)(req, res, next);
  next();
}

function publicProject(p: { id: string; slug: string; name: string; projectType: number; status: number; enabled: boolean; createdAt: Date; updatedAt: Date }) {
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

function publicAggregate(cfg: ProjectConfiguration) {
  const web = cfg.web
    ? {
        baseUrl: cfg.web.baseUrl,
        loginMode: cfg.web.loginMode,
        username: cfg.web.username,
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

function countItems(json: string): number {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed.items) ? parsed.items.length : 0;
  } catch {
    return 0;
  }
}

function sendError(res: any, status: number, code: string, message: string) {
  res.status(status).json({ ok: false, error: code, message });
}

// The service layer signals bad input with plain Errors ("name is required",
// "loginMode=password requires username", "loginMode must be 1 ..."). Matching both
// "required" and "requires" matters — missing the latter turned validation into a 500.
const VALIDATION_ERROR = /\brequire[sd]\b|loginMode must/i;

function isValidationError(err: any): boolean {
  return VALIDATION_ERROR.test(err?.message || "");
}

// GET /api/projects
projectsRouter.get("/", async (_req, res, next) => {
  try {
    const projects = await listProjects();
    res.json({ projects: projects.map(publicProject) });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/inspect-apk — supports both JSON {apkPath} and multipart file upload (field "apk")
projectsRouter.post("/inspect-apk", apkInspectMiddleware, async (req: any, res) => {
  // LOG TEMPORAL COMPACTO requerido
  const hasFile = !!req.file;
  const hasApkPath = !!(req.body && typeof req.body.apkPath === "string" && req.body.apkPath.trim());
  const filename = (req.file as any)?.originalname || (hasApkPath ? String(req.body.apkPath).split(/[\\/]/).pop() : "-");
  const mode = hasFile ? "file" : hasApkPath ? "path" : "unknown";
  console.log(`[apk-inspect-request] mode=${mode} hasFile=${String(hasFile)} hasApkPath=${String(hasApkPath)} filename=${filename}`);
  try {
    let apkPath: string | undefined;
    // req.file existe cuando mode=file (multipart field "apk")
    if (req.file?.path) {
      apkPath = req.file.path;
    } else if (req.file && (req.file as any).filename) {
      apkPath = path.join(managedApkDir, (req.file as any).filename);
    } else {
      const b = req.body ?? {};
      const raw = typeof b.apkPath === "string" ? b.apkPath.trim() : "";
      if (raw) apkPath = raw;
    }

    if (!apkPath) {
      sendError(res, 400, "validation_error", "apkPath is required (provide file field 'apk' or JSON {apkPath})");
      return;
    }

    const result = inspectApk(apkPath);
    res.json(result);
  } catch (err: any) {
    // cleanup uploaded file on failure to avoid orphan if inspection failed due to invalid apk
    if (req.file?.path && err instanceof ApkInspectorError && err.code !== "aapt_not_found") {
      try { if (err.code === "invalid_apk_path" || err.code === "apk_not_found" || err.code === "apk_inspection_failed") { /* keep file for debugging? delete invalid */ } } catch {}
    }
    if (err instanceof ApkInspectorError) {
      const status =
        err.code === "apk_not_found" || err.code === "invalid_apk_path" ? 400
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
projectsRouter.get("/shared-connections", async (_req, res, next) => {
  try {
    const conn = await getConnection();
    const rows = await conn.query<{ id: string; connectionType: number; name: string; baseUrl: string; email: string | null }>(
      "SELECT id, connectionType, name, baseUrl, email FROM dbo.SharedConnection ORDER BY connectionType, name"
    );
    res.json({ connections: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/shared-connections
projectsRouter.post("/shared-connections", async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const connectionType = Number(b.connectionType);
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const baseUrl = typeof b.baseUrl === "string" ? b.baseUrl.trim() : "";
    const credentialSecretRef = typeof b.credentialSecretRef === "string" ? b.credentialSecretRef.trim() : "";
    const email = typeof b.email === "string" ? b.email.trim() : null;
    if (![1, 2].includes(connectionType)) { sendError(res, 400, "validation_error", "connectionType must be 1 (Jira) or 2 (TestRail)"); return; }
    if (!name) { sendError(res, 400, "validation_error", "name is required"); return; }
    if (!baseUrl) { sendError(res, 400, "validation_error", "baseUrl is required"); return; }
    if (!credentialSecretRef) { sendError(res, 400, "validation_error", "credentialSecretRef is required"); return; }
    const conn = await getConnection();
    const dup = await conn.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM dbo.SharedConnection WHERE connectionType = ? AND name = ?", [connectionType, name]
    );
    if (dup[0].n > 0) { sendError(res, 409, "duplicate_connection", `A connection with type ${connectionType} and name "${name}" already exists`); return; }
    const id = crypto.randomUUID();
    await conn.query(
      "INSERT INTO dbo.SharedConnection (id, connectionType, name, baseUrl, credentialSecretRef, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, SYSUTCDATETIME(), SYSUTCDATETIME())",
      [id, connectionType, name, baseUrl, credentialSecretRef, email || null]
    );
    res.status(201).json({ ok: true, connection: { id: id.toUpperCase(), connectionType, name, baseUrl, email } });
  } catch (err) { next(err); }
});

// PUT /api/projects/shared-connections/:id
projectsRouter.put("/shared-connections/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const b = req.body ?? {};
    const conn = await getConnection();
    const existing = await conn.query<{ id: string; connectionType: number; name: string }>(
      "SELECT id, connectionType, name FROM dbo.SharedConnection WHERE id = ?", [id]
    );
    if (existing.length === 0) { sendError(res, 404, "connection_not_found", `Connection not found: ${id}`); return; }
    const connectionType = b.connectionType !== undefined ? Number(b.connectionType) : existing[0].connectionType;
    const name = typeof b.name === "string" ? b.name.trim() : existing[0].name;
    const baseUrl = typeof b.baseUrl === "string" ? b.baseUrl.trim() : undefined;
    const credentialSecretRef = typeof b.credentialSecretRef === "string" ? b.credentialSecretRef.trim() : undefined;
    const email = typeof b.email === "string" ? b.email.trim() : undefined;
    if (![1, 2].includes(connectionType)) { sendError(res, 400, "validation_error", "connectionType must be 1 (Jira) or 2 (TestRail)"); return; }
    if (!name) { sendError(res, 400, "validation_error", "name is required"); return; }
    const dup = await conn.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM dbo.SharedConnection WHERE connectionType = ? AND name = ? AND id != ?", [connectionType, name, id]
    );
    if (dup[0].n > 0) { sendError(res, 409, "duplicate_connection", `A connection with type ${connectionType} and name "${name}" already exists`); return; }
    const sets: string[] = ["connectionType = ?", "name = ?", "updatedAt = SYSUTCDATETIME()"];
    const vals: any[] = [connectionType, name];
    if (baseUrl !== undefined) { sets.push("baseUrl = ?"); vals.push(baseUrl); }
    if (credentialSecretRef !== undefined) { sets.push("credentialSecretRef = ?"); vals.push(credentialSecretRef); }
    if (email !== undefined) { sets.push("email = ?"); vals.push(email || null); }
    vals.push(id);
    await conn.query(`UPDATE dbo.SharedConnection SET ${sets.join(", ")} WHERE id = ?`, vals);
    const updated = await conn.query<{ id: string; connectionType: number; name: string; baseUrl: string; email: string | null }>(
      "SELECT id, connectionType, name, baseUrl, email FROM dbo.SharedConnection WHERE id = ?", [id]
    );
    res.json({ ok: true, connection: updated[0] });
  } catch (err) { next(err); }
});

// GET /api/projects/:slug
projectsRouter.get("/:slug", async (req, res, next) => {
  try {
    const cfg = await getProjectConfigurationBySlug(req.params.slug);
    if (!cfg) {
      sendError(res, 404, "project_not_found", `project not found: ${req.params.slug}`);
      return;
    }
    res.json(publicAggregate(cfg));
  } catch (err) {
    next(err);
  }
});

// PUT /api/projects/:slug
projectsRouter.put("/:slug", async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const result = await updateProject(req.params.slug, b);

    // Re-read aggregate after update for the response
    const cfg = await getProjectConfigurationBySlug(req.params.slug);

    // Materialize if READY + enabled
    if (result.status === 1 && cfg) {
      const proj = publicProject(cfg);
      if (proj.enabled) {
        await materializeProjectRuntime({ slug: req.params.slug }).catch(() => {});
      }
    }

    res.json({
      slug: req.params.slug,
      status: result.status,
      reasons: result.reasons,
      project: cfg ? publicProject(cfg) : null,
    });
  } catch (err: any) {
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
projectsRouter.post("/web", async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const project = await createWebProject({
      name: b.name,
      slug: b.slug,
      enabled: b.enabled,
      baseUrl: b.baseUrl,
      loginMode: b.loginMode,
      username: b.username,
      passwordSecretRef: b.passwordSecretRef,
    });
    res.status(201).json({ project: publicProject(project) });
  } catch (err: any) {
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
projectsRouter.post("/mobile", async (req, res, next) => {
  console.log(`[projects-mobile-wire] contentType=${req.headers['content-type']} contentLength=${req.headers['content-length']} bodyKeys=${Object.keys(req.body||{}).join(',')} namePresent=${String(!!req.body?.name)}`);
  try {
    const b = req.body ?? {};
    const project = await createMobileProject({
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
  } catch (err: any) {
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
projectsRouter.post("/:slug/refresh-status", async (req, res, next) => {
  try {
    const result = await refreshProjectStatus({ slug: req.params.slug });
    res.json({ slug: req.params.slug, status: result.status, reasons: result.reasons });
  } catch (err: any) {
    if (/project not found/i.test(err?.message || "")) {
      sendError(res, 404, "project_not_found", err.message);
      return;
    }
    next(err);
  }
});

// PUT /api/projects/:slug/jira
projectsRouter.put("/:slug/jira", async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const result = await upsertJiraConfiguration(req.params.slug, {
      sharedConnectionId: b.sharedConnectionId || undefined,
      projectKey: b.projectKey,
      acceptanceCriteriaField: b.acceptanceCriteriaField,
      defaultJql: b.defaultJql,
      dryRun: b.dryRun,
    });
    res.json({ ok: true, action: result.action, projectId: result.projectId });
  } catch (err: any) {
    const msg = err?.message || "";
    if (/project not found/i.test(msg)) { sendError(res, 404, "project_not_found", msg); return; }
    if (isValidationError(err)) { sendError(res, 400, "validation_error", msg); return; }
    if (/sharedConnection/i.test(msg)) { sendError(res, 400, "connection_error", msg); return; }
    next(err);
  }
});

// PUT /api/projects/:slug/testrail
projectsRouter.put("/:slug/testrail", async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const result = await upsertTestRailConfiguration(req.params.slug, {
      sharedConnectionId: b.sharedConnectionId || undefined,
      projectIdTr: b.projectIdTr,
      suiteId: b.suiteId,
      sectionId: b.sectionId,
      sessionId: b.sessionId,
    });
    res.json({ ok: true, action: result.action, projectId: result.projectId });
  } catch (err: any) {
    const msg = err?.message || "";
    if (/project not found/i.test(msg)) { sendError(res, 404, "project_not_found", msg); return; }
    if (isValidationError(err)) { sendError(res, 400, "validation_error", msg); return; }
    if (/sharedConnection/i.test(msg)) { sendError(res, 400, "connection_error", msg); return; }
    next(err);
  }
});

// POST /api/projects/:slug/materialize
projectsRouter.post("/:slug/materialize", async (req, res, next) => {
  try {
    const result = await materializeProjectRuntime({ slug: req.params.slug });
    res.json({ slug: result.slug, filesWritten: result.filesWritten, warnings: result.warnings });
  } catch (err: any) {
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
projectsRouter.delete("/:slug", async (req, res, next) => {
  try {
    const result = await deleteProject(req.params.slug);
    res.json({ ok: true, projectDeleted: result.projectDeleted, ...(result.warning ? { warning: result.warning } : {}) });
  } catch (err: any) {
    const msg = err?.message || "";
    if (/project not found/i.test(msg)) { sendError(res, 404, "project_not_found", msg); return; }
    next(err);
  }
});