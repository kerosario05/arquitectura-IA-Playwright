import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import type { PageSnapshot } from "../types/page-snapshot.types";
import { isSelectionTriggerCandidate, resolveActionTarget } from "./target-resolver";

test("label fallback rejects navigation and option nodes as selection triggers", () => {
  assert.equal(isSelectionTriggerCandidate({ tagName: "li", role: "menuitem" }), false);
  assert.equal(isSelectionTriggerCandidate({ tagName: "li", role: "menuitem", hasPopup: true }), false);
  assert.equal(isSelectionTriggerCandidate({ tagName: "div", role: "option" }), false);
  assert.equal(isSelectionTriggerCandidate({ tagName: "ul", role: "listbox" }), false);
});

test("label fallback accepts controls with explicit selection semantics", () => {
  for (const candidate of [
    { tagName: "select" },
    { tagName: "div", role: "combobox" },
    { tagName: "button", hasPopup: true },
    { tagName: "button", hasExpandedAttribute: true },
    { tagName: "input", hasList: true },
  ]) assert.equal(isSelectionTriggerCandidate(candidate), true);
});

test("disabled controls and ordinary buttons are not activated by label lookup", () => {
  assert.equal(isSelectionTriggerCandidate({ tagName: "select", disabled: true }), false);
  assert.equal(isSelectionTriggerCandidate({ tagName: "div", role: "combobox", ariaDisabled: true }), false);
  assert.equal(isSelectionTriggerCandidate({ tagName: "button", role: "button" }), false);
});

test("field-label fallback checks live selection semantics before opening any control", () => {
  const source = fs.readFileSync(path.join(__dirname, "target-resolver.ts"), "utf8");
  const start = source.indexOf("const fieldLocators = [", source.indexOf("async function tryResolveSelectionOptionViaField("));
  const end = source.indexOf("// Some observed custom selectors", start);
  const fieldFallback = source.slice(start, end);
  const authorityCheck = fieldFallback.indexOf("isSelectionTriggerCandidate(triggerDetails)");
  const activation = fieldFallback.indexOf("resolveAndApplySelectionSurface(");
  assert.ok(authorityCheck >= 0, "field-label fallback must validate the resolved live element");
  assert.ok(activation >= 0, "valid selection controls retain the existing resolver path");
  assert.ok(authorityCheck < activation, "the label match cannot be clicked before selection authority is checked");
});

