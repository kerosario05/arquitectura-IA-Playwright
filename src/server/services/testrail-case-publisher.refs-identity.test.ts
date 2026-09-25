import assert from "node:assert";
import { buildSafeTestRailRefs } from "./testrail-case-publisher";

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

function scenario(sourceIssueKey: string, scenarioId?: string) {
  return { sourceIssueKey, scenarioId } as any;
}

/**
 * BUG D8DBD8F9-01 (P1.1): with no storyKey, buildSafeTestRailRefs used to fall back to the bare
 * sourceIssueKey (a Recording's or Jira story's grouping reference, e.g. "REC-D8DBD8F9") as the
 * scenario's own refs value — colliding every scenario under the same Recording/story onto the
 * identical ref. Multiple scenarios in the same Recording (REC-XXXXXXXX-01, -02, -03) must
 * remain distinguishable.
 */
async function main(): Promise<void> {
  console.log("\nbuildSafeTestRailRefs — scenario identity must survive when no storyKey is supplied");

  await test("CASE 1 (BUG D8DBD8F9-01 repro): with no storyKey, refs is no longer the bare recording-level sourceIssueKey", () => {
    const refs = buildSafeTestRailRefs(scenario("REC-D8DBD8F9"), "L-d8dbd8f9-001", undefined);
    assert.notStrictEqual(refs, "REC-D8DBD8F9", "the bare recording-level ref must never be used as a scenario's own identity");
    assert.match(refs, /^REC-D8DBD8F9-/, "the recording-level prefix is preserved for traceability");
    assert.ok(refs.includes("D8DBD8F9-001") || refs.includes("L-D8DBD8F9-001"), "the scenario's own distinguishing token is preserved");
  });

  await test("CASE 2: two scenarios in the same Recording produce distinct refs", () => {
    const refsOne = buildSafeTestRailRefs(scenario("REC-D8DBD8F9"), "L-d8dbd8f9-001", undefined);
    const refsTwo = buildSafeTestRailRefs(scenario("REC-D8DBD8F9"), "L-d8dbd8f9-002", undefined);
    assert.notStrictEqual(refsOne, refsTwo, "REC-XXXXXXXX-01 and REC-XXXXXXXX-02 must never collapse onto the same ref");
  });

  await test("CASE 3: an explicit storyKey still wins and behaves exactly as before (regression guard)", () => {
    const refs = buildSafeTestRailRefs(scenario("REC-D8DBD8F9"), "L-d8dbd8f9-001", "STORY-123");
    assert.strictEqual(refs, "STORY-123-L-D8DBD8F9-001");
  });

  await test("CASE 4: no sourceIssueKey and no storyKey falls back to the scenario's own token (regression guard)", () => {
    const refs = buildSafeTestRailRefs(scenario(""), "L-d8dbd8f9-001", undefined);
    assert.strictEqual(refs, "L-D8DBD8F9-001");
  });

  /**
   * P4 (canonical TestRail identity): when the scenario carries its own canonical identity
   * (populated by toPublishableScenario for Recording-sourced scenarios), the ref must be built
   * from THAT — never from the publisher's own ephemeral internal virtual mapping id
   * ("L-d8dbd8f9-001", built from launchId+index). Building from the virtual id produced
   * "REC-D8DBD8F9-L-D8DBD8F9-001", a ref that could never be matched exactly on a later
   * execution because the virtual id is not a stable scenario identity.
   */
  await test("CASE 5 (BUG P4 repro): canonical scenario identity is used directly, never combined with the publisher's ephemeral virtual id", () => {
    const refs = buildSafeTestRailRefs(scenario("REC-D8DBD8F9", "REC-D8DBD8F9-01"), "L-d8dbd8f9-001", undefined);
    assert.strictEqual(refs, "REC-D8DBD8F9-01");
    assert.notEqual(refs, "REC-D8DBD8F9-L-D8DBD8F9-001", "the publisher's internal virtual id must never replace canonical scenario identity in the remote ref");
  });

  await test("CASE 6: canonical scenario identity is stable across different (even out-of-order) virtual ids for the same scenario", () => {
    const refsA = buildSafeTestRailRefs(scenario("REC-D8DBD8F9", "REC-D8DBD8F9-01"), "L-d8dbd8f9-001", undefined);
    const refsB = buildSafeTestRailRefs(scenario("REC-D8DBD8F9", "REC-D8DBD8F9-01"), "L-d8dbd8f9-003", undefined);
    assert.strictEqual(refsA, refsB, "the ref must depend only on the scenario's own canonical identity, not on the ephemeral batch-position virtual id");
  });

  await test("CASE 7: an explicit storyKey still wins over canonical scenario identity (regression guard)", () => {
    const refs = buildSafeTestRailRefs(scenario("REC-D8DBD8F9", "REC-D8DBD8F9-01"), "L-d8dbd8f9-001", "STORY-123");
    assert.strictEqual(refs, "STORY-123-REC-D8DBD8F9-01");
  });

  if (process.exitCode === 1) {
    console.error("\nbuildSafeTestRailRefs identity tests FAILED");
  } else {
    console.log("\nbuildSafeTestRailRefs identity tests PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
