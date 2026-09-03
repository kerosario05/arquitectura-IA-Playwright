import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AiCompletionRequest, AiCompletionResponse, AiProvider } from "../ai/ai-provider.types";
import { AiProviderError } from "../ai/ai-provider.types";
import type { AppAutomationPaths, AppProfile } from "./app-profile";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { PageObjectRegistry } from "../types/page-object.types";
import {
  normalizeMojibakeUtf8,
  repairMissingExpectImport,
  rewritePromotedRuntimeImport,
  runHybridSpecGeneration,
  summarizePlaywrightDiscoveryError,
  validatePromotedSpecInternalImports,
} from "./spec-generation-hybrid";

test("T1: repairs a missing expect binding in a compatible Playwright import", () => {
  const source = "import { test } from '@playwright/test';\nawait expect(page).toBeVisible();";
  assert.strictEqual(repairMissingExpectImport(source), "import { test, expect } from '@playwright/test';\nawait expect(page).toBeVisible();");
});

test("T2: does not change an existing expect import", () => {
  const source = "import { test, expect } from '@playwright/test';\nawait expect(page).toBeVisible();";
  assert.strictEqual(repairMissingExpectImport(source), source);
});

test("T1 imports are rewritten independently for candidate and final spec locations", async () => {
  const finalSpecPath = path.resolve(process.cwd(), "automations/apps/xc/sections/detalle-kiosko/cases/C/case.spec.ts");
  const candidateSpecPath = path.resolve(path.dirname(finalSpecPath), "spec-generation/candidate.spec.ts");
  const source = [
    "import { createPromotedSpecRuntime } from 'BROKEN';",
    "import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';",
    "import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';",
    "import { test } from '@playwright/test';",
  ].join("\n");
  const candidate = rewritePromotedRuntimeImport(source, candidateSpecPath);
  const final = rewritePromotedRuntimeImport(candidate, finalSpecPath);
  assert.notStrictEqual(candidate, final);
  assert.match(final, /auth-gate-detector/);
  assert.match(final, /page-scanner/);
  assert.match(final, /from ['\"]@playwright\/test['\"]/);
  const validation = await validatePromotedSpecInternalImports(final, finalSpecPath);
  assert.deepStrictEqual(validation.unresolved, []);
  assert.strictEqual(validation.internalImports, 3);
  assert.strictEqual(validation.resolved, 3);
});

test("T2-T5 final internal imports resolve and external imports remain unchanged", async () => {
  const finalSpecPath = path.resolve(process.cwd(), "automations/apps/xc/sections/detalle-kiosko/cases/C/case.spec.ts");
  const content = rewritePromotedRuntimeImport([
    "import { createPromotedSpecRuntime } from 'BROKEN';",
    "import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';",
    "import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';",
    "import { test } from '@playwright/test';",
  ].join("\n"), finalSpecPath);
  assert.match(content, /from ['\"]@playwright\/test['\"]/);
  const validation = await validatePromotedSpecInternalImports(content, finalSpecPath);
  assert.strictEqual(validation.internalImports, 3);
  assert.strictEqual(validation.resolved, 3);
  assert.strictEqual(validation.unresolved.length, 0);
});

test("T6 unresolved final internal imports fail closed", async () => {
  const finalSpecPath = path.resolve(process.cwd(), "automations/apps/xc/sections/detalle-kiosko/cases/C/case.spec.ts");
  const validation = await validatePromotedSpecInternalImports(
    "import { missing } from '../../../../../../../src/not-real/module';",
    finalSpecPath,
  );
  assert.strictEqual(validation.internalImports, 1);
  assert.strictEqual(validation.resolved, 0);
  assert.deepStrictEqual(validation.unresolved, ["../../../../../../../src/not-real/module"]);
});

test("T3: does not add expect when it is unused", () => {
  const source = "import { test } from '@playwright/test';\ntest('case', async () => {});";
  assert.strictEqual(repairMissingExpectImport(source), source);
});

test("T4: fails closed for a local expect binding", () => {
  const source = "import { test } from '@playwright/test';\nconst expect = customExpect;\nexpect(page);";
  assert.strictEqual(repairMissingExpectImport(source), source);
  const parameterBinding = "import { test } from '@playwright/test';\nfunction check(expect: unknown) { return expect; }\nexpect(page);";
  assert.strictEqual(repairMissingExpectImport(parameterBinding), parameterBinding);
});

test("T7/T8: keeps the useful Playwright discovery cause after Listing tests", () => {
  assert.strictEqual(
    summarizePlaywrightDiscoveryError("Listing tests:", "Error: Cannot find module './missing'") ,
    "Error: Cannot find module './missing'",
  );
  assert.strictEqual(summarizePlaywrightDiscoveryError("Listing tests:", ""), "Listing tests:");
});

if (process.env.AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED === undefined) {
  process.env.AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED = "false";
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    original[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

async function withCapturedLogs<T>(fn: () => Promise<T>): Promise<{ logs: string[]; result: T }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    return { logs, result: await fn() };
  } finally {
    console.log = original;
  }
}

async function createTmpPaths(): Promise<AppAutomationPaths> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spec-hybrid-"));
  const appDir = path.join(root, "automations", "apps", "test-app");
  const caseDir = path.join(appDir, "cases", "preview-001");
  const pagesDir = path.join(appDir, "pages");
  const flowsDir = path.join(appDir, "flows");
  await fs.mkdir(caseDir, { recursive: true });
  await fs.mkdir(pagesDir, { recursive: true });
  await fs.mkdir(flowsDir, { recursive: true });
  await fs.writeFile(path.join(pagesDir, "home.page.ts"), "export class HomePage { constructor(_: unknown) {} async start(): Promise<void> {} }", "utf-8");
  await fs.writeFile(path.join(pagesDir, "login.page.ts"), "export class LoginPage { constructor(_: unknown) {} async expectLoginFormVisible(): Promise<void> {} async fillUsername(_: string): Promise<void> {} async fillPassword(_: string): Promise<void> {} async submitLogin(): Promise<void> {} }", "utf-8");
  await fs.writeFile(path.join(pagesDir, "operationsmenu.page.ts"), "export class OperationsMenuPage { constructor(_: unknown) {} async openModule(_: string): Promise<void> {} }", "utf-8");
  await fs.writeFile(path.join(flowsDir, "auth.flow.ts"), "export class AuthFlow { constructor(_: unknown) {} async ensureAuthenticated(): Promise<void> {} }", "utf-8");
  return {
    appDir,
    configPath: path.join(appDir, "app.config.json"),
    testDataRefsPath: path.join(appDir, "test-data-refs.json"),
    indexPath: path.join(appDir, "index.json"),
    pageObjectsIndexPath: path.join(appDir, "page-objects.index.json"),
    flowsIndexPath: path.join(appDir, "flows.index.json"),
    pagesDir,
    componentsDir: path.join(appDir, "components"),
    flowsDir,
    casesDir: path.join(appDir, "cases"),
    caseDir,
    caseConfigPath: path.join(caseDir, "case.json"),
    caseAutomationPath: path.join(caseDir, "automation.json"),
    caseEvidenceDir: path.join(caseDir, "evidence"),
    caseRunsDir: path.join(caseDir, "runs"),
    plansDir: path.join(appDir, "plans"),
    specsDir: path.join(appDir, "specs"),
    evidenceDir: path.join(appDir, "evidence"),
    runsDir: path.join(appDir, "runs"),
    planPath: path.join(caseDir, "plan.json"),
    specPath: path.join(caseDir, "case.spec.ts"),
  };
}

function buildPlan(scenarioId = "PREVIEW-001"): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: {
      source: "manual",
      externalId: scenarioId,
      title: "Visualizacion inicial"
    },
    requiredData: [],
    steps: [
      { index: 1, action: "click", description: "Iniciar", target: { strategy: "text", value: "Iniciar" } },
      { index: 2, action: "assertVisible", description: "Validar boton iniciar", target: { strategy: "text", value: "Iniciar" }, expected: "Boton iniciar visible" }
    ]
  };
}

function buildPlanWithLogin(scenarioId = "PREVIEW-001"): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: {
      source: "manual",
      externalId: scenarioId,
      title: "Visualizacion inicial"
    },
    requiredData: [],
    steps: [
      { index: 1, action: "click", description: "Iniciar", target: { strategy: "text", value: "Iniciar" } },
      { index: 2, action: "assertVisible", description: "Validar boton iniciar", target: { strategy: "text", value: "Iniciar" }, expected: "Boton iniciar visible" },
      { index: 3, action: "login", description: "Autenticarse" }
    ]
  };
}

function buildPlanWithAuthFlowRequired(scenarioId = "C42940"): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: {
      source: "manual",
      externalId: scenarioId,
      title: "Acceder a Transacciones y servicios para iniciar autenticacion"
    },
    requiredData: [],
    steps: [
      { index: 1, action: "navigate", description: "Navegar al kiosco", target: "APP_BASE_URL" },
      { index: 2, action: "click", description: "Pulsar Iniciar", target: { strategy: "text", value: "Iniciar" } },
      { index: 3, action: "click", description: "Seleccionar Transacciones y servicios", target: { strategy: "text", value: "Transacciones y servicios" } },
      { index: 4, action: "login", description: "Autenticarse con flujo existente" }
    ],
    metadata: {
      authFlowRequired: true,
      authFlowInsertionAfterStepIndex: 3,
      authFlowAlias: "defaultClient",
      authFlowLanding: "transactions_menu",
      authGateDetectedDuringDiscovery: true
    }
  };
}

function buildPlanWithoutAssertions(scenarioId = "PREVIEW-001"): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: {
      source: "manual",
      externalId: scenarioId,
      title: "Visualizacion inicial"
    },
    requiredData: [],
    steps: [{ index: 1, action: "click", description: "Iniciar", target: { strategy: "text", value: "Iniciar" } }]
  };
}

function buildProfile(): AppProfile {
  const now = new Date().toISOString();
  return {
    appSlug: "arquitectura-automatizacion",
    source: "default",
    createdAt: now,
    updatedAt: now
  };
}

function buildRegistry(appDir: string, options?: { includeOperationsMenu?: boolean; includeLoginPage?: boolean }): PageObjectRegistry {
  const pageObjects: PageObjectRegistry["pageObjects"] = [
    {
      id: "home",
      className: "HomePage",
      filePath: path.join(appDir, "pages", "home.page.ts"),
      screenSignature: "home",
      confidence: 1,
      status: "active",
      sourcePlanIds: [],
      caseIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      methods: [
        { name: "start", intent: "start_session", parameters: [], available: true, source: "seed", sensitive: false, confidence: 1, status: "active" }
      ]
    }
  ];
  if (options?.includeOperationsMenu) {
    pageObjects.push({
      id: "operations",
      className: "OperationsMenuPage",
      filePath: path.join(appDir, "pages", "operationsmenu.page.ts"),
      screenSignature: "operations-menu",
      confidence: 1,
      status: "active",
      sourcePlanIds: [],
      caseIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      methods: [
        { name: "openModule", intent: "navigate_module", parameters: ["moduleName"], available: true, source: "seed", sensitive: false, confidence: 1, status: "active" }
      ]
    });
  }
  if (options?.includeLoginPage) {
    pageObjects.push({
      id: "login",
      className: "LoginPage",
      filePath: path.join(appDir, "pages", "login.page.ts"),
      screenSignature: "login",
      confidence: 1,
      status: "active",
      sourcePlanIds: [],
      caseIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      methods: [
        { name: "expectLoginFormVisible", intent: "assert_visible", parameters: [], available: true, source: "seed", sensitive: false, confidence: 1, status: "active" },
        { name: "fillUsername", intent: "fill_form_field", parameters: ["value"], available: true, source: "seed", sensitive: false, confidence: 1, status: "active" },
        { name: "fillPassword", intent: "fill_form_field", parameters: ["value"], available: true, source: "seed", sensitive: true, confidence: 1, status: "active" },
        { name: "submitLogin", intent: "submit_form", parameters: [], available: true, source: "seed", sensitive: false, confidence: 1, status: "active" }
      ]
    });
  }
  return {
    version: "1.0",
    appSlug: "arquitectura-automatizacion",
    updatedAt: new Date().toISOString(),
    componentCandidates: [],
    pageObjects
  };
}

function buildValidSpec(sectionSlug = "detalle-kiosko", scenarioId = "PREVIEW-001"): string {
  return [
    "import { test, expect } from '@playwright/test';",
    "import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';",
    "import { HomePage } from '../../pages/home.page';",
    "",
    "export const PROMOTED_SPEC_STRATEGY = \"pom_runtime\";",
    "test('Visualizacion inicial', async ({ page }) => {",
    "  process.env.APP_SLUG = 'arquitectura-automatizacion';",
    `  process.env.SECTION_SLUG = '${sectionSlug}';`,
    `  process.env.SCENARIO_ID = '${scenarioId}';`,
    "  process.env.SCENARIO_TITLE = 'Visualizacion inicial';",
    "  const homePage = new HomePage(page);",
    "  const promotedRuntime = createPromotedSpecRuntime(page);",
    "  try {",
    "    await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', action: async () => { await homePage.start(); } });",
    "    await promotedRuntime.expectPromotedVisible({ stepIndex: 2, target: 'Iniciar', assertion: async () => { await expect(page.locator('body')).toBeVisible(); } });",
    "  } finally {",
    "    await promotedRuntime.finishEvidence();",
    "  }",
    "});"
  ].join("\n");
}

