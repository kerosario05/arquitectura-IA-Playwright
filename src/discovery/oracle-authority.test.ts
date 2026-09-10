import assert from "node:assert/strict";
import test from "node:test";
import { isPendingOracleAuthority } from "./oracle-authority";

test("exact oracle authority remains pending and non-blocking", () => {
  assert.equal(isPendingOracleAuthority({ reason: "ORACLE_AUTHORITY_MISSING" }), true);
  assert.equal(isPendingOracleAuthority({ reason: "assertion_not_found" }), false);
  assert.equal(isPendingOracleAuthority({ reason: "target_not_found" }), false);
});
