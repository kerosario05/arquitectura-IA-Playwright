import assert from "node:assert/strict";
import test from "node:test";
import { reportCaseFailureSafely, runScheduledCaseSafely } from "./case-failure-reporting";

test("failed checklist persistence cannot prevent progress or the next scheduled case", async () => {
  const events: string[] = [];
  for (const caseId of [1, 2]) {
    events.push(`start:${caseId}`);
    await reportCaseFailureSafely(async () => {
      if (caseId === 1) throw new Error("synthetic persistence failure");
      events.push(`reported:${caseId}`);
    }, () => { events.push(`report-error:${caseId}`); }, () => { events.push(`progress:${caseId}`); });
  }
  assert.deepEqual(events, ["start:1", "report-error:1", "progress:1", "start:2", "reported:2", "progress:2"]);
});

test("an exception anywhere in one case cannot abort the remaining scheduled cases", async () => {
  const events: string[] = [];
  for (const caseId of [55032, 55033]) {
    await runScheduledCaseSafely(async () => {
      events.push(`start:${caseId}`);
      if (caseId === 55032) throw new Error("synthetic discovery or bookkeeping error");
      events.push(`complete:${caseId}`);
    }, () => { events.push(`failed:${caseId}`); });
  }
  assert.deepEqual(events, ["start:55032", "failed:55032", "start:55033", "complete:55033"]);
});
