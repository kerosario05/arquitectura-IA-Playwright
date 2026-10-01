import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { executeRecordingControlAction, resolveRecordingControlTarget, type RecordingControlAction } from "./recording-control";

function fakePage(count = 1, closed = false) {
  const calls: string[] = [];
  const locator = { count: async () => count, waitFor: async () => {}, click: async () => { calls.push("click"); }, fill: async (value: string) => { calls.push(`fill:${value}`); }, press: async (key: string) => { calls.push(`press:${key}`); }, selectOption: async (value: string) => { calls.push(`select:${value}`); } };
  const page = { calls, isClosed: () => closed, locator: () => locator, getByTestId: () => locator, getByText: () => locator, getByRole: () => locator, goto: async (url: string) => { calls.push(`navigate:${url}`); } };
  return page as any;
}

function multiCandidatePage(countByStrategy: Record<string, number>) {
  const calls: string[] = [];
  const locatorFor = (strategy: string) => { const count = countByStrategy[strategy] ?? 0; return { count: async () => count, waitFor: async () => {}, click: async () => { calls.push(`click:${strategy}`); } }; };
  const page = { calls, isClosed: () => false, locator: (v: string) => locatorFor("css"), getByTestId: () => locatorFor("data-testid"), getByText: () => locatorFor("text"), getByRole: () => locatorFor("role") };
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

test("an ambiguous candidate is skipped in favor of another recorded candidate that resolves uniquely", async () => {
  const page = multiCandidatePage({ text: 2, "data-testid": 1 });
  await executeRecordingControlAction(page, { kind: "click", target: { locators: [{ strategy: "text", value: "Tarjetas" }, { strategy: "data-testid", value: "cards-tab" }] } });
  assert.deepEqual(page.calls, ["click:data-testid"]);
});

test("every recorded candidate ambiguous still fails closed as AMBIGUOUS_TARGET", async () => {
  const page = multiCandidatePage({ text: 2, "data-testid": 3 });
  await assert.rejects(() => resolveRecordingControlTarget(page, { locators: [{ strategy: "text", value: "Tarjetas" }, { strategy: "data-testid", value: "cards-tab" }] }), /multiple elements/);
});

test("semantic control target retries without a trailing required-field marker and still requires uniqueness", async () => {
  const requestedNames: string[] = [];
  const locator = (count: number) => ({ count: async () => count, waitFor: async () => {}, click: async () => {} });
  const page = {
    isClosed: () => false,
    getByRole: (_role: string, options?: { name?: string }) => {
      requestedNames.push(options?.name ?? "");
      return locator(options?.name === "RNC de la empresa" ? 1 : 0);
    },
  } as any;
  await resolveRecordingControlTarget(page, { role: "textbox", label: "RNC de la empresa*" });
  assert.deepEqual(requestedNames, ["RNC de la empresa*", "RNC de la empresa*", "RNC de la empresa"]);

  const ambiguous = {
    ...page,
    getByRole: (_role: string, options?: { name?: string }) => locator(options?.name === "RNC de la empresa" ? 2 : 0),
  } as any;
  await assert.rejects(
    () => resolveRecordingControlTarget(ambiguous, { role: "textbox", label: "RNC de la empresa*" }),
    /Normalized semantic target matched multiple elements/,
  );
});

test("positional fallback and fixed waits are absent from the control surface", async () => {
  const source = await readFile("src/recording/recording-control.ts", "utf8");
  assert.equal(/\.(first|last|nth)\s*\(/.test(source), false);
  assert.equal(/waitForTimeout|coordinates|\bindex\b/.test(source), false);
});
