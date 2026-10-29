import { Router, type Request, type Response } from "express";
import { listProjectServiceConfigs } from "../../db/project-service-config-repository";
import {
  listServiceBindings,
  removeServiceBinding,
  upsertServiceBinding,
  type BindingOwner,
  type BindingTarget,
} from "../../db/service-binding-repository";
import {
  buildScenarioServiceView,
  isBindingOwnerType,
  normalizeBindingParams,
  normalizeBindingSegment,
  type BindingField,
} from "../../service-catalog/service-bindings";
import { ServiceCatalogError, type ServiceDescriptor } from "../../service-catalog/service-provider";
import { findServiceProvider, getServiceProvider } from "../../service-catalog/service-registry";

/**
 * Service bindings: which catalog service fills which scenario field, set on
 * the general form of a recording / test-design story / case or on one of its
 * scenarios. Mounted at /api/service-bindings; the route policy checks the
 * caller's module permissions and the project named in projectSlug.
 */
export const serviceBindingsRouter = Router();

const MAX_ID_LENGTH = 200;

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

function text(value: unknown): string {
  if (Array.isArray(value)) return text(value[0]);
  return typeof value === "string" ? value.trim() : "";
}

function bad(message: string): ServiceCatalogError {
  return new ServiceCatalogError("invalid_request", 400, message);
}

function readOwner(source: Record<string, unknown>): BindingOwner {
  const projectSlug = text(source.projectSlug);
  const ownerType = text(source.ownerType);
  const ownerId = text(source.ownerId);
  if (!projectSlug) throw bad("projectSlug es obligatorio.");
  if (!isBindingOwnerType(ownerType)) throw bad("ownerType debe ser recording, test_design_story o case.");
  if (!ownerId || ownerId.length > MAX_ID_LENGTH) throw bad("ownerId es obligatorio.");
  return { projectSlug, ownerType, ownerId };
}

function readTarget(source: Record<string, unknown>): BindingTarget {
  const scenarioId = text(source.scenarioId);
  const targetValueKey = text(source.targetValueKey);
  if (scenarioId.length > MAX_ID_LENGTH) throw bad("scenarioId es demasiado largo.");
  if (!targetValueKey || targetValueKey.length > 256) throw bad("targetValueKey es obligatorio.");
  return { ...readOwner(source), scenarioId, targetValueKey };
}

async function enabledServicesFor(projectSlug: string): Promise<ServiceDescriptor[]> {
  const configs = await listProjectServiceConfigs(projectSlug);
  return configs
    .filter((config) => config.enabled)
    .map((config) => findServiceProvider(config.serviceKey)?.descriptor)
    .filter((descriptor): descriptor is ServiceDescriptor => Boolean(descriptor));
}

// GET /api/service-bindings?projectSlug=&ownerType=&ownerId=
serviceBindingsRouter.get("/", handle(async (req, res) => {
  const owner = readOwner(req.query as Record<string, unknown>);
  res.json({ ok: true, bindings: await listServiceBindings(owner) });
}));

// PUT /api/service-bindings  { projectSlug, ownerType, ownerId, scenarioId?, targetValueKey, serviceKey|null, params }
serviceBindingsRouter.put("/", handle(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const target = readTarget(body);
  const serviceKey = body.serviceKey === null ? null : text(body.serviceKey);
  if (serviceKey === null || serviceKey === "") {
    // "Type it by hand" only means something as an override of the general form.
    if (!target.scenarioId) throw bad("Para escribir el valor a mano en el formulario general, elimina el vínculo.");
    const result = await upsertServiceBinding(target, { serviceKey: null, params: {}, updatedBy: req.principal?.username ?? null });
    res.json({ ok: true, ...result });
    return;
  }
  const provider = getServiceProvider(serviceKey);
  const enabled = await enabledServicesFor(target.projectSlug);
  if (!enabled.some((descriptor) => descriptor.key === provider.descriptor.key)) {
    throw new ServiceCatalogError(
      "service_not_enabled",
      409,
      `${provider.descriptor.name} no está activado para este proyecto. Actívalo en el Catálogo de servicios.`,
    );
  }
  const params = normalizeBindingParams(provider.descriptor, body.params);
  const result = await upsertServiceBinding(target, {
    serviceKey: provider.descriptor.key,
    params,
    segment: normalizeBindingSegment(body.segment),
    updatedBy: req.principal?.username ?? null,
  });
  res.json({ ok: true, ...result });
}));

// DELETE /api/service-bindings?projectSlug=&ownerType=&ownerId=&scenarioId=&targetValueKey=
serviceBindingsRouter.delete("/", handle(async (req, res) => {
  const removed = await removeServiceBinding(readTarget(req.query as Record<string, unknown>));
  res.json({ ok: true, removed });
}));

// POST /api/service-bindings/view  { projectSlug, ownerType, ownerId, scenarios: [{ scenarioId, fields }] }
// One call per form: effective bindings, suggestions and missing fields for each scenario.
serviceBindingsRouter.post("/view", handle(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const owner = readOwner(body);
  if (!Array.isArray(body.scenarios)) throw bad("scenarios debe ser una lista.");
  const [bindings, enabledServices] = await Promise.all([listServiceBindings(owner), enabledServicesFor(owner.projectSlug)]);
  const scenarios = (body.scenarios as Array<Record<string, unknown>>).map((scenario) => buildScenarioServiceView({
    scenarioId: text(scenario?.scenarioId),
    fields: (Array.isArray(scenario?.fields) ? scenario.fields : [])
      .filter((field): field is BindingField => Boolean(field) && typeof (field as BindingField).key === "string"),
    bindings,
    enabledServices,
  }));
  res.json({
    ok: true,
    enabledServices: enabledServices.map((descriptor) => ({ key: descriptor.key, name: descriptor.name, category: descriptor.category, params: descriptor.params })),
    general: bindings.filter((binding) => binding.scenarioId === ""),
    scenarios,
  });
}));
