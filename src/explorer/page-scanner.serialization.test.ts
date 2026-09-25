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
});
