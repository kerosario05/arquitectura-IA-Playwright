import { Router } from "express";
import crypto from "crypto";
import { getProjectBySlug, listProjects } from "../../db/project-repository";
import { getConfirmedRuntimeValues } from "../../db/project-case-runtime-value-service";
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
import { inspectApkFile, ApkInspectorError } from "../../utils/apk-inspector";
import { getConnection } from "../../db/sql-connection";
import {
  getByProjectAndCase,
  replaceForProjectAndCase,
  type InputRequirement,
} from "../../db/project-case-input-requirement-service";
import { syncTestRailInputRequirements } from "../../testrail/testrail-input-requirements-sync";
import { filterByProjectAccess } from "../middleware/route-policy";
import { isJiraSpecGenerationEnabled } from "../services/spec-generation-policy";
import multer from "multer";
import fs from "fs";
import path from "path";
import { getProjectGenerationConfig, upsertProjectGenerationConfig } from "../../db/project-generation-config-service";
import { createProjectDataCatalog, listProjectDataCatalogs, ProjectDataCatalogError, setProjectDataCatalogOptionActive, updateProjectDataCatalog } from "../../db/project-data-catalog-service";
import {
  deleteRepositoryConfig,
  getRepositoryConfigBySlug,
  publicRepositoryConfig,
  upsertRepositoryConfig,
} from "../../db/project-repository-config-service";
import { normalizeRepositoryConfig, RepositoryConfigValidationError } from "../../test-planning/repository-config";
import { GitCommandError, gitErrorStatus, testRepositoryAccess } from "../../test-planning/git-cli";
import { loadPromotedAppConfigSync, savePromotedAppConfig } from "../../automations/app-profile";
import {
  createPortalRequestCancellationService,
  getPortalCancellationEnvironment,
  PortalCancellationError,
} from "../services/portal-comercial-request-cancellation";
import { withCancellationService } from "../services/portal-cancellation-runner";
import {
  CancellationAlreadyRunningError,
  getCancellationOperation,
  getLatestCancellationOperation,
  startCancellationOperation,
} from "../services/portal-cancellation-operations";
import {
  deleteServiceCredential,
  getServiceCredentialStatus,
  saveServiceCredential,
  ServiceCredentialError,
} from "../../db/project-service-credential-service";
import { SecretBoxError } from "../../db/secret-box";
import { cancelRequestsByIds, createDbCedulaReleaser, listCancellableRequests, PortalDbError, portalDbLocation } from "../services/portal-requests-db";
import { describePortalDbAccess, PORTAL_DB_CREDENTIAL, resolvePortalDbTarget } from "../services/portal-db-target";
import { PortalDbImportError, readPortalDbSettingsFile } from "../services/portal-db-import";
import { resolvePortalLogin } from "../services/portal-login-resolver";
import { createSessionCedulaReleaser } from "../services/data-cedulas-reuse";
import {
  findNextDataCedulasCustomers,
  listDataCedulasTnsAliases,
  validateDataCedulasDatabase,
} from "../services/data-cedulas-new-customer";

export const projectsRouter = Router();

const PORTAL_CANCELLATION_PROJECT = "portal-comercial";

function getPortalCancellationAppConfig(slug: string) {
  if (slug !== PORTAL_CANCELLATION_PROJECT) return null;
  return loadPromotedAppConfigSync({ appSlug: PORTAL_CANCELLATION_PROJECT });
}

function sendPortalCancellationError(res: any, error: unknown) {
  if (error instanceof PortalCancellationError) {
    sendError(res, error.status, error.code, error.message);
    return;
  }
  sendError(res, 500, "cancellation_internal_error", "No se pudo completar la operación de solicitudes QA.");
}

projectsRouter.get("/:slug/request-cancellation-config", (req, res) => {
  const appConfig = getPortalCancellationAppConfig(req.params.slug);
  if (!appConfig) {
    sendError(res, 404, "request_cancellation_unavailable", "La cancelación QA no está disponible para este proyecto.");
    return;
  }
  res.json({
    enabled: appConfig.requestCancellation?.enabled === true,
    configured: getPortalCancellationEnvironment().configured,
  });
});

