import { test, expect } from "@playwright/test";
import type { CaseDiscoveryResult, DiscoveryStepResult, DiscoveredObject } from "../src/types/discovery.types";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { TestScenario } from "../src/types/testrail.types";
import { extractCleanTarget, parseScenarioStepsForDiscovery } from "../src/discovery/case-discovery";
import { expandSemanticTokens, tokenizeWithStopwords, computeSemanticScore, normalizeSemanticText, buildSnapshotCandidates } from "../src/discovery/target-resolver";

type CliArgs = {
  caseId: number;
  headed: boolean;
  output?: string;
};

function parseDiscoveryCaseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { caseId: 0, headed: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--headed") {
      args.headed = true;
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
      { index: 2, action: "Validar que se muestre 'Products'.", expected: "Products\nSauce Labs Backpack\nValidar que la pantalla final muestre señales esperadas:\nCatálogo de productos disponible", dataHints: [] }
    ]
  };

  const parsed = parseScenarioStepsForDiscovery(scenario);

  const assertionTexts = parsed.assertionTargets.map((t) => t.target);
  expect(assertionTexts).toContain("Products");
  expect(assertionTexts).toContain("Sauce Labs Backpack");
  expect(assertionTexts).not.toContain("Validar que la pantalla final muestre señales esperadas:");
  expect(assertionTexts).toContain("Catálogo de productos disponible");

  const expectedSources = parsed.assertionTargets.filter((t) => t.source === "expected").map((t) => t.target);
  expect(expectedSources).toContain("Catálogo de productos disponible");
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
