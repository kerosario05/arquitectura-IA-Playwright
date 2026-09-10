import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { extractFunctionalCode, normalizeTitle, findReusableAutomation, cloneExecutionPlan, validatePromotedArtifactForReuse } from "../src/automations/automation-reuse";
import type { PromotedAutomationIndexEntry } from "../src/types/automation-promotion.types";
import type { ExecutionPlan } from "../src/types/execution-plan.types";

function makeEntry(overrides: Partial<PromotedAutomationIndexEntry> & { id: string; title: string }): PromotedAutomationIndexEntry {
  return {
    id: overrides.id,
    title: overrides.title,
    planPath: `automations/plans/${overrides.id}.plan.json`,
    specPath: overrides.specPath ?? `tests/generated/${overrides.id}.spec.ts`,
    status: overrides.status ?? "active",
    source: "rule_based",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    specVerificationStatus: overrides.specVerificationStatus,
    appSlug: overrides.appSlug,
    caseId: overrides.caseId,
    externalId: overrides.externalId,
    tags: overrides.tags
  };
}

test.describe("extractFunctionalCode", () => {
  test("extracts C37372 from title with code prefix", () => {
    expect(extractFunctionalCode("C37372 - Acceso al modulo Informacion de productos")).toBe("C37372");
  });

  test("extracts C37374 from title with code in middle", () => {
    expect(extractFunctionalCode("C37374 - Visualizar detalle de Tarjeta Visa Clasica")).toBe("C37374");
  });

  test("extracts code from title without separator", () => {
    expect(extractFunctionalCode("C37372 Acceso al modulo")).toBe("C37372");
  });

  test("returns undefined when no code present", () => {
    expect(extractFunctionalCode("Acceso al modulo Informacion de productos")).toBeUndefined();
  });

  test("returns undefined for short numbers that are not case codes", () => {
    expect(extractFunctionalCode("Step 123 of test")).toBeUndefined();
  });

  test("extracts 6-digit code", () => {
    expect(extractFunctionalCode("C123456 - Long code test")).toBe("C123456");
  });

  test("extracts 4-digit code", () => {
    expect(extractFunctionalCode("C1234 - Short code test")).toBe("C1234");
  });
});

test.describe("normalizeTitle", () => {
  test("removes C code prefix with separator", () => {
    expect(normalizeTitle("C37372 - Acceso al modulo Informacion de productos")).toBe("acceso al modulo informacion de productos");
  });

  test("removes C code without separator", () => {
    expect(normalizeTitle("C37372 Acceso al modulo")).toBe("acceso al modulo");
  });

  test("normalizes accents", () => {
    expect(normalizeTitle("Acceso a información")).toBe("acceso a informacion");
  });

  test("collapses multiple spaces", () => {
    expect(normalizeTitle("Acceso   al   modulo")).toBe("acceso al modulo");
  });

  test("handles empty string", () => {
    expect(normalizeTitle("")).toBe("");
  });

  test("two equivalent titles normalize to same value", () => {
    const t1 = normalizeTitle("C37372 - Acceso al modulo Informacion de productos");
    const t2 = normalizeTitle("Acceso al modulo Informacion de productos");
    expect(t1).toBe(t2);
  });
});

