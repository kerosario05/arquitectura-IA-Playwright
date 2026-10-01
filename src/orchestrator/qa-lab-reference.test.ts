import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseQaLabReference, qaLabReferenceError } from "./qa-lab-reference";

describe("QA Lab reference classification", () => {
  it("routes an explicit jobId to Discovery/Auto-POM", () => {
    assert.deepEqual(parseQaLabReference("jobId=abc-123"), { kind: "discovery-job", id: "abc-123" });
    assert.deepEqual(parseQaLabReference("job://abc-123"), { kind: "discovery-job", id: "abc-123" });
  });
  it("routes recordingId and legacy recordId labels to Recording", () => {
    assert.equal(parseQaLabReference("recordingId: 'rec-123'")?.kind, "recording");
    assert.equal(parseQaLabReference("recordId=rec-456")?.kind, "recording");
  });
  it("strips sentence-ending punctuation before resolving a recording artifact", () => {
    assert.deepEqual(parseQaLabReference("recordingId=301e5743-4f22-4471-b9c7-f3ebc5166310. Reanuda el diagnóstico."), {
      kind: "recording",
      id: "301e5743-4f22-4471-b9c7-f3ebc5166310",
    });
  });
  it("requires exactly one labeled ID and does not infer from UUID format", () => {
    assert.equal(parseQaLabReference("task 123e4567-e89b-12d3-a456-426614174000"), undefined);
    assert.match(qaLabReferenceError("problem without id")!, /recordingId o jobId/);
    assert.match(qaLabReferenceError("jobId=abc recordingId=def")!, /un solo ID/);
  });
});
