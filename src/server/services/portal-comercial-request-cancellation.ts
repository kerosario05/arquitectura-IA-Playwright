export type PortalRequestRecord = {
  id: string | number;
  type?: string;
  status?: string;
  subStatus?: string;
  dataByType?: {
    model?: {
      status?: string;
      statusTimeline?: Array<Record<string, unknown>>;
      customer?: { personalInfo?: { identification?: string } };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type PortalCancellationConfig = {
  enabled: boolean;
  baseUrl?: string;
  allowedHosts?: string[];
  authorization?: string;
  cookie?: string;
  authenticatedSession?: boolean;
  requestType?: string;
  /** Optional legacy business-process cancellation; disabled for the real CustomData contract. */
  cancelProcess?: boolean;
  pageSize?: number;
  timeoutMs?: number;
};

export type SessionApiResponse = {
  status(): number;
  headers(): Record<string, string>;
  body(): Promise<Buffer>;
};

export type SessionApiRequestContext = {
  fetch(url: string, options: Record<string, unknown>): Promise<SessionApiResponse>;
};

export type CancellationCandidate = {
  id: string;
  status: string;
  subStatus: string;
  modelStatus: string;
  requestCode?: string;
};

export class PortalCancellationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PortalCancellationError";
  }
}

/**
 * Resolve the newly-created Portal request from the actual Discovery route transition.
 * Requiring same origin, a changed URL and the app's request edit route prevents cancelling
 * an arbitrary request selected from the user's existing list.
 */
export function resolveCreatedPortalRequestId(
  baseUrlInput: string,
  beforeUrlInput: string,
  afterUrlInput: string,
): string | undefined {
  try {
    const base = new URL(baseUrlInput);
    const before = new URL(beforeUrlInput);
    const after = new URL(afterUrlInput);
    if (base.origin !== before.origin || base.origin !== after.origin || before.href === after.href) return undefined;
    const afterMatch = after.pathname.match(/^\/requests\/([^/]+)\/edit\/?$/i);
    if (!afterMatch) return undefined;
    const beforeMatch = before.pathname.match(/^\/requests\/([^/]+)\/edit\/?$/i);
    const id = decodeURIComponent(afterMatch[1]);
    if (beforeMatch && decodeURIComponent(beforeMatch[1]) === id) return undefined;
    return /^[A-Za-z0-9._-]{1,128}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Adapt Playwright's context-bound API client to fetch. The caller must pass
 * browserContext.request so the authenticated browser cookie jar is reused. Restrict every
 * request to the app origin to avoid forwarding that session to another host.
 */
export function createPortalSessionFetcher(
  requestContext: SessionApiRequestContext,
  baseUrlInput: string,
  timeoutMs = 20_000,
): typeof fetch {
  const expectedOrigin = new URL(baseUrlInput).origin;
  return async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.origin !== expectedOrigin) {
      throw new PortalCancellationError("session_origin_rejected", 403, "La solicitud de cancelación debe usar la sesión del Portal configurado.");
    }
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const response = await requestContext.fetch(url.toString(), {
      method: init.method ?? "GET",
      headers,
      ...(typeof init.body === "string" ? { data: init.body } : {}),
      maxRedirects: 0,
      timeout: timeoutMs,
    });
    const status = response.status();
    const body = status === 204 || status === 304 ? null : (await response.body()).toString("utf8");
    return new Response(body, { status, headers: response.headers() });
  };
}

const DEFAULT_REQUEST_TYPE = "MultiProdNatural";
const ACTIVE_STATUSES = new Set(["draft", "inprogress"]);
const APPROVED_TRANSITIONS: Record<string, { to: string; reason: string }> = {
  compliance: { to: "cancelled", reason: "CANCEL" },
  simulation: { to: "cancelled", reason: "CANCEL" },
};
const DEFAULT_ALLOWED_HOSTS = ["srvqacgowb01.local.bsc.com"];
const MAX_PAGES = 200;
const MAX_REQUEST_IDS = 20;

export function getPortalCancellationEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = env.PORTAL_COMERCIAL_QA_API_BASE_URL?.trim();
  const authorization = env.PORTAL_COMERCIAL_QA_API_AUTHORIZATION?.trim();
  const cookie = env.PORTAL_COMERCIAL_QA_API_COOKIE?.trim();
  const allowedHosts = (env.PORTAL_COMERCIAL_QA_API_ALLOWED_HOSTS || DEFAULT_ALLOWED_HOSTS.join(","))
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  let safeBaseUrl = false;
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      safeBaseUrl = parsed.protocol === "https:"
        && allowedHosts.includes(parsed.hostname.toLowerCase())
        && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
    } catch { /* The config endpoint reports false; the operation returns a safe configuration error. */ }
  }
  return {
    baseUrl,
    allowedHosts,
    authorization,
    cookie,
    configured: Boolean(safeBaseUrl && (authorization || cookie)),
  };
}

