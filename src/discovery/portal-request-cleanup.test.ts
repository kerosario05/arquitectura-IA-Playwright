import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelActivePortalRequestBeforeDiscovery,
  cancelDiscoveredPortalRequestBeforeReplay,
  extractPortalActiveCaseRequestCode,
  isPortalActiveCaseBlockerEvidence,
  resolvePortalRequestIdentity,
  shouldVerifyPortalSpecAfterCleanup,
} from "./portal-request-cleanup";
import type {
  PortalRequestRecord,
  SessionApiRequestContext,
  SessionApiResponse,
} from "../server/services/portal-comercial-request-cancellation";

const baseUrl = "https://srvqacgowb01.local.bsc.com:5000";
const identity = "00000000000";

test("request cleanup only couples verified replay to the enabled Portal project setting", () => {
  assert.equal(shouldVerifyPortalSpecAfterCleanup("portal-comercial", true, true), true);
  assert.equal(shouldVerifyPortalSpecAfterCleanup("portal-comercial", false, true), false);
  assert.equal(shouldVerifyPortalSpecAfterCleanup("web-test", true, true), false);
  assert.equal(shouldVerifyPortalSpecAfterCleanup("portal-comercial", true, false), false);
});

test("request identity comes from the case-bound identifier input before any fallback", () => {
  const steps = [{ action: 'Ingresar [numero_de_identificacion] en "Número de identificación"', valueKey: "numero_de_identificacion" }];
  assert.equal(resolvePortalRequestIdentity({
    steps,
    runtimeEntries: [{ key: "numero_de_identificacion", value: identity }],
    testData: {},
    fallback: "11111111111",
    hasRuntimeContext: true,
  }), identity);
});

test("ambiguous or absent case identity does not guess from another runtime value", () => {
  const steps = [{ action: 'Ingresar [numero_de_identificacion] en "Número de identificación"', valueKey: "numero_de_identificacion" }];
  assert.equal(resolvePortalRequestIdentity({
    steps,
    runtimeEntries: [
      { key: "numero_de_identificacion", value: identity },
      { key: "numero_de_identificacion", value: "11111111111" },
    ],
    testData: {},
    fallback: "22222222222",
    hasRuntimeContext: true,
  }), undefined);
  assert.equal(resolvePortalRequestIdentity({
    steps,
    runtimeEntries: [],
    testData: {},
    fallback: "22222222222",
    hasRuntimeContext: true,
  }), undefined);
});

test("recorded identity input resolves from its value binding without exposing other recorded values", () => {
  assert.equal(resolvePortalRequestIdentity({
    steps: [],
    recordedActions: [{
      humanStep: 'Ingresar [numero_de_identificacion] en "Número de identificación"',
      semanticField: "Número de identificación",
      valueKey: "numero_de_identificacion",
      value: identity,
    }],
    runtimeEntries: [],
    testData: {},
    hasRuntimeContext: true,
  }), identity);
});

test("active-case blocker evidence requires the creation route, an active-case count, and the expected code", () => {
  const snapshot = {
    url: `${baseUrl}/requests/create/multiproduct`,
    elements: [
      { text: "Casos activos." },
      { text: "Este cliente tiene otros casos activos (1): QA-REQUEST-42" },
    ],
  };
  assert.equal(isPortalActiveCaseBlockerEvidence(snapshot, "QA-REQUEST-42"), true);
  assert.equal(isPortalActiveCaseBlockerEvidence(snapshot, "QA-REQUEST-43"), false);
  assert.equal(isPortalActiveCaseBlockerEvidence({ ...snapshot, url: `${baseUrl}/requests` }, "QA-REQUEST-42"), false);
  assert.equal(isPortalActiveCaseBlockerEvidence({
    ...snapshot,
    elements: [{ text: "Casos activos. Este cliente tiene otros casos activos (2): QA-REQUEST-42" }],
  }, "QA-REQUEST-42"), true);
});

