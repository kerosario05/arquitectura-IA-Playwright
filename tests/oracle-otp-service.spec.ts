import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { test, expect } from "@playwright/test";
import { loadDotenvWithPowerShellSupport } from "../src/config/dotenv-loader";
import {
  ORACLE_GENERATE_LOCAL_TOKEN_PLSQL,
  ORACLE_LATEST_LOCAL_TOKEN_SQL,
  OracleOtpServiceError,
  buildGenerateProcedureBinds,
  buildLatestTokenQueryBinds,
  createOracleOtpAdapter,
  evaluateOracleProcedureOutcome,
  generateLocalToken,
  getSharedOracleOtpAdapter,
  getLatestLocalToken,
  resetOtpRateLimiterForTests,
  resetSharedOracleOtpAdapterForTests,
  sanitizeOracleMessage,
  type OracleDriverLike,
  type OracleOtpAdapter,
  type OracleOtpRuntimeConfig,
} from "../src/server/services/oracle-otp-service";
import {
  applyOtpNoStoreHeaders,
  internalOtpRouter,
  mapOtpErrorToHttpPayload as mapRouteErrorToHttpPayload,
  requireOtpInternalAuth,
} from "../src/server/routes/internal-otp";

function createBaseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    APP_TEST_DATA_PROFILE: "qa",
    ORACLE_OTP_ENABLED: "true",
    ORACLE_OTP_CONNECT_STRING: "redacted-host:1521/service",
    ORACLE_OTP_USER: "otp_user",
    ORACLE_OTP_PASSWORD: "otp_password",
    ORACLE_OTP_REQUEST_KEY: "internal-secret",
    ORACLE_OTP_ALLOWED_CHANNELS: "ONBOARDINGWEB,APPMOBILE",
    ORACLE_OTP_DEFAULT_CHANNEL: "ONBOARDINGWEB",
    ORACLE_OTP_ALLOWED_ENVIRONMENTS: "local,qa",
    ORACLE_OTP_IDENTITY_MIN_LENGTH: "4",
    ORACLE_OTP_IDENTITY_MAX_LENGTH: "18",
    ORACLE_OTP_RATE_LIMIT_WINDOW_MS: "60000",
    ORACLE_OTP_RATE_LIMIT_MAX_REQUESTS: "20",
    ...overrides,
  };
}

function createOtpProfileConfig(): Record<string, unknown> {
  return {
    otpProfile: {
      strategy: "oracle_local_token",
      enabledEnvironments: ["qa"],
      defaultChannel: "ONBOARDINGWEB",
      allowedChannels: ["ONBOARDINGWEB", "APPMOBILE"],
    },
  };
}

function createRuntimeForAdapter(): OracleOtpRuntimeConfig {
  return {
    enabled: true,
    connectString: "host",
    user: "user",
    password: "pass",
    requestKey: "k",
    defaultChannel: "ONBOARDINGWEB",
    allowedChannels: ["ONBOARDINGWEB"],
    identityMinLength: 1,
    identityMaxLength: 64,
    channelMaxLength: 64,
    appSlugMaxLength: 64,
    requestIdMaxLength: 128,
    maxFutureMs: 1000,
    rateLimitWindowMs: 1000,
    rateLimitMaxRequests: 10,
    allowedEnvironments: ["local", "qa"],
  };
}

function createAdapterMock(): {
  adapter: OracleOtpAdapter;
  calls: {
    generate: number;
    latest: number;
    generateInput: Array<{ identity: string; channel: string }>;
    latestInput: Array<{ identity: string; channel: string; generatedAfter: Date }>;
  };
} {
  const calls = {
    generate: 0,
    latest: 0,
    generateInput: [] as Array<{ identity: string; channel: string }>,
    latestInput: [] as Array<{ identity: string; channel: string; generatedAfter: Date }>,
  };
  const adapter: OracleOtpAdapter = {
    async executeGenerateLocalToken(input) {
      calls.generate += 1;
      calls.generateInput.push({ identity: input.identity, channel: input.channel });
      return { tokenGenerated: "999999", errorCode: "0", errorDescription: "OK" };
    },
    async executeLatestLocalTokenQuery(input) {
      calls.latest += 1;
      calls.latestInput.push({
        identity: input.identity,
        channel: input.channel,
        generatedAfter: input.generatedAfter,
      });
      return { otp: "123" };
    },
  };
  return { adapter, calls };
}

