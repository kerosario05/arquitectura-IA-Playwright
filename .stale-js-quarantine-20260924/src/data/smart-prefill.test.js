"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const smart_prefill_1 = require("./smart-prefill");
const text = (key, extra = {}) => ({ key, fieldCapability: { kind: "text" }, ...extra });
(0, node_test_1.default)("declared labels win and key fallback remains human-readable", () => {
    strict_1.default.deepEqual((0, smart_prefill_1.resolveDisplayLabel)(text("entity_1.company_name", { label: "Razón social" })), { label: "Razón social", source: "declared" });
    strict_1.default.deepEqual((0, smart_prefill_1.resolveDisplayLabel)(text("entity_1.postal_code")), { label: "Postal code", source: "humanized" });
});
(0, node_test_1.default)("all non-secret requirements attempt deterministic prefill and repeated datasets differ", async () => {
    const result = await (0, smart_prefill_1.resolveSmartPrefill)({
        seed: "run-1",
        requirements: [
            text("entity_1.name"), text("entity_1.email"), text("entity_2.name"), text("entity_2.email"),
            text("entity_1.document"), text("entity_1.expected_section"),
        ],
        aiFallback: async ({ fields }) => ({ fields: fields.map((field) => ({ key: field.key, semanticType: "generic_text", displayLabel: "Sección esperada", generatedValue: "Sección QA", confidence: 0.8 })) }),
    });
    strict_1.default.equal(result.aiCalls, 1);
    strict_1.default.equal(result.fields.filter((field) => field.source === "deterministic_synthetic").length, 5);
    strict_1.default.notEqual(result.fields.find((field) => field.key === "entity_1.email")?.value, result.fields.find((field) => field.key === "entity_2.email")?.value);
    strict_1.default.equal(result.fields.every((field) => field.editable), true);
    strict_1.default.equal(result.fields.find((field) => field.key === "entity_1.expected_section")?.source, "ai_synthetic");
});
(0, node_test_1.default)("current user value outranks replay and replay outranks generation", async () => {
    const replay = await (0, smart_prefill_1.resolveSmartPrefill)({
        seed: "run-1", requirements: [text("person.email")],
        confirmedReplayValues: { "person.email": { value: "replayed@example.test", source: "confirmed_replay", verified: true } },
    });
    strict_1.default.equal(replay.fields[0].value, "replayed@example.test");
    strict_1.default.equal(replay.fields[0].source, "confirmed_replay");
    const user = await (0, smart_prefill_1.resolveSmartPrefill)({
        seed: "run-1", requirements: [text("person.email")],
        currentUserValues: { "person.email": { value: "edited@example.test", source: "user_entered", verified: false } },
        confirmedReplayValues: { "person.email": { value: "replayed@example.test", source: "confirmed_replay", verified: true } },
    });
    strict_1.default.equal(user.fields[0].value, "edited@example.test");
    strict_1.default.equal(user.fields[0].source, "user_entered");
});
(0, node_test_1.default)("secrets use trusted sources only and are excluded from AI input", async () => {
    let received;
    const result = await (0, smart_prefill_1.resolveSmartPrefill)({
        seed: "run-1", requirements: [text("auth.password", { sensitive: true }), text("future.unknown")],
        confirmedReplayValues: { "auth.password": { value: "old-secret", source: "confirmed_replay", verified: true } },
        projectConfigValues: { "auth.password": { value: "configured-secret", source: "project_config", verified: true } },
        aiFallback: async (input) => { received = input; return { fields: [] }; },
    });
    strict_1.default.equal(result.fields.find((field) => field.key === "auth.password")?.value, "configured-secret");
    strict_1.default.equal(JSON.stringify(received).includes("secret"), false);
    strict_1.default.equal(result.sensitiveKeysSentToAi.length, 0);
});
(0, node_test_1.default)("AI schema cannot add or mutate keys and invalid output is safe", () => {
    const allowed = new Set(["future.field"]);
    strict_1.default.equal((0, smart_prefill_1.validateSmartPrefillAiResponse)({ fields: [{ key: "other.field", semanticType: "x", displayLabel: "X", generatedValue: "v", confidence: 0.9 }] }, allowed).valid, false);
    strict_1.default.equal((0, smart_prefill_1.validateSmartPrefillAiResponse)({ fields: [{ key: "future.field", semanticType: "x", displayLabel: "X", generatedValue: "v", confidence: 0.9, extra: true }] }, allowed).valid, false);
    strict_1.default.equal((0, smart_prefill_1.validateSmartPrefillAiResponse)({ fields: [{ key: "future.field", semanticType: "x", displayLabel: "X", generatedValue: "v", confidence: 0.9 }] }, allowed).valid, true);
});
(0, node_test_1.default)("AI receives one grouped request for unresolved fields and cannot override known values", async () => {
    const calls = [];
    const result = await (0, smart_prefill_1.resolveSmartPrefill)({
        seed: "run-2",
        requirements: [text("record.unknown_a"), text("record.unknown_b"), text("record.email")],
        selectionRuntimeValues: { "record.email": "qa@example.test" },
        aiFallback: async (input) => {
            calls.push(input.datasetIdentity);
            return { fields: input.fields.map((field) => ({ key: field.key, semanticType: "generic_text", displayLabel: "Dato", generatedValue: "synthetic", confidence: 0.8 })) };
        },
    });
    strict_1.default.equal(calls.length, 1);
    strict_1.default.equal(result.aiCalls, 1);
    strict_1.default.equal(result.fields.find((field) => field.key === "record.email")?.source, "selection_runtime");
    strict_1.default.equal(result.fields.filter((field) => field.source === "ai_synthetic").length, 2);
});
(0, node_test_1.default)("locale-aware phone generation uses a reserved regional shape", async () => {
    const result = await (0, smart_prefill_1.resolveSmartPrefill)({
        seed: "phone-run", locale: "es-DO",
        requirements: [text("contact.phone")],
    });
    const value = String(result.fields[0].value);
    strict_1.default.match(value, /^(809|829|849)-\d{3}-\d{4}$/);
});
