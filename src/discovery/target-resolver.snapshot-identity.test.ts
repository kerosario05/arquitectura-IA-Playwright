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
    for (const [label, otherLabel] of [["Cuentas Propias", "Cuenta de consulta"], ["Account settings", "Account overview"]]) {
      for (const reverse of [false, true]) {
        const entries = [{ id: "other", text: otherLabel }, { id: "intended", text: label }];
        if (reverse) entries.reverse();
        await page.setContent(entries.map(entry => `<a id="${entry.id}" href="#">${entry.text}</a>`).join(""));
        const elements = entries.map(entry => ({ id: entry.id, text: entry.text, type: "link", tagName: "a", visible: true,
          candidateLocators: [{ strategy: "css", value: `#${entry.id}`, confidence: 1 }] }));
        const action = await resolveActionTarget(page, { url: page.url(), elements } as PageSnapshot, label, { actionType: "action_click" });
        assert.equal(action.status, "resolved");
        assert.equal(await action.locator?.getAttribute("id"), "intended");
      }
    }
    await page.setContent('<a href="#">Cuenta A</a><a href="#">Cuenta B</a>');
    const ambiguousProduct = await resolveActionTarget(page, { version: "1.0", capturedAt: new Date().toISOString(),
      summary: { totalElements: 2, links: 2, buttons: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
      url: page.url(), title: "fixture", elements: ["Cuenta A", "Cuenta B"].map((text, i) => ({
      id: `account-${i}`, type: "link", tagName: "a", text, visible: true, candidateLocators: [], dataHints: [],
    })) } as PageSnapshot, "Cuenta", { actionType: "action_click" });
    assert.equal(ambiguousProduct.status, "ambiguous");
    assert.equal(ambiguousProduct.locator, undefined);
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

    await page.route("https://fixture.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
    await page.goto("https://fixture.test/");
    for (const menuLabels of [["Cuentas Propias", "Terceros", "Expresas", "Otros Bancos"], ["Account settings", "Orders", "Inventory", "Payments"]]) {
    await page.setContent(menuLabels.map((label, i) => `<a id="menu-${i}" href="/destination-${i}">- ${label}</a>`).join(""));
    const menuSnapshot = { version: "1.0", capturedAt: new Date().toISOString(),
      summary: { totalElements: 4, links: 4, buttons: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
      url: page.url(), title: "menu", elements: menuLabels.map((label, i) => ({
      id: `menu-${i}`, type: "link", tagName: "a", text: `- ${label}`, visible: true,
      nearbyText: menuLabels.map(item => `- ${item}`).join(" "),
      candidateLocators: [{ strategy: "css", value: `#menu-${i}`, confidence: 0.55 }], dataHints: [],
    })) } as PageSnapshot;
    const menuAction = await resolveActionTarget(page, menuSnapshot, menuLabels[0], { actionType: "action_click" });
    assert.equal(menuAction.status, "resolved", `shared sibling context must not outweigh the control's own decorated name: ${JSON.stringify({reason: menuAction.matchReason, candidates: menuAction.candidates})}`);
    assert.equal(await menuAction.locator?.getAttribute("id"), "menu-0");
    }
  } finally { await browser.close(); }
});
