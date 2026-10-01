import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTrace } from "./session-trace.types";
import { buildHappyPathScenario, distinctiveVisitText } from "./trace-to-scenario";
import { parseStepIntent } from "../discovery/step-intent-parser";

/**
 * Recording 2920301b: three product pages share the title "Más detalles del producto", so every
 * visit ended in the same expected result and nothing proved the right product opened. Each
 * screen_change now carries the texts of its own visit, and the validation step names the option
 * the user pressed when the landing screen shows it -- while the screen title stays the asserted
 * (first quoted) text, so replay and spec check exactly what they checked before.
 */

function tap(seq: number, label: string, screenKey: string) {
  return { seq, t: seq * 100, kind: "tap", screenKey, target: { label, role: "button", locators: [{ strategy: "role", value: `button|${label}`, confidence: 0.95 }] } };
}

function screenChange(seq: number, from: string, to: string, visibleTexts?: string[]) {
  return { seq, t: seq * 100, kind: "screen_change", screenKey: from, toScreenKey: to, ...(visibleTexts ? { visibleTexts } : {}) };
}

function fixture(events: unknown[]): SessionTrace {
  return {
    recordingId: "visit-evidence",
    projectSlug: "kiosko",
    appSlug: "kiosko",
    platform: "web",
    baseUrl: "https://kiosk.test/",
    label: "consultar productos",
    recordingGoal: { declaredGoal: "consultar productos", normalizedGoal: "consultar productos", provenance: "USER_DECLARED", needsReview: false },
    recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: true, includeQaCredentialsInTestRail: false },
    startedAt: "2026-09-30T10:00:00.000Z",
    status: "stopped",
    events,
    // The screen record keeps the LAST visit only -- the bug this fixes.
    screens: [
      { screenKey: "catalog", title: "Selecciona un producto", fingerprint: "c", firstSeenAt: 0, controls: [], texts: ["Selecciona un producto"] },
      { screenKey: "detail", title: "Más detalles del producto", fingerprint: "d", firstSeenAt: 1, controls: [], texts: ["Más detalles del producto", "Préstamo Personal", "Beneficios"] },
    ],
  } as unknown as SessionTrace;
}

const TWO_PRODUCTS = [
  tap(1, "Tarjeta Crédito Visa Clásica", "catalog"),
  screenChange(2, "catalog", "detail", ["Más detalles del producto", "Tarjeta Crédito Visa Clásica", "Beneficios"]),
  tap(3, "Volver", "detail"),
  screenChange(4, "detail", "catalog", ["Selecciona un producto"]),
  tap(5, "Préstamo Personal", "catalog"),
  screenChange(6, "catalog", "detail", ["Más detalles del producto", "Préstamo Personal", "Beneficios"]),
];

test("each product visit names its own product, not the last one the screen record kept", () => {
  const scenario = buildHappyPathScenario(fixture(TWO_PRODUCTS), fixture(TWO_PRODUCTS).events);
  const assertions = scenario.testRailSteps.filter((step) => step.classification === "FUNCTIONAL_ASSERTION").map((step) => step.expected);
  assert.deepEqual(assertions, [
    'Se muestra "Más detalles del producto" con "Tarjeta Crédito Visa Clásica"',
    'Se muestra "Selecciona un producto"',
    'Se muestra "Más detalles del producto" con "Préstamo Personal"',
  ]);
});

test("the screen title stays the asserted text for replay and spec", () => {
  const scenario = buildHappyPathScenario(fixture(TWO_PRODUCTS), fixture(TWO_PRODUCTS).events);
  const step = scenario.testRailSteps.find((candidate) => candidate.expected?.includes("Préstamo Personal"))!;
  const intent = parseStepIntent(step.expected!).find((candidate) => candidate.type === "assertion");
  assert.equal(intent?.actionTarget, "Más detalles del producto");
  // Click steps keep an empty expected result: its quoted text would become the click target.
  assert.ok(scenario.testRailSteps.filter((candidate) => candidate.content.startsWith("Presionar")).every((candidate) => !candidate.expected));
});

test("no evidence, no claim: older recordings, unnamed controls and texts that do not show the option", () => {
  const legacy = [tap(1, "Préstamo Personal", "catalog"), screenChange(2, "catalog", "detail")];
  assert.equal(distinctiveVisitText(legacy as never, 1, "Más detalles del producto"), undefined);

  const unnamed = [tap(1, "control", "catalog"), screenChange(2, "catalog", "detail", ["Más detalles del producto", "control"])];
  assert.equal(distinctiveVisitText(unnamed as never, 1, "Más detalles del producto"), undefined);

  const notShown = [tap(1, "Cuentas", "catalog"), screenChange(2, "catalog", "detail", ["Más detalles del producto", "Beneficios"])];
  assert.equal(distinctiveVisitText(notShown as never, 1, "Más detalles del producto"), undefined);

  // The option that opened the PREVIOUS screen is not this visit's cause.
  const earlier = [tap(1, "Préstamo Personal", "catalog"), screenChange(2, "catalog", "detail", ["Préstamo Personal"]), screenChange(3, "detail", "catalog", ["Préstamo Personal"])];
  assert.equal(distinctiveVisitText(earlier as never, 2, "Selecciona un producto"), undefined);

  // Matching ignores accents and case, and returns the text as the screen shows it.
  const accents = [tap(1, "Prestamo personal", "catalog"), screenChange(2, "catalog", "detail", ["Préstamo Personal"])];
  assert.equal(distinctiveVisitText(accents as never, 1, "Más detalles del producto"), "Préstamo Personal");
});
