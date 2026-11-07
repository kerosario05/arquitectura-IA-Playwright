import assert from "node:assert/strict";
import test from "node:test";
import { createCedulaReleaser, createCedulaReleaserFromHttp, createSessionCedulaReleaser, dataCedulasReuseEnabled, portalApiSettings, portalLoginFromRequirements, resetOpenRequestIndexForTests, type PortalHttp } from "./data-cedulas-reuse";

test("the job's login values become the releaser's Portal session; redacted or missing ones do not", () => {
  const requirements = [{ valueKey: "usuario", value: "qa.user" }, { valueKey: "contrasena", value: "s3cret" }, { valueKey: "otro", value: "x" }];
  assert.deepEqual(portalLoginFromRequirements(requirements, "https://srvqacgowb01.local.bsc.com:5000/"),
    { baseUrl: "https://srvqacgowb01.local.bsc.com:5000/", username: "qa.user", password: "s3cret" });
  assert.equal(portalLoginFromRequirements([{ valueKey: "usuario", value: "qa.user" }, { valueKey: "contrasena", value: "[REDACTED]" }], "https://h/"), undefined);
  assert.equal(portalLoginFromRequirements(requirements, undefined), undefined);
  assert.equal(portalLoginFromRequirements([{ valueKey: "usuario", value: "qa.user" }], "https://h/"), undefined);
});

test("the session releaser only signs in to an allowed https QA host and can be switched off", () => {
  const login = { baseUrl: "https://srvqacgowb01.local.bsc.com:5000/", username: "u", password: "p" };
  assert.equal(typeof createSessionCedulaReleaser(login, {} as any), "function");
  assert.equal(createSessionCedulaReleaser({ ...login, baseUrl: "https://evil.example.com/" }, {} as any), undefined);
  assert.equal(createSessionCedulaReleaser({ ...login, baseUrl: "http://srvqacgowb01.local.bsc.com/" }, {} as any), undefined);
  assert.equal(createSessionCedulaReleaser(login, { DATA_CEDULAS_CANCEL_ACTIVE_CASES: "false" } as any), undefined);
});

const request = (over: Record<string, unknown> = {}, model: Record<string, unknown> = {}): any => ({
  id: "11184", type: "MultiProdNatural", status: "InProgress", subStatus: "",
  dataByType: { model: { status: "simulation", statusTimeline: [{ to: "simulation" }], requestCode: "MPN-3214",
    customer: { personalInfo: { identification: "001-0323453-0" } }, ...model } },
  ...over,
});

/**
 * Fake Portal: serves the request list, records writes and the list queries, and reports bizagi cases
 * like the real check does (the codes of open requests that reached the process). `bizagi` overrides it;
 * returning `undefined` makes the check answer HTTP 500.
 */
