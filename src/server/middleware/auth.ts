import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  AuthError,
  createServicePrincipal,
  extractBearerToken,
  resolveSessionToken,
} from "../../auth/auth-service";
import { resolveAuthConfig } from "../../auth/config";
import { hasPermission, type Principal } from "../../auth/principal";
import type { PermissionKey } from "../../auth/permissions";
import type { Session } from "../../db/session-repository";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
      authSession?: Session;
      bearerToken?: string;
    }
  }
}

/** Routes reachable without a session, whatever the configuration. */
const PUBLIC_PATHS = new Set(["/health", "/api/auth/login"]);

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}

/** Paths a `password_change_only` session may still reach. */
const PASSWORD_CHANGE_ALLOWED = new Set([
  "/api/auth/me",
  "/api/auth/change-password",
  "/api/auth/logout",
]);

function sendAuthError(res: Response, err: AuthError): void {
  res.status(err.status).json({
    ok: false,
    error: err.code,
    message: err.message,
    ...(err.details ?? {}),
  });
}

/**
 * Resolves the caller into `req.principal` without rejecting anything.
 *
 * Three sources, in order: a valid `X-Api-Key` (machine callers keep their
 * existing access), a bearer session token, or — when `AUTH_ENABLED=false` — an
 * implicit service principal so the API behaves exactly as it did before this
 * module existed.
 */
export function attachPrincipal(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const config = resolveAuthConfig();
    const apiKey = process.env.API_KEY || "";

    if (apiKey && req.headers["x-api-key"] === apiKey) {
      req.principal = createServicePrincipal("api-key");
      next();
      return;
    }

    const token = extractBearerToken(req.headers.authorization);
    if (token) {
      try {
        const resolved = await resolveSessionToken(token);
        req.principal = resolved.principal;
        req.authSession = resolved.session;
        req.bearerToken = token;
        next();
        return;
      } catch (err) {
        if (err instanceof AuthError) {
          sendAuthError(res, err);
          return;
        }
        next(err);
        return;
      }
    }

    // No credential presented. Only grant the implicit principal when nothing is
    // configured to guard the API — a configured API_KEY must still be required,
    // exactly as it was before this middleware existed.
    if (!config.enabled && !apiKey) {
      req.principal = createServicePrincipal("auth-disabled");
    }
    next();
  };
}

/** 401 unless a principal was resolved. */
export function requireAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.principal) {
      sendAuthError(
        res,
        new AuthError("missing_token", "Se requiere iniciar sesión", 401),
      );
      return;
    }
    next();
  };
}

/**
 * Blocks a restricted first-login session from reaching anything but the
 * password-change endpoints.
 *
 * This is what makes the forced change unskippable: the token handed out at
 * login carries `password_change_only`, so simply never calling
 * `/api/auth/change-password` leaves the caller with a token that opens nothing.
 */
export function requireFullScope(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const principal = req.principal;
    if (!principal || principal.scope === "full") {
      next();
      return;
    }
    if (PASSWORD_CHANGE_ALLOWED.has(req.path)) {
      next();
      return;
    }
    sendAuthError(
      res,
      new AuthError(
        "password_change_required",
        "Debes cambiar tu contraseña antes de continuar",
        403,
      ),
    );
  };
}

/** 403 unless the principal holds every listed permission. */
export function requirePermission(...permissions: PermissionKey[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const principal = req.principal;
    if (!principal) {
      sendAuthError(res, new AuthError("missing_token", "Se requiere iniciar sesión", 401));
      return;
    }
    const missing = permissions.filter((permission) => !hasPermission(principal, permission));
    if (missing.length > 0) {
      res.status(403).json({
        ok: false,
        error: "forbidden",
        message: `No tienes permiso para esta acción`,
        requiredPermissions: permissions,
        missingPermissions: missing,
      });
      return;
    }
    next();
  };
}
