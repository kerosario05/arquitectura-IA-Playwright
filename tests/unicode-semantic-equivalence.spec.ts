import { expect, test } from "@playwright/test";
import { computeTraceFidelity } from "../src/automations/spec-execution-contract";
import { structuralValidation } from "../src/automations/spec-generation-hybrid";
import {
  decodeJsStringLiteralBody,
  normalizeSemanticText,
  semanticallyEqualText,
} from "../src/automations/semantic-text-normalization";

test.describe("semantic Unicode equivalence", () => {
  test("T1-T4 equivalent representations compare equal", () => {
    expect(semanticallyEqualText("módulo", "m\\u00f3dulo")).toBe(true);
    expect(semanticallyEqualText("é", "\\u00e9")).toBe(true);
    expect(semanticallyEqualText("¿Qué?", "\\u00bfQu\\u00e9?")).toBe(true);
    expect(semanticallyEqualText("café", "cafe\\u0301")).toBe(true);
  });

  test("T5-T6 real changes remain different", () => {
    expect(semanticallyEqualText("módulo", "modulo")).toBe(false);
    expect(semanticallyEqualText("Continuar", "Iniciar")).toBe(false);
  });

  test("T7-T8 mojibake repair is preserved and idempotent", () => {
    const repaired = normalizeSemanticText("Â¿QuÃ©?");
    expect(repaired).toBe("¿Qué?");
    expect(normalizeSemanticText(repaired)).toBe(repaired);
  });

  test("T9-T10 trace fidelity compares decoded literal values", () => {
    const contract = {
      steps: [{ scenarioStepIndex: 0, contractStepIndex: 0, operation: "click", target: { strategy: "text", value: "¿Qué?" } }],
    } as any;
    const equivalent = String.raw`await promotedRuntime.clickPromotedTarget({ stepIndex: 0, target: "\u00bfQu\u00e9?", action: async () => {} });`;
    const changed = String.raw`await promotedRuntime.clickPromotedTarget({ stepIndex: 0, target: "Continuar", action: async () => {} });`;
    expect(computeTraceFidelity(equivalent, contract).status).toBe("passed");
    expect(computeTraceFidelity(changed, contract).errors.some((error) => error.startsWith("contract_target_changed:"))).toBe(true);
  });

  test("T11-T14 metadata values are validated structurally", () => {
    const base = {
      expectedAppSlug: "app-test",
      expectedSectionSlug: "section-test",
      expectedScenarioId: "scenario-test",
      expectedScenarioTitle: "¿Qué módulo?",
    };
    const common = `createPromotedSpecRuntime(); finally { finishEvidence(); }`;
    const equivalent = `${common}\nprocess.env.APP_SLUG = 'app-test';\nprocess.env.SECTION_SLUG = 'section-test';\nprocess.env.SCENARIO_ID = 'scenario-test';\nprocess.env.SCENARIO_TITLE = '\\u00bfQu\\u00e9 m\\u00f3dulo?';`;
    const validate = (specContent: string) => structuralValidation({
      ...base,
      specContent,
      sourceExpectedResultPresent: false,
      expectedResultText: "",
      scenarioSteps: [],
      requiredAssertions: [],
      observableOracles: [],
      executableStepIndexes: [],
      planStepActions: new Map(),
      response: { usedPageObjects: [], declaredIdentifiers: [], unresolvedRequirements: [] } as any,
      availablePageObjects: [],
      observedEvidencePhrases: [],
      promotedRuntimeMethodsAllowlist: [],
      mode: "deterministic",
    });
    expect(validate(equivalent).structureErrors.some((error) => error.startsWith("missing_metadata_line:"))).toBe(false);
    expect(validate(equivalent.replace("scenario-test", "wrong-id")).structureErrors).toContain("missing_metadata_line:SCENARIO_ID");
    expect(validate(equivalent.replace("app-test", "wrong-app")).structureErrors).toContain("missing_metadata_line:APP_SLUG");
    expect(validate(equivalent.replace("SCENARIO_TITLE =", "SCENARIO_TITLE = 'wrong'; /* ")).structureErrors).toContain("missing_metadata_line:SCENARIO_TITLE");
    expect(decodeJsStringLiteralBody("\\u00bfQu\\u00e9?")).toBe("¿Qué?");
  });

  test("T15-T16 production remains bounded and app-agnostic", () => {
    const utilitySource = require("fs").readFileSync(require.resolve("../src/automations/semantic-text-normalization"), "utf8");
    expect(utilitySource).not.toMatch(/\b(?:eval|new Function)\b/);
    expect(utilitySource).not.toMatch(/kiosko|AA-\d+|http/i);
  });
});
