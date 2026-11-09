import { chromium, request, type APIRequestContext } from "playwright";

/**
 * A cédula is reusable when the customer does not exist in B2000 and the Portal has no open case for
 * it (an open request blocks "Depurar"). After a cédula passes every filter, this module checks the
 * Portal for open requests of that identity and cancels them. The cancellation steps mirror the
 * Portal's own cancel action: AnularCaso for a request that reached the business process, then the
 * CustomData save that moves the stage to cancelled.
 */
export type CedulaReleaseResult = "released" | "already_free" | "blocked";
export type CedulaReleaser = (cedula: string) => Promise<CedulaReleaseResult>;

export type PortalHttpResponse = { status: number; body: any };
export type PortalHttp = (method: "GET" | "POST" | "PUT", path: string, options?: { query?: Record<string, string>; body?: unknown }) => Promise<PortalHttpResponse>;

const REQUEST_TYPE = "MultiProdNatural";
const ACTIVE_STATUSES = new Set(["draft", "inprogress"]);
const TRANSITIONS: Record<string, { to: string; reason: string }> = {
  compliance: { to: "cancelled", reason: "CANCEL" },
  simulation: { to: "cancelled", reason: "CANCEL" },
};
const PAGE_SIZE = 250;
const MAX_PAGES = 200;

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const lower = (value: unknown) => String(value ?? "").trim().toLowerCase();
const modelOf = (item: any) => item?.dataByType?.model;
const identityOf = (item: any) => digits(modelOf(item)?.customer?.personalInfo?.identification);
const isOpen = (item: any) => ACTIVE_STATUSES.has(lower(item?.status)) && lower(item?.subStatus) !== "cancelled";
const requestCodeOf = (item: any): string => {
  const code = modelOf(item)?.requestCode;
  return typeof code === "string" ? code.trim() : "";
};
/** The Portal only cancels these stages; the last timeline entry must agree with the current stage. */
function isCancelable(item: any): boolean {
  const stage = lower(modelOf(item)?.status);
  const timeline = modelOf(item)?.statusTimeline;
  return String(item?.type ?? "") === REQUEST_TYPE
    && Boolean(TRANSITIONS[stage])
    && Array.isArray(timeline) && timeline.length > 0
    && lower(timeline[timeline.length - 1]?.to) === stage;
}
/** Outer Canceled, or a draft that never reached the process and was cancelled locally. */
function isCancelled(item: any): boolean {
  const outer = lower(item?.status);
  const sub = lower(item?.subStatus);
  if ((outer === "canceled" || outer === "cancelled") && sub === "cancelled") return true;
  return sub === "cancelled" && lower(modelOf(item)?.status) === "cancelled" && requestCodeOf(item) === "";
}

async function listRequests(http: PortalHttp, customIdentifierContains = ""): Promise<any[]> {
  const page = async (number: number) => {
    const response = await http("GET", "/api/proxy/api/Requests", {
      query: { Type: REQUEST_TYPE, CustomIdentifierContains: customIdentifierContains, SubType: "", SubStatus: "", CreatedByContains: "", UpdatedByContains: "",
        Page: String(number), Items: String(PAGE_SIZE), RawIncludes: "DataByType" },
    });
    if (response.status !== 200 || !Array.isArray(response.body?.items)) throw new Error("qa_read_failed");
    const totalPages = Number(response.body.totalPages ?? 1);
    if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > MAX_PAGES) throw new Error("qa_pagination_invalid");
    return { items: response.body.items as any[], totalPages };
  };
  const first = await page(1);
  const items = [...first.items];
  for (let number = 2; number <= first.totalPages; number += 1) items.push(...(await page(number)).items);
  return items;
}

/**
 * The Portal's duplicate-case check (the query "Depurar" runs): the codes of the open cases the
 * Portal reports for an identity. 204 or an empty list means none; `null` means the check failed.
 */
async function bizagiCaseCodesFrom(http: PortalHttp, endpoint: string, cedula: string): Promise<string[] | null> {
  const response = await http("POST", `/api/proxy/api/Procesos/MDW/${endpoint}`, { body: { identificacion: cedula } });
  if (response.status === 204) return [];
  if (response.status !== 200) return null;
  const list = Array.isArray(response.body) ? response.body : response.body?.items;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : null;
}

