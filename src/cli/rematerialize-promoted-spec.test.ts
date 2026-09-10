import assert from "node:assert/strict";
import test from "node:test";
import { parseRematerializationArgs } from "./rematerialize-promoted-spec";

test("parses only technical rematerialization identity", () => {
  assert.deepEqual(parseRematerializationArgs([
    "--case-id", "44757", "--app", "portalempresarial", "--section", "automatizacion-1",
  ]), { caseId: 44757, appSlug: "portalempresarial", sectionSlug: "automatizacion-1" });
});

test("rejects missing or invalid case identity", () => {
  assert.throws(() => parseRematerializationArgs(["--app", "portalempresarial", "--section", "automatizacion-1"]), /Missing --case-id/);
  assert.throws(() => parseRematerializationArgs(["--case-id", "0", "--app", "portalempresarial", "--section", "automatizacion-1"]), /Invalid --case-id/);
});
