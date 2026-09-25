"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.internalOtpRouter = void 0;
exports.applyOtpNoStoreHeaders = applyOtpNoStoreHeaders;
exports.requireOtpInternalAuth = requireOtpInternalAuth;
exports.mapOtpErrorToHttpPayload = mapOtpErrorToHttpPayload;
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = require("express");
const oracle_otp_service_1 = require("../services/oracle-otp-service");
exports.internalOtpRouter = (0, express_1.Router)();
function applyOtpNoStoreHeaders(res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
}
function normalizeHeaderValue(value) {
    if (Array.isArray(value)) {
        return (value[0] ?? "").trim();
    }
    return (value ?? "").trim();
}
function secureEquals(expected, actual) {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    if (expectedBuffer.length !== actualBuffer.length)
        return false;
    return node_crypto_1.default.timingSafeEqual(expectedBuffer, actualBuffer);
}
function emitOtpAuthDiagnostic(env, payload) {
    if ((env.ORACLE_OTP_AUTH_DEBUG ?? "").trim().toLowerCase() !== "true") {
        return;
    }
    console.info(`[internal-otp-auth] mechanism=${payload.mechanism} expectedLength=${payload.expectedLength} headerPresent=${payload.headerPresent} providedLength=${payload.providedLength} comparisonMatched=${payload.comparisonMatched}`);
}
function requireOtpInternalAuth(headers, env) {
    const runtime = (0, oracle_otp_service_1.resolveOracleOtpRuntimeConfig)(env);
    const requestKey = (runtime.requestKey ?? "").trim();
    if (!requestKey) {
        throw new oracle_otp_service_1.OracleOtpServiceError("otp_endpoint_not_allowed", 403, {
            message: "ORACLE_OTP_REQUEST_KEY is required for internal OTP endpoints.",
        });
    }
    const providedAutomationKey = normalizeHeaderValue(headers["x-automation-key"]);
    const comparisonMatched = Boolean(providedAutomationKey) && secureEquals(requestKey, providedAutomationKey);
    emitOtpAuthDiagnostic(env, {
        mechanism: "ORACLE_OTP_REQUEST_KEY",
        expectedLength: requestKey.length,
        headerPresent: Boolean(providedAutomationKey),
        providedLength: providedAutomationKey.length,
        comparisonMatched,
    });
    if (!comparisonMatched) {
        throw new oracle_otp_service_1.OracleOtpServiceError("invalid_internal_auth", 401, {
            message: "invalid internal automation key",
        });
    }
}
function mapOtpErrorToHttpPayload(err) {
    if (!(err instanceof oracle_otp_service_1.OracleOtpServiceError)) {
        return {
            status: 503,
            body: { ok: false, reasonCode: "oracle_unavailable" },
        };
    }
    if (err.reasonCode === "rate_limited") {
        return {
            status: 429,
            body: {
                ok: false,
                reasonCode: "rate_limited",
            },
            retryAfterSeconds: err.details?.retryAfterSeconds,
        };
    }
    if (err.reasonCode === "oracle_procedure_failed") {
        return {
            status: 502,
            body: {
                ok: false,
                reasonCode: "oracle_procedure_failed",
                ...(err.details?.oracleCode ? { oracleCode: err.details.oracleCode } : {}),
                ...(err.details?.message ? { message: err.details.message } : {}),
            },
        };
    }
    if (err.reasonCode === "invalid_request") {
        return { status: 400, body: { ok: false, reasonCode: "invalid_request" } };
    }
    if (err.reasonCode === "invalid_internal_auth") {
        return { status: 401, body: { ok: false, reasonCode: "invalid_internal_auth" } };
    }
    if (err.reasonCode === "otp_endpoint_not_allowed") {
        return { status: 403, body: { ok: false, reasonCode: "otp_endpoint_not_allowed" } };
    }
    if (err.reasonCode === "otp_not_found") {
        return { status: 404, body: { ok: false, reasonCode: "otp_not_found" } };
    }
    if (err.reasonCode === "otp_invalid_format") {
        return { status: 502, body: { ok: false, reasonCode: "otp_invalid_format" } };
    }
    if (err.reasonCode === "oracle_unavailable") {
        return { status: 503, body: { ok: false, reasonCode: "oracle_unavailable" } };
    }
    return { status: err.httpStatus, body: { ok: false, reasonCode: err.reasonCode } };
}
exports.internalOtpRouter.use((req, res, next) => {
    applyOtpNoStoreHeaders(res);
    try {
        requireOtpInternalAuth(req.headers, process.env);
        next();
    }
    catch (err) {
        const mapped = mapOtpErrorToHttpPayload(err);
        if (mapped.retryAfterSeconds && mapped.retryAfterSeconds > 0) {
            res.setHeader("Retry-After", String(mapped.retryAfterSeconds));
        }
        res.status(mapped.status).json(mapped.body);
    }
});
exports.internalOtpRouter.post("/local-token/generate", async (req, res) => {
    applyOtpNoStoreHeaders(res);
    try {
        const body = (req.body ?? {});
        const result = await (0, oracle_otp_service_1.generateLocalToken)({
            identity: typeof body.identity === "string" ? body.identity : "",
            channel: typeof body.channel === "string" ? body.channel : "",
            appSlug: typeof body.appSlug === "string" ? body.appSlug : "",
        });
        res.status(200).json(result);
    }
    catch (err) {
        const mapped = mapOtpErrorToHttpPayload(err);
        if (mapped.retryAfterSeconds && mapped.retryAfterSeconds > 0) {
            res.setHeader("Retry-After", String(mapped.retryAfterSeconds));
        }
        res.status(mapped.status).json(mapped.body);
    }
});
exports.internalOtpRouter.post("/local-token/latest", async (req, res) => {
    applyOtpNoStoreHeaders(res);
    try {
        const body = (req.body ?? {});
        const result = await (0, oracle_otp_service_1.getLatestLocalToken)({
            identity: typeof body.identity === "string" ? body.identity : "",
            channel: typeof body.channel === "string" ? body.channel : "",
            appSlug: typeof body.appSlug === "string" ? body.appSlug : "",
            generatedAfter: typeof body.generatedAfter === "string" ? body.generatedAfter : "",
            requestId: typeof body.requestId === "string" ? body.requestId : undefined,
        });
        res.status(200).json(result);
    }
    catch (err) {
        const mapped = mapOtpErrorToHttpPayload(err);
        if (mapped.retryAfterSeconds && mapped.retryAfterSeconds > 0) {
            res.setHeader("Retry-After", String(mapped.retryAfterSeconds));
        }
        res.status(mapped.status).json(mapped.body);
    }
});
