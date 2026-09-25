import assert from "node:assert";
import { verifyExistingMappingIsExactMatch } from "./testrail-case-publisher";
import type { RawTestRailCase } from "../../types/testrail.types";

type AsyncTestFn = () => void | Promise<void>;

async function test(label: string, fn: AsyncTestFn): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function rawCase(overrides: Partial<RawTestRailCase> = {}): RawTestRailCase {
  return { id: 46759, title: "Tarjeta", section_id: 5795, refs: "REC-D8DBD8F9-L-D8DBD8F9-001", ...overrides };
}

/**
 * P1: publishScenariosToTestRail's own persisted mapping cache is a hint, never proof. TestRail
 * case 46759 was reported as "skipped_already_published" for REC-D8DBD8F9-01 with zero live
 * verification. These tests prove the pure verification predicate now required before that
 * classification is allowed.
 */
async function main(): Promise<void> {
  console.log("\nverifyExistingMappingIsExactMatch — cached mapping is a hint, never proof");

  await test("CASE 7 (spec): cached mapping + remote exact case -> valid", () => {
    const result = verifyExistingMappingIsExactMatch(rawCase(), { sectionId: 5795 }, ["REC-D8DBD8F9-L-D8DBD8F9-001"]);
    assert.strictEqual(result.valid, true);
  });

  await test("CASE 8 (spec): cached mapping + remote 404 (lookup returns undefined) -> stale, not existing", () => {
    const result = verifyExistingMappingIsExactMatch(undefined, { sectionId: 5795 }, ["REC-D8DBD8F9-L-D8DBD8F9-001"]);
    assert.strictEqual(result.valid, false);
    assert.strictEqual((result as { reason: string }).reason, "remote_not_found");
  });

  await test("CASE 9 (spec): cached mapping + wrong section -> stale", () => {
    const result = verifyExistingMappingIsExactMatch(rawCase({ section_id: 5794 }), { sectionId: 5795 }, ["REC-D8DBD8F9-L-D8DBD8F9-001"]);
    assert.strictEqual(result.valid, false);
    assert.strictEqual((result as { reason: string }).reason, "wrong_section");
  });

  await test("CASE 10 (spec): cached mapping + old truncated recording-level ref only -> stale, not an exact scenario match", () => {
    // Reproduces BUG D8DBD8F9-01: a case whose refs is only the bare recording-level ref
    // (the pre-fix buildSafeTestRailRefs output) must never be treated as an exact match for
    // THIS scenario, even though it exists and is in the right section.
    const result = verifyExistingMappingIsExactMatch(rawCase({ refs: "REC-D8DBD8F9" }), { sectionId: 5795 }, ["REC-D8DBD8F9-L-D8DBD8F9-001"]);
    assert.strictEqual(result.valid, false);
    assert.strictEqual((result as { reason: string }).reason, "identity_not_exact");
  });

  await test("CASE 11 (spec): cached mapping + exact scenario ref -> valid", () => {
    const result = verifyExistingMappingIsExactMatch(rawCase({ refs: "REC-D8DBD8F9-L-D8DBD8F9-001" }), { sectionId: 5795 }, ["REC-D8DBD8F9-L-D8DBD8F9-001"]);
    assert.strictEqual(result.valid, true);
  });

  await test("CASE 12 (spec): remote lookup unavailable (undefined case, same as 404) -> NEVER silently already published", () => {
    const result = verifyExistingMappingIsExactMatch(undefined, { sectionId: 5795 }, ["REC-D8DBD8F9-L-D8DBD8F9-001"]);
    assert.strictEqual(result.valid, false);
  });

  await test("no refs at all on the remote case -> stale, not an exact match", () => {
    const result = verifyExistingMappingIsExactMatch(rawCase({ refs: undefined }), { sectionId: 5795 }, ["REC-D8DBD8F9-L-D8DBD8F9-001"]);
    assert.strictEqual(result.valid, false);
    assert.strictEqual((result as { reason: string }).reason, "identity_not_exact");
  });

  await test("a remote case with no section_id at all is not rejected on section grounds (TestRail sometimes omits it) but still requires an exact ref", () => {
    const result = verifyExistingMappingIsExactMatch(rawCase({ section_id: undefined, refs: "REC-D8DBD8F9-L-D8DBD8F9-001" }), { sectionId: 5795 }, ["REC-D8DBD8F9-L-D8DBD8F9-001"]);
    assert.strictEqual(result.valid, true);
  });

  if (process.exitCode === 1) {
    console.error("\nverifyExistingMappingIsExactMatch tests FAILED");
  } else {
    console.log("\nverifyExistingMappingIsExactMatch tests PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
