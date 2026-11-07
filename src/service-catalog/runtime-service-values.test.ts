import assert from "node:assert/strict";
import test from "node:test";
import { OracleOtpServiceError } from "../server/services/oracle-otp-service";
import { planExecutionServices, mergeRunServiceBindings, planRerunServiceBindings } from "./execution-bindings";
import { OTP_ORACLE_LOCAL_TOKEN_KEY } from "./providers/otp-oracle-local-token";
import {
  isServiceBoundValueKey,
  materializeServiceBindingsEnv,
  readRuntimeServiceBindings,
  resetServiceValueCacheForTests,
  resolveServiceBoundValue,
  type RuntimeServiceBinding,
} from "./runtime-service-values";
import type { ServiceBinding } from "./service-bindings";
import { getServiceProvider } from "./service-registry";

const READY_ENV = {
  ORACLE_OTP_ENABLED: "true",
  ORACLE_OTP_CONNECT_STRING: "db-qa:1521/QA",
  ORACLE_OTP_USER: "u",
  ORACLE_OTP_PASSWORD: "p",
  APP_TEST_DATA_PROFILE: "qa",
} as NodeJS.ProcessEnv;

const otpBinding: RuntimeServiceBinding = {
  valueKey: "otp_code",
  serviceKey: OTP_ORACLE_LOCAL_TOKEN_KEY,
  projectSlug: "kiosko",
  settings: { defaultChannel: "APP" },
  params: { identity: { fromKey: "cedula" } },
};

/** Replaces the registered OTP provider's resolve for one test, restoring it afterwards. */
async function withFakeOtp(
  resolve: (params: Record<string, unknown>) => Promise<string>,
  run: (calls: Array<Record<string, unknown>>) => Promise<void>,
): Promise<void> {
  const provider = getServiceProvider(OTP_ORACLE_LOCAL_TOKEN_KEY);
  const original = provider.resolve;
  const calls: Array<Record<string, unknown>> = [];
  (provider as { resolve: typeof provider.resolve }).resolve = async (_context, params) => {
    calls.push(params);
    return { value: await resolve(params), meta: { channel: "APP", source: "fake" } };
  };
  resetServiceValueCacheForTests();
  try {
    await run(calls);
  } finally {
    (provider as { resolve: typeof provider.resolve }).resolve = original;
    resetServiceValueCacheForTests();
  }
}

test("bindings travel in one env variable and are read back", () => {
  assert.deepEqual(materializeServiceBindingsEnv([]), {});
  const env = materializeServiceBindingsEnv([otpBinding]);
  assert.deepEqual(readRuntimeServiceBindings(env), [otpBinding]);
  assert.equal(isServiceBoundValueKey("OTP_CODE", env), true);
  assert.equal(isServiceBoundValueKey("cedula", env), false);
  assert.deepEqual(readRuntimeServiceBindings({ PROMOTED_SERVICE_BINDINGS_JSON: "{broken" }), []);
});

test("an unbound field keeps its dataset value", async () => {
  assert.equal(await resolveServiceBoundValue("cedula", { env: materializeServiceBindingsEnv([otpBinding]) }), undefined);
  assert.equal(await resolveServiceBoundValue(undefined, { env: {} }), undefined);
});

test("the identity comes from the run's own values and the code is shared by the later boxes", async () => {
  const env = { ...materializeServiceBindingsEnv([otpBinding]), PROMOTED_CEDULA: "00112345678" };
  let issued = 0;
  await withFakeOtp(async () => String(111111 * ++issued), async (calls) => {
    assert.equal(await resolveServiceBoundValue("otp_code", { env, segmentPosition: 1 }), "111111");
    assert.equal(await resolveServiceBoundValue("otp_code", { env, segmentPosition: 2 }), "111111");
    assert.equal(await resolveServiceBoundValue("otp_code", { env, segmentPosition: 6 }), "111111");
    assert.deepEqual(calls, [{ identity: "00112345678" }]);
    // Box 1 again (a retry) or a whole-field fill asks for a fresh code.
    assert.equal(await resolveServiceBoundValue("otp_code", { env, segmentPosition: 1 }), "222222");
    assert.equal(await resolveServiceBoundValue("otp_code", { env }), "333333");
  });
});

test("the identity may also come from the overrides JSON the dataset materializes", async () => {
  const env = {
    ...materializeServiceBindingsEnv([otpBinding]),
    PROMOTED_RUNTIME_DATA_OVERRIDES_JSON: JSON.stringify({ Cedula: "00999" }),
  };
  await withFakeOtp(async () => "123456", async (calls) => {
    await resolveServiceBoundValue("otp_code", { env });
    assert.deepEqual(calls, [{ identity: "00999" }]);
  });
});

