import assert from "node:assert/strict";
import test from "node:test";
import { buildSemanticRecordingModel } from "./semantic-recording";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

/**
 * The selection-resolution path in buildSemanticRecordingModel used to coerce an unresolved
 * field into the literal string "Campo pendiente de identificar" as the STORED semanticField —
 * indistinguishable downstream from a genuinely resolved field name, even though needsReview
 * was already (correctly) set alongside it. resolveRecordedField's own fallback branch already
 * kept semanticField null with displayLabel carrying that string for UI/debug only; the
 * selection path now does the same, so nothing downstream can mistake unresolved-fallback text
 * for an admitted, executable field identity.
 */

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-1",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    startedAt: new Date().toISOString(),
    status: "completed",
    events,
    screens: [{ screenKey: "s", url: "/s" } as any],
  } as unknown as SessionTrace;
}

test("an unresolved selection never stores a fabricated semanticField, even though needsReview already flags it", () => {
  const events: RecordedEvent[] = [
    {
      seq: 0,
      t: 100,
      kind: "tap",
      screenKey: "s",
      target: {
        label: "control",
        role: "option",
        locators: [],
        afterValue: "Opción X",
        interactionType: "select",
        // No associatedField/headerContext/containerContext/columnIdentity/placeholder — nothing
        // for resolveRecordedField (or its own associatedField/headerContext fallback) to
        // resolve a durable business field name from; the label itself is generic too.
      },
    } as RecordedEvent,
  ];
  const model = buildSemanticRecordingModel(trace(events), events);
  const dataset = model.datasets.find((d) => d.value === "Opción X");
  assert.ok(dataset, "the selection value must still be recorded");
  assert.equal(dataset!.semanticField, null, "must stay null (never the fabricated 'Campo pendiente de identificar' string) for an unresolved selection");
  assert.equal(dataset!.needsReview, true);
});

test("a resolvable selection still stores its real semantic field, unaffected by the fix", () => {
  const events: RecordedEvent[] = [
    {
      seq: 0,
      t: 100,
      kind: "tap",
      screenKey: "s",
      target: {
        label: "Cuenta A",
        role: "option",
        locators: [],
        afterValue: "Cuenta A",
        interactionType: "select",
        associatedField: "Tipo de cuenta",
      },
    } as RecordedEvent,
  ];
  const model = buildSemanticRecordingModel(trace(events), events);
  const dataset = model.datasets.find((d) => d.value === "Cuenta A");
  assert.ok(dataset);
  assert.equal(dataset!.semanticField, "Tipo de cuenta");
  assert.equal(dataset!.needsReview, false);
});
