"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const flow_registry_1 = require("../src/automations/flow-registry");
function emptyReg() {
    return { version: "1.0", appSlug: "test", flows: [], updatedAt: new Date().toISOString() };
}
(0, test_1.test)("registerFlowCandidate adds new flow", async () => {
    const reg = emptyReg();
    const { registry, created } = await (0, flow_registry_1.registerFlowCandidate)(reg, {
        name: "Login Flow",
        steps: [{ action: "click", target: "login-button" }],
        confidence: 0.85
    });
    (0, test_1.expect)(created).toBe(true);
    (0, test_1.expect)(registry.flows).toHaveLength(1);
    (0, test_1.expect)(registry.flows[0].name).toBe("Login Flow");
});
(0, test_1.test)("registerFlowCandidate does not duplicate", async () => {
    const reg = emptyReg();
    const r1 = await (0, flow_registry_1.registerFlowCandidate)(reg, {
        name: "Login Flow",
        steps: [{ action: "click", target: "login-button" }]
    });
    const r2 = await (0, flow_registry_1.registerFlowCandidate)(r1.registry, {
        name: "Login Flow",
        steps: [{ action: "fill", target: "username" }]
    });
    (0, test_1.expect)(r2.created).toBe(false);
});
(0, test_1.test)("findFlowByIntent finds active flow", async () => {
    const reg = emptyReg();
    const { registry } = await (0, flow_registry_1.registerFlowCandidate)(reg, {
        name: "Login Flow",
        steps: [{ action: "click", target: "login-button" }]
    });
    registry.flows[0].status = "active";
    const found = (0, flow_registry_1.findFlowByIntent)(registry, "login");
    (0, test_1.expect)(found).toBeDefined();
    (0, test_1.expect)(found.name).toBe("Login Flow");
});
(0, test_1.test)("findFlowByIntent returns undefined for no match", () => {
    const reg = emptyReg();
    const found = (0, flow_registry_1.findFlowByIntent)(reg, "payment");
    (0, test_1.expect)(found).toBeUndefined();
});
(0, test_1.test)("registerFlowCandidate preserves requiredDataKeys", async () => {
    const reg = emptyReg();
    const { registry } = await (0, flow_registry_1.registerFlowCandidate)(reg, {
        name: "Payment Flow",
        steps: [{ action: "fill", target: "amount" }],
        requiredDataKeys: ["amount", "currency"],
        sensitiveActions: ["submit"]
    });
    (0, test_1.expect)(registry.flows[0].requiredDataKeys).toContain("amount");
    (0, test_1.expect)(registry.flows[0].sensitiveActions).toContain("submit");
});
