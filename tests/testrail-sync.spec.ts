import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import * as testrailPublisher from "../src/server/services/testrail-case-publisher";
import { reportScenarioPreviewResultsToTestRail } from "../src/server/services/testrail-run-reporter";
import { TestRailClient } from "../src/clients/testrail.client";
import type { TestRailClient as TestRailClientType } from "../src/clients/testrail.client";
import type { McpScenario } from "../src/scenarios/scenario-types";

const STORE_PATH = path.resolve(process.cwd(), ".artifacts", "testrail", "scenario-case-mappings.json");

function makeScenario(overrides: Partial<McpScenario> = {}): McpScenario {
  return {
    sourceIssueKey: overrides.sourceIssueKey ?? "JIRA-1",
    title: overrides.title ?? "Escenario",
    steps: overrides.steps ?? ["Paso 1", "Paso 2"],
    preconditions: overrides.preconditions ?? ["Usuario autenticado"],
    expectedResult: overrides.expectedResult !== undefined ? overrides.expectedResult : "Resultado esperado",
    caseOracle: overrides.caseOracle,
    type: overrides.type ?? "functional",
    database: overrides.database ?? "",
    isConverted: overrides.isConverted ?? 0,
    automationType: overrides.automationType ?? "e2e",
    setupStrategy: overrides.setupStrategy ?? "default",
    appSlug: overrides.appSlug ?? "kiosko",
    targetAppSlug: overrides.targetAppSlug,
    targetAppName: overrides.targetAppName,
    routeProfile: overrides.routeProfile ?? "default",
    dataRequirements: overrides.dataRequirements ?? "",
    nonExecutableCriteria: overrides.nonExecutableCriteria ?? "",
    mcpExecutable: overrides.mcpExecutable ?? true,
    caseId: overrides.caseId,
    validation: overrides.validation ?? { valid: true, errors: [], warnings: [] },
  };
}

function makeClient(): Pick<TestRailClientType, "getCasesByRefs" | "addCase" | "updateCase" | "addRun" | "addResultsForCases"> {
  const existingCases = new Map<string, { id: number; section_id?: number }>();
  const captured = {
    addCaseInputs: [] as Array<Record<string, unknown>>,
    updateCaseInputs: [] as Array<Record<string, unknown>>,
  };
  return {
    async getCasesByRefs(_projectId: string, refs: string) {
      void refs;
      return [];
    },
    async addCase(_sectionId: string, input: { title: string; customExpected?: string; customCaseOracle?: string; customFields?: Record<string, unknown> }) {
      captured.addCaseInputs.push(input as Record<string, unknown>);
      const nextId = existingCases.size + 500;
      existingCases.set(String(nextId), { id: nextId, section_id: 1731 });
      return { id: nextId, title: input.title };
    },
    async updateCase(caseId: number, input: { title?: string; customExpected?: string; customCaseOracle?: string; customFields?: Record<string, unknown> }) {
      captured.updateCaseInputs.push(input as Record<string, unknown>);
      return { id: caseId, title: input.title ?? `Case ${caseId}` };
    },
    async addRun(input: { name: string }) {
      return { id: 901, name: input.name, url: "https://testrail.local/index.php?/runs/view/901" };
    },
    async addResultsForCases(_runId: number, results: Array<{ caseId: number }>) {
      return { added: results.length };
    },
    __captured: captured,
  } as any;
}

test.afterEach(() => {
  if (fs.existsSync(STORE_PATH)) {
    fs.rmSync(STORE_PATH, { force: true });
  }
});

test("sanitizeTestRailRef elimina metadata técnica y deja solo token seguro", () => {
  expect(testrailPublisher.sanitizeTestRailRef("AA-81")).toBe("AA-81");
  expect(testrailPublisher.sanitizeTestRailRef("scenarioId:AA-81")).toBe("SCENARIOIDAA-81");
  expect(testrailPublisher.sanitizeTestRailRef("kiosko|kiosko|Detalle_KIOSKO|56")).toBe("KIOSKOKIOSKODETALLE_KIOSKO56");
});

