import assert from "node:assert/strict";
import test from "node:test";
import { createCoalescedWriter } from "./recording-store";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a burst of live events becomes a single trace write", async () => {
  let writes = 0;
  const writer = createCoalescedWriter(() => { writes += 1; }, 50);
  for (let i = 0; i < 7; i++) writer.schedule(); // one click used to cause 6-7 full rewrites
  assert.equal(writes, 0);
  await wait(80);
  assert.equal(writes, 1);
});

test("events after a write schedule a new one", async () => {
  let writes = 0;
  const writer = createCoalescedWriter(() => { writes += 1; }, 30);
  writer.schedule();
  await wait(50);
  writer.schedule();
  await wait(50);
  assert.equal(writes, 2);
});

test("flush writes pending data immediately and only once", async () => {
  let writes = 0;
  const writer = createCoalescedWriter(() => { writes += 1; }, 1_000);
  writer.schedule();
  writer.flush();
  writer.flush();
  assert.equal(writes, 1);
});

test("cancel drops a pending write so it cannot race the final save", async () => {
  let writes = 0;
  const writer = createCoalescedWriter(() => { writes += 1; }, 30);
  writer.schedule();
  writer.cancel();
  await wait(60);
  assert.equal(writes, 0);
});
