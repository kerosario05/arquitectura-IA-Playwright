"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureRawJsonBody = captureRawJsonBody;
exports.reconcileMobileJsonBodyUtf8 = reconcileMobileJsonBodyUtf8;
exports.mobileUtf8JsonReconciler = mobileUtf8JsonReconciler;
function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
function safeJsonStringify(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return "__non_json_value__";
    }
}
function captureRawJsonBody(req, _res, buf) {
    if (!buf || buf.length === 0)
        return;
    req.rawJsonBodyBuffer = Buffer.from(buf);
}
function reconcileMobileJsonBodyUtf8(req) {
    const rawBody = req.rawJsonBodyBuffer;
    if (!rawBody || rawBody.length === 0)
        return { status: "missing_raw_body" };
    let parsedUtf8;
    try {
        parsedUtf8 = JSON.parse(stripBom(rawBody.toString("utf8")));
    }
    catch (err) {
        return {
            status: "invalid_utf8_json",
            errorMessage: err instanceof Error ? err.message : String(err),
        };
    }
    const parsedByBodyParser = req.body;
    if (safeJsonStringify(parsedByBodyParser) !== safeJsonStringify(parsedUtf8)) {
        req.body = parsedUtf8;
        return { status: "replaced" };
    }
    return { status: "unchanged" };
}
function isJsonMutationCandidate(req) {
    if (!req.path.startsWith("/api/mobile/"))
        return false;
    if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH")
        return false;
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    return contentType.includes("application/json");
}
function mobileUtf8JsonReconciler() {
    return (req, res, next) => {
        if (!isJsonMutationCandidate(req)) {
            next();
            return;
        }
        const reconcile = reconcileMobileJsonBodyUtf8(req);
        if (reconcile.status === "invalid_utf8_json") {
            res.status(400).json({
                ok: false,
                error: "mobile_text_encoding_invalid",
                message: `mobile_text_encoding_invalid: request body is not valid UTF-8 JSON (${reconcile.errorMessage})`,
            });
            return;
        }
        if (reconcile.status === "replaced") {
            console.warn(`[mobile:utf8] request body re-parsed from raw UTF-8 payload path=${req.path}`);
        }
        next();
    };
}
