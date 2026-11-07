import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import type { PageSnapshot } from "../types/page-snapshot.types";
import { resolveFillTarget, resolveSelectionSearchInput } from "./target-resolver";

const snapshot: PageSnapshot = {
  version: "1.0",
  url: "http://localhost/",
  title: "fixture",
  capturedAt: new Date(0).toISOString(),
  elements: [{
    id: "owner",
    type: "input",
    role: "combobox",
    tagName: "input",
    label: "Category",
    visible: true,
    candidateLocators: [{ strategy: "label", value: "Category", exact: true, confidence: 0.9 }],
    dataHints: [],
    actionability: "NATIVE_ACTIONABLE",
  }],
  summary: { totalElements: 1, buttons: 0, links: 0, inputs: 1, selects: 0, tables: 0, dialogs: 0, headings: 0 },
};

test("selection query resolves only the unique editable input in its owner's controlled surface", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <label for="owner">Category</label>
      <input id="owner" role="combobox" aria-expanded="true" aria-controls="category-list">
      <ul id="category-list" role="listbox"><li><input type="search" aria-label="Search options"></li></ul>
      <input aria-label="Unrelated search">
    `);
    const result = await resolveSelectionSearchInput(page, snapshot, "Category");
    assert.equal(result?.strategy, "recorded_selection_owner_controlled_search");
    await result!.locator.fill("employee");
    assert.equal(await page.locator("#category-list input").inputValue(), "employee");
    assert.equal(await page.getByLabel("Unrelated search").inputValue(), "");
  } finally {
    await browser.close();
  }
});

test("selection query follows the unique nested combobox when field resolution returns its wrapper", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div id="owner-wrapper" aria-label="Category">
        <span>Category</span>
        <div role="combobox" aria-expanded="true" aria-controls="category-list"></div>
      </div>
      <ul id="category-list" role="listbox"><li><input type="search" aria-label="Search options"></li></ul>
    `);
    const wrapperSnapshot: PageSnapshot = {
      ...snapshot,
      elements: [{
        ...snapshot.elements[0],
        type: "section",
        role: undefined,
        tagName: "div",
        candidateLocators: [{ strategy: "css", value: "#owner-wrapper", confidence: 0.9 }],
      }],
      summary: { ...snapshot.summary, inputs: 0 },
    };
    const result = await resolveSelectionSearchInput(page, wrapperSnapshot, "Category");
    assert.equal(result?.strategy, "recorded_selection_owner_controlled_search");
    await result!.locator.fill("official");
    assert.equal(await page.locator("#category-list input").inputValue(), "official");
  } finally {
    await browser.close();
  }
});

test("selection query resolves one editable field in the unique visible portalized listbox container", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section id="owner-wrapper"><span>Activity category</span><div role="combobox"></div></section>
      <div id="popup"><input type="text" aria-label="2577 results are available"><ul role="listbox"><li role="option">Employees</li></ul></div>
    `);
    const wrapperSnapshot: PageSnapshot = {
      ...snapshot,
      elements: [{
        ...snapshot.elements[0],
        type: "section",
        role: undefined,
        tagName: "section",
        label: "Activity category",
        candidateLocators: [{ strategy: "css", value: "#owner-wrapper", confidence: 0.9 }],
      }],
      summary: { ...snapshot.summary, inputs: 0 },
    };
    const result = await resolveSelectionSearchInput(page, wrapperSnapshot, "Activity category");
    assert.equal(result?.strategy, "recorded_selection_unique_portal_query");
    await result!.locator.fill("employee");
    assert.equal(await page.getByLabel("2577 results are available").evaluate((element) => (element as HTMLInputElement).value), "employee");
  } finally {
    await browser.close();
  }
});

test("fill resolver routes a recorded transient query to the unique portalized search input", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section id="owner-wrapper"><span>Activity category</span><div role="combobox"></div></section>
      <div id="popup"><input type="text" aria-label="2577 results are available"><ul role="listbox"><li role="option">Employees</li></ul></div>
    `);
    const wrapperSnapshot: PageSnapshot = {
      ...snapshot,
      elements: [{
        ...snapshot.elements[0],
        type: "section",
        role: undefined,
        tagName: "section",
        label: "Activity category",
        candidateLocators: [{ strategy: "css", value: "#owner-wrapper", confidence: 0.9 }],
      }],
      summary: { ...snapshot.summary, inputs: 0 },
    };
    const result = await resolveFillTarget(page, wrapperSnapshot, "Activity category", undefined, {
      associatedField: "Activity category",
      selectionQueryOwnerField: "Activity category",
    });
    assert.equal(result.status, "resolved");
    assert.equal(result.locatorStrategy, "recorded_selection_unique_portal_query");
    await result.locator!.fill("employee");
    assert.equal(await page.getByLabel("2577 results are available").evaluate((element) => (element as HTMLInputElement).value), "employee");
  } finally {
    await browser.close();
  }
});

test("selection query opens the recorded owner before resolving its portalized search field", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section id="owner-wrapper" onclick="document.querySelector('#popup').hidden = false">
        <span>Activity category</span><div role="combobox" style="width: 200px; height: 30px"></div>
      </section>
      <div id="popup" hidden><input type="text" aria-label="Search available options"><ul role="listbox"><li role="option">Employees</li></ul></div>
    `);
    const wrapperSnapshot: PageSnapshot = {
      ...snapshot,
      elements: [{
        ...snapshot.elements[0],
        type: "section",
        role: undefined,
        tagName: "section",
        label: "Activity category",
        candidateLocators: [{ strategy: "css", value: "#owner-wrapper", confidence: 0.9 }],
      }],
      summary: { ...snapshot.summary, inputs: 0 },
    };
    const result = await resolveSelectionSearchInput(page, wrapperSnapshot, "Activity category");
    assert.equal(result?.strategy, "recorded_selection_unique_portal_query");
    await result!.locator.fill("employee");
    assert.equal(await page.getByLabel("Search available options").evaluate((element) => (element as HTMLInputElement).value), "employee");
  } finally {
    await browser.close();
  }
});

test("selection query fails closed when the controlled surface has multiple search inputs", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <label for="owner">Category</label>
      <input id="owner" role="combobox" aria-expanded="true" aria-controls="category-list">
      <ul id="category-list" role="listbox">
        <li><input type="search" aria-label="Search one"></li>
        <li><input type="search" aria-label="Search two"></li>
      </ul>
    `);
    assert.equal(await resolveSelectionSearchInput(page, snapshot, "Category"), undefined);
  } finally {
    await browser.close();
  }
});

test("selection query rejects an ARIA combobox container that is not a fillable element", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <label for="owner">Category</label>
      <input id="owner" role="combobox" aria-expanded="true" aria-controls="category-list">
      <div id="category-list" role="listbox"><div role="combobox" aria-label="Search options">Search options</div><div role="option">Employee</div></div>
    `);
    assert.equal(await resolveSelectionSearchInput(page, snapshot, "Category"), undefined);
  } finally {
    await browser.close();
  }
});
