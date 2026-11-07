import assert from "node:assert/strict";
import test from "node:test";
import {
  createPortalRequestCancellationService,
  getPortalCancellationEnvironment,
  PortalCancellationError,
  type PortalCancellationConfig,
  type PortalRequestRecord,
} from "./portal-comercial-request-cancellation";

const identity = "00000000000";
const config: PortalCancellationConfig = {
  enabled: true,
  baseUrl: "https://qa.example.test:5000",
  allowedHosts: ["qa.example.test"],
  authorization: "Bearer test-only-token",
};

function activeRequest(id: string, modelStatus = "compliance"): PortalRequestRecord {
  return {
    id,
    type: "MultiProdNatural",
    status: "Draft",
    subStatus: "InProgress",
    dataByType: {
      model: {
        status: modelStatus,
        statusTimeline: [{ from: "simulation", to: modelStatus }],
        customer: { personalInfo: { identification: identity } },
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(initial: PortalRequestRecord[]) {
  const state = structuredClone(initial);
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (init.method === "PUT") {
      const payload = JSON.parse(String(init.body));
      const row = state.find((item) => String(item.id) === String(payload.id));
      if (url.pathname.endsWith("/ByType")) {
        if (row) row.status = "Canceled";
        return jsonResponse({}, 200);
      }
      if (row) {
        row.status = "Canceled";
        row.subStatus = "cancelled";
        row.dataByType = payload.dataByType;
      }
      return jsonResponse({ id: payload.id }, 200);
    }
    return jsonResponse({ items: structuredClone(state), page: 1, totalPages: 1 });
  };
  return { fetcher, state, calls };
}

test("preview returns only eligible request metadata and never echoes the identity", async () => {
  const matchingEligible = activeRequest("qa-1");
  const matchingUnsupportedStage = activeRequest("qa-2", "unknown-stage");
  const otherIdentity = activeRequest("qa-3");
  otherIdentity.dataByType!.model!.customer!.personalInfo!.identification = "11111111111";
  const { fetcher, calls } = mockFetch([matchingEligible, matchingUnsupportedStage, otherIdentity]);
  const service = createPortalRequestCancellationService(config, fetcher);

  const result = await service.preview(identity);

  assert.deepEqual(result.candidates, [{ id: "qa-1", status: "Draft", subStatus: "InProgress", modelStatus: "compliance" }]);
  assert.deepEqual(result.omitted, [{ id: "qa-2", status: "Draft", subStatus: "InProgress", modelStatus: "unknown-stage" }]);
  assert.equal(JSON.stringify(result).includes(identity), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/proxy/api/Requests");
  assert.equal(calls[0].url.searchParams.get("RawIncludes"), "DataByType");
  assert.equal(calls[0].url.searchParams.get("Type"), "MultiProdNatural");
  assert.equal(calls[0].url.searchParams.get("Items"), "100");
});

test("cancel re-reads and verifies one explicitly confirmed request", async () => {
  const { fetcher, state, calls } = mockFetch([activeRequest("qa-1")]);
  const service = createPortalRequestCancellationService(config, fetcher);

  const result = await service.cancel(identity, ["qa-1"], true);

  assert.deepEqual(result, { cancelledIds: ["qa-1"], failed: null });
  assert.equal(state[0].status, "Canceled");
  assert.equal(state[0].subStatus, "cancelled");
  assert.equal((state[0].dataByType?.model?.statusTimeline?.length), 2);
  assert.equal(calls.filter((call) => call.init.method === "PUT").length, 1);
  assert.equal(calls.filter((call) => call.init.method !== "PUT").length, 3);
  const put = calls.find((call) => call.init.method === "PUT")!;
  const body = JSON.parse(String(put.init.body));
  assert.equal(body.dataByType.model.status, "cancelled");
  assert.equal(body.changeSubStatus, "cancelled");
  assert.equal(body.changeSubType, "request");
  assert.equal(JSON.stringify(put.init.headers).includes(config.authorization!), true);
});

test("cancel supports the Portal-observed simulation transition", async () => {
  const { fetcher, calls } = mockFetch([activeRequest("qa-simulation", "simulation")]);
  const result = await createPortalRequestCancellationService(config, fetcher).cancel(identity, ["qa-simulation"], true);
  assert.deepEqual(result, { cancelledIds: ["qa-simulation"], failed: null });
  const payload = JSON.parse(String(calls.find(call => call.init.method === "PUT")!.init.body));
  assert.equal(payload.dataByType.model.status, "cancelled");
  assert.equal(payload.dataByType.model.statusTimeline.at(-1).from, "simulation");
  assert.equal(payload.dataByType.model.statusTimeline.at(-1).reason, "CANCEL");
});

test("an existing business process is canceled before saving the local cancellation", async () => {
  const record = activeRequest("qa-process", "simulation");
  record.dataByType!.model!.requestCode = "QA-PROCESS";
  const { fetcher, calls } = mockFetch([record]);
  const result = await createPortalRequestCancellationService({ ...config, cancelProcess: true }, fetcher).cancel(identity, ["qa-process"], true);
  assert.equal(result.failed, null);
  const writes = calls.filter(call => call.init.method === "PUT");
  assert.deepEqual(writes.map(call => call.url.pathname), ["/api/proxy/api/Requests/ByType", "/api/proxy/api/Requests/CustomData"]);
  const payload = JSON.parse(String(writes[0].init.body));
  assert.equal(payload.id, "qa-process");
  assert.equal(payload.data.type, "AnularCaso");
  assert.equal(payload.data.data.overrideRadNumber, "QA-PROCESS");
});

test("the process cancellation is the default when the request has a requestCode, and cancelProcess:false skips it", async () => {
  const withProcess = activeRequest("qa-default", "simulation");
  withProcess.dataByType!.model!.requestCode = "QA-DEFAULT";
  const first = mockFetch([withProcess]);
  await createPortalRequestCancellationService(config, first.fetcher).cancel(identity, ["qa-default"], true);
  assert.deepEqual(first.calls.filter((call) => call.init.method === "PUT").map((call) => call.url.pathname),
    ["/api/proxy/api/Requests/ByType", "/api/proxy/api/Requests/CustomData"]);

  const optedOut = activeRequest("qa-optout", "simulation");
  optedOut.dataByType!.model!.requestCode = "QA-OPTOUT";
  const second = mockFetch([optedOut]);
  await createPortalRequestCancellationService({ ...config, cancelProcess: false }, second.fetcher).cancel(identity, ["qa-optout"], true);
  assert.deepEqual(second.calls.filter((call) => call.init.method === "PUT").map((call) => call.url.pathname),
    ["/api/proxy/api/Requests/CustomData"]);
});

test("a draft without requestCode is accepted as cancelled when the re-read shows the Portal's local cancelled state", async () => {
  const draft = activeRequest("qa-draft-only", "simulation");
  const state = structuredClone([draft]);
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (init.method === "PUT") {
      assert.ok(url.pathname.endsWith("/CustomData"), "no process call without a requestCode");
      const payload = JSON.parse(String(init.body));
      state[0].subStatus = "cancelled";
      state[0].dataByType = payload.dataByType;
      return jsonResponse({ id: payload.id }, 200);
    }
    return jsonResponse({ items: structuredClone(state), page: 1, totalPages: 1 });
  };
  const result = await createPortalRequestCancellationService(config, fetcher).cancelAll(identity, true);
  assert.deepEqual(result, { cancelledIds: ["qa-draft-only"], failed: null });
  assert.equal(state[0].status, "Draft");
});

test("cancelAll ignores locally cancelled drafts without a requestCode but still blocks on other active rows", async () => {
  const draft = activeRequest("qa-old-draft", "cancelled");
  draft.subStatus = "cancelled";
  const live = activeRequest("qa-live", "simulation");
  const { fetcher } = mockFetch([draft, live]);
  const result = await createPortalRequestCancellationService(config, fetcher).cancelAll(identity, true);
  assert.deepEqual(result, { cancelledIds: ["qa-live"], failed: null });
});

test("awaitNoActiveBizagiCases polls the Portal duplicate-case check until it reports no case, and fails closed otherwise", async () => {
  let calls = 0;
  const settling: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(init.method, "POST");
    assert.ok(url.pathname.endsWith("/ConsultarCasosBizagiSQL"));
    assert.deepEqual(JSON.parse(String(init.body)), { identificacion: "000-0000000-0" });
    calls += 1;
    if (calls === 1) return jsonResponse([{ caso: "x" }]);
    if (calls === 2) return jsonResponse({}, 406);
    return new Response(null, { status: 204 });
  };
  const ok = await createPortalRequestCancellationService(config, settling)
    .awaitNoActiveBizagiCases("000-0000000-0", { timeoutMs: 2000, pollMs: 5 });
  assert.deepEqual(ok, { clear: true, attempts: 3 });

  const stuck: typeof fetch = async () => jsonResponse([{ caso: "x" }]);
  await assert.rejects(
    createPortalRequestCancellationService(config, stuck).awaitNoActiveBizagiCases("000-0000000-0", { timeoutMs: 40, pollMs: 10 }),
    (error: unknown) => error instanceof PortalCancellationError && error.code === "bizagi_active_cases_remaining",
  );
});

test("preview lists a partially cancelled request with its requestCode so the active-case blocker can be matched", async () => {
  const partial = activeRequest("qa-partial-preview", "cancelled");
  partial.status = "InProgress";
  partial.subStatus = "cancelled";
  partial.dataByType!.model!.requestCode = "QA-PARTIAL-PREVIEW";
  const { fetcher } = mockFetch([partial]);
  const result = await createPortalRequestCancellationService(config, fetcher).preview(identity);
  assert.deepEqual(result.candidates, [{ id: "qa-partial-preview", status: "InProgress", subStatus: "cancelled", modelStatus: "cancelled", requestCode: "QA-PARTIAL-PREVIEW" }]);
});

test("cancelAll finishes a partially cancelled request with the process call only, and leaves other identities alone", async () => {
  const partial = activeRequest("qa-partial", "cancelled");
  partial.subStatus = "cancelled";
  partial.status = "InProgress";
  partial.dataByType!.model!.requestCode = "QA-PARTIAL";
  const other = activeRequest("qa-other", "simulation");
  other.dataByType!.model!.customer!.personalInfo!.identification = "11111111111";
  const { fetcher, calls, state } = mockFetch([partial, other]);
  const result = await createPortalRequestCancellationService(config, fetcher).cancelAll(identity, true);
  assert.deepEqual(result, { cancelledIds: ["qa-partial"], failed: null });
  assert.deepEqual(calls.filter((call) => call.init.method === "PUT").map((call) => call.url.pathname), ["/api/proxy/api/Requests/ByType"]);
  assert.equal(state.find((item) => item.id === "qa-partial")!.status, "Canceled");
  assert.equal(state.find((item) => item.id === "qa-other")!.status, "Draft");
});

test("waits for eventual Portal status propagation before declaring cancellation failed", async () => {
  const record = activeRequest("qa-eventual", "simulation");
  record.dataByType!.model!.requestCode = "QA-EVENTUAL";
  const state = structuredClone([record]);
  let reads = 0;
  let pendingDataByType: PortalRequestRecord["dataByType"];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (init.method === "PUT") {
      const payload = JSON.parse(String(init.body));
      if (url.pathname.endsWith("/ByType")) return jsonResponse({}, 200);
      pendingDataByType = payload.dataByType;
      return jsonResponse({ id: payload.id }, 200);
    }
    reads += 1;
    // The process endpoint has accepted the cancellation, but the outer
    // status is visible only on the next projection refresh.
    if (reads >= 4) {
      state[0].status = "Canceled";
      state[0].subStatus = "cancelled";
      state[0].dataByType = pendingDataByType;
    }
    return jsonResponse({ items: structuredClone(state), page: 1, totalPages: 1 });
  };

  const result = await createPortalRequestCancellationService(config, fetcher)
    .cancel(identity, ["qa-eventual"], true);

  assert.deepEqual(result, { cancelledIds: ["qa-eventual"], failed: null });
  assert.ok(reads >= 4);
});

test("retries transient verification reads within the bounded cancellation window", async () => {
  const record = activeRequest("qa-transient-read", "simulation");
  record.dataByType!.model!.requestCode = "QA-TRANSIENT-READ";
  const state = structuredClone([record]);
  let reads = 0;
  let pendingDataByType: PortalRequestRecord["dataByType"] | undefined;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (init.method === "PUT") {
      const payload = JSON.parse(String(init.body));
      if (url.pathname.endsWith("/ByType")) return jsonResponse({}, 200);
      state[0].subStatus = "cancelled";
      pendingDataByType = payload.dataByType;
      return jsonResponse({ id: payload.id }, 200);
    }
    reads += 1;
    if (reads === 4) return jsonResponse({ message: "temporary" }, 503);
    if (reads >= 5) {
      state[0].status = "Canceled";
      state[0].dataByType = pendingDataByType;
    }
    return jsonResponse({ items: structuredClone(state), page: 1, totalPages: 1 });
  };

  const result = await createPortalRequestCancellationService(config, fetcher)
    .cancel(identity, ["qa-transient-read"], true);

  assert.deepEqual(result, { cancelledIds: ["qa-transient-read"], failed: null });
  assert.ok(reads >= 3);
});

