import {
  createPortalRequestCancellationService,
  createPortalSessionFetcher,
  normalizePortalIdentity,
  PortalCancellationError,
  resolveCreatedPortalRequestId,
  type SessionApiRequestContext,
} from "../server/services/portal-comercial-request-cancellation";

export type PortalRequestCleanupResult =
  | { status: "skipped"; reason: "project_disabled" | "discovery_not_passed" }
  | { status: "cancelled" }
  | { status: "blocked"; reason: string };

export type PortalPreDiscoveryCleanupResult =
  | { status: "cancelled" }
  | { status: "blocked"; reason: string }
  | { status: "skipped"; reason: "project_disabled" };

export function extractPortalActiveCaseRequestCode(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const value = snapshot as { url?: unknown; elements?: unknown };
  if (typeof value.url !== "string" || !Array.isArray(value.elements)) return undefined;
  let pathName = "";
  try { pathName = new URL(value.url).pathname; } catch { return undefined; }
  if (!/^\/requests\/create\/multiproduct\/?$/i.test(pathName)) return undefined;

  const text = (value.elements as Array<Record<string, unknown>>)
    .flatMap((element) => [element.text, element.label, element.name, element.ariaLabel, element.title])
    .filter((entry): entry is string => typeof entry === "string")
    .join(" ")
    .replace(/\s+/g, " ");
  if (!/casos activos\.?/i.test(text) || !/otros casos activos\s*\([1-9]\d*\)/i.test(text)) return undefined;

  const codes = [...new Set(Array.from(
    text.matchAll(/otros casos activos\s*\([1-9]\d*\)\s*:?\s*([A-Z0-9][A-Z0-9-]{2,})/gi),
    (match) => match[1].trim(),
  ))];
  return codes.length === 1 ? codes[0] : undefined;
}

export function shouldVerifyPortalSpecAfterCleanup(appSlug: string, enabled: boolean, autoPromote: boolean): boolean {
  return appSlug === "portal-comercial" && enabled && autoPromote;
}