/** "Depurar" asks both case sources (SQL and Oracle Bizagi); a case reported by either one blocks it, so both are read. */
async function bizagiCaseCodes(http: PortalHttp, cedula: string): Promise<string[] | null> {
  const codes: string[] = [];
  for (const endpoint of ["ConsultarCasosBizagiSQL", "ConsultarCasosBizagiORACLE"]) {
    const found = await bizagiCaseCodesFrom(http, endpoint, cedula);
    if (found === null) return null;
    codes.push(...found);
  }
  return [...new Set(codes)];
}

/** Open requests of an identity; the case codes narrow the search so the whole list is rarely read. */
async function findOpenRequests(http: PortalHttp, identity: string, codes: string[]): Promise<any[]> {
  const matching = (items: any[]) => items.filter((item) => identityOf(item) === identity && isOpen(item));
  for (const code of codes) {
    const found = matching(await listRequests(http, code));
    if (found.length) return found;
  }
  return matching(await listRequests(http));
}

// The Portal blocks "Depurar" for an identity that has an open request of its own, even when neither
// Bizagi source reports a case. Its list cannot be searched by identification, so one read of the whole
// list is indexed by identity and reused for a short while (a batch of cédulas shares it).
const OPEN_INDEX_TTL_MS = 2 * 60_000;
let openIndex: { at: number; byIdentity: Map<string, any[]> } | undefined;

async function openRequestsOf(http: PortalHttp, identity: string, fresh = false): Promise<any[]> {
  if (fresh || !openIndex || Date.now() - openIndex.at > OPEN_INDEX_TTL_MS) {
    const byIdentity = new Map<string, any[]>();
    for (const item of await listRequests(http)) {
      if (!isOpen(item)) continue;
      const who = identityOf(item);
      if (who) byIdentity.set(who, [...(byIdentity.get(who) ?? []), item]);
    }
    openIndex = { at: Date.now(), byIdentity };
  }
  return openIndex.byIdentity.get(identity) ?? [];
}

export function resetOpenRequestIndexForTests(): void { openIndex = undefined; }

async function cancelRequest(http: PortalHttp, item: any): Promise<void> {
  const code = requestCodeOf(item);
  if (code) {
    const process = await http("PUT", "/api/proxy/api/Requests/ByType", {
      body: { type: item.type, id: item.id, data: { discriminator: item.type, type: "AnularCaso",
        data: { discriminator: "*.AnularCaso", overrideRadNumber: code, abortReason: "Cancelado por el usuario" } } },
    });
    if (process.status !== 200 && process.status !== 204) throw new Error("qa_process_cancel_failed");
  }
  const transition = TRANSITIONS[lower(modelOf(item)?.status)];
  const dataByType = JSON.parse(JSON.stringify(item.dataByType));
  const from = dataByType.model.status;
  dataByType.model.status = transition.to;
  dataByType.model.statusTimeline.push({ from, to: transition.to, at: new Date().toISOString(), reason: transition.reason });
  const saved = await http("PUT", "/api/proxy/api/Requests/CustomData", {
    body: { type: item.type, id: item.id, dataByType, changeSubStatus: "cancelled", changeSubType: "request" },
  });
  if (saved.status !== 200 && saved.status !== 204) throw new Error("qa_cancel_failed");
  const acknowledged = lower(saved.body?.status ?? saved.body?.data?.status) === "canceled" || lower(saved.body?.status) === "cancelled";
  if (acknowledged && String(saved.body?.id ?? saved.body?.requestId ?? "").trim() === String(item.id)) return;
  // The list projection can lag the write: re-read until this request shows as cancelled.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const current = (await listRequests(http)).find((row) => String(row.id) === String(item.id));
    if (current && isCancelled(current)) return;
    if (Date.now() >= deadline) throw new Error("qa_cancel_not_persisted");
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  }
}