test("a rejected process cancellation prevents the local cancellation write", async () => {
  const record = activeRequest("qa-process", "simulation");
  record.dataByType!.model!.requestCode = "QA-PROCESS";
  const mock = mockFetch([record]);
  const writes: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    if (init?.method === "PUT") { writes.push(new URL(String(url)).pathname); return jsonResponse({}, 500); }
    return mock.fetcher(url, init);
  };
  const result = await createPortalRequestCancellationService({ ...config, cancelProcess: true }, fetcher).cancel(identity, ["qa-process"], true);
  assert.equal(result.failed?.reason, "qa_process_cancel_failed");
  assert.deepEqual(writes, ["/api/proxy/api/Requests/ByType"]);
});

test("missing confirmation rejects without sending a request", async () => {
  const { fetcher, calls } = mockFetch([activeRequest("qa-1")]);
  const service = createPortalRequestCancellationService(config, fetcher);
  await assert.rejects(service.cancel(identity, ["qa-1"], false), (error: unknown) =>
    error instanceof PortalCancellationError && error.code === "confirmation_required");
  assert.equal(calls.length, 0);
});

test("disabled or unapproved hosts fail closed before network access", async () => {
  const { fetcher, calls } = mockFetch([activeRequest("qa-1")]);
  const disabled = createPortalRequestCancellationService({ ...config, enabled: false }, fetcher);
  await assert.rejects(disabled.preview(identity), (error: unknown) =>
    error instanceof PortalCancellationError && error.code === "cancellation_disabled");
  const wrongHost = createPortalRequestCancellationService({ ...config, baseUrl: "https://public.example.test" }, fetcher);
  await assert.rejects(wrongHost.preview(identity), (error: unknown) =>
    error instanceof PortalCancellationError && error.code === "cancellation_host_rejected");
  assert.equal(calls.length, 0);
});

