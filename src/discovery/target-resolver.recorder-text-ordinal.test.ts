import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { resolvePlaywrightRecorderTarget } from "./target-resolver";

const cards = `
<div id="c1" onclick="this.dataset.picked='1'"><b>HUMANO</b><div>RD$222.72</div></div>
<div id="c2" onclick="this.dataset.picked='1'"><b>MAPFRE</b><div>RD$222.72</div></div>
<div id="c3" onclick="this.dataset.picked='1'"><b>OTRO</b><div>RD$310.00</div></div>`;

async function resolveWith(html: string, evidence: Record<string, unknown>) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const resolved = await resolvePlaywrightRecorderTarget(page, { kind: "text", normalizedName: "RD$222.72", targetTag: "div", runtimeResolutionRequired: true, ...evidence } as never);
    if (resolved) await resolved.locator.click();
    const picked = await page.locator("[data-picked]").evaluateAll((nodes) => nodes.map((node) => node.id));
    return { resolved, picked };
  } finally {
    await browser.close();
  }
}

test("same text on several cards: the recorded position selects that card when the live count matches", async () => {
  const { resolved, picked } = await resolveWith(cards, { textMatchOrdinal: { index: 1, count: 2 } });
  assert.ok(resolved);
  assert.equal(resolved.strategy, "recorded:recorder-text-ordinal");
  assert.deepEqual(picked, ["c2"]);
});

test("a person-confirmed position without a count selects that card by position alone", async () => {
  const { resolved, picked } = await resolveWith(cards, { textMatchOrdinal: { index: 0 } });
  assert.ok(resolved);
  assert.deepEqual(picked, ["c1"]);
});

test("same text on several cards without a recorded position stays unresolved", async () => {
  const { resolved } = await resolveWith(cards, {});
  assert.equal(resolved, undefined);
});

const taskRow = `
<h3>Gestión Documentos Desembolso</h3>
<table><tr><td onclick="this.dataset.picked='1'" id="cell">Gestión Documentos Desembolso</td><td>MPN-1</td></tr></table>
<div role="tooltip" style="display:none"><span>Gestión Documentos Desembolso</span></div>`;

test("a text shared with elements of other tags resolves to the single visible element of the recorded tag", async () => {
  const { resolved, picked } = await resolveWith(taskRow, { normalizedName: "Gestión Documentos Desembolso", targetTag: "td", promotedTitle: true });
  assert.ok(resolved);
  assert.deepEqual(picked, ["cell"]);
});

test("the recorded tag does not disambiguate when several visible elements of that tag share the text", async () => {
  const twoCells = taskRow.replace("<td>MPN-1</td>", "<td>Gestión Documentos Desembolso</td>");
  const { resolved } = await resolveWith(twoCells, { normalizedName: "Gestión Documentos Desembolso", targetTag: "td" });
  assert.equal(resolved, undefined);
});

test("a recorded position never applies when the live match count differs", async () => {
  const { resolved } = await resolveWith(cards, { textMatchOrdinal: { index: 1, count: 3 } });
  assert.equal(resolved, undefined);
});