function buildAuthFlowSpec(options?: { includeFinally?: boolean; includeRuntime?: boolean; includeFinishEvidence?: boolean; authBeforeStart?: boolean; includeCredentialsLogin?: boolean }): string {
  const includeFinally = options?.includeFinally ?? true;
  const includeRuntime = options?.includeRuntime ?? true;
  const includeFinishEvidence = options?.includeFinishEvidence ?? true;
  const authBeforeStart = options?.authBeforeStart ?? false;
  const includeCredentialsLogin = options?.includeCredentialsLogin ?? false;
  const calls = authBeforeStart
    ? [
      "    await authFlow.ensureAuthenticated({ alias: 'defaultClient', landing: 'transactions_menu' });",
      "    await promotedRuntime.clickPromotedTarget({ stepIndex: 2, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', action: async () => { await homePage.start(); } });",
      "    await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Transacciones y servicios', actionIntent: 'navigate_module', expectedEffect: 'auth_gate', action: async () => { await operationsMenuPage.openModule('transacciones y servicios'); } });",
      "    await promotedRuntime.expectPromotedVisible({ stepIndex: 4, target: 'auth gate', assertion: async () => { await expect(page.locator('body')).toBeVisible(); } });"
    ]
    : [
      "    await promotedRuntime.clickPromotedTarget({ stepIndex: 2, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', action: async () => { await homePage.start(); } });",
      "    await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Transacciones y servicios', actionIntent: 'navigate_module', expectedEffect: 'auth_gate', action: async () => { await operationsMenuPage.openModule('transacciones y servicios'); } });",
      "    await authFlow.ensureAuthenticated({ alias: 'defaultClient', landing: 'transactions_menu' });",
      "    await promotedRuntime.expectPromotedVisible({ stepIndex: 4, target: 'auth gate', assertion: async () => { await expect(page.locator('body')).toBeVisible(); } });"
    ];
  return [
    "import { test, expect } from '@playwright/test';",
    includeRuntime ? "import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';" : "",
    "import { HomePage } from '../../pages/home.page';",
    "import { OperationsMenuPage } from '../../pages/operationsmenu.page';",
    "import { AuthFlow } from '../../flows/auth.flow';",
    "",
    "export const PROMOTED_SPEC_STRATEGY = \"pom_runtime\";",
    "test('Acceder a Transacciones y servicios para iniciar autenticacion', async ({ page }) => {",
    "  process.env.APP_SLUG = 'arquitectura-automatizacion';",
    "  process.env.SECTION_SLUG = 'detalle-kiosko';",
    "  process.env.SCENARIO_ID = 'C42940';",
    "  process.env.SCENARIO_TITLE = 'Acceder a Transacciones y servicios para iniciar autenticacion';",
    "  const homePage = new HomePage(page);",
    "  const operationsMenuPage = new OperationsMenuPage(page);",
    "  const authFlow = new AuthFlow(page);",
    includeCredentialsLogin ? "  const password = process.env.APP_PASSWORD;" : "",
    includeRuntime ? "  const promotedRuntime = createPromotedSpecRuntime(page);" : "",
    includeFinally ? "  try {" : "",
    "    await page.goto('/');",
    "    await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'APP_BASE_URL', actionIntent: 'navigate', expectedEffect: 'route_load', action: async () => { await page.waitForLoadState('domcontentloaded'); } });",
    ...calls,
    includeFinally ? "  } finally {" : "",
    includeFinally && includeFinishEvidence ? "    await promotedRuntime.finishEvidence();" : "",
    includeFinally ? "  }" : "",
    "});"
  ].filter(Boolean).join("\n");
}

function buildProvider(
  parsedJson: Record<string, unknown>,
  usage?: AiCompletionResponse["usage"],
  capture?: { request?: AiCompletionRequest; calls?: number },
  options?: { providerName?: string; model?: string; providerType?: AiProvider["providerType"] }
): AiProvider {
  return {
    providerType: options?.providerType ?? "fake",
    providerName: options?.providerName ?? "provider-test",
    model: options?.model ?? "model-test",
    async completeJson(request: AiCompletionRequest): Promise<AiCompletionResponse> {
      if (capture) {
        capture.request = request;
        capture.calls = (capture.calls ?? 0) + 1;
      }
      return {
        rawText: JSON.stringify(parsedJson),
        parsedJson,
        model: options?.model ?? "model-test",
        providerName: options?.providerName ?? "provider-test",
        durationMs: 10,
        usage
      };
    }
  };
}

function buildSequentialProvider(
  parsedJsons: Record<string, unknown>[],
  capture?: { requests: AiCompletionRequest[]; calls?: number },
): AiProvider {
  let index = 0;
  return {
    providerType: "fake",
    providerName: "provider-test",
    model: "model-test",
    async completeJson(request: AiCompletionRequest): Promise<AiCompletionResponse> {
      if (capture) {
        capture.requests.push(request);
        capture.calls = (capture.calls ?? 0) + 1;
      }
      const current = parsedJsons[Math.min(index, parsedJsons.length - 1)];
      index += 1;
      return {
        rawText: JSON.stringify(current),
        parsedJson: current,
        model: "model-test",
        providerName: "provider-test",
        durationMs: 10,
      };
    }
  };
}

async function loadSkillExample(name: string): Promise<string> {
  return fs.readFile(
    path.join(process.cwd(), ".ai", "skills", "playwright-spec-generation", "examples", name),
    "utf-8",
  );
}

function applyExamplePlaceholders(
  content: string,
  replacements?: {
    scenarioId?: string;
    scenarioTitle?: string;
    primaryAction?: string;
    moduleName?: string;
  },
): string {
  return content
    .replaceAll("__APP_SLUG__", "arquitectura-automatizacion")
    .replaceAll("__SECTION_SLUG__", "detalle-kiosko")
    .replaceAll("__SCENARIO_ID__", replacements?.scenarioId ?? "PREVIEW-001")
    .replaceAll("__SCENARIO_TITLE__", replacements?.scenarioTitle ?? "Visualizacion inicial")
    .replaceAll("__PRIMARY_ACTION__", replacements?.primaryAction ?? "Iniciar")
    .replaceAll("__MODULE_NAME__", replacements?.moduleName ?? "transacciones y servicios");
}

function passTs(): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  return Promise.resolve({ ok: true, stdout: "", stderr: "", exitCode: 0 });
}

function failTs(): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  return Promise.resolve({ ok: false, stdout: "", stderr: "Cannot find name 'productListPage'", exitCode: 2 });
}

function passList(total = 1): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  return Promise.resolve({ ok: true, stdout: `Total: ${total} test in 1 file`, stderr: "", exitCode: 0 });
}

function passFunctional(steps = 2, screenshots = 1): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number; evidenceSteps: number | null; screenshots: number | null; authGateDetected: boolean | null }> {
  return Promise.resolve({
    ok: true,
    stdout: `[evidence] scenario=PREVIEW-001 status=passed steps=${steps} screenshots=${screenshots}`,
    stderr: "",
    exitCode: 0,
    evidenceSteps: steps,
    screenshots,
    authGateDetected: true
  });
}

function mojibakeEncodeLevel(text: string): string {
  let out = "";
  for (const char of text) {
    for (const byte of Buffer.from(char, "utf8")) {
      out += String.fromCharCode(byte);
    }
  }
  return out;
}

function failFunctional(exitCode = 1, steps: number | null = null): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number; evidenceSteps: number | null; screenshots: number | null; authGateDetected: boolean | null }> {
  return Promise.resolve({
    ok: false,
    stdout: "",
    stderr: "functional run failed",
    exitCode,
    evidenceSteps: steps,
    screenshots: 0,
    authGateDetected: null
  });
}