test("connection status is true only for an allowlisted HTTPS host with server auth", () => {
  const safe = getPortalCancellationEnvironment({
    PORTAL_COMERCIAL_QA_API_BASE_URL: "https://qa.example.test:5000",
    PORTAL_COMERCIAL_QA_API_ALLOWED_HOSTS: "qa.example.test",
    PORTAL_COMERCIAL_QA_API_AUTHORIZATION: "Bearer test-only-token",
  } as NodeJS.ProcessEnv);
  const unapproved = getPortalCancellationEnvironment({
    PORTAL_COMERCIAL_QA_API_BASE_URL: "https://public.example.test",
    PORTAL_COMERCIAL_QA_API_ALLOWED_HOSTS: "qa.example.test",
    PORTAL_COMERCIAL_QA_API_AUTHORIZATION: "Bearer test-only-token",
  } as NodeJS.ProcessEnv);
  const missingAuth = getPortalCancellationEnvironment({
    PORTAL_COMERCIAL_QA_API_BASE_URL: "https://qa.example.test:5000",
    PORTAL_COMERCIAL_QA_API_ALLOWED_HOSTS: "qa.example.test",
  } as NodeJS.ProcessEnv);
  assert.equal(safe.configured, true);
  assert.equal(unapproved.configured, false);
  assert.equal(missingAuth.configured, false);
});

