import { resolveServerPort } from "./config";
import assert from "node:assert";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(_name: string, fn: () => void): void {
  console.log(`\n${_name}`);
  fn();
}

describe("resolveServerPort", () => {
  test("PORT=3002 → 3002", () => {
    assert.strictEqual(resolveServerPort({ PORT: "3002" }), 3002);
  });

  test("SERVER_PORT=3003 → 3003 (API_PORT alias)", () => {
    assert.strictEqual(resolveServerPort({ API_PORT: "3003" }), 3003);
  });

  test("PORT takes priority over API_PORT", () => {
    assert.strictEqual(resolveServerPort({ PORT: "3002", API_PORT: "3001" }), 3002);
  });

  test("invalid PORT string → 3001 fallback", () => {
    assert.strictEqual(resolveServerPort({ PORT: "abc" }), 3001);
  });

  test("empty PORT → 3001 fallback", () => {
    assert.strictEqual(resolveServerPort({ PORT: "" }), 3001);
  });

  test("PORT=0 (invalid) → 3001 fallback", () => {
    assert.strictEqual(resolveServerPort({ PORT: "0" }), 3001);
  });

  test("no env vars → 3001 default", () => {
    assert.strictEqual(resolveServerPort({}), 3001);
  });

  test("PORT=-1 (invalid negative) → 3001 fallback", () => {
    assert.strictEqual(resolveServerPort({ PORT: "-1" }), 3001);
  });
});