test("recorded value selection uses its observed field, never a similarly labeled navigation item", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <nav><li role="menuitem" aria-label="Producto" id="navigation-item"
        onclick="window.navigationClicks = (window.navigationClicks || 0) + 1">Solicitud multiproducto</li></nav>
      <div id="product" tabindex="0" style="cursor:pointer" onclick="document.querySelector('#products').hidden = false">
        <span>Seleccione un producto</span>
      </div>
      <div id="products" role="listbox" hidden><div role="option"
        onclick="document.querySelector('#product span').textContent = 'Requested product'; document.querySelector('#products').hidden = true">Requested product</div></div>
    `);
    const snapshot = {
      version: "1.0",
      url: "http://localhost/requests/1/edit",
      title: "fixture",
      capturedAt: new Date(0).toISOString(),
      elements: [{
        id: "product-owner",
        type: "text",
        tagName: "div",
        nearbyText: "Producto",
        visible: true,
        candidateLocators: [{ strategy: "css", value: "#product", confidence: 0.9 }],
        dataHints: [],
        actionability: "FRAMEWORK_ACTIONABLE",
        cursor: "pointer",
        pointerEvents: "auto",
      }],
      summary: { totalElements: 1, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    } as PageSnapshot;

    const result = await resolveActionTarget(page, snapshot, "Requested product", {
      actionType: "action_select",
      recordingActionType: "click",
      selectionField: "Producto",
      associatedField: "Producto",
      selectionValue: "Requested product",
      recordedTechnicalTargetRefs: ["role:option|Requested product"],
    });
    assert.equal(result.status, "resolved");
    assert.equal(result.selectionApplied, true);
    assert.equal(await page.locator("#product").innerText(), "Requested product");
    assert.equal(await page.evaluate(() => (window as any).navigationClicks ?? 0), 0);
    assert.equal(await page.locator("#products").isVisible(), false, "the selected option closed the field's surface");

    await page.locator("#product span").evaluate(element => { element.textContent = "Seleccione un producto"; });
    await page.locator("#products").evaluate(element => {
      element.innerHTML = "<div role=\"option\">Another product</div>";
      (element as HTMLElement).hidden = true;
    });
    const unavailable = await resolveActionTarget(page, snapshot, "Missing product", {
      actionType: "action_select",
      recordingActionType: "click",
      selectionField: "Producto",
      associatedField: "Producto",
      selectionValue: "Missing product",
      recordedTechnicalTargetRefs: ["role:option|Missing product"],
    });
    assert.equal(unavailable.selectionDiagnostics?.failureReason, "option_not_supported");
    assert.equal(await page.locator("#products").isVisible(), true, "the resolver opened the product field and found no requested option");
    assert.equal(await page.evaluate(() => (window as any).navigationClicks ?? 0), 0);
  } finally {
    await browser.close();
  }
});

test("recorded selection opens a lazily populated, ARIA-controlled custom dropdown and verifies its value", { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3_000);
    await page.setContent(`
      <section>
        <span id="product-label">Product</span>
        <div id="product" class="p-dropdown p-component" style="display:block;width:240px;height:40px;cursor:pointer;border:1px solid">
          <span role="combobox" tabindex="0" aria-labelledby="product-label" aria-controls="product-options" aria-expanded="false"
            class="p-dropdown-label p-inputtext p-dropdown-label-empty" style="display:block;width:100%;height:100%"></span>
        </div>
        <div id="product-options" role="listbox" hidden></div>
      </section>
      <script>
        const combobox = document.querySelector('#product [role="combobox"]');
        combobox.addEventListener('click', () => {
          combobox.setAttribute('aria-expanded', 'true');
          setTimeout(() => {
            const list = document.querySelector('#product-options');
            list.innerHTML = '<div role="option">Desired product</div>';
            list.hidden = false;
            list.querySelector('[role="option"]').addEventListener('click', () => {
              combobox.textContent = 'Desired product';
              combobox.setAttribute('aria-expanded', 'false');
              list.hidden = true;
            });
          }, 250);
        });
      </script>
    `);
    const snapshot = {
      version: "1.0",
      url: "http://localhost/requests/1/edit",
      title: "fixture",
      capturedAt: new Date(0).toISOString(),
      elements: [{
        id: "product-owner",
        type: "text",
        tagName: "div",
        nearbyText: "Product",
        visible: true,
        candidateLocators: [{ strategy: "css", value: "#product", confidence: 0.9 }],
        dataHints: [],
        actionability: "FRAMEWORK_ACTIONABLE",
        cursor: "pointer",
        pointerEvents: "auto",
      }],
      summary: { totalElements: 1, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    } as PageSnapshot;

    const result = await resolveActionTarget(page, snapshot, "Desired product", {
      actionType: "action_select",
      recordingActionType: "click",
      selectionField: "Product",
      associatedField: "Product",
      selectionValue: "Desired product",
      recordedTechnicalTargetRefs: ["role:option|Desired product"],
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.selectionApplied, true);
    assert.equal(result.selectionDiagnostics?.stateVerified, true);
    assert.equal(result.selectionDiagnostics?.ariaRelationshipFound, true);
    assert.equal(await page.getByRole("combobox").innerText(), "Desired product");
    assert.equal(await page.getByRole("listbox").isVisible(), false);
  } finally {
    await browser.close();
  }
});

test("snapshot-owned dropdown activates its unique semantic combobox instead of its wrapper", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3_000);
    await page.setContent(`
      <section>
        <span>Product</span>
        <div id="product" class="p-dropdown" style="display:block;width:240px;height:40px;cursor:pointer;border:1px solid"
          onclick="if (event.target === event.currentTarget) { window.wrapperClicks = (window.wrapperClicks || 0) + 1; const dialog = document.createElement('div'); dialog.setAttribute('role','dialog'); dialog.textContent='Unrelated dialog'; document.body.append(dialog); }">
          <span role="combobox" tabindex="0" aria-controls="product-options" aria-expanded="false"
            style="display:block;width:100%;height:100%"></span>
        </div>
        <div id="product-options" role="listbox" hidden></div>
      </section>
      <script>
        const combobox = document.querySelector('#product [role="combobox"]');
        combobox.addEventListener('click', () => {
          combobox.setAttribute('aria-expanded', 'true');
          const list = document.querySelector('#product-options');
          list.innerHTML = '<div role="option">Desired product</div>';
          list.hidden = false;
          list.querySelector('[role="option"]').addEventListener('click', () => {
            combobox.textContent = 'Desired product';
            combobox.setAttribute('aria-expanded', 'false');
            list.hidden = true;
          });
        });
      </script>
    `);
    const snapshot = {
      version: "1.0",
      url: "http://localhost/requests/1/edit",
      title: "fixture",
      capturedAt: new Date(0).toISOString(),
      elements: [{
        id: "product-owner",
        type: "text",
        tagName: "div",
        nearbyText: "Product",
        visible: true,
        candidateLocators: [{ strategy: "css", value: "#product", confidence: 0.9 }],
        dataHints: [],
        actionability: "FRAMEWORK_ACTIONABLE",
        cursor: "pointer",
        pointerEvents: "auto",
      }],
      summary: { totalElements: 1, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    } as PageSnapshot;

    const result = await resolveActionTarget(page, snapshot, "Desired product", {
      actionType: "action_select",
      recordingActionType: "click",
      selectionField: "Product",
      associatedField: "Product",
      selectionValue: "Desired product",
      recordedTechnicalTargetRefs: ["role:option|Desired product"],
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.selectionApplied, true);
    assert.equal(result.selectionDiagnostics?.triggerStrategy, "unique_snapshot_field_owner_semantic_descendant");
    assert.equal(await page.getByRole("combobox").innerText(), "Desired product");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.evaluate(() => (window as any).wrapperClicks ?? 0), 0);
  } finally {
    await browser.close();
  }
});

test("recorded selection verifies the value when a custom combobox renames itself after selection", { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3_000);
    await page.setContent(`
      <section>
        <span role="combobox" aria-label="Seleccione una opción" aria-controls="options" aria-expanded="false"
          style="display:block;width:260px;height:40px;border:1px solid;cursor:pointer">Seleccione una opción</span>
        <div id="options" role="listbox" hidden>
          <div role="option">PRÉSTAMOS PERSONALES NUEVOS</div>
          <div role="option">PRÉSTAMOS PERSONALES EXISTENTES</div>
        </div>
      </section>
      <script>
        const combo = document.querySelector('[role="combobox"]');
        const list = document.querySelector('#options');
        combo.addEventListener('click', () => { combo.setAttribute('aria-expanded', 'true'); list.hidden = false; });
        for (const option of list.querySelectorAll('[role="option"]')) option.addEventListener('click', () => {
          combo.textContent = option.textContent;
          combo.setAttribute('aria-label', option.textContent);
          combo.setAttribute('aria-expanded', 'false');
          list.hidden = true;
        });
      </script>
    `);
    const snapshot = {
      version: "1.0",
      url: "http://localhost/requests/1/edit",
      title: "fixture",
      capturedAt: new Date(0).toISOString(),
      elements: [],
      summary: { totalElements: 0, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    } as PageSnapshot;

    const result = await resolveActionTarget(page, snapshot, "PRÉSTAMOS PERSONALES NUEVOS", {
      actionType: "action_select",
      recordingActionType: "click",
      selectionField: "Seleccione una opción",
      associatedField: "Seleccione una opción",
      selectionValue: "PRÉSTAMOS PERSONALES NUEVOS",
      recordedTechnicalTargetRefs: ["role:option|PRÉSTAMOS PERSONALES NUEVOS"],
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.selectionApplied, true);
    assert.equal(result.selectionDiagnostics?.stateVerified, true);
    assert.equal(await page.getByRole("combobox", { name: "PRÉSTAMOS PERSONALES NUEVOS", exact: true }).count(), 1);
    assert.equal(await page.getByRole("listbox").isVisible(), false);
  } finally {
    await browser.close();
  }
});

test("selection fails closed when activation opens an unrelated dialog instead of its options", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3_000);
    await page.setContent(`
      <span id="product-label">Product</span>
      <div id="product" style="display:block;width:240px;height:40px;cursor:pointer;border:1px solid">
        <span role="combobox" tabindex="0" aria-labelledby="product-label"></span>
      </div>
      <script>
        document.querySelector('#product').addEventListener('click', () => {
          window.productClicks = (window.productClicks || 0) + 1;
          const dialog = document.createElement('div');
          dialog.setAttribute('role', 'dialog');
          dialog.textContent = 'Applicant details';
          document.body.append(dialog);
        });
      </script>
    `);
    const snapshot = {
      version: "1.0",
      url: "http://localhost/requests/1/edit",
      title: "fixture",
      capturedAt: new Date(0).toISOString(),
      elements: [{
        id: "product-owner",
        type: "text",
        tagName: "div",
        nearbyText: "Product",
        visible: true,
        candidateLocators: [{ strategy: "css", value: "#product", confidence: 0.9 }],
        dataHints: [],
        actionability: "FRAMEWORK_ACTIONABLE",
        cursor: "pointer",
        pointerEvents: "auto",
      }],
      summary: { totalElements: 1, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    } as PageSnapshot;

    const result = await resolveActionTarget(page, snapshot, "Desired product", {
      actionType: "action_select",
      recordingActionType: "click",
      selectionField: "Product",
      associatedField: "Product",
      selectionValue: "Desired product",
    });

    assert.equal(result.status, "not_found");
    assert.equal(result.selectionDiagnostics?.failureReason, "unexpected_dialog_opened");
    assert.equal(await page.getByRole("dialog").count(), 1);
    assert.equal(await page.evaluate(() => (window as any).productClicks ?? 0), 1);
  } finally {
    await browser.close();
  }
});

test("recorded selection resolves a unique target across multiple causally opened listboxes", { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3_000);
    await page.setContent(`
      <span id="product-label">Product</span>
      <div id="product" role="combobox" aria-label="Product" aria-expanded="false"
        style="display:block;width:260px;height:40px;border:1px solid;cursor:pointer">Select a product</div>
      <div id="unrelated-options" role="listbox" hidden>
        <div role="option" onclick="window.unrelatedClicks = (window.unrelatedClicks || 0) + 1">Different product</div>
      </div>
      <div id="product-options" role="listbox" hidden>
        <div role="option" onclick="const field=document.querySelector('#product');field.textContent='Requested product';field.setAttribute('aria-label','Requested product');document.querySelector('#product-options').hidden=true;window.productOptionClicks=(window.productOptionClicks||0)+1">Requested product</div>
      </div>
      <script>
        document.querySelector('#product').addEventListener('click', () => {
          document.querySelector('#product').setAttribute('aria-expanded', 'true');
          document.querySelector('#unrelated-options').hidden = false;
          document.querySelector('#product-options').hidden = false;
        });
      </script>
    `);
    const snapshot = {
      version: "1.0",
      url: "http://localhost/requests/1/edit",
      title: "fixture",
      capturedAt: new Date(0).toISOString(),
      elements: [],
      summary: { totalElements: 0, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    } as PageSnapshot;

    const result = await resolveActionTarget(page, snapshot, "Requested product", {
      actionType: "action_select",
      recordingActionType: "click",
      selectionField: "Product",
      associatedField: "Product",
      selectionValue: "Requested product",
      recordedTechnicalTargetRefs: ["role:option|Requested product"],
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.selectionApplied, true);
    assert.equal(result.selectionDiagnostics?.stateVerified, true);
    assert.equal(await page.locator("#product").innerText(), "Requested product");
    assert.equal(await page.evaluate(() => (window as any).productOptionClicks ?? 0), 1);
    assert.equal(await page.evaluate(() => (window as any).unrelatedClicks ?? 0), 0);
  } finally {
    await browser.close();
  }
});

test("recorded selection fails closed when multiple causally opened listboxes contain the target", { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3_000);
    await page.setContent(`
      <div id="product" role="combobox" aria-label="Product" aria-expanded="false"
        style="display:block;width:260px;height:40px;border:1px solid;cursor:pointer">Select a product</div>
      <div id="options-a" role="listbox" hidden><div role="option" onclick="window.optionAClicks=(window.optionAClicks||0)+1">Requested product</div></div>
      <div id="options-b" role="listbox" hidden><div role="option" onclick="window.optionBClicks=(window.optionBClicks||0)+1">Requested product</div></div>
      <script>
        document.querySelector('#product').addEventListener('click', () => {
          document.querySelector('#options-a').hidden = false;
          document.querySelector('#options-b').hidden = false;
        });
      </script>
    `);
    const snapshot = {
      version: "1.0",
      url: "http://localhost/requests/1/edit",
      title: "fixture",
      capturedAt: new Date(0).toISOString(),
      elements: [],
      summary: { totalElements: 0, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    } as PageSnapshot;

    const result = await resolveActionTarget(page, snapshot, "Requested product", {
      actionType: "action_select",
      recordingActionType: "click",
      selectionField: "Product",
      associatedField: "Product",
      selectionValue: "Requested product",
      recordedTechnicalTargetRefs: ["role:option|Requested product"],
    });

    assert.equal(result.status, "ambiguous");
    assert.equal(result.selectionDiagnostics?.failureReason, "ambiguous_option");
    assert.equal(await page.evaluate(() => (window as any).optionAClicks ?? 0), 0);
    assert.equal(await page.evaluate(() => (window as any).optionBClicks ?? 0), 0);
  } finally {
    await browser.close();
  }
});

test("nested popup wrappers describe one physical recorded option", { timeout: 15000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(2000);
    await page.setContent(`
      <button id="product" role="combobox" aria-label="Product"
        onclick="document.querySelector('#options').hidden=false">Choose</button>
      <div id="options" role="listbox" hidden><div role="presentation"><div role="group">
        <div role="option" onclick="document.querySelector('#product').textContent='Requested product';document.querySelector('#options').hidden=true;window.clicks=(window.clicks||0)+1">Requested product</div>
      </div></div></div>`);
    const snapshot = { version: "1.0", url: "http://localhost/", title: "fixture",
      capturedAt: new Date(0).toISOString(), elements: [],
      summary: { totalElements: 0, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 } } as PageSnapshot;
    const result = await resolveActionTarget(page, snapshot, "Requested product", {
      actionType: "action_select", recordingActionType: "click",
      selectionField: "Product", associatedField: "Product", selectionValue: "Requested product",
      recordedTechnicalTargetRefs: ["role:option|Requested product"],
    });
    assert.equal(result.status, "resolved");
    assert.equal(result.selectionApplied, true);
    assert.equal(result.selectionDiagnostics?.stateVerified, true);
    assert.equal(await page.evaluate(() => (window as any).clicks), 1);
  } finally { await browser.close(); }
});
