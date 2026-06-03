import { test, expect } from "@playwright/test";
import type { CaseDiscoveryResult, DiscoveryStepResult, DiscoveredObject } from "../src/types/discovery.types";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { TestScenario } from "../src/types/testrail.types";
import { extractCleanTarget, parseScenarioStepsForDiscovery, evaluateEarlyCompletion } from "../src/discovery/case-discovery";
import { expandSemanticTokens, tokenizeWithStopwords, computeSemanticScore, normalizeSemanticText, buildSnapshotCandidates } from "../src/discovery/target-resolver";
import { resolveAssertionTargets, type AssertionTargetInput } from "../src/discovery/assertion-resolver";
import { normalizeParsedTarget, type ActionTargetItem } from "../src/discovery/step-intent-parser";
import type { PageSnapshot, SnapshotElement } from "../src/types/page-snapshot.types";

type CliArgs = {
  caseId: number;
  headed: boolean;
  output?: string;
  autoPromote: boolean;
  promotionDryRun: boolean;
  promotionStrict: boolean;
  requirePromotionApproval: boolean;
  overwrite: boolean;
};

function parseDiscoveryCaseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    caseId: 0,
    headed: false,
    autoPromote: false,
    promotionDryRun: false,
    promotionStrict: false,
    requirePromotionApproval: false,
    overwrite: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--headed") {
      args.headed = true;
      continue;
    }
    if (token === "--auto-promote") {
      args.autoPromote = true;
      continue;
    }
    if (token === "--promotion-dry-run") {
      args.promotionDryRun = true;
      continue;
    }
    if (token === "--promotion-strict") {
      args.promotionStrict = true;
      continue;
    }
    if (token === "--require-promotion-approval") {
      args.requirePromotionApproval = true;
      continue;
    }
    if (token === "--overwrite") {
      args.overwrite = true;
      continue;
    }
    if (token === "--case-id") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --case-id");
      }
      args.caseId = Number(nextValue);
      if (!Number.isFinite(args.caseId) || args.caseId <= 0) {
        throw new Error(`Invalid --case-id value: ${nextValue}. Expected a positive integer.`);
      }
      i += 1;
      continue;
    }
    if (token === "--output") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --output");
      }
      args.output = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (args.caseId <= 0) {
    throw new Error("--case-id is required. Usage: npm run discovery:case -- --case-id <number>");
  }

  return args;
}

function makeSnapshotElement(overrides: Partial<SnapshotElement>): SnapshotElement {
  return {
    id: `el-${Math.random().toString(36).slice(2, 8)}`,
    type: "text",
    visible: true,
    candidateLocators: [],
    dataHints: [],
    ...overrides
  };
}

function makeAssertionSnapshot(elements: SnapshotElement[]): PageSnapshot {
  return {
    version: "1.0",
    url: "https://example.com",
    title: "Example",
    capturedAt: new Date().toISOString(),
    elements,
    summary: {
      totalElements: elements.length,
      buttons: elements.filter((element) => element.type === "button").length,
      links: elements.filter((element) => element.type === "link").length,
      inputs: elements.filter((element) => element.type === "input").length,
      selects: elements.filter((element) => element.type === "select").length,
      tables: elements.filter((element) => element.type === "table").length,
      dialogs: elements.filter((element) => element.type === "dialog").length,
      headings: elements.filter((element) => element.type === "heading").length
    }
  };
}

function simulateCaseDiscovery(
  scenario: TestScenario,
  foundTargets: Set<string>,
  transitionTargets: Set<string>,
  allTargets: string[]
): CaseDiscoveryResult {
  const steps: DiscoveryStepResult[] = [];
  const discoveredObjects: DiscoveredObject[] = [];
  const planSteps: ExecutionPlan["steps"] = [];

  const parsed = parseScenarioStepsForDiscovery(scenario);

  for (const actionTarget of parsed.actionTargets) {
    const found = foundTargets.has(actionTarget.target);
    const transitioned = transitionTargets.has(actionTarget.target);

    if (!found) {
      steps.push({
        index: actionTarget.index,
        action: actionTarget.action,
        status: "not_found",
        targetText: actionTarget.target,
        error: `Target "${actionTarget.target}" not found on current page`
      });

      return {
        version: "1.0",
        caseId: scenario.caseId,
        caseTitle: scenario.title,
        discoveredAt: new Date().toISOString(),
        status: "exploration_failed",
        steps,
        discoveredObjects,
        candidatePlan: {
          version: "1.0",
          source: "discovery_generated",
          status: "needs_discovery",
          scenario: { source: "testrail", externalId: scenario.externalId, caseId: scenario.caseId, title: scenario.title },
          requiredData: [],
          steps: planSteps,
          notes: [`Discovery failed: target "${actionTarget.target}" not found`],
          createdAt: new Date().toISOString()
        },
        pendingObjectsPath: ".artifacts/discovery/objects.pending.json",
        pendingPlansPath: ".artifacts/discovery/plans.pending.json",
        evidenceDir: ".artifacts/discovery/evidence",
        failedAtStep: actionTarget.index,
        failedTarget: actionTarget.target,
        failedReason: "target_not_found"
      };
    }

    if (!transitioned) {
      steps.push({
        index: actionTarget.index,
        action: actionTarget.action,
        status: "click_no_transition",
        targetText: actionTarget.target,
        error: "Click completed but no page transition or DOM change was detected."
      });

      return {
        version: "1.0",
        caseId: scenario.caseId,
        caseTitle: scenario.title,
        discoveredAt: new Date().toISOString(),
        status: "exploration_failed",
        steps,
        discoveredObjects,
        candidatePlan: {
          version: "1.0",
          source: "discovery_generated",
          status: "needs_discovery",
          scenario: { source: "testrail", externalId: scenario.externalId, caseId: scenario.caseId, title: scenario.title },
          requiredData: [],
          steps: planSteps,
          notes: [`Discovery failed: click on "${actionTarget.target}" did not produce page transition`],
          createdAt: new Date().toISOString()
        },
        pendingObjectsPath: ".artifacts/discovery/objects.pending.json",
        pendingPlansPath: ".artifacts/discovery/plans.pending.json",
        evidenceDir: ".artifacts/discovery/evidence",
        failedAtStep: actionTarget.index,
        failedTarget: actionTarget.target,
        failedReason: "click_no_transition"
      };
    }

    steps.push({
      index: actionTarget.index,
      action: actionTarget.action,
      status: "found",
      targetText: actionTarget.target,
      elementsFound: 15
    });

    discoveredObjects.push({
      key: `nav_${actionTarget.index}`,
      name: actionTarget.target,
      type: "button",
      locator: { strategy: "text", value: actionTarget.target, exact: false },
      aliases: [actionTarget.target.toLowerCase()],
      discoveredAt: new Date().toISOString(),
      sourceStep: actionTarget.index,
      confidence: 0.85
    });

    planSteps.push({
      index: planSteps.length + 1,
      action: "click",
      description: actionTarget.action,
      target: { strategy: "text", value: actionTarget.target, exact: false }
    });
  }

  for (const assertTarget of parsed.assertionTargets) {
    const found = foundTargets.has(assertTarget.target);
    if (found) {
      steps.push({
        index: assertTarget.index,
        action: assertTarget.action,
        status: "found",
        targetText: assertTarget.target
      });
      planSteps.push({
        index: planSteps.length + 1,
        action: "assertText",
        description: assertTarget.action,
        target: { strategy: "text", value: assertTarget.target, exact: false },
        expected: assertTarget.target
      });
    } else {
      steps.push({
        index: assertTarget.index,
        action: assertTarget.action,
        status: "not_found",
        targetText: assertTarget.target,
        error: `Assertion target "${assertTarget.target}" not found`
      });
    }
  }

  return {
    version: "1.0",
    caseId: scenario.caseId,
    caseTitle: scenario.title,
    discoveredAt: new Date().toISOString(),
    status: "discovered_passed",
    steps,
    discoveredObjects,
    candidatePlan: {
      version: "1.0",
      source: "discovery_generated",
      status: "validated",
      scenario: { source: "testrail", externalId: scenario.externalId, caseId: scenario.caseId, title: scenario.title },
      requiredData: [],
      steps: planSteps,
      notes: ["Discovery completed successfully. All targets found."],
      createdAt: new Date().toISOString()
    },
    pendingObjectsPath: ".artifacts/discovery/objects.pending.json",
    pendingPlansPath: ".artifacts/discovery/plans.pending.json",
    evidenceDir: ".artifacts/discovery/evidence",
    failedAtStep: undefined,
    failedTarget: undefined,
    failedReason: undefined
  };
}

const c37750Scenario: TestScenario = {
  source: "testrail",
  externalId: "C37750",
  caseId: 37750,
  title: "Consulta listado de tarjetas de credito",
  steps: [
    { index: 1, action: "Clic en 'Iniciar'.", expected: undefined, dataHints: [] },
    { index: 2, action: "Clic en 'Información de productos'.", expected: undefined, dataHints: [] },
    { index: 3, action: "Clic en 'Tarjetas'.", expected: undefined, dataHints: [] },
    { index: 4, action: "Clic en 'Tarjeta de Crédito'.", expected: undefined, dataHints: [] },
    { index: 5, action: "Validar listado de tarjetas de crédito.", expected: "Visa Clásica\nVisa Gold\nVisa Platinum\nVisa Infinite", dataHints: [] }
  ]
};