async function withOtpAuthTestServer(
  envOverrides: Record<string, string | undefined>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const keys = [
    "API_KEY",
    "ORACLE_OTP_REQUEST_KEY",
    "ORACLE_OTP_ENABLED",
    "ORACLE_OTP_CONNECT_STRING",
    "ORACLE_OTP_USER",
    "ORACLE_OTP_PASSWORD",
    "ORACLE_OTP_ALLOWED_CHANNELS",
    "ORACLE_OTP_DEFAULT_CHANNEL",
    "ORACLE_OTP_ALLOWED_ENVIRONMENTS",
    "ORACLE_OTP_IDENTITY_MIN_LENGTH",
    "ORACLE_OTP_IDENTITY_MAX_LENGTH",
    "ORACLE_OTP_RATE_LIMIT_WINDOW_MS",
    "ORACLE_OTP_RATE_LIMIT_MAX_REQUESTS",
    "APP_TEST_DATA_PROFILE",
    "NODE_ENV",
  ] as const;

  const previousValues = new Map<string, string | undefined>();
  for (const key of keys) previousValues.set(key, process.env[key]);

  const baseEnv = createBaseEnv();
  for (const key of keys) {
    const nextValue = envOverrides[key] ?? (baseEnv[key] as string | undefined);
    if (typeof nextValue === "string") process.env[key] = nextValue;
    else delete process.env[key];
  }

  const app = express();
  app.use(express.json());
  app.use("/api/internal/otp", internalOtpRouter);
  app.post("/api/scenarios/preview", (_req, res) => {
    res.status(200).json({ ok: true, source: "scenarios-preview" });
  });

  const server = await new Promise<import("node:http").Server>((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
    s.once("error", reject);
  });
  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Failed to resolve test server address.");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of keys) {
      const previous = previousValues.get(key);
      if (typeof previous === "string") process.env[key] = previous;
      else delete process.env[key];
    }
  }
}

async function postJson(
  baseUrl: string,
  endpoint: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown>; rawBody: string }> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  const rawBody = await response.text();
  let body: Record<string, unknown> = {};
  if (rawBody.trim().length > 0) {
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      body = { raw: rawBody };
    }
  }
  return { status: response.status, body, rawBody };
}

test.beforeEach(() => {
  resetOtpRateLimiterForTests();
  resetSharedOracleOtpAdapterForTests();
});

test("generateLocalToken executes only PL/SQL procedure path", async () => {
  const { adapter, calls } = createAdapterMock();
  const result = await generateLocalToken(
    {
      identity: "40224679551",
      channel: "ONBOARDINGWEB",
      appSlug: "app-a",
    },
    {
      env: createBaseEnv(),
      adapter,
      requestIdFactory: () => "req-1",
      now: () => new Date("2026-08-07T09:00:00.000Z"),
      appConfigLoader: async () => createOtpProfileConfig(),
    },
  );
  expect(calls.generate).toBe(1);
  expect(calls.latest).toBe(0);
  expect(result.generatedAt).toBe("2026-08-07T09:00:00.000Z");
  expect(result.requestId).toBe("req-1");
  expect((result as unknown as Record<string, unknown>).otp).toBeUndefined();
});

test("getLatestLocalToken executes only SELECT path", async () => {
  const { adapter, calls } = createAdapterMock();
  const result = await getLatestLocalToken(
    {
      identity: "40224679551",
      channel: "ONBOARDINGWEB",
      appSlug: "app-a",
      generatedAfter: "2026-08-07T09:00:00.000Z",
      requestId: "req-2",
    },
    {
      env: createBaseEnv(),
      adapter,
      appConfigLoader: async () => createOtpProfileConfig(),
    },
  );
  expect(calls.latest).toBe(1);
  expect(calls.generate).toBe(0);
  expect(result.otp).toBe("000123");
  expect(result.source).toBe("oracle_token_table");
});

test("identity, channel and appSlug are dynamic and forwarded without hardcoding", async () => {
  const { adapter, calls } = createAdapterMock();
  const loadedAppSlugs: string[] = [];
  await generateLocalToken(
    {
      identity: "99887766",
      channel: "APPMOBILE",
      appSlug: "app-b",
    },
    {
      env: createBaseEnv(),
      adapter,
      requestIdFactory: () => "req-dynamic",
      appConfigLoader: async (appSlug) => {
        loadedAppSlugs.push(appSlug);
        return createOtpProfileConfig();
      },
    },
  );
  expect(loadedAppSlugs).toEqual(["app-b"]);
  expect(calls.generateInput[0]).toEqual({ identity: "99887766", channel: "APPMOBILE" });
});