export function isPortalActiveCaseBlockerEvidence(snapshot: unknown, requestCode?: string): boolean {
  if (!snapshot || typeof snapshot !== "object" || !requestCode?.trim()) return false;
  const value = snapshot as { url?: unknown; elements?: unknown };
  if (typeof value.url !== "string" || !Array.isArray(value.elements)) return false;
  let pathName = "";
  try { pathName = new URL(value.url).pathname; } catch { return false; }
  if (!/^\/requests\/create\/multiproduct\/?$/i.test(pathName)) return false;

  const text = (value.elements as Array<Record<string, unknown>>)
    .flatMap((element) => [element.text, element.label, element.name, element.ariaLabel, element.title])
    .filter((entry): entry is string => typeof entry === "string")
    .join(" ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
  return /casos activos\.?/i.test(text)
    && /otros casos activos\s*\([1-9]\d*\)/i.test(text)
    && text.includes(requestCode.trim().toLocaleLowerCase());
}

export function resolvePortalRequestIdentity(input: {
  steps: Array<{ action: string; valueKey?: string }>;
  recordedActions?: Array<{
    humanStep?: string;
    semanticField?: string;
    valueKey?: string;
    value?: unknown;
  }>;
  runtimeEntries: Array<{ key: string; value: string }>;
  testData: Record<string, unknown>;
  fallback?: string;
  hasRuntimeContext: boolean;
}): string | undefined {
  const recordedIdentityActions = (input.recordedActions ?? []).filter((action) => {
    const humanStep = String(action.humanStep ?? "");
    const semanticField = String(action.semanticField ?? "");
    return /^\s*ingresar\b/i.test(humanStep)
      && /(?:n[uú]mero\s+de\s+identificaci[oó]n|c[eé]dula|rnc)/i.test(`${humanStep} ${semanticField}`)
      && typeof action.valueKey === "string" && action.valueKey.trim();
  });
  const identityStepKeys = [...new Set([
    ...input.steps
      .filter((step) => /^\s*ingresar\b/i.test(step.action)
        && /(?:n[uú]mero\s+de\s+identificaci[oó]n|c[eé]dula|rnc)/i.test(step.action)
        && typeof step.valueKey === "string" && step.valueKey.trim())
      .map((step) => step.valueKey!.trim().toLowerCase()),
    ...recordedIdentityActions.map((action) => action.valueKey!.trim().toLowerCase()),
  ])];
  const candidates = new Map<string, string>();
  for (const key of identityStepKeys) {
    const runtimeValues = input.runtimeEntries
      .filter((entry) => entry.key.trim().toLowerCase() === key)
      .map((entry) => entry.value)
      .filter((value) => typeof value === "string" && value.trim());
    const configured = Object.entries(input.testData).find(([candidateKey]) => candidateKey.trim().toLowerCase() === key)?.[1];
    const recordedValues = recordedIdentityActions
      .filter((action) => action.valueKey!.trim().toLowerCase() === key)
      .map((action) => action.value)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const values = runtimeValues.length > 0
      ? runtimeValues
      : typeof configured === "string" && configured.trim() ? [configured] : recordedValues;
    for (const value of values) candidates.set(normalizePortalIdentity(value), value.trim());
  }
  if (candidates.size === 1) return [...candidates.values()][0];
  if (candidates.size > 1) return undefined;

  if (input.hasRuntimeContext) return undefined;
  return input.fallback?.trim() || undefined;
}

/**
 * One-time cleanup for a Portal active-case blocker when project cancellation is enabled.
 * A live snapshot must identify one visible request code, and the case-bound identity
 * must resolve that exact code to one eligible QA candidate before cancellation.
 */
export async function cancelActivePortalRequestBeforeDiscovery(input: {
  appSlug: string;
  enabled: boolean;
  activeCaseModalVerified: boolean;
  /** Discovery stopped at the creation route (Depurar did not reach the edit route). */
  blockedAtCreationRoute?: boolean;
  requestCode?: string;
  baseUrl: string;
  identity?: string;
  requestContext?: SessionApiRequestContext;
}): Promise<PortalPreDiscoveryCleanupResult> {
  if (input.appSlug !== "portal-comercial" || !input.enabled) {
    return { status: "skipped", reason: "project_disabled" };
  }
  // Blocker evidence is the visible active-case modal, or -- when the Portal shows none (its check
  // can answer with an error instead) -- the Portal's own case check listing the blocking codes.
  if (!input.activeCaseModalVerified && input.blockedAtCreationRoute !== true) {
    return { status: "blocked", reason: "active_case_modal_not_verified" };
  }
  if (!input.identity?.trim()) return { status: "blocked", reason: "identity_missing" };
  if (input.activeCaseModalVerified && !input.requestCode?.trim()) return { status: "blocked", reason: "request_code_missing" };
  if (!input.requestContext) return { status: "blocked", reason: "authenticated_session_missing" };

  try {
    const service = createPortalRequestCancellationService({
      enabled: true,
      baseUrl: input.baseUrl,
      authenticatedSession: true,
      // The Portal list endpoint can take 15-20 s per page: small pages and a per-request limit above that.
      pageSize: 250,
      timeoutMs: 60_000,
    }, createPortalSessionFetcher(input.requestContext, input.baseUrl, 60_000));
    const reportedCodes = input.activeCaseModalVerified
      ? [input.requestCode!.trim()]
      : await service.listBizagiCaseCodes(input.identity);
    if (reportedCodes.length === 0) return { status: "blocked", reason: "case_check_reports_no_blocker" };
    const preview = await service.preview(input.identity);
    const matches = preview.candidates.filter((candidate) => candidate.requestCode !== undefined && reportedCodes.includes(candidate.requestCode));
    if (matches.length !== reportedCodes.length) return { status: "blocked", reason: "request_code_not_unique_or_eligible" };

    const result = await service.cancelAll(input.identity, true, matches[0].id);
    if (result.failed) return { status: "blocked", reason: result.failed.reason };
    if (!result.cancelledIds.includes(matches[0].id)) {
      return { status: "blocked", reason: "cancellation_not_confirmed" };
    }
    // The Portal's duplicate-case check keeps reporting a just-cancelled process for a while; wait
    // (bounded) until it is clear so the next run does not start inside that window.
    await service.awaitNoActiveBizagiCases(input.identity, { timeoutMs: 300_000, pollMs: 5_000 });
    return { status: "cancelled" };
  } catch (error) {
    return {
      status: "blocked",
      reason: error instanceof PortalCancellationError ? error.code : "cancellation_failed",
    };
  }
}

export async function cancelDiscoveredPortalRequestBeforeReplay(input: {
  appSlug: string;
  enabled: boolean;
  discoveryPassed: boolean;
  baseUrl: string;
  beforeUrl: string;
  afterUrl: string;
  identity?: string;
  requestContext?: SessionApiRequestContext;
}): Promise<PortalRequestCleanupResult> {
  if (input.appSlug !== "portal-comercial" || !input.enabled) {
    return { status: "skipped", reason: "project_disabled" };
  }
  if (!input.discoveryPassed) {
    return { status: "skipped", reason: "discovery_not_passed" };
  }
  if (!input.identity?.trim()) return { status: "blocked", reason: "identity_missing" };
  if (!input.requestContext) return { status: "blocked", reason: "authenticated_session_missing" };

  const requestId = resolveCreatedPortalRequestId(input.baseUrl, input.beforeUrl, input.afterUrl);
  if (!requestId) return { status: "blocked", reason: "created_request_route_unresolved" };

  try {
    const service = createPortalRequestCancellationService({
      enabled: true,
      baseUrl: input.baseUrl,
      authenticatedSession: true,
      // The Portal list endpoint can take 15-20 s per page: small pages and a per-request limit above that.
      pageSize: 250,
      timeoutMs: 60_000,
    }, createPortalSessionFetcher(input.requestContext, input.baseUrl, 60_000));
    const result = await service.cancelAll(input.identity, true, requestId);
    if (result.failed) return { status: "blocked", reason: result.failed.reason };
    if (!result.cancelledIds.includes(requestId)) return { status: "blocked", reason: "cancellation_not_confirmed" };
    // The Portal's duplicate-case check must also be clear before a replay can start.
    await service.awaitNoActiveBizagiCases(input.identity);
    return { status: "cancelled" };
  } catch (error) {
    return {
      status: "blocked",
      reason: error instanceof PortalCancellationError ? error.code : "cancellation_failed",
    };
  }
}