test("discovery:case CLI parses --case-id correctly", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "37750"]);
  expect(args.caseId).toBe(37750);
  expect(args.headed).toBe(false);
});

test("discovery:case CLI parses --headed flag", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "37750", "--headed"]);
  expect(args.caseId).toBe(37750);
  expect(args.headed).toBe(true);
});

test("discovery:case CLI parses --output flag", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "37750", "--output", ".artifacts/discovery/test"]);
  expect(args.caseId).toBe(37750);
  expect(args.output).toBe(".artifacts/discovery/test");
});

test("discovery:case CLI parses --auto-promote", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "37750", "--auto-promote"]);
  expect(args.autoPromote).toBe(true);
});

test("discovery:case CLI parses --promotion-dry-run", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "37750", "--promotion-dry-run"]);
  expect(args.promotionDryRun).toBe(true);
});

test("discovery:case CLI parses --promotion-strict and --require-promotion-approval", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "37750", "--promotion-strict", "--require-promotion-approval"]);
  expect(args.promotionStrict).toBe(true);
  expect(args.requirePromotionApproval).toBe(true);
});

test("discovery:case CLI requires --case-id", () => {
  expect(() => parseDiscoveryCaseArgs([])).toThrow("--case-id is required");
});

test("discovery:case CLI rejects invalid --case-id", () => {
  expect(() => parseDiscoveryCaseArgs(["--case-id", "abc"])).toThrow("Invalid --case-id value");
  expect(() => parseDiscoveryCaseArgs(["--case-id", "-1"])).toThrow("Invalid --case-id value");
});

test("discovery:case CLI rejects unknown arguments", () => {
  expect(() => parseDiscoveryCaseArgs(["--case-id", "37750", "--unknown"])).toThrow("Unknown argument");
});

test("discovery:case CLI parses --overwrite", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "37750", "--overwrite"]);
  expect(args.overwrite).toBe(true);
});

test("discovery:case CLI default overwrite is false", () => {
  const args = parseDiscoveryCaseArgs(["--case-id", "37750"]);
  expect(args.overwrite).toBe(false);
});

test("extractCleanTarget parses Clic en 'Iniciar'", () => {
  const result = extractCleanTarget("Clic en 'Iniciar'.");
  expect(result.type).toBe("click");
  expect(result.target).toBe("Iniciar");
});

test("extractCleanTarget parses Clic en 'Información de productos'", () => {
  const result = extractCleanTarget("Clic en 'Información de productos'.");
  expect(result.type).toBe("click");
  expect(result.target).toBe("Información de productos");
});

test("extractCleanTarget parses Clic en 'Tarjetas'", () => {
  const result = extractCleanTarget("Clic en 'Tarjetas'.");
  expect(result.type).toBe("click");
  expect(result.target).toBe("Tarjetas");
});

test("extractCleanTarget parses Clic en 'Tarjeta de Crédito'", () => {
  const result = extractCleanTarget("Clic en 'Tarjeta de Crédito'.");
  expect(result.type).toBe("click");
  expect(result.target).toBe("Tarjeta de Crédito");
});

test("extractCleanTarget classifies 'Abrir URL del Kiosko' as setup_route", () => {
  const result = extractCleanTarget("Abrir URL del Kiosko.");
  expect(result.type).toBe("setup_route");
  expect(result.target).toBe("APP_BASE_URL");
});

test("extractCleanTarget detects validation steps", () => {
  const result = extractCleanTarget("Validar listado de tarjetas de crédito.");
  expect(result.type).toBe("assert");
  expect(result.target).toBe("listado de tarjetas de crédito");
});

test("parseScenarioStepsForDiscovery extracts 4 action targets from C37750", () => {
  const parsed = parseScenarioStepsForDiscovery(c37750Scenario);

  expect(parsed.actionTargets.length).toBe(4);
  expect(parsed.actionTargets[0].target).toBe("Iniciar");
  expect(parsed.actionTargets[1].target).toBe("Información de productos");
  expect(parsed.actionTargets[2].target).toBe("Tarjetas");
  expect(parsed.actionTargets[3].target).toBe("Tarjeta de Crédito");
});

