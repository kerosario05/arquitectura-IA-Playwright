import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget, resolveSnapshotElementLocator } from "./target-resolver";
import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";

test("observed exact menu identity outranks partial role matches across projects", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const label of ["Transferencias", "Inventory"]) {
      await page.setContent(`<div id="menu" style="cursor:pointer">${label}</div><a id="other" href="#">Authorization ${label}</a>`);
      const element = { id: "observed", type: "text", tagName: "div", text: label, visible: true,
        actionability: "FRAMEWORK_ACTIONABLE", actionOwner: true,
        candidateLocators: [{ strategy: "text", value: label, exact: false, confidence: 0.75 }] } as SnapshotElement;
      const result = await resolveSnapshotElementLocator(page, { element, target: label, candidateText: label,
        type: "text", tagName: "div", confidence: 0.75, matchReason: "exact observed text" });
      assert.equal(await result.locator?.getAttribute("id"), "menu");
      const other = { id: "unrelated", type: "link", tagName: "a", text: `Authorization ${label}`, visible: true,
        candidateLocators: [{ strategy: "css", value: "#other", confidence: 1 }] } as SnapshotElement;
      const snapshot = { url: page.url(), title: "fixture", elements: [element, other] } as PageSnapshot;
      const action = await resolveActionTarget(page, snapshot, label, { actionType: "action_click" });
      assert.equal(action.status, "resolved");
      assert.equal(await action.locator?.getAttribute("id"), "menu", "action consumer retains observed menu identity");
    }
    for (const label of ["Iniciar sesión", "Sign in"]) {
      await page.setContent(`<button hidden>${label}</button><button id="active">${label}</button>`);
      const element = { id: "visible-login", type: "button", tagName: "button", text: label, visible: true,
        candidateLocators: [{ strategy: "text", value: label, exact: false, confidence: 0.75 }] } as SnapshotElement;
      const action = await resolveActionTarget(page, { url: page.url(), title: "fixture", elements: [element] } as PageSnapshot,
        label, { actionType: "action_click" });
      assert.equal(action.status, "resolved", "hidden duplicate cannot block the single observed visible button");
      assert.equal(await action.locator?.getAttribute("id"), "active");
    }
    await page.setContent('<button>Save</button><button>Save</button>');
    const ambiguous = await resolveSnapshotElementLocator(page, {
      element: { id: "duplicate", type: "button", tagName: "button", text: "Save", candidateLocators: [] } as unknown as SnapshotElement,
      target: "Save", candidateText: "Save", type: "button", tagName: "button", confidence: 0.8, matchReason: "text",
    });
    assert.equal(ambiguous.locator, undefined, "duplicate observed identities must not choose an ordinal match");
    await page.setContent('<button id="intended">Save</button><button>Save</button>');
    const identified = await resolveSnapshotElementLocator(page, {
      element: { id: "observed", type: "button", tagName: "button", text: "Save",
        candidateLocators: [{ strategy: "css", value: "#intended", confidence: 1 }] } as SnapshotElement,
      target: "Save", candidateText: "Save", type: "button", tagName: "button", confidence: 1, matchReason: "identity",
    });
    assert.equal(await identified.locator?.getAttribute("id"), "intended", "technical identity disambiguates repeated labels");
  } finally { await browser.close(); }
});
