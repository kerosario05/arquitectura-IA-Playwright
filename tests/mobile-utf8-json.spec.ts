import { expect, test } from "@playwright/test";
import type { Request } from "express";
import { mobileUtf8JsonReconciler, reconcileMobileJsonBodyUtf8 } from "../src/server/middleware/mobile-utf8-json";

function toMojibake(value: string): string {
  return Buffer.from(value, "utf8").toString("latin1");
}

test("reconcileMobileJsonBodyUtf8 restores raw UTF-8 payload over mojibake-parsed body", () => {
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
  } as unknown as Request;

  const result = reconcileMobileJsonBodyUtf8(req);

  expect(result.status).toBe("replaced");
  const targetValue = ((req as unknown as { body: typeof rawPayload }).body.scenarios[0].steps[0].target.value);
  expect(targetValue).toBe(original);
});

test("reconcileMobileJsonBodyUtf8 is idempotent for already-valid Unicode payloads", () => {
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
  } as unknown as Request;

  const first = reconcileMobileJsonBodyUtf8(req);
  const second = reconcileMobileJsonBodyUtf8(req);

  expect(first.status).toBe("unchanged");
  expect(second.status).toBe("unchanged");
  const targetValue = ((req as unknown as { body: typeof payload }).body.scenarios[0].steps[0].target.value);
  expect(targetValue).toBe(original);
});

test("mobileUtf8JsonReconciler rejects malformed UTF-8 JSON for mobile endpoints", () => {
  const middleware = mobileUtf8JsonReconciler();
  const req = {
    path: "/api/mobile/runs/execute",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {},
    rawJsonBodyBuffer: Buffer.from("{\"scenarios\":", "utf8"),
  } as unknown as Request;
  let statusCode = 0;
  let payload: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    },
  } as unknown as {
    status: (code: number) => { json: (body: unknown) => unknown };
    json: (body: unknown) => unknown;
  };
  let nextCalled = false;

  middleware(req, res as never, () => {
    nextCalled = true;
  });

  expect(nextCalled).toBe(false);
  expect(statusCode).toBe(400);
  expect((payload as { error?: string }).error).toBe("mobile_text_encoding_invalid");
});