test("missing generatedAfter is rejected before Oracle query", async () => {
  const { adapter, calls } = createAdapterMock();
  await expect(async () => {
    await getLatestLocalToken(
      {
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
        generatedAfter: "",
      },
      {
        env: createBaseEnv(),
        adapter,
        appConfigLoader: async () => createOtpProfileConfig(),
      },
    );
  }).rejects.toMatchObject({ reasonCode: "invalid_request", httpStatus: 400 });
  expect(calls.latest).toBe(0);
});

test("latest OTP preserves six digits and pads shorter numeric tokens", async () => {
  const sixDigitsAdapter: OracleOtpAdapter = {
    async executeGenerateLocalToken() {
      return { errorCode: "0" };
    },
    async executeLatestLocalTokenQuery() {
      return { otp: "123456" };
    },
  };
  const paddedAdapter: OracleOtpAdapter = {
    async executeGenerateLocalToken() {
      return { errorCode: "0" };
    },
    async executeLatestLocalTokenQuery() {
      return { otp: "123" };
    },
  };
  const baseInput = {
    identity: "40224679551",
    channel: "ONBOARDINGWEB",
    appSlug: "app-a",
    generatedAfter: "2026-08-07T09:00:00.000Z",
  };
  const fixedDeps = {
    env: createBaseEnv(),
    appConfigLoader: async () => createOtpProfileConfig(),
  };
  const resultA = await getLatestLocalToken(baseInput, {
    ...fixedDeps,
    adapter: sixDigitsAdapter,
  });
  const resultB = await getLatestLocalToken(baseInput, {
    ...fixedDeps,
    adapter: paddedAdapter,
  });
  expect(resultA.otp).toBe("123456");
  expect(resultB.otp).toBe("000123");
});

test("invalid OTP format is rejected", async () => {
  const invalidAdapter: OracleOtpAdapter = {
    async executeGenerateLocalToken() {
      return { errorCode: "0" };
    },
    async executeLatestLocalTokenQuery() {
      return { otp: "12A34" };
    },
  };
  await expect(async () => {
    await getLatestLocalToken(
      {
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
        generatedAfter: "2026-08-07T09:00:00.000Z",
      },
      {
        env: createBaseEnv(),
        adapter: invalidAdapter,
        appConfigLoader: async () => createOtpProfileConfig(),
      },
    );
  }).rejects.toMatchObject({ reasonCode: "otp_invalid_format", httpStatus: 502 });
});

test("missing token newer than generatedAfter returns otp_not_found", async () => {
  const notFoundAdapter: OracleOtpAdapter = {
    async executeGenerateLocalToken() {
      return { errorCode: "0" };
    },
    async executeLatestLocalTokenQuery() {
      return {};
    },
  };
  await expect(async () => {
    await getLatestLocalToken(
      {
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
        generatedAfter: "2026-08-07T09:00:00.000Z",
      },
      {
        env: createBaseEnv(),
        adapter: notFoundAdapter,
        appConfigLoader: async () => createOtpProfileConfig(),
      },
    );
  }).rejects.toMatchObject({ reasonCode: "otp_not_found", httpStatus: 404 });
});

test("procedure failure maps to oracle_procedure_failed", async () => {
  const failureAdapter: OracleOtpAdapter = {
    async executeGenerateLocalToken() {
      return { errorCode: "15", errorDescription: "Token generation failed" };
    },
    async executeLatestLocalTokenQuery() {
      return {};
    },
  };
  await expect(async () => {
    await generateLocalToken(
      {
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
      },
      {
        env: createBaseEnv(),
        adapter: failureAdapter,
        appConfigLoader: async () => createOtpProfileConfig(),
      },
    );
  }).rejects.toMatchObject({ reasonCode: "oracle_procedure_failed", httpStatus: 502 });
});

test("oracle unavailable errors map to oracle_unavailable", async () => {
  const unavailableAdapter: OracleOtpAdapter = {
    async executeGenerateLocalToken() {
      const err = new Error("ORA-12154: TNS could not resolve connect identifier");
      (err as Error & { code?: string }).code = "ORA-12154";
      throw err;
    },
    async executeLatestLocalTokenQuery() {
      return {};
    },
  };
  await expect(async () => {
    await generateLocalToken(
      {
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
      },
      {
        env: createBaseEnv(),
        adapter: unavailableAdapter,
        appConfigLoader: async () => createOtpProfileConfig(),
      },
    );
  }).rejects.toMatchObject({ reasonCode: "oracle_unavailable", httpStatus: 503 });
});

