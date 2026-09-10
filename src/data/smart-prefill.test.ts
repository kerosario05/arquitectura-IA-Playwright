import assert from "node:assert/strict";
import test from "node:test";
import { resolveDisplayLabel, resolveSmartPrefill, validateSmartPrefillAiResponse } from "./smart-prefill";

const text = (key: string, extra: Record<string, unknown> = {}) => ({ key, fieldCapability: { kind: "text" as const }, ...extra });

test("declared labels win and key fallback remains human-readable", () => {
  assert.deepEqual(resolveDisplayLabel(text("entity_1.company_name", { label: "Razón social" })), { label: "Razón social", source: "declared" });
  assert.deepEqual(resolveDisplayLabel(text("entity_1.postal_code")), { label: "Postal code", source: "humanized" });
});

test("all non-secret requirements attempt deterministic prefill and repeated datasets differ", async () => {
  const result = await resolveSmartPrefill({
    seed: "run-1",
    requirements: [
      text("entity_1.name"), text("entity_1.email"), text("entity_2.name"), text("entity_2.email"),
      text("entity_1.document"), text("entity_1.expected_section"),
    ],
    aiFallback: async ({ fields }) => ({ fields: fields.map((field) => ({ key: field.key, semanticType: "generic_text", displayLabel: "Sección esperada", generatedValue: "Sección QA", confidence: 0.8 })) }),
  });
  assert.equal(result.aiCalls, 1);
  assert.equal(result.fields.filter((field) => field.source === "deterministic_synthetic").length, 5);
  assert.notEqual(result.fields.find((field) => field.key === "entity_1.email")?.value, result.fields.find((field) => field.key === "entity_2.email")?.value);
  assert.equal(result.fields.every((field) => field.editable), true);
  assert.equal(result.fields.find((field) => field.key === "entity_1.expected_section")?.source, "ai_synthetic");
});

test("current user value outranks replay and replay outranks generation", async () => {
  const replay = await resolveSmartPrefill({
    seed: "run-1", requirements: [text("person.email")],
    confirmedReplayValues: { "person.email": { value: "replayed@example.test", source: "confirmed_replay", verified: true } },
  });
  assert.equal(replay.fields[0].value, "replayed@example.test");
  assert.equal(replay.fields[0].source, "confirmed_replay");
  const user = await resolveSmartPrefill({
    seed: "run-1", requirements: [text("person.email")],
    currentUserValues: { "person.email": { value: "edited@example.test", source: "user_entered", verified: false } },
    confirmedReplayValues: { "person.email": { value: "replayed@example.test", source: "confirmed_replay", verified: true } },
  });
  assert.equal(user.fields[0].value, "edited@example.test");
  assert.equal(user.fields[0].source, "user_entered");
});

test("secrets use trusted sources only and are excluded from AI input", async () => {
  let received: unknown;
  const result = await resolveSmartPrefill({
    seed: "run-1", requirements: [text("auth.password", { sensitive: true }), text("future.unknown")],
    confirmedReplayValues: { "auth.password": { value: "old-secret", source: "confirmed_replay", verified: true } },
    projectConfigValues: { "auth.password": { value: "configured-secret", source: "project_config", verified: true } },
    aiFallback: async (input) => { received = input; return { fields: [] }; },
  });
  assert.equal(result.fields.find((field) => field.key === "auth.password")?.value, "configured-secret");
  assert.equal(JSON.stringify(received).includes("secret"), false);
  assert.equal(result.sensitiveKeysSentToAi.length, 0);
});

test("AI schema cannot add or mutate keys and invalid output is safe", () => {
  const allowed = new Set(["future.field"]);
  assert.equal(validateSmartPrefillAiResponse({ fields: [{ key: "other.field", semanticType: "x", displayLabel: "X", generatedValue: "v", confidence: 0.9 }] }, allowed).valid, false);
  assert.equal(validateSmartPrefillAiResponse({ fields: [{ key: "future.field", semanticType: "x", displayLabel: "X", generatedValue: "v", confidence: 0.9, extra: true }] }, allowed).valid, false);
  assert.equal(validateSmartPrefillAiResponse({ fields: [{ key: "future.field", semanticType: "x", displayLabel: "X", generatedValue: "v", confidence: 0.9 }] }, allowed).valid, true);
});

test("AI receives one grouped request for unresolved fields and cannot override known values", async () => {
  const calls: string[] = [];
  const result = await resolveSmartPrefill({
    seed: "run-2",
    requirements: [text("record.unknown_a"), text("record.unknown_b"), text("record.email")],
    selectionRuntimeValues: { "record.email": "qa@example.test" },
    aiFallback: async (input) => {
      calls.push(input.datasetIdentity);
      return { fields: input.fields.map((field) => ({ key: field.key, semanticType: "generic_text", displayLabel: "Dato", generatedValue: "synthetic", confidence: 0.8 })) };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.aiCalls, 1);
  assert.equal(result.fields.find((field) => field.key === "record.email")?.source, "selection_runtime");
  assert.equal(result.fields.filter((field) => field.source === "ai_synthetic").length, 2);
});

test("locale-aware phone generation uses a reserved regional shape", async () => {
  const result = await resolveSmartPrefill({
    seed: "phone-run", locale: "es-DO",
    requirements: [text("contact.phone")],
  });
  const value = String(result.fields[0].value);
  assert.match(value, /^(809|829|849)-\d{3}-\d{4}$/);
});
