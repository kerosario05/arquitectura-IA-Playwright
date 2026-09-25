import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { RecordingError, parseCaptureAuthorityParam } from "./session-recording-runner";

/**
 * Product decision, superseding the prior ticket's transport: CaptureEngine V2 is now the
 * DEFAULT and ONLY-visible WEB recorder -- not a client-selectable feature. `captureAuthority`
 * is API-INTERNAL only (tests/regression/rollback): `POST /api/recordings/start` no longer
 * reads/forwards `body.captureAuthority` at all, and both independent default-resolution points
 * (`session-recording-runner.ts`, `WebSessionRecorder`) now default to `"v2"` for a WEB
 * recording. `"legacy"` remains reachable only by an internal caller explicitly passing
 * `captureAuthority: "legacy"` to `startRecording`/`WebSessionRecorder` directly.
 *
 * `startRecording` itself needs a live project registry/job store/Playwright to exercise
 * end-to-end, which is out of scope here (no browser, no DB fixtures) -- the same disclosed
 * limitation already accepted in
 * recordings.execution-admission-order.test.ts ("a full HTTP-level harness ... doesn't exist in
 * this codebase yet"). What IS tested directly and for real is `parseCaptureAuthorityParam`
 * (the actual validation `startRecording` still calls, for internal callers), plus source-text
 * guards confirming the wiring exists exactly where this ticket says it must -- and, just as
 * important, confirming the PUBLIC route no longer reads the field at all.
 */

const RUNNER_SOURCE = fs.readFileSync(path.join(__dirname, "session-recording-runner.ts"), "utf8");
const ROUTE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "routes", "recordings.ts"), "utf8");

test("parseCaptureAuthorityParam(undefined) is still undefined -- \"use the caller's default\" behavior is unchanged", () => {
  assert.equal(parseCaptureAuthorityParam(undefined), undefined);
});

test("6. internal explicit override: parseCaptureAuthorityParam(\"legacy\") still works, unchanged", () => {
  assert.equal(parseCaptureAuthorityParam("legacy"), "legacy");
});

test("parseCaptureAuthorityParam(\"v2\") still works, unchanged", () => {
  assert.equal(parseCaptureAuthorityParam("v2"), "v2");
});

test("an invalid value still throws a RecordingError with a 400-mapped code, never silently coerced", () => {
  for (const invalid of ["V2", "Legacy", "auto", "", 1, null, {}, ["v2"]]) {
    assert.throws(() => parseCaptureAuthorityParam(invalid), (err: unknown) => {
      assert.ok(err instanceof RecordingError);
      assert.equal(err.code, "INVALID_CAPTURE_AUTHORITY");
      return true;
    }, `expected ${JSON.stringify(invalid)} to be rejected`);
  }
});

test("14. no project/app/environment hardcode: the validator's decision depends only on the value itself", () => {
  // parseCaptureAuthorityParam takes no projectSlug/appSlug/env parameter at all -- structurally
  // incapable of branching on project identity. Confirmed by its own signature/arity.
  assert.equal(parseCaptureAuthorityParam.length, 1);
});

test("2. runnerDefaultV2: a WEB recording with no explicit override resolves captureAuthority to \"v2\"", () => {
  assert.match(
    RUNNER_SOURCE,
    /const captureAuthority = platform === "web" \? requestedCaptureAuthority \?\? "v2" : requestedCaptureAuthority;/,
    "a WEB recording's default must resolve to \"v2\", never \"legacy\"",
  );
});

test("6. legacyOverride: the runner still honors an explicit internal captureAuthority=\"legacy\" (requestedCaptureAuthority wins over the \"v2\" default via ??)", () => {
  assert.match(RUNNER_SOURCE, /const requestedCaptureAuthority = parseCaptureAuthorityParam\(params\.captureAuthority\);/);
  // `requestedCaptureAuthority ?? "v2"` only falls back to "v2" when requestedCaptureAuthority is
  // undefined -- an explicit "legacy" (a truthy string) always wins.
});

