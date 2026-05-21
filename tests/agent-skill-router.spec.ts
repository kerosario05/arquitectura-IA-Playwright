import { test, expect } from "@playwright/test";
import { selectSkill, isSkillAllowedInBatch, validateSkillResponseAgainstRules, getFailedReasonForRouting } from "../src/agent/agent-skill-router";
import { loadSkillDefinition } from "../src/agent/agent-skill-loader";
import type { SkillId, SkillSelectionCriteria, AgentSkillDefinition } from "../src/types/agent-skill.types";

test("selectSkill devuelve target-disambiguation para ambiguous_target", () => {
  const result = selectSkill({ failedReason: "ambiguous_target", hasCandidates: true });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("target-disambiguation");
});

test("selectSkill devuelve navigation-recovery para target_not_found", () => {
  const result = selectSkill({ failedReason: "target_not_found", hasCandidates: true });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("navigation-recovery");
});

test("selectSkill devuelve assertion-resolution para assertion_not_found", () => {
  const result = selectSkill({ failedReason: "assertion_not_found", hasPendingAssertions: true });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("assertion-resolution");
});

test("selectSkill devuelve assertion-resolution para pendingAssertions", () => {
  const result = selectSkill({ failedReason: "pendingAssertions", hasPendingAssertions: true });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("assertion-resolution");
});

test("selectSkill devuelve form-fill para field_not_found", () => {
  const result = selectSkill({ failedReason: "field_not_found" });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("form-fill");
});

test("selectSkill devuelve form-fill para missing_test_data", () => {
  const result = selectSkill({ failedReason: "missing_test_data" });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("form-fill");
});

test("selectSkill devuelve promotion-review para promotion_gate_blocked", () => {
  const result = selectSkill({ failedReason: "promotion_gate_blocked" });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("promotion-review");
});

test("selectSkill devuelve case-quality para repeated_targets", () => {
  const result = selectSkill({ failedReason: "repeated_targets" });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("case-quality");
});

test("selectSkill devuelve case-quality para vague_assertions", () => {
  const result = selectSkill({ failedReason: "vague_assertions" });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("case-quality");
});

test("selectSkill devuelve case-quality para poor_case_quality", () => {
  const result = selectSkill({ failedReason: "poor_case_quality" });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("case-quality");
});

test("selectSkill devuelve form-fill para ambiguous_field", () => {
  const result = selectSkill({ failedReason: "ambiguous_field" });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("form-fill");
});

test("selectSkill devuelve target-disambiguation con preferencia sobre navigation-recovery para locator_resolution_failed con candidatos", () => {
  const result = selectSkill({ failedReason: "locator_resolution_failed", hasCandidates: true });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("target-disambiguation");
});

test("selectSkill devuelve navigation-recovery para locator_resolution_failed sin candidatos", () => {
  const result = selectSkill({ failedReason: "locator_resolution_failed", hasCandidates: false });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("navigation-recovery");
});

test("selectSkill devuelve null para failedReason desconocido", () => {
  const result = selectSkill({ failedReason: "unknown_reason" as string });
  expect(result).toBeNull();
});

test("selectSkill devuelve null sin failedReason", () => {
  const result = selectSkill({});
  expect(result).toBeNull();
});

test("selected-skill.md se escribe en handoff", async () => {
  const { writeSelectedSkillFiles } = await import("../src/agent/agent-skill-loader");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-test-"));
  const definition = loadSkillDefinition("target-disambiguation");
  const { mdPath, jsonPath } = await writeSelectedSkillFiles(dir, "target-disambiguation", definition);

  const mdContent = await fs.readFile(mdPath, "utf-8");
  expect(mdContent).toContain("Selected Skill: target-disambiguation");
  expect(mdContent).toContain("Allowed Failure Reasons");
  expect(mdContent).toContain("Forbidden Actions");
  expect(mdContent).toContain("Validation Rules");

  const jsonContent = JSON.parse(await fs.readFile(jsonPath, "utf-8"));
  expect(jsonContent.selectedSkill).toBe("target-disambiguation");
  expect(jsonContent.definition).toBeDefined();
});

test("selected-skill.json contiene el skillId correcto", async () => {
  const { writeSelectedSkillFiles } = await import("../src/agent/agent-skill-loader");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-json-test-"));
  const definition = loadSkillDefinition("form-fill");
  const { jsonPath } = await writeSelectedSkillFiles(dir, "form-fill", definition);

  const jsonContent = JSON.parse(await fs.readFile(jsonPath, "utf-8"));
  expect(jsonContent.selectedSkill).toBe("form-fill");
  expect(jsonContent.definition.allowedFailureReasons).toContain("missing_test_data");
});

test("isSkillAllowedInBatch permite skills validas", () => {
  expect(isSkillAllowedInBatch("target-disambiguation")).toBe(true);
  expect(isSkillAllowedInBatch("navigation-recovery")).toBe(true);
  expect(isSkillAllowedInBatch("assertion-resolution")).toBe(true);
  expect(isSkillAllowedInBatch("form-fill")).toBe(true);
  expect(isSkillAllowedInBatch("promotion-review")).toBe(true);
  expect(isSkillAllowedInBatch("case-quality")).toBe(true);
});

test("validateSkillResponseAgainstRules rechaza skillId incorrecto", () => {
  const definition = loadSkillDefinition("target-disambiguation");
  const result = validateSkillResponseAgainstRules(
    { skillId: "assertion-resolution" as SkillId, proposedAction: { type: "click_candidate" }, confidence: 0.9, status: "proposal" },
    ["el1", "el2"],
    definition
  );
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain("does not match selected skill");
});

