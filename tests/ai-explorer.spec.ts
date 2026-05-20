import { test, expect } from "@playwright/test";
import { AIExplorer, createNoopAiExplorerProvider, validateAiExplorerOutputShape } from "../src/ai/ai-explorer";

test("validateAiExplorerOutputShape accepts a valid contract", () => {
  expect(validateAiExplorerOutputShape({
    action: "click",
    candidateId: "cta-1",
    target: "Continue",
    confidence: 0.91,
    reason: "Best clickable semantic match",
    alternatives: [
      {
        action: "wait",
        target: "Continue",
        reason: "Wait for the page to stabilize"
      }
    ],
    risk: "Low risk",
    requiresHumanApproval: false
  })).toBe(true);
});

test("validateAiExplorerOutputShape rejects malformed contracts", () => {
  expect(validateAiExplorerOutputShape({
    action: "hack",
    target: "Continue",
    confidence: 2,
    reason: "invalid",
    alternatives: [],
    risk: "High",
    requiresHumanApproval: false
  })).toBe(false);
});

test("AIExplorer returns null for noop providers", async () => {
  const explorer = new AIExplorer("custom", createNoopAiExplorerProvider("custom"));
  const proposal = await explorer.propose({
    currentGoal: "Navigate to next screen",
    currentStep: "Click continue",
    target: "Continue",
    snapshot: {
      version: "1.0",
      url: "https://example.com",
      title: "Example",
      capturedAt: new Date().toISOString(),
      elements: [],
      summary: {
        totalElements: 0,
        buttons: 0,
        links: 0,
        inputs: 0,
        selects: 0,
        tables: 0,
        dialogs: 0,
        headings: 0
      }
    },
    visibleElements: [],
    clickableCandidates: [],
    closestCandidates: [],
    previousSteps: [],
    allowedActions: ["click", "wait", "stop"],
    constraints: []
  });

  expect(proposal).toBeNull();
});

test("AIExplorer rejects invalid provider output", async () => {
  const explorer = new AIExplorer("custom", {
    name: "broken-provider",
    async propose() {
      return {
        action: "click",
        target: "Continue"
      } as any;
    }
  });

  await expect(() => explorer.propose({
    currentGoal: "Navigate",
    currentStep: "Click continue",
    target: "Continue",
    snapshot: {
      version: "1.0",
      url: "https://example.com",
      title: "Example",
      capturedAt: new Date().toISOString(),
      elements: [],
      summary: {
        totalElements: 0,
        buttons: 0,
        links: 0,
        inputs: 0,
        selects: 0,
        tables: 0,
        dialogs: 0,
        headings: 0
      }
    },
    visibleElements: [],
    clickableCandidates: [],
    closestCandidates: [],
    previousSteps: [],
    allowedActions: ["click"],
    constraints: []
  })).rejects.toThrow("invalid JSON contract");
});