test.describe("findReusableAutomation", () => {
  test("requires modern promoted identity and matching physical hash", () => {
    const specPath = "automations/apps/app-a/sections/section-a/cases/c1/case.spec.ts";
    const specText = "test('promoted', async () => {})";
    const promotedSpecHash = createHash("sha256").update(specText, "utf8").digest("hex");
    const entry = makeEntry({ id: "c1-modern", title: "Modern", caseId: 1, externalId: "C1", specPath, appSlug: "app-a", specVerificationStatus: "passed" } as any) as any;
    entry.promotionPersisted = true;
    entry.promotedSpecPath = specPath;
    entry.promotedSpecHash = promotedSpecHash;
    const physical = { specPath, specExists: true, specText, appSlug: "app-a", sectionSlug: "section-a", caseId: 1 };
    expect(validatePromotedArtifactForReuse(entry, physical)).toEqual({ valid: true });
    expect(validatePromotedArtifactForReuse({ ...entry, status: "active", promotionPersisted: false }, physical).valid).toBe(false);
    expect(validatePromotedArtifactForReuse({ ...entry, promotedSpecHash: "different" }, physical).reason).toBe("promoted_spec_hash_mismatch");
    expect(validatePromotedArtifactForReuse({ ...entry, specVerificationStatus: "failed" }, physical).reason).toBe("verification_not_passed");
    expect(validatePromotedArtifactForReuse({ ...entry, promotedSpecHash: undefined }, physical).reason).toBe("promoted_spec_hash_missing");
    const legacyEntry = { ...entry };
    delete legacyEntry.promotionPersisted;
    delete legacyEntry.promotedSpecPath;
    delete legacyEntry.promotedSpecHash;
    expect(validatePromotedArtifactForReuse(legacyEntry, physical).reason).toBe("promotion_not_persisted");
    expect(findReusableAutomation(99, "Modern", [entry], new Map([[entry.id, physical]])).entry.id).toBe(entry.id);
    expect(findReusableAutomation(99, "Modern", [{ ...entry, promotedSpecHash: "different" }], new Map([[entry.id, physical]]) )).toBeUndefined();
  });
  test("finds automation by same functionalCode", () => {
    const automations: PromotedAutomationIndexEntry[] = [
      makeEntry({ id: "c37616-c37372-acceso", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37616 }),
      makeEntry({ id: "c37617-c37373-other", title: "C37373 - Other test", caseId: 37617 })
    ];

    const match = findReusableAutomation(37749, "C37372 - Acceso al modulo Informacion de productos", automations);

    expect(match).toBeDefined();
    expect(match!.entry.id).toBe("c37616-c37372-acceso");
    expect(match!.matchType).toBe("functional_code");
    expect(match!.confidence).toBe(0.95);
  });

  test("finds exact same-case automation first", () => {
    const automations: PromotedAutomationIndexEntry[] = [
      makeEntry({ id: "c37750-same-case", title: "Consulta listado de tarjetas de credito", caseId: 37750 }),
      makeEntry({ id: "c37616-similar", title: "Consulta listado de tarjetas de credito", caseId: 37616 })
    ];

    const match = findReusableAutomation(37750, "Consulta listado de tarjetas de credito", automations);

    expect(match).toBeDefined();
    expect(match!.entry.id).toBe("c37750-same-case");
    expect(match!.matchType).toBe("same_case");
    expect(match!.confidence).toBe(1);
  });

  test("finds automation by normalized title when functionalCode differs", () => {
    const automations: PromotedAutomationIndexEntry[] = [
      makeEntry({ id: "c37616-no-code-acceso", title: "Acceso al modulo Informacion de productos", caseId: 37616 })
    ];

    const match = findReusableAutomation(37749, "Acceso al modulo Informacion de productos", automations);

    expect(match).toBeDefined();
    expect(match!.entry.id).toBe("c37616-no-code-acceso");
    expect(match!.matchType).toBe("normalized_title");
    expect(match!.confidence).toBe(0.8);
  });

  test("does not find match if functionalCode and title differ", () => {
    const automations: PromotedAutomationIndexEntry[] = [
      makeEntry({ id: "c37616-c37372-acceso", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37616 })
    ];

    const match = findReusableAutomation(37750, "C99999 - Completely different test", automations);

    expect(match).toBeUndefined();
  });

  test("skips inactive automations even when same caseId as target", () => {
    const automations: PromotedAutomationIndexEntry[] = [
      makeEntry({ id: "c37749-c37372-acceso", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37749, status: "disabled" })
    ];

    const match = findReusableAutomation(37749, "C37372 - Acceso al modulo Informacion de productos", automations);

    expect(match).toBeUndefined();
  });

  test("sk inactive automations", () => {
    const automations: PromotedAutomationIndexEntry[] = [
      makeEntry({ id: "c37616-c37372-acceso", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37616, status: "disabled" })
    ];

    const match = findReusableAutomation(37749, "C37372 - Acceso al modulo Informacion de productos", automations);

    expect(match).toBeUndefined();
  });

  test("skips draft automations", () => {
    const automations: PromotedAutomationIndexEntry[] = [
      makeEntry({ id: "c37616-c37372-acceso", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37616, status: "draft" })
    ];

    const match = findReusableAutomation(37749, "C37372 - Acceso al modulo Informacion de productos", automations);

    expect(match).toBeUndefined();
  });

  test("returns undefined for empty automations list", () => {
    const match = findReusableAutomation(37749, "C37372 - Test", []);
    expect(match).toBeUndefined();
  });

  test("functional_code match has higher confidence than normalized_title", () => {
    const automations: PromotedAutomationIndexEntry[] = [
      makeEntry({ id: "c37616-title-match", title: "Acceso al modulo Informacion de productos", caseId: 37616 }),
      makeEntry({ id: "c37617-code-match", title: "C37372 - Acceso al modulo Informacion de productos", caseId: 37617 })
    ];

    const match = findReusableAutomation(37749, "C37372 - Acceso al modulo Informacion de productos", automations);

    expect(match).toBeDefined();
    expect(match!.entry.id).toBe("c37617-code-match");
    expect(match!.matchType).toBe("functional_code");
  });
});