test("disabled endpoint, production and app/profile restrictions fail before Oracle adapter", async () => {
  const { adapter, calls } = createAdapterMock();
  await expect(async () => {
    await generateLocalToken(
      { identity: "40224679551", channel: "ONBOARDINGWEB", appSlug: "app-a" },
      {
        env: createBaseEnv({ ORACLE_OTP_ENABLED: "false" }),
        adapter,
        appConfigLoader: async () => createOtpProfileConfig(),
      },
    );
  }).rejects.toMatchObject({ reasonCode: "otp_endpoint_not_allowed", httpStatus: 403 });
  await expect(async () => {
    await generateLocalToken(
      { identity: "40224679551", channel: "ONBOARDINGWEB", appSlug: "app-a" },
      {
        env: createBaseEnv({ NODE_ENV: "production", APP_TEST_DATA_PROFILE: "production_like" }),
        adapter,
        appConfigLoader: async () => createOtpProfileConfig(),
      },
    );
  }).rejects.toMatchObject({ reasonCode: "otp_endpoint_not_allowed", httpStatus: 403 });
  await expect(async () => {
    await generateLocalToken(
      { identity: "40224679551", channel: "ONBOARDINGWEB", appSlug: "app-a" },
      {
        env: createBaseEnv(),
        adapter,
        appConfigLoader: async () => ({}),
      },
    );
  }).rejects.toMatchObject({ reasonCode: "otp_endpoint_not_allowed", httpStatus: 403 });
  expect(calls.generate).toBe(0);
});

test("channel allowlist is enforced before Oracle adapter call", async () => {
  const { adapter, calls } = createAdapterMock();
  await expect(async () => {
    await generateLocalToken(
      {
        identity: "40224679551",
        channel: "UNKNOWNCHANNEL",
        appSlug: "app-a",
      },
      {
        env: createBaseEnv(),
        adapter,
        appConfigLoader: async () => createOtpProfileConfig(),
      },
    );
  }).rejects.toMatchObject({ reasonCode: "otp_endpoint_not_allowed", httpStatus: 403 });
  expect(calls.generate).toBe(0);
});

test("internal OTP authentication uses only ORACLE_OTP_REQUEST_KEY + X-Automation-Key", () => {
  expect(() => requireOtpInternalAuth(
    { "x-automation-key": "internal-secret" },
    createBaseEnv({ API_KEY: "global-api-key" }),
  )).not.toThrow();
  expect(() => requireOtpInternalAuth(
    { "x-api-key": "global-api-key" },
    createBaseEnv({ API_KEY: "global-api-key" }),
  )).toThrow(OracleOtpServiceError);
  expect(() => requireOtpInternalAuth(
    {},
    createBaseEnv({ API_KEY: "global-api-key" }),
  )).toThrow(OracleOtpServiceError);
  expect(() => requireOtpInternalAuth(
    { "x-automation-key": "wrong" },
    createBaseEnv({ API_KEY: "global-api-key" }),
  )).toThrow(OracleOtpServiceError);

  let missingKeyError: unknown;
  try {
    requireOtpInternalAuth(
      { "x-automation-key": "anything" },
      createBaseEnv({ ORACLE_OTP_REQUEST_KEY: undefined }),
    );
  } catch (err) {
    missingKeyError = err;
  }
  expect(missingKeyError).toBeInstanceOf(OracleOtpServiceError);
  expect((missingKeyError as OracleOtpServiceError).reasonCode).toBe("otp_endpoint_not_allowed");
});