projectsRouter.put("/:slug/request-cancellation-config", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    sendError(res, 400, "enabled_required", "Indica explícitamente si la cancelación QA queda habilitada.");
    return;
  }
  const appConfig = getPortalCancellationAppConfig(req.params.slug);
  if (!appConfig) {
    sendError(res, 404, "request_cancellation_unavailable", "La cancelación QA no está disponible para este proyecto.");
    return;
  }
  try {
    const updated = {
      ...appConfig,
      requestCancellation: { enabled: req.body.enabled },
      updatedAt: new Date().toISOString(),
    };
    await savePromotedAppConfig(updated);
    res.json({ ok: true, enabled: updated.requestCancellation.enabled });
  } catch {
    sendError(res, 500, "request_cancellation_config_save_failed", "No se pudo guardar la configuración de cancelación QA.");
  }
});

function getDataServicesAppConfig(slug: string) {
  return loadPromotedAppConfigSync({ appSlug: slug });
}

projectsRouter.get("/:slug/data-services", (req, res) => {
  const appConfig = getDataServicesAppConfig(req.params.slug);
  if (!appConfig) {
    sendError(res, 404, "data_services_unavailable", "Los servicios de datos no están disponibles para este proyecto.");
    return;
  }
  const dataCedulas = appConfig.dataServices?.dataCedulas;
  const recordingSpecGenerationEnabled = !["false", "0", "off", "no", "disabled"].includes(
    (process.env.RECORDING_SPEC_GENERATION_ENABLED ?? "true").trim().toLowerCase(),
  );
  const jiraSpecGenerationEnabled = isJiraSpecGenerationEnabled();
  res.json({
    ok: true,
    databases: listDataCedulasTnsAliases(),
    services: {
      dataCedulas: {
        enabled: dataCedulas?.enabled === true,
        database: dataCedulas?.database ?? "",
      },
      recordingSpecGenerationEnabled,
      jiraSpecGenerationEnabled,
    },
  });
});

projectsRouter.put("/:slug/data-services/data-cedulas", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    sendError(res, 400, "enabled_required", "Indica explícitamente si el servicio de cédulas queda habilitado.");
    return;
  }
  const appConfig = getDataServicesAppConfig(req.params.slug);
  if (!appConfig) {
    sendError(res, 404, "data_services_unavailable", "Los servicios de datos no están disponibles para este proyecto.");
    return;
  }
  try {
    const database = req.body.enabled ? validateDataCedulasDatabase(req.body.database) : String(req.body.database ?? "").trim().toUpperCase();
    const updated = {
      ...appConfig,
      dataServices: {
        ...(appConfig.dataServices ?? {}),
        dataCedulas: { enabled: req.body.enabled, database },
      },
      updatedAt: new Date().toISOString(),
    };
    await savePromotedAppConfig(updated);
    res.json({ ok: true, enabled: updated.dataServices.dataCedulas.enabled, database: updated.dataServices.dataCedulas.database });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(res, 400, "data_services_config_invalid", message);
  }
});