export function createCedulaReleaserFromHttp(http: PortalHttp, options: { clearTimeoutMs?: number; pollMs?: number } = {}): CedulaReleaser {
  return async (cedula) => {
    try {
      const identity = digits(cedula);
      if (identity.length < 6 || identity.length > 20) return "blocked";
      // Fast path: the case check is what blocks "Depurar", and it is one call. No reported case, nothing to cancel.
      const reported = await bizagiCaseCodes(http, String(cedula).trim());
      const open = reported !== null && reported.length === 0
        ? await openRequestsOf(http, identity)
        : await findOpenRequests(http, identity, reported ?? []);
      if (reported !== null && reported.length === 0 && open.length === 0) return "already_free";
      const unsupported = open.filter((item) => !isCancelable(item));
      if (unsupported.length) {
        console.log(`[data-cedulas][reuse] blocked reason=unsupported_stage ${unsupported.map((item) => {
          const timeline = modelOf(item)?.statusTimeline;
          return `stage=${lower(modelOf(item)?.status) || "?"} status=${lower(item?.status)} type=${String(item?.type ?? "?")} timeline=${Array.isArray(timeline) ? timeline.length : "none"} lastTo=${Array.isArray(timeline) && timeline.length ? lower(timeline[timeline.length - 1]?.to) : "-"}`;
        }).join(" | ")}`);
        return "blocked";
      }
      for (const item of open) await cancelRequest(http, item);
      // The duplicate-case check can keep reporting a just-cancelled case for a while.
      const deadline = Date.now() + (options.clearTimeoutMs ?? 300_000);
      for (;;) {
        const remaining = await bizagiCaseCodes(http, String(cedula).trim());
        if (remaining !== null && remaining.length === 0) return open.length > 0 ? "released" : "already_free";
        if (Date.now() >= deadline) {
          console.log("[data-cedulas][reuse] blocked reason=bizagi_cases_remaining");
          return "blocked";
        }
        await new Promise<void>((resolve) => setTimeout(resolve, options.pollMs ?? 2_000));
      }
    } catch (error) {
      console.log(`[data-cedulas][reuse] blocked reason=${error instanceof Error ? error.message : "unknown"}`);
      return "blocked";
    }
  };
}

const DEFAULT_ALLOWED_HOSTS = ["srvqacgowb01.local.bsc.com"];

/** Portal QA API settings from the environment; `configured` is false without a safe https host and credentials. */
export function portalApiSettings(env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = env.PORTAL_COMERCIAL_QA_API_BASE_URL?.trim();
  const authorization = env.PORTAL_COMERCIAL_QA_API_AUTHORIZATION?.trim();
  const cookie = env.PORTAL_COMERCIAL_QA_API_COOKIE?.trim();
  const allowedHosts = (env.PORTAL_COMERCIAL_QA_API_ALLOWED_HOSTS || DEFAULT_ALLOWED_HOSTS.join(","))
    .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  let safe = false;
  if (baseUrl) {
    try {
      const url = new URL(baseUrl);
      safe = url.protocol === "https:" && allowedHosts.includes(url.hostname.toLowerCase()) && !url.username && !url.password;
    } catch { /* not configured */ }
  }
  return { baseUrl, authorization, cookie, configured: Boolean(safe && (authorization || cookie)) };
}

/** Env-driven releaser, or undefined when the Portal QA API is not configured or the feature is off. */
export function createCedulaReleaser(env: NodeJS.ProcessEnv = process.env): CedulaReleaser | undefined {
  if (lower(env.DATA_CEDULAS_CANCEL_ACTIVE_CASES) === "false") return undefined;
  const settings = portalApiSettings(env);
  if (!settings.configured || !settings.baseUrl) {
    console.warn("[data-cedulas][reuse] Portal QA API no configurada: no se verifican ni cancelan solicitudes abiertas antes de entregar la cédula");
    return undefined;
  }
  const base = settings.baseUrl;
  const headers: Record<string, string> = { accept: "application/json" };
  if (settings.authorization) headers.Authorization = settings.authorization;
  if (settings.cookie) headers.Cookie = settings.cookie;
  return async (cedula) => {
    const client = await request.newContext({ ignoreHTTPSErrors: true, timeout: 60_000, extraHTTPHeaders: headers });
    try { return await createCedulaReleaserFromHttp(portalHttpFromRequest(client, base))(cedula); }
    finally { await client.dispose(); }
  };
}

function portalHttpFromRequest(client: APIRequestContext, base: string): PortalHttp {
  return async (method, path, options) => {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(options?.query ?? {})) url.searchParams.set(key, value);
    const response = await client.fetch(url.toString(), {
      method,
      maxRedirects: 0,
      ...(options?.body !== undefined ? { data: JSON.stringify(options.body), headers: { "content-type": "application/json" } } : {}),
    });
    const text = await response.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: response.status(), body };
  };
}

/** The job's own Portal login (the `usuario` / `contrasena` values of the recording's dataset). */
export type PortalLogin = { baseUrl: string; username: string; password: string };

