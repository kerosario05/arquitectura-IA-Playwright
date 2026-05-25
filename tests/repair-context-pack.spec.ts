import { test, expect } from "@playwright/test";
import { buildRepairContextPack } from "../src/ai/repair/repair-context-pack";

test("excluye secretos", () => {
  const pack = buildRepairContextPack({
    appSlug: "app",
    failure: "target_not_found password token",
    currentStep: "step",
    currentUrl: "https://x",
    candidates: [{ candidateId: "c1", visible: true, text: "api-key here" }],
    maxChars: 5000
  });
  expect(JSON.stringify(pack)).not.toContain("password");
  expect(JSON.stringify(pack)).not.toContain("token");
});

test("respeta max chars", () => {
  const pack = buildRepairContextPack({
    appSlug: "app",
    failure: "target_not_found",
    currentStep: "step",
    currentUrl: "https://x",
    candidates: Array.from({ length: 200 }, (_, i) => ({ candidateId: `c${i}`, visible: true, text: "x".repeat(200) })),
    runtimeEvidenceTrace: { huge: "y".repeat(10000) },
    maxChars: 1000
  });
  expect(JSON.stringify(pack).length).toBeLessThanOrEqual(5000);
});

test("incluye failure/currentStep/candidates/constraints", () => {
  const pack = buildRepairContextPack({
    appSlug: "app",
    failure: "target_not_found",
    currentStep: "click x",
    currentUrl: "https://x",
    candidates: [{ candidateId: "c1", visible: true }],
    constraints: ["must_return_existing_candidate_id"],
    maxChars: 5000
  });
  expect(pack.failure).toContain("target_not_found");
  expect(pack.currentStep).toContain("click x");
  expect(pack.candidates[0].candidateId).toBe("c1");
  expect(pack.constraints?.[0]).toContain("must_return_existing_candidate_id");
});

test("no incluye repo/logs grandes", () => {
  const pack = buildRepairContextPack({
    appSlug: "app",
    failure: "x",
    currentStep: "y",
    currentUrl: "https://x",
    candidates: [{ candidateId: "c1", visible: true }],
    runtimeEvidenceTrace: { logs: "z".repeat(100000) },
    maxChars: 800
  });
  expect(JSON.stringify(pack).length).toBeLessThan(10000);
});
