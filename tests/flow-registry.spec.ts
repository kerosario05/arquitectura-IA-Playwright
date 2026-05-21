import { test, expect } from "@playwright/test";
import {
  findFlowByIntent,
  registerFlowCandidate
} from "../src/automations/flow-registry";
import type { FlowRegistry } from "../src/types/page-object.types";

function emptyReg(): FlowRegistry {
  return { version: "1.0", appSlug: "test", flows: [], updatedAt: new Date().toISOString() };
}

test("registerFlowCandidate adds new flow", async () => {
  const reg = emptyReg();
  const { registry, created } = await registerFlowCandidate(reg, {
    name: "Login Flow",
    steps: [{ action: "click", target: "login-button" }],
    confidence: 0.85
  });
  expect(created).toBe(true);
  expect(registry.flows).toHaveLength(1);
  expect(registry.flows[0].name).toBe("Login Flow");
});

test("registerFlowCandidate does not duplicate", async () => {
  const reg = emptyReg();
  const r1 = await registerFlowCandidate(reg, {
    name: "Login Flow",
    steps: [{ action: "click", target: "login-button" }]
  });
  const r2 = await registerFlowCandidate(r1.registry, {
    name: "Login Flow",
    steps: [{ action: "fill", target: "username" }]
  });
  expect(r2.created).toBe(false);
});

test("findFlowByIntent finds active flow", async () => {
  const reg = emptyReg();
  const { registry } = await registerFlowCandidate(reg, {
    name: "Login Flow",
    steps: [{ action: "click", target: "login-button" }]
  });
  registry.flows[0].status = "active";
  const found = findFlowByIntent(registry, "login");
  expect(found).toBeDefined();
  expect(found!.name).toBe("Login Flow");
});

test("findFlowByIntent returns undefined for no match", () => {
  const reg = emptyReg();
  const found = findFlowByIntent(reg, "payment");
  expect(found).toBeUndefined();
});

test("registerFlowCandidate preserves requiredDataKeys", async () => {
  const reg = emptyReg();
  const { registry } = await registerFlowCandidate(reg, {
    name: "Payment Flow",
    steps: [{ action: "fill", target: "amount" }],
    requiredDataKeys: ["amount", "currency"],
    sensitiveActions: ["submit"]
  });
  expect(registry.flows[0].requiredDataKeys).toContain("amount");
  expect(registry.flows[0].sensitiveActions).toContain("submit");
});
