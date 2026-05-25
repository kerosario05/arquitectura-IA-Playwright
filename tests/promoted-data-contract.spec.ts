import { test, expect } from "@playwright/test";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import {
  buildPromotedDataManifest,
  buildPromotedDataContext,
  buildDataKeyVariableMap,
  requirePromotedData,
  toSafeTsVariableName
} from "../src/data/promoted-data";
import type { DataContext } from "../src/data/data-context";

const basePlan: ExecutionPlan = {
  version: "1.0",
  source: "discovery_generated",
  status: "validated",
  scenario: { source: "manual", title: "Generic form" },
  requiredData: [
    { key: "customer_name", required: true, resolved: true },
    { key: "password_key", required: true, resolved: true, sensitive: true }
  ],
  steps: [
    { index: 1, action: "fill", target: { strategy: "label", value: "Customer Name" }, valueKey: "customer_name" },
    { index: 2, action: "fill", target: { strategy: "label", value: "Password" }, valueKey: "password_key" }
  ],
  createdAt: new Date().toISOString()
};

const baseContext: DataContext = {
  entries: [
    { key: "customer_name", value: "Alice QA", source: "test_data", sensitive: false },
    { key: "password_key", value: "S3cret!", source: "environment_variable", sensitive: true }
  ],
  counts: { total: 2, sensitive: 1, nonSensitive: 1 }
};

test("manifest incluye keys usadas y required=true", () => {
  const manifest = buildPromotedDataManifest(basePlan, baseContext);
  expect(manifest.entries.map((e) => e.key)).toEqual(["customer_name", "password_key"]);
  expect(manifest.entries.every((e) => e.required)).toBe(true);
});

test("manifest no persiste secretos reales y conserva maskedValue", () => {
  const manifest = buildPromotedDataManifest(basePlan, baseContext);
  const secret = manifest.entries.find((e) => e.key === "password_key");
  expect(secret?.value).toBeUndefined();
  expect(secret?.maskedValue).toBeTruthy();
  expect(secret?.maskedValue).not.toContain("S3cret!");
});

test("runtime hydration resuelve key directa y error claro cuando falta required", () => {
  const manifest = buildPromotedDataManifest(basePlan, baseContext);
  const hydrated = buildPromotedDataContext({
    baseDataContext: { entries: [], counts: { total: 0, sensitive: 0, nonSensitive: 0 } },
    manifest,
    testDataProfile: "qa",
    autoGenerateTestData: false
  });
  expect(requirePromotedData(hydrated, "customer_name", { fieldName: "Customer Name", stepIndex: 1 })).toBe("Alice QA");
  expect(() => requirePromotedData(hydrated, "password_key", { fieldName: "Password", stepIndex: 2 })).toThrow(/Missing required promoted data key "password_key"/);
});

test("runtime hydration genera fallback demo-safe cuando perfil lo permite", () => {
  const demoPlan: ExecutionPlan = {
    ...basePlan,
    requiredData: [{ key: "order_name", required: true, resolved: false }],
    steps: [{ index: 1, action: "fill", target: { strategy: "label", value: "Order Name" }, valueKey: "order_name" }]
  };
  const manifest = buildPromotedDataManifest(demoPlan, { entries: [], counts: { total: 0, sensitive: 0, nonSensitive: 0 } });
  const hydrated = buildPromotedDataContext({
    baseDataContext: { entries: [], counts: { total: 0, sensitive: 0, nonSensitive: 0 } },
    manifest,
    testDataProfile: "demo",
    autoGenerateTestData: true
  });
  const value = requirePromotedData(hydrated, "order_name");
  expect(value.length).toBeGreaterThan(0);
});

test("data keys se convierten a nombres TS validos y deduplicados", () => {
  expect(toSafeTsVariableName("orden_nombre")).toBe("ordenNombre");
  expect(toSafeTsVariableName("payment.amount")).toBe("paymentAmount");
  expect(toSafeTsVariableName("user-email")).toBe("userEmail");
  const map = buildDataKeyVariableMap(["user-email", "user_email"]);
  expect(map.get("user-email")).toBe("userEmail");
  expect(map.get("user_email")).toBe("userEmail2");
});
