"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const test_1 = require("@playwright/test");
const target_resolver_1 = require("./target-resolver");
const EMPTY_SNAPSHOT = { elements: [] };
async function withPage(run) {
    const browser = await test_1.chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await run(page);
    }
    finally {
        await browser.close();
    }
}
async function grid(page, header, cell) {
    await page.setContent(`
    <style>table { border-collapse: collapse; } th, td { width: 220px; height: 48px; border: 1px solid #aaa; }</style>
    <table><thead><tr><th>${header}</th></tr></thead><tbody><tr><td>${cell}</td></tr></tbody></table>
  `);
}
async function check(label, run) {
    try {
        await run();
        console.log(`  PASS  ${label}`);
    }
    catch (error) {
        console.error(`  FAIL  ${label}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}
async function main() {
    await check("PARENT_WITH_EDITABLE_CHILD", () => withPage(async (page) => {
        await grid(page, "Field", `<div role="textbox"><input id="current" type="text"></div>`);
        const result = await (0, target_resolver_1.resolveGridEditor)(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
        strict_1.default.ok(result.locator);
        strict_1.default.equal(await result.locator.evaluate((el) => el.tagName.toLowerCase()), "input");
    }));
    await check("EDITOR_MATERIALIZES_AFTER_PREREQUISITE", () => withPage(async (page) => {
        await page.setContent(`
      <button id="prerequisite" onclick="document.querySelector('td').innerHTML='<input id=materialized type=text>'">Prepare</button>
      <table><thead><tr><th>Field</th></tr></thead><tbody><tr><td>placeholder</td></tr></tbody></table>
    `);
        const before = await (0, target_resolver_1.resolveGridEditor)(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
        strict_1.default.equal(before.locator, undefined);
        await page.locator("#prerequisite").click();
        const after = await (0, target_resolver_1.resolveGridEditor)(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
        strict_1.default.ok(after.locator);
        strict_1.default.equal(after.diagnostics.editorInitiallyPresent, true);
        strict_1.default.equal(await after.locator.evaluate((el) => el.id), "materialized");
    }));
    await check("STALE_RECORDED_CHILD", () => withPage(async (page) => {
        await grid(page, "Field", `<input id="current" type="text">`);
        const result = await (0, target_resolver_1.resolveFillTarget)(page, EMPTY_SNAPSHOT, "Field", undefined, {
            rowScope: 1,
            entityScope: "entity_1",
            recordedTechnicalTargets: [{
                    targetType: "editable",
                    structuralContext: { gridRef: "grid:table", rowRef: "row:1", cellRef: "cell:Field:row:1" },
                    locatorCandidates: [{ strategy: "css", value: "#stale", confidence: 0.95 }],
                }],
        });
        strict_1.default.equal(result.status, "resolved");
        strict_1.default.equal(result.locatorStrategy, "grid_cell_editor");
        strict_1.default.equal(await result.locator.getAttribute("id"), "current");
    }));
    await check("MULTIPLE_EDITABLE_CHILDREN", () => withPage(async (page) => {
        await grid(page, "Field", `<input id="one" type="text"><input id="two" type="text">`);
        const result = await (0, target_resolver_1.resolveGridEditor)(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
        strict_1.default.equal(result.locator, undefined);
        strict_1.default.equal(result.ambiguous, true);
    }));
    await check("READONLY_CHILD", () => withPage(async (page) => {
        await grid(page, "Field", `<input id="readonly" type="text" readonly>`);
        const result = await (0, target_resolver_1.resolveGridEditor)(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
        strict_1.default.equal(result.locator, undefined);
        strict_1.default.equal(result.diagnostics.candidates?.[0]?.readOnly, true);
    }));
    await check("DISABLED_CHILD_THEN_ENABLED", () => withPage(async (page) => {
        await grid(page, "Field", `<input id="later" type="text" disabled>`);
        const before = await (0, target_resolver_1.resolveGridEditor)(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
        strict_1.default.equal(before.locator, undefined);
        await page.locator("#later").evaluate((element) => element.removeAttribute("disabled"));
        const after = await (0, target_resolver_1.resolveGridEditor)(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
        strict_1.default.ok(after.locator);
        strict_1.default.equal(await after.locator.getAttribute("id"), "later");
    }));
    await check("CONTENTEDITABLE", () => withPage(async (page) => {
        await grid(page, "Field", `<div id="editor" contenteditable="true"></div>`);
        const result = await (0, target_resolver_1.resolveGridEditor)(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
        strict_1.default.ok(result.locator);
        strict_1.default.equal(await result.locator.getAttribute("contenteditable"), "true");
    }));
    await check("NO_EDITABLE_DESCENDANT", () => withPage(async (page) => {
        await grid(page, "Field", "display only");
        const result = await (0, target_resolver_1.resolveGridEditor)(page, "Field", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
        strict_1.default.equal(result.locator, undefined);
    }));
    await check("DISPLAY_PREREQUISITE_RESOLVES_STRUCTURAL_CONTROL", () => withPage(async (page) => {
        await grid(page, "Field", `<button type="button">Indicar...</button>`);
        const result = await (0, target_resolver_1.resolveGridEditor)(page, "Field", { rowScope: 1 }, { includeInteractiveControls: true });
        strict_1.default.ok(result.locator);
        strict_1.default.equal(await result.locator.evaluate((el) => el.tagName.toLowerCase()), "button");
    }));
    await check("FILL_ACTIVATES_DISPLAY_CONTROL_THEN_RESOLVES_EDITOR", () => withPage(async (page) => {
        await page.setContent(`
      <table><thead><tr><th>Field</th></tr></thead><tbody><tr><td>
        <button id="display" type="button" onclick="this.parentElement.innerHTML='<input id=materialized type=text>'">Indicar...</button>
      </td></tr></tbody></table>
    `);
        const result = await (0, target_resolver_1.resolveFillTarget)(page, EMPTY_SNAPSHOT, "Field", undefined, {
            rowScope: 1,
            entityScope: "entity_1",
        });
        strict_1.default.equal(result.status, "resolved");
        strict_1.default.equal(await result.locator.getAttribute("id"), "materialized");
    }));
    await check("UNRELATED_INPUT_NEARBY", () => withPage(async (page) => {
        await page.setContent(`
      <input id="nearby" type="text">
      <table><thead><tr><th>Field A</th><th>Field B</th></tr></thead><tbody><tr><td><input id="a" type="text"></td><td><input id="b" type="text"></td></tr></tbody></table>
    `);
        const result = await (0, target_resolver_1.resolveGridEditor)(page, "Field A", { rowScope: 1 }, { controlKind: "fill", allowActivation: false });
        strict_1.default.ok(result.locator);
        strict_1.default.equal(await result.locator.getAttribute("id"), "a");
    }));
}
void main();
