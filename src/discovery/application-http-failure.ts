import type { SafeNetworkEvent } from "./case-discovery";

/**
 * An action whose own business request was rejected by the application (HTTP 4xx/5xx) and whose
 * flow did not move on is a failure of the application under test, not of the automation.
 *
 * FIRST_LOSS (recording cd227d7b, kiosko "Generar Turno"): every step was executed correctly, the
 * submit's `POST /api/turns/generate` answered 400, the page stayed where it was -- and the run was
 * reported as passed because the only check was a same-URL navigation oracle.
 */
export type ApplicationHttpFailure = {
  method: string;
  path: string;
  status: number;
};

export const APPLICATION_HTTP_FAILURE_REASON = "application_http_error";

/** 401/403 belong to the authentication/session boundary, which is classified separately. */
const AUTH_BOUNDARY_STATUSES = new Set([401, 403]);

export function detectApplicationHttpFailure(input: {
  events: readonly SafeNetworkEvent[];
  /** The action produced a route change. */
  routeChanged: boolean;
  /** The next recorded target became visible, i.e. the flow advanced despite the response. */
  nextTargetVisible: boolean;
}): ApplicationHttpFailure | undefined {
  // A rejected side request on a flow that still advanced (telemetry, an optional widget) is not
  // the action's outcome.
  if (input.routeChanged || input.nextTargetVisible) return undefined;
  const rejected = input.events.filter((event) =>
    (event.resourceType === "fetch" || event.resourceType === "xhr")
    && typeof event.status === "number"
    && event.status >= 400
    && !AUTH_BOUNDARY_STATUSES.has(event.status)
  );
  const last = rejected.at(-1);
  return last ? { method: last.method, path: last.path, status: last.status! } : undefined;
}

export function describeApplicationHttpFailure(failure: ApplicationHttpFailure): string {
  return `Falla del aplicativo: ${failure.method} ${failure.path} respondió HTTP ${failure.status}`;
}
