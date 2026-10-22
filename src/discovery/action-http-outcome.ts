export type ActionHttpObservation = {
  sameOrigin?: boolean;
  method: string;
  path: string;
  resourceType: string;
  state: "completed" | "pending" | "failed";
  status?: number;
};

export type AuthenticationClientErrorObservation = Pick<
  ActionHttpObservation,
  "sameOrigin" | "method" | "resourceType" | "state" | "status"
>;

/**
 * A same-origin client error can close an authentication observation window only when the
 * browser is still on the auth surface and the scenario has no later executable action.
 * This is a completion signal for capturing the rejection UI, never a pass oracle: the
 * scenario's declared visible feedback assertions must still be observed and validated.
 */
export function isTerminalAuthenticationClientError(input: {
  beforeAuthDetected: boolean;
  afterAuthDetected: boolean;
  hasLaterExecutableActions: boolean;
  events: readonly AuthenticationClientErrorObservation[];
}): boolean {
  if (!input.beforeAuthDetected || !input.afterAuthDetected || input.hasLaterExecutableActions) return false;
  return input.events.some((event) => event.sameOrigin === true
    && ["xhr", "fetch", "document"].includes(event.resourceType)
    && !["GET", "HEAD", "OPTIONS"].includes(event.method.toUpperCase())
    && event.state === "completed"
    && event.status !== undefined && event.status >= 400 && event.status < 500);
}

/** Safe paths cannot prove retry identity: another 200 never erases an observed 5xx. */
export function findActionServerError<T extends ActionHttpObservation>(events: readonly T[]): T | undefined {
  return events.find(event => event.sameOrigin === true
    && ["xhr", "fetch", "document"].includes(event.resourceType) && event.state !== "pending"
    && event.status !== undefined && event.status >= 500 && event.status < 600);
}
