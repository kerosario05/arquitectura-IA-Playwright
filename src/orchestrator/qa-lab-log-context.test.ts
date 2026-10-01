import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readQaLabBackendLogContext } from "./qa-lab-log-context";

test("bounded QA Lab log context filters for the task project and redacts credentials", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-log-context-"));
  try {
    fs.writeFileSync(path.join(root, "qalab-backend.log"), [
      "[recording] project=other status=started",
      "[recording] project=roke recordingId=48d9bd8b-d667-44fb-8ee8-7f9429269e74 status=derived token=do-not-leak",
      "[recording] newest fresh recording request started",
      "[server] unrelated message",
    ].join("\n"));
    const context = readQaLabBackendLogContext(root, { projectSlug: "roke", threadContext: "recordingId=48d9bd8b-d667-44fb-8ee8-7f9429269e74", objective: "Inspect candidate targets", currentFrontier: "scenario derive" });
    assert.match(context, /project=roke/);
    assert.doesNotMatch(context, /project=other/);
    assert.doesNotMatch(context, /do-not-leak/);
    assert.match(context, /recordingId=48d9bd8b-d667-44fb-8ee8-7f9429269e74/);
    assert.match(context, /newest fresh recording request started/);
    assert.doesNotMatch(context, /project=other/);
    assert.match(context, /diagnostic context only/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
