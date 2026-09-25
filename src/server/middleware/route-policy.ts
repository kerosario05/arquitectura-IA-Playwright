import type { NextFunction, Request, RequestHandler, Response } from "express";
import { canAccessProject, hasPermission } from "../../auth/principal";
import type { PermissionKey } from "../../auth/permissions";
import { jobStore } from "../jobs/job-store";

/**
 * Declarative authorization policy for the pre-existing API surface.
 *
 * Every route is listed here rather than wrapped individually, so the whole
 * permission map can be read — and audited — in one place, and adding a route
 * without deciding who may call it fails loudly instead of silently allowing.
 *
 * Matching is first-wins and order-sensitive, mirroring how Express resolves
 * these same paths (`/api/projects/shared-connections` before `/api/projects/:slug`).
 */

export type ProjectScopeMode =
  /** The request names a project; a scoped user must have been granted it. */
  | "required"
  /** A project may or may not be named; the handler filters its own output. */
  | "optional"
  /** The project comes from the job addressed by `:jobId`. */
  | "job"
  /** Not a project-scoped route. */
  | "none";

export type RoutePolicy = {
  method: string;
  path: string;
  /** All of these are required. Empty means "any authenticated caller". */
  permissions: PermissionKey[];
  project: ProjectScopeMode;
  /** The router enforces its own policy (auth, users, roles). */
  skip?: boolean;
};

const R = (
  method: string,
  path: string,
  permissions: PermissionKey[],
  project: ProjectScopeMode = "none",
): RoutePolicy => ({ method, path, permissions, project });

const SKIP = (path: string): RoutePolicy => ({
  method: "*",
  path,
  permissions: [],
  project: "none",
  skip: true,
});