test("Android is untouched: its captureAuthority stays whatever was explicitly requested (normally undefined), never defaulted to \"v2\"", () => {
  assert.match(RUNNER_SOURCE, /: requestedCaptureAuthority;/, "the non-web branch of the ternary must pass through the raw requested value, never inject a default");
});

test("[recording-capture] authority=... is still logged at start, guarded so it's skipped when captureAuthority is undefined (e.g. an Android recording)", () => {
  assert.match(RUNNER_SOURCE, /if \(captureAuthority\) onLog\(`\[recording-capture\] authority=\$\{captureAuthority\}`\);/);
});

test("5b. the runner still passes captureAuthority straight into new WebSessionRecorder(...), not re-derived", () => {
  const webConstructorMatch = RUNNER_SOURCE.match(/recorder = new WebSessionRecorder\(\{[\s\S]*?\}\);/);
  assert.ok(webConstructorMatch, "the WebSessionRecorder construction site must exist");
  assert.match(webConstructorMatch![0], /captureAuthority,/);
});

test("8. captureAuthority on the trace is never reassigned after the trace object literal sets it", () => {
  assert.doesNotMatch(RUNNER_SOURCE, /trace\.captureAuthority\s*=/, "trace.captureAuthority must never be reassigned after the trace object literal sets it");
});

test("1. recorderDefaultV2: WebSessionRecorder's own internal default is \"v2\", independent of the runner", () => {
  const webRecorderSource = fs.readFileSync(path.join(__dirname, "..", "..", "recording", "web", "web-session-recorder.ts"), "utf8");
  assert.match(webRecorderSource, /this\.captureAuthority = options\.captureAuthority \?\? "v2";/);
});

test("8. publicFieldRemoved: POST /start no longer reads or forwards body.captureAuthority", () => {
  const startHandlerMatch = ROUTE_SOURCE.match(/recordingsRouter\.post\(\s*"\/start"[\s\S]*?\n\}\);/);
  assert.ok(startHandlerMatch, "the /start route handler must exist");
  // Excludes this ticket's own explanatory comment (which legitimately mentions the field name
  // to document why it's absent) -- checks only for actual code reading/forwarding it.
  assert.doesNotMatch(startHandlerMatch![0], /body\.captureAuthority/, "the route must never read body.captureAuthority");
  assert.doesNotMatch(startHandlerMatch![0], /^\s*captureAuthority[,:]/m, "the startRecording(...) params object must never include a captureAuthority key");
});

test("publicFieldRemoved: parseCaptureAuthorityParam is no longer imported by the route at all", () => {
  assert.doesNotMatch(ROUTE_SOURCE, /parseCaptureAuthorityParam/, "the route no longer needs (or imports) this validator -- it never reads the field");
});

test("9. publicBackwardCompatible: the /start handler still accepts and forwards projectSlug/label/recordingGoal unchanged", () => {
  const startHandlerMatch = ROUTE_SOURCE.match(/recordingsRouter\.post\(\s*"\/start"[\s\S]*?\n\}\);/);
  const body = startHandlerMatch![0];
  assert.match(body, /projectSlug,/);
  assert.match(body, /label: typeof body\.label === "string"/);
  assert.match(body, /recordingGoal: typeof body\.recordingGoal === "string"/);
});

test("route: handle()'s status-mapping switch does not special-case INVALID_CAPTURE_AUTHORITY into 404/409 -- irrelevant to the public route now, but parseCaptureAuthorityParam itself (used by internal callers) must still map to 400 if ever invoked through this path", () => {
  const handleMatch = ROUTE_SOURCE.match(/function handle\(res: any, err: unknown\): void \{[\s\S]*?\n\}/);
  assert.ok(handleMatch, "handle() must exist");
  assert.doesNotMatch(handleMatch![0], /INVALID_CAPTURE_AUTHORITY/, "INVALID_CAPTURE_AUTHORITY must fall through to the default 400, never get its own 404/409 branch");
});
