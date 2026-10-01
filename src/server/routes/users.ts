import { Router, type Request, type Response } from "express";
import {
  AdminError,
  createUser,
  deactivateUser,
  getUser,
  getUserAudit,
  listUsers,
  resetPassword,
  setUserProjects,
  setUserRoles,
  updateUser,
} from "../../auth/user-admin-service";
import { PasswordPolicyError } from "../../auth/password";
import { requirePermission } from "../middleware/auth";

export const usersRouter = Router();

// Every route in this module is admin-only.
usersRouter.use(requirePermission("admin.users"));

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
  if (err instanceof PasswordPolicyError) {
    res.status(400).json({
      ok: false,
      error: err.code,
      message: "La contraseña no cumple la política",
      violations: err.violations,
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[users] error inesperado:`, message);
  res.status(500).json({ ok: false, error: "internal_error", message });
}

function parseBooleanQuery(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes"].includes(raw)) return true;
  if (["0", "false", "no"].includes(raw)) return false;
  return undefined;
}

/** GET /api/users?enabled=&role=&q= */
usersRouter.get("/", async (req: Request, res: Response) => {
  try {
    const users = await listUsers({
      enabled: parseBooleanQuery(req.query.enabled),
      roleSlug: req.query.role ? String(req.query.role) : undefined,
      search: req.query.q ? String(req.query.q) : undefined,
    });
    res.json({ ok: true, total: users.length, users });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/users
 *
 * `temporaryPassword` comes back only when the server generated it — the admin
 * must hand it to the user, who is forced to replace it on first login.
 */
usersRouter.post("/", async (req: Request, res: Response) => {
  try {
    const result = await createUser(req.body ?? {}, actorId(req));
    res.status(201).json({
      ok: true,
      user: result.user,
      temporaryPassword: result.temporaryPassword,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/** GET /api/users/:id */
usersRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    res.json({ ok: true, user: await getUser(pathParam(req, "id")) });
  } catch (err) {
    handleError(res, err);
  }
});

/** PATCH /api/users/:id — name, email, username, enabled. */
usersRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const user = await updateUser(pathParam(req, "id"), req.body ?? {}, actorId(req));
    res.json({ ok: true, user });
  } catch (err) {
    handleError(res, err);
  }
});

/** DELETE /api/users/:id — deactivates; rows are never removed. */
usersRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const user = await deactivateUser(pathParam(req, "id"), actorId(req));
    res.json({ ok: true, user, deactivated: true });
  } catch (err) {
    handleError(res, err);
  }
});

/** POST /api/users/:id/reset-password */
usersRouter.post("/:id/reset-password", async (req: Request, res: Response) => {
  try {
    const result = await resetPassword(pathParam(req, "id"), req.body?.password, actorId(req));
    res.json({
      ok: true,
      temporaryPassword: result.temporaryPassword,
      revokedSessions: result.revokedSessions,
      mustChangePassword: true,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/** PUT /api/users/:id/roles — { roles: ["qa-engineer"] } (slugs or ids). */
usersRouter.put("/:id/roles", async (req: Request, res: Response) => {
  try {
    const user = await setUserRoles(pathParam(req, "id"), req.body?.roles, actorId(req));
    res.json({ ok: true, user });
  } catch (err) {
    handleError(res, err);
  }
});

/** PUT /api/users/:id/projects — { allProjects, projects: [...] }. */
usersRouter.put("/:id/projects", async (req: Request, res: Response) => {
  try {
    const user = await setUserProjects(pathParam(req, "id"), req.body ?? {}, actorId(req));
    res.json({ ok: true, user });
  } catch (err) {
    handleError(res, err);
  }
});

/** GET /api/users/:id/audit — who changed what on this account. */
usersRouter.get("/:id/audit", async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    const entries = await getUserAudit(
      pathParam(req, "id"),
      Number.isFinite(limit) ? Math.min(Math.max(1, limit), 500) : 50,
    );
    res.json({ ok: true, total: entries.length, entries });
  } catch (err) {
    handleError(res, err);
  }
});
