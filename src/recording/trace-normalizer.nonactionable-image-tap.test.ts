import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import { normalizeEvents } from "./trace-normalizer";
import type { RecordedEvent } from "./session-trace.types";

test("trusted tap on a bare image name stays technical noise without actionable replay evidence", () => {
  const tap: RecordedEvent = {
    seq: 1,
    t: 100,
    kind: "tap",
    interactionId: "pointer-1",
    screenKey: "login-screen",
    target: {
      label: "Decorative icon",
      tag: "img",
      locators: [],
      playwrightRecorderEvidence: {
        kind: "text",
        normalizedName: "Decorative icon",
        targetTag: "img",
        runtimeResolutionRequired: true,
      },
    },
  };

  const [normalized] = normalizeEvents([tap]);
  assert.equal(normalized.kind, "note");
  assert.equal(buildCanonicalInteractions(normalizeEvents([tap])).length, 0);
});