test("hybrid spec generation", async (t) => {
  await t.test("valid AI spec passes all gates", async () => {
    const appPaths = await createTmpPaths();
    const plan = buildPlan("PREVIEW-001");
    const response = {
      specContent: buildValidSpec(),
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    const capture: { request?: AiCompletionRequest; calls?: number } = {};
    const provider = buildProvider(response, undefined, capture);

    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "claude-opus-4.5",
      AI_SPEC_BATCH_PER_ISSUE: "false"
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan,
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1)
      });

      assert.strictEqual(result.promotionAllowed, true);
      assert.strictEqual(result.diagnostics.mode, "ai_hybrid");
      assert.strictEqual(result.diagnostics.validation.schema, "passed");
      assert.strictEqual(capture.request?.purpose, "spec_generation");
      assert.strictEqual(capture.calls, 1);
      const userPrompt = String(capture.request?.messages?.find((m) => m.role === "user")?.content ?? "");
      assert.ok(userPrompt.includes("\"responseJsonSchema\""));
      assert.ok(userPrompt.includes("\"additionalProperties\": false"));
    });
  });

  await t.test("skill content is included in prompt and request summary includes version and hash", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: buildValidSpec(),
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: [],
    };
    const capture: { request?: AiCompletionRequest; calls?: number } = {};
    const provider = buildProvider(response, undefined, capture, { providerName: "copilot", model: "gpt-5.4", providerType: "copilot_cli" });

    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "gpt-5.4",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_SKILL_ENABLED: "true",
      AI_SPEC_SKILL_REQUIRED: "true",
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider,
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
      });

      assert.strictEqual(result.promotionAllowed, true);
      const systemPrompt = String(capture.request?.messages.find((message) => message.role === "system")?.content ?? "");
      const userPrompt = String(capture.request?.messages.find((message) => message.role === "user")?.content ?? "");
      assert.ok(systemPrompt.includes("UNTRUSTED_SCENARIO_DATA"));
      assert.ok(userPrompt.includes("INSTRUCTIONS"));
      assert.ok(userPrompt.includes("name: playwright-spec-generation"));
      assert.ok(userPrompt.includes("OUTPUT_SCHEMA"));
      assert.ok(userPrompt.includes("AVAILABLE_APIS"));
      assert.ok(userPrompt.includes("UNTRUSTED_SCENARIO_DATA"));
      assert.ok(userPrompt.includes("PROMOTION_RESTRICTIONS"));
      assert.ok(userPrompt.indexOf("INSTRUCTIONS") < userPrompt.indexOf("AVAILABLE_RUNTIME_ALLOWLIST"));
      assert.ok(userPrompt.indexOf("AVAILABLE_RUNTIME_ALLOWLIST") < userPrompt.indexOf("OUTPUT_SCHEMA"));
      assert.ok(userPrompt.indexOf("OUTPUT_SCHEMA") < userPrompt.indexOf("AVAILABLE_APIS"));
      assert.ok(userPrompt.indexOf("UNTRUSTED_SCENARIO_DATA") < userPrompt.indexOf("EXECUTION_PLAN"));

      const requestSummary = JSON.parse(await fs.readFile(path.join(result.artifactsDir!, "request-summary.json"), "utf-8"));
      assert.deepStrictEqual(requestSummary.skill.loaded, true);
      assert.strictEqual(requestSummary.skill.name, "playwright-spec-generation");
      assert.strictEqual(requestSummary.skill.version, "1.0.0");
      assert.ok(typeof requestSummary.skill.hash === "string" && requestSummary.skill.hash.length === 64);
      assert.strictEqual(result.diagnostics.skill.loaded, true);
    });
  });

  await t.test("same skill is sent to copilot, codex, and alternate providers without model-specific logic", async () => {
    const providers = [
      { providerName: "copilot", providerType: "copilot_cli" as const, model: "gpt-5.4" },
      { providerName: "codex", providerType: "codex_cli" as const, model: "gpt-5.4" },
      { providerName: "alt-provider", providerType: "fake" as const, model: "custom-model" },
    ];

    for (const providerMeta of providers) {
      const appPaths = await createTmpPaths();
      const capture: { request?: AiCompletionRequest; calls?: number } = {};
      await withEnv({
        AI_ENABLED: "true",
        AI_SPEC_GENERATION_ENABLED: "true",
        AI_SPEC_PROVIDER: providerMeta.providerType,
        AI_SPEC_MODEL: providerMeta.model,
        AI_SPEC_BATCH_PER_ISSUE: "false",
        AI_SPEC_SKILL_ENABLED: "true",
        AI_SPEC_SKILL_REQUIRED: "true",
      }, async () => {
        const result = await runHybridSpecGeneration({
          plan: buildPlan(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          pageObjectRegistry: buildRegistry(appPaths.appDir),
          provider: buildProvider({
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: [],
          }, undefined, capture, providerMeta),
        }, {
          runTypeScriptValidation: async () => passTs(),
          runPlaywrightDiscovery: async () => passList(1),
        });
        assert.strictEqual(result.promotionAllowed, true);
        const userPrompt = String(capture.request?.messages.find((message) => message.role === "user")?.content ?? "");
        assert.ok(userPrompt.includes("name: playwright-spec-generation"));
        assert.ok(userPrompt.includes("OUTPUT_SCHEMA"));
      });
    }
  });

  await t.test("required missing skill blocks promotion before AI invocation and without silent fallback", async () => {
    const appPaths = await createTmpPaths();
    const capture: { request?: AiCompletionRequest; calls?: number } = {};
    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "true",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "gpt-5.4",
      AI_SPEC_SKILL_ENABLED: "true",
      AI_SPEC_SKILL_REQUIRED: "true",
      AI_SPEC_SKILL_PATH: ".ai/skills/playwright-spec-generation/MISSING.md",
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1, 2],
          coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: [],
        }, undefined, capture),
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
      });

      assert.strictEqual(result.promotionAllowed, false);
      assert.strictEqual(result.diagnostics.invocationsConsumed, 0);
      assert.strictEqual(capture.calls ?? 0, 0);
      assert.ok(result.diagnostics.errors.some((error) => error.includes("spec_generation_skill_load_failed")));
      assert.strictEqual(result.diagnostics.warnings.includes("ai_provider_failed_using_deterministic_fallback"), false);
    });
  });

  await t.test("valid basic skill example passes gates", async () => {
    const appPaths = await createTmpPaths();
    const exampleSpec = applyExamplePlaceholders(await loadSkillExample("valid-basic.spec.ts"));
    const response = {
      specContent: exampleSpec,
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.getByRole('button', { name: /Iniciar/i })).toBeVisible();" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: [],
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response),
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, true);
    });
  });

  await t.test("flow_execution scenario rejects gate-only skill example (requires ensureAuthenticated)", async () => {
    const appPaths = await createTmpPaths();
    const exampleSpec = applyExamplePlaceholders(await loadSkillExample("valid-auth-gate.spec.ts"), {
      scenarioId: "C42940",
      scenarioTitle: "Acceder a Transacciones y servicios para iniciar autenticacion",
    });
    const response = {
      specContent: exampleSpec,
      coveredStepIndexes: [1, 2, 3, 4],
      coveredAssertions: [{ requirement: "Se inicia el flujo de autenticacion.", implementation: "await expect(authGateStarted).toBeTruthy();" }],
      usedPageObjects: [
        { className: "HomePage", methods: ["start"] },
        { className: "OperationsMenuPage", methods: ["openModule"] },
      ],
      declaredIdentifiers: ["homePage", "operationsMenuPage", "promotedRuntime", "authGateStarted"],
      unresolvedRequirements: [],
      warnings: [],
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlanWithAuthFlowRequired("C42940"),
        deterministicDraft: buildAuthFlowSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
        provider: buildProvider(response),
        sourceScenario: {
          title: "Acceder a Transacciones y servicios para iniciar autenticacion",
          steps: [
            { index: 1, action: "navigate", description: "Navegar al kiosco" },
            { index: 2, action: "click", description: "Pulsar Iniciar" },
            { index: 3, action: "click", description: "Seleccionar Transacciones y servicios" },
            { index: 4, action: "login", description: "Validar inicio del auth gate" },
          ],
          expectedResult: "Se inicia el flujo de autenticacion.",
          observedAssertions: [],
          auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3, flowAlias: "defaultClient", flowLanding: "transactions_menu" },
        },
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(
        result.diagnostics.errors.some((error) => error.startsWith("missing_auth_flow_ensure_authenticated")),
        result.diagnostics.errors.join("\n")
      );
      assert.strictEqual(result.specContent, exampleSpec);
      assert.ok(result.specContent.includes("new HomePage(page)"));
      assert.ok(result.specContent.includes("operationsMenuPage.openModule"));
      assert.ok(!result.specContent.includes("loginPromotedTarget("));
      assert.strictEqual(result.diagnostics.finalSpec.origin, "ai_candidate");
      assert.strictEqual(result.diagnostics.finalSpec.generatedBy, "ai");
      assert.strictEqual(result.diagnostics.warnings.some((warning) => warning.includes("gate_start_only_canonical_fallback_applied")), false);

      const requestSummary = JSON.parse(await fs.readFile(path.join(result.artifactsDir!, "request-summary.json"), "utf-8"));
      const responseArtifact = JSON.parse(await fs.readFile(path.join(result.artifactsDir!, "response.json"), "utf-8"));
      const validationArtifact = JSON.parse(await fs.readFile(path.join(result.artifactsDir!, "validation.json"), "utf-8"));
      assert.strictEqual(requestSummary.finalSpec.origin, "ai_candidate");
      assert.strictEqual(validationArtifact.finalSpec.origin, "ai_candidate");
      assert.strictEqual(responseArtifact._finalSpec.origin, "ai_candidate");
    });
  });

  await t.test("flow_execution scenario never applies gate_start_only canonical fallback", async () => {
    const appPaths = await createTmpPaths();
    const exampleSpec = applyExamplePlaceholders(await loadSkillExample("valid-auth-gate.spec.ts"), {
      scenarioId: "C42940",
      scenarioTitle: "Acceder a Transacciones y servicios para iniciar autenticacion",
    });
    const invalidSpec = exampleSpec.replace(
      "assertion: async () => {",
      "action: async () => {"
    );
    const response = {
      specContent: invalidSpec,
      coveredStepIndexes: [1, 2, 3, 4],
      coveredAssertions: [{ requirement: "Se inicia el flujo de autenticacion.", implementation: "await expect(authGateStarted).toBeTruthy();" }],
      usedPageObjects: [
        { className: "HomePage", methods: ["start"] },
        { className: "OperationsMenuPage", methods: ["openModule"] },
      ],
      declaredIdentifiers: ["homePage", "operationsMenuPage", "promotedRuntime", "authGateStarted"],
      unresolvedRequirements: [],
      warnings: [],
    };

    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      let functionalExecutions = 0;
      const result = await runHybridSpecGeneration({
        plan: buildPlanWithAuthFlowRequired("C42940"),
        deterministicDraft: buildAuthFlowSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
        provider: buildProvider(response),
        sourceScenario: {
          title: "Acceder a Transacciones y servicios para iniciar autenticacion",
          steps: [
            { index: 1, action: "navigate", description: "Navegar al kiosco" },
            { index: 2, action: "click", description: "Pulsar Iniciar" },
            { index: 3, action: "click", description: "Seleccionar Transacciones y servicios" },
            { index: 4, action: "login", description: "Validar inicio del auth gate" },
          ],
          expectedResult: "Se inicia el flujo de autenticacion.",
          observedAssertions: [],
          auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3, flowAlias: "defaultClient", flowLanding: "transactions_menu" },
        },
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => {
          functionalExecutions += 1;
          return passFunctional(3, 3);
        },
      });

      assert.strictEqual(result.promotionAllowed, false);
      assert.strictEqual(result.diagnostics.validation.structure, "failed");
      assert.ok(
        !result.diagnostics.warnings.some((warning) => warning.includes("gate_start_only_canonical_fallback_applied")),
        result.diagnostics.warnings.join("\n")
      );
      assert.strictEqual(result.diagnostics.finalSpec.origin, "ai_candidate");
      assert.strictEqual(result.diagnostics.finalSpec.generatedBy, "ai");

      const requestSummary = JSON.parse(await fs.readFile(path.join(result.artifactsDir!, "request-summary.json"), "utf-8"));
      const responseArtifact = JSON.parse(await fs.readFile(path.join(result.artifactsDir!, "response.json"), "utf-8"));
      const validationArtifact = JSON.parse(await fs.readFile(path.join(result.artifactsDir!, "validation.json"), "utf-8"));
      assert.strictEqual(requestSummary.finalSpec.origin, "ai_candidate");
      assert.strictEqual(validationArtifact.finalSpec.origin, "ai_candidate");
      assert.strictEqual(responseArtifact._finalSpec.origin, "ai_candidate");
    });
  });

  await t.test("gate_start_only fallback disabled blocks invalid AI candidate", async () => {
    const appPaths = await createTmpPaths();
    const exampleSpec = applyExamplePlaceholders(await loadSkillExample("valid-auth-gate.spec.ts"), {
      scenarioId: "C42940",
      scenarioTitle: "Acceder a Transacciones y servicios para iniciar autenticacion",
    });
    const invalidSpec = exampleSpec.replace(
      "assertion: async () => {",
      "action: async () => {"
    );
    const response = {
      specContent: invalidSpec,
      coveredStepIndexes: [1, 2, 3, 4],
      coveredAssertions: [{ requirement: "Se inicia el flujo de autenticacion.", implementation: "await expect(authGateStarted).toBeTruthy();" }],
      usedPageObjects: [
        { className: "HomePage", methods: ["start"] },
        { className: "OperationsMenuPage", methods: ["openModule"] },
      ],
      declaredIdentifiers: ["homePage", "operationsMenuPage", "promotedRuntime", "authGateStarted"],
      unresolvedRequirements: [],
      warnings: [],
    };

    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      let functionalExecutions = 0;
      const result = await runHybridSpecGeneration({
        plan: buildPlanWithAuthFlowRequired("C42940"),
        deterministicDraft: buildAuthFlowSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
        provider: buildProvider(response),
        sourceScenario: {
          title: "Acceder a Transacciones y servicios para iniciar autenticacion",
          steps: [
            { index: 1, action: "navigate", description: "Navegar al kiosco" },
            { index: 2, action: "click", description: "Pulsar Iniciar" },
            { index: 3, action: "click", description: "Seleccionar Transacciones y servicios" },
            { index: 4, action: "login", description: "Validar inicio del auth gate" },
          ],
          expectedResult: "Se inicia el flujo de autenticacion.",
          observedAssertions: [],
          auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3, flowAlias: "defaultClient", flowLanding: "transactions_menu" },
        },
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => {
          functionalExecutions += 1;
          return passFunctional(3, 3);
        },
      });

      assert.strictEqual(result.promotionAllowed, false);
      assert.strictEqual(result.diagnostics.finalSpec.origin, "ai_candidate");
      assert.strictEqual(result.diagnostics.warnings.some((warning) => warning.includes("gate_start_only_canonical_fallback_applied")), false);
      assert.ok(result.diagnostics.errors.some((error) => error.includes("expect_promoted_visible_missing_assertion")));
      assert.ok(result.diagnostics.errors.some((error) => error.includes("expect_promoted_visible_forbidden_action_property")));
      assert.strictEqual(result.diagnostics.validation.functionalExecution, "skipped");
      assert.strictEqual(functionalExecutions, 0);
    });
  });

  await t.test("invalid skill examples are rejected by deterministic gates", async () => {
    const appPaths = await createTmpPaths();
    const inventedSelectorSpec = applyExamplePlaceholders(await loadSkillExample("invalid-invented-selector.spec.ts"));
    const inventedRuntimeSpec = applyExamplePlaceholders(await loadSkillExample("invalid-runtime-method.spec.ts"));

    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const selectorResult = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: inventedSelectorSpec,
          coveredStepIndexes: [1],
          coveredAssertions: [{ requirement: "Banner visible", implementation: "await expect(page.getByText(/imaginary success banner/i)).toBeVisible();" }],
          usedPageObjects: [],
          declaredIdentifiers: ["promotedRuntime"],
          unresolvedRequirements: [],
          warnings: [],
        }),
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(selectorResult.promotionAllowed, false);

      const runtimeResult = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: inventedRuntimeSpec,
          coveredStepIndexes: [1],
          coveredAssertions: [],
          usedPageObjects: [],
          declaredIdentifiers: ["promotedRuntime"],
          unresolvedRequirements: [],
          warnings: [],
        }),
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(runtimeResult.promotionAllowed, false);
      assert.ok(runtimeResult.diagnostics.errors.includes("unknown_promoted_runtime_method:loginPromotedTarget"));
    });

  });

    await t.test("process.env password reference is preserved", async () => {
      const appPaths = await createTmpPaths();
      const safeRefSpec = buildValidSpec().replace(
        "  const promotedRuntime = createPromotedSpecRuntime(page);",
        "  const password = process.env.APP_PASSWORD;\n  const promotedRuntime = createPromotedSpecRuntime(page);"
      );
      const response = {
        specContent: safeRefSpec,
        coveredStepIndexes: [1, 2],
        coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
        usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
        declaredIdentifiers: ["homePage", "promotedRuntime", "password"],
        unresolvedRequirements: [],
        warnings: []
      };
      await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
        const result = await runHybridSpecGeneration({
          plan: buildPlan(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          pageObjectRegistry: buildRegistry(appPaths.appDir),
          provider: buildProvider(response)
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
        assert.strictEqual(result.promotionAllowed, true);
        assert.strictEqual(result.diagnostics.errors.includes("sensitive_content_detected"), false);
        assert.ok(result.specContent.includes("process.env.APP_PASSWORD"));
      });
    });

    await t.test("literal password secret is blocked", async () => {
      const appPaths = await createTmpPaths();
      const secretSpec = buildValidSpec().replace(
        "  const promotedRuntime = createPromotedSpecRuntime(page);",
        "  const password = \"secreto-real\";\n  const promotedRuntime = createPromotedSpecRuntime(page);"
      );
      const response = {
        specContent: secretSpec,
        coveredStepIndexes: [1, 2],
        coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
        usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
        declaredIdentifiers: ["homePage", "promotedRuntime", "password"],
        unresolvedRequirements: [],
        warnings: []
      };
      await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
        const result = await runHybridSpecGeneration({
          plan: buildPlan(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          pageObjectRegistry: buildRegistry(appPaths.appDir),
          provider: buildProvider(response)
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
        assert.strictEqual(result.promotionAllowed, false);
        assert.ok(result.diagnostics.errors.includes("sensitive_content_detected"));
      });
    });

    await t.test("validation input uses executable non-redacted content", async () => {
      const appPaths = await createTmpPaths();
      const safeRefSpec = buildValidSpec().replace(
        "  const promotedRuntime = createPromotedSpecRuntime(page);",
        "  const password = process.env.APP_PASSWORD;\n  const promotedRuntime = createPromotedSpecRuntime(page);"
      );
      const response = {
        specContent: safeRefSpec,
        coveredStepIndexes: [1, 2],
        coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
        usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
        declaredIdentifiers: ["homePage", "promotedRuntime", "password"],
        unresolvedRequirements: [],
        warnings: []
      };
      let validationFileContent = "";
      await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
        await runHybridSpecGeneration({
          plan: buildPlan(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          pageObjectRegistry: buildRegistry(appPaths.appDir),
          provider: buildProvider(response)
        }, {
          runTypeScriptValidation: async (specPath: string) => {
            validationFileContent = await fs.readFile(specPath, "utf-8");
            return passTs();
          },
          runPlaywrightDiscovery: async () => passList(1)
        });
        assert.ok(validationFileContent.includes("process.env.APP_PASSWORD"));
        assert.strictEqual(validationFileContent.includes("[REDACTED]"), false);
      });
    });

    await t.test("missing promoted runtime/finally/finishEvidence are blocked", async () => {
      const appPaths = await createTmpPaths();
      const baseResponse = {
        coveredStepIndexes: [1, 2, 3, 4],
        coveredAssertions: [{ requirement: "auth gate visible", implementation: "await expect(page.locator('body')).toBeVisible();" }],
        usedPageObjects: [
          { className: "HomePage", methods: ["start"] },
          { className: "OperationsMenuPage", methods: ["openModule"] }
        ],
        unresolvedRequirements: [],
        warnings: []
      };
      await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
        const missingRuntime = await runHybridSpecGeneration({
          plan: buildPlanWithAuthFlowRequired(),
          deterministicDraft: buildAuthFlowSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            expectedResult: "authenticated session",
            auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3 }
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
          provider: buildProvider({
            ...baseResponse,
            specContent: buildAuthFlowSpec({ includeRuntime: false }),
            declaredIdentifiers: ["homePage", "operationsMenuPage", "authFlow"]
          })
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
        assert.ok(missingRuntime.diagnostics.errors.includes("missing_createPromotedSpecRuntime"));

        const missingFinally = await runHybridSpecGeneration({
          plan: buildPlanWithAuthFlowRequired(),
          deterministicDraft: buildAuthFlowSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            expectedResult: "authenticated session",
            auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3 }
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
          provider: buildProvider({
            ...baseResponse,
            specContent: buildAuthFlowSpec({ includeFinally: false }),
            declaredIdentifiers: ["homePage", "operationsMenuPage", "authFlow", "promotedRuntime"]
          })
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
        assert.ok(missingFinally.diagnostics.errors.includes("missing_finally_block"));

        const missingFinishEvidence = await runHybridSpecGeneration({
          plan: buildPlanWithAuthFlowRequired(),
          deterministicDraft: buildAuthFlowSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            expectedResult: "authenticated session",
            auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3 }
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
          provider: buildProvider({
            ...baseResponse,
            specContent: buildAuthFlowSpec({ includeFinishEvidence: false }),
            declaredIdentifiers: ["homePage", "operationsMenuPage", "authFlow", "promotedRuntime"]
          })
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
        assert.ok(missingFinishEvidence.diagnostics.errors.includes("missing_finishEvidence_call"));
      });
    });

    await t.test("declared step without runtime implementation is blocked", async () => {
      const appPaths = await createTmpPaths();
      const response = {
        specContent: buildValidSpec().replace("stepIndex: 2", "stepIndex: 99"),
        coveredStepIndexes: [1, 2],
        coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
        usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
        declaredIdentifiers: ["homePage", "promotedRuntime"],
        unresolvedRequirements: [],
        warnings: []
      };
      await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
        const result = await runHybridSpecGeneration({
          plan: buildPlan(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          pageObjectRegistry: buildRegistry(appPaths.appDir),
          provider: buildProvider(response)
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
        assert.strictEqual(result.promotionAllowed, false);
        assert.ok(result.diagnostics.errors.some((error) => error.includes("step_not_implemented_in_spec:2")));
      });
    });

    await t.test("wrong auth flow order and invented credentials login are blocked", async () => {
      const appPaths = await createTmpPaths();
      const baseResponse = {
        coveredStepIndexes: [1, 2, 3, 4],
        coveredAssertions: [{ requirement: "auth gate visible", implementation: "await expect(page.locator('body')).toBeVisible();" }],
        usedPageObjects: [
          { className: "HomePage", methods: ["start"] },
          { className: "OperationsMenuPage", methods: ["openModule"] }
        ],
        unresolvedRequirements: [],
        warnings: []
      };
      await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
        const wrongOrder = await runHybridSpecGeneration({
          plan: buildPlanWithAuthFlowRequired(),
          deterministicDraft: buildAuthFlowSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            expectedResult: "authenticated session",
            auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3 }
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
          provider: buildProvider({
            ...baseResponse,
            specContent: buildAuthFlowSpec({ authBeforeStart: true }),
            declaredIdentifiers: ["homePage", "operationsMenuPage", "authFlow", "promotedRuntime"]
          })
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
        assert.ok(wrongOrder.diagnostics.errors.some((error) => error.includes("auth_flow_order_invalid")));

        const inventedCredentials = await runHybridSpecGeneration({
          plan: buildPlanWithAuthFlowRequired(),
          deterministicDraft: buildAuthFlowSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: { auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3 } },
          pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
          provider: buildProvider({
            ...baseResponse,
            specContent: buildAuthFlowSpec({ includeCredentialsLogin: true }),
            declaredIdentifiers: ["homePage", "operationsMenuPage", "authFlow", "promotedRuntime", "password"]
          })
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
        assert.ok(inventedCredentials.diagnostics.errors.includes("forbidden_credentials_login_for_auth_flow"));
      });
    });

    await t.test("assertion without observed evidence and nonexistent import are blocked", async () => {
      const appPaths = await createTmpPaths();
      const invalidAssertionSpec = `${buildAuthFlowSpec()}
  const authFlowLabel = page.getByText(/flujo de autenticación/i);
  await expect(authFlowLabel).toBeVisible();`;
      await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
        const invalidAssertion = await runHybridSpecGeneration({
          plan: buildPlanWithAuthFlowRequired(),
          deterministicDraft: buildAuthFlowSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            observedAssertions: ["Iniciar", "Transacciones y servicios"],
            auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3 }
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
          provider: buildProvider({
            specContent: invalidAssertionSpec,
            coveredStepIndexes: [1, 2, 3, 4],
            coveredAssertions: [{ requirement: "flujo autenticacion visible", implementation: "await expect(authFlowLabel).toBeVisible();" }],
            usedPageObjects: [
              { className: "HomePage", methods: ["start"] },
              { className: "OperationsMenuPage", methods: ["openModule"] }
            ],
            declaredIdentifiers: ["homePage", "operationsMenuPage", "authFlow", "promotedRuntime", "authFlowLabel"],
            unresolvedRequirements: [],
            warnings: []
          })
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
        assert.ok(invalidAssertion.diagnostics.errors.some((error) => error.includes("assertion_without_observed_evidence")));

        const invalidImport = await runHybridSpecGeneration({
          plan: buildPlan(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          pageObjectRegistry: buildRegistry(appPaths.appDir),
          provider: buildProvider({
            specContent: buildValidSpec().replace("../../pages/home.page", "../../pages/missing.page"),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          })
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
        assert.ok(invalidImport.diagnostics.errors.some((error) => error.includes("import_path_not_found:../../pages/missing.page")));
      });
  });

  await t.test("qa lab default propagates headless=true to playwright discovery and functional execution", async () => {
    const appPaths = await createTmpPaths();
    let discoveryLaunch: { source: string; headless: boolean | null } | undefined;
    let functionalLaunch: { source: string; headless: boolean | null } | undefined;

    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m",
      AUTOMATION_HEADLESS: undefined,
      HEADLESS: undefined,
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        headed: false,
        executionSource: "qalab",
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1, 2],
          coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible();" }],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: [],
        }),
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async (_specPath, launchContext) => {
          discoveryLaunch = launchContext;
          return passList(1);
        },
        runFunctionalExecution: async (_specPath, launchContext) => {
          functionalLaunch = launchContext;
          return passFunctional(2, 2);
        },
      });

      assert.strictEqual(result.diagnostics.validation.playwrightDiscovery, "passed");
      assert.strictEqual(result.diagnostics.validation.functionalExecution, "passed");
      assert.strictEqual(discoveryLaunch?.source, "qalab");
      assert.strictEqual(discoveryLaunch?.headless, true);
      assert.strictEqual(functionalLaunch?.source, "qalab");
      assert.strictEqual(functionalLaunch?.headless, true);
    });
  });

  await t.test("explicit headed=true propagates headless=false to functional execution", async () => {
    const appPaths = await createTmpPaths();
    let functionalLaunch: { source: string; headless: boolean | null } | undefined;

    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m",
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        headed: true,
        executionSource: "cli",
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1, 2],
          coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible();" }],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: [],
        }),
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async (_specPath, launchContext) => {
          functionalLaunch = launchContext;
          return passFunctional(2, 2);
        },
      });

      assert.strictEqual(result.diagnostics.validation.functionalExecution, "passed");
      assert.strictEqual(functionalLaunch?.headless, false);
      assert.strictEqual(functionalLaunch?.source, "cli");
    });
  });

  await t.test("undeclared identifier blocks promotion", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: buildValidSpec(),
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["productListPage"],
      unresolvedRequirements: [],
      warnings: []
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.some((e) => e.includes("undeclared_identifier:productListPage")));
    });
  });

  await t.test("non-existing page object method blocks promotion", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: buildValidSpec(),
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
      usedPageObjects: [{ className: "HomePage", methods: ["missingMethod"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.some((e) => e.includes("unknown_page_object_method:HomePage.missingMethod")));
    });
  });

  await t.test("omitted assertion blocks promotion", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: buildValidSpec(),
      coveredStepIndexes: [1, 2],
      coveredAssertions: [],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.some((e) => e.includes("assertions_not_covered")));
    });
  });

  await t.test("wrong SECTION_SLUG blocks promotion", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: buildValidSpec("default-section", "PREVIEW-001"),
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.some((e) => e.includes("process.env.SECTION_SLUG = 'detalle-kiosko';")));
    });
  });

  await t.test("wrong SCENARIO_ID blocks promotion", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: buildValidSpec("detalle-kiosko", "C0"),
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.some((e) => e.includes("process.env.SCENARIO_ID = 'PREVIEW-001';")));
    });
  });

  await t.test("UTF-8 damaged text blocks promotion", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: `${buildValidSpec()}\n// \uFFFD`,
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.includes("utf8_damaged_text_detected"));
    });
  });

  await t.test("invalid JSON response blocks promotion", async () => {
    const appPaths = await createTmpPaths();
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({ notSpec: true })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.strictEqual(result.diagnostics.validation.schema, "failed");
    });
  });

  await t.test("legacy response contract with spec is rejected without deterministic fallback", async () => {
    const appPaths = await createTmpPaths();
    let tsCalls = 0;
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          spec: buildValidSpec(),
          strategy: "pom_runtime",
          usedPageObjects: ["HomePage"],
          missingPageObjects: [],
          missingMethods: []
        } as unknown as Record<string, unknown>)
      }, {
        runTypeScriptValidation: async () => {
          tsCalls += 1;
          return passTs();
        },
        runPlaywrightDiscovery: async () => passList(1)
      });
      assert.strictEqual(result.promotionAllowed, false);
      assert.strictEqual(result.diagnostics.validation.schema, "failed");
      assert.ok(result.diagnostics.errors.some((e) => e.includes("legacy_contract_not_supported")));
      assert.strictEqual(tsCalls, 0);
    });
  });

  await t.test("usedPageObjects as string[] is rejected", async () => {
    const appPaths = await createTmpPaths();
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1, 2],
          coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
          usedPageObjects: ["HomePage"],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        } as unknown as Record<string, unknown>)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.some((e) => e.includes("usedPageObjects must be object[]")));
    });
  });

  await t.test("unknown promoted runtime method loginPromotedTarget is rejected", async () => {
    const appPaths = await createTmpPaths();
    const invalidRuntimeMethodSpec = buildValidSpec().replace(
      "await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', action: async () => { await homePage.start(); } });",
      "await promotedRuntime.loginPromotedTarget({ stepIndex: 1, target: 'auth_flow', actionIntent: 'authenticate', expectedEffect: 'ui_change', action: async () => { await homePage.start(); } });"
    );
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: invalidRuntimeMethodSpec,
          coveredStepIndexes: [1, 2],
          coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.includes("unknown_promoted_runtime_method:loginPromotedTarget"));
    });
  });

  await t.test("non-existing AuthFlow method blocks promotion", async () => {
    const appPaths = await createTmpPaths();
    const invalidAuthMethodSpec = buildAuthFlowSpec({ includeCredentialsLogin: false }).replace(
      "await authFlow.ensureAuthenticated({ alias: 'defaultClient', landing: 'transactions_menu' });",
      "await authFlow.ensureOtpCompleted({ alias: 'defaultClient', landing: 'transactions_menu' });"
    );
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlanWithAuthFlowRequired(),
        deterministicDraft: buildAuthFlowSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          expectedResult: "Autenticacion completada y sesion iniciada",
          auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3 }
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
        provider: buildProvider({
          specContent: invalidAuthMethodSpec,
          coveredStepIndexes: [1, 2, 3, 4],
          coveredAssertions: [{ requirement: "auth gate visible", implementation: "await expect(page.locator('body')).toBeVisible();" }],
          usedPageObjects: [
            { className: "HomePage", methods: ["start"] },
            { className: "OperationsMenuPage", methods: ["openModule"] }
          ],
          declaredIdentifiers: ["homePage", "operationsMenuPage", "authFlow", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.includes("unknown_auth_flow_method:ensureOtpCompleted"));
    });
  });

  await t.test("omitted login step in code blocks promotion", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: buildValidSpec(),
      coveredStepIndexes: [1, 2, 3],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlanWithLogin(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.some((e) => e.includes("step_not_implemented_in_spec:3")));
    });
  });

  await t.test("declared assertion not present in spec code is rejected", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: buildValidSpec(),
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('h1')).toContainText('Iniciar')" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.some((e) => e.includes("assertion_implementation_not_found")));
    });
  });

  await t.test("expected result not propagated is blocked", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: buildValidSpec(),
      coveredStepIndexes: [1],
      coveredAssertions: [],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          title: "Visualizacion inicial",
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          expectedResult: "|",
          preconditions: [],
          observedAssertions: []
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.includes("expected_result_not_propagated"));
    });
  });

  await t.test("validation path is created beside case.spec.ts for relative imports", async () => {
    const appPaths = await createTmpPaths();
    let validationPath = "";
    await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
      }, {
        runTypeScriptValidation: async (specPath: string) => {
          validationPath = specPath;
          return passTs();
        },
        runPlaywrightDiscovery: async () => passList(1)
      });
      assert.strictEqual(result.promotionAllowed, true);
      assert.ok(validationPath.startsWith(path.dirname(appPaths.specPath)));
      assert.ok(path.basename(validationPath).startsWith("case.validation-"));
    });
  });

  await t.test("provider timeout blocks promotion", async () => {
    const appPaths = await createTmpPaths();
    const provider: AiProvider = {
      providerType: "fake",
      providerName: "provider-test",
      model: "model-test",
      async completeJson() {
        throw new AiProviderError("ai_provider_timeout", "timeout");
      }
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.some((e) => e.includes("provider_error")));
    });
  });

  await t.test("pre-invocation provider creation error keeps invocationsConsumed=0", async () => {
    const appPaths = await createTmpPaths();
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
      }, {
        createProvider: async () => { throw new AiProviderError("ai_provider_config_missing", "missing"); },
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1)
      });
      assert.strictEqual(result.promotionAllowed, false);
      assert.strictEqual(result.diagnostics.invocationsConsumed, 0);
    });
  });

  await t.test("typescript gate detects unknown promoted runtime method", async () => {
    const appPaths = await createTmpPaths();
    const typedRuntimeSpec = [
      "import { test } from '@playwright/test';",
      "type RuntimeApi = { clickPromotedTarget: (options: { stepIndex: number; target: string; actionIntent: string; expectedEffect: string; action: () => Promise<void> }) => Promise<void>; finishEvidence: () => Promise<void>; };",
      "const createPromotedSpecRuntime = (_page: unknown): RuntimeApi => ({",
      "  clickPromotedTarget: async () => undefined,",
      "  finishEvidence: async () => undefined",
      "});",
      "test('Visualizacion inicial', async ({ page }) => {",
      "  process.env.APP_SLUG = 'arquitectura-automatizacion';",
      "  process.env.SECTION_SLUG = 'detalle-kiosko';",
      "  process.env.SCENARIO_ID = 'PREVIEW-001';",
      "  process.env.SCENARIO_TITLE = 'Visualizacion inicial';",
      "  const promotedRuntime = createPromotedSpecRuntime(page);",
      "  try {",
      "    await promotedRuntime.loginPromotedTarget({ stepIndex: 1, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', action: async () => undefined });",
      "  } finally {",
      "    await promotedRuntime.finishEvidence();",
      "  }",
      "});"
    ].join("\n");
    await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: typedRuntimeSpec,
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
      }, { runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.strictEqual(result.diagnostics.validation.typescript, "failed");
      assert.ok(result.diagnostics.errors.includes("unknown_promoted_runtime_method:loginPromotedTarget"));
    });
  });

  await t.test("missing tokens remain null", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: buildValidSpec(),
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response, undefined)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.diagnostics.usage.totalPhysicalTokens, null);
      assert.strictEqual(result.diagnostics.usage.credits, null);
    });
  });

  await t.test("batch response with four specs validates each target scenario", async () => {
    const appPaths = await createTmpPaths();
    const batchSpecs = ["PREVIEW-001", "PREVIEW-002", "PREVIEW-003", "PREVIEW-004"].map((id) => ({
      scenarioId: id,
      specContent: buildValidSpec("detalle-kiosko", id),
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    }));
    for (const id of ["PREVIEW-001", "PREVIEW-002", "PREVIEW-003", "PREVIEW-004"]) {
      await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "true", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
        const result = await runHybridSpecGeneration({
          plan: buildPlan(id),
          deterministicDraft: buildValidSpec("detalle-kiosko", id),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          pageObjectRegistry: buildRegistry(appPaths.appDir),
          provider: buildProvider({ specs: batchSpecs } as Record<string, unknown>)
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
        assert.strictEqual(result.promotionAllowed, true);
      });
    }
  });

  await t.test("invalid scenario in batch is rejected independently", async () => {
    const appPaths = await createTmpPaths();
    const specs = [
      {
        scenarioId: "PREVIEW-001",
        specContent: buildValidSpec("detalle-kiosko", "PREVIEW-001"),
        coveredStepIndexes: [1, 2],
        coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
        usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
        declaredIdentifiers: ["homePage", "promotedRuntime"],
        unresolvedRequirements: [],
        warnings: []
      },
      {
        scenarioId: "PREVIEW-002",
        specContent: buildValidSpec("default-section", "C0"),
        coveredStepIndexes: [1, 2],
        coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
        usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
        declaredIdentifiers: ["homePage", "promotedRuntime"],
        unresolvedRequirements: [],
        warnings: []
      }
    ];
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "true", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const valid = await runHybridSpecGeneration({
        plan: buildPlan("PREVIEW-001"),
        deterministicDraft: buildValidSpec("detalle-kiosko", "PREVIEW-001"),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({ specs } as Record<string, unknown>)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(valid.promotionAllowed, true);

      const invalid = await runHybridSpecGeneration({
        plan: buildPlan("PREVIEW-002"),
        deterministicDraft: buildValidSpec("detalle-kiosko", "PREVIEW-002"),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({ specs } as Record<string, unknown>)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(invalid.promotionAllowed, false);
    });
  });

  await t.test("deterministic mode works when AI spec generation is disabled", async () => {
    const appPaths = await createTmpPaths();
    await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, true);
      assert.strictEqual(result.diagnostics.mode, "deterministic");
      assert.strictEqual(result.diagnostics.invocations, 0);
    });
  });

  await t.test("first pass request includes observable oracles and promotes without repair", async () => {
    const appPaths = await createTmpPaths();
    const capture: { request?: AiCompletionRequest; calls?: number } = {};
    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan("PREVIEW-ORACLE-001"),
        deterministicDraft: buildValidSpec("detalle-kiosko", "PREVIEW-ORACLE-001"),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        sourceScenario: {
          title: "Visualizacion inicial",
          steps: [
            { index: 1, action: "navigate", description: "Ir a kiosco" },
            { index: 2, action: "click", description: "Iniciar sesión pública" },
          ],
          expectedResult: "La ruta pública dirige al módulo de información.",
          observedAssertions: [],
          observableOracles: [
            {
              id: "expected-01",
              requirement: "La ruta pública dirige al módulo de información.",
              type: "navigation_transition",
              backed: true,
              source: "discovery",
              stepIndex: 2,
              target: "Información de productos",
              evidence: ["transition_observed:true", "click_target:Información de productos"],
            }
          ],
        },
        provider: buildProvider({
          specContent: buildValidSpec("detalle-kiosko", "PREVIEW-ORACLE-001"),
          coveredStepIndexes: [1, 2],
          coveredAssertions: [
            { requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible();" },
            { requirement: "La ruta pública dirige al módulo de información.", implementation: "await expect(page.locator('body')).toBeVisible();" }
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        }, undefined, capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      const requestContent = String(capture.request?.messages[1]?.content ?? "");
      assert.ok(requestContent.includes("OBSERVABLE_ORACLES"));
      assert.ok(requestContent.includes("navigation_transition"));
      assert.strictEqual(result.promotionAllowed, true);
      assert.strictEqual(result.diagnostics.specGenerationAttempts, 1);
      assert.strictEqual(result.diagnostics.specRepairAttempts, 0);
      assert.strictEqual(result.diagnostics.firstPassPromotion, true);
    });
  });

  await t.test("deterministic flow is blocked when spec does not compile", async () => {
    const appPaths = await createTmpPaths();
    await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
      }, { runTypeScriptValidation: async () => failTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.strictEqual(result.diagnostics.validation.typescript, "failed");
    });
  });

  await t.test("playwright discovery must find exactly one test", async () => {
    const appPaths = await createTmpPaths();
    await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(2) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.strictEqual(result.diagnostics.validation.playwrightDiscovery, "failed");
    });
  });

  await t.test("playwright list is not sufficient when functional execution fails", async () => {
    const appPaths = await createTmpPaths();
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1, 2],
          coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => failFunctional(1, null)
      });
      assert.strictEqual(result.diagnostics.validation.playwrightDiscovery, "passed");
      assert.strictEqual(result.diagnostics.validation.functionalExecution, "failed");
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.some((error) => error.includes("functional_execution_failed")));
    });
  });

  await t.test("functional execution with evidence steps zero is rejected", async () => {
    const appPaths = await createTmpPaths();
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1, 2],
          coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => ({
          ...(await passFunctional(0, 0)),
          ok: true,
          evidenceSteps: 0
        })
      });
      assert.strictEqual(result.diagnostics.validation.functionalExecution, "failed");
      assert.strictEqual(result.promotionAllowed, false);
      assert.ok(result.diagnostics.errors.some((error) => error.includes("functional_execution_no_evidence_steps")));
    });
  });

  await t.test("repairable gate failure triggers one bounded AI repair attempt and can promote the repaired candidate", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    const invalidSpec = buildValidSpec().replace("await expect(page.locator('body')).toBeVisible();", "");
    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: invalidSpec,
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, true);
      assert.strictEqual(result.diagnostics.invocationsConsumed, 2);
      assert.strictEqual(result.diagnostics.specGenerationAttempts, 2);
      assert.strictEqual(result.diagnostics.specRepairAttempts, 1);
      assert.strictEqual(result.diagnostics.firstPassPromotion, false);
      assert.strictEqual(result.diagnostics.finalSpec.origin, "ai_candidate");
      assert.strictEqual(result.diagnostics.finalSpec.fallback, null);
      assert.ok(result.diagnostics.warnings.some((warning) => warning.includes("ai_repair_attempt_applied:1")));
      assert.strictEqual(capture.calls, 2);
      assert.ok(String(capture.requests[1]?.messages[1]?.content ?? "").includes("Fix exactly these failed gates"));
      assert.ok(String(capture.requests[1]?.messages[1]?.content ?? "").includes("REPAIR_CONTEXT"));
      assert.ok(String(capture.requests[1]?.messages[1]?.content ?? "").includes("EXECUTION_PLAN_FOCUS"));
    });
  });

  await t.test("single repair attempt exhausted keeps promotion blocked", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    const invalidSpec = buildValidSpec().replace("await expect(page.locator('body')).toBeVisible();", "");
    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: invalidSpec,
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: invalidSpec,
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      assert.strictEqual(result.diagnostics.invocationsConsumed, 2);
      assert.strictEqual(result.diagnostics.specGenerationAttempts, 2);
      assert.strictEqual(result.diagnostics.specRepairAttempts, 1);
      assert.strictEqual(result.diagnostics.firstPassPromotion, false);
      assert.strictEqual(capture.calls, 2);
    });
  });

  await t.test("repair context includes exact semantic coverage oracle error details", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        sourceScenario: {
          title: "Visualizacion inicial",
          observableOracles: [
            {
              id: "expected-01",
              requirement: "Boton iniciar visible",
              type: "heading_or_control",
              backed: true,
              source: "discovery",
              target: "Explora nuestros productos",
              evidence: ["resolved_target:Explora nuestros productos"],
              details: { historicalRequirement: "Información de productos", resolvedObservableTarget: "Explora nuestros productos" }
            }
          ],
        },
        provider: buildSequentialProvider([
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "requisito no relacionado", implementation: "await expect(page.locator('body')).toBeVisible();" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible();" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, true);
      const repairPayload = String(capture.requests[1]?.messages[1]?.content ?? "");
      assert.ok(repairPayload.includes("missing_assertion_oracle_context:"));
      assert.ok(repairPayload.includes("resolvedTarget=Explora nuestros productos"));
    });
  });

  await t.test("repair context includes exact playwright discovery stderr summary", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    let discoveryRuns = 0;
    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible();" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible();" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => {
          discoveryRuns += 1;
          if (discoveryRuns === 1) {
            return { ok: false, exitCode: 1, stdout: "", stderr: "Error: No tests found for candidate spec" };
          }
          return passList(1);
        }
      });
      assert.strictEqual(result.promotionAllowed, true);
      const repairPayload = String(capture.requests[1]?.messages[1]?.content ?? "");
      assert.ok(repairPayload.includes("playwright_discovery_error:Error: No tests found for candidate spec"));
    });
  });

  await t.test("repair attempt re-runs all validation gates before promotion", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    let tsRuns = 0;
    let listRuns = 0;
    let functionalRuns = 0;
    const invalidSpec = buildValidSpec().replace("await expect(page.locator('body')).toBeVisible();", "");
    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: invalidSpec,
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, {
        runTypeScriptValidation: async () => {
          tsRuns += 1;
          return passTs();
        },
        runPlaywrightDiscovery: async () => {
          listRuns += 1;
          return passList(1);
        },
        runFunctionalExecution: async () => {
          functionalRuns += 1;
          return passFunctional(2, 2);
        },
      });
      assert.strictEqual(result.promotionAllowed, true);
      assert.strictEqual(capture.calls, 2);
      assert.strictEqual(tsRuns, 2);
      assert.strictEqual(listRuns, 2);
      assert.strictEqual(functionalRuns, 2);
    });
  });

  await t.test("structural failure triggers one repair attempt and captures failed gates from attempt 1", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    const invalidImportSpec = buildValidSpec().replace("../../pages/home.page", "../../pages/missing.page");
    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: invalidImportSpec,
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, true);
      assert.strictEqual(capture.calls, 2);
      assert.ok(result.diagnostics.failedGatesAttempt1.includes("structuralValidation"));
    });
  });

  await t.test("B1 unresolved requirement error is surfaced in semantic repair payload with missing requirements and passed gates", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    const env = {
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    };
    const { logs, result } = await withCapturedLogs(() => withEnv(env, async () => {
      return runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: ["Boton iniciar visible"],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
    }));
    assert.strictEqual(result.promotionAllowed, true);
    assert.strictEqual(capture.calls, 2);
    assert.ok(result.diagnostics.missingRequirements.some((m) => m.text === "Boton iniciar visible"));
    assert.ok(result.diagnostics.missingRequirements.some((m) => m.type === "literal_visible_text"));
    assert.ok(logs.some((line) => line.startsWith("[semantic-coverage] missing=") && line.includes("Boton iniciar visible")));
    const repairPayload = String(capture.requests[1]?.messages[1]?.content ?? "");
    assert.ok(repairPayload.includes("unresolved_requirement:Boton iniciar visible"));
    assert.ok(repairPayload.includes("\"missingRequirements\""));
    assert.ok(repairPayload.includes("\"passedGatesAttempt1\""));
    assert.ok(repairPayload.includes("structuralValidation"));
  });

  await t.test("B2 missing requirement type follows the linked observable oracle", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    const env = {
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    };
    const result = await withEnv(env, async () => {
      return runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        sourceScenario: {
          title: "Visualizacion inicial",
          observableOracles: [
            {
              id: "expected-01",
              requirement: "Boton iniciar visible",
              type: "heading_or_control",
              backed: true,
              source: "discovery",
              target: "Explora nuestros productos",
              evidence: ["resolved_target:Explora nuestros productos"],
              details: { historicalRequirement: "Información de productos", resolvedObservableTarget: "Explora nuestros productos" }
            }
          ],
        },
        provider: buildSequentialProvider([
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: ["Boton iniciar visible"],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
    });
    assert.strictEqual(result.promotionAllowed, true);
    assert.ok(result.diagnostics.missingRequirements.some((m) => m.text === "Boton iniciar visible" && m.type === "heading_or_control"));
  });

  await t.test("B3 literal_visible_text type is inferred with stepIndex from scenario step", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    const env = {
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    };
    const result = await withEnv(env, async () => {
      return runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        sourceScenario: {
          title: "Visualizacion inicial",
          steps: [{ index: 2, action: 'Validar que se muestre "Boton iniciar visible".', expected: "Boton iniciar visible" }],
        },
        provider: buildSequentialProvider([
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: ["Boton iniciar visible"],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
    });
    assert.strictEqual(result.promotionAllowed, true);
    const missing = result.diagnostics.missingRequirements.find((m) => m.text === "Boton iniciar visible");
    assert.ok(missing);
    assert.strictEqual(missing.type, "literal_visible_text");
    assert.strictEqual(missing.stepIndex, 2);
  });

  await t.test("B4 no missing requirements are reported when semantic coverage passes", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: buildValidSpec(),
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      return runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
    });
    assert.strictEqual(result.promotionAllowed, true);
    assert.strictEqual(result.diagnostics.missingRequirements.length, 0);
  });

  await t.test("C1 functional execution failure surfaces the exact error line in the repair payload", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    let functionalRuns = 0;
    const env = {
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    };
    const { logs, result } = await withCapturedLogs(() => withEnv(env, async () => {
      return runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => {
          functionalRuns += 1;
          if (functionalRuns === 1) {
            return {
              ok: false,
              stdout: "",
              stderr: "Error: expect(received).toHaveText()\n\n  1) test failed\n\n  spec file: case.spec.ts:12:1",
              exitCode: 1,
              evidenceSteps: null,
              screenshots: 0,
              authGateDetected: null
            };
          }
          return passFunctional();
        }
      });
    }));
    assert.strictEqual(result.promotionAllowed, true);
    assert.strictEqual(capture.calls, 2);
    const repairPayload = String(capture.requests[1]?.messages[1]?.content ?? "");
    assert.ok(repairPayload.includes("functional_execution_failed:exitCode=1"));
    assert.ok(repairPayload.includes("functional_execution_error:Error: expect(received).toHaveText()"));
    assert.ok(logs.some((line) => line.startsWith("[functional-execution] exitCode=1 error=\"Error: expect(received).toHaveText()\" file=\"case.spec.ts:12:1\" line=\"test failed\" timeout=false")));
  });

  await t.test("C2 functional timeout failure is logged with timeout=true and the located error", async () => {
    const appPaths = await createTmpPaths();
    let functionalRuns = 0;
    const env = {
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    };
    const { logs, result } = await withCapturedLogs(() => withEnv(env, async () => {
      const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
      return runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => {
          functionalRuns += 1;
          if (functionalRuns === 1) {
            return {
              ok: false,
              stdout: "",
              stderr: "locator resolved to 0 elements\nTimeoutError: locator.click: Timeout 5000ms exceeded",
              exitCode: 1,
              evidenceSteps: null,
              screenshots: 0,
              authGateDetected: null
            };
          }
          return passFunctional();
        }
      });
    }));
    assert.strictEqual(result.promotionAllowed, true);
    const logLine = logs.find((line) => line.startsWith("[functional-execution]"));
    assert.ok(logLine);
    assert.ok(logLine.includes("exitCode=1"));
    assert.ok(logLine.includes("timeout=true"));
    assert.ok(logLine.includes("locator resolved to 0 elements"));
  });

  await t.test("C3 functional execution ok with zero evidence steps is rejected with no_evidence_steps error", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    const env = {
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    };
    const result = await withEnv(env, async () => {
      let functionalRuns = 0;
      return runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, {
        runTypeScriptValidation: async () => passTs(),
        runPlaywrightDiscovery: async () => passList(1),
        runFunctionalExecution: async () => {
          functionalRuns += 1;
          if (functionalRuns === 1) {
            return { ok: true, stdout: "", stderr: "", exitCode: 0, evidenceSteps: 0, screenshots: 0, authGateDetected: null };
          }
          return passFunctional();
        }
      });
    });
    assert.strictEqual(result.promotionAllowed, true);
    assert.strictEqual(capture.calls, 2);
    const repairPayload = String(capture.requests[1]?.messages[1]?.content ?? "");
    assert.ok(repairPayload.includes("functional_execution_no_evidence_steps:steps=0"));
  });

  await t.test("D1 repair that regresses a previously passed gate is rejected with regressedGates", async () => {
    const appPaths = await createTmpPaths();
    const env = {
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    };
    const semanticOnlyFailingSpec = buildValidSpec();
    const structuralFailingSpec = buildValidSpec().replace("await promotedRuntime.finishEvidence();", "");
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    const { logs, result } = await withCapturedLogs(() => withEnv(env, async () => {
      return runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: semanticOnlyFailingSpec,
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: ["Boton iniciar visible"],
            warnings: []
          },
          {
            specContent: structuralFailingSpec,
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
    }));
    assert.strictEqual(result.promotionAllowed, false);
    assert.ok(result.diagnostics.regressedGates.includes("structuralValidation"));
    assert.ok(result.diagnostics.errors.some((error) => error.startsWith("repair_rejected:regressed_gates:")));
    assert.ok(result.diagnostics.warnings.includes("repair_rejected_regressed_gates"));
    assert.ok(logs.some((line) => line.startsWith("[spec-repair] regressedGates=") && line.includes("structuralValidation")));
  });

  await t.test("D2 repair preserving previously passed gates promotes with no regressions", async () => {
    const appPaths = await createTmpPaths();
    const env = {
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    };
    const semanticFailingSpec = buildValidSpec().replace("await expect(page.locator('body')).toBeVisible();", "");
    const result = await withEnv(env, async () => {
      return runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: semanticFailingSpec,
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], { requests: [] as AiCompletionRequest[], calls: 0 })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
    });
    assert.strictEqual(result.promotionAllowed, true);
    assert.strictEqual(result.diagnostics.regressedGates.length, 0);
  });

  await t.test("D3 repair regression is detected across all gates including typescript", async () => {
    const appPaths = await createTmpPaths();
    const env = {
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    };
    const semanticFailingSpec = buildValidSpec().replace("await expect(page.locator('body')).toBeVisible();", "");
    let tsRuns = 0;
    const result = await withEnv(env, async () => {
      return runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: semanticFailingSpec,
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible()" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], { requests: [] as AiCompletionRequest[], calls: 0 })
      }, {
        runTypeScriptValidation: async () => {
          tsRuns += 1;
          return tsRuns === 1 ? passTs() : failTs();
        },
        runPlaywrightDiscovery: async () => passList(1)
      });
    });
    assert.strictEqual(result.promotionAllowed, false);
    assert.ok(result.diagnostics.regressedGates.includes("typescriptValidation"));
    assert.ok(result.diagnostics.errors.some((error) => error.startsWith("repair_rejected:regressed_gates:")));
  });

  /* await t.test("artifacts redact secrets TEMP", async () => {
    const appPaths = await createTmpPaths();
    const response = {
      specContent: `${buildValidSpec()}\n// password=secret123`,
      coveredStepIndexes: [1, 2],
      coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "ok" }],
      usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
      declaredIdentifiers: ["homePage", "promotedRuntime"],
      unresolvedRequirements: [],
      warnings: []
    };
    await withEnv({ AI_ENABLED: "true", AI_SPEC_GENERATION_ENABLED: "true", AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false", AI_SPEC_BATCH_PER_ISSUE: "false", AI_SPEC_PROVIDER: "copilot_cli", AI_SPEC_MODEL: "m" }, async () => {
      const result = await runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider(response)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      assert.strictEqual(result.promotionAllowed, false);
      const candidate = await fs.readFile(path.join(appPaths.caseDir!, "spec-generation", "candidate.spec.ts"), "utf-8");
      assert.strictEqual(candidate.includes("password="), false);
    }); */

  await t.test("A1 phantom login step without auth signals does not force auth", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithLogin("PREVIEW-001"),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=none"), joined);
    assert.ok(!joined.includes("[spec-auth-contract] mode=flow_execution"), joined);
    assert.ok(joined.includes("[spec-contract] contractValid=true"), joined);
  });

  await t.test("A2 explicit scenario auth requirement drives flow_execution contract", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithAuthFlowRequired(),
          deterministicDraft: buildAuthFlowSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: { auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3 } },
          pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    assert.ok(logs.join("\n").includes("[spec-auth-contract] mode=flow_execution"), logs.join("\n"));
  });

  await t.test("A3 plan metadata authFlowRequired drives flow_execution contract", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithAuthFlowRequired(),
          deterministicDraft: buildAuthFlowSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    assert.ok(logs.join("\n").includes("[spec-auth-contract] mode=flow_execution"), logs.join("\n"));
  });

  await t.test("A4 backed auth_gate oracle with login step drives flow_execution", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithLogin("PREVIEW-001"),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [
              { index: 1, action: "click", description: "Iniciar" },
              { index: 2, action: "assertVisible", description: "Validar boton iniciar" },
              { index: 3, action: "login", description: "Autenticarse" },
            ],
            observableOracles: [
              { id: "oracle-auth", requirement: "Se presenta el flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 3, evidence: ["auth_gate_detected:true"] },
            ],
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=flow_execution"), joined);
    assert.ok(joined.includes("backedAuthGateOracle=true"), joined);
  });

  await t.test("B5 observed catalog/knowledge text is not an authorized requirement source", async () => {
    const appPaths = await createTmpPaths();
    const { logs, result } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlan(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            observedAssertions: ["Descripción general del depósito a plazo", "Catálogo de productos y tasas"],
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-requirement-filter] reason=untraceable_requirement_source"), joined);
    assert.ok(
      !logs.some((log) => log.startsWith("[spec-requirement] ") && log.includes("Descripción general del depósito a plazo")),
      joined
    );
    assert.strictEqual(result.promotionAllowed, true);
  });

  await t.test("B6 scenario step expected is an authorized requirement", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlan(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [
              { index: 1, action: "click", description: "Iniciar" },
              { index: 2, action: "assertVisible", description: "Validar boton iniciar", expected: "Boton iniciar visible" },
            ],
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("id=scenario-step-2 source=scenario_step"), joined);
    assert.ok(!joined.includes("id=plan-step-2 source=validated_plan"), joined);
    assert.ok(joined.includes("[spec-contract] contractValid=true"), joined);
  });

  await t.test("B7 validated plan step is an authorized requirement", async () => {
    const appPaths = await createTmpPaths();
    const { logs, result } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlan(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("id=plan-step-2 source=validated_plan"), joined);
    assert.ok(joined.includes("[spec-contract] contractValid=true"), joined);
    assert.strictEqual(result.promotionAllowed, true);
  });

  await t.test("B8 traceable observable oracle is an authorized requirement", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlan(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            observableOracles: [
              { id: "oracle-01", requirement: "La ruta pública dirige al módulo de información.", type: "navigation_transition", backed: true, source: "discovery", stepIndex: 2, target: "Información de productos", evidence: ["transition_observed:true"] },
            ],
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("id=oracle-01 source=observable_oracle"), joined);
    assert.ok(joined.includes("oracleType=navigation_transition backed=true required=true"), joined);
    assert.ok(joined.includes("[spec-contract] contractValid=true"), joined);
  });

  await t.test("B9 unsupported unresolved oracle is still an authorized requirement that must block", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlan(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            observableOracles: [
              { id: "expected-01", requirement: "Tasas y beneficios mostrados", type: "unsupported_or_unresolved", backed: false, source: "discovery", evidence: [] },
            ],
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("id=expected-01 source=observable_oracle"), joined);
    assert.ok(joined.includes("oracleType=unsupported_or_unresolved backed=false required=true"), joined);
    assert.ok(joined.includes("[spec-contract] contractValid=false"), joined);
  });

  await t.test("C10 required unresolved oracle blocks promotion with zero attempts and no AI call", async () => {
    const appPaths = await createTmpPaths();
    const capture: { request?: AiCompletionRequest; calls?: number } = {};
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          observableOracles: [
            { id: "expected-01", requirement: "Tasas y beneficios mostrados", type: "unsupported_or_unresolved", backed: false, source: "discovery", evidence: [] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1, 2],
          coveredAssertions: [],
          usedPageObjects: [],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        }, undefined, capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, false);
    assert.strictEqual(result.diagnostics.specGenerationAttempts, 0);
    assert.strictEqual(result.diagnostics.specRepairAttempts, 0);
    assert.ok(
      result.diagnostics.errors.some((error) => error.startsWith("promotion_oracle_gate:unresolved_required_requirement:Tasas y beneficios mostrados")),
      result.diagnostics.errors.join("\n")
    );
    assert.ok(
      result.diagnostics.warnings.some((warning) => warning.includes("promotion_oracle_gate:contract_invalid")),
      result.diagnostics.warnings.join("\n")
    );
    assert.strictEqual(capture.calls, undefined);
  });

  await t.test("C11 contextual inferred oracle does not block promotion", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
      runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          observableOracles: [
            { id: "inferred-01", requirement: "Contexto supuesto", type: "literal_visible_text", source: "inferred", backed: false, evidence: [] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, true);
    assert.ok(!result.diagnostics.errors.some((error) => error.startsWith("promotion_oracle_gate:")), result.diagnostics.errors.join("\n"));
  });

  await t.test("C12 expected result with no enforceable assertions emits gate errors", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          expectedResult: "Resultado esperado no evidenciado",
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, false);
    assert.strictEqual(result.diagnostics.specGenerationAttempts, 0);
    assert.ok(result.diagnostics.errors.includes("expected_result_not_propagated"), result.diagnostics.errors.join("\n"));
    assert.ok(
      result.diagnostics.errors.some((error) => error.startsWith("promotion_oracle_gate:unresolved_required_requirement:Resultado esperado no evidenciado")),
      result.diagnostics.errors.join("\n")
    );
    assert.strictEqual(result.diagnostics.missingRequirements.length, 1);
  });

  await t.test("D13 auth narrative expected result is covered by gate observation", async () => {
    const appPaths = await createTmpPaths();
    const { logs, result } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar" }],
            expectedResult: "Se inicia el flujo de autenticación",
            auth: { gateDetected: true },
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=gate_observation"), joined);
    assert.ok(joined.includes("reason=auth_flow_covers_expected_result"), joined);
    assert.ok(!result.diagnostics.errors.some((error) => error.startsWith("promotion_oracle_gate:")), result.diagnostics.errors.join("\n"));
  });

  await t.test("D14 auth narrative expected result with required auth stays flow_execution", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar" }],
            expectedResult: "Se inicia el flujo de autenticación",
            auth: { required: true, gateDetected: true },
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=flow_execution"), joined);
    assert.ok(joined.includes("reason=auth_flow_covers_expected_result"), joined);
  });

  await t.test("D15 backed auth_gate oracle alone drives gate observation", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar" }],
            observableOracles: [
              { id: "oracle-auth", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 1, evidence: [] },
            ],
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=gate_observation"), joined);
    assert.ok(joined.includes("backedAuthGateOracle=true"), joined);
  });

  await t.test("E16 AI coverage of unauthorized catalog/knowledge requirement is extraneous", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1, 2],
          coveredAssertions: [
            { requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible();" },
            { requirement: "Catálogo de productos y tasas", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, false);
    assert.ok(
      result.diagnostics.errors.some((error) => error.includes("extraneous_requirement:Catálogo de productos y tasas")),
      result.diagnostics.errors.join("\n")
    );
  });

  await t.test("E17 auth flow covers expected result without expected_result_not_propagated", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          expectedResult: "Se completa el flujo de autenticación",
          auth: { required: true, gateDetected: true },
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.ok(!result.diagnostics.errors.includes("expected_result_not_propagated"), result.diagnostics.errors.join("\n"));
    assert.ok(!result.diagnostics.errors.some((error) => error.startsWith("promotion_oracle_gate:")), result.diagnostics.errors.join("\n"));
  });

  await t.test("E18 auth-flow-covered assertion is not extraneous", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithAuthFlowRequired(),
        deterministicDraft: buildAuthFlowSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: { auth: { required: true, gateDetected: true, insertionAfterStepIndex: 3 } },
        pageObjectRegistry: buildRegistry(appPaths.appDir, { includeOperationsMenu: true }),
        provider: buildProvider({
          specContent: buildAuthFlowSpec(),
          coveredStepIndexes: [1, 2, 3, 4],
          coveredAssertions: [
            { requirement: "flujo de autenticación", implementation: "await authFlow.ensureAuthenticated({ alias: 'defaultClient', landing: 'transactions_menu' });" },
          ],
          usedPageObjects: [
            { className: "HomePage", methods: ["start"] },
            { className: "OperationsMenuPage", methods: ["openModule"] },
          ],
          declaredIdentifiers: ["homePage", "operationsMenuPage", "authFlow", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.ok(
      !result.diagnostics.errors.some((error) => error.includes("extraneous_requirement:flujo de autenticación")),
      result.diagnostics.errors.join("\n")
    );
  });

  await t.test("F19 clean first pass does not attempt repair", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "2",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1, 2],
          coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible();" }],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, true);
    assert.strictEqual(result.diagnostics.specGenerationAttempts, 1);
    assert.strictEqual(result.diagnostics.specRepairAttempts, 0);
    assert.strictEqual(result.diagnostics.firstPassPromotion, true);
  });

  await t.test("F20 repair is attempted for non-contract validation failures", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    const invalidSpec = buildValidSpec().replace("await expect(page.locator('body')).toBeVisible();", "");
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: invalidSpec,
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible();" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1, 2],
            coveredAssertions: [{ requirement: "Boton iniciar visible", implementation: "await expect(page.locator('body')).toBeVisible();" }],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          }
        ], capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, true);
    assert.strictEqual(result.diagnostics.specGenerationAttempts, 2);
    assert.strictEqual(result.diagnostics.specRepairAttempts, 1);
    assert.strictEqual(result.diagnostics.firstPassPromotion, false);
    assert.strictEqual(capture.calls, 2);
  });

  await t.test("F21 contract-invalid input is never sent to AI repair", async () => {
    const appPaths = await createTmpPaths();
    const capture = { requests: [] as AiCompletionRequest[], calls: 0 };
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "3",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlan(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          observableOracles: [
            { id: "expected-01", requirement: "Tasas y beneficios mostrados", type: "unsupported_or_unresolved", backed: false, source: "discovery", evidence: [] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          { specContent: buildValidSpec(), coveredStepIndexes: [1, 2], coveredAssertions: [], usedPageObjects: [], declaredIdentifiers: ["homePage", "promotedRuntime"], unresolvedRequirements: [], warnings: [] },
          { specContent: buildValidSpec(), coveredStepIndexes: [1, 2], coveredAssertions: [], usedPageObjects: [], declaredIdentifiers: ["homePage", "promotedRuntime"], unresolvedRequirements: [], warnings: [] },
          { specContent: buildValidSpec(), coveredStepIndexes: [1, 2], coveredAssertions: [], usedPageObjects: [], declaredIdentifiers: ["homePage", "promotedRuntime"], unresolvedRequirements: [], warnings: [] },
        ], capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, false);
    assert.strictEqual(result.diagnostics.specGenerationAttempts, 0);
    assert.strictEqual(result.diagnostics.specRepairAttempts, 0);
    assert.strictEqual(capture.calls, 0);
  });

  await t.test("G22 mojibake-equivalent oracle requirement matches normalized semantic coverage", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "reconciled-auth-2", requirement: "flujo de autenticaci\u00c3\u00b3n", type: "auth_gate", backed: true, source: "discovery", stepIndex: 2, evidence: ["auth_gate_detected:true"] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1],
          coveredAssertions: [
            { requirement: "flujo de autenticación", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, true, result.diagnostics.errors.join("\n"));
    assert.ok(
      !result.diagnostics.errors.some((error) => error.startsWith("missing_assertion_coverage:")),
      result.diagnostics.errors.join("\n")
    );
    assert.ok(
      !result.diagnostics.errors.some((error) => error.startsWith("extraneous_requirement:")),
      result.diagnostics.errors.join("\n")
    );
  });

  await t.test("G23 reconciled auth_gate observation drives gate_observation, not flow_execution or literal", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [
              { index: 1, action: "click", description: "Iniciar" },
              { index: 2, action: "assertVisible", description: 'Validar que se muestre "flujo de autenticación".' },
            ],
            observedAssertions: [],
            auth: { gateDetected: true },
            observableOracles: [
              { id: "reconciled-auth-2", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 2, evidence: ["auth_gate_detected:true", "satisfied_by:auth_gate"] },
            ],
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=gate_observation"), joined);
    assert.ok(!joined.includes("[spec-auth-contract] mode=flow_execution"), joined);
    assert.ok(joined.includes("backedAuthGateOracle=true"), joined);
    assert.ok(
      !logs.some((log) => log.startsWith("[spec-requirement] ") && log.includes("type=literal_visible_text") && log.includes("flujo de autenticación")),
      joined
    );
  });

  await t.test("H1 scenario without auth resolves to none contract", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: { steps: [{ index: 1, action: "click", description: "Iniciar" }] },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=none"), joined);
    assert.ok(!joined.includes("[spec-auth-contract] mode=flow_execution"), joined);
    assert.ok(!joined.includes("[spec-auth-outcome] mode=flow_execution"), joined);
  });

  await t.test("H2 auth narrative without explicit requirement never resolves to flow_execution", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar el flujo de autenticación" }],
            expectedResult: "Se inicia el flujo de autenticación",
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=none"), joined);
    assert.ok(!joined.includes("[spec-auth-contract] mode=flow_execution"), joined);
    assert.ok(!joined.includes("[spec-auth-outcome] mode=flow_execution"), joined);
  });

  await t.test("H3 backed auth_gate with gate objective resolves to gate_observation", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar" }],
            auth: { gateDetected: true },
            observableOracles: [
              { id: "oracle-auth", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 1, evidence: ["auth_gate_detected:true"] },
            ],
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=gate_observation"), joined);
    assert.ok(joined.includes("[spec-auth-outcome] mode=gate_observation source=backed_auth_gate reason=scenario_requires_auth_gate_observation"), joined);
    assert.ok(!joined.includes("[spec-auth-outcome] mode=flow_execution"), joined);
  });

  await t.test("H4 expectedResult with 'autenticada' never elevates gate_observation to flow_execution", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar" }],
            expectedResult: "La opcion autenticada inicia la barrera de autenticacion.",
            auth: { gateDetected: true },
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=gate_observation"), joined);
    assert.ok(joined.includes("[spec-auth-outcome] mode=gate_observation source=backed_auth_gate"), joined);
    assert.ok(!joined.includes("[spec-auth-outcome] mode=flow_execution"), joined);
  });

  await t.test("H5 APP_LOGIN_MODE=password does not change gate_observation to flow_execution", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false", APP_LOGIN_MODE: "password", APP_USERNAME: "u", APP_PASSWORD: "p" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar" }],
            auth: { gateDetected: true },
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-outcome] mode=gate_observation"), joined);
    assert.ok(!joined.includes("[spec-auth-outcome] mode=flow_execution"), joined);
  });

  await t.test("H6 available auth flow does not change gate_observation to flow_execution", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar" }],
            auth: { gateDetected: true },
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-outcome] mode=gate_observation source=backed_auth_gate"), joined);
    assert.ok(!joined.includes("[spec-auth-outcome] mode=flow_execution"), joined);
  });

  await t.test("H7 explicit login step with validated auth completion resolves to flow_execution", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithLogin(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [
              { index: 1, action: "click", description: "Iniciar" },
              { index: 3, action: "login", description: "Autenticarse" },
            ],
            auth: { required: true, gateDetected: true },
            observableOracles: [
              { id: "oracle-auth", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 3, evidence: ["auth_gate_detected:true"] },
            ],
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=flow_execution"), joined);
    assert.ok(joined.includes("[spec-auth-outcome] mode=flow_execution source=validated_auth_completion reason=explicit_validated_auth_completion_authority stepIndex=3"), joined);
  });

  await t.test("H8 metadata.authFlowRequired backed by a real requirement resolves to flow_execution", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithAuthFlowRequired(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar" }],
            auth: { required: true, gateDetected: true },
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-contract] mode=flow_execution"), joined);
    assert.ok(joined.includes("[spec-auth-outcome] mode=flow_execution"), joined);
  });

  await t.test("H9 global login config alone never resolves to flow_execution", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false", APP_LOGIN_MODE: "password", APP_USERNAME: "u", APP_PASSWORD: "p", Identity_Provider: "1", OTP_SECRET: "s" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar" }],
            auth: { gateDetected: true },
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-outcome] mode=gate_observation"), joined);
    assert.ok(!joined.includes("[spec-auth-outcome] mode=flow_execution"), joined);
  });

  await t.test("H10 gate_observation semantic coverage never requires ensureAuthenticated", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          auth: { gateDetected: true },
          observableOracles: [
            { id: "oracle-auth", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 1, evidence: ["auth_gate_detected:true"] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.ok(
      !result.diagnostics.errors.includes("missing_auth_flow_ensure_authenticated"),
      result.diagnostics.errors.join("\n")
    );
    assert.ok(
      !result.diagnostics.errors.some((error) => error.startsWith("missing_auth_flow_ensure_authenticated")),
      result.diagnostics.errors.join("\n")
    );
  });

  await t.test("H11 flow_execution semantic coverage may require the auth flow", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithLogin(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [
            { index: 1, action: "click", description: "Iniciar" },
            { index: 3, action: "login", description: "Autenticarse" },
          ],
          auth: { required: true, gateDetected: true },
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.ok(
      result.diagnostics.errors.includes("missing_auth_flow_ensure_authenticated"),
      result.diagnostics.errors.join("\n")
    );
  });

  await t.test("H12 gate_observation never flips to flow_execution without explicit authority", async () => {
    const appPaths = await createTmpPaths();
    const { logs } = await withCapturedLogs(() =>
      withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar" }],
            expectedResult: "La opcion autenticada inicia la barrera de autenticacion.",
            auth: { gateDetected: true },
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
        }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
      )
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("[spec-auth-outcome] mode=gate_observation"), joined);
    assert.ok(!joined.includes("[spec-auth-outcome] mode=flow_execution"), joined);
    assert.ok(!joined.includes("[spec-auth-invariant]"), joined);
  });

  await t.test("M1 already-correct text is preserved", () => {
    assert.strictEqual(normalizeMojibakeUtf8("autenticación"), "autenticación");
  });

  await t.test("M2 single-level UTF-8 mojibake decodes", () => {
    assert.strictEqual(normalizeMojibakeUtf8("autenticaciÃ³n"), "autenticación");
  });

  await t.test("M3 double-level UTF-8 mojibake decodes", () => {
    assert.strictEqual(normalizeMojibakeUtf8("autenticaciÃƒÂ³n"), "autenticación");
  });

  await t.test("M4 multiple corrupted characters normalize together", () => {
    const source = "Cédula de identificación señor";
    const corrupted = mojibakeEncodeLevel(mojibakeEncodeLevel(source));
    assert.strictEqual(normalizeMojibakeUtf8(corrupted), source);
  });

  await t.test("M5 legit Unicode beyond latin-1 is preserved", () => {
    assert.strictEqual(normalizeMojibakeUtf8("日本語"), "日本語");
    assert.strictEqual(normalizeMojibakeUtf8("€"), "€");
  });

  await t.test("M6 common legit Spanish text is preserved", () => {
    assert.strictEqual(normalizeMojibakeUtf8("¿Qué deseas realizar hoy?"), "¿Qué deseas realizar hoy?");
    assert.strictEqual(normalizeMojibakeUtf8("Cédula de identidad dominicana"), "Cédula de identidad dominicana");
    assert.strictEqual(normalizeMojibakeUtf8("Información"), "Información");
    assert.strictEqual(normalizeMojibakeUtf8("señal"), "señal");
    assert.strictEqual(normalizeMojibakeUtf8("José"), "José");
  });

  await t.test("M7 level-2 candidate assertion matches level-0 requirement", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "oracle-auth", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 1, evidence: ["auth_gate_detected:true"] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1],
          coveredAssertions: [
            { requirement: "flujo de autenticaci\u00c3\u0192\u00c2\u00b3n", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, true, result.diagnostics.errors.join("\n"));
    assert.ok(
      !result.diagnostics.errors.some((error) => error.startsWith("missing_assertion_coverage:")),
      result.diagnostics.errors.join("\n")
    );
    assert.ok(
      !result.diagnostics.errors.some((error) => error.startsWith("extraneous_requirement:")),
      result.diagnostics.errors.join("\n")
    );
  });

  await t.test("M8 level-1 candidate assertion matches level-0 oracle", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "oracle-auth", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 1, evidence: ["auth_gate_detected:true"] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1],
          coveredAssertions: [
            { requirement: "flujo de autenticaci\u00c3\u00b3n", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, true, result.diagnostics.errors.join("\n"));
    assert.ok(
      !result.diagnostics.errors.some((error) => error.startsWith("missing_assertion_coverage:")),
      result.diagnostics.errors.join("\n")
    );
    assert.ok(
      !result.diagnostics.errors.some((error) => error.startsWith("extraneous_requirement:")),
      result.diagnostics.errors.join("\n")
    );
  });

  await t.test("M9 functionally different candidate assertion does not match", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "oracle-auth", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 1, evidence: ["auth_gate_detected:true"] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1],
          coveredAssertions: [
            { requirement: "procesar la transacción", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, false);
    assert.ok(
      result.diagnostics.errors.some((error) => error.startsWith("missing_assertion_coverage:flujo de autenticación")),
      result.diagnostics.errors.join("\n")
    );
  });

  await t.test("M10 mojibake normalization cannot validate a real extraneous requirement", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "oracle-auth", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 1, evidence: ["auth_gate_detected:true"] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1],
          coveredAssertions: [
            { requirement: "flujo de autenticaci\u00c3\u0192\u00c2\u00b3n del kiosko", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, false);
    assert.ok(
      result.diagnostics.errors.some((error) => error.startsWith("extraneous_requirement:")),
      result.diagnostics.errors.join("\n")
    );
  });

  await t.test("M11 max iterations are bounded (no unbounded decode)", () => {
    let fourLevels = "ó";
    for (let i = 0; i < 4; i += 1) fourLevels = mojibakeEncodeLevel(fourLevels);
    assert.notStrictEqual(normalizeMojibakeUtf8(fourLevels), "ó");
    let threeLevels = "ó";
    for (let i = 0; i < 3; i += 1) threeLevels = mojibakeEncodeLevel(threeLevels);
    assert.strictEqual(normalizeMojibakeUtf8(threeLevels), "ó");
  });

  await t.test("M12 stable text terminates immediately (no infinite loop)", () => {
    assert.strictEqual(normalizeMojibakeUtf8("Hello World"), "Hello World");
    assert.strictEqual(normalizeMojibakeUtf8("autenticación"), "autenticación");
    assert.strictEqual(normalizeMojibakeUtf8("日本語"), "日本語");
  });

  function buildSpecWithExpectTarget(target: string): string {
    return buildValidSpec().replace("stepIndex: 2, target: 'Iniciar'", `stepIndex: 2, target: '${target}'`);
  }

  await t.test("A1 technical auth metadata present is never converted into a UI target", async () => {
    const appPaths = await createTmpPaths();
    const capture: { request?: AiCompletionRequest; calls?: number } = {};
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "reconciled-auth-2", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 2, evidence: ["auth_gate_detected:true", "auth_stage:unknown"] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1],
          coveredAssertions: [
            { requirement: "flujo de autenticación", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        }, undefined, capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    const requestContent = String(capture.request?.messages[1]?.content ?? "");
    assert.strictEqual(result.promotionAllowed, true, result.diagnostics.errors.join("\n"));
    assert.ok(requestContent.includes("ORACLE_IMPLEMENTATIONS"));
    assert.ok(requestContent.includes('"oracleType": "auth_gate"'));
    assert.ok(requestContent.includes('"implementationKind": "runtime_auth_state"'));
    const phrasesMatch = requestContent.match(/"observedEvidencePhrases":\s*\[([^\]]*)\]/);
    const phrasesJson = phrasesMatch?.[1] ?? "";
    assert.ok(!phrasesJson.includes("auth_gate_detected:true"), "technical metadata leaked into observed evidence phrases");
    assert.ok(!phrasesJson.includes("auth_stage:unknown"), "technical metadata leaked into observed evidence phrases");
    assert.ok(
      !result.diagnostics.errors.some((error) => error.startsWith("technical_metadata_used_as_runtime_target:")),
      result.diagnostics.errors.join("\n")
    );
  });

  for (const technicalTarget of ["auth_gate_detected:true", "auth_stage:foo", "gateType:customer_identification_otp", "backed:true", "confidence:0.95", "auth_gate"]) {
    await t.test(`A2-A6 runtime target gate rejects technical metadata target '${technicalTarget}'`, async () => {
      const appPaths = await createTmpPaths();
      let functionalExecutions = 0;
      const result = await withEnv({
        AI_ENABLED: "true",
        AI_SPEC_GENERATION_ENABLED: "true",
        AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "true",
        AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
        AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
        AI_SPEC_BATCH_PER_ISSUE: "false",
        AI_SPEC_PROVIDER: "copilot_cli",
        AI_SPEC_MODEL: "m"
      }, async () =>
        runHybridSpecGeneration({
          plan: buildPlanWithoutAssertions(),
          deterministicDraft: buildValidSpec(),
          appProfile: buildProfile(),
          appPaths,
          sectionSlug: "detalle-kiosko",
          sourceScenario: {
            steps: [{ index: 1, action: "click", description: "Iniciar" }],
            observedAssertions: [],
            observableOracles: [
              { id: "reconciled-auth-2", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 2, evidence: ["auth_gate_detected:true"] },
            ],
          },
          pageObjectRegistry: buildRegistry(appPaths.appDir),
          provider: buildProvider({
            specContent: buildSpecWithExpectTarget(technicalTarget),
            coveredStepIndexes: [1],
            coveredAssertions: [
              { requirement: "flujo de autenticación", implementation: "await expect(page.locator('body')).toBeVisible();" },
            ],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          })
        }, {
          runTypeScriptValidation: async () => passTs(),
          runPlaywrightDiscovery: async () => passList(1),
          runFunctionalExecution: async () => {
            functionalExecutions += 1;
            return passFunctional(2, 1);
          },
        })
      );
      assert.strictEqual(result.promotionAllowed, false);
      assert.strictEqual(result.diagnostics.validation.structure, "failed");
      assert.strictEqual(functionalExecutions, 0, "functional execution must be short-circuited before the technical target gate");
      assert.ok(
        result.diagnostics.errors.some((error) => error.startsWith(`technical_metadata_used_as_runtime_target:stepIndex=2:target="${technicalTarget}"`)),
        result.diagnostics.errors.join("\n")
      );
    });
  }

  await t.test("A7 real heading/control target passes the runtime target gate", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "reconciled-auth-2", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 2, evidence: ["auth_gate_detected:true"] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1],
          coveredAssertions: [
            { requirement: "flujo de autenticación", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, true, result.diagnostics.errors.join("\n"));
    assert.strictEqual(result.diagnostics.validation.structure, "passed");
    assert.ok(
      !result.diagnostics.errors.some((error) => error.startsWith("technical_metadata_used_as_runtime_target:")),
      result.diagnostics.errors.join("\n")
    );
  });

  await t.test("A8 ORACLE_IMPLEMENTATIONS provides a runtime_auth_state descriptor for backed auth_gate without stage/url", async () => {
    const appPaths = await createTmpPaths();
    const capture: { request?: AiCompletionRequest; calls?: number } = {};
    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      await runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "reconciled-auth-2", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 2, evidence: ["auth_gate_detected:true"] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1],
          coveredAssertions: [
            { requirement: "flujo de autenticación", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        }, undefined, capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      const requestContent = String(capture.request?.messages[1]?.content ?? "");
      assert.ok(requestContent.includes("ORACLE_IMPLEMENTATIONS"));
      assert.ok(requestContent.includes('"implementationKind": "runtime_auth_state"'), requestContent);
    });
  });

  await t.test("A9 auth_gate with details.stage maps to an auth_stage descriptor with expectedStage", async () => {
    const appPaths = await createTmpPaths();
    const capture: { request?: AiCompletionRequest; calls?: number } = {};
    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      await runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "oracle-stage", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 2, evidence: ["auth_gate_detected:true"], details: { stage: "otp_verification" } },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1],
          coveredAssertions: [
            { requirement: "flujo de autenticación", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        }, undefined, capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      const requestContent = String(capture.request?.messages[1]?.content ?? "");
      assert.ok(requestContent.includes('"implementationKind": "auth_stage"'), requestContent);
      assert.ok(requestContent.includes('"expectedStage": "otp_verification"'), requestContent);
    });
  });

  await t.test("A10 auth_gate with details.expectedUrl maps to a url_state descriptor with expectedUrlPattern", async () => {
    const appPaths = await createTmpPaths();
    const capture: { request?: AiCompletionRequest; calls?: number } = {};
    await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () => {
      await runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "oracle-url", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 2, evidence: ["auth_gate_detected:true"], details: { expectedUrl: "/login" } },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildValidSpec(),
          coveredStepIndexes: [1],
          coveredAssertions: [
            { requirement: "flujo de autenticación", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        }, undefined, capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) });
      const requestContent = String(capture.request?.messages[1]?.content ?? "");
      assert.ok(requestContent.includes('"implementationKind": "url_state"'), requestContent);
      assert.ok(requestContent.includes('"expectedUrlPattern": "/login"'), requestContent);
    });
  });

  await t.test("A11 repair receives the failed technical target and a fixed candidate promotes", async () => {
    const appPaths = await createTmpPaths();
    const capture: { requests: AiCompletionRequest[]; calls?: number } = { requests: [] };
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "false",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "1",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "reconciled-auth-2", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 2, evidence: ["auth_gate_detected:true"] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildSequentialProvider([
          {
            specContent: buildSpecWithExpectTarget("auth_gate_detected:true"),
            coveredStepIndexes: [1],
            coveredAssertions: [
              { requirement: "flujo de autenticación", implementation: "await expect(page.locator('body')).toBeVisible();" },
            ],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
          {
            specContent: buildValidSpec(),
            coveredStepIndexes: [1],
            coveredAssertions: [
              { requirement: "flujo de autenticación", implementation: "await expect(page.locator('body')).toBeVisible();" },
            ],
            usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
            declaredIdentifiers: ["homePage", "promotedRuntime"],
            unresolvedRequirements: [],
            warnings: []
          },
        ], capture)
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, true, result.diagnostics.errors.join("\n"));
    assert.strictEqual(result.diagnostics.specRepairAttempts, 1);
    assert.strictEqual(capture.calls, 2);
    const repairRequestContent = String(capture.requests[1]?.messages[1]?.content ?? "");
    assert.ok(repairRequestContent.includes('"failedTarget": "auth_gate_detected:true"'), repairRequestContent);
    assert.ok(repairRequestContent.includes("technical_metadata_used_as_runtime_target"), repairRequestContent);
    assert.ok(repairRequestContent.includes("Do not use technical evidence metadata"), repairRequestContent);
  });

  await t.test("A12 gate_start_only canonical fallback is exempted from the technical target gate", async () => {
    const appPaths = await createTmpPaths();
    const result = await withEnv({
      AI_ENABLED: "true",
      AI_SPEC_GENERATION_ENABLED: "true",
      AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED: "false",
      AI_SPEC_ALLOW_DETERMINISTIC_FALLBACK: "true",
      AI_SPEC_REPAIR_MAX_ATTEMPTS: "0",
      AI_SPEC_BATCH_PER_ISSUE: "false",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "m"
    }, async () =>
      runHybridSpecGeneration({
        plan: buildPlanWithoutAssertions(),
        deterministicDraft: buildValidSpec(),
        appProfile: buildProfile(),
        appPaths,
        sectionSlug: "detalle-kiosko",
        sourceScenario: {
          steps: [{ index: 1, action: "click", description: "Iniciar" }],
          observedAssertions: [],
          observableOracles: [
            { id: "reconciled-auth-2", requirement: "flujo de autenticación", type: "auth_gate", backed: true, source: "discovery", stepIndex: 2, evidence: ["auth_gate_detected:true"] },
          ],
        },
        pageObjectRegistry: buildRegistry(appPaths.appDir),
        provider: buildProvider({
          specContent: buildSpecWithExpectTarget("auth_gate_detected:true"),
          coveredStepIndexes: [1],
          coveredAssertions: [
            { requirement: "flujo de autenticación", implementation: "await expect(page.locator('body')).toBeVisible();" },
          ],
          usedPageObjects: [{ className: "HomePage", methods: ["start"] }],
          declaredIdentifiers: ["homePage", "promotedRuntime"],
          unresolvedRequirements: [],
          warnings: []
        })
      }, { runTypeScriptValidation: async () => passTs(), runPlaywrightDiscovery: async () => passList(1) })
    );
    assert.strictEqual(result.promotionAllowed, true, result.diagnostics.errors.join("\n"));
    assert.strictEqual(result.diagnostics.finalSpec.origin, "gate_start_only_canonical_fallback");
    assert.strictEqual(result.diagnostics.finalSpec.generatedBy, "core");
    assert.ok(
      result.diagnostics.warnings.some((warning) => warning.includes("gate_start_only_canonical_fallback_applied")),
      result.diagnostics.warnings.join("\n")
    );
    assert.ok(
      !result.diagnostics.errors.some((error) => error.startsWith("technical_metadata_used_as_runtime_target:")),
      result.diagnostics.errors.join("\n")
    );
  });

  await t.test("runtime import is resolved from the actual spec file location", () => {
    const specPath = path.resolve(process.cwd(), "automations", "apps", "A", "sections", "S", "cases", "C", "spec-generation", "candidate.spec.ts");
    const content = "import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';";
    const rewritten = rewritePromotedRuntimeImport(content, specPath);

    assert.ok(rewritten.includes("/src/automations/runtime/promoted-spec-runtime"));
    assert.ok(!rewritten.includes("\\"));
  });

  await t.test("runtime import stays valid for different nesting depths", () => {
    const specPath = path.resolve(process.cwd(), "some", "deep", "nested", "candidate.spec.ts");
    const content = "import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';";
    const rewritten = rewritePromotedRuntimeImport(content, specPath);

    assert.ok(rewritten.includes("createPromotedSpecRuntime"));
    assert.ok(rewritten.includes("/src/automations/runtime/promoted-spec-runtime"));
  });

  await t.test("windows separators are normalized in the generated import", () => {
    const specPath = path.resolve(process.cwd(), "automations", "apps", "A", "sections", "S", "cases", "C", "spec-generation", "candidate.spec.ts");
    const content = "import { createPromotedSpecRuntime } from 'BROKEN';";
    const rewritten = rewritePromotedRuntimeImport(content, specPath);

    assert.ok(!rewritten.includes("\\"));
    assert.ok(rewritten.includes("/src/automations/runtime/promoted-spec-runtime"));
  });

  await t.test("candidate spec path resolves the runtime module on disk", async () => {
    const candidatePath = path.resolve(process.cwd(), "automations", "apps", "A", "sections", "S", "cases", "C", "spec-generation", "candidate.spec.ts");
    const content = "import { createPromotedSpecRuntime } from 'BROKEN';";
    const rewritten = rewritePromotedRuntimeImport(content, candidatePath);
    const importPath = rewritten.match(/from '([^']+)'/)?.[1];
    assert.ok(importPath);
    assert.equal((await fs.stat(path.resolve(path.dirname(candidatePath), `${importPath}.ts`))).isFile(), true);
  });

  await t.test("candidate written to spec-generation contains the corrected import", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promoted-runtime-candidate-"));
    const candidatePath = path.join(tempRoot, "spec-generation", "candidate.spec.ts");
    await fs.mkdir(path.dirname(candidatePath), { recursive: true });
    const rewritten = rewritePromotedRuntimeImport(
      "import { createPromotedSpecRuntime } from 'BROKEN';",
      candidatePath,
    );
    await fs.writeFile(candidatePath, rewritten, "utf-8");
    const persisted = await fs.readFile(candidatePath, "utf-8");
    assert.equal(persisted, rewritten);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await t.test("already promoted spec content remains intact", () => {
    const specPath = path.resolve(process.cwd(), "automations", "apps", "A", "sections", "S", "cases", "C", "case.spec.ts");
    const content = "import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';\nconst x = 1;";
    const rewritten = rewritePromotedRuntimeImport(content, specPath);

    assert.ok(rewritten.includes("const x = 1;"));
    assert.ok(rewritten.includes("createPromotedSpecRuntime"));
  });
});