test("OTP auth middleware applies only to /api/internal/otp routes", async () => {
  await withOtpAuthTestServer(
    {
      API_KEY: undefined,
      ORACLE_OTP_REQUEST_KEY: "internal-secret",
      ORACLE_OTP_ENABLED: "true",
    },
    async (baseUrl) => {
      const scenarioResponse = await postJson(baseUrl, "/api/scenarios/preview", {
        projectKey: "AA",
      });
      expect(scenarioResponse.status).toBe(200);
      expect(scenarioResponse.body.ok).toBe(true);

      const generateNoKey = await postJson(baseUrl, "/api/internal/otp/local-token/generate", {
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
      });
      expect(generateNoKey.status).toBe(401);
      expect(generateNoKey.body).toEqual({ ok: false, reasonCode: "invalid_internal_auth" });

      const generateWrongKey = await postJson(baseUrl, "/api/internal/otp/local-token/generate", {
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
      }, {
        "x-automation-key": "wrong",
      });
      expect(generateWrongKey.status).toBe(401);
      expect(generateWrongKey.body).toEqual({ ok: false, reasonCode: "invalid_internal_auth" });

      const latestNoKey = await postJson(baseUrl, "/api/internal/otp/local-token/latest", {
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
        generatedAfter: "2026-08-07T09:00:00.000Z",
      });
      expect(latestNoKey.status).toBe(401);
      expect(latestNoKey.body).toEqual({ ok: false, reasonCode: "invalid_internal_auth" });

      const latestWrongKey = await postJson(baseUrl, "/api/internal/otp/local-token/latest", {
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
        generatedAfter: "2026-08-07T09:00:00.000Z",
      }, {
        "x-automation-key": "wrong",
      });
      expect(latestWrongKey.status).toBe(401);
      expect(latestWrongKey.body).toEqual({ ok: false, reasonCode: "invalid_internal_auth" });
    },
  );
});

test("OTP routes accept valid X-Automation-Key regardless of API_KEY presence", async () => {
  for (const apiKeyValue of [undefined, "global-api-key"]) {
    await withOtpAuthTestServer(
      {
        API_KEY: apiKeyValue,
        ORACLE_OTP_REQUEST_KEY: "internal-secret",
        ORACLE_OTP_ENABLED: "true",
      },
      async (baseUrl) => {
        const generateWithKey = await postJson(baseUrl, "/api/internal/otp/local-token/generate", {}, {
          "x-automation-key": "internal-secret",
        });
        expect(generateWithKey.status).toBe(400);
        expect(generateWithKey.body).toEqual({ ok: false, reasonCode: "invalid_request" });
        expect(generateWithKey.rawBody.includes("internal-secret")).toBe(false);

        const latestWithKey = await postJson(baseUrl, "/api/internal/otp/local-token/latest", {}, {
          "x-automation-key": "internal-secret",
        });
        expect(latestWithKey.status).toBe(400);
        expect(latestWithKey.body).toEqual({ ok: false, reasonCode: "invalid_request" });
        expect(latestWithKey.rawBody.includes("internal-secret")).toBe(false);
      },
    );
  }
});

