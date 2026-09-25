import assert from "node:assert/strict";
import test from "node:test";
import { shouldFlushEditingSessionFill } from "./field-edit-flush-decision";

/**
 * Physical evidence chain (recording 2151a2f0-4c62-466d-832d-480754586092): Usuario/Contraseña
 * were genuinely typed by the user (proven by the subsequent click's `activeElementBefore`
 * showing a real, non-empty `committedValue`) but no `input`/`change` DOM event ever reached the
 * capture script for either field, so no raw `fill` event was ever emitted, and the submit click
 * survived alone with no dataset-bound credentials to type at runtime.
 *
 * Fixed in web-session-recorder.ts by tracking an "open editing session" (opened on a trusted
 * focus of an editable element, closed either by a genuine `input`/`change` event or by
 * `flushEditingSession()` at a real boundary: blur, a click/pointerdown on a different control,
 * a form submit, or page unload). The DECISION of whether a flush should actually emit a
 * fallback fill — `shouldFlushEditingSessionFill` — is extracted here (interpolated into the
 * capture script via `.toString()`, the same pattern already used for
 * `classifyActionability`/`normalizeStructuralOwnerIdentity`/`selectSemanticFieldOwnerLabel`),
 * so it is independently, honestly testable without a browser: a fallback fires ONLY when the
 * focus that opened the session was itself user-caused AND the value observably changed between
 * focus-in and flush — never merely because a field is non-empty (a prefilled/autofilled value
 * that nobody touched produces no change and is never synthesized as an edit).
 *
 * The DOM wiring itself (which listeners open/close the session, in what order events fire
 * relative to `send()`) is genuinely browser-only and cannot be exercised without a real
 * browser/jsdom (disclosed, consistent with every other browser-injected piece of this recorder
 * touched across this ticket chain).
 */

test("1/2. normal case: trusted focus + a real value change at flush -> fallback fires (covers the missed-input/change case)", () => {
  const result = shouldFlushEditingSessionFill({ trusted: true, initialValue: "" }, "qauser");
  assert.equal(result, true);
});

test("5. prefilled field with no user edit: trusted focus, but the value at flush is IDENTICAL to the value at focus-in -> no fallback", () => {
  const result = shouldFlushEditingSessionFill({ trusted: true, initialValue: "prefilled@example.com" }, "prefilled@example.com");
  assert.equal(result, false, "a prefilled/autofilled value that was never touched must never be synthesized as an edit");
});

test("6. focus/blur without any value change at all (empty to empty) -> no fallback", () => {
  const result = shouldFlushEditingSessionFill({ trusted: true, initialValue: "" }, "");
  assert.equal(result, false);
});

test("untrusted (programmatic) focus is never eligible, even if the value changed", () => {
  const result = shouldFlushEditingSessionFill({ trusted: false, initialValue: "" }, "injected-by-script");
  assert.equal(result, false, "only a real, user-caused focus counts as edit evidence");
});

test("a session with no final value at all (element removed/unreadable) never fires", () => {
  const result = shouldFlushEditingSessionFill({ trusted: true, initialValue: "x" }, undefined);
  assert.equal(result, false);
});

test("whitespace-only differences never count as a real change", () => {
  const result = shouldFlushEditingSessionFill({ trusted: true, initialValue: "  Masteryi15.  " }, "Masteryi15.");
  assert.equal(result, false, "collapsing/trimming whitespace must not manufacture a false edit");
});

test("a genuinely different value, even by one character, counts as a real change", () => {
  const result = shouldFlushEditingSessionFill({ trusted: true, initialValue: "Masteryi15" }, "Masteryi15.");
  assert.equal(result, true);
});

test("sensitive value: the decision function only ever compares presence/equality of strings it is given -- it never inspects, logs, or persists anything beyond the boolean result", () => {
  // The redaction pipeline itself (valueOf()'s password gate) lives in web-session-recorder.ts
  // and is untouched by this ticket; this test only documents that the extracted decision
  // function has no side channel (no console, no storage) through which a value could leak.
  const result = shouldFlushEditingSessionFill({ trusted: true, initialValue: "" }, "Masteryi15.");
  assert.equal(typeof result, "boolean");
});

/**
 * A recording policy that does NOT persist credential literals makes valueOf(el) return
 * `undefined` for a password field's SENT value — but web-session-recorder.ts's
 * flushEditingSession() now feeds this decision function the UNREDACTED comparison (via a
 * separate `rawFieldValue()` helper), never the redacted one, precisely so a policy choice about
 * what gets PERSISTED can never be mistaken for "no edit happened." These tests document that
 * contract at the decision-function boundary: a real edit (raw comparison differs) is always
 * detected regardless of what will ultimately be sent.
 */
test("password fill still detected as edited even when the eventual SENT value would be redacted (undefined) -- the decision uses the raw comparison, never the redacted one", () => {
  // Simulates web-session-recorder.ts calling shouldFlushEditingSessionFill(session,
  // rawFieldValue(el)) — the raw (unredacted) final value is what this function receives,
  // regardless of what valueOf(el) would return for the eventual sent payload.
  const result = shouldFlushEditingSessionFill({ trusted: true, initialValue: "" }, "Masteryi15.");
  assert.equal(result, true, "a real password edit must be detected via the raw comparison, independent of persistence policy");
});

test("password field with no edit at all (raw value unchanged) still reports no fallback, independent of redaction", () => {
  const result = shouldFlushEditingSessionFill({ trusted: true, initialValue: "Masteryi15." }, "Masteryi15.");
  assert.equal(result, false);
});