test("discovery's own data wins: the cédula typed earlier in the run reaches the service", async () => {
  // Discovery keeps scenario values in its data resolver, not in PROMOTED_* env (job 5537b63d).
  const env = materializeServiceBindingsEnv([otpBinding]);
  await withFakeOtp(async () => "123456", async (calls) => {
    await resolveServiceBoundValue("otp_code", { env, readValue: (key) => (key === "cedula" ? "402-2999373-4" : undefined) });
    assert.deepEqual(calls, [{ identity: "402-2999373-4" }]);
  });
  await assert.rejects(() => resolveServiceBoundValue("otp_code", { env, readValue: () => undefined }), /cedula/);
});

test("a failing service stops the step with a clear reason and is retried next time", async () => {
  const env = { ...materializeServiceBindingsEnv([otpBinding]), PROMOTED_CEDULA: "1" };
  let fail = true;
  await withFakeOtp(async () => {
    if (fail) throw new OracleOtpServiceError("oracle_unavailable", 503);
    return "654321";
  }, async () => {
    await assert.rejects(() => resolveServiceBoundValue("otp_code", { env }), /service_value_unresolved: valueKey=otp_code/);
    fail = false;
    assert.equal(await resolveServiceBoundValue("otp_code", { env, segmentPosition: 2 }), "654321");
  });
  await assert.rejects(
    () => resolveServiceBoundValue("otp_code", { env: materializeServiceBindingsEnv([otpBinding]) }),
    /cedula/,
  );
});

function saved(partial: Partial<ServiceBinding>): ServiceBinding {
  return {
    id: "g", projectSlug: "kiosko", ownerType: "recording", ownerId: "rec-1", scenarioId: "",
    targetValueKey: "otp_code", serviceKey: OTP_ORACLE_LOCAL_TOKEN_KEY,
    params: { identity: { fromKey: "cedula" } }, segment: null, updatedBy: null, updatedAt: null, ...partial,
  };
}

const enabledConfig = [{
  projectSlug: "kiosko", serviceKey: OTP_ORACLE_LOCAL_TOKEN_KEY, enabled: true,
  settings: { defaultChannel: "APP" }, updatedAt: null, legacy: false,
}];

const owner = { projectSlug: "kiosko", ownerType: "recording" as const, ownerId: "rec-1" };

test("a run gets the bound fields, a placeholder for the empty ones and nothing else", async () => {
  const plan = await planExecutionServices({
    ...owner,
    scenarios: [{ scenarioId: "sc-1", valueKeys: ["cedula", "otp_code"] }, { scenarioId: "sc-2", valueKeys: ["otp_code"] }],
    values: { cedula: "001" },
  }, { listBindings: async () => [saved({})], listConfigs: async () => enabledConfig, env: READY_ENV });
  assert.deepEqual(plan.blocked, []);
  assert.equal(plan.bindings.length, 1);
  assert.deepEqual(plan.bindings[0].settings, { defaultChannel: "APP" });
  assert.deepEqual(plan.placeholders, { otp_code: "000000" });

  const noBindings = await planExecutionServices({ ...owner, scenarios: [{ scenarioId: "sc-1", valueKeys: ["otp_code"] }] },
    { listBindings: async () => [], listConfigs: async () => assert.fail("not needed"), env: READY_ENV });
  assert.deepEqual(noBindings, { bindings: [], placeholders: {}, blocked: [] });
});

test("a run is refused when the service is off, unavailable or scenarios disagree", async () => {
  const scenarios = [{ scenarioId: "sc-1", valueKeys: ["otp_code"] }, { scenarioId: "sc-2", valueKeys: ["otp_code"] }];
  const deps = { listBindings: async () => [saved({})], listConfigs: async () => enabledConfig, env: READY_ENV };

  const off = await planExecutionServices({ ...owner, scenarios }, { ...deps, listConfigs: async () => [] });
  assert.equal(off.blocked[0].code, "service_not_enabled");

  const unavailable = await planExecutionServices({ ...owner, scenarios }, { ...deps, env: { APP_TEST_DATA_PROFILE: "demo" } });
  assert.equal(unavailable.blocked[0].code, "service_unavailable");
  assert.match(unavailable.blocked[0].message, /ORACLE_OTP_ENABLED/);

  const manualInOne = await planExecutionServices({ ...owner, scenarios },
    { ...deps, listBindings: async () => [saved({}), saved({ id: "m", scenarioId: "sc-2", serviceKey: null, params: {} })] });
  assert.equal(manualInOne.blocked[0].code, "service_binding_conflict");

  const allManual = await planExecutionServices({ ...owner, scenarios: [scenarios[1]] },
    { ...deps, listBindings: async () => [saved({}), saved({ id: "m", scenarioId: "sc-2", serviceKey: null, params: {} })] });
  assert.deepEqual(allManual, { bindings: [], placeholders: {}, blocked: [] });
});