test("dotenv loader normalizes PowerShell-style assignments before OTP auth", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "otp-dotenv-"));
  try {
    const envFilePath = path.join(tempDir, ".env");
    fs.writeFileSync(
      envFilePath,
      [
        "$env:API_KEY=api-from-powershell",
        "$env:ORACLE_OTP_REQUEST_KEY=request-from-powershell",
      ].join("\n"),
      "utf8",
    );

    const env: NodeJS.ProcessEnv = {};
    loadDotenvWithPowerShellSupport({ envPath: envFilePath, env });
    expect(env.API_KEY).toBe("api-from-powershell");
    expect(env.ORACLE_OTP_REQUEST_KEY).toBe("request-from-powershell");
    expect(() => requireOtpInternalAuth(
      { "x-api-key": "api-from-powershell" },
      env,
    )).toThrow(OracleOtpServiceError);
    expect(() => requireOtpInternalAuth(
      { "x-automation-key": "request-from-powershell" },
      env,
    )).not.toThrow();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("no-store headers are always applied and mapped payload does not expose internals", () => {
  const headers = new Map<string, string>();
  applyOtpNoStoreHeaders({
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
  });
  expect(headers.get("Cache-Control")).toBe("no-store");
  expect(headers.get("Pragma")).toBe("no-cache");

  const mapped = mapRouteErrorToHttpPayload(new OracleOtpServiceError("oracle_procedure_failed", 502, {
    oracleCode: "ORA-20001",
    message: "safe message",
  }));
  expect(mapped.status).toBe(502);
  expect(mapped.body).toEqual({
    ok: false,
    reasonCode: "oracle_procedure_failed",
    oracleCode: "ORA-20001",
    message: "safe message",
  });
});

test("PL/SQL and SQL keep bind placeholders (no interpolation)", async () => {
  const captured: Array<{ statement: string; binds: Record<string, unknown> }> = [];
  const fakeDriver: OracleDriverLike = {
    BIND_IN: 3001,
    BIND_OUT: 3003,
    STRING: 2001,
    OUT_FORMAT_OBJECT: 4002,
    async createPool() {
      return {
        async getConnection() {
          return {
            async execute(statement, binds) {
              captured.push({ statement, binds });
              if (statement.includes("PKG_GENERA_TOKEN")) {
                return { outBinds: { errorCode: "0", errorDescription: "OK" } };
              }
              return { rows: [{ OTP: "654321" }] };
            },
            async close() {
              return;
            },
          };
        },
      };
    },
  };
  const adapter = createOracleOtpAdapter({
    driverResolver: async () => fakeDriver,
  });

  await adapter.executeGenerateLocalToken({
    identity: "40224679551",
    channel: "ONBOARDINGWEB",
    runtime: createRuntimeForAdapter(),
  });
  await adapter.executeLatestLocalTokenQuery({
    identity: "40224679551",
    channel: "ONBOARDINGWEB",
    generatedAfter: new Date("2026-08-07T09:00:00.000Z"),
    runtime: createRuntimeForAdapter(),
  });

  expect(captured[0].statement).toBe(ORACLE_GENERATE_LOCAL_TOKEN_PLSQL);
  expect(captured[0].statement).toContain(":identity");
  expect(captured[0].statement).not.toContain("40224679551");
  expect(captured[1].statement).toBe(ORACLE_LATEST_LOCAL_TOKEN_SQL);
  expect(captured[1].statement).toContain(":generatedAfter");
  expect(captured[1].statement).not.toContain("40224679551");
});

test("connection is closed in success and error paths", async () => {
  let closeCalls = 0;
  let executeCalls = 0;
  const fakeDriver: OracleDriverLike = {
    BIND_IN: 3001,
    BIND_OUT: 3003,
    STRING: 2001,
    async createPool() {
      return {
        async getConnection() {
          return {
            async execute() {
              executeCalls += 1;
              if (executeCalls === 1) {
                return { outBinds: { errorCode: "0", errorDescription: "OK" } };
              }
              throw new Error("ORA-20000 procedural failure");
            },
            async close() {
              closeCalls += 1;
            },
          };
        },
      };
    },
  };
  const adapter = createOracleOtpAdapter({
    driverResolver: async () => fakeDriver,
  });
  const runtime = createRuntimeForAdapter();
  await adapter.executeGenerateLocalToken({
    identity: "40224679551",
    channel: "ONBOARDINGWEB",
    runtime,
  });
  await expect(async () => {
    await adapter.executeLatestLocalTokenQuery({
      identity: "40224679551",
      channel: "ONBOARDINGWEB",
      generatedAfter: new Date(),
      runtime,
    });
  }).rejects.toThrow();
  expect(closeCalls).toBe(2);
});

test("oracle pool is lazy and reused within the same adapter instance", async () => {
  let createPoolCalls = 0;
  let getConnectionCalls = 0;
  const fakeDriver: OracleDriverLike = {
    BIND_IN: 3001,
    BIND_OUT: 3003,
    STRING: 2001,
    OUT_FORMAT_OBJECT: 4002,
    async createPool() {
      createPoolCalls += 1;
      return {
        async getConnection() {
          getConnectionCalls += 1;
          return {
            async execute(statement) {
              if (statement.includes("PKG_GENERA_TOKEN")) {
                return { outBinds: { errorCode: "0", errorDescription: "OK" } };
              }
              return { rows: [{ OTP: "123456" }] };
            },
            async close() {
              return;
            },
          };
        },
      };
    },
  };
  const adapter = createOracleOtpAdapter({
    driverResolver: async () => fakeDriver,
  });
  expect(createPoolCalls).toBe(0);

  const runtime = createRuntimeForAdapter();
  await adapter.executeGenerateLocalToken({
    identity: "40224679551",
    channel: "ONBOARDINGWEB",
    runtime,
  });
  await adapter.executeLatestLocalTokenQuery({
    identity: "40224679551",
    channel: "ONBOARDINGWEB",
    generatedAfter: new Date("2026-08-07T09:00:00.000Z"),
    runtime,
  });

  expect(createPoolCalls).toBe(1);
  expect(getConnectionCalls).toBe(2);
});

test("shared runtime adapter returns same instance across requests", () => {
  const first = getSharedOracleOtpAdapter(createBaseEnv());
  const second = getSharedOracleOtpAdapter(createBaseEnv());
  expect(first).toBe(second);
});

test("concurrent generate calls do not share bind objects or results", async () => {
  const bindReferences: Array<Record<string, unknown>> = [];
  const fakeDriver: OracleDriverLike = {
    BIND_IN: 3001,
    BIND_OUT: 3003,
    STRING: 2001,
    async createPool() {
      return {
        async getConnection() {
          return {
            async execute(statement, binds) {
              if (statement.includes("PKG_GENERA_TOKEN")) {
                bindReferences.push(binds);
                return { outBinds: { errorCode: "0", errorDescription: "OK" } };
              }
              return { rows: [] };
            },
            async close() {
              return;
            },
          };
        },
      };
    },
  };
  const adapter = createOracleOtpAdapter({
    driverResolver: async () => fakeDriver,
  });

  const baseDeps = {
    env: createBaseEnv(),
    adapter,
    appConfigLoader: async () => createOtpProfileConfig(),
  };

  const [a, b] = await Promise.all([
    generateLocalToken({ identity: "40224679551", channel: "ONBOARDINGWEB", appSlug: "app-a" }, { ...baseDeps, requestIdFactory: () => "req-a" }),
    generateLocalToken({ identity: "40224679552", channel: "ONBOARDINGWEB", appSlug: "app-a" }, { ...baseDeps, requestIdFactory: () => "req-b" }),
  ]);

  expect(a.requestId).toBe("req-a");
  expect(b.requestId).toBe("req-b");
  expect(bindReferences).toHaveLength(2);
  expect(bindReferences[0]).not.toBe(bindReferences[1]);
});

test("real app config for arquitectura-automatizacion resolves otpProfile strategy oracle_local_token", async () => {
  const { adapter, calls } = createAdapterMock();
  const result = await generateLocalToken(
    {
      identity: "40224679551",
      channel: "ONBOARDINGWEB",
      appSlug: "arquitectura-automatizacion",
    },
    {
      env: createBaseEnv(),
      adapter,
      requestIdFactory: () => "req-real-config",
    },
  );
  expect(result.ok).toBe(true);
  expect(calls.generate).toBe(1);
});

test("helper bind builders and procedure success criteria are explicit and testable", () => {
  const binds = buildGenerateProcedureBinds({
    identity: "40224679551",
    channel: "ONBOARDINGWEB",
    driver: {
      BIND_IN: 1,
      BIND_OUT: 2,
      STRING: 3,
    },
  });
  const queryBinds = buildLatestTokenQueryBinds({
    identity: "40224679551",
    channel: "ONBOARDINGWEB",
    generatedAfter: new Date("2026-08-07T09:00:00.000Z"),
  });
  expect((binds.identity as { val: string }).val).toBe("40224679551");
  expect((binds.channel as { val: string }).val).toBe("ONBOARDINGWEB");
  expect(queryBinds.identity).toBe("40224679551");
  expect(evaluateOracleProcedureOutcome("", "")).toEqual({ ok: true });
  expect(evaluateOracleProcedureOutcome("000", "OK")).toEqual({ ok: true });
  expect(evaluateOracleProcedureOutcome("15", "ERR").ok).toBe(false);
});

test("sanitized oracle errors redact secrets from public payloads", () => {
  const sanitized = sanitizeOracleMessage({
    rawMessage: "ORA-01017 for user otp_user password otp_password connect redacted-host:1521/service",
    runtime: {
      enabled: true,
      connectString: "redacted-host:1521/service",
      user: "otp_user",
      password: "otp_password",
      requestKey: "k",
      defaultChannel: "ONBOARDINGWEB",
      allowedChannels: ["ONBOARDINGWEB"],
      identityMinLength: 1,
      identityMaxLength: 64,
      channelMaxLength: 64,
      appSlugMaxLength: 64,
      requestIdMaxLength: 128,
      maxFutureMs: 1000,
      rateLimitWindowMs: 1000,
      rateLimitMaxRequests: 10,
      allowedEnvironments: ["local", "qa"],
    },
  });
  expect(sanitized).not.toContain("otp_password");
  expect(sanitized).not.toContain("redacted-host:1521/service");
  const mapped = mapRouteErrorToHttpPayload(
    new OracleOtpServiceError("oracle_procedure_failed", 502, {
      oracleCode: "ORA-01017",
      message: sanitized,
    }),
  );
  expect(mapped.body).not.toHaveProperty("stack");
});