test("validateSkillResponseAgainstRules rechaza candidateId inexistente", () => {
  const definition = loadSkillDefinition("target-disambiguation");
  const result = validateSkillResponseAgainstRules(
    { skillId: "target-disambiguation", proposedAction: { type: "click_candidate", candidateId: "nonexistent" }, confidence: 0.9, status: "proposal" },
    ["el1", "el2"],
    definition
  );
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain("does not exist in snapshotCandidates");
});

test("validateSkillResponseAgainstRules rechaza confidence baja sin needs_agent_review", () => {
  const definition = loadSkillDefinition("target-disambiguation");
  const result = validateSkillResponseAgainstRules(
    { skillId: "target-disambiguation", proposedAction: { type: "click_candidate", candidateId: "el1" }, confidence: 0.3, status: "proposal" },
    ["el1"],
    definition
  );
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain("confidence");
});

test("validateSkillResponseAgainstRules rechaza requiresRegistryChange en batch", () => {
  const definition = loadSkillDefinition("navigation-recovery");
  const result = validateSkillResponseAgainstRules(
    { skillId: "navigation-recovery", proposedAction: { type: "click_candidate", candidateId: "el1" }, confidence: 0.9, status: "proposal", requiresCodeChange: false, requiresRegistryChange: true },
    ["el1"],
    definition
  );
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain("registry changes");
});

test("validateSkillResponseAgainstRules acepta respuesta valida", () => {
  const definition = loadSkillDefinition("target-disambiguation");
  const result = validateSkillResponseAgainstRules(
    { skillId: "target-disambiguation", proposedAction: { type: "click_candidate", candidateId: "el1" }, confidence: 0.85, status: "proposal" },
    ["el1"],
    definition
  );
  expect(result.valid).toBe(true);
  expect(result.errors).toHaveLength(0);
});

test("validateSkillResponseAgainstRules acepta needs_agent_review con confidence baja", () => {
  const definition = loadSkillDefinition("navigation-recovery");
  const result = validateSkillResponseAgainstRules(
    { skillId: "navigation-recovery", proposedAction: { type: "click_candidate", candidateId: "el1" }, confidence: 0.4, status: "needs_agent_review" },
    ["el1"],
    definition
  );
  expect(result.valid).toBe(true);
});

test("getFailedReasonForRouting mapea diagnostic hints", () => {
  expect(getFailedReasonForRouting("repeated_targets en step 3")).toBe("repeated_targets");
  expect(getFailedReasonForRouting("vague_assertions detected")).toBe("vague_assertions");
  expect(getFailedReasonForRouting("poor_case_quality")).toBe("poor_case_quality");
  expect(getFailedReasonForRouting("promotion_gate_blocked")).toBe("promotion_gate_blocked");
  expect(getFailedReasonForRouting("missing_test_data for field")).toBe("missing_test_data");
});

test("getFailedReasonForRouting pasa failedReason direct cuando no hay hint", () => {
  const result = getFailedReasonForRouting("ambiguous_target");
  expect(result).toBe("ambiguous_target");
});

test("getFailedReasonForRouting devuelve undefined sin failedReason", () => {
  const result = getFailedReasonForRouting(undefined);
  expect(result).toBeUndefined();
});

test("selectSkill devuelve navigation-recovery para click_no_transition", () => {
  const result = selectSkill({ failedReason: "click_no_transition", hasCandidates: true });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("navigation-recovery");
});

test("selectSkill devuelve assertion-resolution para needs_assertion_resolution", () => {
  const result = selectSkill({ failedReason: "needs_assertion_resolution", hasPendingAssertions: true });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("assertion-resolution");
});

test("selectSkill devuelve form-fill para fill_target_not_found", () => {
  const result = selectSkill({ failedReason: "fill_target_not_found" });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("form-fill");
});

test("selectSkill devuelve form-fill para fill_target_not_editable", () => {
  const result = selectSkill({ failedReason: "fill_target_not_editable" });
  expect(result).not.toBeNull();
  expect(result?.skillId).toBe("form-fill");
});

test("no hardcodear apps, productos, URLs, case IDs en router", () => {
  const checkNoHardcoded = (obj: unknown, path = ""): void => {
    if (typeof obj === "string") {
      expect(obj.toLowerCase()).not.toMatch(/(kiosko|saucelabs?|sauce_demo)/);
      expect(obj).not.toMatch(/C\d{5}/);
      if (obj.startsWith("http")) {
        expect(obj).not.toMatch(/localhost|example\.com/);
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, i) => checkNoHardcoded(item, `${path}[${i}]`));
    } else if (obj && typeof obj === "object") {
      for (const [key, value] of Object.entries(obj)) {
        checkNoHardcoded(value, `${path}.${key}`);
      }
    }
  };

  const skillResult = selectSkill({ failedReason: "ambiguous_target", hasCandidates: true });
  checkNoHardcoded(skillResult);
});

test("router asigna confidence mas alta con candidatos", () => {
  const withCandidates = selectSkill({ failedReason: "target_not_found", hasCandidates: true });
  const withoutCandidates = selectSkill({ failedReason: "target_not_found", hasCandidates: false });
  expect(withCandidates).not.toBeNull();
  expect(withoutCandidates).not.toBeNull();
  expect(withCandidates!.confidence).toBeGreaterThan(withoutCandidates!.confidence);
  expect(withoutCandidates!.confidence).toBe(0.2);
  expect(withCandidates!.confidence).toBe(0.7);
});
