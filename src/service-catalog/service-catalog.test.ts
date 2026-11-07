import assert from "node:assert/strict";
import test from "node:test";
import { OracleOtpServiceError } from "../server/services/oracle-otp-service";
import { createProjectServiceConfigRepository } from "../db/project-service-config-repository";
import { buildOtpProfile } from "../db/project-materializer";
import { createOracleOtpProvider, OTP_ORACLE_LOCAL_TOKEN_KEY } from "./providers/otp-oracle-local-token";
import { ServiceCatalogError } from "./service-provider";
import { findServiceProvider, listServiceProviders } from "./service-registry";

const READY_ENV = {
  ORACLE_OTP_ENABLED: "true",
  ORACLE_OTP_CONNECT_STRING: "db-qa:1521/QA",
  ORACLE_OTP_USER: "u",
  ORACLE_OTP_PASSWORD: "p",
  APP_TEST_DATA_PROFILE: "qa",
} as NodeJS.ProcessEnv;

test("the catalog lists the OTP service first", () => {
  assert.equal(listServiceProviders()[0].descriptor.key, OTP_ORACLE_LOCAL_TOKEN_KEY);
  assert.ok(findServiceProvider(OTP_ORACLE_LOCAL_TOKEN_KEY));
  assert.equal(findServiceProvider("nope"), null);
});

test("availability explains why the OTP service cannot run", () => {
  const provider = createOracleOtpProvider();
  const off = provider.availability({ APP_TEST_DATA_PROFILE: "demo" } as NodeJS.ProcessEnv);
  assert.equal(off.available, false);
  assert.equal(off.environment, "other");
  assert.equal(off.reasons.length, 3);
  const ready = provider.availability(READY_ENV);
  assert.deepEqual(ready, { available: true, reasons: [], environment: "qa" });
});

test("settings are canonicalized and unsafe values refused", () => {
  const provider = createOracleOtpProvider();
  assert.deepEqual(provider.normalizeSettings({ defaultChannel: " app ", allowedChannels: "app, web,app" }), {
    defaultChannel: "APP",
    allowedChannels: ["APP", "WEB"],
    enabledEnvironments: ["local", "qa"],
  });
  assert.throws(() => provider.normalizeSettings({ enabledEnvironments: ["production"] }), ServiceCatalogError);
  assert.throws(() => provider.normalizeSettings({ defaultChannel: "SMS", allowedChannels: ["APP"] }), /canal por defecto/);
});

test("generate mode returns the token the procedure hands back, with the project's profile", async () => {
  let seenProfile: unknown;
  const provider = createOracleOtpProvider({
    generate: async (input, deps) => {
      seenProfile = await deps.appConfigLoader(input.appSlug);
      assert.deepEqual(input, { identity: "00112345678", channel: "APP", appSlug: "kiosko" });
      return { ok: true, generated: true, requestId: "r1", generatedAt: "2026-10-28T10:00:00.000Z", channel: "APP", otp: "123456" };
    },
    latest: async () => assert.fail("latest must not run when generate returned the token"),
  });
  const result = await provider.resolve(
    { projectSlug: "kiosko", settings: { defaultChannel: "APP" } },
    { identity: "00112345678" },
  );
  assert.equal(result.value, "123456");
  assert.equal(result.meta.source, "generate");
  assert.deepEqual(seenProfile, {
    otpProfile: { strategy: "oracle_local_token", defaultChannel: "APP", allowedChannels: [], enabledEnvironments: ["local", "qa"] },
  });
});

test("a cédula typed with separators reaches Oracle exactly as typed", async () => {
  // The portal stores and validates its tokens under 402-2999373-4; stripping the dashes made
  // the bank store ours under 40229993734, where the app never looked (jobs 7bbab74a, 5f7fea59).
  let identity = "";
  const provider = createOracleOtpProvider({
    generate: async (input) => {
      identity = input.identity;
      return { ok: true, generated: true, requestId: "r", generatedAt: "2026-10-28T10:00:00.000Z", channel: "APP", otp: "111111" };
    },
  });
  await provider.resolve({ projectSlug: "p", settings: { defaultChannel: "APP" } }, { identity: " 402-2999373-4 " });
  assert.equal(identity, "402-2999373-4");
});

test("without a direct token it reads the table, retrying while the token is not there yet", async () => {
  let reads = 0;
  const provider = createOracleOtpProvider({
    sleep: async () => {},
    generate: async () => ({ ok: true, generated: true, requestId: "r2", generatedAt: "2026-10-28T10:00:00.000Z", channel: "APP" }),
    latest: async (input) => {
      reads += 1;
      assert.equal(input.generatedAfter, "2026-10-28T10:00:00.000Z");
      assert.equal(input.requestId, "r2");
      if (reads < 3) throw new OracleOtpServiceError("otp_not_found", 404);
      return { ok: true, otp: "654321", channel: "APP", source: "oracle_token_table" };
    },
  });
  const result = await provider.resolve({ projectSlug: "kiosko", settings: {} }, { identity: "1", channel: "app" });
  assert.equal(result.value, "654321");
  assert.equal(result.meta.attempts, 3);
});

