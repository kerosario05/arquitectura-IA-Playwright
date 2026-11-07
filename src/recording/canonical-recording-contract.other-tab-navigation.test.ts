import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import type { RecordedEvent } from "./session-trace.types";

const base = { screenKey: "s1", fingerprint: "f", url: "http://a.test/#/p?tab=flujo", pageKey: "tab-1" };
const events = [
  { ...base, t: 100, kind: "note", seq: 1, interactionId: "pointer-1", observationType: "pointer", target: { label: "Enviar", role: "button", tag: "button", locators: [] } },
  { ...base, t: 150, kind: "tap", seq: 2, interactionId: "pointer-1", target: { label: "Enviar", role: "button", tag: "button", locators: [{ strategy: "role", value: "button|Enviar", confidence: 0.85 }] } },
  { ...base, t: 5000, kind: "navigate", seq: 3, url: "http://b.test/", pageKey: "tab-2", opensNewPage: true, directUserNavigation: true },
] as unknown as RecordedEvent[];

test("a tab opened after a click is not that click's route transition", () => {
  const click = buildCanonicalInteractions(events).find((interaction) => interaction.action === "click");
  assert.ok(click);
  assert.notEqual(click.routeAfter, "http://b.test/");
});
