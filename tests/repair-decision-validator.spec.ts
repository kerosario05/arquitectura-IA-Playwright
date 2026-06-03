import { test, expect } from "@playwright/test";
import { validateRepairDecision } from "../src/ai/repair/repair-decision-validator";

const baseContext = {
  candidates: [
    { candidateId: "c1", visible: true, clickable: true, enabled: true, sensitive: false }
  ]
};

test("repaired_plan requiere candidateId", () => {
  const r = validateRepairDecision({ decision: "repaired_plan", reason: "x" }, baseContext);
  expect(r.valid).toBe(false);
  if (!r.valid) expect(r.code).toBe("AI_REPAIR_MISSING_CANDIDATE");
});

test("candidateId debe existir", () => {
  const r = validateRepairDecision({ decision: "repaired_plan", reason: "x", candidateId: "missing" }, baseContext);
  expect(r.valid).toBe(false);
  if (!r.valid) expect(r.code).toBe("AI_REPAIR_UNKNOWN_CANDIDATE");
});

test("bloquea candidate invisible", () => {
  const r = validateRepairDecision(
    { decision: "repaired_plan", reason: "x", candidateId: "c1" },
    { candidates: [{ candidateId: "c1", visible: false, clickable: true }] }
  );
  expect(r.valid).toBe(false);
  if (!r.valid) expect(r.code).toBe("AI_REPAIR_CANDIDATE_NOT_VISIBLE");
});

test("bloquea candidate no actionable", () => {
  const r = validateRepairDecision(
    { decision: "repaired_plan", reason: "x", candidateId: "c1" },
    { candidates: [{ candidateId: "c1", visible: true, clickable: false, editable: false, enabled: true }] }
  );
  expect(r.valid).toBe(false);
  if (!r.valid) expect(r.code).toBe("AI_REPAIR_CANDIDATE_NOT_ACTIONABLE");
});

test("bloquea sensitive candidate", () => {
  const r = validateRepairDecision(
    { decision: "repaired_plan", reason: "x", candidateId: "c1" },
    { candidates: [{ candidateId: "c1", visible: true, clickable: true, sensitive: true }] }
  );
  expect(r.valid).toBe(false);
  if (!r.valid) expect(r.code).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
});

test("bloquea selector inventado", () => {
  const r = validateRepairDecision({ decision: "no_safe_action", reason: "x", css: "#id" }, baseContext as any);
  expect(r.valid).toBe(false);
  if (!r.valid) expect(r.code).toBe("AI_REPAIR_SELECTOR_INVENTED");
});

test("acepta no_safe_action con reason", () => {
  const r = validateRepairDecision({ decision: "no_safe_action", reason: "x" }, baseContext);
  expect(r.valid).toBe(true);
});

test("acepta needs_more_context con reason", () => {
  const r = validateRepairDecision({ decision: "needs_more_context", reason: "x" }, baseContext);
  expect(r.valid).toBe(true);
});

test("normaliza confidence high a numerico conocido", () => {
  const r = validateRepairDecision(
    { decision: "repaired_plan", reason: "x", candidateId: "c1", confidence: "high" },
    baseContext
  );
  expect(r.valid).toBe(true);
  if (r.valid) {
    expect(r.decision.confidence).toBe(0.85);
    expect(r.decision.confidenceNormalizedFrom).toBe("high");
  }
});

test("rechaza confidence string desconocido", () => {
  const r = validateRepairDecision(
    { decision: "repaired_plan", reason: "x", candidateId: "c1", confidence: "very-high" },
    baseContext
  );
  expect(r.valid).toBe(false);
  if (!r.valid) expect(r.code).toBe("AI_REPAIR_SCHEMA_INVALID");
});
