import assert from "node:assert/strict";
import test from "node:test";
import { isPlainStableIdLocator } from "./target-resolver";

/**
 * FIRST_LOSS (jobId 7dfc3157-449a-49eb-916b-de8a05070145, step 18 "Continuar"): the page rendered
 * `#btn-continue` twice with only one copy visible, so the recorded id matched 2 and the step
 * failed closed. `resolveRecordedTechnicalTarget` now narrows such a ref to its visible copies
 * and accepts it only when exactly one is visible. The live-DOM part is not testable here (no
 * browser, per the target-resolver.ts test convention); this pins which refs may be narrowed.
 */

test("only a plain stable id may be narrowed to its single visible copy", () => {
  assert.equal(isPlainStableIdLocator({ strategy: "css", value: "#btn-continue", confidence: 1 }), true);
  assert.equal(isPlainStableIdLocator({ strategy: "id", value: "btn-continue", confidence: 1 }), true);
});

test("positional, compound, text and role refs are never narrowed by visibility", () => {
  for (const value of ["#a:nth-child(2)", "div #a", "#a > span", ".btn", "button", "#"]) {
    assert.equal(isPlainStableIdLocator({ strategy: "css", value, confidence: 1 }), false, value);
  }
  assert.equal(isPlainStableIdLocator({ strategy: "role", value: "button|Continuar", confidence: 1 }), false);
  assert.equal(isPlainStableIdLocator({ strategy: "text", value: "Continuar", confidence: 1 }), false);
  assert.equal(isPlainStableIdLocator({ strategy: "id", value: "  ", confidence: 1 }), false);
});

test("the structural owner anchor (spec runtime path) narrows a duplicated id the same way", async () => {
  // job dcb8e878 step 19: the promoted spec resolves #btn-continue through the structural owner
  // anchor, not the recorded-ref loop, so the visible-copy rule must live there too.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const source = fs.readFileSync(path.resolve(__dirname, "target-resolver.ts"), "utf8");
  const anchorBlock = source.slice(source.indexOf("let anchoredVisibleOnly = false;"), source.indexOf("reason=stable_owner_anchor_admitted"));
  assert.match(anchorBlock, /hasStableOwnerAnchor && structuralCandidateCountAfterStableAttributes > 1/);
  assert.match(anchorBlock, /filter\(\{ visible: true \}\)\.count\(\)\.catch\(\(\) => 0\) === 1/);
  assert.match(anchorBlock, /structuralCandidateCountAfterStableAttributes === 1 \|\| anchoredVisibleOnly/);
});

test("the spec's own id form [id=\"x\"] counts as a plain stable id; attribute mixes do not", () => {
  assert.equal(isPlainStableIdLocator({ strategy: "css", value: '[id="btn-continue"]', confidence: 1 }), true);
  assert.equal(isPlainStableIdLocator({ strategy: "css", value: '[id="btn-continue"][role="button"]', confidence: 1 }), false);
  assert.equal(isPlainStableIdLocator({ strategy: "css", value: '[id^="btn"]', confidence: 1 }), false);
});

test("the promoted structural click narrows an ambiguous plain id to its single visible copy", async () => {
  // job 035abfcc step 19: resolveRecordedStructuralOwner returned action_owner_ambiguous and the
  // spec runtime had no visible-copy rule, so the click failed closed.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const runtime = fs.readFileSync(path.resolve(__dirname, "../automations/runtime/promoted-spec-runtime.ts"), "utf8");
  const block = runtime.slice(runtime.indexOf("let visibleIdLocator"), runtime.indexOf("const resolvedLocator = (causalOptionResolution"));
  assert.match(block, /isPlainStableIdLocator/);
  assert.match(block, /count\(\)\.catch\(\(\) => 0\) > 1/);
  assert.match(block, /visibleCopies\.count\(\)\.catch\(\(\) => 0\) === 1/);
  assert.match(runtime, /\?\? rowCheckboxLocator\s*\?\? visibleIdLocator;/);
});
