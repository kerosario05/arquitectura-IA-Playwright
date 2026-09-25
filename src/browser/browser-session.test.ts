import assert from "node:assert/strict";
import test from "node:test";
import { resolveQaBrowserProfilePath } from "./browser-profile";
import { buildRuntimeContextOptions } from "./browser-session";

test("resolves a configurable persistent profile without using the user profile", () => {
  assert.equal(
    resolveQaBrowserProfilePath(".qa/browser", "C:/workspace"),
    "C:\\workspace\\.qa\\browser",
  );
});

test("defaults to an ephemeral context when no persistent profile is configured", () => {
  assert.equal(resolveQaBrowserProfilePath(undefined, "C:/workspace"), undefined);
  assert.equal(resolveQaBrowserProfilePath("", "C:/workspace"), undefined);
  assert.equal(resolveQaBrowserProfilePath("   ", "C:/workspace"), undefined);
});

test("runtime context options block stale service workers by default", () => {
  const options = buildRuntimeContextOptions({ ignoreHTTPSErrors: true });
  assert.equal(options.serviceWorkers, "block");
  assert.equal(options.ignoreHTTPSErrors, true);
});

test("runtime context options preserve an explicit service worker policy", () => {
  const options = buildRuntimeContextOptions({ serviceWorkers: "allow" });
  assert.equal(options.serviceWorkers, "allow");
});
