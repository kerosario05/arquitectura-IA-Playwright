import assert from "node:assert/strict";
import test from "node:test";
import { resolveQaBrowserProfilePath } from "./browser-profile";

test("resolves a configurable persistent profile without using the user profile", () => {
  assert.equal(
    resolveQaBrowserProfilePath(".qa/browser", "C:/workspace"),
    "C:\\workspace\\.qa\\browser",
  );
  assert.equal(
    resolveQaBrowserProfilePath(undefined, "C:/workspace"),
    "C:\\workspace\\.artifacts\\browser\\qa-profile",
  );
});