export const ROUTE_POLICIES: RoutePolicy[] = [
  // --- self-enforcing routers -------------------------------------------
  SKIP("/health"),
  SKIP("/api/auth/*"),
  SKIP("/api/users/*"),
  SKIP("/api/users"),
  SKIP("/api/roles/*"),
  SKIP("/api/roles"),
  SKIP("/api/permissions"),

  // --- projects ----------------------------------------------------------
  R("GET", "/api/projects", ["projects.view"], "optional"),
  R("POST", "/api/projects/inspect-apk", ["projects.create"]),
  R("GET", "/api/projects/shared-connections", ["projects.view"]),
  R("POST", "/api/projects/shared-connections", ["projects.edit"]),
  R("PUT", "/api/projects/shared-connections/:id", ["projects.edit"]),
  R("POST", "/api/projects/web", ["projects.create"]),
  R("POST", "/api/projects/mobile", ["projects.create"]),
  R("GET", "/api/projects/:slug", ["projects.view"], "required"),
  R("PUT", "/api/projects/:slug", ["projects.edit"], "required"),
  R("POST", "/api/projects/:slug/refresh-status", ["projects.edit"], "required"),
  R("PUT", "/api/projects/:slug/jira", ["projects.edit"], "required"),
  R("PUT", "/api/projects/:slug/testrail", ["projects.edit"], "required"),
  R("POST", "/api/projects/:slug/materialize", ["projects.materialize"], "required"),
  R("DELETE", "/api/projects/:slug", ["projects.delete"], "required"),

  // --- runs --------------------------------------------------------------
  R("POST", "/api/runs/scenario-preview", ["tests.launch"], "required"),
  R("POST", "/api/runs/discovery-batch", ["tests.launch"], "required"),
  R("POST", "/api/runs/sprint", ["tests.launch"], "optional"),
  R("POST", "/api/runs/launch-execution", ["tests.launch"], "required"),
  R("GET", "/api/runs", ["executions.view"], "optional"),
  R("GET", "/api/runs/:jobId/logs", ["executions.view"], "job"),
  R("GET", "/api/runs/:jobId/evidence-docx/status", ["executions.export"], "job"),
  R("GET", "/api/runs/:jobId/evidence-docx", ["executions.export"], "job"),
  R("GET", "/api/runs/:jobId", ["executions.view"], "job"),
  R("POST", "/api/runs/:jobId/rerun", ["tests.rerun"], "job"),
  R("POST", "/api/runs/:jobId/sync-results", ["tests.launch"], "job"),
  R("POST", "/api/runs/:jobId/link-jira", ["tests.launch"], "job"),
  R("POST", "/api/runs/:jobId/link-jira-run-ref", ["tests.launch"], "job"),
  R("DELETE", "/api/runs/:jobId", ["tests.launch"], "job"),

  // --- recordings --------------------------------------------------------
  // Static capability probe: no project involved, any viewer may ask.
  R("GET", "/api/recordings/capabilities", ["recordings.view"]),
  R("GET", "/api/recordings", ["recordings.view"], "required"),
  R("POST", "/api/recordings/start", ["recordings.create"], "required"),
  R("GET", "/api/recordings/:recordingId/scenarios", ["recordings.view"], "required"),
  R("PUT", "/api/recordings/:recordingId/scenarios", ["recordings.derive"], "required"),
  R("GET", "/api/recordings/:recordingId/trace", ["recordings.view"], "required"),
  R("POST", "/api/recordings/:recordingId/stop", ["recordings.create"], "required"),
  R("POST", "/api/recordings/:recordingId/control", ["recordings.create"], "required"),
  R("POST", "/api/recordings/:recordingId/derive", ["recordings.derive"], "required"),
  R("POST", "/api/recordings/:recordingId/execute", ["tests.launch"], "required"),
  R("POST", "/api/recordings/:recordingId/testrail", ["recordings.promote"], "required"),
  R("DELETE", "/api/recordings/:recordingId", ["recordings.create"], "required"),
  R("GET", "/api/recordings/:recordingId", ["recordings.view"], "required"),

  // --- executions --------------------------------------------------------
  R("GET", "/api/executions", ["executions.view"], "optional"),
  R("GET", "/api/executions/:launchId", ["executions.view"]),

  // --- scenarios (drive runs) --------------------------------------------
  R("*", "/api/scenarios/*", ["tests.launch"], "optional"),
  R("*", "/api/scenarios", ["tests.launch"], "optional"),

  // --- mobile ------------------------------------------------------------
  R("GET", "/api/mobile/emulator/status", ["executions.view"]),
  R("GET", "/api/mobile/appium/status", ["executions.view"]),
  R("POST", "/api/mobile/emulator/start", ["tests.launch"]),
  R("POST", "/api/mobile/emulator/stop", ["tests.launch"]),
  R("GET", "/api/mobile/scenarios/generation/:generationJobId", ["executions.view"]),
  R("*", "/api/mobile/*", ["tests.launch"], "optional"),

  // --- external catalogues (read-only reference data) ---------------------
  R("GET", "/api/jira/*", ["dashboard.view"]),
  R("POST", "/api/jira/*", ["tests.launch"]),
  R("GET", "/api/testrail/*", ["dashboard.view"]),
  R("POST", "/api/testrail/*", ["tests.launch"]),

  // --- checklists / defects ----------------------------------------------
  R("GET", "/api/checklists/:issueKey", ["executions.view"]),
  R("POST", "/api/checklists/:issueKey/defects", ["tests.launch"]),
  R("PATCH", "/api/checklists/:issueKey/defects/:defectId", ["tests.launch"]),
  R("POST", "/api/user-stories/:issueKey/checklist-url", ["tests.launch"]),

  // --- internal, used by the runner with the API key ----------------------
  R("*", "/api/internal/otp/*", ["tests.launch"]),

  // --- dev-only debugging -------------------------------------------------
  R("*", "/api/debug/*", ["admin.users"]),
];

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Compiles a pattern into a regex plus the names of its `:params`.
 *
 * The parameter names matter: this middleware runs at the app level, where
 * `req.params` is always empty — route parameters only exist inside the router
 * that declared them — so the policy has to pull `:slug` and `:jobId` out of the
 * path itself.
 */
