import assert from "node:assert";
import { buildPublishedCaseIdByScenarioId } from "./recordings";

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

/**
 * BUG D8DBD8F9-01 reproduction: [testrail-publish] returned a real case (caseIds=46759) but
 * [recordings:testrail] logged creados=0 reconciliados=0 actualizados=0 reutilizados=0 — the
 * publisher's own four tracked counters never cover "skippedAlreadyPublished" (a case that
 * already existed under this exact destination, recognized via the publisher's own dedup). The
 * /execute fast-path built its persisted-caseId map from only created+reconciledCreated,
 * silently dropping that legitimate result — so testRailCaseId/testRailDestination were never
 * written back onto the scenario, and the next execution saw "missing" again indefinitely.
 */
async function main(): Promise<void> {
  console.log("\nrecordings /execute — published TestRail case persistence must not drop skippedAlreadyPublished");

  await test("CASE 1 (BUG D8DBD8F9-01 repro): a skippedAlreadyPublished case is still persisted, not silently dropped", () => {
    const map = buildPublishedCaseIdByScenarioId({
      created: [],
      reconciledCreated: [],
      skippedAlreadyPublished: [{ scenarioId: "REC-D8DBD8F9-01", caseId: 46759 }],
    });
    assert.strictEqual(map.size, 1, "a valid published result must never disappear silently");
    assert.strictEqual(map.get("REC-D8DBD8F9-01"), 46759);
  });

  await test("CASE 2: a freshly created case is still persisted (regression guard)", () => {
    const map = buildPublishedCaseIdByScenarioId({
      created: [{ scenarioId: "REC-AAAAAAAA-01", caseId: 111, title: "A" }],
      reconciledCreated: [],
      skippedAlreadyPublished: [],
    });
    assert.strictEqual(map.get("REC-AAAAAAAA-01"), 111);
  });

  await test("CASE 3: a reconciled-after-ambiguous case is still persisted (regression guard)", () => {
    const map = buildPublishedCaseIdByScenarioId({
      created: [],
      reconciledCreated: [{ scenarioId: "REC-BBBBBBBB-01", caseId: 222, title: "B" }],
      skippedAlreadyPublished: [],
    });
    assert.strictEqual(map.get("REC-BBBBBBBB-01"), 222);
  });

  await test("CASE 4: a mixed batch persists every distinct scenario's case, none dropped", () => {
    const map = buildPublishedCaseIdByScenarioId({
      created: [{ scenarioId: "REC-XXXXXXXX-01", caseId: 1, title: "one" }],
      reconciledCreated: [{ scenarioId: "REC-XXXXXXXX-02", caseId: 2, title: "two" }],
      skippedAlreadyPublished: [{ scenarioId: "REC-XXXXXXXX-03", caseId: 3 }],
    });
    assert.strictEqual(map.size, 3);
    assert.strictEqual(map.get("REC-XXXXXXXX-01"), 1);
    assert.strictEqual(map.get("REC-XXXXXXXX-02"), 2);
    assert.strictEqual(map.get("REC-XXXXXXXX-03"), 3);
  });

  await test("CASE 5: no published results at all yields an empty map (nothing to persist)", () => {
    const map = buildPublishedCaseIdByScenarioId({ created: [], reconciledCreated: [], skippedAlreadyPublished: [] });
    assert.strictEqual(map.size, 0);
  });

  if (process.exitCode === 1) {
    console.error("\npublished-case-persistence tests FAILED");
  } else {
    console.log("\npublished-case-persistence tests PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