test("latest mode needs a start time and Oracle errors become catalog errors", async () => {
  const provider = createOracleOtpProvider({
    latest: async () => { throw new OracleOtpServiceError("oracle_unavailable", 503); },
  });
  await assert.rejects(
    () => provider.resolve({ projectSlug: "kiosko", settings: {} }, { identity: "1", mode: "latest" }),
    (err: unknown) => err instanceof ServiceCatalogError && err.code === "missing_param",
  );
  await assert.rejects(
    () => provider.resolve({ projectSlug: "kiosko", settings: {}, generatedAfter: "2026-10-28T10:00:00.000Z" }, { identity: "1", mode: "latest" }),
    (err: unknown) => err instanceof ServiceCatalogError && err.code === "otp_oracle_unavailable" && err.httpStatus === 503,
  );
  await assert.rejects(
    () => provider.resolve({ projectSlug: "kiosko", settings: {} }, {}),
    /identidad/,
  );
});

function fakeDb(rows: unknown[], legacyRows: unknown[]) {
  const conn = {
    query: async (sql: string) => (sql.includes("ProjectOtpConfiguration") ? legacyRows : sql.includes("ProjectServiceConfiguration") ? rows : []) as never[],
  };
  return { withConnection: async <T>(fn: (c: typeof conn) => Promise<T>) => fn(conn), withTransaction: async <T>(fn: (c: typeof conn) => Promise<T>) => fn(conn) };
}

test("a legacy OTP row shows up in the catalog until the project saves its own", async () => {
  const legacy = {
    projectSlug: "app-conversacional", enabled: 1, strategy: "oracle_local_token", defaultChannel: "APP",
    allowedChannelsJson: '["APP"]', enabledEnvironmentsJson: '["qa"]', updatedAt: null,
  };
  const fromLegacy = await createProjectServiceConfigRepository(fakeDb([], [legacy])).get("app-conversacional", OTP_ORACLE_LOCAL_TOKEN_KEY);
  assert.equal(fromLegacy?.legacy, true);
  assert.deepEqual(fromLegacy?.settings, { defaultChannel: "APP", allowedChannels: ["APP"], enabledEnvironments: ["qa"] });

  const own = { projectSlug: "app-conversacional", serviceKey: OTP_ORACLE_LOCAL_TOKEN_KEY, enabled: 0, settingsJson: '{"defaultChannel":"WEB"}', updatedAt: null };
  const all = await createProjectServiceConfigRepository(fakeDb([own], [legacy])).listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].legacy, false);
  assert.equal(all[0].enabled, false);

  const none = { ...legacy, strategy: "none" };
  assert.deepEqual(await createProjectServiceConfigRepository(fakeDb([], [none])).listAll(), []);
});

test("app.config.json gets an otpProfile only for an enabled OTP service", () => {
  const config = {
    projectSlug: "kiosko", serviceKey: OTP_ORACLE_LOCAL_TOKEN_KEY, enabled: true, legacy: false, updatedAt: null,
    settings: { defaultChannel: "APP", allowedChannels: [], enabledEnvironments: ["qa"] },
  };
  assert.deepEqual(buildOtpProfile(config), {
    strategy: "oracle_local_token", defaultChannel: "APP", allowedChannels: undefined, enabledEnvironments: ["qa"],
  });
  assert.equal(buildOtpProfile({ ...config, enabled: false }), undefined);
  assert.equal(buildOtpProfile(null), undefined);
});

test("latest mode reads the token the app created, never generating one", async () => {
  // Job 7bbab74a: a code generated by the service was rejected; the app validates its own SMS token.
  const provider = createOracleOtpProvider({
    sleep: async () => {},
    generate: async () => assert.fail("latest must not generate"),
    latest: async (input) => {
      assert.equal(input.generatedAfter, "2026-10-29T10:00:00.000Z");
      return { ok: true, otp: "181834", channel: "ONBOARDINGWEB", source: "oracle_token_table" };
    },
  });
  const result = await provider.resolve(
    { projectSlug: "p", settings: { defaultChannel: "ONBOARDINGWEB" }, generatedAfter: "2026-10-29T10:00:00.000Z" },
    { identity: "402-2999373-4", mode: "latest" },
  );
  assert.equal(result.value, "181834");
  assert.equal(result.meta.source, "latest");
});

test("the bank procedure receives the cédula with its dashes, and garbage is still refused", async () => {
  const { generateLocalToken } = await import("../server/services/oracle-otp-service");
  const seen: string[] = [];
  const adapter = {
    executeGenerateLocalToken: async (input: { identity: string }) => {
      seen.push(input.identity);
      return { tokenGenerated: "123456", errorCode: "0", errorDescription: "" };
    },
    executeLatestLocalTokenQuery: async () => ({}),
  };
  const deps = {
    env: { ...READY_ENV, ORACLE_OTP_ALLOWED_CHANNELS: "ONBOARDINGWEB" } as NodeJS.ProcessEnv,
    adapter: adapter as never,
    appConfigLoader: async () => ({ otpProfile: { strategy: "oracle_local_token", enabledEnvironments: ["qa"] } }),
  };
  const result = await generateLocalToken({ identity: "402-2999373-4", channel: "ONBOARDINGWEB", appSlug: "portal-dashes" }, deps);
  assert.equal(result.otp, "123456");
  assert.deepEqual(seen, ["402-2999373-4"]);
  await assert.rejects(() => generateLocalToken({ identity: "402.299 9373", channel: "ONBOARDINGWEB", appSlug: "portal-bad" }, deps), /digits and dashes/);
});
