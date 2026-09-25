import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * CaptureEngine V2 is now wired into `WebSessionRecorder.start()` in SHADOW MODE: it observes
 * real browser events through its own, separate `__qaRecordV2` binding/init script, but must
 * NEVER feed the legacy `RawInteraction`/`onInteraction`/`SessionTrace` pipeline, and a failure
 * in its setup must never stop the legacy recorder from starting.
 *
 * `WebSessionRecorder.start()` launches a real browser and cannot be exercised without one
 * (explicitly out of scope, per every ticket in this chain) -- these are the same kind of
 * disclosed, source-text structural regression guards already used in
 * `web-session-recorder.capture-lifecycle.test.ts` for exactly this reason.
 */

const SOURCE = fs.readFileSync(path.join(__dirname, "web-session-recorder.ts"), "utf8");

test("12a. legacy __qaRecord binding is still registered exactly once, unchanged", () => {
  const occurrences = SOURCE.match(/this\.context\.exposeBinding\(\s*"__qaRecord"/g) ?? [];
  assert.equal(occurrences.length, 1, "the legacy binding must be registered exactly once, exactly as before");
});

test("12b. V2 uses a completely separate binding name, never the legacy one", () => {
  assert.match(SOURCE, /this\.context\.exposeBinding\(\s*"__qaRecordV2"/, "V2 must register its own, distinctly-named binding");
  const v2BindingOccurrences = SOURCE.match(/this\.context\.exposeBinding\(\s*"__qaRecordV2"/g) ?? [];
  assert.equal(v2BindingOccurrences.length, 1);
});

test("12d. V2 binding assigns a stable opaque identity from the real Playwright frame before the bridge validates a document", () => {
  const v2BindingBlockMatch = SOURCE.match(/this\.context\.exposeBinding\(\s*"__qaRecordV2"[\s\S]*?\n\s*\}\);/);
  assert.ok(v2BindingBlockMatch, "the V2 binding registration must exist");
  assert.match(SOURCE, /const v2FrameIds = new WeakMap<object, string>\(\);/);
  assert.match(SOURCE, /frameIdFor\(source\.frame\)/);
  assert.match(v2BindingBlockMatch![0], /v2Shadow\.handleMessage\(\{ \.\.\.message, frameId:/);
});

test("12c. onInteraction remains the only place RawInteraction payloads are handled; V2's binding handler never calls it", () => {
  const legacyBindingBlockMatch = SOURCE.match(/this\.context\.exposeBinding\(\s*"__qaRecord"[\s\S]*?\n\s*\}\);/);
  const v2BindingBlockMatch = SOURCE.match(/this\.context\.exposeBinding\(\s*"__qaRecordV2"[\s\S]*?\n\s*\}\);/);
  assert.ok(legacyBindingBlockMatch && v2BindingBlockMatch, "both binding registrations must exist");
  assert.match(legacyBindingBlockMatch![0], /this\.onInteraction\(/);
  assert.doesNotMatch(v2BindingBlockMatch![0], /this\.onInteraction\(/, "V2's binding handler must never call onInteraction");
});

test("13a. CaptureEngine V2's binding handler never calls pushEvent -- its shadow output cannot reach RecordedEvent/SessionTrace", () => {
  const v2BindingBlockMatch = SOURCE.match(/this\.context\.exposeBinding\(\s*"__qaRecordV2"[\s\S]*?\n\s*\}\);/);
  assert.ok(v2BindingBlockMatch, "the V2 binding registration must exist");
  assert.doesNotMatch(v2BindingBlockMatch![0], /pushEvent/, "V2's binding handler must never call pushEvent");
});

test("13b. the controlled-authority-switch ticket supersedes this test's original premise: adaptCaptureActionToRawInteraction IS now called from the recorder, strictly gated behind captureAuthority===\"v2\"", () => {
  assert.match(SOURCE, /adaptCaptureActionToRawInteraction/, "onV2TechnicalAction legitimately uses this adapter when captureAuthority===\"v2\"");
  const v2BindingBlockMatch = SOURCE.match(/this\.context\.exposeBinding\(\s*"__qaRecordV2"[\s\S]*?\n\s*\}\);/);
  assert.ok(v2BindingBlockMatch);
  // The binding handler itself still never calls onInteraction/the adapter directly -- it only
  // forwards to v2Shadow.handleMessage, which later fires onTechnicalAction synchronously.
  assert.doesNotMatch(v2BindingBlockMatch![0], /adaptCaptureActionToRawInteraction|this\.onInteraction\(/);
});

const V2_SETUP_BLOCK = SOURCE.match(/\/\/ CaptureEngine V2 -- SHADOW ONLY[\s\S]*?this\.page = await this\.context\.newPage\(\);/);

test("14a. V2 setup is wrapped so a failure there cannot prevent the legacy recorder from starting", () => {
  assert.ok(V2_SETUP_BLOCK, "the V2 setup block, wrapped in try/catch, must exist");
  assert.match(V2_SETUP_BLOCK![0], /try \{/);
  assert.match(V2_SETUP_BLOCK![0], /catch \(err\)/);
});

test("14c. authority=v2 failure policy: no automatic mid-session fallback to legacy -- a clear AUTHORITY FAILURE line is logged instead, and captureAuthority is never reassigned", () => {
  assert.ok(V2_SETUP_BLOCK);
  assert.match(V2_SETUP_BLOCK![0], /if \(this\.captureAuthority === "v2"\) \{/);
  assert.match(V2_SETUP_BLOCK![0], /AUTHORITY FAILURE/);
  // captureAuthority is declared `private readonly` and assigned exactly once, in the
  // constructor -- no failure path anywhere may reassign it to "legacy". The lookarounds
  // exclude `===`/`!==` comparisons (e.g. `this.captureAuthority !== "v2"`), counting only a
  // genuine single `=` assignment.
  const captureAuthorityAssignments = SOURCE.match(/(?<!!)this\.captureAuthority\s*=(?!=)/g) ?? [];
  assert.equal(captureAuthorityAssignments.length, 1, "captureAuthority must be assigned exactly once, in the constructor, never as a fallback");
});

test("14b. legacy's own exposeBinding/addInitScript/newPage sequence for __qaRecord and CAPTURE_SCRIPT is untouched and still precedes page creation", () => {
  const legacyOrderMatch = SOURCE.match(
    /this\.context\.exposeBinding\(\s*"__qaRecord"[\s\S]*?await this\.context\.addInitScript\(\{\s*\n\s*content: captureScriptContent,\s*\n\s*\}\);/,
  );
  assert.ok(legacyOrderMatch, "legacy binding + addInitScript(captureScriptContent) sequence must still exist verbatim");
});

test("both the legacy and V2 init scripts are re-evaluated on framenavigated, each guarded by its own, separate idempotency marker", () => {
  assert.match(SOURCE, /window\.__qaRecorderInstalledV1/);
  assert.match(SOURCE, /window\.__qaRecorderV2InstalledV1/);
  assert.match(SOURCE, /frame\.evaluate\(captureScriptContent\)\.catch\(\(\) => undefined\);/);
  assert.match(SOURCE, /frame\.evaluate\(captureScriptV2Content\)\.catch\(\(\) => undefined\);/);
});

/**
 * Observability ticket: a real "LOGIN V2" recording showed zero `[capture-v2]` lines in backend
 * stdout. Traced to `this.log(...)` routing through `options.onLog`, which
 * `session-recording-runner.ts` wires to the job store's SSE stream for the UI, never to the
 * Node process's own stdout. These guards confirm the fix: a `bridge_registered` line on
 * successful V2 setup and a `summary` line on `stop()`, both via DIRECT `console.log` (not just
 * `this.log`), independent of whatever `onLog` wiring the caller uses.
 */
test("15. bridge_registered is logged via direct console.log right after V2 setup succeeds", () => {
  assert.ok(V2_SETUP_BLOCK);
  assert.match(V2_SETUP_BLOCK![0], /console\.log\(`\[capture-v2\] bridge_registered captureInstance=\$\{captureInstanceId\}`\);/);
});

test("16. a shadow setup failure is also logged via direct console.log, not just this.log", () => {
  assert.match(SOURCE, /console\.log\(`\[capture-v2\] shadow setup failed/);
});

test("17. stop() logs a bounded [capture-v2] summary via direct console.log, only when v2Shadow exists, before tearing down the context", () => {
  const stopMethodMatch = SOURCE.match(/async stop\(\)[\s\S]*?\n {2}\}/);
  assert.ok(stopMethodMatch, "stop() method must exist");
  const stopBody = stopMethodMatch![0];
  assert.match(stopBody, /if \(this\.v2Shadow\)/);
  assert.match(stopBody, /getShadowSummary\(\)/);
  assert.match(stopBody, /console\.log\(\s*\n?\s*`\[capture-v2\] summary messages=\$\{summary\.messages\} actions=\$\{summary\.actions\} diagnostics=\$\{summary\.diagnostics\} documents=\$\{summary\.documents\} edits=\$\{edits\} clicks=\$\{clicks\}`/);
  // The summary log must precede context/browser teardown, so it still reflects the completed session.
  const summaryIndex = stopBody.indexOf("[capture-v2] summary");
  const closeIndex = stopBody.indexOf("this.context?.close()");
  assert.ok(summaryIndex >= 0 && closeIndex >= 0 && summaryIndex < closeIndex, "summary must be logged before context teardown");
});

test("18. the stop() summary block never references pushEvent/onInteraction/SessionTrace persistence", () => {
  const stopMethodMatch = SOURCE.match(/async stop\(\)[\s\S]*?\n {2}\}/);
  const v2SummaryBlockMatch = stopMethodMatch![0].match(/if \(this\.v2Shadow\) \{[\s\S]*?\n {4}\}/);
  assert.ok(v2SummaryBlockMatch);
  assert.doesNotMatch(v2SummaryBlockMatch![0], /pushEvent|onInteraction/);
});

/**
 * Controlled authority switch: a recording session has exactly one capture authority
 * ("legacy" | "v2"), resolved once at construction and never reassigned. These guards confirm
 * the switch's structural wiring; the behavioral half (onInteraction actually gets called, in
 * order, exactly once per technical action) is exercised for real, without a browser, in
 * web-session-recorder.authority-switch.test.ts (same `(recorder as any).onInteraction(...)`
 * technique as web-session-recorder.raw-interaction-contract.test.ts).
 */

test("19. captureAuthority now defaults to \"v2\" when the option is omitted -- CaptureEngine V2 is the WEB recorder, not a selectable feature (product decision superseding this test's original premise)", () => {
  assert.match(SOURCE, /this\.captureAuthority = options\.captureAuthority \?\? "v2";/);
});

test("20. the legacy binding is gated: it skips onInteraction entirely unless captureAuthority===\"legacy\"", () => {
  const legacyBindingBlockMatch = SOURCE.match(/this\.context\.exposeBinding\(\s*"__qaRecord"[\s\S]*?\n\s*\}\);/);
  assert.ok(legacyBindingBlockMatch);
  assert.match(legacyBindingBlockMatch![0], /if \(this\.captureAuthority !== "legacy"\) \{/);
});

test("21. stop() drains v2IngestionQueue BEFORE setting stopped=true, so no queued technical action is silently dropped by onInteraction's own stopped guard", () => {
  const stopMethodMatch = SOURCE.match(/async stop\(\)[\s\S]*?\n {2}\}/);
  assert.ok(stopMethodMatch);
  const stopBody = stopMethodMatch![0];
  const drainIndex = stopBody.indexOf("await this.v2IngestionQueue");
  const stoppedIndex = stopBody.indexOf("this.stopped = true;");
  assert.ok(drainIndex >= 0 && stoppedIndex >= 0 && drainIndex < stoppedIndex, "draining v2IngestionQueue must happen before this.stopped is set");
});

test("22. onV2TechnicalAction serializes ingestion through a single promise chain (v2IngestionQueue), never firing onInteraction calls out of order", () => {
  const onV2TechnicalActionMatch = SOURCE.match(/private onV2TechnicalAction\([\s\S]*?\n {2}\}/);
  assert.ok(onV2TechnicalActionMatch);
  assert.match(onV2TechnicalActionMatch![0], /this\.v2IngestionQueue = this\.v2IngestionQueue\.then\(/, "each technical action must chain off the SAME queue, not fire independently");
});