test.describe("cloneExecutionPlan", () => {
  function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
    return {
      version: "1.0",
      source: "rule_based",
      status: "validated",
      scenario: {
        source: "testrail",
        externalId: "C37372",
        caseId: 37616,
        title: "C37372 - Acceso al modulo Informacion de productos"
      },
      requiredData: [],
      steps: [
        { index: 1, action: "navigate", target: "APP_BASE_URL" },
        { index: 2, action: "click", target: { strategy: "text", value: "Consultar" } }
      ],
      createdAt: new Date().toISOString(),
      ...overrides
    };
  }

  test("clones plan with new caseId", () => {
    const plan = makePlan();
    const cloned = cloneExecutionPlan(plan, 37749, "C37749 - Acceso al modulo Informacion de productos", "c37616-c37372-acceso");

    expect(cloned.scenario.caseId).toBe(37749);
    expect(cloned.scenario.title).toBe("C37749 - Acceso al modulo Informacion de productos");
    expect(cloned.scenario.externalId).toBe("C37372");
  });

  test("preserves steps from original plan", () => {
    const plan = makePlan();
    const cloned = cloneExecutionPlan(plan, 37749, "New Title", "source-id");

    expect(cloned.steps).toHaveLength(2);
    expect(cloned.steps[0].action).toBe("navigate");
    expect(cloned.steps[1].action).toBe("click");
  });

  test("preserves requiredData from original plan", () => {
    const plan = makePlan({
      requiredData: [{ key: "cedula", required: true, resolved: true }]
    });
    const cloned = cloneExecutionPlan(plan, 37749, "New Title", "source-id");

    expect(cloned.requiredData).toHaveLength(1);
    expect(cloned.requiredData[0].key).toBe("cedula");
  });

  test("adds reuse note to plan", () => {
    const plan = makePlan();
    const cloned = cloneExecutionPlan(plan, 37749, "New Title", "c37616-c37372-acceso");

    expect(cloned.notes).toContain("Reused from automation: c37616-c37372-acceso");
  });

  test("appends reuse note to existing notes", () => {
    const plan = makePlan({ notes: ["Existing note"] });
    const cloned = cloneExecutionPlan(plan, 37749, "New Title", "source-id");

    expect(cloned.notes).toContain("Existing note");
    expect(cloned.notes).toContain("Reused from automation: source-id");
  });

  test("does not mutate original plan", () => {
    const plan = makePlan();
    const originalCaseId = plan.scenario.caseId;
    const originalTitle = plan.scenario.title;

    cloneExecutionPlan(plan, 37749, "New Title", "source-id");

    expect(plan.scenario.caseId).toBe(originalCaseId);
    expect(plan.scenario.title).toBe(originalTitle);
  });

  test("preserves plan status", () => {
    const plan = makePlan({ status: "validated" });
    const cloned = cloneExecutionPlan(plan, 37749, "New Title", "source-id");

    expect(cloned.status).toBe("validated");
  });

  test("preserves plan source", () => {
    const plan = makePlan({ source: "rule_based" });
    const cloned = cloneExecutionPlan(plan, 37749, "New Title", "source-id");

    expect(cloned.source).toBe("rule_based");
  });
});
