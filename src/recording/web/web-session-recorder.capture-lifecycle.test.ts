import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Physical evidence (new "Login" recording): the user physically reached the post-login screen
 * (screen 9b3ed654dc84), and a SEPARATE Node-side instrumentation
 * (`extractRuntimeUiSnapshot`/runtime-knowledge-extractor.ts) independently observed 29-30 clicks
 * and real inputs there via Playwright's own live page access — proving the browser/page/context
 * were still fully alive and reachable — yet the derived scenario contained only
 * "Abrir aplicación" + "Presionar Iniciar sesión": zero of those post-login interactions ever
 * reached `RawInteraction`/the trace.
 *
 * The ticket's own hypothesis ("if CAPTURE_SCRIPT installs only via page.evaluate, a full
 * navigation destroys its listeners") does NOT hold: `WebSessionRecorder.start()` already uses
 * `context.exposeBinding` (context-scoped, persists for the context's lifetime, survives
 * navigation) and `context.addInitScript` (Playwright-guaranteed to reinstall on every new
 * document in every page of the context, including after a full top-level navigation) — never
 * `page.evaluate` alone. That install mechanism was already correct.
 *
 * The residual risk `addInitScript` does not fully close is a race on a FAST redirect/full
 * navigation: the registration can occasionally not have fully propagated to the new document
 * before that document's own bootstrap script runs, silently leaving CAPTURE_SCRIPT
 * uninstalled with no visible error (its own `send()` already swallows "binding not ready"
 * errors). Fixed with a defensive, idempotent re-evaluation of the SAME CAPTURE_SCRIPT content
 * on every `framenavigated` event (main frame only) — CAPTURE_SCRIPT's own pre-existing
 * `window.__qaRecorderInstalledV1` guard makes this a genuine no-op whenever `addInitScript`
 * already did its job, so no listener is ever installed twice on the same document, and the
 * exposed binding itself needs no re-registration (context-scoped, not document-scoped).
 *
 * `WebSessionRecorder.start()` launches a real Chromium/Firefox/WebKit browser and cannot be
 * exercised without one (explicitly out of scope for this ticket's own "NO browser"
 * constraint) — these tests instead statically verify the two structural properties that matter
 * and are otherwise silently easy to let drift apart in a future edit: (1) the navigation
 * handler re-evaluates the EXACT SAME script content `addInitScript` was given (no risk of the
 * safety net silently diverging from the primary install), and (2) the pre-existing
 * `window.__qaRecorderInstalledV1` idempotency guard that makes the safety net safe is still
 * present in CAPTURE_SCRIPT.
 */

const SOURCE = fs.readFileSync(path.join(__dirname, "web-session-recorder.ts"), "utf8");

test("1/2/3. the safety-net re-injection is wired to the exact same script content addInitScript already uses (no drift risk between the two install sites)", () => {
  assert.match(SOURCE, /const captureScriptContent = `window\.__qaRecorderPersistQaCredentials = true;\\n\$\{CAPTURE_SCRIPT\}`;/);
  assert.match(SOURCE, /await this\.context\.addInitScript\(\{\s*\n\s*content: captureScriptContent,/);
  assert.match(SOURCE, /frame\.evaluate\(captureScriptContent\)/, "the framenavigated handler must re-evaluate the SAME content addInitScript registered, never a separately-built string");
});

test("4. the legacy __qaRecord binding is registered once, at context scope, never inside the per-navigation handler (no re-registration needed or attempted)", () => {
  // CaptureEngine V2 (a separate, disconnected shadow bridge -- see
  // web-session-recorder.v2-shadow-integration.test.ts) registers its OWN, distinctly-named
  // "__qaRecordV2" binding, so the total exposeBinding call count is no longer a valid proxy for
  // "the legacy binding is registered exactly once" -- assert on the legacy binding specifically.
  const legacyBindingOccurrences = SOURCE.match(/this\.context\.exposeBinding\(\s*"__qaRecord"/g) ?? [];
  assert.equal(legacyBindingOccurrences.length, 1, "the legacy __qaRecord binding must be registered exactly once, for the whole context's lifetime");
});

test("8/9. the idempotency guard the safety net depends on is still present and unconditional in CAPTURE_SCRIPT", () => {
  assert.match(SOURCE, /if \(window\.__qaRecorderInstalledV1\) return;/);
  assert.match(SOURCE, /window\.__qaRecorderInstalledV1 = true;/);
});

test("the navigation-triggered re-evaluation failure is swallowed, never thrown into the framenavigated handler (a stale/detached frame must not crash the recorder)", () => {
  assert.match(SOURCE, /frame\.evaluate\(captureScriptContent\)\.catch\(\(\) => undefined\);/);
});
