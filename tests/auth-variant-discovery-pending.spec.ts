import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { selectPendingVariants, isSafeVariantCandidate, discoverAndPersistPendingVariant } from "../src/discovery/auth-variant-discovery";
import { listAuthVariantKnowledge } from "../src/knowledge/auth-variant-persister";

const SLUG = "test-variant-discovery-temp";
function kp() { return path.join(process.cwd(), "automations", "apps", SLUG, "app.knowledge.json"); }
function clean(){ try{ const p=kp(); if(fs.existsSync(p)) fs.unlinkSync(p); const d=path.dirname(p); if(fs.existsSync(d)&&fs.readdirSync(d).length===0) fs.rmdirSync(d);}catch{} }
test.beforeEach(()=>clean());
test.afterEach(()=>clean());

test("TEST1 Variant B only fulfills requiredFields -> pending", async () => {
  const required = ["Company ID","User","Password"];
  const before = ["User","Password"];
  const candidates = [
    { variantLabel: "Variant A", sourceScreenKey:"screen1", observedFieldsAfter: ["User","Password"], role:"tab" },
    { variantLabel: "Variant B", sourceScreenKey:"screen1", observedFieldsAfter: ["Company ID","User","Password"], role:"tab" },
  ];
  const selected = selectPendingVariants(required, before, candidates as any);
  expect(selected.length).toBe(1);
  expect(selected[0].variantLabel).toBe("Variant B");
  // persist via discoverAndPersistPendingVariant with mock deps
  const snapshotBefore: any = { screenKey:"screen1", inputLabels: before, observedControls: [{label:"Variant A", role:"tab"}, {label:"Variant B", role:"tab"}] };
  const afterMap: any = {
    "Variant A": { screenKey:"screen1", inputLabels: ["User","Password"] },
    "Variant B": { screenKey:"screen1", inputLabels: ["Company ID","User","Password"] },
  };
  const result = await discoverAndPersistPendingVariant(SLUG, snapshotBefore, required, {
    getCandidates: (snap)=> [{variantLabel:"Variant A", sourceScreenKey:"screen1", role:"tab"}, {variantLabel:"Variant B", sourceScreenKey:"screen1", role:"tab"}],
    clickCandidate: async (c)=> afterMap[c.variantLabel],
    restoreState: async ()=> snapshotBefore,
  });
  expect(result.persisted).toBe(1);
  const list = listAuthVariantKnowledge(SLUG);
  expect(list.length).toBe(1);
  expect((list[0] as any).variantLabel).toBe("Variant B");
  expect((list[0] as any).validationStatus).toBe("pending");
  expect((list[0] as any).trustedForReuse).toBe(false);
});

test("TEST2 ambiguous generic buttons -> 0 clicks", async () => {
  const required = ["RNC","Usuario"];
  const before = ["Usuario"];
  const candidates = [
    { variantLabel:"Forgot password", sourceScreenKey:"s1", observedFieldsAfter:["Usuario"], role:"button"},
    { variantLabel:"Help", sourceScreenKey:"s1", observedFieldsAfter:["Usuario"], role:"button"},
  ];
  // isSafe should be false for button
  expect(isSafeVariantCandidate({role:"button", label:"Forgot password"})).toBe(false);
  const selected = selectPendingVariants(required, before, candidates as any);
  expect(selected.length).toBe(0);
  const snapshotBefore: any = { screenKey:"s1", inputLabels: before };
  const result = await discoverAndPersistPendingVariant(SLUG, snapshotBefore, required, {
    getCandidates: (snap)=> [{variantLabel:"Forgot password", sourceScreenKey:"s1", role:"button"}, {variantLabel:"Help", sourceScreenKey:"s1", role:"button"}],
    clickCandidate: async ()=> { throw new Error("should not click"); },
    restoreState: async ()=> snapshotBefore,
  });
  expect(result.persisted).toBe(0);
  expect(result.failClosed).toBe(true);
  expect(listAuthVariantKnowledge(SLUG).length).toBe(0);
});

test("TEST3 A fails restore then B satisfies -> only B persisted", async () => {
  const required = ["Company ID","User","Password"];
  const before = ["User"];
  const snapshotBefore: any = { screenKey:"screen1", inputLabels: before };
  const afterMap: any = {
    "Variant A": { screenKey:"screen1", inputLabels: ["User"] },
    "Variant B": { screenKey:"screen1", inputLabels: ["Company ID","User","Password"] },
  };
  let restoreCalls=0;
  const result = await discoverAndPersistPendingVariant(SLUG, snapshotBefore, required, {
    getCandidates: (snap)=> [{variantLabel:"Variant A", sourceScreenKey:"screen1", role:"tab"}, {variantLabel:"Variant B", sourceScreenKey:"screen1", role:"tab"}],
    clickCandidate: async (c)=> afterMap[c.variantLabel],
    restoreState: async ()=> { restoreCalls++; return snapshotBefore; },
  });
  expect(result.persisted).toBe(1);
  expect(restoreCalls).toBe(2); // after each candidate
  const list = listAuthVariantKnowledge(SLUG);
  expect(list.length).toBe(1);
  expect((list[0] as any).variantLabel).toBe("Variant B");
  expect((list[0] as any).validationStatus).toBe("pending");
});
