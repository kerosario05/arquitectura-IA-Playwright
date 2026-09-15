import { Router, type Request, type Response } from "express";
import {
  AdminError,
  createRole,
  deleteRole,
  getRole,
  listRoles,
  setRolePermissions,
  updateRole,
} from "../../auth/user-admin-service";
import { PERMISSION_MODULES } from "../../auth/permissions";
import { requireAuth, requirePermission } from "../middleware/auth";

export const rolesRouter = Router();

/**
 * The catalogue itself is static reference data and is what the role editor
 * renders its checkbox tree from, so any authenticated caller may read it.
 * Everything that *changes* a role needs `admin.roles`.
 */
export const permissionsRouter = Router();
permissionsRouter.get("/", requireAuth(), (_req: Request, res: Response) => {
  res.json({ ok: true, modules: PERMISSION_MODULES });
});

rolesRouter.use(requirePermission("admin.roles"));

/** Express 5 types route params as string | string[]; normalize to a single value. */
function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : String(value ?? "");
}

function actorId(req: Request): string | null {
  return req.principal?.userId ?? null;
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof AdminError) {
    res.status(err.status).json({
      ok: false,
      error: err.code,
      message: err.message,
      ...(err.details ?? {}),
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[roles] error inesperado:`, message);
  res.status(500).json({ ok: false, error: "internal_error", message });
}

/** GET /api/roles — every role with its permissions and assignment count. */
rolesRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const roles = await listRoles();
    res.json({ ok: true, total: roles.length, roles });
  } catch (err) {
    handleError(res, err);
  }
});

/** POST /api/roles — { slug, name, description?, permissions[] }. */
rolesRouter.post("/", async (req: Request, res: Response) => {
  try {
    const role = await createRole(req.body ?? {}, actorId(req));
    res.status(201).json({ ok: true, role });
  } catch (err) {
    handleError(res, err);
  }
});

/** GET /api/roles/:id */
rolesRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    res.json({ ok: true, role: await getRole(pathParam(req, "id")) });
  } catch (err) {
    handleError(res, err);
  }
});

/** PATCH /api/roles/:id — name and description only. */
rolesRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const role = await updateRole(pathParam(req, "id"), req.body ?? {}, actorId(req));
    res.json({ ok: true, role });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * PUT /api/roles/:id/permissions — { permissions: [...] }.
 * Revokes the sessions of everyone holding the role, so the new set takes
 * effect on their next login rather than whenever their token happened to expire.
 */
rolesRouter.put("/:id/permissions", async (req: Request, res: Response) => {
  try {
    const role = await setRolePermissions(pathParam(req, "id"), req.body?.permissions, actorId(req));
    res.json({ ok: true, role });
  } catch (err) {
    handleError(res, err);
  }
});

/** DELETE /api/roles/:id — refused for system roles and roles still in use. */
rolesRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    await deleteRole(pathParam(req, "id"), actorId(req));
    res.json({ ok: true, deleted: true });
  } catch (err) {
    handleError(res, err);
  }
});
