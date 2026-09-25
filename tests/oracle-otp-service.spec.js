"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const test_1 = require("@playwright/test");
const dotenv_loader_1 = require("../src/config/dotenv-loader");
const oracle_otp_service_1 = require("../src/server/services/oracle-otp-service");
const internal_otp_1 = require("../src/server/routes/internal-otp");
function createBaseEnv(overrides = {}) {
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
function createOtpProfileConfig() {
    return {
        otpProfile: {
            strategy: "oracle_local_token",
            enabledEnvironments: ["qa"],
            defaultChannel: "ONBOARDINGWEB",
            allowedChannels: ["ONBOARDINGWEB", "APPMOBILE"],
        },
    };
}
function createRuntimeForAdapter() {
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
function createAdapterMock() {
    const calls = {
        generate: 0,
        latest: 0,
        generateInput: [],
        latestInput: [],
    };
    const adapter = {
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
async function withOtpAuthTestServer(envOverrides, run) {
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
    ];
    const previousValues = new Map();
    for (const key of keys)
        previousValues.set(key, process.env[key]);
    const baseEnv = createBaseEnv();
    for (const key of keys) {
        const nextValue = envOverrides[key] ?? baseEnv[key];
        if (typeof nextValue === "string")
            process.env[key] = nextValue;
        else
            delete process.env[key];
    }
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use("/api/internal/otp", internal_otp_1.internalOtpRouter);
    app.post("/api/scenarios/preview", (_req, res) => {
        res.status(200).json({ ok: true, source: "scenarios-preview" });
    });
    const server = await new Promise((resolve, reject) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
        s.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        await new Promise((resolve) => server.close(() => resolve()));
        throw new Error("Failed to resolve test server address.");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
        await run(baseUrl);
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
        for (const key of keys) {
            const previous = previousValues.get(key);
            if (typeof previous === "string")
                process.env[key] = previous;
            else
                delete process.env[key];
        }
    }
}
async function postJson(baseUrl, endpoint, payload, headers = {}) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...headers,
        },
        body: JSON.stringify(payload),
    });
    const rawBody = await response.text();
    let body = {};
    if (rawBody.trim().length > 0) {
        try {
            body = JSON.parse(rawBody);
        }
        catch {
            body = { raw: rawBody };
        }
    }
    return { status: response.status, body, rawBody };
}
test_1.test.beforeEach(() => {
    (0, oracle_otp_service_1.resetOtpRateLimiterForTests)();
    (0, oracle_otp_service_1.resetSharedOracleOtpAdapterForTests)();
});
(0, test_1.test)("generateLocalToken executes only PL/SQL procedure path", async () => {
    const { adapter, calls } = createAdapterMock();
    const result = await (0, oracle_otp_service_1.generateLocalToken)({
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
    }, {
        env: createBaseEnv(),
        adapter,
        requestIdFactory: () => "req-1",
        now: () => new Date("2026-08-07T09:00:00.000Z"),
        appConfigLoader: async () => createOtpProfileConfig(),
    });
    (0, test_1.expect)(calls.generate).toBe(1);
    (0, test_1.expect)(calls.latest).toBe(0);
    (0, test_1.expect)(result.generatedAt).toBe("2026-08-07T09:00:00.000Z");
    (0, test_1.expect)(result.requestId).toBe("req-1");
    // pTokenGen is surfaced so callers can skip the `latest` round-trip, whose
    // FECHA_ADICION >= generatedAfter filter matches nothing when the database clock
    // lags the API host's. Still a single procedure call — latest stays at 0.
    (0, test_1.expect)(result.otp).toBe("999999");
});
(0, test_1.test)("generateLocalToken omits otp when pTokenGen is unusable", async () => {
    const { adapter, calls } = createAdapterMock();
    adapter.executeGenerateLocalToken = async () => {
        calls.generate += 1;
        return { tokenGenerated: "not-a-token", errorCode: "0", errorDescription: "OK" };
    };
    const result = await (0, oracle_otp_service_1.generateLocalToken)({
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
    }, {
        env: createBaseEnv(),
        adapter,
        requestIdFactory: () => "req-1",
        now: () => new Date("2026-08-07T09:00:00.000Z"),
        appConfigLoader: async () => createOtpProfileConfig(),
    });
    // A malformed pTokenGen must not fail a generate Oracle already reported as successful:
    // the caller falls back to `latest`.
    (0, test_1.expect)(result.ok).toBe(true);
    (0, test_1.expect)(result.otp).toBeUndefined();
    (0, test_1.expect)(calls.generate).toBe(1);
    (0, test_1.expect)(calls.latest).toBe(0);
});
(0, test_1.test)("getLatestLocalToken executes only SELECT path", async () => {
    const { adapter, calls } = createAdapterMock();
    const result = await (0, oracle_otp_service_1.getLatestLocalToken)({
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "app-a",
        generatedAfter: "2026-08-07T09:00:00.000Z",
        requestId: "req-2",
    }, {
        env: createBaseEnv(),
        adapter,
        appConfigLoader: async () => createOtpProfileConfig(),
    });
    (0, test_1.expect)(calls.latest).toBe(1);
    (0, test_1.expect)(calls.generate).toBe(0);
    (0, test_1.expect)(result.otp).toBe("000123");
    (0, test_1.expect)(result.source).toBe("oracle_token_table");
});
(0, test_1.test)("identity, channel and appSlug are dynamic and forwarded without hardcoding", async () => {
    const { adapter, calls } = createAdapterMock();
    const loadedAppSlugs = [];
    await (0, oracle_otp_service_1.generateLocalToken)({
        identity: "99887766",
        channel: "APPMOBILE",
        appSlug: "app-b",
    }, {
        env: createBaseEnv(),
        adapter,
        requestIdFactory: () => "req-dynamic",
        appConfigLoader: async (appSlug) => {
            loadedAppSlugs.push(appSlug);
            return createOtpProfileConfig();
        },
    });
    (0, test_1.expect)(loadedAppSlugs).toEqual(["app-b"]);
    (0, test_1.expect)(calls.generateInput[0]).toEqual({ identity: "99887766", channel: "APPMOBILE" });
});
(0, test_1.test)("missing generatedAfter is rejected before Oracle query", async () => {
    const { adapter, calls } = createAdapterMock();
    await (0, test_1.expect)(async () => {
        await (0, oracle_otp_service_1.getLatestLocalToken)({
            identity: "40224679551",
            channel: "ONBOARDINGWEB",
            appSlug: "app-a",
            generatedAfter: "",
        }, {
            env: createBaseEnv(),
            adapter,
            appConfigLoader: async () => createOtpProfileConfig(),
        });
    }).rejects.toMatchObject({ reasonCode: "invalid_request", httpStatus: 400 });
    (0, test_1.expect)(calls.latest).toBe(0);
});
(0, test_1.test)("latest OTP preserves six digits and pads shorter numeric tokens", async () => {
    const sixDigitsAdapter = {
        async executeGenerateLocalToken() {
            return { errorCode: "0" };
        },
        async executeLatestLocalTokenQuery() {
            return { otp: "123456" };
        },
    };
    const paddedAdapter = {
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
    const resultA = await (0, oracle_otp_service_1.getLatestLocalToken)(baseInput, {
        ...fixedDeps,
        adapter: sixDigitsAdapter,
    });
    const resultB = await (0, oracle_otp_service_1.getLatestLocalToken)(baseInput, {
        ...fixedDeps,
        adapter: paddedAdapter,
    });
    (0, test_1.expect)(resultA.otp).toBe("123456");
    (0, test_1.expect)(resultB.otp).toBe("000123");
});
(0, test_1.test)("invalid OTP format is rejected", async () => {
    const invalidAdapter = {
        async executeGenerateLocalToken() {
            return { errorCode: "0" };
        },
        async executeLatestLocalTokenQuery() {
            return { otp: "12A34" };
        },
    };
    await (0, test_1.expect)(async () => {
        await (0, oracle_otp_service_1.getLatestLocalToken)({
            identity: "40224679551",
            channel: "ONBOARDINGWEB",
            appSlug: "app-a",
            generatedAfter: "2026-08-07T09:00:00.000Z",
        }, {
            env: createBaseEnv(),
            adapter: invalidAdapter,
            appConfigLoader: async () => createOtpProfileConfig(),
        });
    }).rejects.toMatchObject({ reasonCode: "otp_invalid_format", httpStatus: 502 });
});
(0, test_1.test)("missing token newer than generatedAfter returns otp_not_found", async () => {
    const notFoundAdapter = {
        async executeGenerateLocalToken() {
            return { errorCode: "0" };
        },
        async executeLatestLocalTokenQuery() {
            return {};
        },
    };
    await (0, test_1.expect)(async () => {
        await (0, oracle_otp_service_1.getLatestLocalToken)({
            identity: "40224679551",
            channel: "ONBOARDINGWEB",
            appSlug: "app-a",
            generatedAfter: "2026-08-07T09:00:00.000Z",
        }, {
            env: createBaseEnv(),
            adapter: notFoundAdapter,
            appConfigLoader: async () => createOtpProfileConfig(),
        });
    }).rejects.toMatchObject({ reasonCode: "otp_not_found", httpStatus: 404 });
});
(0, test_1.test)("procedure failure maps to oracle_procedure_failed", async () => {
    const failureAdapter = {
        async executeGenerateLocalToken() {
            return { errorCode: "15", errorDescription: "Token generation failed" };
        },
        async executeLatestLocalTokenQuery() {
            return {};
        },
    };
    await (0, test_1.expect)(async () => {
        await (0, oracle_otp_service_1.generateLocalToken)({
            identity: "40224679551",
            channel: "ONBOARDINGWEB",
            appSlug: "app-a",
        }, {
            env: createBaseEnv(),
            adapter: failureAdapter,
            appConfigLoader: async () => createOtpProfileConfig(),
        });
    }).rejects.toMatchObject({ reasonCode: "oracle_procedure_failed", httpStatus: 502 });
});
(0, test_1.test)("oracle unavailable errors map to oracle_unavailable", async () => {
    const unavailableAdapter = {
        async executeGenerateLocalToken() {
            const err = new Error("ORA-12154: TNS could not resolve connect identifier");
            err.code = "ORA-12154";
            throw err;
        },
        async executeLatestLocalTokenQuery() {
            return {};
        },
    };
    await (0, test_1.expect)(async () => {
        await (0, oracle_otp_service_1.generateLocalToken)({
            identity: "40224679551",
            channel: "ONBOARDINGWEB",
            appSlug: "app-a",
        }, {
            env: createBaseEnv(),
            adapter: unavailableAdapter,
            appConfigLoader: async () => createOtpProfileConfig(),
        });
    }).rejects.toMatchObject({ reasonCode: "oracle_unavailable", httpStatus: 503 });
});
(0, test_1.test)("disabled endpoint, production and app/profile restrictions fail before Oracle adapter", async () => {
    const { adapter, calls } = createAdapterMock();
    await (0, test_1.expect)(async () => {
        await (0, oracle_otp_service_1.generateLocalToken)({ identity: "40224679551", channel: "ONBOARDINGWEB", appSlug: "app-a" }, {
            env: createBaseEnv({ ORACLE_OTP_ENABLED: "false" }),
            adapter,
            appConfigLoader: async () => createOtpProfileConfig(),
        });
    }).rejects.toMatchObject({ reasonCode: "otp_endpoint_not_allowed", httpStatus: 403 });
    await (0, test_1.expect)(async () => {
        await (0, oracle_otp_service_1.generateLocalToken)({ identity: "40224679551", channel: "ONBOARDINGWEB", appSlug: "app-a" }, {
            env: createBaseEnv({ NODE_ENV: "production", APP_TEST_DATA_PROFILE: "production_like" }),
            adapter,
            appConfigLoader: async () => createOtpProfileConfig(),
        });
    }).rejects.toMatchObject({ reasonCode: "otp_endpoint_not_allowed", httpStatus: 403 });
    await (0, test_1.expect)(async () => {
        await (0, oracle_otp_service_1.generateLocalToken)({ identity: "40224679551", channel: "ONBOARDINGWEB", appSlug: "app-a" }, {
            env: createBaseEnv(),
            adapter,
            appConfigLoader: async () => ({}),
        });
    }).rejects.toMatchObject({ reasonCode: "otp_endpoint_not_allowed", httpStatus: 403 });
    (0, test_1.expect)(calls.generate).toBe(0);
});
(0, test_1.test)("channel allowlist is enforced before Oracle adapter call", async () => {
    const { adapter, calls } = createAdapterMock();
    await (0, test_1.expect)(async () => {
        await (0, oracle_otp_service_1.generateLocalToken)({
            identity: "40224679551",
            channel: "UNKNOWNCHANNEL",
            appSlug: "app-a",
        }, {
            env: createBaseEnv(),
            adapter,
            appConfigLoader: async () => createOtpProfileConfig(),
        });
    }).rejects.toMatchObject({ reasonCode: "otp_endpoint_not_allowed", httpStatus: 403 });
    (0, test_1.expect)(calls.generate).toBe(0);
});
(0, test_1.test)("internal OTP authentication uses only ORACLE_OTP_REQUEST_KEY + X-Automation-Key", () => {
    (0, test_1.expect)(() => (0, internal_otp_1.requireOtpInternalAuth)({ "x-automation-key": "internal-secret" }, createBaseEnv({ API_KEY: "global-api-key" }))).not.toThrow();
    (0, test_1.expect)(() => (0, internal_otp_1.requireOtpInternalAuth)({ "x-api-key": "global-api-key" }, createBaseEnv({ API_KEY: "global-api-key" }))).toThrow(oracle_otp_service_1.OracleOtpServiceError);
    (0, test_1.expect)(() => (0, internal_otp_1.requireOtpInternalAuth)({}, createBaseEnv({ API_KEY: "global-api-key" }))).toThrow(oracle_otp_service_1.OracleOtpServiceError);
    (0, test_1.expect)(() => (0, internal_otp_1.requireOtpInternalAuth)({ "x-automation-key": "wrong" }, createBaseEnv({ API_KEY: "global-api-key" }))).toThrow(oracle_otp_service_1.OracleOtpServiceError);
    let missingKeyError;
    try {
        (0, internal_otp_1.requireOtpInternalAuth)({ "x-automation-key": "anything" }, createBaseEnv({ ORACLE_OTP_REQUEST_KEY: undefined }));
    }
    catch (err) {
        missingKeyError = err;
    }
    (0, test_1.expect)(missingKeyError).toBeInstanceOf(oracle_otp_service_1.OracleOtpServiceError);
    (0, test_1.expect)(missingKeyError.reasonCode).toBe("otp_endpoint_not_allowed");
});
(0, test_1.test)("OTP auth middleware applies only to /api/internal/otp routes", async () => {
    await withOtpAuthTestServer({
        API_KEY: undefined,
        ORACLE_OTP_REQUEST_KEY: "internal-secret",
        ORACLE_OTP_ENABLED: "true",
    }, async (baseUrl) => {
        const scenarioResponse = await postJson(baseUrl, "/api/scenarios/preview", {
            projectKey: "AA",
        });
        (0, test_1.expect)(scenarioResponse.status).toBe(200);
        (0, test_1.expect)(scenarioResponse.body.ok).toBe(true);
        const generateNoKey = await postJson(baseUrl, "/api/internal/otp/local-token/generate", {
            identity: "40224679551",
            channel: "ONBOARDINGWEB",
            appSlug: "app-a",
        });
        (0, test_1.expect)(generateNoKey.status).toBe(401);
        (0, test_1.expect)(generateNoKey.body).toEqual({ ok: false, reasonCode: "invalid_internal_auth" });
        const generateWrongKey = await postJson(baseUrl, "/api/internal/otp/local-token/generate", {
            identity: "40224679551",
            channel: "ONBOARDINGWEB",
            appSlug: "app-a",
        }, {
            "x-automation-key": "wrong",
        });
        (0, test_1.expect)(generateWrongKey.status).toBe(401);
        (0, test_1.expect)(generateWrongKey.body).toEqual({ ok: false, reasonCode: "invalid_internal_auth" });
        const latestNoKey = await postJson(baseUrl, "/api/internal/otp/local-token/latest", {
            identity: "40224679551",
            channel: "ONBOARDINGWEB",
            appSlug: "app-a",
            generatedAfter: "2026-08-07T09:00:00.000Z",
        });
        (0, test_1.expect)(latestNoKey.status).toBe(401);
        (0, test_1.expect)(latestNoKey.body).toEqual({ ok: false, reasonCode: "invalid_internal_auth" });
        const latestWrongKey = await postJson(baseUrl, "/api/internal/otp/local-token/latest", {
            identity: "40224679551",
            channel: "ONBOARDINGWEB",
            appSlug: "app-a",
            generatedAfter: "2026-08-07T09:00:00.000Z",
        }, {
            "x-automation-key": "wrong",
        });
        (0, test_1.expect)(latestWrongKey.status).toBe(401);
        (0, test_1.expect)(latestWrongKey.body).toEqual({ ok: false, reasonCode: "invalid_internal_auth" });
    });
});
(0, test_1.test)("OTP routes accept valid X-Automation-Key regardless of API_KEY presence", async () => {
    for (const apiKeyValue of [undefined, "global-api-key"]) {
        await withOtpAuthTestServer({
            API_KEY: apiKeyValue,
            ORACLE_OTP_REQUEST_KEY: "internal-secret",
            ORACLE_OTP_ENABLED: "true",
        }, async (baseUrl) => {
            const generateWithKey = await postJson(baseUrl, "/api/internal/otp/local-token/generate", {}, {
                "x-automation-key": "internal-secret",
            });
            (0, test_1.expect)(generateWithKey.status).toBe(400);
            (0, test_1.expect)(generateWithKey.body).toEqual({ ok: false, reasonCode: "invalid_request" });
            (0, test_1.expect)(generateWithKey.rawBody.includes("internal-secret")).toBe(false);
            const latestWithKey = await postJson(baseUrl, "/api/internal/otp/local-token/latest", {}, {
                "x-automation-key": "internal-secret",
            });
            (0, test_1.expect)(latestWithKey.status).toBe(400);
            (0, test_1.expect)(latestWithKey.body).toEqual({ ok: false, reasonCode: "invalid_request" });
            (0, test_1.expect)(latestWithKey.rawBody.includes("internal-secret")).toBe(false);
        });
    }
});
(0, test_1.test)("dotenv loader normalizes PowerShell-style assignments before OTP auth", () => {
    const tempDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "otp-dotenv-"));
    try {
        const envFilePath = node_path_1.default.join(tempDir, ".env");
        node_fs_1.default.writeFileSync(envFilePath, [
            "$env:API_KEY=api-from-powershell",
            "$env:ORACLE_OTP_REQUEST_KEY=request-from-powershell",
        ].join("\n"), "utf8");
        const env = {};
        (0, dotenv_loader_1.loadDotenvWithPowerShellSupport)({ envPath: envFilePath, env });
        (0, test_1.expect)(env.API_KEY).toBe("api-from-powershell");
        (0, test_1.expect)(env.ORACLE_OTP_REQUEST_KEY).toBe("request-from-powershell");
        (0, test_1.expect)(() => (0, internal_otp_1.requireOtpInternalAuth)({ "x-api-key": "api-from-powershell" }, env)).toThrow(oracle_otp_service_1.OracleOtpServiceError);
        (0, test_1.expect)(() => (0, internal_otp_1.requireOtpInternalAuth)({ "x-automation-key": "request-from-powershell" }, env)).not.toThrow();
    }
    finally {
        node_fs_1.default.rmSync(tempDir, { recursive: true, force: true });
    }
});
(0, test_1.test)("no-store headers are always applied and mapped payload does not expose internals", () => {
    const headers = new Map();
    (0, internal_otp_1.applyOtpNoStoreHeaders)({
        setHeader(name, value) {
            headers.set(name, value);
        },
    });
    (0, test_1.expect)(headers.get("Cache-Control")).toBe("no-store");
    (0, test_1.expect)(headers.get("Pragma")).toBe("no-cache");
    const mapped = (0, internal_otp_1.mapOtpErrorToHttpPayload)(new oracle_otp_service_1.OracleOtpServiceError("oracle_procedure_failed", 502, {
        oracleCode: "ORA-20001",
        message: "safe message",
    }));
    (0, test_1.expect)(mapped.status).toBe(502);
    (0, test_1.expect)(mapped.body).toEqual({
        ok: false,
        reasonCode: "oracle_procedure_failed",
        oracleCode: "ORA-20001",
        message: "safe message",
    });
});
(0, test_1.test)("PL/SQL and SQL keep bind placeholders (no interpolation)", async () => {
    const captured = [];
    const fakeDriver = {
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
    const adapter = (0, oracle_otp_service_1.createOracleOtpAdapter)({
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
    (0, test_1.expect)(captured[0].statement).toBe(oracle_otp_service_1.ORACLE_GENERATE_LOCAL_TOKEN_PLSQL);
    (0, test_1.expect)(captured[0].statement).toContain(":identity");
    (0, test_1.expect)(captured[0].statement).not.toContain("40224679551");
    (0, test_1.expect)(captured[1].statement).toBe(oracle_otp_service_1.ORACLE_LATEST_LOCAL_TOKEN_SQL);
    (0, test_1.expect)(captured[1].statement).toContain(":generatedAfter");
    (0, test_1.expect)(captured[1].statement).not.toContain("40224679551");
});
(0, test_1.test)("connection is closed in success and error paths", async () => {
    let closeCalls = 0;
    let executeCalls = 0;
    const fakeDriver = {
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
    const adapter = (0, oracle_otp_service_1.createOracleOtpAdapter)({
        driverResolver: async () => fakeDriver,
    });
    const runtime = createRuntimeForAdapter();
    await adapter.executeGenerateLocalToken({
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        runtime,
    });
    await (0, test_1.expect)(async () => {
        await adapter.executeLatestLocalTokenQuery({
            identity: "40224679551",
            channel: "ONBOARDINGWEB",
            generatedAfter: new Date(),
            runtime,
        });
    }).rejects.toThrow();
    (0, test_1.expect)(closeCalls).toBe(2);
});
(0, test_1.test)("oracle pool is lazy and reused within the same adapter instance", async () => {
    let createPoolCalls = 0;
    let getConnectionCalls = 0;
    const fakeDriver = {
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
    const adapter = (0, oracle_otp_service_1.createOracleOtpAdapter)({
        driverResolver: async () => fakeDriver,
    });
    (0, test_1.expect)(createPoolCalls).toBe(0);
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
    (0, test_1.expect)(createPoolCalls).toBe(1);
    (0, test_1.expect)(getConnectionCalls).toBe(2);
});
(0, test_1.test)("shared runtime adapter returns same instance across requests", () => {
    const first = (0, oracle_otp_service_1.getSharedOracleOtpAdapter)(createBaseEnv());
    const second = (0, oracle_otp_service_1.getSharedOracleOtpAdapter)(createBaseEnv());
    (0, test_1.expect)(first).toBe(second);
});
(0, test_1.test)("concurrent generate calls do not share bind objects or results", async () => {
    const bindReferences = [];
    const fakeDriver = {
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
    const adapter = (0, oracle_otp_service_1.createOracleOtpAdapter)({
        driverResolver: async () => fakeDriver,
    });
    const baseDeps = {
        env: createBaseEnv(),
        adapter,
        appConfigLoader: async () => createOtpProfileConfig(),
    };
    const [a, b] = await Promise.all([
        (0, oracle_otp_service_1.generateLocalToken)({ identity: "40224679551", channel: "ONBOARDINGWEB", appSlug: "app-a" }, { ...baseDeps, requestIdFactory: () => "req-a" }),
        (0, oracle_otp_service_1.generateLocalToken)({ identity: "40224679552", channel: "ONBOARDINGWEB", appSlug: "app-a" }, { ...baseDeps, requestIdFactory: () => "req-b" }),
    ]);
    (0, test_1.expect)(a.requestId).toBe("req-a");
    (0, test_1.expect)(b.requestId).toBe("req-b");
    (0, test_1.expect)(bindReferences).toHaveLength(2);
    (0, test_1.expect)(bindReferences[0]).not.toBe(bindReferences[1]);
});
(0, test_1.test)("real app config for arquitectura-automatizacion resolves otpProfile strategy oracle_local_token", async () => {
    const { adapter, calls } = createAdapterMock();
    const result = await (0, oracle_otp_service_1.generateLocalToken)({
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        appSlug: "arquitectura-automatizacion",
    }, {
        env: createBaseEnv(),
        adapter,
        requestIdFactory: () => "req-real-config",
    });
    (0, test_1.expect)(result.ok).toBe(true);
    (0, test_1.expect)(calls.generate).toBe(1);
});
(0, test_1.test)("helper bind builders and procedure success criteria are explicit and testable", () => {
    const binds = (0, oracle_otp_service_1.buildGenerateProcedureBinds)({
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        driver: {
            BIND_IN: 1,
            BIND_OUT: 2,
            STRING: 3,
        },
    });
    const queryBinds = (0, oracle_otp_service_1.buildLatestTokenQueryBinds)({
        identity: "40224679551",
        channel: "ONBOARDINGWEB",
        generatedAfter: new Date("2026-08-07T09:00:00.000Z"),
    });
    (0, test_1.expect)(binds.identity.val).toBe("40224679551");
    (0, test_1.expect)(binds.channel.val).toBe("ONBOARDINGWEB");
    (0, test_1.expect)(queryBinds.identity).toBe("40224679551");
    (0, test_1.expect)((0, oracle_otp_service_1.evaluateOracleProcedureOutcome)("", "")).toEqual({ ok: true });
    (0, test_1.expect)((0, oracle_otp_service_1.evaluateOracleProcedureOutcome)("000", "OK")).toEqual({ ok: true });
    (0, test_1.expect)((0, oracle_otp_service_1.evaluateOracleProcedureOutcome)("15", "ERR").ok).toBe(false);
});
(0, test_1.test)("sanitized oracle errors redact secrets from public payloads", () => {
    const sanitized = (0, oracle_otp_service_1.sanitizeOracleMessage)({
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
    (0, test_1.expect)(sanitized).not.toContain("otp_password");
    (0, test_1.expect)(sanitized).not.toContain("redacted-host:1521/service");
    const mapped = (0, internal_otp_1.mapOtpErrorToHttpPayload)(new oracle_otp_service_1.OracleOtpServiceError("oracle_procedure_failed", 502, {
        oracleCode: "ORA-01017",
        message: sanitized,
    }));
    (0, test_1.expect)(mapped.body).not.toHaveProperty("stack");
});