test("a request that changed after preview is rejected before any PUT", async () => {
  const changed = activeRequest("qa-1");
  changed.status = "Canceled";
  changed.subStatus = "cancelled";
  const { fetcher, calls } = mockFetch([changed]);
  const service = createPortalRequestCancellationService(config, fetcher);
  await assert.rejects(service.cancel(identity, ["qa-1"], true), (error: unknown) =>
    error instanceof PortalCancellationError && error.code === "request_changed_since_preview");
  assert.equal(calls.some((call) => call.init.method === "PUT"), false);
});


test("cancelAll cancels every eligible request for the identity and preserves other identities and completed requests", async () => {
  const other = activeRequest("other");
  other.dataByType!.model!.customer!.personalInfo!.identification = "11111111111";
  const complete = activeRequest("completed");
  complete.status = "Completed";
  const { fetcher, state, calls } = mockFetch([activeRequest("one"), activeRequest("two", "simulation"), other, complete]);
  const result = await createPortalRequestCancellationService(config, fetcher).cancelAll(identity, true, "one");
  assert.deepEqual(result.cancelledIds, ["one", "two"]);
  assert.equal(result.failed, null);
  assert.equal(state.find((item) => item.id === "other")!.status, "Draft");
  assert.equal(state.find((item) => item.id === "completed")!.status, "Completed");
  assert.equal(calls.filter((call) => call.init.method === "PUT").length, 2);
});

