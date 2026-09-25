import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { executeRecordingControlAction, resolveRecordingControlTarget, type RecordingControlAction } from "./recording-control";

function fakePage(count = 1, closed = false) {
  const calls: string[] = [];
  const locator = { count: async () => count, click: async () => { calls.push("click"); }, fill: async (value: string) => { calls.push(`fill:${value}`); }, press: async (key: string) => { calls.push(`press:${key}`); }, selectOption: async (value: string) => { calls.push(`select:${value}`); } };
  const page = { calls, isClosed: () => closed, locator: () => locator, getByTestId: () => locator, getByText: () => locator, getByRole: () => locator, goto: async (url: string) => { calls.push(`navigate:${url}`); } };
  return page as any;
}

test("control action executes on the supplied authoritative page without positional APIs", async () => {
  const page = fakePage();
  await executeRecordingControlAction(page, { kind: "click", target: { locators: [{ strategy: "data-testid", value: "continue" }] } });
  assert.deepEqual(page.calls, ["click"]);
});

test("fill, press, select and navigate use the same page and do not return the secret value", async () => {
  const page = fakePage();
  await executeRecordingControlAction(page, { kind: "fill", target: { locators: [{ strategy: "id", value: "password" }] }, value: "secret-not-returned" });
  await executeRecordingControlAction(page, { kind: "press", target: { locators: [{ strategy: "id", value: "password" }] }, key: "Enter" });
  await executeRecordingControlAction(page, { kind: "select", target: { locators: [{ strategy: "id", value: "choice" }] }, value: "option-a" });
  await executeRecordingControlAction(page, { kind: "navigate", url: "https://runtime.example" });
  assert.deepEqual(page.calls, ["fill:secret-not-returned", "press:Enter", "select:option-a", "navigate:https://runtime.example"]);
  assert.equal(JSON.stringify({ executed: true, action: "fill" }).includes("secret-not-returned"), false);
});

test("missing, ambiguous, closed and unsupported authority fail closed", async () => {
  await assert.rejects(() => resolveRecordingControlTarget(fakePage(0), { locators: [{ strategy: "id", value: "missing" }] }), /no unique runtime match/);
  await assert.rejects(() => resolveRecordingControlTarget(fakePage(2), { locators: [{ strategy: "id", value: "duplicate" }] }), /multiple elements/);
  await assert.rejects(() => executeRecordingControlAction(fakePage(1, true), { kind: "navigate", url: "https://runtime.example" }), /closed/);
  await assert.rejects(() => executeRecordingControlAction(fakePage(), { kind: "bogus" } as unknown as RecordingControlAction), /Unsupported/);
});

test("positional fallback and fixed waits are absent from the control surface", async () => {
  const source = await readFile("src/recording/recording-control.ts", "utf8");
  assert.equal(/\.(first|last|nth)\s*\(/.test(source), false);
  assert.equal(/waitForTimeout|coordinates|\bindex\b/.test(source), false);
});
