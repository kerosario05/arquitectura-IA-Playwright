import type { Request, RequestHandler } from "express";

type RequestWithRawJson = Request & {
  rawJsonBodyBuffer?: Buffer;
};

export type Utf8JsonReconcileResult =
  | { status: "missing_raw_body" | "unchanged" | "replaced" }
  | { status: "invalid_utf8_json"; errorMessage: string };

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "__non_json_value__";
  }
}

export function captureRawJsonBody(req: Request, _res: unknown, buf: Buffer): void {
  if (!buf || buf.length === 0) return;
  (req as RequestWithRawJson).rawJsonBodyBuffer = Buffer.from(buf);
}

export function reconcileMobileJsonBodyUtf8(req: Request): Utf8JsonReconcileResult {
  const rawBody = (req as RequestWithRawJson).rawJsonBodyBuffer;
  if (!rawBody || rawBody.length === 0) return { status: "missing_raw_body" };

  let parsedUtf8: unknown;
  try {
    parsedUtf8 = JSON.parse(stripBom(rawBody.toString("utf8")));
  } catch (err) {
    return {
      status: "invalid_utf8_json",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  const parsedByBodyParser = (req as { body?: unknown }).body;
  if (safeJsonStringify(parsedByBodyParser) !== safeJsonStringify(parsedUtf8)) {
    (req as { body?: unknown }).body = parsedUtf8;
    return { status: "replaced" };
  }
  return { status: "unchanged" };
}

function isJsonMutationCandidate(req: Request): boolean {
  if (!req.path.startsWith("/api/mobile/")) return false;
  if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") return false;
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  return contentType.includes("application/json");
}

export function mobileUtf8JsonReconciler(): RequestHandler {
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