export function normalizePortalIdentity(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function identifyRequest(request: PortalRequestRecord): string {
  return normalizePortalIdentity(request.dataByType?.model?.customer?.personalInfo?.identification);
}

function requestId(request: PortalRequestRecord): string {
  return String(request.id ?? "").trim();
}

function isEligibleRequest(request: PortalRequestRecord, expectedIdentity: string, requestType: string): boolean {
  if (identifyRequest(request) !== expectedIdentity) return false;
  if (String(request.type ?? "") !== requestType) return false;
  if (!ACTIVE_STATUSES.has(String(request.status ?? "").toLowerCase())) return false;
  if (String(request.subStatus ?? "").toLowerCase() === "cancelled") return false;

  const model = request.dataByType?.model;
  const stage = String(model?.status ?? "").toLowerCase();
  const transition = APPROVED_TRANSITIONS[stage];
  const timeline = model?.statusTimeline;
  if (!transition || !Array.isArray(timeline) || timeline.length === 0) return false;
  return String(timeline[timeline.length - 1]?.to ?? "").toLowerCase() === stage;
}

/**
 * A previous CustomData-only write can leave the local projection cancelled while the business
 * process is still outer-active. Those rows still block the Portal, so they need the process
 * cancellation to finish; the CustomData update must not be repeated for them.
 */
function isPartiallyCancelled(request: PortalRequestRecord, expectedIdentity: string, requestType: string): boolean {
  return identifyRequest(request) === expectedIdentity
    && String(request.type ?? "") === requestType
    && ACTIVE_STATUSES.has(String(request.status ?? "").toLowerCase())
    && String(request.subStatus ?? "").toLowerCase() === "cancelled"
    && String(request.dataByType?.model?.status ?? "").toLowerCase() === "cancelled"
    && typeof request.dataByType?.model?.requestCode === "string"
    && request.dataByType.model.requestCode.trim() !== "";
}

/**
 * The Portal's own cancel action only saves CustomData for a request that never reached the
 * business process (no requestCode), leaving the outer status untouched. That state is the
 * Portal's terminal cancelled-draft state, not an active request.
 */
function isLocallyCancelledDraft(request: PortalRequestRecord): boolean {
  const code = request.dataByType?.model?.requestCode;
  return String(request.subStatus ?? "").toLowerCase() === "cancelled"
    && String(request.dataByType?.model?.status ?? "").toLowerCase() === "cancelled"
    && !(typeof code === "string" && code.trim() !== "");
}

function toCandidate(request: PortalRequestRecord): CancellationCandidate {
  return {
    id: requestId(request),
    status: String(request.status ?? ""),
    subStatus: String(request.subStatus ?? ""),
    modelStatus: String(request.dataByType?.model?.status ?? ""),
    ...(typeof request.dataByType?.model?.requestCode === "string"
      ? { requestCode: request.dataByType.model.requestCode }
      : {}),
  };
}

function isCancelledProjection(request: PortalRequestRecord): boolean {
  const outerStatus = String(request.status ?? "").trim().toLowerCase();
  const subStatus = String(request.subStatus ?? "").trim().toLowerCase();
  const outerCancelled = outerStatus === "canceled" || outerStatus === "cancelled";
  return outerCancelled && subStatus === "cancelled";
}

function safeRequestIds(values: unknown): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_REQUEST_IDS) {
    throw new PortalCancellationError("request_ids_invalid", 400, "Indica entre 1 y 20 IDs revisados.");
  }
  const ids = values.map((value) => String(value ?? "").trim());
  if (ids.some((id) => !/^[A-Za-z0-9._-]{1,128}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new PortalCancellationError("request_ids_invalid", 400, "Los IDs deben ser válidos y no repetirse.");
  }
  return ids;
}

