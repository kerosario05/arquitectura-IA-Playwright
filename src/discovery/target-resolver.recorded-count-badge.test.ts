import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget } from "./target-resolver";
import type { PageSnapshot } from "../types/page-snapshot.types";

function buttonSnapshot(page: { url(): string }, names: string[]): PageSnapshot {
  return {
    version: "1.0",
    capturedAt: new Date().toISOString(),
    url: page.url(),
    title: "fixture",
    summary: { totalElements: names.length, buttons: names.length, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    elements: names.map((name, index) => ({
      id: `button-${index}`,
      type: "button",
      role: "button",
      tagName: "button",
      text: name,
      accessibleName: name,
      visible: true,
      disabled: false,
      candidateLocators: [],
      dataHints: [],
    })),
  } as PageSnapshot;
}

test("a unique recorded button can resolve when its separated count badge is absent", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="document-management">Gestión Documental</button>');
    const result = await resolveActionTarget(page, buttonSnapshot(page, ["Gestión Documental"]), "Gestión Documental 9", {
      actionType: "action_click",
      recordingActionType: "click",
      recordedTechnicalTargetRefs: ["role:button|Gestión Documental 9"],
    });
    assert.equal(result.status, "resolved");
    assert.equal(await result.locator?.getAttribute("id"), "document-management");
  } finally {
    await browser.close();
  }
});

test("a missing badge does not make a spaced numeric label ambiguous match win", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent([
      '<button id="plain">Gestión Documental</button>',
      '<button id="counted">Gestión Documental 4</button>',
    ].join(""));
    const result = await resolveActionTarget(page, buttonSnapshot(page, ["Gestión Documental", "Gestión Documental 4"]), "Gestión Documental 9", {
      actionType: "action_click",
      recordingActionType: "click",
      recordedTechnicalTargetRefs: ["role:button|Gestión Documental 9"],
    });
    assert.notEqual(result.status, "resolved");
    assert.equal(result.locator, undefined);
  } finally {
    await browser.close();
  }
});