test("buildSafeRefsFilter deduplica y no incluye cacheKey ni pipes", () => {
  const refs = testrailPublisher.buildSafeRefsFilter({
    refs: ["AA-81", "AA-81", "scenarioId:AA-81", "cacheKey:kiosko|kiosko"],
  });

  expect(refs).toBeDefined();
  expect(refs).toContain("AA-81");
  expect(refs?.includes("|")).toBe(false);
  expect(refs?.includes("cacheKey")).toBe(false);
});

test("publishScenariosToTestRail crea casos en la seccion seleccionada y persiste mapping", async () => {
  const client = makeClient();
  const result = await testrailPublisher.publishScenariosToTestRail(client as any, {
    projectId: 56,
    suiteId: 1731,
    sectionId: 4903,
    appSlug: "kiosko",
    sprintId: 7,
    storyKey: "AA-81",
    cacheKey: "cache-a",
    scenarios: [makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 1" })],
  });

  expect(result.caseIds.length).toBe(1);
  expect(result.mappings[0].sectionId).toBe(4903);
  expect(result.mappings[0].projectId).toBe(56);
  expect(testrailPublisher.readPersistedScenarioMappings().some((m) => m.testRailCaseId === result.caseIds[0])).toBe(true);
  expect(String((client as any).__captured.addCaseInputs[0].refs)).toBe("AA-81-PREVIEW-001");
});

test("buildSafeTestRailRefs devuelve un ref simple y unico por escenario", () => {
  const scenario = makeScenario({ sourceIssueKey: "AA-81", title: "Escenario" });
  const refs = testrailPublisher.buildSafeTestRailRefs(scenario, "PREVIEW-001", "AA-81");

  expect(refs).toBe("AA-81-PREVIEW-001");
  expect(refs.includes(",")).toBe(false);
  expect(refs.includes("|")).toBe(false);
  expect(refs.includes("cacheKey")).toBe(false);
});

test("publishScenariosToTestRail incluye custom_expected y custom_case_oracle en addCase", async () => {
  const client = makeClient() as any;
  await testrailPublisher.publishScenariosToTestRail(client, {
    projectId: 56,
    suiteId: 1731,
    sectionId: 4903,
    appSlug: "kiosko",
    storyKey: "AA-81",
    cacheKey: "cache-custom-fields",
    scenarios: [
      makeScenario({
        sourceIssueKey: "JIRA-200",
        title: "Escenario oracle",
        expectedResult: "Debe mostrarse el resultado esperado",
        caseOracle: "Oracle funcional del caso",
      }),
    ],
  });

  const capturedInput = (client as any).__captured.addCaseInputs[0];
  expect(capturedInput.customExpected).toBeDefined();
  expect(String(capturedInput.customExpected)).toContain("Debe mostrarse");
  expect(capturedInput.customCaseOracle).toBe("Oracle funcional del caso");
  expect(String(capturedInput.refs)).toBe("AA-81-PREVIEW-001");
});

test("publishScenariosToTestRail usa fallback para custom_case_oracle cuando no existe en el escenario", async () => {
  const client = makeClient() as any;
  await testrailPublisher.publishScenariosToTestRail(client, {
    projectId: 56,
    suiteId: 1731,
    sectionId: 4903,
    appSlug: "kiosko",
    storyKey: "AA-81",
    cacheKey: "cache-oracle-fallback",
    scenarios: [
      makeScenario({
        sourceIssueKey: "JIRA-201",
        title: "Escenario sin oracle",
        expectedResult: "",
        steps: ["Validar que se muestre el resultado correcto", "Continuar"],
      }),
    ],
  });

  const capturedInput = (client as any).__captured.addCaseInputs[0];
  expect(String(capturedInput.customCaseOracle)).not.toBe("");
  expect(String(capturedInput.customCaseOracle)).toContain("Resultado esperado");
  expect(String(capturedInput.refs)).toBe("AA-81-PREVIEW-001");
});

test("publishScenariosToTestRail incluye custom fields configurados por env", async () => {
  const previous = process.env.TESTRAIL_REQUIRED_CASE_FIELDS_JSON;
  process.env.TESTRAIL_REQUIRED_CASE_FIELDS_JSON = JSON.stringify({
    custom_case_oracle: "Automatizado: validación funcional según pasos del escenario.",
    custom_environment_tag: "QA",
  });

  try {
    const client = makeClient() as any;
  await testrailPublisher.publishScenariosToTestRail(client, {
    projectId: 56,
    suiteId: 1731,
    sectionId: 4903,
    appSlug: "kiosko",
    storyKey: "AA-81",
    cacheKey: "cache-env-fields",
    scenarios: [makeScenario({ sourceIssueKey: "JIRA-202", title: "Escenario env" })],
  });

    const capturedInput = (client as any).__captured.addCaseInputs[0];
    expect((capturedInput as any).customFields?.custom_environment_tag).toBe("QA");
    expect((capturedInput as any).customCaseOracle).toBeDefined();
    expect(String(capturedInput.refs)).toBe("AA-81-PREVIEW-001");
  } finally {
    if (previous === undefined) {
      delete process.env.TESTRAIL_REQUIRED_CASE_FIELDS_JSON;
    } else {
      process.env.TESTRAIL_REQUIRED_CASE_FIELDS_JSON = previous;
    }
  }
});

test("publishScenariosToTestRail crea un caseId unico por escenario distinto", async () => {
  const client = makeClient();
  const result = await testrailPublisher.publishScenariosToTestRail(client as any, {
    projectId: 56,
    suiteId: 1731,
    sectionId: 4903,
    appSlug: "kiosko",
    storyKey: "AA-81",
    cacheKey: "cache-b",
    scenarios: [
      makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 1" }),
      makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 2" }),
      makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 3" }),
      makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 4" }),
      makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 5" }),
      makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 6" }),
    ],
  });

  expect(result.caseIds.length).toBe(6);
  expect(new Set(result.caseIds).size).toBe(6);
  expect(new Set((client as any).__captured.addCaseInputs.map((input: any) => input.refs)).size).toBe(6);
});

test("publishScenariosToTestRail no duplica casos si ya existe mapping", async () => {
  const client = makeClient();
  await testrailPublisher.publishScenariosToTestRail(client as any, {
    projectId: 56,
    suiteId: 1731,
    sectionId: 4903,
    appSlug: "kiosko",
    storyKey: "AA-81",
    cacheKey: "cache-a",
    scenarios: [makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 1" })],
  });

  const result = await testrailPublisher.publishScenariosToTestRail(client as any, {
    projectId: 56,
    suiteId: 1731,
    sectionId: 4903,
    appSlug: "kiosko",
    cacheKey: "cache-a",
    scenarios: [makeScenario({ sourceIssueKey: "JIRA-123", title: "Escenario 1 actualizado" })],
  });

  expect(result.updated + result.reused).toBeGreaterThan(0);
  expect(String((client as any).__captured.updateCaseInputs[0].refs)).toBe("AA-81-PREVIEW-001");
});

test("reportScenarioPreviewResultsToTestRail reporta passed/failed y crea pending retry si falla", async () => {
  const client = {
    async addResultsForCases() {
      throw new Error("429 Rate Limit");
    },
  } as Partial<TestRailClient> as TestRailClient;

  const result = await reportScenarioPreviewResultsToTestRail(client, {
    runId: 901,
    projectId: 56,
    suiteId: 1731,
    sectionId: 4903,
    runName: "QA Lab",
    artifactDir: path.resolve(process.cwd(), ".artifacts", "tmp", `testrail-report-${Date.now()}`),
    results: [
      {
        scenarioId: "JIRA-123",
        testRailCaseId: 501,
        status: "passed",
      },
      {
        scenarioId: "JIRA-124",
        testRailCaseId: 502,
        status: "failed",
        failureReason: "No se encontró botón",
      },
    ],
    mappings: [
      { scenarioId: "JIRA-123", scenarioTitle: "Escenario 1", cacheKey: "cache-a", testRailCaseId: 501, sectionId: 4903, projectId: 56, updatedAt: new Date().toISOString(), source: "reused" },
      { scenarioId: "JIRA-124", scenarioTitle: "Escenario 2", cacheKey: "cache-a", testRailCaseId: 502, sectionId: 4903, projectId: 56, updatedAt: new Date().toISOString(), source: "reused" },
    ],
  });

  expect(result.added).toBe(0);
  expect(result.pendingReportPath).toContain("pending-testrail-report.json");
});

test("getCasesByRefs encoda query params de TestRail", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.getCasesByRefs("56", "AA-81,AA-82", "1731", "4903");
    expect(capturedUrl).toContain("refs_filter=AA-81%2CAA-82");
    expect(capturedUrl).not.toContain("refs_filter=AA-81,AA-82");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── RESERVED_TESTRAIL_FIELDS guard tests ──

test("addCase: customFields.refs no sobrescribe body.refs", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 999, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.addCase("4903", {
      title: "Test case",
      refs: "AA-81-PREVIEW-001",
      // Simulate a customFields bag that tries to overwrite refs
      customFields: { refs: "SHOULD-NOT-WIN", custom_refs: "SHOULD-NOT-WIN" },
    } as any);

    // body.refs must keep the explicitly set value
    expect(capturedBody.refs).toBe("AA-81-PREVIEW-001");
    expect(capturedBody.custom_refs).toBe("AA-81-PREVIEW-001");
    expect(capturedBody.refs).not.toBe("SHOULD-NOT-WIN");
    expect(capturedBody.custom_refs).not.toBe("SHOULD-NOT-WIN");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateCase: customFields.custom_refs no sobrescribe body.custom_refs", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 501, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.updateCase(501, {
      title: "Updated case",
      refs: "AA-81-PREVIEW-001",
      // Simulate a customFields bag that tries to overwrite custom_refs
      customFields: { custom_refs: "OVERWRITE-ATTEMPT", refs: "OVERWRITE-ATTEMPT" },
    } as any);

    expect(capturedBody.refs).toBe("AA-81-PREVIEW-001");
    expect(capturedBody.custom_refs).toBe("AA-81-PREVIEW-001");
    expect(capturedBody.refs).not.toBe("OVERWRITE-ATTEMPT");
    expect(capturedBody.custom_refs).not.toBe("OVERWRITE-ATTEMPT");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addCase: final body contiene refs y custom_refs no vacíos", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 998, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.addCase("4903", {
      title: "Test case refs integrity",
      refs: "AA-81-PREVIEW-007",
      customFields: { custom_environment_tag: "QA" }, // Non-reserved field – must pass through
    } as any);

    // Core fields must be non-empty strings
    expect(typeof capturedBody.refs).toBe("string");
    expect((capturedBody.refs as string).trim().length).toBeGreaterThan(0);
    expect(typeof capturedBody.custom_refs).toBe("string");
    expect((capturedBody.custom_refs as string).trim().length).toBeGreaterThan(0);
    // Non-reserved customField must survive
    expect(capturedBody.custom_environment_tag).toBe("QA");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateCase: final body contiene refs y custom_refs no vacíos", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 500, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.updateCase(500, {
      title: "Updated case refs integrity",
      refs: "AA-81-PREVIEW-007",
      customFields: { custom_priority: 2 }, // Non-reserved field – must pass through
    } as any);

    expect(typeof capturedBody.refs).toBe("string");
    expect((capturedBody.refs as string).trim().length).toBeGreaterThan(0);
    expect(typeof capturedBody.custom_refs).toBe("string");
    expect((capturedBody.custom_refs as string).trim().length).toBeGreaterThan(0);
    // Non-reserved customField must survive
    expect(capturedBody.custom_priority).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── custom_preconds mandatory field tests ──