function safeRequestIdsForBulk(ids: string[]): string[] {
  if (ids.some((id) => !/^[A-Za-z0-9._-]{1,128}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new PortalCancellationError("request_ids_invalid", 409, "La consulta QA contiene IDs inválidos o duplicados.");
  }
  return ids;
}

export function createPortalRequestCancellationService(
  config: PortalCancellationConfig,
  fetcher: typeof fetch = fetch,
) {
  function assertReady() {
    if (!config.enabled) {
      throw new PortalCancellationError("cancellation_disabled", 409, "La cancelación QA está desactivada para este proyecto.");
    }
    if (!config.baseUrl || (!(config.authorization || config.cookie) && config.authenticatedSession !== true)) {
      throw new PortalCancellationError("cancellation_not_configured", 503, "El servidor no tiene configurado el acceso QA requerido.");
    }
    let url: URL;
    try { url = new URL(config.baseUrl); }
    catch { throw new PortalCancellationError("cancellation_not_configured", 503, "La URL QA del servidor no es válida."); }
    const allowedHosts = config.allowedHosts?.length ? config.allowedHosts : DEFAULT_ALLOWED_HOSTS;
    if (url.protocol !== "https:" || !allowedHosts.map((host) => host.toLowerCase()).includes(url.hostname.toLowerCase())
      || url.username || url.password || url.search || url.hash) {
      throw new PortalCancellationError("cancellation_host_rejected", 503, "La URL configurada no pertenece a un host QA permitido.");
    }
    return url;
  }

  function headers(): HeadersInit {
    const result: Record<string, string> = { accept: "application/json" };
    if (config.authorization) result.Authorization = config.authorization;
    if (config.cookie) result.Cookie = config.cookie;
    return result;
  }

  async function getPage(page: number, includeData: boolean): Promise<{ items: PortalRequestRecord[]; totalPages: number }> {
    const base = assertReady();
    const url = new URL("/api/proxy/api/Requests", base);
    url.searchParams.set("Type", config.requestType || DEFAULT_REQUEST_TYPE);
    url.searchParams.set("CustomIdentifierContains", "");
    url.searchParams.set("SubType", "");
    url.searchParams.set("SubStatus", "");
    url.searchParams.set("CreatedByContains", "");
    url.searchParams.set("UpdatedByContains", "");
    url.searchParams.set("Page", String(page));
    url.searchParams.set("Items", String(config.pageSize ?? 100));
    if (includeData) url.searchParams.set("RawIncludes", "DataByType");

    let response: Response;
    try {
      response = await fetcher(url, {
        method: "GET",
        headers: headers(),
        redirect: "error",
        signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
      });
    } catch {
      throw new PortalCancellationError("qa_read_failed", 502, "No se pudo leer el estado actual de las solicitudes QA.");
    }
    if (!response.ok) {
      throw new PortalCancellationError("qa_read_failed", 502, "La consulta QA no respondió correctamente.");
    }
    let body: any;
    try { body = await response.json(); }
    catch { throw new PortalCancellationError("qa_response_invalid", 502, "La respuesta QA no contiene JSON válido."); }
    if (!Array.isArray(body?.items)) {
      throw new PortalCancellationError("qa_response_invalid", 502, "La respuesta QA no contiene la lista esperada.");
    }
    const totalPages = Number(body.totalPages ?? 1);
    if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > MAX_PAGES) {
      throw new PortalCancellationError("qa_pagination_invalid", 502, "La paginación QA excede el límite seguro.");
    }
    return { items: body.items, totalPages };
  }

  async function listAllRequests(includeData: boolean): Promise<PortalRequestRecord[]> {
    const first = await getPage(1, includeData);
    const items = [...first.items];
    for (let page = 2; page <= first.totalPages; page += 4) {
      const pages = Array.from({ length: Math.min(4, first.totalPages - page + 1) }, (_, offset) => page + offset);
      const results = await Promise.all(pages.map((number) => getPage(number, includeData)));
      for (const result of results) {
        if (result.totalPages !== first.totalPages) {
          throw new PortalCancellationError("qa_pagination_changed", 409, "La lista QA cambió durante la lectura; vuelve a revisar la vista previa.");
        }
        items.push(...result.items);
      }
    }
    return items;
  }

  async function getUniqueRequest(id: string, identity: string): Promise<PortalRequestRecord> {
    const rows = (await listAllRequests(true)).filter((item) => requestId(item) === id && identifyRequest(item) === identity);
    if (rows.length !== 1) {
      throw new PortalCancellationError("request_not_unique", 409, "La solicitud no existe de forma única para esa identidad QA.");
    }
    return rows[0];
  }

  /**
   * The Portal process cancellation and the local request projection are not
   * always committed in the same transaction.  Poll the same authenticated
   * read path for a bounded period instead of treating the first stale read
   * as a failed cancellation.  A final non-cancelled state still fails closed.
   */
  async function waitForCancelledRequest(id: string, identity: string): Promise<PortalRequestRecord> {
    const timeoutMs = Math.max(15_000, Math.min((config.timeoutMs ?? 20_000) * 3, 60_000));
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    let current = await getUniqueRequest(id, identity);
    while (!isCancelledProjection(current) && !isLocallyCancelledDraft(current)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return current;
      const delayMs = Math.min(500 * (attempt + 1), 2_000, remaining);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      try {
        current = await getUniqueRequest(id, identity);
      } catch (error) {
        // The Portal list projection can briefly fail while the process and
        // local CustomData writes converge. Keep the last known row and retry
        // only within this bounded verification window; persistent failures
        // still fail closed as qa_cancel_not_persisted below.
        if (!(error instanceof PortalCancellationError)
          || !["qa_read_failed", "qa_response_invalid", "qa_pagination_invalid", "qa_pagination_changed"].includes(error.code)) {
          throw error;
        }
      }
      attempt += 1;
    }
    return current;
  }

  /**
   * CustomData returns the authoritative write acknowledgement as
   * { id, status: "Canceled" }. The list projection can lag that response,
   * so only this explicit, ID-matched acknowledgement may bypass a stale GET.
   */
  async function hasCancellationAcknowledgement(response: Response, id: string): Promise<boolean> {
    if (response.status === 204 || response.status === 304) return false;
    try {
      const body = await response.clone().json() as Record<string, unknown>;
      const responseId = body.id ?? body.requestId;
      const responseStatus = body.status ?? (body.data as Record<string, unknown> | undefined)?.status;
      return String(responseId ?? "").trim() === id
        && ["canceled", "cancelled"].includes(String(responseStatus ?? "").trim().toLowerCase());
    } catch {
      return false;
    }
  }

  async function preview(identityInput: unknown) {
    assertReady();
    const identity = normalizePortalIdentity(identityInput);
    if (identity.length < 6 || identity.length > 20) {
      throw new PortalCancellationError("identity_invalid", 400, "Indica una identidad de prueba válida.");
    }
    const records = await listAllRequests(true);
    const matching = records.filter((item) => identifyRequest(item) === identity);
    const previewType = config.requestType || DEFAULT_REQUEST_TYPE;
    const candidates = matching.filter((item) => isEligibleRequest(item, identity, previewType) || isPartiallyCancelled(item, identity, previewType));
    const candidateIds = new Set(candidates.map(requestId));
    return {
      found: matching.length,
      candidates: candidates.map(toCandidate),
      omitted: matching.filter((item) => !candidateIds.has(requestId(item))).map((item) => ({
        id: requestId(item),
        status: String(item.status ?? ""),
        subStatus: String(item.subStatus ?? ""),
        modelStatus: String(item.dataByType?.model?.status ?? ""),
      })),
    };
  }

  async function cancel(identityInput: unknown, requestIdInput: unknown, confirmed: unknown, allForIdentity = false, requiredRequestId?: string) {
    assertReady();
    const identity = normalizePortalIdentity(identityInput);
    if (identity.length < 6 || identity.length > 20) {
      throw new PortalCancellationError("identity_invalid", 400, "Indica una identidad de prueba válida.");
    }
    if (confirmed !== true) {
      throw new PortalCancellationError("confirmation_required", 400, "Confirma explícitamente los IDs revisados antes de cancelar.");
    }
    const selectedIds = allForIdentity ? undefined : safeRequestIds(requestIdInput);
    const currentRows = (await listAllRequests(true)).filter((item) => identifyRequest(item) === identity);
    if (requiredRequestId && !currentRows.some((item) => requestId(item) === requiredRequestId
      && (isEligibleRequest(item, identity, config.requestType || DEFAULT_REQUEST_TYPE)
        || isPartiallyCancelled(item, identity, config.requestType || DEFAULT_REQUEST_TYPE)))) {
      throw new PortalCancellationError("request_changed_since_preview", 409, "La solicitud observada no pertenece a la identidad QA o dejó de ser elegible.");
    }
    const activeRows = currentRows.filter((item) => ACTIVE_STATUSES.has(String(item.status ?? "").toLowerCase())
      && String(item.subStatus ?? "").toLowerCase() !== "cancelled");
    if (allForIdentity && activeRows.some((item) => !isEligibleRequest(item, identity, config.requestType || DEFAULT_REQUEST_TYPE))) {
      throw new PortalCancellationError("request_state_unsupported", 409, "Hay solicitudes activas cuyo estado no permite una cancelación QA verificada.");
    }
    const requestType = config.requestType || DEFAULT_REQUEST_TYPE;
    const partialRows = currentRows.filter((item) => isPartiallyCancelled(item, identity, requestType));
    const ids = selectedIds ?? safeRequestIdsForBulk([...activeRows, ...partialRows].map(requestId));
    for (const id of ids) {
      const matches = currentRows.filter((item) => requestId(item) === id);
      if (matches.length !== 1 || !(isEligibleRequest(matches[0], identity, requestType) || isPartiallyCancelled(matches[0], identity, requestType))) {
        throw new PortalCancellationError("request_changed_since_preview", 409, "Una o más solicitudes ya no coinciden con la vista previa o dejaron de ser elegibles.");
      }
    }

    const cancelledIds: string[] = [];
    const acknowledgedIds = new Set<string>();
    let failed: { id: string; reason: string } | null = null;
    for (const id of ids) {
      try {
        const current = await getUniqueRequest(id, identity);
        const partial = isPartiallyCancelled(current, identity, requestType);
        if (!partial && !isEligibleRequest(current, identity, requestType)) {
          throw new PortalCancellationError("request_changed_before_put", 409, "El estado de la solicitud cambió antes de cancelar.");
        }
        const base = assertReady();
        // Observed on the deployed Portal: a CustomData-only update leaves the request outer
        // InProgress (subStatus/model.status cancelled) and the Portal keeps treating it as an
        // active case. The Portal's own cancel action first calls ByType/AnularCaso, so that
        // process call is the default whenever the request has a requestCode; callers can turn
        // it off with cancelProcess:false.
        const requestCode = current.dataByType?.model?.requestCode;
        if (config.cancelProcess !== false && typeof requestCode === "string" && requestCode.trim()) {
          const processResponse = await fetcher(new URL("/api/proxy/api/Requests/ByType", base), {
            method: "PUT",
            headers: { ...headers(), "content-type": "application/json" },
            body: JSON.stringify({
              type: current.type,
              id: current.id,
              data: {
                discriminator: current.type,
                type: "AnularCaso",
                data: {
                  discriminator: "*.AnularCaso",
                  overrideRadNumber: requestCode,
                  abortReason: "Cancelado por el usuario",
                },
              },
            }),
            redirect: "error",
            signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
          });
          if (processResponse.status !== 200 && processResponse.status !== 204) {
            throw new PortalCancellationError("qa_process_cancel_failed", 502, "El Portal no confirmó la cancelación del proceso.");
          }
        }
        if (partial) {
          // The local CustomData update already persisted; only the process cancellation was missing.
          const finished = await waitForCancelledRequest(id, identity);
          if (!isCancelledProjection(finished)) {
            console.log(`[portal-request-cancellation] phase=partial_verify outer=${String(finished.status ?? "")} sub=${String(finished.subStatus ?? "")} model=${String(finished.dataByType?.model?.status ?? "")}`);
            throw new PortalCancellationError("qa_cancel_not_persisted", 502, "QA no confirmó el estado cancelado después del cambio.");
          }
          cancelledIds.push(id);
          continue;
        }
        const transition = APPROVED_TRANSITIONS[String(current.dataByType?.model?.status ?? "").toLowerCase()];
        const dataByType = JSON.parse(JSON.stringify(current.dataByType));
        const originalStage = dataByType.model.status;
        dataByType.model.status = transition.to;
        dataByType.model.statusTimeline.push({
          from: originalStage,
          to: transition.to,
          at: new Date().toISOString(),
          reason: transition.reason,
        });
        const payload = {
          type: current.type,
          id: current.id,
          dataByType,
          changeSubStatus: "cancelled",
          changeSubType: "request",
        };
        const response = await fetcher(new URL("/api/proxy/api/Requests/CustomData", base), {
          method: "PUT",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify(payload),
          redirect: "error",
          signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
        });
        if (response.status !== 200 && response.status !== 204) {
          throw new PortalCancellationError("qa_cancel_failed", 502, "El servicio QA rechazó la cancelación.");
        }
        const responseAcknowledged = await hasCancellationAcknowledgement(response, id);
        if (responseAcknowledged) acknowledgedIds.add(id);
        const verified = responseAcknowledged ? undefined : await waitForCancelledRequest(id, identity);
        console.log(`[portal-request-cancellation] phase=custom_data_put httpStatus=${response.status} acknowledged=${responseAcknowledged}${verified ? ` outer=${String(verified.status ?? "")} sub=${String(verified.subStatus ?? "")} model=${String(verified.dataByType?.model?.status ?? "")}` : ""}`);
        // A draft that never reached the business process (no requestCode) is cancelled by the
        // Portal's own action with this CustomData save alone; its re-read stays outer Draft with
        // subStatus/model.status cancelled. Requests with a requestCode still need outer Canceled.
        if (!responseAcknowledged && (!verified || !(isCancelledProjection(verified) || isLocallyCancelledDraft(verified)))) {
          throw new PortalCancellationError("qa_cancel_not_persisted", 502, "QA no confirmó el estado cancelado después del cambio.");
        }
        cancelledIds.push(id);
      } catch (error) {
        const failure = error instanceof PortalCancellationError
          ? error.code
          : "qa_cancel_failed";
        failed = { id, reason: failure };
        break;
      }
    }
    if (allForIdentity && !failed) {
      const remaining = (await listAllRequests(true)).filter((item) => identifyRequest(item) === identity
        && ACTIVE_STATUSES.has(String(item.status ?? "").toLowerCase())
        && !cancelledIds.includes(requestId(item))
        && !acknowledgedIds.has(requestId(item))
        && !isLocallyCancelledDraft(item));
      if (remaining.length) failed = { id: requestId(remaining[0]), reason: "active_requests_remaining" };
    }
    return { cancelledIds, failed };
  }

  async function cancelAll(identity: unknown, confirmed: unknown, requiredRequestId?: string) {
    return cancel(identity, undefined, confirmed, true, requiredRequestId);
  }

  /**
   * Codes of the existing cases the Portal's duplicate-case check (the read-only query "Depurar"
   * runs) reports for an identity: 204 means none, 200 carries `items` with the case codes.
   * Anything else is not evidence of a blocker and fails closed.
   */
  async function listBizagiCaseCodes(identityInput: unknown): Promise<string[]> {
    const base = assertReady();
    const identification = String(identityInput ?? "").trim();
    if (normalizePortalIdentity(identification).length < 6) {
      throw new PortalCancellationError("identity_invalid", 400, "Indica una identidad de prueba válida.");
    }
    let response: Response;
    try {
      response = await fetcher(new URL("/api/proxy/api/Procesos/MDW/ConsultarCasosBizagiSQL", base), {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ identificacion: identification }),
        redirect: "error",
        signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
      });
    } catch {
      throw new PortalCancellationError("qa_read_failed", 502, "No se pudo consultar los casos existentes.");
    }
    if (response.status === 204) return [];
    if (response.status !== 200) {
      throw new PortalCancellationError("qa_response_invalid", 502, "La consulta de casos existentes no respondió como se esperaba.");
    }
    const body = await response.json().catch(() => undefined) as { items?: unknown } | undefined;
    if (!Array.isArray(body?.items)) throw new PortalCancellationError("qa_response_invalid", 502, "La consulta de casos existentes no devolvió una lista.");
    return [...new Set(body.items.filter((item): item is string => typeof item === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{2,}$/.test(item.trim())).map((item) => item.trim()))];
  }

  /**
   * The Portal's own duplicate-case check (the query its "Depurar" action runs) can keep seeing a
   * request for a while after its cancellation. Poll that same read-only query until it reports no
   * existing case (204, or an empty list) so a replay never starts inside that window. Fails
   * closed when the bound is reached.
   */
  async function awaitNoActiveBizagiCases(identityInput: unknown, options: { timeoutMs?: number; pollMs?: number } = {}) {
    const base = assertReady();
    const identification = String(identityInput ?? "").trim();
    if (normalizePortalIdentity(identification).length < 6) {
      throw new PortalCancellationError("identity_invalid", 400, "Indica una identidad de prueba válida.");
    }
    const deadline = Date.now() + (options.timeoutMs ?? 90_000);
    const pollMs = options.pollMs ?? 3_000;
    let attempts = 0;
    for (;;) {
      attempts += 1;
      let clear = false;
      let observed = "request_error";
      try {
        const response = await fetcher(new URL("/api/proxy/api/Procesos/MDW/ConsultarCasosBizagiSQL", base), {
          method: "POST",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify({ identificacion: identification }),
          redirect: "error",
          signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
        });
        observed = String(response.status);
        if (response.status === 204) clear = true;
        else if (response.status === 200) {
          const body = await response.json().catch(() => undefined) as unknown;
          clear = Array.isArray(body) && body.length === 0;
        }
      } catch { /* a transient failure counts as "not confirmed yet" */ }
      if (clear) {
        console.log(`[portal-request-cancellation] phase=bizagi_cases_clear attempts=${attempts}`);
        return { clear: true as const, attempts };
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        console.log(`[portal-request-cancellation] phase=bizagi_cases_remaining attempts=${attempts} lastStatus=${observed}`);
        throw new PortalCancellationError("bizagi_active_cases_remaining", 409, "El Portal aún reporta casos existentes para la identidad.");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, remainingMs)));
    }
  }

  return { preview, cancel, cancelAll, awaitNoActiveBizagiCases, listBizagiCaseCodes };
}