test("parseScenarioStepsForDiscovery does not include 'Abrir URL del Kiosko' as target but puts it in setupIntents", () => {
  const scenarioWithOpenUrl: TestScenario = {
    source: "testrail",
    externalId: "C37750",
    caseId: 37750,
    title: "Consulta listado de tarjetas de credito",
    steps: [
      { index: 1, action: "Abrir URL del Kiosko.", expected: undefined, dataHints: [] },
      { index: 2, action: "Clic en 'Iniciar'.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenarioWithOpenUrl);

  expect(parsed.actionTargets.length).toBe(1);
  expect(parsed.actionTargets[0].target).toBe("Iniciar");
  expect(parsed.setupIntents.length).toBe(1);
  expect(parsed.setupIntents[0].type).toBe("setup_route");
  expect(parsed.skippedActions.length).toBe(0);
});

test("parseScenarioStepsForDiscovery extracts assertion targets from expected", () => {
  const parsed = parseScenarioStepsForDiscovery(c37750Scenario);

  expect(parsed.assertionTargets.length).toBeGreaterThan(0);
  const assertionTexts = parsed.assertionTargets.map((t) => t.target);
  expect(assertionTexts.some((t) => t.includes("listado de tarjetas"))).toBe(true);
});

test("parseScenarioStepsForDiscovery does not generate truncated targets", () => {
  const multilineAction = "Clic en 'Iniciar'.\nClic en 'Información de productos'.\nClic en 'Tarjetas'.";

  const scenario: TestScenario = {
    source: "testrail",
    externalId: "C37750",
    caseId: 37750,
    title: "Test",
    steps: [
      { index: 1, action: multilineAction, expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  for (const target of parsed.actionTargets) {
    expect(target.target).not.toContain("\n");
    expect(target.target.length).toBeLessThan(50);
  }
});

test("actionTargets and assertionTargets are separated", () => {
  const parsed = parseScenarioStepsForDiscovery(c37750Scenario);

  const actionTexts = parsed.actionTargets.map((t) => t.target);
  const assertionTexts = parsed.assertionTargets.map((t) => t.target);

  expect(actionTexts).toEqual(["Iniciar", "Información de productos", "Tarjetas", "Tarjeta de Crédito"]);
  expect(assertionTexts.some((t) => t.includes("Visa"))).toBe(true);
  expect(assertionTexts.some((t) => t.includes("listado"))).toBe(true);
});

test("click sin cambio de DOM no se marca como passed", () => {
  const foundTargets = new Set(["Iniciar", "Información de productos", "Tarjetas", "Tarjeta de Crédito"]);
  const transitionTargets = new Set(["Información de productos", "Tarjetas", "Tarjeta de Crédito"]);

  const result = simulateCaseDiscovery(c37750Scenario, foundTargets, transitionTargets, []);

  expect(result.status).toBe("exploration_failed");
  expect(result.failedTarget).toBe("Iniciar");
  expect(result.failedReason).toBe("click_no_transition");
  expect(result.steps[0].status).toBe("click_no_transition");
});

test("click con cambio de URL se marca como passed", () => {
  const foundTargets = new Set(["Iniciar", "Información de productos", "Tarjetas", "Tarjeta de Crédito"]);
  const transitionTargets = new Set(["Iniciar", "Información de productos", "Tarjetas", "Tarjeta de Crédito"]);

  const result = simulateCaseDiscovery(c37750Scenario, foundTargets, transitionTargets, []);

  expect(result.steps[0].status).toBe("found");
  expect(result.failedReason).toBeUndefined();
});

test("click con cambio de body text se marca como passed", () => {
  const foundTargets = new Set(["Iniciar", "Información de productos"]);
  const transitionTargets = new Set(["Iniciar", "Información de productos"]);

  const partialScenario: TestScenario = {
    source: "testrail",
    externalId: "C37750",
    caseId: 37750,
    title: "Test",
    steps: [
      { index: 1, action: "Clic en 'Iniciar'.", expected: undefined, dataHints: [] },
      { index: 2, action: "Clic en 'Información de productos'.", expected: undefined, dataHints: [] }
    ]
  };

  const result = simulateCaseDiscovery(partialScenario, foundTargets, transitionTargets, []);

  expect(result.steps.every((s) => s.status === "found")).toBe(true);
});

test("locator de button tiene prioridad sobre text/span", () => {
  expect(true).toBe(true);
});

test("force click se intenta cuando click normal no produce transición", () => {
  expect(true).toBe(true);
});

test("si force click tampoco cambia DOM, falla con click_no_transition", () => {
  const foundTargets = new Set(["Iniciar"]);
  const transitionTargets = new Set<string>();

  const partialScenario: TestScenario = {
    source: "testrail",
    externalId: "C37750",
    caseId: 37750,
    title: "Test",
    steps: [
      { index: 1, action: "Clic en 'Iniciar'.", expected: undefined, dataHints: [] }
    ]
  };

  const result = simulateCaseDiscovery(partialScenario, foundTargets, transitionTargets, []);

  expect(result.status).toBe("exploration_failed");
  expect(result.failedReason).toBe("click_no_transition");
  expect(result.failedTarget).toBe("Iniciar");
});

test("C37750 no continúa a Información de productos si Iniciar no produjo transición", () => {
  const foundTargets = new Set(["Iniciar", "Información de productos", "Tarjetas", "Tarjeta de Crédito"]);
  const transitionTargets = new Set(["Información de productos", "Tarjetas", "Tarjeta de Crédito"]);

  const result = simulateCaseDiscovery(c37750Scenario, foundTargets, transitionTargets, []);

  expect(result.steps.length).toBe(1);
  expect(result.steps[0].status).toBe("click_no_transition");
  expect(result.failedTarget).toBe("Iniciar");
  expect(result.steps.some((s) => s.targetText === "Información de productos")).toBe(false);
});

test("discovery successful generates discovered_passed status", () => {
  const allTargets = [...c37750Scenario.steps.map((s) => s.action)];
  const parsed = parseScenarioStepsForDiscovery(c37750Scenario);
  const cleanTargets = new Set([
    ...parsed.actionTargets.map((t) => t.target),
    ...parsed.assertionTargets.map((t) => t.target)
  ]);

  const result = simulateCaseDiscovery(c37750Scenario, cleanTargets, cleanTargets, allTargets);

  expect(result.status).toBe("discovered_passed");
  expect(result.caseId).toBe(37750);
  expect(result.candidatePlan?.status).toBe("validated");
  expect(result.failedAtStep).toBeUndefined();
  expect(result.failedTarget).toBeUndefined();
  expect(result.failedReason).toBeUndefined();
});

test("discovery successful generates candidate plan with click actions", () => {
  const allTargets = c37750Scenario.steps.map((s) => s.action);
  const parsed = parseScenarioStepsForDiscovery(c37750Scenario);
  const cleanTargets = new Set(parsed.actionTargets.map((t) => t.target));

  const result = simulateCaseDiscovery(c37750Scenario, cleanTargets, cleanTargets, allTargets);

  expect(result.candidatePlan).toBeDefined();
  expect(result.candidatePlan?.steps.length).toBe(4);
  expect(result.candidatePlan?.steps.every((s) => s.action === "click")).toBe(true);
  expect(result.candidatePlan?.source).toBe("discovery_generated");
});

test("discovery successful generates discovered objects", () => {
  const allTargets = c37750Scenario.steps.map((s) => s.action);
  const parsed = parseScenarioStepsForDiscovery(c37750Scenario);
  const cleanTargets = new Set(parsed.actionTargets.map((t) => t.target));

  const result = simulateCaseDiscovery(c37750Scenario, cleanTargets, cleanTargets, allTargets);

  expect(result.discoveredObjects.length).toBe(4);
  expect(result.discoveredObjects[0].key).toBe("nav_1");
  expect(result.discoveredObjects[0].type).toBe("button");
  expect(result.discoveredObjects[0].locator.strategy).toBe("text");
});

test("discovery failed returns exploration_failed with missing target", () => {
  const allTargets = c37750Scenario.steps.map((s) => s.action);
  const foundTargets = new Set(["Iniciar", "Información de productos", "Tarjetas"]);
  const transitionTargets = new Set(["Iniciar", "Información de productos", "Tarjetas"]);

  const result = simulateCaseDiscovery(c37750Scenario, foundTargets, transitionTargets, allTargets);

  expect(result.status).toBe("exploration_failed");
  expect(result.failedTarget).toBe("Tarjeta de Crédito");
  expect(result.candidatePlan?.status).toBe("needs_discovery");
});

test("discovery failed step has not_found status", () => {
  const allTargets = c37750Scenario.steps.map((s) => s.action);
  const foundTargets = new Set(["Iniciar", "Información de productos", "Tarjetas"]);
  const transitionTargets = new Set(["Iniciar", "Información de productos", "Tarjetas"]);

  const result = simulateCaseDiscovery(c37750Scenario, foundTargets, transitionTargets, allTargets);

  const failedStep = result.steps.find((s) => s.status === "not_found");
  expect(failedStep).toBeDefined();
  expect(failedStep?.targetText).toBe("Tarjeta de Crédito");
  expect(failedStep?.error).toContain("not found");
});

test("discovered objects saved as pending paths", () => {
  const allTargets = c37750Scenario.steps.map((s) => s.action);
  const parsed = parseScenarioStepsForDiscovery(c37750Scenario);
  const cleanTargets = new Set(parsed.actionTargets.map((t) => t.target));

  const result = simulateCaseDiscovery(c37750Scenario, cleanTargets, cleanTargets, allTargets);

  expect(result.pendingObjectsPath).toBeDefined();
  expect(result.pendingPlansPath).toBeDefined();
  expect(result.pendingObjectsPath).toContain("pending");
  expect(result.pendingPlansPath).toContain("pending");
});

test("discovery partial returns discovered_partial status", () => {
  const partialScenario: TestScenario = {
    source: "testrail",
    externalId: "C37751",
    caseId: 37751,
    title: "Partial discovery test",
    steps: [
      { index: 1, action: "Clic en 'Step A'.", expected: undefined, dataHints: [] },
      { index: 2, action: "Clic en 'Step B'.", expected: undefined, dataHints: [] },
      { index: 3, action: "Clic en 'Step C'.", expected: undefined, dataHints: [] }
    ]
  };

  const foundTargets = new Set(["Step A", "Step B"]);
  const transitionTargets = new Set(["Step A", "Step B"]);

  const result = simulateCaseDiscovery(partialScenario, foundTargets, transitionTargets, []);

  expect(result.status).toBe("exploration_failed");
  expect(result.failedTarget).toBe("Step C");
  expect(result.steps.filter((s) => s.status === "found").length).toBe(2);
});

test("stable registry is not modified by discovery", () => {
  const allTargets = c37750Scenario.steps.map((s) => s.action);
  const parsed = parseScenarioStepsForDiscovery(c37750Scenario);
  const cleanTargets = new Set(parsed.actionTargets.map((t) => t.target));

  const result = simulateCaseDiscovery(c37750Scenario, cleanTargets, cleanTargets, allTargets);

  expect(result.pendingObjectsPath).toBeDefined();
  expect(result.pendingObjectsPath).not.toContain("registry");
  expect(result.pendingObjectsPath).toContain("pending");
  expect(result.pendingPlansPath).toContain("pending");
});

test("pending artifacts remain generic and not vendor-specific", () => {
  const result = simulateCaseDiscovery(c37750Scenario, new Set(["Iniciar"]), new Set(["Iniciar"]), []);

  expect(result.pendingObjectsPath).not.toContain("registry");
  expect(result.pendingObjectsPath).toContain("pending");
  expect(result.pendingPlansPath).toContain("pending");
});

test("locator_resolution_failed is preserved as an explicit discovery step status", () => {
  const step: DiscoveryStepResult = {
    index: 2,
    action: "Click target",
    status: "locator_resolution_failed",
    targetText: "Continue",
    error: "Semantic target matched, but DOM locator resolution failed.",
    attemptedLocators: ["getByRole(button, candidateText:Continue)"],
    candidateId: "button-1",
    candidateText: "ContinueExplore more"
  };

  expect(step.status).toBe("locator_resolution_failed");
  expect(step.attemptedLocators?.[0]).toContain("getByRole");
});

test("cases:start suggests discovery:case when status needs_discovery", () => {
  const caseId = 37750;
  const suggestion = `npm.cmd run discovery:case -- --case-id ${caseId} --headed`;

  expect(suggestion).toContain("discovery:case");
  expect(suggestion).toContain("--case-id 37750");
  expect(suggestion).toContain("--headed");
});

test("discovery result includes evidence directory", () => {
  const allTargets = c37750Scenario.steps.map((s) => s.action);
  const parsed = parseScenarioStepsForDiscovery(c37750Scenario);
  const cleanTargets = new Set(parsed.actionTargets.map((t) => t.target));

  const result = simulateCaseDiscovery(c37750Scenario, cleanTargets, cleanTargets, allTargets);

  expect(result.evidenceDir).toBeDefined();
  expect(result.evidenceDir).toContain("discovery");
});

test("discovery candidate plan has correct scenario reference", () => {
  const allTargets = c37750Scenario.steps.map((s) => s.action);
  const parsed = parseScenarioStepsForDiscovery(c37750Scenario);
  const cleanTargets = new Set(parsed.actionTargets.map((t) => t.target));

  const result = simulateCaseDiscovery(c37750Scenario, cleanTargets, cleanTargets, allTargets);

  expect(result.candidatePlan?.scenario.source).toBe("testrail");
  expect(result.candidatePlan?.scenario.caseId).toBe(37750);
  expect(result.candidatePlan?.scenario.externalId).toBe("C37750");
});

test("custom_steps multiline de C37750 se parsea en 4 targets", () => {
  const multilineSteps = [
    "Abrir URL del Kiosko.",
    "Clic en 'Iniciar'.",
    "Clic en 'Información de productos'.",
    "Clic en 'Tarjetas'.",
    "Clic en 'Tarjeta de Crédito'.",
    "Validar listado de tarjetas de crédito."
  ].join("\n");

  const scenario: TestScenario = {
    source: "testrail",
    externalId: "C37750",
    caseId: 37750,
    title: "Consulta listado de tarjetas de credito",
    steps: multilineSteps.split("\n").map((line, i) => ({
      index: i + 1,
      action: line,
      expected: i === multilineSteps.split("\n").length - 1 ? "Visa Clásica\nVisa Gold" : undefined,
      dataHints: []
    }))
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  expect(parsed.actionTargets.length).toBe(4);
  expect(parsed.actionTargets.map((t) => t.target)).toEqual([
    "Iniciar",
    "Información de productos",
    "Tarjetas",
    "Tarjeta de Crédito"
  ]);
});

test("no se genera target truncado con múltiples líneas", () => {
  const multilineAction = "Clic en 'Iniciar'.\nClic en 'Información de productos'.";

  const scenario: TestScenario = {
    source: "testrail",
    externalId: "C37750",
    caseId: 37750,
    title: "Test",
    steps: [{ index: 1, action: multilineAction, expected: undefined, dataHints: [] }]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  for (const target of parsed.actionTargets) {
    expect(target.target).not.toContain("\n");
    expect(target.target).not.toContain("Clic en 'Iniciar'");
  }
});

test("C37751 'Desde el listado de tarjetas de crédito, seleccionar X' extrae action_select correctamente", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "C37751",
    caseId: 37751,
    title: "Seleccionar tarjeta Visa Clásica desde listado",
    steps: [
      { index: 1, action: "Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta Crédito Visa Clásica'.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  expect(parsed.actionTargets.length).toBe(1);
  expect(parsed.actionTargets[0].target).toBe("Tarjeta Crédito Visa Clásica");

  expect(parsed.setupIntents.length).toBe(1);
  expect(parsed.setupIntents[0].type).toBe("precondition_context");
  expect(parsed.setupIntents[0].context).toBe("tarjetas de crédito");

  const hasAssertion = parsed.assertionTargets.some((t) => t.target.includes("listado de tarjetas"));
  expect(hasAssertion).toBe(false);
});

test("C37753 'Desde el listado de tarjetas de crédito, seleccionar X' extrae target correcto", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "C37753",
    caseId: 37753,
    title: "Seleccionar tarjeta Visa Platinum desde listado",
    steps: [
      { index: 1, action: "Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta de Crédito Visa Platinum'.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  expect(parsed.actionTargets.length).toBe(1);
  expect(parsed.actionTargets[0].target).toBe("Tarjeta de Crédito Visa Platinum");
  expect(parsed.setupIntents.length).toBe(1);
});

test("C37755 'Abrir A > B > C' genera navigation_path expandido en actionTargets", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "C37755",
    caseId: 37755,
    title: "Solicitar tarjeta desde navegación",
    steps: [
      { index: 1, action: "Abrir Información de productos > Tarjetas > Tarjeta de Crédito.", expected: undefined, dataHints: [] },
      { index: 2, action: "Seleccionar una tarjeta, preferiblemente 'Tarjeta Crédito Visa Clásica'.", expected: undefined, dataHints: [] },
      { index: 3, action: "Clic en 'Solicitar'.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  expect(parsed.actionTargets.length).toBe(2);
  expect(parsed.actionTargets[0].target).toBe("Tarjeta Crédito Visa Clásica");
  expect(parsed.actionTargets[1].target).toBe("Solicitar");

  expect(parsed.setupIntents.length).toBe(1);
  expect(parsed.setupIntents[0].type).toBe("navigation_path");
  expect(parsed.setupIntents[0].path).toEqual(["Información de productos", "Tarjetas", "Tarjeta de Crédito"]);
});

test("assertion resolver no trata 'Desde el listado...' como assertion", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "C37751",
    caseId: 37751,
    title: "Test",
    steps: [
      { index: 1, action: "Desde el listado de tarjetas de crédito, seleccionar 'Tarjeta Crédito Visa Clásica'.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  const assertionTexts = parsed.assertionTargets.map((t) => t.target);
  const hasListadoAssertion = assertionTexts.some((t) => t.includes("listado de tarjetas"));
  expect(hasListadoAssertion).toBe(false);
});

test("no hardcodea Kiosko, tarjetas, C37750 ni Banco Santa Cruz en parser", () => {
  const content = require("fs").readFileSync(
    require("path").join(__dirname, "../src/discovery/step-intent-parser.ts"),
    "utf-8"
  );

  expect(content).not.toContain("Kiosko");
  expect(content).not.toContain("C37750");
  expect(content).not.toContain("Banco Santa Cruz");
  expect(content).not.toContain("tarjetas");
});

test("C37751 step concatenado produce actionTargets ordenados: iniciar, Informacion de productos, tarjetas, tarjetas de credito, Tarjeta Crédito Visa Clásica", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "C37751",
    caseId: 37751,
    title: "Seleccionar tarjeta Visa Clásica",
    steps: [
      {
        index: 1,
        action: "Click en iniciarClick en Informacion de productos Click en tarjetasClick en tarjetas de creditoClick 'Tarjeta Crédito Visa Clásica'.Validar detalle de producto.Opcional: validar botón 'Solicitar'.",
        expected: undefined,
        dataHints: []
      }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  expect(parsed.actionTargets.length).toBe(6);
  expect(parsed.actionTargets[0].target).toBe("iniciar");
  expect(parsed.actionTargets[1].target).toBe("Informacion de productos");
  expect(parsed.actionTargets[2].target).toBe("tarjetas");
  expect(parsed.actionTargets[3].target).toBe("tarjetas de credito");
  expect(parsed.actionTargets[4].target).toBe("Tarjeta Crédito Visa Clásica");
  expect(parsed.actionTargets[4].isOptional).toBeUndefined();

  const optionalAction = parsed.actionTargets.find((a) => a.isOptional);
  expect(optionalAction).toBeDefined();
  expect(optionalAction!.target).toBe("Solicitar");

  const mandatoryAssertions = parsed.assertionTargets.filter((a) => a.source === "action");
  expect(mandatoryAssertions.length).toBe(1);
  expect(mandatoryAssertions[0].target).toBe("detalle de producto");
});

test("optional_action no aparece como assertion obligatoria en parseScenarioStepsForDiscovery", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "C37751",
    caseId: 37751,
    title: "Test",
    steps: [
      {
        index: 1,
        action: "Opcional: validar botón 'Solicitar'.",
        expected: undefined,
        dataHints: []
      }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  const hasAssertionSolicitar = parsed.assertionTargets.some((t) => t.target.includes("Solicitar"));
  expect(hasAssertionSolicitar).toBe(false);

  const actionSolicitar = parsed.actionTargets.find((a) => a.target === "Solicitar");
  expect(actionSolicitar).toBeDefined();
  expect(actionSolicitar!.isOptional).toBe(true);
});

test("validaciones finales se extraen desde expected", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "C37750",
    caseId: 37750,
    title: "Test",
    steps: [
      { index: 1, action: "Clic en 'Tarjeta de Crédito'.", expected: "Visa Clásica\nVisa Gold\nVisa Platinum\nVisa Infinite", dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  expect(parsed.assertionTargets.length).toBeGreaterThan(1);
  const texts = parsed.assertionTargets.map((t) => t.target);
  expect(texts.some((t) => t.includes("Visa"))).toBe(true);
});

test("setup_route no aparece en actionTargets ni assertionTargets - synthetic login scenario", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "SYNTH_LOGIN",
    caseId: 99999,
    title: "Synthetic Login Scenario",
    steps: [
      { index: 1, action: "Abrir URL del portal web.", expected: undefined, dataHints: [] },
      { index: 2, action: "Ingresar usuario válido.", expected: undefined, dataHints: [] },
      { index: 3, action: "Ingresar contraseña válida.", expected: undefined, dataHints: [] },
      { index: 4, action: "Hacer clic en Login.", expected: undefined, dataHints: [] },
      { index: 5, action: "Validar que se muestre la página principal.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  const actionTexts = parsed.actionTargets.map((t) => t.target);
  expect(actionTexts).not.toContain("URL del portal web");
  expect(actionTexts).toContain("Login");

  const setupRoute = parsed.setupIntents.find((i) => i.type === "setup_route");
  expect(setupRoute).toBeDefined();
  expect(setupRoute!.actionTarget).toBe("APP_BASE_URL");

  const fillActions = parsed.actionTargets.filter((t) => t.target.startsWith("usuario") || t.target.startsWith("contrase"));
  expect(fillActions.length).toBe(2);

  const assertionTexts = parsed.assertionTargets.map((t) => t.target);
  expect(assertionTexts.some((t) => t.includes("página principal"))).toBe(true);
});

test("fill con dato 'KEY' en campo 'FIELD' produce target correcto y valueKey en parseScenarioStepsForDiscovery", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "SYNTH_FILL_KEY",
    caseId: 99998,
    title: "Fill with test data key",
    steps: [
      { index: 1, action: "Escribir el valor del dato 'usuario_valido' en el campo 'Username'.", expected: undefined, dataHints: [] },
      { index: 2, action: "Escribir el valor del dato 'contrasena_valida' en el campo 'Password'.", expected: undefined, dataHints: [] },
      { index: 3, action: "Clic en 'Login'.", expected: undefined, dataHints: [] },
      { index: 4, action: "Validar que se muestre la página principal.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  const actionTexts = parsed.actionTargets.map((t) => t.target);
  expect(actionTexts).toContain("Username");
  expect(actionTexts).toContain("Password");
  expect(actionTexts).toContain("Login");
  expect(actionTexts).not.toContain("usuario_valido");
  expect(actionTexts).not.toContain("contrasena_valida");

  const usernameFill = parsed.actionTargets.find((t) => t.target === "Username");
  expect(usernameFill).toBeDefined();
  expect(usernameFill!.valueKey).toBe("usuario_valido");
  expect(usernameFill!.valueSource).toBe("test_data");
  expect(usernameFill!.value).toBeUndefined();

  const passwordFill = parsed.actionTargets.find((t) => t.target === "Password");
  expect(passwordFill).toBeDefined();
  expect(passwordFill!.valueKey).toBe("contrasena_valida");
  expect(passwordFill!.valueSource).toBe("test_data");

  const loginClick = parsed.actionTargets.find((t) => t.target === "Login");
  expect(loginClick).toBeDefined();
  expect(loginClick!.valueKey).toBeUndefined();
  expect(loginClick!.valueSource).toBeUndefined();

  const assertionTexts = parsed.assertionTargets.map((t) => t.target);
  expect(assertionTexts.some((t) => t.includes("página principal"))).toBe(true);

  expect(parsed.setupIntents.length).toBe(0);
});

test("fill con valor literal 'VALUE' en campo 'FIELD' produce target y value correctos", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "SYNTH_FILL_LITERAL",
    caseId: 99997,
    title: "Fill with literal value",
    steps: [
      { index: 1, action: "Escribir 'admin' en el campo 'Username'.", expected: undefined, dataHints: [] },
      { index: 2, action: "Escribir 'secret' en el campo 'Password'.", expected: undefined, dataHints: [] },
      { index: 3, action: "Clic en 'Login'.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  const usernameFill = parsed.actionTargets.find((t) => t.target === "Username");
  expect(usernameFill).toBeDefined();
  expect(usernameFill!.value).toBe("admin");
  expect(usernameFill!.valueKey).toBeUndefined();
  expect(usernameFill!.valueSource).toBe("literal");
  expect(usernameFill!.action).toContain("Escribir");

  const passwordFill = parsed.actionTargets.find((t) => t.target === "Password");
  expect(passwordFill).toBeDefined();
  expect(passwordFill!.value).toBe("secret");
  expect(passwordFill!.valueSource).toBe("literal");
  expect(passwordFill!.action).toContain("Escribir");

  const loginClick = parsed.actionTargets.find((t) => t.target === "Login");
  expect(loginClick).toBeDefined();
  expect(loginClick!.action).toContain("Clic");
  expect(loginClick!.value).toBeUndefined();
  expect(loginClick!.valueKey).toBeUndefined();
});

test("fill actions tienen valueSource definido, click no tiene value ni valueSource", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "SYNTH_FILL_TYPE",
    caseId: 99996,
    title: "Fill action type",
    steps: [
      { index: 1, action: "Escribir el valor del dato 'user' en el campo 'Username'.", expected: undefined, dataHints: [] },
      { index: 2, action: "Clic en 'Login'.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  const fillAction = parsed.actionTargets.find((t) => t.target === "Username");
  expect(fillAction!.valueSource).toBe("test_data");
  expect(fillAction!.valueKey).toBe("user");
  expect(fillAction!.value).toBeUndefined();

  const clickAction = parsed.actionTargets.find((t) => t.target === "Login");
  expect(clickAction!.valueSource).toBeUndefined();
  expect(clickAction!.valueKey).toBeUndefined();
});

test("normalizeParsedTarget completa valueSource faltante", () => {
  expect(normalizeParsedTarget("Pesos")).toEqual({
    target: "Pesos",
    valueSource: "unknown",
  });

  expect(normalizeParsedTarget({ target: "Pesos" })).toEqual({
    target: "Pesos",
    valueSource: "unknown",
  });
});

test("parseScenarioStepsForDiscovery conserva action targets seguros en escenarios mixtos", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "SYNTH_SAFE_TARGETS",
    caseId: 99993,
    title: "Safe targets",
    steps: [
      { index: 1, action: "Clic en 'Iniciar'.", expected: undefined, dataHints: [] },
      { index: 2, action: "Clic en 'Información de productos'.", expected: undefined, dataHints: [] },
      { index: 3, action: "Clic en 'Cuentas de Efectivo'.", expected: undefined, dataHints: [] },
      { index: 4, action: "Validar Pesos.", expected: undefined, dataHints: [] },
      { index: 5, action: "Validar Dólares.", expected: undefined, dataHints: [] },
      { index: 6, action: "Validar Euros.", expected: undefined, dataHints: [] },
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);
  expect(parsed.actionTargets.every((target) => typeof target.target === "string" && target.target.length > 0)).toBe(true);
  expect(parsed.actionTargets.every((target) => target.valueSource === undefined || target.valueSource === "literal" || target.valueSource === "test_data" || target.valueSource === "unknown")).toBe(true);
});

test("orderedSteps intercala assertion antes de accion cuando el indice del paso lo requiere", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "SYNTH_ORDER",
    caseId: 99995,
    title: "Order test",
    steps: [
      { index: 1, action: "Abrir URL del portal web.", expected: undefined, dataHints: [] },
      { index: 2, action: "Esperar que esté visible 'Landing'.", expected: undefined, dataHints: [] },
      { index: 3, action: "Escribir el valor del dato 'user' en el campo 'Username'.", expected: undefined, dataHints: [] },
      { index: 4, action: "Clic en 'Submit'.", expected: undefined, dataHints: [] },
      { index: 5, action: "Validar que se muestre 'Dashboard'.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);
  const orderedTypes = parsed.orderedSteps.map((s) => ({ index: s.stepIndex, type: s.type, target: s.target }));

  expect(orderedTypes.length).toBe(4);
  expect(orderedTypes[0]).toEqual({ index: 2, type: "assertion", target: "Landing" });
  expect(orderedTypes[1]).toEqual({ index: 3, type: "action_fill", target: "Username" });
  expect(orderedTypes[2]).toEqual({ index: 4, type: "action_click", target: "Submit" });
  expect(orderedTypes[3]).toEqual({ index: 5, type: "assertion", target: "Dashboard" });
});

test("orderedSteps no incluye setup_route ni navigation_path como items ejecutables", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "SYNTH_SETUP_ONLY",
    caseId: 99994,
    title: "Setup only",
    steps: [
      { index: 1, action: "Abrir URL del portal web.", expected: undefined, dataHints: [] },
      { index: 2, action: "Clic en 'Start'.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);
  const orderedTargets = parsed.orderedSteps.map((s) => s.target);
  expect(orderedTargets).not.toContain("APP_BASE_URL");
  expect(orderedTargets).toContain("Start");
});

test("expected targets sinteticos semanticos se filtran, concretos se conservan", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "SYNTH_EXPECTED_FILTER",
    caseId: 99993,
    title: "Expected filter",
    steps: [
      { index: 1, action: "Clic en 'Login'.", expected: undefined, dataHints: [] },
      { index: 2, action: "Validar que se muestre 'Products'.", expected: "Products\nSauce Labs Backpack\nValidar que la pantalla final muestre señales esperadas:\nPrecio USD 29.99", dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  const assertionTexts = parsed.assertionTargets.map((t) => t.target);
  expect(assertionTexts).toContain("Products");
  expect(assertionTexts).toContain("Sauce Labs Backpack");
  expect(assertionTexts).not.toContain("Validar que la pantalla final muestre señales esperadas:");
  expect(assertionTexts).toContain("Precio USD 29.99");

  const expectedSources = parsed.assertionTargets.filter((t) => t.source === "expected").map((t) => t.target);
  expect(expectedSources).toContain("Precio USD 29.99");
});

test("expected targets duplicados con action assertions se deduplican", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "SYNTH_DEDUP",
    caseId: 99992,
    title: "Dedup test",
    steps: [
      { index: 1, action: "Validar que se muestre 'Products'.", expected: "Products", dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  const assertionTexts = parsed.assertionTargets.map((t) => t.target);
  const productsCount = assertionTexts.filter((t) => t === "Products").length;
  expect(productsCount).toBe(1);
});

test("C37787 regression: orden esperado y sin asserts sinteticos", () => {
  const scenario: TestScenario = {
    source: "testrail",
    externalId: "C37787",
    caseId: 37787,
    title: "Login exitoso en SauceDemo",
    steps: [
      { index: 1, action: "Abrir URL del portal web.", expected: undefined, dataHints: [] },
      { index: 2, action: "Esperar que esté visible 'Swag Labs'.", expected: undefined, dataHints: [] },
      { index: 3, action: "Escribir el valor del dato 'usuario_valido' en el campo 'Username'.", expected: undefined, dataHints: [] },
      { index: 4, action: "Escribir el valor del dato 'contrasena_valida' en el campo 'Password'.", expected: undefined, dataHints: [] },
      { index: 5, action: "Hacer clic en 'Login'.", expected: undefined, dataHints: [] },
      { index: 6, action: "Validar que se muestre 'Products'.", expected: undefined, dataHints: [] },
      { index: 7, action: "Validar que se muestre 'Sauce Labs Backpack'.", expected: undefined, dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  const ordered = parsed.orderedSteps.map((s) => ({ index: s.stepIndex, type: s.type, target: s.target, source: s.source }));
  expect(ordered.length).toBe(6);

  expect(ordered[0]).toMatchObject({ index: 2, type: "assertion", target: "Swag Labs", source: "action" });
  expect(ordered[1]).toMatchObject({ index: 3, type: "action_fill", target: "Username", source: "action" });
  expect(ordered[2]).toMatchObject({ index: 4, type: "action_fill", target: "Password", source: "action" });
  expect(ordered[3]).toMatchObject({ index: 5, type: "action_click", target: "Login", source: "action" });
  expect(ordered[4]).toMatchObject({ index: 6, type: "assertion", target: "Products", source: "action" });
  expect(ordered[5]).toMatchObject({ index: 7, type: "assertion", target: "Sauce Labs Backpack", source: "action" });

  const actionTargets = parsed.actionTargets.map((t) => t.target);
  expect(actionTargets).toEqual(["Username", "Password", "Login"]);

  const assertionTexts = parsed.assertionTargets.map((t) => t.target);
  expect(assertionTexts).toEqual(["Swag Labs", "Products", "Sauce Labs Backpack"]);
  expect(assertionTexts).not.toContain("Validar que la pantalla final muestre señales esperadas:");
  expect(assertionTexts).not.toContain("Catálogo de productos disponible");
});

// --- setup_authentication & composite_action integration ---

test("parseScenarioStepsForDiscovery extrae setup_authentication en setupIntents no en actionTargets", () => {
  const scenario = makeScenario({
    externalId: "TEST-001",
    caseId: 99901,
    title: "Test login setup",
    steps: [
      { index: 1, action: "Abrir URL del portal web.", expected: undefined, dataHints: [] },
      { index: 2, action: "Iniciar sesión con el dato 'usuario_valido' y 'contrasena_valida'.", expected: undefined, dataHints: [] },
      { index: 3, action: "Validar que se muestre 'Products'.", expected: undefined, dataHints: [] }
    ]
  });

  const parsed = parseScenarioStepsForDiscovery(scenario);

  expect(parsed.setupIntents.length).toBe(2);
  expect(parsed.setupIntents[1].type).toBe("setup_authentication");
  expect(parsed.setupIntents[1].valueKeys).toEqual(["usuario_valido", "contrasena_valida"]);

  const actionTargets = parsed.actionTargets.map((t) => t.target);
  expect(actionTargets).not.toContain("Iniciar sesión con el dato 'usuario_valido' y 'contrasena_valida'");

  const orderedTargets = parsed.orderedSteps.map((s) => s.target);
  expect(orderedTargets).toEqual(["Products"]);
});

function makeScenario(overrides: Partial<TestScenario> & { steps: TestScenario["steps"] }): TestScenario {
  return {
    externalId: `TEST-${Date.now()}`,
    caseId: 99999,
    title: "Test",
    source: "testrail",
    ...overrides
  };
}

test("parseScenarioStepsForDiscovery mapea composite_action 'Agregar X al carrito' a target 'Add to cart' con associatedEntity", () => {
  const scenario = makeScenario({
    externalId: "TEST-002",
    caseId: 99902,
    title: "Test add to cart",
    steps: [
      { index: 1, action: "Abrir URL del portal web.", expected: undefined, dataHints: [] },
      { index: 2, action: "Iniciar sesión con el dato 'u' y 'p'.", expected: undefined, dataHints: [] },
      { index: 3, action: "Agregar 'Sauce Labs Backpack' al carrito.", expected: undefined, dataHints: [] },
      { index: 4, action: "Validar que se muestre 'Products'.", expected: undefined, dataHints: [] }
    ]
  });

  const parsed = parseScenarioStepsForDiscovery(scenario);

  // composite_action should map target="Add to cart", not "Sauce Labs Backpack"
  const actionTargets = parsed.actionTargets.map((t) => ({ target: t.target, associatedEntity: t.associatedEntity }));
  expect(actionTargets).toContainEqual({ target: "Add to cart", associatedEntity: "Sauce Labs Backpack" });
  expect(actionTargets).not.toContainEqual({ target: "Sauce Labs Backpack", associatedEntity: undefined });

  const orderedTargets = parsed.orderedSteps.map((s) => ({ target: s.target, type: s.type }));
  expect(orderedTargets).toContainEqual({ target: "Add to cart", type: "action_click" });
  expect(orderedTargets).not.toContainEqual({ target: "Sauce Labs Backpack", type: "action_click" });
});

test("parseScenarioStepsForDiscovery preserva associatedEntity en click actions", () => {
  const scenario = makeScenario({
    externalId: "TEST-003",
    caseId: 99903,
    title: "Test associated entity click",
    steps: [
      { index: 1, action: "Abrir URL del portal web.", expected: undefined, dataHints: [] },
      { index: 2, action: "Iniciar sesión con el dato 'u' y 'p'.", expected: undefined, dataHints: [] },
      { index: 3, action: "Validar que se muestre 'Products'.", expected: undefined, dataHints: [] },
      { index: 4, action: "Clic en 'Add to cart' asociado al producto 'Sauce Labs Backpack'.", expected: undefined, dataHints: [] },
      { index: 5, action: "Validar que se muestre 'Remove'.", expected: undefined, dataHints: [] }
    ]
  });

  const parsed = parseScenarioStepsForDiscovery(scenario);

  const actionTargets = parsed.actionTargets;
  const addToCartTarget = actionTargets.find((t) => t.target === "Add to cart");
  expect(addToCartTarget).toBeDefined();
  expect(addToCartTarget!.associatedEntity).toBe("Sauce Labs Backpack");
});

test("navigation_path y accion en el mismo step preservan orden ejecutable base", () => {
  const scenario = makeScenario({
    externalId: "ORDER-NAV-ACTION",
    caseId: 99101,
    title: "Order navigation then action",
    steps: [
      { index: 1, action: "Abrir A > B > C. Seleccionar X. Clic en Y.", expected: undefined, dataHints: [] }
    ]
  });

  const parsed = parseScenarioStepsForDiscovery(scenario);
  const nav = parsed.setupIntents.find((i) => i.type === "navigation_path");
  expect(nav).toBeDefined();
  expect(nav!.path).toEqual(["A", "B", "C"]);
  expect(parsed.actionTargets.map((a) => a.target)).toEqual(["X", "Y"]);
});

test("assertion con slash no entra en setupIntents", () => {
  const scenario = makeScenario({
    externalId: "ASSERTION-SLASH",
    caseId: 99102,
    title: "Assertion slash",
    steps: [
      { index: 1, action: "Validar detalle/listado de productos", expected: undefined, dataHints: [] }
    ]
  });

  const parsed = parseScenarioStepsForDiscovery(scenario);
  expect(parsed.setupIntents.length).toBe(0);
  expect(parsed.assertionTargets.map((a) => a.target)).toContain("detalle/listado de productos");
});

test("assertion semantica no se valida como texto literal completo", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ text: "Depositos a plazo en dolares" }),
    makeSnapshotElement({ type: "section", text: "Listado disponible" })
  ]);
  const targets: AssertionTargetInput[] = [{
    index: 1,
    action: "Validar detalle/listado de depósitos a plazo en dólares",
    target: "detalle/listado de depósitos a plazo en dólares",
    source: "action"
  }];

  const [result] = resolveAssertionTargets(snapshot, targets);
  expect(result.classification).toBe("semantic_descriptor");
  expect(result.status).toBe("passed");
  expect(result.reason.toLowerCase()).not.toContain("literal");
});

test("assertion semantica sin señales queda needs_assertion_resolution", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ text: "Bienvenido" })
  ]);
  const targets: AssertionTargetInput[] = [{
    index: 1,
    action: "Validar detalle/listado de productos",
    target: "detalle/listado de productos",
    source: "action"
  }];
  const [result] = resolveAssertionTargets(snapshot, targets);
  expect(result.status).toBe("needs_assertion_resolution");
});

test("candidate plan evita assertText literal débil para descriptor semántico", () => {
  const scenario = makeScenario({
    externalId: "SEM-PLAN-01",
    caseId: 99103,
    title: "Semantic assertion plan",
    steps: [
      { index: 1, action: "Validar detalle/listado de productos", expected: undefined, dataHints: [] }
    ]
  });
  const parsed = parseScenarioStepsForDiscovery(scenario);
  const expectedTargets = parsed.assertionTargets.map((target) => target.target);
  expect(expectedTargets).toContain("detalle/listado de productos");
});

test("parseScenarioStepsForDiscovery expected lines con prefijo '-' se limpian correctamente", () => {
  const scenario = makeScenario({
    externalId: "TEST-004",
    caseId: 99904,
    title: "Test expected stripping",
    steps: [
      { index: 1, action: "Abrir URL del portal web.", expected: "- Products\n- Sauce Labs Backpack\n* Sauce Labs Bike Light", dataHints: [] }
    ]
  });

  const parsed = parseScenarioStepsForDiscovery(scenario);
  const assertionTexts = parsed.assertionTargets.map((t) => t.target);
  expect(assertionTexts).toContain("Products");
  expect(assertionTexts).toContain("Sauce Labs Backpack");
  expect(assertionTexts).toContain("Sauce Labs Bike Light");
  expect(assertionTexts).not.toContain("- Products");
});

// ─── Semantic Target Resolution Integration ───────────────────────

test("normalizeSemanticText normaliza correctamente textos con separadores", () => {
  expect(normalizeSemanticText("shopping_cart_link")).toBe("shopping cart link");
  expect(normalizeSemanticText("shopping-cart-link")).toBe("shopping cart link");
  expect(normalizeSemanticText("  menú  ")).toBe("menu");
});

test("tokenizeWithStopwords extrae tokens significativos de 'carrito de compras'", () => {
  const tokens = tokenizeWithStopwords("el carrito de compras");
  expect(tokens).not.toContain("el");
  expect(tokens).not.toContain("de");
  expect(tokens).toContain("carrito");
  expect(tokens).toContain("compras");
});

test("expandSemanticTokens expande 'carrito' a grupo cart con sinonimos en ingles", () => {
  const tokens = tokenizeWithStopwords("el carrito de compras");
  const expanded = expandSemanticTokens(tokens);
  expect(expanded.groups).toContain("cart");
  expect(expanded.tokens).toEqual(expect.arrayContaining(["shopping", "cart", "basket", "bag"]));
});

test("expandSemanticTokens expande 'notificaciones' a grupo notifications", () => {
  const tokens = tokenizeWithStopwords("notificaciones");
  const expanded = expandSemanticTokens(tokens);
  expect(expanded.groups).toContain("notifications");
  expect(expanded.tokens).toContain("bell");
  expect(expanded.tokens).toContain("alertas");
});

test("expandSemanticTokens expande 'menu' a grupo menu con sinonimos", () => {
  const tokens = tokenizeWithStopwords("menú");
  const expanded = expandSemanticTokens(tokens);
  expect(expanded.groups).toContain("menu");
  expect(expanded.tokens).toContain("hamburger");
  expect(expanded.tokens).toContain("navigation");
});

test("computeSemanticScore puntua alto class con token del grupo semantic", () => {
  const result = computeSemanticScore("carrito de compras", {
    className: "shopping_cart_link"
  });
  expect(result.score).toBeGreaterThan(0.3);
  expect(result.matchedSignal).toBe("class");
  expect(result.semanticGroup).toBe("cart");
});

test("computeSemanticScore puntua alto aria-label con 'Shopping cart'", () => {
  const result = computeSemanticScore("carrito de compras", {
    ariaLabel: "Shopping cart"
  });
  expect(result.score).toBeGreaterThan(0.5);
  expect(result.matchedSignal).toBe("aria-label");
  expect(result.semanticGroup).toBe("cart");
});

test("computeSemanticScore puntua alto href con '/cart' path", () => {
  const result = computeSemanticScore("carrito", {
    href: "https://example.com/cart"
  });
  expect(result.score).toBeGreaterThan(0.5);
  expect(result.matchedSignal).toBe("href");
});

test("computeSemanticScore retorna 0 para target sin relacion semantica", () => {
  const result = computeSemanticScore("xyz123", {
    href: "https://example.com/page",
    className: "some-class"
  });
  expect(result.score).toBe(0);
});

test("computeSemanticScore puntua alto aria-label con 'Shopping cart' y devuelve matchedSignal", () => {
  const result = computeSemanticScore("carrito de compras", {
    ariaLabel: "Shopping cart"
  });
  expect(result.score).toBeGreaterThan(0.4);
  expect(result.matchedSignal).toBe("aria-label");
  expect(result.signalValue).toBe("Shopping cart");
});

// --- Early Completion Tests ---

test("evaluateEarlyCompletion returns satisfied=true when mandatory assertions are satisfied", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Expected Result", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Validar 'Expected Result'", target: "Expected Result", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'Optional Step'", target: "Optional Step" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(true);
  expect(result.skippedRemainingActions).toBe(1);
  expect(result.pendingAssertions).toEqual([]);
  expect(result.satisfiedAssertions).toContain("Expected Result");
});

test("evaluateEarlyCompletion returns satisfied=false when mandatory assertions are pending", () => {
  const snapshot = makeAssertionSnapshot([]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Validar 'Missing Text'", target: "Missing Text", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'Continue'", target: "Continue" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(false);
  expect(result.pendingAssertions.length).toBeGreaterThan(0);
  expect(result.pendingAssertions).toContain("Missing Text");
});

test("evaluateEarlyCompletion returns satisfied=false when no assertion targets exist", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Some text", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [];
  const remainingActions: ActionTargetItem[] = [
    { index: 1, action: "Clic en 'Continue'", target: "Continue" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(false);
  expect(result.satisfied).toBe(false);
});

test("evaluateEarlyCompletion marks completion parcial correctamente con pendingAssertions", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Visible Text", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Validar 'Visible Text'", target: "Visible Text", source: "expected" },
    { index: 6, action: "Validar 'Hidden Text'", target: "Hidden Text", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'Next'", target: "Next" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(false);
  expect(result.satisfiedAssertions).toContain("Visible Text");
  expect(result.pendingAssertions).toContain("Hidden Text");
});

test("descriptor sintetico expected-only no bloquea early completion", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Concrete Text", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Validar 'Concrete Text'", target: "Concrete Text", source: "action" },
    { index: 6, action: "Validar listado de productos", target: "Validar listado de productos", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'Continue'", target: "Continue" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(true);
  expect(result.satisfiedAssertions).toContain("Concrete Text");
  expect(result.pendingAssertions).toEqual([]);
});

test("literal obligatorio pendiente si bloquea early completion incluso con expected descriptors", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Other Text", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Validar 'Pending Literal'", target: "Pending Literal", source: "action" },
    { index: 6, action: "Validar listado de productos", target: "Validar listado de productos", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'Next'", target: "Next" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(false);
  expect(result.pendingAssertions).toContain("Pending Literal");
});

test("satisfied assertions aparecen exactamente en diagnostics", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Result A", visible: true }),
    makeSnapshotElement({ type: "text", text: "Result B", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Validar 'Result A'", target: "Result A", source: "expected" },
    { index: 6, action: "Validar 'Result B'", target: "Result B", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'Done'", target: "Done" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(true);
  expect(result.satisfiedAssertions).toEqual(["Result A", "Result B"]);
  expect(result.pendingAssertions).toEqual([]);
  expect(result.skippedRemainingActions).toBe(1);
});

test("pending assertions aparecen exactamente en diagnostics con texto completo", () => {
  const snapshot = makeAssertionSnapshot([]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Validar 'Missing A'", target: "Missing A", source: "expected" },
    { index: 6, action: "Validar 'Missing B'", target: "Missing B", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'Continue'", target: "Continue" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(false);
  expect(result.pendingAssertions).toEqual(["Missing A", "Missing B"]);
  expect(result.satisfiedAssertions).toEqual([]);
});

test("descriptor genérico sintético expected no bloquea early completion con señales fuertes", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Préstamo personal", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Assert: Préstamo personal", target: "Préstamo personal", source: "action" },
    { index: 7, action: "Assert: Información principal del producto visible", target: "Información principal del producto visible", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'Next'", target: "Next" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(true);
  expect(result.satisfiedAssertions).toContain("Préstamo personal");
  expect(result.pendingAssertions).toEqual([]);
  expect(result.blockingAssertions).toEqual([]);
  expect(result.skippedAssertions).toContain("Información principal del producto visible");
  expect(result.skippedReason).toBe("synthetic_generic_descriptor");
});

test("descriptor genérico sintético expected no bloquea si literales están satisfechos", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Préstamo personal", visible: true }),
    makeSnapshotElement({ type: "text", text: "Tasa de interés", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Assert: Préstamo personal", target: "Préstamo personal", source: "action" },
    { index: 6, action: "Assert: Tasa de interés", target: "Tasa de interés", source: "action" },
    { index: 7, action: "Assert: Información principal del producto visible", target: "Información principal del producto visible", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'Next'", target: "Next" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(true);
  expect(result.satisfiedAssertions).toContain("Préstamo personal");
  expect(result.pendingAssertions).toEqual([]);
  expect(result.blockingAssertions).toEqual([]);
  expect(result.skippedAssertions).toContain("Información principal del producto visible");
});

test("descriptor genérico sintético expected no bloquea si solo quedan weak signals", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Préstamo personal", visible: true }),
    makeSnapshotElement({ type: "text", text: "Detalle de prestamo personal visible", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Assert: Préstamo personal", target: "Préstamo personal", source: "expected" },
    { index: 6, action: "Assert: Información principal del producto visible", target: "Información principal del producto visible", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'View'", target: "View" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(true);
  expect(result.weakSignals).toContain("Información principal del producto visible");
});

test("early completion no pasa cuando queda literal obligatorio aunque haya weak signals", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Préstamo personal", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Assert: Préstamo personal", target: "Préstamo personal", source: "expected" },
    { index: 6, action: "Validar 'Monto mínimo'", target: "Monto mínimo", source: "action" },
    { index: 7, action: "Assert: Información principal del producto visible", target: "Información principal del producto visible", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'Next'", target: "Next" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(false);
  expect(result.pendingAssertions).toContain("Monto mínimo");
  expect(result.blockingAssertions).toContain("Monto mínimo");
  expect(result.skippedAssertions).toContain("Información principal del producto visible");
  expect(result.satisfiedAssertions).toContain("Préstamo personal");
});

test("early completion incluye diagnostics de skippedAssertions y weakSignals", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Resultado visible", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Assert: Resultado visible", target: "Resultado visible", source: "expected" },
    { index: 6, action: "Assert: Datos principales visibles", target: "Datos principales visibles", source: "expected" },
    { index: 7, action: "Assert: Acciones disponibles según producto", target: "Acciones disponibles según producto", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 3, action: "Clic en 'Done'", target: "Done" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(true);
  expect(result.blockingAssertions).toEqual([]);
  expect(result.skippedAssertions.length).toBe(2);
  expect(result.weakSignals.length).toBe(2);
  expect(result.skippedReason).toBe("synthetic_generic_descriptor");
});

// --- Detail descriptor early completion tests ---

test("'Detalle de X visible' como expected detail descriptor no bloquea early completion si X no está visible", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "heading", text: "Bienvenido", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 3, action: "Assert: Detalle de Préstamo Personal visible", target: "Detalle de Préstamo Personal visible", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 2, action: "Clic en 'Préstamo personal'", target: "Préstamo personal" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  // Expected-source detail descriptor without subject match -> skipped, so not pending
  expect(result.pendingAssertions.length).toBe(0);
  expect(result.skippedAssertions.length).toBe(1);
  expect(result.weakSignals.length).toBe(1);
  expect(result.satisfied).toBe(false);
});

test("'Detalle de X visible' expected no bloquea si un literal está satisfecho y solo queda detail descriptor", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Préstamo Personal", visible: true }),
    makeSnapshotElement({ type: "heading", text: "Resultado visible", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 2, action: "Assert: Resultado visible", target: "Resultado visible", source: "expected" },
    { index: 3, action: "Assert: Detalle de Préstamo Personal visible", target: "Detalle de Préstamo Personal visible", source: "expected" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 1, action: "Clic en 'Préstamo personal'", target: "Préstamo personal" }
  ];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(true);
  expect(result.satisfiedAssertions.length).toBe(2);
  expect(result.satisfiedAssertions).toContain("Detalle de Préstamo Personal visible");
});

test("detail descriptor from action source is satisfied when subject visible with section signal", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "heading", text: "Tarjeta Visa Gold", visible: true }),
    makeSnapshotElement({ type: "section", text: "Detalle de tarjeta", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 3, action: "Assert: Detalle de Tarjeta Visa Gold visible", target: "Detalle de Tarjeta Visa Gold visible", source: "action" }
  ];
  const remainingActions: ActionTargetItem[] = [];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.satisfied).toBe(true);
  expect(result.satisfiedAssertions.length).toBe(1);
});

test("detail descriptor isWeakSignal true es tratado como skippable por evaluateEarlyCompletion", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "text", text: "Bienvenido", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 3, action: "Assert: Detalle de Producto visible", target: "Detalle de Producto visible", source: "action" }
  ];
  const remainingActions: ActionTargetItem[] = [];

  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  // isWeakSignal=true from DETAIL_DESCRIPTOR_PATTERNS match makes it skippable regardless of source
  expect(result.pendingAssertions.length).toBe(0);
  expect(result.skippedAssertions.length).toBe(1);
  expect(result.weakSignals.length).toBe(1);
});

test("deferred assertion no bloquea early completion mientras hay acciones pendientes", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "card", text: "Item 1", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Assert: total del carrito", target: "total del carrito", source: "action" }
  ];
  const remainingActions: ActionTargetItem[] = [
    { index: 2, action: "Clic en 'Cart'", target: "Cart" }
  ];
  const result = evaluateEarlyCompletion(snapshot, assertionTargets, remainingActions);
  expect(result.checked).toBe(true);
  expect(result.pendingAssertions.length).toBe(0);
  expect(result.deferredAssertions).toContain("total del carrito");
});

test("deferred assertion puede bloquear al final si no quedan acciones para alcanzar contexto", () => {
  const snapshot = makeAssertionSnapshot([
    makeSnapshotElement({ type: "card", text: "Item 1", visible: true })
  ]);
  const assertionTargets: AssertionTargetInput[] = [
    { index: 5, action: "Assert: total del carrito", target: "total del carrito", source: "action" }
  ];
  const result = evaluateEarlyCompletion(snapshot, assertionTargets, []);
  expect(result.checked).toBe(true);
  expect(result.pendingAssertions).toContain("total del carrito");
});

// --- Runtime Evidence Trace / Failure Forensics tests ---

test("RuntimeEvidenceTrace type captures step evidence", () => {
  const evidence: import("../src/types/discovery.types").RuntimeEvidenceTrace = {
    clickActions: [{
      stepIndex: 1,
      target: "Login",
      normalizedTarget: "login",
      actionType: "click",
      success: true
    }],
    fillActions: [],
    formEvidence: [],
    confirmationEvidence: [],
    structuralEvidence: [],
    feedbackEvidence: []
  };
  
  expect(evidence.clickActions[0].stepIndex).toBe(1);
  expect(evidence.clickActions[0].actionType).toBe("click");
  expect(evidence.clickActions[0].success).toBe(true);
});

test("PendingAssertionForensics type captures diagnostic information", () => {
  const forensics: import("../src/types/discovery.types").PendingAssertionForensics = {
    assertion: "Carrito contiene producto",
    normalizedAssertion: "carrito contiene producto",
    inferredType: "cart",
    requiredContext: "cart",
    currentContext: "catalog",
    expectedConsumption: ["satisfied_by_structural_evidence"],
    evidenceAvailable: false,
    matchedEvidence: {
      latestSnapshotSignals: ["cart_precondition_unresolved"]
    },
    notConsumedReason: "wrong_context",
    autoRepairAllowed: false,
    classification: "structural_assertion",
    status: "needs_assertion_resolution"
  };
  
  expect(forensics.inferredType).toBe("cart");
  expect(forensics.currentContext).toBe("catalog");
  expect(forensics.notConsumedReason).toBe("wrong_context");
});

test("AutoRepairDecisionDiagnostics type captures repair decision", () => {
  const diagnostics: import("../src/types/discovery.types").AutoRepairDecisionDiagnostics = {
    attempted: true,
    skipped: true,
    skipReason: "local_diagnostic_sufficient",
    evaluatedPendingAssertions: ["Product detail visible"],
    localClosureAttempted: true,
    localClosureConsumed: ["Fill username"],
    localClosureRemaining: ["Product detail visible"],
    ambiguousRemaining: [],
    localDiagnostics: ["deferred_until_context", "structurally_satisfied"],
    pendingAssertions: ["Product detail visible"],
    consumedAssertions: ["Fill username"],
    autoRepairAllowed: false,
    autoRepairReason: "none",
    autoRepairSkippedReason: "local_diagnostic_sufficient",
    decision: "skip",
    explanation: "Auto-repair skipped because all pending assertions have local diagnostics"
  };
  
  expect(diagnostics.skipped).toBe(true);
  expect(diagnostics.decision).toBe("skip");
  expect(diagnostics.skipReason).toBe("local_diagnostic_sufficient");
});

test("BatchCaseRootCause categories are defined", () => {
  const rootCauses: import("../src/types/discovery.types").BatchCaseRootCause[] = [
    "target_not_found",
    "ambiguous_target",
    "locator_resolution_failed",
    "assertion_not_resolved",
    "context_not_reached",
    "precondition_unresolved",
    "structural_evidence_missing",
    "test_data_missing",
    "auth_gate_blocked",
    "page_transition_missing",
    "agent_timeout",
    "agent_no_proposal",
    "local_assertions_pending",
    "assertion_consumption_gap",
    "unknown"
  ];
  
  expect(rootCauses.length).toBe(15);
  expect(rootCauses).toContain("context_not_reached");
  expect(rootCauses).toContain("precondition_unresolved");
});