projectsRouter.post("/:slug/data-services/data-cedulas/generate", async (req, res) => {
  const appConfig = getDataServicesAppConfig(req.params.slug);
  const service = appConfig?.dataServices?.dataCedulas;
  if (!service?.enabled) {
    sendError(res, 409, "data_cedulas_disabled", "Habilita el servicio de cédulas para este proyecto antes de generar datos.");
    return;
  }
  try {
    const database = validateDataCedulasDatabase(service.database);
    const rawCount = req.body?.count;
    const count = rawCount === undefined ? 1 : Number(rawCount);
    if (!Number.isSafeInteger(count) || count < 1 || count > 2) {
      sendError(res, 400, "data_cedulas_invalid_count", "count debe ser 1 o 2.");
      return;
    }
    const excludeCedulas = Array.isArray(req.body?.excludeCedulas)
      ? req.body.excludeCedulas.filter((value: unknown): value is string => typeof value === "string").slice(0,100)
      : [];
    // Before a cédula is handed out, its open Portal requests are cancelled straight in the Portal database;
    // without a configured database, with the project's saved Portal login instead.
    const dbTarget = await resolvePortalDbTarget(req.params.slug).catch(() => undefined);
    const portal = dbTarget ? undefined : await resolvePortalLogin(req.params.slug);
    const release = dbTarget ? createDbCedulaReleaser(dbTarget) : portal ? createSessionCedulaReleaser(portal.login) : undefined;
    const result = await findNextDataCedulasCustomers(database, count, excludeCedulas, release ? { release } : {});
    if (!result) {
      sendError(res, 404, "data_cedulas_not_found", "No se encontró una cédula nueva dentro del límite de búsqueda.");
      return;
    }
    const cedulas = result.customers.map((customer) => customer.Cedula);
    if (cedulas.length < count) {
      sendError(res, 404, "data_cedulas_not_found", `No se encontraron ${count} cédulas nuevas dentro del límite de búsqueda.`);
      return;
    }
    res.setHeader('X-Data-Cedulas-PLAFT', result.plaftStatus);
    res.json({ ok: true, cedula: cedulas[0], cedulas });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[data-cedulas:${req.params.slug}] ${message}`);
    sendError(res, 502, "data_cedulas_unavailable", message);
  }
});

type CancellationHandler = (service: ReturnType<typeof createPortalRequestCancellationService>, body: any) => Promise<unknown>;

/** `manual`: an explicit run from the service panel works without assigning the service to the project. */
function portalCancellationRoute(handler: CancellationHandler, options: { manual?: boolean } = {}) {
  return async (req: any, res: any) => {
    const appConfig = getPortalCancellationAppConfig(req.params.slug);
    if (!appConfig) {
      sendError(res, 404, "request_cancellation_unavailable", "La cancelación QA no está disponible para este proyecto.");
      return;
    }
    try {
      res.json(await withCancellationService(req.params.slug, options.manual === true || appConfig.requestCancellation?.enabled === true, (service) => handler(service, req.body)));
    } catch (error) { sendPortalCancellationError(res, error); }
  };
}

projectsRouter.post("/:slug/requests/cancellation-preview", portalCancellationRoute((service, body) => service.preview(body?.identification)));
projectsRouter.post("/:slug/requests/cancel-all", portalCancellationRoute((service, body) => service.cancelAll(body?.identification, body?.confirmed)));
projectsRouter.post("/:slug/requests/cancel", portalCancellationRoute((service, body) => service.cancel(body?.identification, body?.requestIds, body?.confirmed)));
// By creator: every cancellable request opened by one Portal user (e.g. the QA user), reviewed first.
projectsRouter.post("/:slug/requests/cancellation-preview-by-creator", portalCancellationRoute((service, body) => service.previewByCreator(body?.createdBy, body?.requestTypes), { manual: true }));
// Long run: starts in the background and answers 202; the panel polls GET .../cancel-by-creator/:operationId.
projectsRouter.post("/:slug/requests/cancel-by-creator", async (req: any, res: any) => {
  const appConfig = getPortalCancellationAppConfig(req.params.slug);
  if (!appConfig) { sendError(res, 404, "request_cancellation_unavailable", "La cancelación QA no está disponible para este proyecto."); return; }
  if (req.body?.confirmed !== true) { sendError(res, 400, "confirmation_required", "Confirma explícitamente la vista previa antes de cancelar."); return; }
  const slug = req.params.slug as string;
  const createdBy = String(req.body?.createdBy ?? "").trim();
  try {
    const operation = startCancellationOperation(slug, createdBy, (onProgress) =>
      withCancellationService(slug, true, (service) => service.cancelByCreator(createdBy, true, req.body?.requestTypes, onProgress)));
    res.status(202).json({ operationId: operation.id, status: operation.status });
  } catch (error) {
    if (error instanceof CancellationAlreadyRunningError) { res.status(409).json({ ok: false, error: "cancellation_already_running", message: "Ya hay una cancelación en curso para este proyecto.", operationId: error.operationId }); return; }
    sendPortalCancellationError(res, error);
  }
});
const operationView = (operation: NonNullable<ReturnType<typeof getCancellationOperation>>) => ({
  operationId: operation.id, status: operation.status, createdBy: operation.createdBy, total: operation.total,
  cancelledCount: operation.cancelledIds.length, cancelledIds: operation.cancelledIds, failed: operation.failed,
  ...(operation.error ? { error: operation.error } : {}), startedAt: operation.startedAt,
  ...(operation.finishedAt ? { finishedAt: operation.finishedAt } : {}),
});
// The run in progress (or the latest one): lets a reopened panel follow it without starting anything.
projectsRouter.get("/:slug/requests/cancel-by-creator", (req: any, res: any) => {
  const operation = getLatestCancellationOperation(req.params.slug);
  res.json(operation ? operationView(operation) : { status: "none" });
});
projectsRouter.get("/:slug/requests/cancel-by-creator/:operationId", (req: any, res: any) => {
  const operation = getCancellationOperation(req.params.slug, req.params.operationId);
  if (!operation) { sendError(res, 404, "operation_not_found", "No existe esa operación (el servidor pudo reiniciarse)."); return; }
  res.json(operationView(operation));
});

// Cancel Portal requests straight in the Portal API database, for a reviewed selection of one creator's requests.
function sendPortalDbError(res: any, error: unknown) {
  if (error instanceof PortalDbError) { sendError(res, error.status, error.code, error.message); return; }
  if (error instanceof ServiceCredentialError) { sendError(res, error.status, error.code, error.message); return; }
  sendError(res, 500, "portal_db_internal_error", "No se pudo completar la operación en la base del Portal.");
}
projectsRouter.get("/:slug/requests/db-cancellation/config", async (req: any, res: any) => {
  if (!getPortalCancellationAppConfig(req.params.slug)) { sendError(res, 404, "request_cancellation_unavailable", "La cancelación QA no está disponible para este proyecto."); return; }
  try {
    const access = await describePortalDbAccess(req.params.slug);
    res.json({ ...access, settingsPathHint: process.env.PORTAL_API_APPSETTINGS?.trim() || undefined,
      credentials: await getServiceCredentialStatus(req.params.slug, PORTAL_DB_CREDENTIAL) });
  } catch (error) { sendPortalDbError(res, error); }
});
// Import the database sign-in from the Portal API's appsettings.json (read on the machine where QA Lab runs).
// Only user/server/database are returned; the password is stored encrypted and never leaves the server.
projectsRouter.post("/:slug/requests/db-cancellation/import-settings", async (req: any, res: any) => {
  if (!getPortalCancellationAppConfig(req.params.slug)) { sendError(res, 404, "request_cancellation_unavailable", "La cancelación QA no está disponible para este proyecto."); return; }
  try {
    const imported = readPortalDbSettingsFile(req.body?.path);
    const status = await saveServiceCredential(req.params.slug, PORTAL_DB_CREDENTIAL, { username: imported.user, password: imported.password }, req.principal?.username);
    const location = portalDbLocation();
    res.json({ credentials: status, username: imported.user, server: imported.server, database: imported.database,
      matchesConfiguredLocation: location.server === imported.server && location.database === imported.database });
  } catch (error) {
    if (error instanceof PortalDbImportError) { sendError(res, error.status, error.code, error.message); return; }
    sendPortalDbError(res, error);
  }
});projectsRouter.post("/:slug/requests/db-cancellation/preview", async (req: any, res: any) => {
  if (!getPortalCancellationAppConfig(req.params.slug)) { sendError(res, 404, "request_cancellation_unavailable", "La cancelación QA no está disponible para este proyecto."); return; }
  try { res.json(await listCancellableRequests(await resolvePortalDbTarget(req.params.slug), req.body?.createdBy)); }
  catch (error) { sendPortalDbError(res, error); }
});
projectsRouter.post("/:slug/requests/db-cancellation/cancel", async (req: any, res: any) => {
  if (!getPortalCancellationAppConfig(req.params.slug)) { sendError(res, 404, "request_cancellation_unavailable", "La cancelación QA no está disponible para este proyecto."); return; }
  try {
    res.json(await cancelRequestsByIds(await resolvePortalDbTarget(req.params.slug), {
      createdBy: req.body?.createdBy, ids: req.body?.ids, confirmed: req.body?.confirmed, dryRun: req.body?.dryRun === true, actor: req.principal?.username,
    }));
  } catch (error) { sendPortalDbError(res, error); }
});
// Credentials a catalog service asks for from its own panel. The password is write-only: reads return status.
function sendServiceCredentialError(res: any, error: unknown) {
  if (error instanceof ServiceCredentialError) { sendError(res, error.status, error.code, error.message); return; }
  if (error instanceof SecretBoxError) { sendError(res, 500, error.code, error.message); return; }
  sendError(res, 500, "service_credential_internal_error", "No se pudo completar la operación de credenciales.");
}
projectsRouter.get("/:slug/service-credentials/:credentialKey", async (req: any, res: any) => {
  try { res.json(await getServiceCredentialStatus(req.params.slug, req.params.credentialKey)); }
  catch (error) { sendServiceCredentialError(res, error); }
});
projectsRouter.put("/:slug/service-credentials/:credentialKey", async (req: any, res: any) => {
  try { res.json(await saveServiceCredential(req.params.slug, req.params.credentialKey, req.body ?? {}, req.principal?.username)); }
  catch (error) { sendServiceCredentialError(res, error); }
});
projectsRouter.delete("/:slug/service-credentials/:credentialKey", async (req: any, res: any) => {
  try { await deleteServiceCredential(req.params.slug, req.params.credentialKey); res.json({ configured: false }); }
  catch (error) { sendServiceCredentialError(res, error); }
});
projectsRouter.get("/:projectSlug/data-catalogs", async (req, res, next) => {
  try { res.json({ catalogs: await listProjectDataCatalogs(req.params.projectSlug, req.query.includeInactive === "true") }); }
  catch (error) { next(error); }
});
projectsRouter.post("/:projectSlug/data-catalogs", async (req, res, next) => {
  try { res.status(201).json({ catalog: await createProjectDataCatalog(req.params.projectSlug, req.body) }); }
  catch (error) {
    if (error instanceof ProjectDataCatalogError) return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    next(error);
  }
});
projectsRouter.put("/:projectSlug/data-catalogs/:catalogId", async (req, res, next) => {
  try { res.json({ catalog: await updateProjectDataCatalog(req.params.projectSlug, req.params.catalogId, req.body) }); }
  catch (error) {
    if (error instanceof ProjectDataCatalogError) return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    next(error);
  }
});
projectsRouter.patch("/:projectSlug/data-catalogs/:catalogId/options/:optionId", async (req, res, next) => {
  try {
    if (typeof req.body?.active !== "boolean") return res.status(400).json({ ok: false, error: "active_required", message: "Indica si la opción debe estar activa." });
    res.json({ catalog: await setProjectDataCatalogOptionActive(req.params.projectSlug, req.params.catalogId, req.params.optionId, req.body.active) });
  } catch (error) {
    if (error instanceof ProjectDataCatalogError) return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    next(error);
  }
});

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

export type InputRequirementService = {
  getByProjectAndCase: typeof getByProjectAndCase;
  replaceForProjectAndCase: typeof replaceForProjectAndCase;
};

type RuntimeInputValueReader = {
  getProjectBySlug: typeof getProjectBySlug;
  getConfirmedRuntimeValues: typeof getConfirmedRuntimeValues;
};

export function createInputRequirementsHandlers(service?: InputRequirementService, runtimeValueReader?: RuntimeInputValueReader) {
  const svc: InputRequirementService = service ?? { getByProjectAndCase, replaceForProjectAndCase };
  const valueReader = runtimeValueReader ?? (service ? undefined : { getProjectBySlug, getConfirmedRuntimeValues });

  function validateParams(req: any): { projectSlug?: string; caseId?: number; error?: { status: number; code: string; message: string } } {
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

  function isProjectNotFoundError(err: unknown): boolean {
    return err instanceof Error && err.message.includes("project not found");
  }

  function isNamedProfileReferenceError(err: unknown): boolean {
    return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "named_profile_reference_not_configured";
  }

  async function getInputRequirements(req: any, res: any, next: any): Promise<void> {
    try {
      const parsed = validateParams(req);
      if (parsed.error) {
        sendError(res, parsed.error.status, parsed.error.code, parsed.error.message);
        return;
      }
      const inputRequirements = await svc.getByProjectAndCase(parsed.projectSlug!, parsed.caseId!);
      let runtimeValues: Record<string, string | number | boolean> | undefined;
      if (valueReader) {
        const project = await valueReader.getProjectBySlug(parsed.projectSlug!);
        const savedValues = project
          ? await valueReader.getConfirmedRuntimeValues(project.id, parsed.caseId!)
          : [];
        runtimeValues = Object.fromEntries(savedValues.map((entry) => [entry.key, entry.value]));
      }
      res.json({ projectSlug: parsed.projectSlug, caseId: parsed.caseId, inputRequirements, inputRequirementsSyncVersion: 2, ...(runtimeValues ? { runtimeValues } : {}) });
    } catch (err) {
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

  async function putInputRequirements(req: any, res: any, next: any): Promise<void> {
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
      await svc.replaceForProjectAndCase(parsed.projectSlug!, parsed.caseId!, inputRequirements as InputRequirement[]);
      const persisted = await svc.getByProjectAndCase(parsed.projectSlug!, parsed.caseId!);
      res.json({ projectSlug: parsed.projectSlug, caseId: parsed.caseId, inputRequirements: persisted });
    } catch (err) {
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

projectsRouter.get("/:projectSlug/cases/:caseId/input-requirements", inputRequirementsHandlers.getInputRequirements);
projectsRouter.put("/:projectSlug/cases/:caseId/input-requirements", inputRequirementsHandlers.putInputRequirements);

projectsRouter.post("/:projectSlug/cases/:caseId/input-requirements/sync", async (req: any, res: any, next: any) => {
  try {
    const projectSlug = String(req?.params?.projectSlug ?? "").trim();
    const caseId = Number(req?.params?.caseId);
    const rawTestRailCase = req?.body?.rawTestRailCase;
    if (!projectSlug || !Number.isInteger(caseId) || caseId <= 0 || !rawTestRailCase || typeof rawTestRailCase !== "object") {
      sendError(res, 400, "invalid_input_requirements_sync", "projectSlug, caseId and rawTestRailCase are required");
      return;
    }
    const result = await syncTestRailInputRequirements({ projectSlug, caseId, rawTestRailCase });
    res.json({ projectSlug, caseId, inputRequirements: result.requirements, persisted: result.persisted });
  } catch (err) {
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

function isValidationError(err: any): boolean {
  return VALIDATION_ERROR.test(err?.message || "");
}

// GET /api/projects
projectsRouter.get("/", async (req, res, next) => {
  try {
    const projects = await listProjects();
    // A scoped user must not even learn that other projects exist.
    const visible = filterByProjectAccess(req.principal, projects, (project) => project.slug);
    res.json({ projects: visible.map(publicProject) });
  } catch (err) {
    next(err);
  }
});

projectsRouter.get("/:projectId/generation-config", async (req, res, next) => {
  try {
    const config = await getProjectGenerationConfig(req.params.projectId);
    if (!config) { sendError(res, 404, "generation_config_not_found", "project generation config not found"); return; }
    res.json({ config });
  } catch (err: any) {
    if (/valid UUID/i.test(err?.message || "")) { sendError(res, 400, "invalid_project_id", err.message); return; }
    next(err);
  }
});

projectsRouter.put("/:projectId/generation-config", async (req, res, next) => {
  try {
    const config = await upsertProjectGenerationConfig(req.params.projectId, req.body ?? {});
    res.json({ config });
  } catch (err: any) {
    const code = err?.code;
    if (/valid UUID/i.test(err?.message || "")) { sendError(res, 400, "invalid_project_id", err.message); return; }
    if (code === "invalid_project_generation_config") {
      res.status(400).json({ ok: false, error: code, message: err.message, details: err.details });
      return;
    }
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

    const result = await inspectApkFile(apkPath);
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
      ignoreHTTPSErrors: b.ignoreHTTPSErrors,
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

// --- Repositorio de planes de prueba (Planificación de pruebas) ---------------

function sendRepositoryError(res: any, err: any, next: (err?: unknown) => void) {
  if (err instanceof RepositoryConfigValidationError) {
    res.status(400).json({ ok: false, error: "validation_error", message: err.message, field: err.field });
    return;
  }
  if (err instanceof GitCommandError) {
    sendError(res, gitErrorStatus(err), err.code, err.message);
    return;
  }
  if (/project not found/i.test(err?.message || "")) {
    sendError(res, 404, "project_not_found", err.message);
    return;
  }
  next(err);
}

// GET /api/projects/:slug/repository
projectsRouter.get("/:slug/repository", async (req, res, next) => {
  try {
    const config = await getRepositoryConfigBySlug(req.params.slug);
    res.json({ repository: config ? publicRepositoryConfig(config) : null });
  } catch (err) {
    sendRepositoryError(res, err, next);
  }
});

// PUT /api/projects/:slug/repository
projectsRouter.put("/:slug/repository", async (req, res, next) => {
  try {
    const result = await upsertRepositoryConfig(req.params.slug, req.body ?? {});
    res.json({ ok: true, action: result.action, repository: publicRepositoryConfig(result.config) });
  } catch (err) {
    sendRepositoryError(res, err, next);
  }
});

// DELETE /api/projects/:slug/repository
projectsRouter.delete("/:slug/repository", async (req, res, next) => {
  try {
    const removed = await deleteRepositoryConfig(req.params.slug);
    res.json({ ok: true, removed });
  } catch (err) {
    sendRepositoryError(res, err, next);
  }
});

// POST /api/projects/:slug/repository/test — body = unsaved form values, or empty to test the saved config.
projectsRouter.post("/:slug/repository/test", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const config = body.repoUrl
      ? normalizeRepositoryConfig(body)
      : await getRepositoryConfigBySlug(req.params.slug);
    if (!config) {
      sendError(res, 404, "repository_not_configured", "El proyecto no tiene un repositorio configurado.");
      return;
    }
    res.json(await testRepositoryAccess(config));
  } catch (err) {
    sendRepositoryError(res, err, next);
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
