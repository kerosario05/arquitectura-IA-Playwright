import { Router, type Request, type Response } from "express";
import {
  getProjectServiceConfig,
  listAllProjectServiceConfigs,
  listProjectServiceConfigs,
  upsertProjectServiceConfig,
} from "../../db/project-service-config-repository";
import { ServiceCatalogError } from "../../service-catalog/service-provider";
import { getServiceProvider, listServiceProviders } from "../../service-catalog/service-registry";
import { filterByProjectAccess } from "../middleware/route-policy";

/**
 * Catálogo de servicios: reusable services (OTP first) that fill a scenario
 * field at run time, and each project's settings for them. Mounted at
 * /api/service-catalog; the route policy enforces services.* and project access.
 * A produced value leaves this router only through the test endpoint, which an
 * editor (services.edit) calls on purpose to see the code a service generates.
 */
export const serviceCatalogRouter = Router();

function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: (err?: unknown) => void) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ServiceCatalogError) {
        res.status(err.httpStatus).json({ ok: false, error: err.code, message: err.message });
        return;
      }
      if (/project not found/i.test((err as Error)?.message ?? "")) {
        res.status(404).json({ ok: false, error: "project_not_found", message: (err as Error).message });
        return;
      }
      next(err);
    }
  };
}

// GET /api/service-catalog
serviceCatalogRouter.get("/", handle(async (req, res) => {
  const configs = filterByProjectAccess(req.principal, await listAllProjectServiceConfigs(), (c) => c.projectSlug);
  res.json({
    services: listServiceProviders().map((provider) => ({
      ...provider.descriptor,
      availability: provider.availability(),
      projects: configs
        .filter((config) => config.serviceKey === provider.descriptor.key)
        .map((config) => ({ slug: config.projectSlug, enabled: config.enabled, legacy: config.legacy })),
    })),
  });
}));

// GET /api/service-catalog/projects/:slug/services — every catalog service, configured or not.
serviceCatalogRouter.get("/projects/:slug/services", handle(async (req, res) => {
  const configs = await listProjectServiceConfigs(param(req, "slug"));
  res.json({
    services: listServiceProviders().map((provider) => {
      const config = configs.find((c) => c.serviceKey === provider.descriptor.key);
      return {
        serviceKey: provider.descriptor.key,
        name: provider.descriptor.name,
        category: provider.descriptor.category,
        configured: Boolean(config),
        enabled: config?.enabled ?? false,
        settings: config?.settings ?? provider.normalizeSettings({}),
        legacy: config?.legacy ?? false,
        updatedAt: config?.updatedAt ?? null,
      };
    }),
  });
}));

// PUT /api/service-catalog/projects/:slug/services/:serviceKey  { enabled, settings }
serviceCatalogRouter.put("/projects/:slug/services/:serviceKey", handle(async (req, res) => {
  const provider = getServiceProvider(param(req, "serviceKey"));
  const body = (req.body ?? {}) as Record<string, unknown>;
  const settings = provider.normalizeSettings(body.settings);
  const result = await upsertProjectServiceConfig(param(req, "slug"), provider.descriptor.key, {
    enabled: body.enabled !== false,
    settings,
  });
  res.json({ ok: true, action: result.action, config: result.config });
}));

// POST /api/service-catalog/projects/:slug/services/:serviceKey/test  { params, settings? }
// `settings` tests unsaved form values; without it the saved configuration is used.
serviceCatalogRouter.post("/projects/:slug/services/:serviceKey/test", handle(async (req, res) => {
  const provider = getServiceProvider(param(req, "serviceKey"));
  const body = (req.body ?? {}) as Record<string, unknown>;
  const availability = provider.availability();
  if (!availability.available) {
    res.status(503).json({ ok: false, error: "service_unavailable", message: availability.reasons.join(" "), availability });
    return;
  }
  let settings: Record<string, unknown>;
  if (body.settings !== undefined) {
    settings = provider.normalizeSettings(body.settings);
  } else {
    const saved = await getProjectServiceConfig(param(req, "slug"), provider.descriptor.key);
    if (!saved || !saved.enabled) {
      throw new ServiceCatalogError("service_not_enabled", 409, "El servicio no está activado para este proyecto.");
    }
    settings = saved.settings;
  }
  const params = (body.params && typeof body.params === "object" ? body.params : {}) as Record<string, unknown>;
  const started = Date.now();
  const result = await provider.resolve({ projectSlug: param(req, "slug"), settings }, params);
  // The test is the one place a produced value is shown: an editor asked for it on purpose,
  // the service only runs in local/qa, and it is never logged or cached.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.json({
    ok: true,
    value: result.value,
    valueLength: result.value.length,
    meta: result.meta,
    durationMs: Date.now() - started,
  });
}));