test("active-case cleanup extracts only one visible request code from the blocking modal", () => {
  const snapshot = {
    url: `${baseUrl}/requests/create/multiproduct`,
    elements: [
      { text: "Casos activos." },
      { text: "Este cliente tiene otros casos activos (1):" },
      { text: "QA-REQUEST-42" },
    ],
  };
  assert.equal(extractPortalActiveCaseRequestCode(snapshot), "QA-REQUEST-42");
  assert.equal(extractPortalActiveCaseRequestCode({
    ...snapshot,
    elements: [
      { text: "Casos activos. Este cliente tiene otros casos activos (2): QA-REQUEST-42 QA-REQUEST-43" },
    ],
  }), "QA-REQUEST-42");
  assert.equal(extractPortalActiveCaseRequestCode({
    ...snapshot,
    url: `${baseUrl}/requests`,
  }), undefined);
});

function requestRecord(id: string, identification = identity, requestCode?: string): PortalRequestRecord {
  return {
    id,
    type: "MultiProdNatural",
    status: "Draft",
    subStatus: "InProgress",
    dataByType: {
      model: {
        status: "compliance",
        ...(requestCode ? { requestCode } : {}),
        statusTimeline: [{ from: "simulation", to: "compliance" }],
        customer: { personalInfo: { identification } },
      },
    },
  };
}

function makeResponse(body: unknown, status = 200): SessionApiResponse {
  const encoded = Buffer.from(JSON.stringify(body));
  return {
    status: () => status,
    headers: () => ({ "content-type": "application/json" }),
    body: async () => encoded,
  };
}

function mockContext(initial: PortalRequestRecord[]) {
  const records = structuredClone(initial);
  const calls: Array<{ url: URL; options: Record<string, unknown> }> = [];
  const requestContext: SessionApiRequestContext = {
    async fetch(urlInput, options) {
      const url = new URL(urlInput);
      calls.push({ url, options });
      if (options.method === "POST" && url.pathname.endsWith("/ConsultarCasosBizagiSQL")) {
        // The Portal's duplicate-case check reports no existing case once the cancellation settled.
        return { status: () => 204, headers: () => ({}), body: async () => Buffer.alloc(0) };
      }
      if (options.method === "PUT") {
        const payload = JSON.parse(String(options.data));
        const row = records.find((record) => String(record.id) === String(payload.id));
        if (row) {
          row.status = "Canceled";
          row.subStatus = "cancelled";
          row.dataByType = payload.dataByType;
        }
        return makeResponse({ id: payload.id });
      }
      return makeResponse({ items: structuredClone(records), totalPages: 1 });
    },
  };
  return { requestContext, records, calls };
}

test("cleanup cancels only the request reached by a successful same-origin Discovery session", async () => {
  const { requestContext, records, calls } = mockContext([requestRecord("request-42")]);
  const result = await cancelDiscoveredPortalRequestBeforeReplay({
    appSlug: "portal-comercial",
    enabled: true,
    discoveryPassed: true,
    baseUrl,
    beforeUrl: `${baseUrl}/requests/create/multiproduct`,
    afterUrl: `${baseUrl}/requests/request-42/edit`,
    identity,
    requestContext,
  });

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(records[0].status, "Canceled");
  assert.equal(calls.filter((call) => call.options.method === "PUT").length, 1);
  assert.equal(calls.every((call) => call.url.origin === new URL(baseUrl).origin), true);
  assert.equal(calls.some((call) => {
    const headers = call.options.headers as Record<string, string>;
    return Object.keys(headers).some((key) => /^(authorization|cookie)$/i.test(key));
  }), false);
});

test("cleanup is a no-op unless Portal cancellation is enabled and Discovery passed", async () => {
  let calls = 0;
  const requestContext: SessionApiRequestContext = {
    async fetch() { calls += 1; return makeResponse({ items: [], totalPages: 1 }); },
  };

  const disabled = await cancelDiscoveredPortalRequestBeforeReplay({
    appSlug: "portal-comercial", enabled: false, discoveryPassed: true, baseUrl,
    beforeUrl: `${baseUrl}/requests/create/multiproduct`,
    afterUrl: `${baseUrl}/requests/request-42/edit`, identity, requestContext,
  });
  const notPassed = await cancelDiscoveredPortalRequestBeforeReplay({
    appSlug: "portal-comercial", enabled: true, discoveryPassed: false, baseUrl,
    beforeUrl: `${baseUrl}/requests/create/multiproduct`,
    afterUrl: `${baseUrl}/requests/request-42/edit`, identity, requestContext,
  });
  const otherProject = await cancelDiscoveredPortalRequestBeforeReplay({
    appSlug: "web-test", enabled: true, discoveryPassed: true, baseUrl,
    beforeUrl: `${baseUrl}/requests/create/multiproduct`,
    afterUrl: `${baseUrl}/requests/request-42/edit`, identity, requestContext,
  });

  assert.deepEqual(disabled, { status: "skipped", reason: "project_disabled" });
  assert.deepEqual(notPassed, { status: "skipped", reason: "discovery_not_passed" });
  assert.deepEqual(otherProject, { status: "skipped", reason: "project_disabled" });
  assert.equal(calls, 0);
});