test("addCase: siempre envía custom_preconds no vacío", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 600, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.addCase("4903", {
      title: "Test preconds",
      refs: "AA-81-PREVIEW-100",
    } as any);

    expect(typeof capturedBody.custom_preconds).toBe("string");
    expect((capturedBody.custom_preconds as string).trim().length).toBeGreaterThan(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addCase: custom_preconds con preconditions explícitas las respeta", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 601, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.addCase("4903", {
      title: "Test preconds explicit",
      refs: "AA-81-PREVIEW-101",
      preconditions: "Usuario autenticado.",
    } as any);

    expect(capturedBody.custom_preconds).toBe("Usuario autenticado.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addCase: custom_preconds usa fallback cuando no hay preconditions", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 602, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.addCase("4903", {
      title: "Test preconds fallback",
      refs: "AA-81-PREVIEW-102",
      preconditions: undefined,
    } as any);

    expect(typeof capturedBody.custom_preconds).toBe("string");
    expect((capturedBody.custom_preconds as string).trim().length).toBeGreaterThan(0);
    expect((capturedBody.custom_preconds as string)).toContain("Precondiciones:");
    expect((capturedBody.custom_preconds as string)).toContain("App disponible");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addCase: customFields.custom_preconds no sobrescribe body.custom_preconds", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 603, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.addCase("4903", {
      title: "Test preconds reserved",
      refs: "AA-81-PREVIEW-103",
      preconditions: "Precondición core.",
      customFields: { custom_preconds: "NO-DEBE-APARECER" },
    } as any);

    expect(capturedBody.custom_preconds).toBe("Precondición core.");
    expect(capturedBody.custom_preconds).not.toBe("NO-DEBE-APARECER");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateCase: siempre envía custom_preconds no vacío", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 604, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.updateCase(604, {
      title: "Updated preconds",
      refs: "AA-81-PREVIEW-104",
    } as any);

    expect(typeof capturedBody.custom_preconds).toBe("string");
    expect((capturedBody.custom_preconds as string).trim().length).toBeGreaterThan(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateCase: custom_preconds con preconditions explícitas las respeta", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 605, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.updateCase(605, {
      title: "Updated preconds explicit",
      refs: "AA-81-PREVIEW-105",
      preconditions: "Usuario autenticado.",
    } as any);

    expect(capturedBody.custom_preconds).toBe("Usuario autenticado.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateCase: custom_preconds usa fallback cuando no hay preconditions", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 606, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.updateCase(606, {
      title: "Updated preconds fallback",
      refs: "AA-81-PREVIEW-106",
      preconditions: undefined,
    } as any);

    expect(typeof capturedBody.custom_preconds).toBe("string");
    expect((capturedBody.custom_preconds as string).trim().length).toBeGreaterThan(0);
    expect((capturedBody.custom_preconds as string)).toContain("Precondiciones:");
    expect((capturedBody.custom_preconds as string)).toContain("App disponible");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateCase: customFields.custom_preconds no sobrescribe body.custom_preconds", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 607, title: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new TestRailClient({ url: "https://testrail.local", email: "user@example.com", apiKey: "secret" });
    await client.updateCase(607, {
      title: "Updated preconds reserved",
      refs: "AA-81-PREVIEW-107",
      preconditions: "Precondición core update.",
      customFields: { custom_preconds: "NO-DEBE-APARECER" },
    } as any);

    expect(capturedBody.custom_preconds).toBe("Precondición core update.");
    expect(capturedBody.custom_preconds).not.toBe("NO-DEBE-APARECER");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Refs 500 recovery tests ──

function makeRefs500RecoveryClient(existingInSection: Array<{ id: number; title: string; section_id: number; custom_scenario_id?: string }>, returnOnFirstGetCases: boolean = false): any {
  const captured = {
    addCaseInputs: [] as Array<Record<string, unknown>>,
    updateCaseInputs: [] as Array<Record<string, unknown>>,
    getCasesCalls: 0,
  };
  let getCasesReturned = false;
  return {
    async getCasesByRefs(_projectId: string, _refs: string) {
      return [];
    },
    async getCases(_projectId: string, _suiteId: string | undefined, _sectionId: string | undefined) {
      captured.getCasesCalls++;
      // First call(s) during reuse search return empty so addCase is attempted
      if (!returnOnFirstGetCases && !getCasesReturned) {
        getCasesReturned = true;
        return [];
      }
      getCasesReturned = true;
      return existingInSection.map((c) => ({
        id: c.id,
        title: c.title,
        section_id: c.section_id,
        custom_scenario_id: c.custom_scenario_id,
      }));
    },
    async addCase(_sectionId: string, input: Record<string, unknown>) {
      captured.addCaseInputs.push(input);
      throw new Error("TestRail API error (HTTP 500) at add_case/4903: Undefined array key refs");
    },
    async updateCase(caseId: number, input: Record<string, unknown>) {
      captured.updateCaseInputs.push(input);
      return { id: caseId, title: input.title ?? `Case ${caseId}` };
    },
    async addRun(input: { name: string }) {
      return { id: 901, name: input.name, url: "https://testrail.local/index.php?/runs/view/901" };
    },
    async addResultsForCases(_runId: number, _results: Array<{ caseId: number }>) {
      return { added: 0 };
    },
    __captured: captured,
  };
}

test("publishScenariosToTestRail recupera caso creado aunque addCase devuelva 500 por refs", async () => {
  const client = makeRefs500RecoveryClient([
    { id: 3801, title: "Escenario recuperado", section_id: 4903, custom_scenario_id: "PREVIEW-001" },
  ]);

  const result = await testrailPublisher.publishScenariosToTestRail(client, {
    projectId: 56,
    suiteId: 1731,
    sectionId: 4903,
    appSlug: "kiosko",
    storyKey: "AA-81",
    cacheKey: "cache-recovery",
    scenarios: [
      makeScenario({
        sourceIssueKey: "JIRA-500",
        title: "Escenario recuperado",
      }),
    ],
  });

  expect(result.caseIds).toContain(3801);
  expect(result.created).toBe(1);
  expect(result.mappings[0].testRailCaseId).toBe(3801);
  expect(result.mappings[0].source).toBe("recovered");
});

test("publishScenariosToTestRail falla si addCase devuelve 500 refs y no se encuentra el caso", async () => {
  const client = makeRefs500RecoveryClient([]); // no existing cases in section

  await expect(
    testrailPublisher.publishScenariosToTestRail(client, {
      projectId: 56,
      suiteId: 1731,
      sectionId: 4903,
      appSlug: "kiosko",
      storyKey: "AA-81",
      cacheKey: "cache-recovery-fail",
      scenarios: [
        makeScenario({
          sourceIssueKey: "JIRA-501",
          title: "Escenario perdido",
        }),
      ],
    })
  ).rejects.toThrow("Undefined array key refs");
});

test("publishScenariosToTestRail no recupera si error no es refs 500", async () => {
  const client = makeRefs500RecoveryClient([
    { id: 3802, title: "Escenario otro error", section_id: 4903 },
  ]);

  // Override addCase to throw a different error
  client.addCase = async () => {
    throw new Error("TestRail API error (HTTP 400) at add_case/4903: custom_sprint_id es obligatorio");
  };

  await expect(
    testrailPublisher.publishScenariosToTestRail(client, {
      projectId: 56,
      suiteId: 1731,
      sectionId: 4903,
      appSlug: "kiosko",
      storyKey: "AA-81",
      cacheKey: "cache-recovery-other-error",
      scenarios: [
        makeScenario({
          sourceIssueKey: "JIRA-502",
          title: "Escenario otro error",
        }),
      ],
    })
  ).rejects.toThrow("custom_sprint_id");
});

test("publishScenariosToTestRail no duplica casos en retry tras refs 500", async () => {
  const initialCases = [
    { id: 3801, title: "Escenario sin duplicado", section_id: 4903 },
  ];
  const client = makeRefs500RecoveryClient(initialCases);

  // First call — addCase fails with 500 refs, recovery finds the case
  const result1 = await testrailPublisher.publishScenariosToTestRail(client, {
    projectId: 56,
    suiteId: 1731,
    sectionId: 4903,
    appSlug: "kiosko",
    storyKey: "AA-81",
    cacheKey: "cache-nodup",
    scenarios: [
      makeScenario({
        sourceIssueKey: "JIRA-503",
        title: "Escenario sin duplicado",
      }),
    ],
  });

  expect(result1.caseIds).toContain(3801);
  expect(result1.created).toBe(1);
  expect(client.__captured.addCaseInputs.length).toBe(1); // only 1 addCase attempt

  // Second call — mapping persisted, should reuse (updateCase path)
  const result2 = await testrailPublisher.publishScenariosToTestRail(client, {
    projectId: 56,
    suiteId: 1731,
    sectionId: 4903,
    appSlug: "kiosko",
    storyKey: "AA-81",
    cacheKey: "cache-nodup",
    scenarios: [
      makeScenario({
        sourceIssueKey: "JIRA-503",
        title: "Escenario sin duplicado actualizado",
      }),
    ],
  });

  // Should reuse existing mapping, not attempt addCase again
  expect(client.__captured.addCaseInputs.length).toBe(1); // still 1
  expect(client.__captured.updateCaseInputs.length).toBe(1); // 1 update
  expect(result2.updated + result2.reused).toBe(1);
  expect(result2.created).toBe(0); // no new cases in second call
  // Total created across both calls:
  expect(result1.created).toBe(1); // recovered in first call
});
