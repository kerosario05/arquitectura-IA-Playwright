import assert from "node:assert/strict";
import test from "node:test";
import { detectHomeResetOrInactivity } from "./promoted-spec-runtime";

/**
 * FIRST_LOSS fix (recordingId=1f9415f3-...): physical evidence showed a promoted click's
 * post-click stability check correctly return `no_observable_post_action_outcome` (nothing DID
 * observably change), while the page's own text content already showed a session-timeout
 * WARNING dialog ("Sesión a punto de Expirar" / "Su sesión alcanzó el límite máximo") that had
 * appeared BEFORE that click. `detectHomeResetOrInactivity` already existed to reclassify this
 * kind of session-lifecycle precondition into the more actionable `session_reset_unrecoverable`
 * path instead of an undifferentiated click failure -- but its patterns only covered the AFTER-
 * reset stage (already back at the home screen), never this EARLIER, still-on-the-same-screen
 * warning stage. Generic across any project: matched only by the common "session about to
 * expire" concept, in Spanish and English, never by any Fenix/Santa Cruz-specific text.
 */

function fakePageWithTexts(texts: string[], currentUrl = "https://host/onlinebanking/IdentifyUser"): any {
  return {
    context: () => ({}),
    isClosed: () => false,
    url: () => currentUrl,
    title: async () => "",
    evaluate: async () => texts,
    locator: () => ({
      all: async () => [],
      filter() { return this; },
      count: async () => 0,
    }),
  };
}

test("1/sessionExpiringWarningDetected. the physical warning text (session about to expire, reached time limit) is recognized as a session precondition, never the generic 'no reset detected' fall-through", async () => {
  const page = fakePageWithTexts([
    "Cerrar",
    "Sesión a punto de Expirar",
    "Su sesión alcanzó el límite máximo",
    "Por seguridad, su sesión llegó al tiempo máximo permitido y será cerrada en",
  ]);
  const result = await detectHomeResetOrInactivity(page);
  assert.equal(result.detected, true);
  assert.equal(result.reason, "session_expiring_warning");
});

test("2/englishPhrasingAlsoDetected. the same generic concept in English is recognized -- never a Spanish-only/app-specific literal match", async () => {
  const page = fakePageWithTexts(["Your session is about to expire"]);
  const result = await detectHomeResetOrInactivity(page);
  assert.equal(result.detected, true);
  assert.equal(result.reason, "session_expiring_warning");
});

test("3/unrelatedTextNeverFalsePositives. ordinary page text (no session/inactivity concept at all) is never misclassified as a session precondition", async () => {
  const page = fakePageWithTexts(["Bienvenido", "Consultar saldo", "Continuar"]);
  const result = await detectHomeResetOrInactivity(page);
  assert.equal(result.detected, false);
});

test("4/priorAfterResetPatternsStillWin. the pre-existing already-reset inactivity pattern still classifies as 'inactivity_message', never demoted by the new warning pattern", async () => {
  const page = fakePageWithTexts(["Su sesión se cerró por inactividad"]);
  const result = await detectHomeResetOrInactivity(page);
  assert.equal(result.detected, true);
  assert.equal(result.reason, "inactivity_message");
});

test("5/noAppSpecificHardcode. the new pattern source contains no Fenix/Santa Cruz-specific literal text", async () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const source = fs.readFileSync(path.resolve(__dirname, "promoted-spec-runtime.ts"), "utf8");
  const start = source.indexOf("const sessionExpiringWarningPatterns");
  const end = source.indexOf("const hasInactivityMessage", start);
  const region = source.slice(start, end);
  assert.doesNotMatch(region, /fenix|santa\s*cruz|logonenterprise|identifyuser/i);
});
