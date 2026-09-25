import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.resolve(__dirname, "promoted-spec-runtime.ts"), "utf8");
function method(start: string, end: string) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const fill = method("async fillPromotedField", "async pressPromotedTarget");
const press = method("async pressPromotedTarget", "async selectPromotedItem");

test("fill telemetry contract is boolean-only", () => {
  assert.match(fill, /\[promoted-fill-state\][\s\S]*targetResolved=.*valueResolved=.*valueNonEmpty=.*fieldHasValueAfterFill=.*targetVisible=.*targetEnabled=.*targetEditable=/);
  assert.doesNotMatch(fill.match(/console\.log\(`\[promoted-fill-state\][^`]+`\)/)?.[0] ?? "", /inputValue|password|username|rawValue|resolvedValue/);
});
test("press telemetry contract precedes dispatch and omits control content", () => {
  const log = press.match(/console\.log\(`\[promoted-press-dispatch\][^`]+`\)/)?.[0] ?? "";
  assert.match(log, /targetResolved=.*targetVisible=.*targetEnabled=.*targetEditable=.*targetHasValueBeforePress=.*activeElementMatchesTargetBeforePress=.*dispatchMethod=.*dispatchStarted=/);
  assert.doesNotMatch(log, /inputValue|password|username|rawValue|resolvedValue/);
  const dispatch = press.indexOf("await pressPromotedLocatorWithBoundedReresolution(");
  assert.ok(press.indexOf("[promoted-press-dispatch]") < dispatch);
  assert.ok(dispatch < press.indexOf("waitForPromotedPressTransition"));
});
