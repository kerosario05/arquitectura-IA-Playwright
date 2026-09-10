import assert from "node:assert/strict";
import test from "node:test";
import { buildWebRecorderContextOptions } from "./web-session-recorder";

test("passes the project HTTPS policy to the recording context", () => {
  assert.deepEqual(buildWebRecorderContextOptions(true), { ignoreHTTPSErrors: true });
  assert.deepEqual(buildWebRecorderContextOptions(false), { ignoreHTTPSErrors: false });
  assert.deepEqual(buildWebRecorderContextOptions(undefined), { ignoreHTTPSErrors: false });
});
