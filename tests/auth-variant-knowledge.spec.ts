import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { persistAuthVariant, listAuthVariantKnowledge, getAuthVariantKnowledge } from "../src/knowledge/auth-variant-persister";

const TEST_SLUG = "test-auth-variant-temp";

function knowledgePath() { return path.join(process.cwd(), "automations", "apps", TEST_SLUG, "app.knowledge.json"); }
function clean() {
  try { const kp = knowledgePath(); if (fs.existsSync(kp)) fs.unlinkSync(kp); const dir = path.dirname(kp); if (fs.existsSync(dir) && fs.readdirSync(dir).length===0) fs.rmdirSync(dir); } catch {}
}

test.beforeEach(() => clean());
test.afterEach(() => clean());

test("TEST1 pending without successEvidence", async () => {
  const item = await persistAuthVariant(TEST_SLUG, {
    variantLabel: "Variant A",
    sourceScreenKey: "screen123",
    observedFieldsBefore: ["Field0"],
    observedFieldsAfter: ["Field1","Field2"],
    requiredFieldsMatched: ["Field1","Field2"],
  }, { phase: 1 });
  expect(item.validationStatus).toBe("pending");
  expect(item.trustedForReuse).toBe(false);
  expect(item.variantLabel).toBe("Variant A");
});

test("TEST2 same identity with successEvidence -> validated trusted", async () => {
  const first = await persistAuthVariant(TEST_SLUG, {
    variantLabel: "Variant A",
    sourceScreenKey: "screen123",
    observedFieldsBefore: ["Field0"],
    observedFieldsAfter: ["Field1","Field2"],
    requiredFieldsMatched: ["Field1","Field2"],
  }, { phase: 1 });
  const second = await persistAuthVariant(TEST_SLUG, {
    variantLabel: "Variant A",
    sourceScreenKey: "screen123",
    observedFieldsBefore: ["Field0"],
    observedFieldsAfter: ["Field1","Field2"],
    requiredFieldsMatched: ["Field1","Field2"],
    successEvidence: "auth_success_screen_abc",
  }, { phase: 2 });
  expect(second.id).toBe(first.id);
  expect(second.validationStatus).toBe("validated");
  expect(second.trustedForReuse).toBe(true);
  expect(second.successEvidence).toBe("auth_success_screen_abc");
});

test("TEST3 no secrets persisted", async () => {
  await persistAuthVariant(TEST_SLUG, {
    variantLabel: "Variant A",
    sourceScreenKey: "screen123",
    observedFieldsBefore: ["password: supersecret123", "Token abc", "OTP 123456", "Field1"],
    observedFieldsAfter: ["Field1","Field2"],
    requiredFieldsMatched: ["Field1"],
    successEvidence: "token_secret_should_not_leak",
  }, { phase: 1 });
  const raw = fs.readFileSync(knowledgePath(), "utf-8").toLowerCase();
  expect(raw.includes("supersecret")).toBe(false);
  expect(raw.includes("password")).toBe(false);
  expect(raw.includes("otp")).toBe(false);
  // token in variant fields should be filtered, but successEvidence containing token should be sanitized to undefined
  expect(raw.includes("token_secret_should_not_leak")).toBe(false);
  const list = listAuthVariantKnowledge(TEST_SLUG);
  expect(list.length).toBe(1);
  const item: any = list[0];
  expect(String(item.successEvidence ?? "").toLowerCase().includes("token")).toBe(false);
});

test("TEST4 duplicate prevented same variant same screen", async () => {
  await persistAuthVariant(TEST_SLUG, {
    variantLabel: "Variant A",
    sourceScreenKey: "screen123",
    observedFieldsBefore: ["A"],
    observedFieldsAfter: ["Field1","Field2"],
    requiredFieldsMatched: ["Field1","Field2"],
  }, { phase: 1 });
  await persistAuthVariant(TEST_SLUG, {
    variantLabel: "Variant A",
    sourceScreenKey: "screen123",
    observedFieldsBefore: ["A"],
    observedFieldsAfter: ["Field1","Field2"],
    requiredFieldsMatched: ["Field1","Field2"],
  }, { phase: 1 });
  const list = listAuthVariantKnowledge(TEST_SLUG);
  expect(list.length).toBe(1);
  expect((list[0] as any).runCount).toBe(2);
});