function portal(rows: any[], bizagi?: (writes: string[]) => string[] | undefined, sqlSees = true) {
  resetOpenRequestIndexForTests();
  const writes: string[] = [];
  const listings: string[] = [];
  const cancelled = new Set<string>();
  const open = (row: any) => ["draft", "inprogress"].includes(String(row.status).toLowerCase()) && String(row.subStatus).toLowerCase() !== "cancelled" && !cancelled.has(String(row.id));
  const http: PortalHttp = async (method, path, options) => {
    if (path.endsWith("/Requests") && method === "GET") { listings.push(options?.query?.CustomIdentifierContains ?? ""); return { status: 200, body: { items: rows, totalPages: 1 } }; }
    if (path.endsWith("/Requests/ByType")) { writes.push(`AnularCaso:${(options?.body as any).data.data.overrideRadNumber}`); return { status: 200, body: null }; }
    if (path.endsWith("/Requests/CustomData")) {
      const body = options?.body as any;
      cancelled.add(String(body.id));
      writes.push(`CustomData:${body.id}:${body.dataByType.model.status}:${body.changeSubStatus}`);
      return { status: 200, body: { id: body.id, status: "Canceled" } };
    }
    if (/\/ConsultarCasosBizagi(SQL|ORACLE)$/.test(path)) {
      // Depurar asks both sources; `sqlSees=false` models a case only the Oracle one reports.
      if (path.endsWith("SQL") && !sqlSees) return { status: 204, body: null };
      const codes = bizagi ? bizagi(writes) : rows.filter((row) => open(row) && row.dataByType?.model?.requestCode).map((row) => row.dataByType.model.requestCode);
      if (codes === undefined) return { status: 500, body: null };
      return codes.length === 0 ? { status: 204, body: null } : { status: 200, body: { items: codes } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { http, writes, listings };
}

test("a cédula with no open request anywhere is free: the list is read once and nothing is written", async () => {
  const { http, writes, listings } = portal([request({ subStatus: "cancelled", status: "Canceled" })]);
  assert.equal(await createCedulaReleaserFromHttp(http)("00103234530"), "already_free");
  assert.deepEqual(writes, []);
  assert.deepEqual(listings, [""], "one read of the whole list");
});

test("an open Portal request that neither Bizagi source reports still blocks the cédula and is cancelled", async () => {
  const { http, writes } = portal([request()], () => []);
  assert.equal(await createCedulaReleaserFromHttp(http)("001-0323453-0"), "released");
  assert.deepEqual(writes, ["AnularCaso:MPN-3214", "CustomData:11184:cancelled:cancelled"]);
});

test("open requests of that identity are cancelled like the Portal does (AnularCaso, then CustomData)", async () => {
  const other = request({ id: "999" }, { customer: { personalInfo: { identification: "00199999999" } }, requestCode: "MPN-OTHER" });
  const { http, writes, listings } = portal([request(), other], (done) => done.length ? [] : ["MPN-3214"]);
  assert.equal(await createCedulaReleaserFromHttp(http)("001-0323453-0"), "released");
  assert.deepEqual(writes, ["AnularCaso:MPN-3214", "CustomData:11184:cancelled:cancelled"]);
  assert.equal(listings[0], "MPN-3214", "the search is narrowed by the reported case code");
});

test("a case only the Oracle source reports still blocks the fast path and is cancelled", async () => {
  const { http, writes } = portal([request()], undefined, false);
  assert.equal(await createCedulaReleaserFromHttp(http)("001-0323453-0"), "released");
  assert.deepEqual(writes, ["AnularCaso:MPN-3214", "CustomData:11184:cancelled:cancelled"]);
});

test("a draft that never reached the process is cancelled with the CustomData save only", async () => {
  const draft = request({ status: "Draft" }, { requestCode: undefined, status: "compliance", statusTimeline: [{ to: "compliance" }] });
  const { http, writes } = portal([draft], (done) => done.length ? [] : ["MPN-9"]);
  assert.equal(await createCedulaReleaserFromHttp(http)("001-0323453-0"), "released");
  assert.deepEqual(writes, ["CustomData:11184:cancelled:cancelled"]);
});

test("a draft the case check never reports is still an open request: it is cancelled so Depurar is not blocked", async () => {
  const draft = request({ status: "Draft" }, { requestCode: undefined, status: "compliance", statusTimeline: [{ to: "compliance" }] });
  const { http, writes } = portal([draft]);
  assert.equal(await createCedulaReleaserFromHttp(http)("001-0323453-0"), "released");
  assert.deepEqual(writes, ["CustomData:11184:cancelled:cancelled"]);
});

test("when the case check fails, the request list is read instead", async () => {
  const { http, writes, listings } = portal([request()], (done) => done.length ? [] : undefined);
  assert.equal(await createCedulaReleaserFromHttp(http)("001-0323453-0"), "released");
  assert.deepEqual(writes, ["AnularCaso:MPN-3214", "CustomData:11184:cancelled:cancelled"]);
  assert.deepEqual(listings, [""], "full list as the fallback");
});

test("an open request in a stage the Portal cannot cancel blocks the cédula without writing", async () => {
  const { http, writes } = portal([request({}, { status: "approved", statusTimeline: [{ to: "approved" }] })]);
  assert.equal(await createCedulaReleaserFromHttp(http)("001-0323453-0"), "blocked");
  assert.deepEqual(writes, []);
});

test("a case the Portal check keeps reporting blocks the cédula once the wait is over", async () => {
  const { http } = portal([], () => ["MPN-1"]);
  assert.equal(await createCedulaReleaserFromHttp(http, { clearTimeoutMs: 30, pollMs: 10 })("00103234530"), "blocked");
});

test("the releaser needs a safe https host and credentials; reuse is on by default", () => {
  assert.equal(createCedulaReleaser({} as any), undefined);
  assert.equal(createCedulaReleaser({ DATA_CEDULAS_CANCEL_ACTIVE_CASES: "false" } as any), undefined);
  assert.equal(portalApiSettings({ PORTAL_COMERCIAL_QA_API_BASE_URL: "https://srvqacgowb01.local.bsc.com:5000", PORTAL_COMERCIAL_QA_API_COOKIE: "c" } as any).configured, true);
  assert.equal(portalApiSettings({ PORTAL_COMERCIAL_QA_API_BASE_URL: "https://evil.example.com", PORTAL_COMERCIAL_QA_API_COOKIE: "c" } as any).configured, false);
  assert.equal(portalApiSettings({ PORTAL_COMERCIAL_QA_API_BASE_URL: "http://srvqacgowb01.local.bsc.com", PORTAL_COMERCIAL_QA_API_COOKIE: "c" } as any).configured, false);
  assert.equal(dataCedulasReuseEnabled({} as any), true);
  assert.equal(dataCedulasReuseEnabled({ DATA_CEDULAS_REUSE: "false" } as any), false);
});
