import { test, expect } from "@playwright/test";
import { resolveCanonicalHuIntent } from "../src/scenarios/canonical-hu-intent";

test("canonical intent retains transactional intent and classifies it", () => {
  const resolution = resolveCanonicalHuIntent(
    { intent: "transactional_document_flow", confidence: "high", reason: "transaction", matchedSignals: ["transfer"] },
    "payment_transfer",
  );
  expect(resolution.primaryClassifierIntent).toBe("transactional_document_flow");
  expect(resolution.transactionalRelevant).toBe(true);
  expect(resolution.dominantIntent).toBe("payment_transfer");
});

test("canonical intent keeps branch-specific access intent", () => {
  const resolution = resolveCanonicalHuIntent(
    { intent: "unknown_flow", confidence: "low", reason: "no signals", matchedSignals: [] },
    "generic",
    [{
      branchId: "private",
      sourceLabel: "Private area",
      actionIntent: "navigate",
      accessIntent: "authenticated",
      evidenceSource: "user_story",
    }],
  );
  expect(resolution.privateNavigationRelevant).toBe(true);
  expect(resolution.branchIntents.private.privateNavigationRelevant).toBe(true);
});