test("an unavailable service keeps every one of its fields out of the run, with one message", async () => {
  const plan = await planExecutionServices({ ...owner, scenarios: [{ scenarioId: "sc-1", valueKeys: ["otp_code", "otp_2"] }] }, {
    listBindings: async () => [saved({}), saved({ id: "g2", targetValueKey: "otp_2" })],
    listConfigs: async () => enabledConfig,
    env: { APP_TEST_DATA_PROFILE: "demo" },
  });
  assert.deepEqual(plan.bindings, []);
  assert.equal(plan.blocked.length, 1);
});

test("a code recorded as one field per digit shares one value, each field takes its digit", async () => {
  const digits = [1, 2, 3, 4, 5, 6].map((position) => ({
    ...otpBinding,
    valueKey: `otp_digit_${position}`,
    segment: { group: "otp_digit_1", position },
  }));
  const plan = await planExecutionServices({ ...owner, scenarios: [{ scenarioId: "sc-1", valueKeys: digits.map((d) => d.valueKey) }] }, {
    listBindings: async () => digits.map((d, index) => saved({ id: `d${index}`, targetValueKey: d.valueKey, segment: d.segment })),
    listConfigs: async () => enabledConfig,
    env: READY_ENV,
  });
  assert.equal(plan.bindings.length, 6);
  assert.deepEqual(plan.bindings[2].segment, { group: "otp_digit_1", position: 3 });
  assert.equal(plan.placeholders.otp_digit_4, "0");

  const env = { ...materializeServiceBindingsEnv(digits), PROMOTED_CEDULA: "1" };
  let issued = 0;
  await withFakeOtp(async () => (++issued === 1 ? "482916" : "777777"), async (calls) => {
    const typed: string[] = [];
    for (const digit of digits) typed.push((await resolveServiceBoundValue(digit.valueKey, { env }))!);
    assert.equal(typed.join(""), "482916");
    assert.equal(calls.length, 1);
    // Typing the group again (a retry) starts from digit 1 with a fresh code.
    assert.equal(await resolveServiceBoundValue("otp_digit_1", { env }), "7");
  });
});

test("a batch merges recordings that agree and refuses those that do not", () => {
  const first = mergeRunServiceBindings([], [otpBinding]);
  assert.equal(mergeRunServiceBindings(first.bindings, [otpBinding]).bindings.length, 1);
  const other = mergeRunServiceBindings(first.bindings, [{ ...otpBinding, params: { identity: { value: "9" } } }]);
  assert.equal(other.conflicts[0].code, "service_binding_conflict");
});

test("a rerun plans its services again from today's bindings, per recording", async () => {
  // Job 7dfc3157 reran a chain whose jobs never carried bindings, so the recorded OTP was typed.
  const owners: string[] = [];
  const result = await planRerunServiceBindings("kiosko", [
    { recordingId: "rec-1", recordedScenarioId: "sc-1", runtimeInputRequirements: [{ valueKey: "cedula" }, { valueKey: "otp_code" }] },
    { recordingId: undefined, recordedScenarioId: "jira-1" },
  ], {
    listBindings: async (owner) => { owners.push(`${owner.ownerType}:${owner.ownerId}`); return [saved({})]; },
    listConfigs: async () => enabledConfig,
    env: READY_ENV,
  });
  assert.deepEqual(owners, ["recording:rec-1"]);
  assert.deepEqual(result.blocked, []);
  assert.equal(result.bindings.length, 1);
  assert.equal(result.bindings[0].valueKey, "otp_code");

  const off = await planRerunServiceBindings("kiosko", [{ recordingId: "rec-1", recordedScenarioId: "sc-1", runtimeInputRequirements: [{ valueKey: "otp_code" }] }],
    { listBindings: async () => [saved({})], listConfigs: async () => [], env: READY_ENV });
  assert.equal(off.blocked[0].code, "service_not_enabled");
});