function compile(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = pattern
    .split("/")
    .map((segment) => {
      if (segment === "*") return "[^/]+(?:/[^/]+)*";
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${source}/?$`), keys };
}

const COMPILED = ROUTE_POLICIES.map((policy) => ({ policy, ...compile(policy.path) }));

export type RouteMatch = { policy: RoutePolicy; params: Record<string, string> };

export function matchRoutePolicy(method: string, path: string): RouteMatch | null {
  const upper = method.toUpperCase();
  for (const { policy, regex, keys } of COMPILED) {
    if (policy.method !== "*" && policy.method !== upper) continue;
    const matched = regex.exec(path);
    if (!matched) continue;
    const params: Record<string, string> = {};
    keys.forEach((key, index) => {
      const value = matched[index + 1];
      if (value) params[key] = decodeURIComponent(value);
    });
    return { policy, params };
  }
  return null;
}

export function findRoutePolicy(method: string, path: string): RoutePolicy | null {
  return matchRoutePolicy(method, path)?.policy ?? null;
}

// ---------------------------------------------------------------------------
// Project reference extraction
// ---------------------------------------------------------------------------

const PROJECT_FIELDS = ["appSlug", "projectSlug", "targetAppSlug", "slug"];

/**
 * Finds the project a request is about. Routes disagree on the field name
 * (`appSlug` in run payloads, `projectSlug` in recordings, `:slug` in the
 * project routes), so all the spellings in use are checked.
 */
export function extractProjectReference(
  req: Request,
  routeParams?: Record<string, string>,
): string | null {
  const sources: unknown[] = [];
  if (routeParams?.slug) sources.push(routeParams.slug);
  const params = req.params as Record<string, unknown> | undefined;
  if (params?.slug) sources.push(params.slug);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  for (const field of PROJECT_FIELDS) {
    if (body[field]) sources.push(body[field]);
    if (query[field]) sources.push(query[field]);
  }

  for (const source of sources) {
    const value = Array.isArray(source) ? source[0] : source;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** The project a job belongs to, taken from the params it was created with. */
export function projectReferenceForJob(jobId: string): string | null {
  const job = jobStore.get(jobId);
  if (!job) return null;
  const params = (job.params ?? {}) as Record<string, unknown>;
  for (const field of PROJECT_FIELDS) {
    const value = params[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function deny(res: Response, status: number, error: string, message: string, extra?: object): void {
  res.status(status).json({ ok: false, error, message, ...(extra ?? {}) });
}

const warnedUnmappedRoutes = new Set<string>();

/**
 * Applies the table above. Anything under /api that is not listed is refused:
 * a new route must state who may call it, rather than inheriting whatever the
 * gate happened to allow.
 */
export function enforceRoutePolicy(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const principal = req.principal;
    if (!principal) {
      // The gate ahead of this middleware already rejects anonymous callers;
      // reaching here means the route is public.
      next();
      return;
    }

    const match = matchRoutePolicy(req.method, req.path);
    const policy = match?.policy;

    if (!policy) {
      if (!req.path.startsWith("/api/")) {
        next();
        return;
      }
      const key = `${req.method} ${req.path}`;
      if (!warnedUnmappedRoutes.has(key)) {
        warnedUnmappedRoutes.add(key);
        console.warn(
          `[route-policy] ruta sin política declarada: ${key} — añádela en src/server/middleware/route-policy.ts`,
        );
      }
      deny(
        res,
        403,
        "route_not_authorized",
        "Esta ruta no tiene una política de permisos declarada",
      );
      return;
    }

    if (policy.skip) {
      next();
      return;
    }

    const missing = policy.permissions.filter((permission) => !hasPermission(principal, permission));
    if (missing.length > 0) {
      deny(res, 403, "forbidden", "No tienes permiso para esta acción", {
        requiredPermissions: policy.permissions,
        missingPermissions: missing,
      });
      return;
    }

    if (policy.project === "none" || principal.allProjects) {
      next();
      return;
    }

    const reference =
      policy.project === "job"
        ? projectReferenceForJob(match!.params.jobId ?? "")
        : extractProjectReference(req, match!.params);

    if (!reference) {
      // "optional" means the handler narrows its own output (list endpoints).
      // A job whose project cannot be determined is left to the handler, which
      // answers 404 for an unknown id.
      if (policy.project === "optional" || policy.project === "job") {
        next();
        return;
      }
      deny(
        res,
        403,
        "project_scope_required",
        "Tu usuario solo tiene acceso a proyectos específicos; indica el proyecto en la petición",
      );
      return;
    }

    if (!canAccessProject(principal, reference)) {
      deny(res, 403, "project_forbidden", `No tienes acceso al proyecto: ${reference}`, {
        project: reference,
      });
      return;
    }

    next();
  };
}


// ---------------------------------------------------------------------------
// Response narrowing
// ---------------------------------------------------------------------------

/**
 * Keeps only the entries a scoped user may see. List endpoints call this so a
 * user never learns that projects they were not granted even exist.
 */
export function filterByProjectAccess<T>(
  principal: Request["principal"],
  items: T[],
  reference: (item: T) => string | null | undefined,
): T[] {
  if (!principal || principal.allProjects) return items;
  return items.filter((item) => canAccessProject(principal, reference(item) ?? null));
}
