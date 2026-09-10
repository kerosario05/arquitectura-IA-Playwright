import { strict as assert } from "node:assert";
import test from "node:test";
import { describeInitialNavigationError, safePathname } from "../src/discovery/case-discovery";

test("initial navigation telemetry keeps only a safe pathname", () => {
  assert.equal(safePathname("https://example.test/login?token=secret#top"), "/login");
  assert.equal(safePathname("/dashboard?session=secret", "https://example.test/login"), "/dashboard");
});

test("initial navigation telemetry preserves the original error safely", () => {
  const error = Object.assign(new Error("navigation failed at https://example.test/login?token=secret"), {
    code: "ERR_CERT_AUTHORITY_INVALID"
  });
  const details = describeInitialNavigationError(error);

  assert.equal(details.errorType, "Error");
  assert.equal(details.errorCode, "ERR_CERT_AUTHORITY_INVALID");
  assert.equal(details.errorMessageSafe.includes("token=secret"), false);
  assert.equal(details.errorMessageSafe.includes("<url>"), true);
});
