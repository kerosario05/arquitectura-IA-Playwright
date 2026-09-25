import { Router, type Request, type Response } from "express";
import {
  AuthError,
  changePassword,
  describeIdentity,
  login,
  logout,
} from "../../auth/auth-service";
import { PasswordPolicyError } from "../../auth/password";
import { PERMISSION_MODULES } from "../../auth/permissions";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

function clientContext(req: Request): { userAgent: string | null; ipAddress: string | null } {
  const userAgent = req.headers["user-agent"];
  return {
    userAgent: typeof userAgent === "string" ? userAgent : null,
    ipAddress: req.ip ?? null,
  };
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
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
  console.error(`[auth] error inesperado:`, message);
  res.status(500).json({ ok: false, error: "internal_error", message });
}

/**
 * POST /api/auth/login
 *
 * A pending password change still returns 200 with a token — but that token is
 * scoped to `password_change_only`, so the client must send the user through the
 * change screen before anything else works.
 */
authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body ?? {};
    const result = await login({ username, password, ...clientContext(req) });
    res.json({
      ok: true,
      token: result.token,
      expiresAt: result.expiresAt,
      scope: result.scope,
      mustChangePassword: result.mustChangePassword,
      user: result.user,
      roles: result.roles,
      permissions: result.permissions,
      projects: result.projects,
      allProjects: result.user.allProjects,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/** POST /api/auth/logout — revokes the current session; always succeeds. */
authRouter.post("/logout", requireAuth(), async (req: Request, res: Response) => {
  try {
    if (req.bearerToken) await logout(req.bearerToken);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

/** GET /api/auth/me — identity, effective permissions and project scope. */
authRouter.get("/me", requireAuth(), async (req: Request, res: Response) => {
  try {
    const snapshot = await describeIdentity(req.principal!, req.authSession ?? null);
    res.json({ ok: true, ...snapshot });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/auth/change-password
 *
 * Returns a brand new full-scope token: every previous session, including the
 * restricted one this request was made with, is revoked.
 */
authRouter.post("/change-password", requireAuth(), async (req: Request, res: Response) => {
  try {
    const principal = req.principal!;
    if (principal.kind !== "user" || !principal.userId) {
      res.status(400).json({
        ok: false,
        error: "not_a_user_session",
        message: "Solo un usuario autenticado puede cambiar su contraseña",
      });
      return;
    }

    const { currentPassword, newPassword } = req.body ?? {};
    const result = await changePassword({
      userId: principal.userId,
      currentPassword,
      newPassword,
      ...clientContext(req),
    });
    res.json({
      ok: true,
      token: result.token,
      expiresAt: result.expiresAt,
      scope: "full",
      mustChangePassword: false,
      revokedSessions: result.revokedSessions,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/auth/permissions — the catalogue, for rendering the role editor.
 * Static data, so any authenticated caller may read it.
 */
authRouter.get("/permissions", requireAuth(), (_req: Request, res: Response) => {
  res.json({ ok: true, modules: PERMISSION_MODULES });
});
