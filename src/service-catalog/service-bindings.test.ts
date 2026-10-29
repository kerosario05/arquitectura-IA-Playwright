import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScenarioServiceView,
  looksLikeOneTimeCode,
  normalizeBindingParams,
  resolveBindingParams,
  resolveEffectiveBindings,
  type ServiceBinding,
} from "./service-bindings";
import { createOracleOtpProvider, OTP_ORACLE_LOCAL_TOKEN_KEY } from "./providers/otp-oracle-local-token";
import { ServiceCatalogError } from "./service-provider";

const otp = createOracleOtpProvider().descriptor;

function binding(partial: Partial<ServiceBinding>): ServiceBinding {
  return {
    id: "b",
    projectSlug: "kiosko",
    ownerType: "recording",
    ownerId: "rec-1",
    scenarioId: "",
    targetValueKey: "otp_code",
    serviceKey: OTP_ORACLE_LOCAL_TOKEN_KEY,
    params: { identity: { fromKey: "cedula" } },
    segment: null,
    updatedBy: null,
    updatedAt: null,
    ...partial,
  };
}

test("params are validated against what the service declares", () => {
  assert.deepEqual(normalizeBindingParams(otp, { identity: { fromKey: " cedula " }, channel: " APP ", extra: "x" }), {
    identity: { fromKey: "cedula" },
    channel: "APP",
  });
  assert.deepEqual(normalizeBindingParams(otp, { identity: "00112345678" }), { identity: { value: "00112345678" } });
  assert.throws(() => normalizeBindingParams(otp, {}), /Identidad/);
  assert.throws(() => normalizeBindingParams(otp, { identity: { fromKey: "c" }, mode: "always" }), /Modo/);
  assert.throws(() => normalizeBindingParams(otp, { identity: { fromKey: "c" }, channel: { fromKey: "x" } }), ServiceCatalogError);
});

test("params resolve from the scenario's own values", () => {
  const params = { identity: { fromKey: "cedula" }, channel: "APP", mode: { value: "generate" } } as const;
  assert.deepEqual(resolveBindingParams(params, { cedula: " 001 " }), { identity: "001", channel: "APP", mode: "generate" });
  assert.throws(() => resolveBindingParams(params, { cedula: "" }), /cedula/);
});

test("a scenario row overrides the general form, and a row without service turns it off", () => {
  const rows = [
    binding({ id: "g1" }),
    binding({ id: "g2", targetValueKey: "token" }),
    binding({ id: "s1", scenarioId: "sc-2", params: { identity: { value: "999" } } }),
    binding({ id: "s2", scenarioId: "sc-3", serviceKey: null, params: {} }),
  ];
  assert.equal(resolveEffectiveBindings(rows, "sc-1").get("otp_code")?.origin, "general");
  const overridden = resolveEffectiveBindings(rows, "sc-2").get("otp_code");
  assert.equal(overridden?.origin, "scenario");
  assert.equal(overridden?.bindingId, "s1");
  assert.equal(resolveEffectiveBindings(rows, "sc-3").get("otp_code")?.origin, "manual");
  assert.equal(resolveEffectiveBindings(rows, "sc-3").get("token")?.origin, "general");
});

test("one-time code fields are recognized by shape or by name, not ordinary fields", () => {
  assert.equal(looksLikeOneTimeCode({ key: "field_7", segmented: true }), true);
  assert.equal(looksLikeOneTimeCode({ key: "otp_code" }), true);
  assert.equal(looksLikeOneTimeCode({ key: "f1", label: "Código de verificación" }), true);
  assert.equal(looksLikeOneTimeCode({ key: "f2", label: "Ingresa el token" }), true);
  assert.equal(looksLikeOneTimeCode({ key: "f3", label: "Código postal" }), false);
  assert.equal(looksLikeOneTimeCode({ key: "telefono", label: "Teléfono" }), false);
});

test("the view suggests the OTP service with the cédula wired in and lists what is missing", () => {
  const fields = [
    { key: "cedula", label: "Número de cédula", value: "00112345678" },
    { key: "otp_code", label: "Código OTP", segmented: true, sensitive: true, value: null },
    { key: "monto", label: "Monto", value: "" },
    { key: "nota", label: "Nota", required: false },
  ];
  const view = buildScenarioServiceView({ scenarioId: "sc-1", fields, bindings: [], enabledServices: [otp] });
  const otpField = view.fields.find((field) => field.valueKey === "otp_code");
  assert.equal(otpField?.suggestion?.serviceKey, OTP_ORACLE_LOCAL_TOKEN_KEY);
  assert.deepEqual(otpField?.suggestion?.params, { identity: { fromKey: "cedula" } });
  assert.deepEqual(view.missing, ["otp_code", "monto"]);

  const bound = buildScenarioServiceView({ scenarioId: "sc-1", fields, bindings: [binding({})], enabledServices: [otp] });
  assert.equal(bound.fields.find((field) => field.valueKey === "otp_code")?.suggestion, null);
  assert.deepEqual(bound.missing, ["monto"]);

  const noService = buildScenarioServiceView({ scenarioId: "sc-1", fields, bindings: [], enabledServices: [] });
  assert.equal(noService.fields.every((field) => field.suggestion === null), true);
});