test("cleanup blocks without identity, a new request route, or the authenticated session", async () => {
  const { requestContext } = mockContext([requestRecord("request-42")]);
  const missingIdentity = await cancelDiscoveredPortalRequestBeforeReplay({
    appSlug: "portal-comercial", enabled: true, discoveryPassed: true, baseUrl,
    beforeUrl: `${baseUrl}/requests/create/multiproduct`,
    afterUrl: `${baseUrl}/requests/request-42/edit`,
  });
  const noNewRequest = await cancelDiscoveredPortalRequestBeforeReplay({
    appSlug: "portal-comercial", enabled: true, discoveryPassed: true, baseUrl,
    beforeUrl: `${baseUrl}/requests/request-42/edit`,
    afterUrl: `${baseUrl}/requests/request-42/edit`, identity, requestContext,
  });
  const wrongOrigin = await cancelDiscoveredPortalRequestBeforeReplay({
    appSlug: "portal-comercial", enabled: true, discoveryPassed: true, baseUrl,
    beforeUrl: `${baseUrl}/requests/create/multiproduct`,
    afterUrl: "https://other.example.test/requests/request-42/edit", identity, requestContext,
  });
  const missingSession = await cancelDiscoveredPortalRequestBeforeReplay({
    appSlug: "portal-comercial", enabled: true, discoveryPassed: true, baseUrl,
    beforeUrl: `${baseUrl}/requests/create/multiproduct`,
    afterUrl: `${baseUrl}/requests/request-42/edit`, identity,
  });

  assert.deepEqual(missingIdentity, { status: "blocked", reason: "identity_missing" });
  assert.deepEqual(noNewRequest, { status: "blocked", reason: "created_request_route_unresolved" });
  assert.deepEqual(wrongOrigin, { status: "blocked", reason: "created_request_route_unresolved" });
  assert.deepEqual(missingSession, { status: "blocked", reason: "authenticated_session_missing" });
});

test("cleanup fails closed when the exact routed request belongs to another identity", async () => {
  const { requestContext, records, calls } = mockContext([requestRecord("request-42", "11111111111")]);
  const result = await cancelDiscoveredPortalRequestBeforeReplay({
    appSlug: "portal-comercial", enabled: true, discoveryPassed: true, baseUrl,
    beforeUrl: `${baseUrl}/requests/create/multiproduct`,
    afterUrl: `${baseUrl}/requests/request-42/edit`, identity, requestContext,
  });

  assert.deepEqual(result, { status: "blocked", reason: "request_changed_since_preview" });
  assert.equal(records[0].status, "Draft");
  assert.equal(calls.some((call) => call.options.method === "PUT"), false);
});

test("one-time pre-discovery cleanup cancels only the uniquely matched visible QA request", async () => {
  const { requestContext, records, calls } = mockContext([
    requestRecord("request-42", identity, "QA-REQUEST-42"),
    requestRecord("request-43", "11111111111", "QA-REQUEST-43"),
  ]);
  const result = await cancelActivePortalRequestBeforeDiscovery({
    appSlug: "portal-comercial",
    enabled: true,
    activeCaseModalVerified: true,
    requestCode: "QA-REQUEST-42",
    baseUrl,
    identity,
    requestContext,
  });

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(records[0].status, "Canceled");
  assert.equal(records[1].status, "Draft");
  assert.equal(calls.filter((call) => call.options.method === "PUT").length, 2);
});

