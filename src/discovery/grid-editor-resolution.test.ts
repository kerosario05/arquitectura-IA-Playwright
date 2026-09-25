import assert from "node:assert/strict";
import { chromium, type Page } from "@playwright/test";
import { resolveFillTarget, resolveGridEditor } from "./target-resolver";

const EMPTY_SNAPSHOT = { elements: [] } as any;

async function withPage(run: (page: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await run(page);
  } finally {
    await browser.close();
  }
}

async function grid(page: Page, header: string, cell: string): Promise<void> {
  await page.setContent(`
    <style>table { border-collapse: collapse; } th, td { width: 220px; height: 48px; border: 1px solid #aaa; }</style>
    <table><thead><tr><th>${header}</th></tr></thead><tbody><tr><td>${cell}</td></tr></tbody></table>
  `);
}

async function check(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`  PASS  ${label}`);
  } catch (error) {
    console.error(`  FAIL  ${label}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  await check("PARENT_WITH_EDITABLE_CHILD", () => withPage(async (page) => {
    await grid(page, "Field", `<div role="textbox"><input id="current" type="text"></div>`);
    const result = await resolveGridEditor(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
    assert.ok(result.locator);
    assert.equal(await result.locator.evaluate((el) => el.tagName.toLowerCase()), "input");
  }));

  await check("EDITOR_MATERIALIZES_AFTER_PREREQUISITE", () => withPage(async (page) => {
    await page.setContent(`
      <button id="prerequisite" onclick="document.querySelector('td').innerHTML='<input id=materialized type=text>'">Prepare</button>
      <table><thead><tr><th>Field</th></tr></thead><tbody><tr><td>placeholder</td></tr></tbody></table>
    `);
    const before = await resolveGridEditor(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
    assert.equal(before.locator, undefined);
    await page.locator("#prerequisite").click();
    const after = await resolveGridEditor(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
    assert.ok(after.locator);
    assert.equal(after.diagnostics.editorInitiallyPresent, true);
    assert.equal(await after.locator.evaluate((el) => el.id), "materialized");
  }));

  await check("STALE_RECORDED_CHILD", () => withPage(async (page) => {
    await grid(page, "Field", `<input id="current" type="text">`);
    const result = await resolveFillTarget(page, EMPTY_SNAPSHOT, "Field", undefined, {
      rowScope: 1,
      entityScope: "entity_1",
      recordedTechnicalTargets: [{
        targetType: "editable",
        structuralContext: { gridRef: "grid:table", rowRef: "row:1", cellRef: "cell:Field:row:1" },
        locatorCandidates: [{ strategy: "css", value: "#stale", confidence: 0.95 }],
      } as any],
    });
    assert.equal(result.status, "resolved");
    assert.equal(result.locatorStrategy, "grid_cell_editor");
    assert.equal(await result.locator!.getAttribute("id"), "current");
  }));

  await check("MULTIPLE_EDITABLE_CHILDREN", () => withPage(async (page) => {
    await grid(page, "Field", `<input id="one" type="text"><input id="two" type="text">`);
    const result = await resolveGridEditor(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
    assert.equal(result.locator, undefined);
    assert.equal(result.ambiguous, true);
  }));

  await check("READONLY_CHILD", () => withPage(async (page) => {
    await grid(page, "Field", `<input id="readonly" type="text" readonly>`);
    const result = await resolveGridEditor(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
    assert.equal(result.locator, undefined);
    assert.equal(result.diagnostics.candidates?.[0]?.readOnly, true);
  }));

  await check("DISABLED_CHILD_THEN_ENABLED", () => withPage(async (page) => {
    await grid(page, "Field", `<input id="later" type="text" disabled>`);
    const before = await resolveGridEditor(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
    assert.equal(before.locator, undefined);
    await page.locator("#later").evaluate((element) => element.removeAttribute("disabled"));
    const after = await resolveGridEditor(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
    assert.ok(after.locator);
    assert.equal(await after.locator.getAttribute("id"), "later");
  }));

  await check("CONTENTEDITABLE", () => withPage(async (page) => {
    await grid(page, "Field", `<div id="editor" contenteditable="true"></div>`);
    const result = await resolveGridEditor(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
    assert.ok(result.locator);
    assert.equal(await result.locator.getAttribute("contenteditable"), "true");
  }));

  await check("NO_EDITABLE_DESCENDANT", () => withPage(async (page) => {
    await grid(page, "Field", "display only");
    const result = await resolveGridEditor(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
    assert.equal(result.locator, undefined);
  }));

  await check("DISPLAY_PREREQUISITE_RESOLVES_STRUCTURAL_CONTROL", () => withPage(async (page) => {
    await grid(page, "Field", `<button type="button">Indicar...</button>`);
    const result = await resolveGridEditor(page, "Field", { rowScope: 1 }, { includeInteractiveControls: true });
    assert.ok(result.locator);
    assert.equal(await result.locator.evaluate((el) => el.tagName.toLowerCase()), "button");
  }));

  await check("FILL_ACTIVATES_DISPLAY_CONTROL_THEN_RESOLVES_EDITOR", () => withPage(async (page) => {
    await page.setContent(`
      <table><thead><tr><th>Field</th></tr></thead><tbody><tr><td>
        <button id="display" type="button" onclick="this.parentElement.innerHTML='<input id=materialized type=text>'">Indicar...</button>
      </td></tr></tbody></table>
    `);
    const result = await resolveFillTarget(page, EMPTY_SNAPSHOT, "Field", undefined, {
      rowScope: 1,
      entityScope: "entity_1",
    });
    assert.equal(result.status, "resolved");
    assert.equal(await result.locator!.getAttribute("id"), "materialized");
  }));

  await check("UNRELATED_INPUT_NEARBY", () => withPage(async (page) => {
    await page.setContent(`
      <input id="nearby" type="text">
      <table><thead><tr><th>Field A</th><th>Field B</th></tr></thead><tbody><tr><td><input id="a" type="text"></td><td><input id="b" type="text"></td></tr></tbody></table>
    `);
    const result = await resolveGridEditor(page, "Field A", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
    assert.ok(result.locator);
    assert.equal(await result.locator.getAttribute("id"), "a");
  }));
}

void main();