test("cancelAll blocks unsupported active states before any write and requires confirmation", async () => {
  const { fetcher, calls } = mockFetch([activeRequest("one"), activeRequest("unsupported", "unknown")]);
  const service = createPortalRequestCancellationService(config, fetcher);
  await assert.rejects(service.cancelAll(identity, true), (error: unknown) => error instanceof PortalCancellationError && error.code === "request_state_unsupported");
  await assert.rejects(service.cancelAll(identity, false), (error: unknown) => error instanceof PortalCancellationError && error.code === "confirmation_required");
  assert.equal(calls.filter((call) => call.init.method === "PUT").length, 0);
});

test("pagination reads at most four pages concurrently while preserving all page results", async () => {
  let active = 0;
  let peak = 0;
  const fetcher: typeof fetch = async (input) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const page = Number(new URL(String(input)).searchParams.get("Page"));
    active -= 1;
    return jsonResponse({ items: [activeRequest(`page-${page}`)], totalPages: 7 });
  };
  const result = await createPortalRequestCancellationService(config, fetcher).preview(identity);
  assert.equal(result.candidates.length, 7);
  assert.equal(peak, 4);
});


test("cancelAll fails closed if another active request appears before final verification", async () => {
  const { fetcher, state } = mockFetch([activeRequest("one")]);
  let reads = 0;
  const wrapped: typeof fetch = async (input, init) => {
    if (init?.method === "GET" && ++reads === 4) state.push(activeRequest("new-active"));
    return fetcher(input, init);
  };
  const result = await createPortalRequestCancellationService(config, wrapped).cancelAll(identity, true);
  assert.deepEqual(result.cancelledIds, ["one"]);
  assert.equal(result.failed?.reason, "active_requests_remaining");
});
