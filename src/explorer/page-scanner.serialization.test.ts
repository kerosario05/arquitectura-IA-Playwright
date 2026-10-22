import assert from "node:assert/strict";
import test from "node:test";
import { scanCurrentPage } from "./page-scanner";

test("page scanner evaluate callback is browser-self-contained", async () => {
  let serializedCallback = "";
  const page = {
    evaluate: async (callback: unknown) => {
      serializedCallback = String(callback);
      assert.equal(serializedCallback.includes("__name"), false);
      assert.doesNotThrow(() => new Function(`return (${serializedCallback})`));
      return [];
    },
    url: () => "about:blank",
    title: async () => "",
  } as never;

  await scanCurrentPage(page);

  assert.notEqual(serializedCallback, "");
  assert.match(serializedCallback, /new RegExp\(dateTimeRegexSource,"i"\)/);
  assert.match(serializedCallback, /el\.innerText/);
  assert.doesNotMatch(serializedCallback, /isVisibleDateTime/);
});

test("page scanner preserves a value-free date-time signal before text sanitization", async () => {
  const page = {
    evaluate: async () => [{
      id: "date-time-label",
      elementType: "text",
      text: "21/10/2026 04:17:36 PM",
      semanticSignals: ["date_time_value"],
      visible: true,
      candidateLocators: [],
      structuralOwnerIdentityInput: {},
      score: 1,
    }],
    url: () => "about:blank",
    title: async () => "",
  } as never;

  const snapshot = await scanCurrentPage(page);

  assert.deepEqual(snapshot.elements[0]?.semanticSignals, ["date_time_value"]);
});
