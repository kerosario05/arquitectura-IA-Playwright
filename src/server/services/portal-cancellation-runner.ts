import { invalidatePortalSession, PortalLoginRejectedError, withPortalSession, type PortalHttp } from "./data-cedulas-reuse";
import {
  createPortalRequestCancellationService,
  getPortalCancellationEnvironment,
  PortalCancellationError,
} from "./portal-comercial-request-cancellation";
import { resolvePortalLogin } from "./portal-login-resolver";

type CancellationService = ReturnType<typeof createPortalRequestCancellationService>;

/** Lets the cancellation service (written against `fetch`) talk through an already signed-in Portal session. */
export function fetchFromPortalHttp(http: PortalHttp): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    const method = String(init.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST" && method !== "PUT") {
      throw new PortalCancellationError("session_method_rejected", 403, "Método no permitido para la sesión del Portal.");
    }
    let body: unknown;
    if (typeof init.body === "string" && init.body) {
      try { body = JSON.parse(init.body); } catch { body = undefined; }
    }
    const result = await http(method, url.pathname + url.search, body !== undefined ? { body } : undefined);
    const empty = result.status === 204 || result.status === 304;
    return new Response(empty ? null : JSON.stringify(result.body ?? null), { status: result.status, headers: { "content-type": "application/json" } });
  };
}

/**
 * Runs `run` with a cancellation service that is authenticated one of two ways, in this order:
 *   1. PORTAL_COMERCIAL_QA_API_* (a fixed token/cookie), when configured;
 *   2. a Portal session opened with the project's own saved login (see portal-login-resolver), so no
 *      token has to be pasted into the environment.
 */
export async function withCancellationService<T>(
  projectSlug: string,
  enabled: boolean,
  run: (service: CancellationService) => Promise<T>,
): Promise<T> {
  const environment = getPortalCancellationEnvironment();
  if (environment.configured) return run(createPortalRequestCancellationService({ ...environment, enabled }));
  if (!enabled) return run(createPortalRequestCancellationService({ ...environment, enabled }));
  const resolved = await resolvePortalLogin(projectSlug);
  if (!resolved) {
    throw new PortalCancellationError("credentials_required", 401, "Faltan las credenciales del Portal: guárdalas en el Catálogo de servicios para continuar.");
  }
  let origin: string;
  try { origin = new URL(resolved.login.baseUrl).origin; }
  catch { throw new PortalCancellationError("cancellation_not_configured", 503, "La URL del Portal del proyecto no es válida."); }
  try {
    return await withPortalSession(resolved.login, (http) => run(createPortalRequestCancellationService(
      { enabled, baseUrl: origin, allowedHosts: environment.allowedHosts, authenticatedSession: true },
      fetchFromPortalHttp(http),
    )));
  } catch (error) {
    if (error instanceof PortalCancellationError) throw error;
    if (error instanceof PortalLoginRejectedError) {
      invalidatePortalSession(resolved.login);
      throw new PortalCancellationError("credentials_rejected", 401, "El Portal rechazó las credenciales guardadas: vuelve a escribirlas en el Catálogo de servicios.");
    }
    if (error instanceof Error && error.message === "host_not_allowed") {
      throw new PortalCancellationError("cancellation_host_rejected", 503, "La URL del Portal no pertenece a un host QA permitido.");
    }
    throw new PortalCancellationError("portal_session_failed", 502, "No se pudo abrir sesión en el Portal con las credenciales guardadas.");
  }
}
