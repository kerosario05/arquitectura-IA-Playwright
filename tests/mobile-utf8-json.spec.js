"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const mobile_utf8_json_1 = require("../src/server/middleware/mobile-utf8-json");
function toMojibake(value) {
    return Buffer.from(value, "utf8").toString("latin1");
}
(0, test_1.test)("reconcileMobileJsonBodyUtf8 restores raw UTF-8 payload over mojibake-parsed body", () => {
    const original = "¿Aún no tienes usuario o cuenta? áéíóú ñ Ñ ü Ü ¡! € 😀 東京";
    const rawPayload = {
        scenarios: [
            {
                steps: [
                    { action: "click", target: { strategy: "accessibilityId", value: original } },
                ],
            },
        ],
    };
    const parsedBody = {
        scenarios: [
            {
                steps: [
                    { action: "click", target: { strategy: "accessibilityId", value: toMojibake(original) } },
                ],
            },
        ],
    };
    const req = {
        body: parsedBody,
        rawJsonBodyBuffer: Buffer.from(JSON.stringify(rawPayload), "utf8"),
    };
    const result = (0, mobile_utf8_json_1.reconcileMobileJsonBodyUtf8)(req);
    (0, test_1.expect)(result.status).toBe("replaced");
    const targetValue = (req.body.scenarios[0].steps[0].target.value);
    (0, test_1.expect)(targetValue).toBe(original);
});
(0, test_1.test)("reconcileMobileJsonBodyUtf8 is idempotent for already-valid Unicode payloads", () => {
    const original = "¿Aún no tienes usuario o cuenta? 😀";
    const payload = {
        scenarios: [
            {
                steps: [
                    { action: "click", target: { strategy: "accessibilityId", value: original } },
                ],
            },
        ],
    };
    const req = {
        body: payload,
        rawJsonBodyBuffer: Buffer.from(JSON.stringify(payload), "utf8"),
    };
    const first = (0, mobile_utf8_json_1.reconcileMobileJsonBodyUtf8)(req);
    const second = (0, mobile_utf8_json_1.reconcileMobileJsonBodyUtf8)(req);
    (0, test_1.expect)(first.status).toBe("unchanged");
    (0, test_1.expect)(second.status).toBe("unchanged");
    const targetValue = (req.body.scenarios[0].steps[0].target.value);
    (0, test_1.expect)(targetValue).toBe(original);
});
(0, test_1.test)("mobileUtf8JsonReconciler rejects malformed UTF-8 JSON for mobile endpoints", () => {
    const middleware = (0, mobile_utf8_json_1.mobileUtf8JsonReconciler)();
    const req = {
        path: "/api/mobile/runs/execute",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: {},
        rawJsonBodyBuffer: Buffer.from("{\"scenarios\":", "utf8"),
    };
    let statusCode = 0;
    let payload;
    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(body) {
            payload = body;
            return this;
        },
    };
    let nextCalled = false;
    middleware(req, res, () => {
        nextCalled = true;
    });
    (0, test_1.expect)(nextCalled).toBe(false);
    (0, test_1.expect)(statusCode).toBe(400);
    (0, test_1.expect)(payload.error).toBe("mobile_text_encoding_invalid");
});