test("one-time pre-discovery cleanup fails closed unless the visible code matches one eligible request", async () => {
  const { requestContext, records, calls } = mockContext([
    requestRecord("request-42", identity, "QA-REQUEST-42"),
    requestRecord("request-43", identity, "QA-REQUEST-42"),
  ]);
  const blocked = await cancelActivePortalRequestBeforeDiscovery({
    appSlug: "portal-comercial", enabled: true, activeCaseModalVerified: true,
    requestCode: "QA-REQUEST-42", baseUrl, identity, requestContext,
  });
  const noModal = await cancelActivePortalRequestBeforeDiscovery({
    appSlug: "portal-comercial", enabled: true, activeCaseModalVerified: false,
    requestCode: "QA-REQUEST-42", baseUrl, identity, requestContext,
  });
  const wrongProject = await cancelActivePortalRequestBeforeDiscovery({
    appSlug: "web-test", enabled: true, activeCaseModalVerified: true,
    requestCode: "QA-REQUEST-42", baseUrl, identity, requestContext,
  });

  assert.deepEqual(blocked, { status: "blocked", reason: "request_code_not_unique_or_eligible" });
  assert.deepEqual(noModal, { status: "blocked", reason: "active_case_modal_not_verified" });
  assert.deepEqual(wrongProject, { status: "skipped", reason: "project_disabled" });
  assert.equal(records.every((record) => record.status === "Draft"), true);
  assert.equal(calls.some((call) => call.options.method === "PUT"), false);
});


test("automatic cleanup cancels all matching active requests while retaining the observed route anchor", async () => {
  const { requestContext, records } = mockContext([requestRecord("request-42"), requestRecord("request-43"), requestRecord("foreign", "11111111111")]);
  const result = await cancelDiscoveredPortalRequestBeforeReplay({
    appSlug: "portal-comercial", enabled: true, discoveryPassed: true, baseUrl,
    beforeUrl: `${baseUrl}/requests/create/multiproduct`, afterUrl: `${baseUrl}/requests/request-42/edit`, identity, requestContext,
  });
  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(records[0].status, "Canceled");
  assert.equal(records[1].status, "Canceled");
  assert.equal(records[2].status, "Draft");
});

test("pre-discovery cleanup uses the Portal case check as blocker evidence when no modal is shown", async () => {
  const base = mockContext([
    requestRecord("request-42", identity, "QA-REQUEST-42"),
    requestRecord("request-43", "11111111111", "QA-REQUEST-43"),
  ]);
  let reported = ["QA-REQUEST-42"];
  const requestContext: SessionApiRequestContext = {
    async fetch(urlInput, options) {
      if (options.method === "POST" && new URL(urlInput).pathname.endsWith("/ConsultarCasosBizagiSQL")) {
        base.calls.push({ url: new URL(urlInput), options });
        return reported.length === 0
          ? { status: () => 204, headers: () => ({}), body: async () => Buffer.alloc(0) }
          : makeResponse({ items: reported });
      }
      const response = await base.requestContext.fetch(urlInput, options);
      if (options.method === "PUT") reported = []; // the process settles once cancelled
      return response;
    },
  };
  const result = await cancelActivePortalRequestBeforeDiscovery({
    appSlug: "portal-comercial", enabled: true, activeCaseModalVerified: false, blockedAtCreationRoute: true,
    baseUrl, identity, requestContext,
  });
  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(base.records[0].status, "Canceled");
  assert.equal(base.records[1].status, "Draft", "another identity is never touched");

  // The case check naming a code that matches no eligible request of the identity fails closed.
  reported = ["UNRELATED-1"];
  const unmatched = await cancelActivePortalRequestBeforeDiscovery({
    appSlug: "portal-comercial", enabled: true, activeCaseModalVerified: false, blockedAtCreationRoute: true,
    baseUrl, identity, requestContext,
  });
  assert.deepEqual(unmatched, { status: "blocked", reason: "request_code_not_unique_or_eligible" });

  // No modal and not stopped at the creation route: still no evidence.
  const noEvidence = await cancelActivePortalRequestBeforeDiscovery({
    appSlug: "portal-comercial", enabled: true, activeCaseModalVerified: false,
    baseUrl, identity, requestContext,
  });
  assert.deepEqual(noEvidence, { status: "blocked", reason: "active_case_modal_not_verified" });
});
