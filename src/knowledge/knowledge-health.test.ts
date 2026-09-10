import assert from "node:assert";
import { analyzeKnowledgeHealth } from "./knowledge-health";
import type { MobileKnowledgeItem } from "../mobile/mobile-knowledge-persister";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

function screen(over: Partial<MobileKnowledgeItem> = {}): MobileKnowledgeItem {
  return {
    knowledgeKind: "route_menu_snapshot",
    screenKey: "screen",
    clickTargets: ["Enviar código de validación", "Continuar"],
    assertionTargets: ["Hola"],
    observedControls: [{ label: "Continuar", enabled: true }],
    trustedForReuse: true,
    validationStatus: "validated",
    runCount: 1,
    ...over,
  } as MobileKnowledgeItem;
}

const ids = (r: ReturnType<typeof analyzeKnowledgeHealth>) => r.findings.map((f) => f.id);

describe("analyzeKnowledgeHealth", () => {
  test("an empty file fails, not warns — nothing can be generated from it", () => {
    const r = analyzeKnowledgeHealth([]);
    assert.strictEqual(r.severity, "fail");
    assert.ok(ids(r).includes("empty_knowledge"));
  });

  test("knowledge without a single screen fails — the exact shape of the kind mismatch", () => {
    const r = analyzeKnowledgeHealth([{ knowledgeKind: "route_transition" } as MobileKnowledgeItem]);
    assert.strictEqual(r.severity, "fail");
    assert.ok(ids(r).includes("no_screen_items"));
  });

  test("screens that exist but do not reach the generator are reported", () => {
    const r = analyzeKnowledgeHealth([screen(), screen({ screenKey: "otra", trustedForReuse: false })]);
    assert.ok(ids(r).includes("screens_not_readable"));
    assert.strictEqual(r.readableByGenerator, 1);
    assert.strictEqual(r.screenItems, 2);
  });

  test("one state per screen everywhere is flagged as probable collapse", () => {
    const r = analyzeKnowledgeHealth([screen(), screen({ screenKey: "otra" })]);
    assert.ok(ids(r).includes("no_multi_state_screens"));
  });

  test("two states of one screen clear that flag", () => {
    const r = analyzeKnowledgeHealth([
      screen({ observedControls: [{ label: "Continuar", enabled: false }] }),
      screen({ assertionTargets: ["Indica el código recibido"] }),
    ]);
    assert.ok(!ids(r).includes("no_multi_state_screens"));
    assert.strictEqual(r.screensWithMultipleStates, 1);
  });

  test("captures predating gate state are reported", () => {
    const r = analyzeKnowledgeHealth([screen({ observedControls: [{ label: "Continuar" }] })]);
    assert.ok(ids(r).includes("captures_without_gate_state"));
    assert.strictEqual(r.itemsMissingEnabledCapture, 1);
  });

  test("no disabled control anywhere is reported — the generator cannot see gates", () => {
    const r = analyzeKnowledgeHealth([screen()]);
    assert.ok(ids(r).includes("no_gate_evidence"));
  });

  test("healthy knowledge reports ok and nothing else", () => {
    const r = analyzeKnowledgeHealth([
      screen({ observedControls: [{ label: "Continuar", enabled: false }] }),
      screen({ assertionTargets: ["Indica el código recibido"], observedControls: [{ label: "Continuar", enabled: true }] }),
    ]);
    assert.strictEqual(r.severity, "ok");
    assert.deepStrictEqual(ids(r), ["healthy"]);
  });

  test("counts items by kind for the summary", () => {
    const r = analyzeKnowledgeHealth([screen(), { knowledgeKind: "route_transition" } as MobileKnowledgeItem]);
    assert.strictEqual(r.itemsByKind["route_menu_snapshot"], 1);
    assert.strictEqual(r.itemsByKind["route_transition"], 1);
  });

  test("reads the legacy kind name too, so old files are not called empty", () => {
    const r = analyzeKnowledgeHealth([screen({ knowledgeKind: "screen_observed" })]);
    assert.ok(!ids(r).includes("no_screen_items"));
    assert.strictEqual(r.readableByGenerator, 1);
  });
});
