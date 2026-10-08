import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.resolve(__dirname, "promoted-spec-runtime.ts"), "utf8");

function extractFunction(name: string, nextMarker: string): string {
  const start = source.indexOf(name);
  assert.ok(start >= 0, `${name} should exist`);
  const end = source.indexOf(nextMarker, start);
  assert.ok(end > start, `${nextMarker} should follow ${name}`);
  return source.slice(start, end);
}

test("selection runtime only considers retry recovery after the desired option is unavailable and before opening the selector", () => {
  const selection = extractFunction("async selectPromotedItem(", "\n  async expectPromotedVisible(");
  const firstOptionLookup = selection.indexOf("let option = await resolvePromotedSelectionOption");
  const recovery = selection.indexOf("recoverPromotedSelectionList(this.page, selectionField, runtimeValue");
  const opener = selection.indexOf("resolvePromotedClickableLocator(this.page, options.target");

  assert.ok(firstOptionLookup >= 0 && recovery > firstOptionLookup && opener > recovery);
  assert.match(selection.slice(recovery - 160, recovery + 380), /if\s*\(!option\)/);
  assert.match(selection, /listRecovery\.status === "not_ready"[\s\S]*selection_list_recovery_not_ready/);
});

test("runtime retry resolver uses the shared snapshot, unique field-associated control, and waits for the requested option", () => {
  const recovery = extractFunction("async function recoverPromotedSelectionList(", "\nexport type PromotedAssertOptions");
  assert.match(recovery, /scanCurrentPage\(page\)/);
  assert.match(recovery, /findUniqueSelectionListRecoveryControl\(snapshot\.elements, selectionField\)/);
  assert.match(recovery, /count !== 1/);
  assert.match(recovery, /locator\.isVisible\(\)/);
  assert.match(recovery, /locator\.isEnabled\(\)/);
  assert.match(recovery, /await locator\.click/);
  assert.match(recovery, /waitFor\(\{ state: "visible", timeout: timeoutMs \}\)/);
  assert.match(recovery, /selection-list-recovery.*option_ready/);
});

test("ordinary selections have no retry action unless a matching control is visible in the field's local context", () => {
  assert.match(source, /if \(!control\) return \{ status: "not_applicable" \}/);
  assert.match(source, /selectionField\s*\?\s*await recoverPromotedSelectionList/);
  assert.equal(source.includes("appSlug === \"portal-comercial\""), false);
});