/** Login credentials from a scenario's runtime requirements (same values the job types at login). */
export function portalLoginFromRequirements(
  requirements: ReadonlyArray<{ valueKey: string; value?: unknown }>,
  baseUrl: string | undefined,
): PortalLogin | undefined {
  const valueOf = (key: string) => {
    const found = requirements.find((requirement) => requirement.valueKey === key)?.value;
    return typeof found === "string" && found.trim() && !/^\[?\s*redacted/i.test(found.trim()) ? found : undefined;
  };
  const username = valueOf("usuario");
  const password = valueOf("contrasena");
  return baseUrl && username && password ? { baseUrl, username, password } : undefined;
}

/**
 * Releaser that signs in to the Portal like the job does (login form, then the session cookie) and
 * cancels through the same API the Portal front end uses. The host must be an allowed QA host.
 */
export function createSessionCedulaReleaser(login: PortalLogin, env: NodeJS.ProcessEnv = process.env): CedulaReleaser | undefined {
  if (lower(env.DATA_CEDULAS_CANCEL_ACTIVE_CASES) === "false") return undefined;
  if (!isAllowedPortalHost(login.baseUrl, env)) {
    console.warn("[data-cedulas][reuse] host del portal no permitido para cancelar solicitudes");
    return undefined;
  }
  return async (cedula) => {
    const attempt = (fresh: boolean) => withPortalSession(login, (http) => createCedulaReleaserFromHttp(http)(cedula), env, { fresh });
    try {
      const first = await attempt(false);
      if (first !== "blocked") return first;
      // A cached session may have expired: sign in again once before giving up.
      invalidatePortalSession(login);
      return await attempt(true);
    } catch {
      invalidatePortalSession(login);
      return "blocked";
    }
  };
}

function isAllowedPortalHost(baseUrl: string, env: NodeJS.ProcessEnv): boolean {
  const allowedHosts = (env.PORTAL_COMERCIAL_QA_API_ALLOWED_HOSTS || DEFAULT_ALLOWED_HOSTS.join(","))
    .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" && allowedHosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// The login opens a browser (10 to 15 s); the session it produces is plain cookies, so it is kept
// in memory and reused for the next releases instead of signing in again for every cédula.
const SESSION_TTL_MS = 25 * 60_000;
const sessionCache = new Map<string, { state: Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>>; expiresAt: number }>();
const sessionKey = (login: PortalLogin) => `${login.baseUrl}|${login.username}`;

export function invalidatePortalSession(login: PortalLogin): void {
  sessionCache.delete(sessionKey(login));
}

/** The Portal login form kept the user on /login: the stored user or password is wrong or expired. */
export class PortalLoginRejectedError extends Error {
  constructor() { super("portal_login_rejected"); this.name = "PortalLoginRejectedError"; }
}

/** Signs in to the Portal with the job's login and gives `run` an HTTP client that carries the session. */
export async function withPortalSession<T>(login: PortalLogin, run: (http: PortalHttp) => Promise<T>, env: NodeJS.ProcessEnv = process.env, options: { fresh?: boolean } = {}): Promise<T> {
  if (!isAllowedPortalHost(login.baseUrl, env)) throw new Error("host_not_allowed");
  const cached = options.fresh ? undefined : sessionCache.get(sessionKey(login));
  if (cached && cached.expiresAt > Date.now()) {
    const client = await request.newContext({ ignoreHTTPSErrors: true, timeout: 60_000, storageState: cached.state });
    try { return await run(portalHttpFromRequest(client, login.baseUrl)); }
    finally { await client.dispose(); }
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(login.baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator("#username").fill(login.username);
    await page.locator("#password").fill(login.password);
    await page.locator("#password").press("Enter");
    try {
      await page.waitForURL((current) => !/\/login/i.test(current.pathname), { timeout: 60_000 });
    } catch (error) {
      // Still on the login screen after submitting = credentials refused (not a slow network).
      if (/\/login/i.test(new URL(page.url()).pathname)) throw new PortalLoginRejectedError();
      throw error;
    }
    sessionCache.set(sessionKey(login), { state: await context.storageState(), expiresAt: Date.now() + SESSION_TTL_MS });
    return await run(portalHttpFromRequest(context.request, login.baseUrl));
  } finally {
    await browser.close();
  }
}

/** Previously issued ids stay eligible unless reuse is switched off. */
export function dataCedulasReuseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return lower(env.DATA_CEDULAS_REUSE) !== "false";
}
