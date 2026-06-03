"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const ai_explorer_1 = require("../src/ai/ai-explorer");
(0, test_1.test)("validateAiExplorerOutputShape accepts a valid contract", () => {
    (0, test_1.expect)((0, ai_explorer_1.validateAiExplorerOutputShape)({
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
(0, test_1.test)("validateAiExplorerOutputShape rejects malformed contracts", () => {
    (0, test_1.expect)((0, ai_explorer_1.validateAiExplorerOutputShape)({
        action: "hack",
        target: "Continue",
        confidence: 2,
        reason: "invalid",
        alternatives: [],
        risk: "High",
        requiresHumanApproval: false
    })).toBe(false);
});
(0, test_1.test)("AIExplorer returns null for noop providers", async () => {
    const explorer = new ai_explorer_1.AIExplorer("custom", (0, ai_explorer_1.createNoopAiExplorerProvider)("custom"));
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
    (0, test_1.expect)(proposal).toBeNull();
});
(0, test_1.test)("AIExplorer rejects invalid provider output", async () => {
    const explorer = new ai_explorer_1.AIExplorer("custom", {
        name: "broken-provider",
        async propose() {
            return {
                action: "click",
                target: "Continue"
            };
        }
    });
    await (0, test_1.expect)(() => explorer.propose({
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
