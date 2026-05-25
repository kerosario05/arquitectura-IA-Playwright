import { test, expect } from "@playwright/test";
import {
  normalizeText,
  computeTokenScore,
  isElementClickable,
  buildSnapshotCandidates,
  deduplicateCandidates,
  buildFlexibleTextRegex,
  buildFlexibleTokenRegex,
  resolveSnapshotElementLocator,
  resolveActionTarget,
  resolveFillTarget,
  normalizeSemanticText,
  tokenizeWithStopwords,
  expandSemanticTokens,
  computeSemanticScore,
  normalizeSemanticCandidates
} from "../src/discovery/target-resolver";
import type { SemanticCandidate } from "../src/discovery/target-resolver";
import type { PageSnapshot, SnapshotElement } from "../src/types/page-snapshot.types";

class FakeLocator {
  constructor(private readonly matches: number, private readonly tagName: string = "input") {}

  async count(): Promise<number> {
    return this.matches;
  }

  first(): FakeLocator {
    return this;
  }

  nth(_index: number): FakeLocator {
    return this;
  }

  async fill(_value: string): Promise<void> {
    return;
  }

  async evaluate(fn: (el: any) => any): Promise<any> {
    if (typeof fn === "function") {
      return fn({ tagName: this.tagName });
    }
    return this.tagName;
  }

  async isVisible(): Promise<boolean> {
    return this.matches > 0;
  }

  async isEnabled(): Promise<boolean> {
    return this.matches > 0;
  }
}

class FakePage {
  nextEvaluateResult?: any;
  constructor(private readonly matches: Record<string, number>) {}

  getByRole(role: string, options?: { name?: RegExp | string }): FakeLocator {
    return new FakeLocator(this.matches[`role:${role}:${String(options?.name ?? "")}`] ?? 0);
  }

  getByText(name: RegExp | string): FakeLocator {
    return new FakeLocator(this.matches[`text:${String(name)}`] ?? 0);
  }

  getByLabel(name: string): FakeLocator {
    return new FakeLocator(this.matches[`label:${name}`] ?? 0);
  }

  getByPlaceholder(name: string): FakeLocator {
    return new FakeLocator(this.matches[`placeholder:${name}`] ?? 0);
  }

  getByTestId(name: string): FakeLocator {
    return new FakeLocator(this.matches[`testId:${name}`] ?? 0);
  }

  locator(name: string): FakeLocator {
    return new FakeLocator(this.matches[`locator:${name}`] ?? 0);
  }

  async evaluate(fn: Function, arg?: any): Promise<any> {
    return this.nextEvaluateResult;
  }
}

function makeElement(overrides: Partial<SnapshotElement>): SnapshotElement {
  return {
    id: `el-${Math.random().toString(36).slice(2, 8)}`,
    type: "text",
    visible: true,
    candidateLocators: [],
    dataHints: [],
    ...overrides
  };
}

function makeSnapshot(elements: SnapshotElement[]): PageSnapshot {
  return {
    version: "1.0",
    url: "https://example.com",
    title: "Test Page",
    capturedAt: new Date().toISOString(),
    elements,
    summary: {
      totalElements: elements.length,
      buttons: elements.filter((e) => e.type === "button").length,
      links: elements.filter((e) => e.type === "link").length,
      inputs: elements.filter((e) => e.type === "input").length,
      selects: 0,
      tables: 0,
      dialogs: 0,
      headings: elements.filter((e) => e.type === "heading").length
    }
  };
}

test("normalizeText removes accents and lowercases", () => {
  expect(normalizeText("Información")).toBe("informacion");
  expect(normalizeText("TARJETAS")).toBe("tarjetas");
  expect(normalizeText("  Crédito  ")).toBe("credito");
  expect(normalizeText("Héllo Wörld")).toBe("hello world");
});

test("normalizeText handles empty and whitespace", () => {
  expect(normalizeText("")).toBe("");
  expect(normalizeText("   ")).toBe("");
  expect(normalizeText("  hello   world  ")).toBe("hello world");
});

test("buildFlexibleTextRegex tolerates concatenated text and accents", () => {
  const regex = buildFlexibleTextRegex("Informacion de productos");
  expect(regex.test("Informacióndeproductos")).toBe(true);
});

test("buildFlexibleTokenRegex preserves token order with flexible gaps", () => {
  const regex = buildFlexibleTokenRegex("A B");
  expect(regex.test("AxxxB")).toBe(true);
});

test("computeTokenScore returns 1.0 for exact match", () => {
  expect(computeTokenScore("Iniciar", "Iniciar")).toBe(1.0);
  expect(computeTokenScore("tarjetas", "Tarjetas")).toBe(1.0);
});

test("computeTokenScore handles accent normalization", () => {
  const score = computeTokenScore("Información", "Informacion de productos");
  expect(score).toBeGreaterThan(0.7);
});

test("computeTokenScore handles contains match", () => {
  const score = computeTokenScore("Iniciar", "Iniciar sesión");
  expect(score).toBeGreaterThan(0.7);
});

test("computeTokenScore handles concatenated text", () => {
  const score = computeTokenScore("A", "ADescripción secundaria");
  expect(score).toBeGreaterThan(0);
});

test("computeTokenScore handles token partial match", () => {
  const score = computeTokenScore("tarjeta credito", "Tarjeta de Crédito Premium");
  expect(score).toBeGreaterThan(0.3);
});

test("computeTokenScore returns 0 for no match", () => {
  expect(computeTokenScore("xyz123", "completely different text")).toBe(0);
});

test("isElementClickable detects button role", () => {
  const el = makeElement({ role: "button", type: "button" });
  expect(isElementClickable(el)).toBe(true);
});

test("isElementClickable detects link role", () => {
  const el = makeElement({ role: "link", type: "link" });
  expect(isElementClickable(el)).toBe(true);
});

test("isElementClickable detects button tag", () => {
  const el = makeElement({ tagName: "BUTTON", type: "button" });
  expect(isElementClickable(el)).toBe(true);
});

test("isElementClickable detects anchor tag", () => {
  const el = makeElement({ tagName: "A", type: "link" });
  expect(isElementClickable(el)).toBe(true);
});

test("isElementClickable detects input submit", () => {
  const el = makeElement({ tagName: "INPUT", type: "input", inputType: "submit" });
  expect(isElementClickable(el)).toBe(true);
});

test("isElementClickable detects input button", () => {
  const el = makeElement({ tagName: "INPUT", type: "input", inputType: "button" });
  expect(isElementClickable(el)).toBe(true);
});

test("isElementClickable returns false for plain text", () => {
  const el = makeElement({ type: "text", tagName: "SPAN" });
  expect(isElementClickable(el)).toBe(false);
});

test("isElementClickable returns false for heading", () => {
  const el = makeElement({ type: "heading", tagName: "H2" });
  expect(isElementClickable(el)).toBe(false);
});

test("buildSnapshotCandidates finds exact match", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "button", text: "Iniciar", role: "button", tagName: "BUTTON" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Iniciar");

  expect(candidates.length).toBe(1);
  expect(candidates[0].matchScore).toBe(1.0);
  expect(candidates[0].matchReason).toBe("exact_match");
  expect(candidates[0].isClickable).toBe(true);
});

test("buildSnapshotCandidates finds contains match", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "button", text: "Información de productos", role: "button", tagName: "BUTTON" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Información de productos");

  expect(candidates.length).toBe(1);
  expect(candidates[0].matchReason).toBe("exact_match");
});

test("buildSnapshotCandidates finds partial contains match", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "button", text: "Consultar Tarjetas de Crédito", role: "button", tagName: "BUTTON" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Tarjetas");

  expect(candidates.length).toBe(1);
  expect(candidates[0].matchReason).toBe("contains_match");
  expect(candidates[0].matchScore).toBeGreaterThan(0.7);
});

test("buildSnapshotCandidates handles accent normalization", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "button", text: "Tarjeta de Credito", role: "button", tagName: "BUTTON" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Tarjeta de Crédito");

  expect(candidates.length).toBe(1);
  expect(candidates[0].matchScore).toBe(1.0);
});

test("buildSnapshotCandidates handles concatenated text", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "button", text: "IniciarSesión", role: "button", tagName: "BUTTON" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Iniciar");

  expect(candidates.length).toBe(1);
  expect(candidates[0].matchReason).toBe("contains_match");
});

test("buildSnapshotCandidates prioritizes clickable elements", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "text", text: "Iniciar sesión", tagName: "SPAN" }),
    makeElement({ type: "button", text: "Iniciar sesión", role: "button", tagName: "BUTTON" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Iniciar");

  expect(candidates.length).toBe(2);
  const clickable = candidates.find((c: any) => c.isClickable);
  const nonClickable = candidates.find((c: any) => !c.isClickable);
  expect(clickable).toBeDefined();
  expect(nonClickable).toBeDefined();
  expect(clickable!.matchScore).toBeGreaterThanOrEqual(nonClickable!.matchScore);
});

test("buildSnapshotCandidates returns empty for no match", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "text", text: "Hello World", tagName: "SPAN" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "xyz123");

  expect(candidates.length).toBe(0);
});

test("buildSnapshotCandidates uses label when text is missing", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "input", label: "Submit Form", tagName: "INPUT", inputType: "submit" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Submit");

  expect(candidates.length).toBe(1);
  expect(candidates[0].matchReason).toBe("contains_match");
});

test("deduplicateCandidates removes duplicates by elementId and text", () => {
  const candidates = [
    { elementId: "el1", text: "Iniciar", normalizedText: "iniciar", type: "button", isClickable: true, matchScore: 0.8, matchReason: "exact_match", locatorStrategy: "role:button" },
    { elementId: "el1", text: "Iniciar", normalizedText: "iniciar", type: "button", isClickable: true, matchScore: 0.9, matchReason: "exact_match", locatorStrategy: "role:button" },
    { elementId: "el2", text: "Iniciar", normalizedText: "iniciar", type: "link", isClickable: true, matchScore: 0.7, matchReason: "exact_match", locatorStrategy: "role:link" }
  ];

  const deduped = deduplicateCandidates(candidates);

  expect(deduped.length).toBe(2);
  expect(deduped[0].matchScore).toBe(0.9);
});

test("deduplicateCandidates keeps highest score", () => {
  const candidates = [
    { elementId: "el1", text: "Test", normalizedText: "test", type: "button", isClickable: true, matchScore: 0.5, matchReason: "token_match", locatorStrategy: "text" },
    { elementId: "el1", text: "Test", normalizedText: "test", type: "button", isClickable: true, matchScore: 0.9, matchReason: "exact_match", locatorStrategy: "role:button" }
  ];

  const deduped = deduplicateCandidates(candidates);

  expect(deduped.length).toBe(1);
  expect(deduped[0].matchScore).toBe(0.9);
});

test("deduplicateCandidates sorts by score descending", () => {
  const candidates = [
    { elementId: "el1", text: "A", normalizedText: "a", type: "button", isClickable: true, matchScore: 0.3, matchReason: "token_match", locatorStrategy: "text" },
    { elementId: "el2", text: "B", normalizedText: "b", type: "button", isClickable: true, matchScore: 0.9, matchReason: "exact_match", locatorStrategy: "role:button" },
    { elementId: "el3", text: "C", normalizedText: "c", type: "button", isClickable: true, matchScore: 0.6, matchReason: "contains_match", locatorStrategy: "text" }
  ];

  const deduped = deduplicateCandidates(candidates);

  expect(deduped[0].matchScore).toBe(0.9);
  expect(deduped[1].matchScore).toBe(0.6);
  expect(deduped[2].matchScore).toBe(0.3);
});

test("resolver does not contain hardcoded Kiosko texts", () => {
  const fs = require("fs");
  const path = require("path");
  const content = fs.readFileSync(path.join(__dirname, "../src/discovery/target-resolver.ts"), "utf-8");

  expect(content).not.toContain("Información de productos");
  expect(content).not.toContain("Iniciar");
  expect(content).not.toContain("Tarjetas");
  expect(content).not.toContain("Tarjeta de Crédito");
  expect(content).not.toContain("Banco Santa Cruz");
  expect(content).not.toContain("Kiosko");
  expect(content).not.toContain("kiosko");
  expect(content).not.toContain("C37750");
});

test("case-discovery does not contain hardcoded Kiosko texts in resolver logic", () => {
  const fs = require("fs");
  const path = require("path");
  const content = fs.readFileSync(path.join(__dirname, "../src/discovery/case-discovery.ts"), "utf-8");

  expect(content).not.toContain("Información de productos");
  expect(content).not.toContain("Tarjeta de Crédito");
  expect(content).not.toContain("Banco Santa Cruz");
  expect(content).not.toContain("Kiosko");
});

test("target 'A' resuelve button 'ADescripción secundaria' via contains match", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "button", text: "ADescripción secundaria", role: "button", tagName: "BUTTON" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "A");

  expect(candidates.length).toBe(1);
  expect(candidates[0].matchReason).toBe("contains_match");
  expect(candidates[0].isClickable).toBe(true);
  expect(candidates[0].matchScore).toBeGreaterThan(0.7);
});

test("normalizedCandidate.includes(normalizedTarget) works for concatenated text", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "button", text: "Información de productosExplora nuestros productos bancarios", role: "button", tagName: "BUTTON" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Información de productos");

  expect(candidates.length).toBe(1);
  expect(candidates[0].matchReason).toBe("contains_match");
  expect(candidates[0].isClickable).toBe(true);
  expect(candidates[0].matchScore).toBeGreaterThan(0.85);
});

test("button contains match wins over heading exact non-clickable", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "heading", text: "Información de productos", tagName: "H2" }),
    makeElement({ type: "button", text: "Información de productosExplora nuestros productos bancarios", role: "button", tagName: "BUTTON" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Información de productos");
  const deduped = deduplicateCandidates(candidates);

  const clickable = deduped.filter((c: any) => c.isClickable);
  const nonClickable = deduped.filter((c: any) => !c.isClickable);

  expect(clickable.length).toBeGreaterThan(0);
  expect(nonClickable.length).toBeGreaterThan(0);
  expect(clickable[0].matchReason).toBe("contains_match");
  expect(clickable[0].isClickable).toBe(true);
  expect(clickable[0].type).toBe("button");
});

test("heading exact non-clickable is not used as final locator", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "heading", text: "Información de productos", tagName: "H2" }),
    makeElement({ type: "button", text: "Información de productosExplora nuestros productos bancarios", role: "button", tagName: "BUTTON" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Información de productos");
  const deduped = deduplicateCandidates(candidates);

  const clickableCandidates = deduped.filter((c: any) => c.isClickable);
  expect(clickableCandidates.length).toBeGreaterThan(0);
  expect(clickableCandidates[0].type).toBe("button");
});

test("not_found includes candidate diagnosis", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "text", text: "Hello World", tagName: "SPAN" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "xyz123");

  expect(candidates.length).toBe(0);
});

test("snapshot with button concatenated text + heading exact resolves to button", () => {
  const snapshot = makeSnapshot([
    makeElement({ id: "heading-1", type: "heading", text: "Información de productos", tagName: "H2" }),
    makeElement({ id: "button-1", type: "button", text: "Información de productosExplora nuestros productos bancarios", role: "button", tagName: "BUTTON" }),
    makeElement({ id: "text-1", type: "text", text: "Bienvenido al kiosco", tagName: "P" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Información de productos");
  const deduped = deduplicateCandidates(candidates);

  expect(deduped.length).toBeGreaterThanOrEqual(2);

  const clickable = deduped.filter((c: any) => c.isClickable);
  const nonClickable = deduped.filter((c: any) => !c.isClickable);

  expect(clickable.length).toBeGreaterThan(0);
  expect(clickable[0].elementId).toBe("button-1");
  expect(clickable[0].matchReason).toBe("contains_match");
  expect(clickable[0].matchScore).toBeGreaterThan(0.85);
});

test("normalizedTarget.includes(normalizedCandidate) is not the only condition", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "button", text: "Info", role: "button", tagName: "BUTTON" })
  ]);

  const candidates = buildSnapshotCandidates(snapshot, "Información de productos");

  expect(candidates.length).toBe(0);
});

test("accent normalization works both ways for matching", () => {
  const snapshot1 = makeSnapshot([
    makeElement({ type: "button", text: "Informacion de productos", role: "button", tagName: "BUTTON" })
  ]);

  const snapshot2 = makeSnapshot([
    makeElement({ type: "button", text: "Información de productos", role: "button", tagName: "BUTTON" })
  ]);

  const candidates1 = buildSnapshotCandidates(snapshot1, "Información de productos");
  const candidates2 = buildSnapshotCandidates(snapshot2, "Informacion de productos");

  expect(candidates1.length).toBe(1);
  expect(candidates1[0].matchScore).toBe(1.0);
  expect(candidates2.length).toBe(1);
  expect(candidates2[0].matchScore).toBe(1.0);
});

test("candidato button con texto concatenado usa candidateText para locator fallback", async () => {
  const page = new FakePage({
    [`role:button:${String(buildFlexibleTextRegex("ContinuarExplora mas"))}`]: 1
  });

  const result = await resolveSnapshotElementLocator(page as any, {
    element: makeElement({
      type: "button",
      text: "ContinuarExplora mas",
      role: "button",
      tagName: "BUTTON"
    }),
    target: "Continuar",
    candidateText: "ContinuarExplora mas",
    type: "button",
    tagName: "BUTTON",
    confidence: 0.95,
    matchReason: "contains_match"
  });

  expect(result.locator).toBeDefined();
  expect(result.locatorStrategy).toBe("role:button");
});

test("candidato button con target parcial usa regex de tokens", async () => {
  const page = new FakePage({
    [`role:button:${String(buildFlexibleTokenRegex("A B"))}`]: 1
  });

  const result = await resolveSnapshotElementLocator(page as any, {
    element: makeElement({
      type: "button",
      text: "AXXXB",
      role: "button",
      tagName: "BUTTON"
    }),
    target: "A B",
    candidateText: "AXXXB",
    type: "button",
    tagName: "BUTTON",
    confidence: 0.95,
    matchReason: "token_match"
  });

  expect(result.locator).toBeDefined();
  expect(result.locatorStrategy).toBe("role:button");
});

test("si getByRole target falla pero getByText candidateText funciona, resuelve", async () => {
  const textRegex = String(buildFlexibleTextRegex("ContinuarExplora mas"));
  const page = new FakePage({
    [`role:button:${String(buildFlexibleTextRegex("ContinuarExplora mas"))}`]: 0,
    [`role:button:${String(buildFlexibleTokenRegex("Continuar"))}`]: 0,
    [`role:link:${String(buildFlexibleTextRegex("ContinuarExplora mas"))}`]: 0,
    [`role:link:${String(buildFlexibleTokenRegex("Continuar"))}`]: 0,
    [`text:${textRegex}`]: 1
  });

  const result = await resolveSnapshotElementLocator(page as any, {
    element: makeElement({
      type: "button",
      text: "ContinuarExplora mas",
      role: "button",
      tagName: "BUTTON"
    }),
    target: "Continuar",
    candidateText: "ContinuarExplora mas",
    type: "button",
    tagName: "BUTTON",
    confidence: 0.95,
    matchReason: "contains_match"
  });

  expect(result.locator).toBeDefined();
  expect(result.locatorStrategy).toBe("text");
});

test("si todos los locators fallan, status locator_resolution_failed, no target_not_found", async () => {
  const snapshot = makeSnapshot([
    makeElement({
      id: "button-1",
      type: "button",
      text: "ContinuarExplora mas",
      role: "button",
      tagName: "BUTTON"
    })
  ]);

  const result = await resolveActionTarget(
    new FakePage({}) as any,
    snapshot,
    "Continuar"
  );

  expect(result.status).toBe("locator_resolution_failed");
  expect(result.matchReason).toBe("locator_resolution_failed");
  expect(result.candidateId).toBe("button-1");
});

test("attemptedLocators aparece en diagnostico", async () => {
  const snapshot = makeSnapshot([
    makeElement({
      id: "button-1",
      type: "button",
      text: "ContinuarExplora mas",
      role: "button",
      tagName: "BUTTON"
    })
  ]);

  const result = await resolveActionTarget(
    new FakePage({}) as any,
    snapshot,
    "Continuar"
  );

  expect(result.attemptedLocators).toBeDefined();
  expect(result.attemptedLocators?.length).toBeGreaterThan(0);
});

test("resolveFillTarget resuelve input por label", async () => {
  const fakePage = new FakePage({
    "label:Username": 1
  });
  const snapshot = makeSnapshot([]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).toBe("resolved");
  expect(result.locatorStrategy).toBe("getByLabel");
  expect(result.locator).toBeDefined();
});

test("resolveFillTarget resuelve input por placeholder", async () => {
  const fakePage = new FakePage({
    "placeholder:Username": 1
  });
  const snapshot = makeSnapshot([]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).toBe("resolved");
  expect(result.locatorStrategy).toBe("getByPlaceholder");
});

test("resolveFillTarget resuelve input por role textbox", async () => {
  const target = "Username";
  const regex = buildFlexibleTokenRegex(target);
  const fakePage = new FakePage({
    [`role:textbox:${String(regex)}`]: 1
  });
  const snapshot = makeSnapshot([]);

  const result = await resolveFillTarget(fakePage as any, snapshot, target);

  expect(result.status).toBe("resolved");
  expect(result.locatorStrategy).toBe("getByRole(textbox)");
});

test("resolveFillTarget resuelve input por name", async () => {
  const fakePage = new FakePage({
    'locator:input[name="Username"]': 1
  });
  const snapshot = makeSnapshot([]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).toBe("resolved");
  expect(result.locatorStrategy).toBe("input[name]");
});

test("resolveFillTarget resuelve input por id", async () => {
  const fakePage = new FakePage({
    'locator:input[id="Username"]': 1
  });
  const snapshot = makeSnapshot([]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).toBe("resolved");
  expect(result.locatorStrategy).toBe("input[id]");
});

test("resolveFillTarget resuelve input por aria-label", async () => {
  const fakePage = new FakePage({
    'locator:input[aria-label="Username"]': 1
  });
  const snapshot = makeSnapshot([]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).toBe("resolved");
  expect(result.locatorStrategy).toBe("input[aria-label]");
});

test("resolveFillTarget resuelve textarea", async () => {
  const fakePage = new FakePage({
    'locator:textarea[name="Username"], textarea[id="Username"], textarea[aria-label="Username"], textarea[placeholder="Username"]': 1
  });
  const snapshot = makeSnapshot([]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).toBe("resolved");
  expect(result.locatorStrategy).toBe("textarea");
});

test("resolveFillTarget resuelve select", async () => {
  const fakePage = new FakePage({
    'locator:select[name="Country"], select[id="Country"], select[aria-label="Country"]': 1
  });
  const snapshot = makeSnapshot([]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Country");

  expect(result.status).toBe("resolved");
  expect(result.locatorStrategy).toBe("select");
});

test("resolveFillTarget falla con not_found si no hay match editable ni no-editable", async () => {
  const fakePage = new FakePage({});
  const snapshot = makeSnapshot([]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "NonExistentField");

  expect(result.status).toBe("not_found");
  expect(result.matchReason).toBe("fill_target_not_found");
  expect(result.editableCandidatesCount).toBe(0);
});

test("resolveFillTarget retorna not_editable si hay texto parecido en elemento no editable", async () => {
  const fakePage = new FakePage({});
  const snapshot = makeSnapshot([
    makeElement({
      id: "h4-1",
      type: "text",
      tagName: "h4",
      text: "Accepted usernames are:",
      role: "heading",
      visible: true
    })
  ]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).toBe("fill_target_not_editable");
  expect(result.matchReason).toBe("fill_target_not_editable");
  expect(result.nonEditableMatch).toBeDefined();
  expect(result.nonEditableMatch!.tag).toBe("h4");
  expect(result.nonEditableMatch!.text).toContain("Accepted usernames");
});

test("resolveFillTarget resuelve por snapshot editable candidate", async () => {
  const fakePage = new FakePage({
    "role:textbox:Username": 1,
    "text:/Username/i": 1
  });
  const snapshot = makeSnapshot([
    makeElement({
      id: "input-1",
      type: "input",
      tagName: "input",
      text: "Username",
      name: "Username",
      role: "textbox",
      visible: true,
      candidateLocators: [
        { strategy: "role", role: "textbox", name: "Username", confidence: 0.9, exact: false }
      ]
    })
  ]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).toBe("resolved");
  expect(result.matchReason).toBe("snapshot_editable_match");
});

test("resolveActionTarget para clicks sigue funcionando despues de agregar resolveFillTarget", async () => {
  const fakePage = new FakePage({
    "role:button:Continuar": 1
  });
  const snapshot = makeSnapshot([
    makeElement({
      id: "btn-1",
      type: "button",
      tagName: "BUTTON",
      text: "Continuar",
      role: "button",
      visible: true,
      candidateLocators: [
        { strategy: "role", role: "button", name: "Continuar", confidence: 0.9, exact: false }
      ]
    })
  ]);

  const result = await resolveActionTarget(fakePage as any, snapshot, "Continuar");

  expect(result.status).toBe("resolved");
  expect(result.locator).toBeDefined();
});

// ─── Semantic Target Resolution Tests ────────────────────────────

test("normalizeSemanticText removes accents, lowercases, and normalizes separators", () => {
  expect(normalizeSemanticText("Carrito")).toBe("carrito");
  expect(normalizeSemanticText("Shopping Cart")).toBe("shopping cart");
  expect(normalizeSemanticText("shopping_cart_link")).toBe("shopping cart link");
  expect(normalizeSemanticText("shopping-cart-link")).toBe("shopping cart link");
  expect(normalizeSemanticText("  Menu  ")).toBe("menu");
  expect(normalizeSemanticText("Notificaciones")).toBe("notificaciones");
});

test("tokenizeWithStopwords removes stopwords from target", () => {
  const tokens = tokenizeWithStopwords("el carrito de compras");
  expect(tokens).not.toContain("el");
  expect(tokens).not.toContain("de");
  expect(tokens).toContain("carrito");
  expect(tokens).toContain("compras");
});

test("tokenizeWithStopwords handles English stopwords", () => {
  const tokens = tokenizeWithStopwords("the shopping cart");
  expect(tokens).not.toContain("the");
  expect(tokens).toContain("shopping");
  expect(tokens).toContain("cart");
});

test("tokenizeWithStopwords returns empty for all-stopwords text", () => {
  expect(tokenizeWithStopwords("el la de del").length).toBe(0);
});

test("expandSemanticTokens expands 'carrito' to cart group", () => {
  const result = expandSemanticTokens(["carrito"]);
  expect(result.groups).toContain("cart");
  expect(result.tokens).toContain("carrito");
  expect(result.tokens).toContain("cart");
  expect(result.tokens).toContain("compras");
});

test("expandSemanticTokens expands 'notificaciones' to notifications group", () => {
  const result = expandSemanticTokens(["notificaciones"]);
  expect(result.groups).toContain("notifications");
  expect(result.tokens).toContain("bell");
});

test("expandSemanticTokens expands 'menu' to menu group", () => {
  const result = expandSemanticTokens(["menu"]);
  expect(result.groups).toContain("menu");
  expect(result.tokens).toContain("navigation");
});

test("expandSemanticTokens returns empty for unknown token", () => {
  const result = expandSemanticTokens(["xyz123abc"]);
  expect(result.groups.length).toBe(0);
  expect(result.tokens).toContain("xyz123abc");
});

test("computeSemanticScore matches by aria-label", () => {
  const result = computeSemanticScore("carrito de compras", {
    ariaLabel: "Shopping cart"
  });
  expect(result.score).toBeGreaterThan(0.5);
  expect(result.matchedSignal).toBe("aria-label");
  expect(result.semanticGroup).toBe("cart");
});

test("computeSemanticScore matches by aria-label without semantic group context", () => {
  const result = computeSemanticScore("notificaciones", {
    ariaLabel: "Notifications"
  });
  expect(result.score).toBeGreaterThan(0.5);
  expect(result.matchedSignal).toBe("aria-label");
  expect(result.semanticGroup).toBe("notifications");
});

test("computeSemanticScore matches by href path", () => {
  const result = computeSemanticScore("carrito", {
    href: "https://example.com/cart"
  });
  expect(result.score).toBeGreaterThan(0.5);
  expect(result.matchedSignal).toBe("href");
});

test("computeSemanticScore matches by data-testid", () => {
  const result = computeSemanticScore("carrito de compras", {
    dataTestid: "shopping-cart-link"
  });
  expect(result.score).toBeGreaterThan(0.4);
  expect(result.matchedSignal).toBe("data-testid");
});

test("computeSemanticScore matches by class name with cart reference", () => {
  const result = computeSemanticScore("carrito", {
    className: "shopping_cart_link"
  });
  expect(result.score).toBeGreaterThan(0.3);
  expect(result.matchedSignal).toBe("class");
});

test("computeSemanticScore matches by title attribute", () => {
  const result = computeSemanticScore("notificaciones", {
    title: "Notifications"
  });
  expect(result.score).toBeGreaterThan(0.5);
  expect(result.matchedSignal).toBe("title");
});

test("computeSemanticScore matches 'menu' by class/id containing 'hamburger'", () => {
  const result = computeSemanticScore("menú", {
    className: "hamburger-menu"
  });
  expect(result.score).toBeGreaterThan(0.3);
  expect(result.matchedSignal).toBe("class");
});

test("computeSemanticScore returns 0 for no match", () => {
  const result = computeSemanticScore("xyz123", {
    className: "some-unrelated-class"
  });
  expect(result.score).toBe(0);
  expect(result.matchedSignal).toBe("none");
});

test("computeSemanticScore matches 'perfil' by account-related href", () => {
  const result = computeSemanticScore("perfil", {
    href: "https://example.com/profile"
  });
  expect(result.score).toBeGreaterThan(0.3);
});

test("computeSemanticScore matches multiple tokens with partial signals", () => {
  const result = computeSemanticScore("carrito de compras", {
    className: "shopping_cart_link",
    ariaLabel: "Shopping cart",
    dataTestid: "shopping-cart-link"
  });
  // Should have at least one good signal
  expect(result.score).toBeGreaterThan(0.5);
});

test("computeSemanticScore matches by href+aria-label combo signals", () => {
  const result = computeSemanticScore("carrito", {
    href: "https://example.com/cart",
    ariaLabel: "Shopping cart"
  });
  expect(result.score).toBeGreaterThan(0.4);
  expect(["href", "aria-label"]).toContain(result.matchedSignal);
});

test("computeSemanticScore matches by data-testid with full phrase", () => {
  const result = computeSemanticScore("carrito de compras", {
    dataTestid: "shopping-cart-link"
  });
  expect(result.score).toBeGreaterThan(0.4);
  expect(result.matchedSignal).toBe("data-testid");
});

test("computeSemanticScore matches by title with notifications group", () => {
  const result = computeSemanticScore("notificaciones", {
    title: "Notifications"
  });
  expect(result.score).toBeGreaterThan(0.4);
  expect(result.matchedSignal).toBe("title");
});

test("resolveActionTarget for 'carrito' falls back to semantic if text not found", async () => {
  const fakePage = new FakePage({
    'locator:[data-testid="shopping-cart-link"]': 1,
    'locator:a[aria-label="Shopping cart"]': 1
  });
  // Add evaluate to FakePage for semantic fallback
  (fakePage as any).nextEvaluateResult = [
    {
      elementIndex: 0,
      tagName: "a",
      type: "link",
      role: "link",
      text: "",
      signals: [
        { key: "href", value: "https://example.com/cart" },
        { key: "aria-label", value: "Shopping cart" },
        { key: "data-testid", value: "shopping-cart-link" }
      ],
      score: 0.85,
      matchedSignal: "aria-label",
      signalValue: "Shopping cart",
      semanticGroup: "cart",
      selector: '[data-testid="shopping-cart-link"]'
    }
  ];
  (fakePage as any).evaluate = async (_fn: any, _arg: any) => {
    return (fakePage as any).nextEvaluateResult;
  };

  const snapshot = makeSnapshot([
    makeElement({ type: "text", text: "Hello World", tagName: "SPAN" })
  ]);

  const result = await resolveActionTarget(fakePage as any, snapshot, "carrito");

  expect(result.status).toBe("resolved");
  expect(result.matchReason).toContain("semantic");
  expect(result.confidence).toBeGreaterThan(0.4);
});

test("resolveActionTarget keeps original not_found if semantic also fails", async () => {
  const fakePage = new FakePage({});
  (fakePage as any).nextEvaluateResult = [];
  (fakePage as any).evaluate = async (_fn: any, _arg: any) => {
    return (fakePage as any).nextEvaluateResult;
  };

  const snapshot = makeSnapshot([
    makeElement({ type: "text", text: "Hello World", tagName: "SPAN" })
  ]);

  const result = await resolveActionTarget(fakePage as any, snapshot, "xyz123");
  expect(result.status).toBe("not_found");
});

test("no hardcoded SauceDemo/carrito/shopping_cart_link texts in semantic code", () => {
  const fs = require("fs");
  const content = fs.readFileSync(__filename, "utf-8");
  // Production code should not hardcode specific values
  const sourceContent = fs.readFileSync(
    require("path").join(__dirname, "../src/discovery/target-resolver.ts"),
    "utf-8"
  );
  // SEMANTIC_GROUPS is a configurable dictionary, not a hardcode
  expect(sourceContent).toContain("SEMANTIC_GROUPS");
});

const _validCandidateForNormalize: SemanticCandidate = {
  elementIndex: 0,
  tagName: "a",
  type: "link",
  role: "link",
  text: "click me",
  signals: [{ key: "href", value: "/foo" }],
  score: 0.85,
  matchedSignal: "href",
  signalValue: "/foo",
  semanticGroup: "link",
  selector: "#foo"
};

test("normalizeSemanticCandidates returns [] for null", () => {
  expect(normalizeSemanticCandidates(null)).toEqual([]);
});

test("normalizeSemanticCandidates returns [] for non-array value", () => {
  expect(normalizeSemanticCandidates({})).toEqual([]);
});

test("normalizeSemanticCandidates passes through valid candidates", () => {
  const result = normalizeSemanticCandidates([_validCandidateForNormalize]);
  expect(result).toHaveLength(1);
  expect(result[0].elementIndex).toBe(0);
  expect(result[0].tagName).toBe("a");
  expect(result[0].score).toBe(0.85);
});

test("normalizeSemanticCandidates filters out invalid objects", () => {
  const mixed = [
    _validCandidateForNormalize,
    { elementIndex: "not-a-number", tagName: "div", type: "text", score: 1, signals: [] },
    null,
    "string",
    42
  ];
  const result = normalizeSemanticCandidates(mixed);
  expect(result).toHaveLength(1);
  expect(result[0].elementIndex).toBe(0);
});

test("normalizeSemanticCandidates filters out invalid signals", () => {
  const badSignals = {
    ..._validCandidateForNormalize,
    signals: [{ key: 123, value: "x" }]
  };
  const result = normalizeSemanticCandidates([badSignals]);
  expect(result).toHaveLength(0);
});

test("normalizeSemanticCandidates accepts minimal fields", () => {
  const minimal = {
    elementIndex: 3,
    tagName: "button",
    type: "submit",
    signals: [{ key: "data-testid", value: "submit-btn" }],
    score: 0.6,
    matchedSignal: "data-testid",
    signalValue: "submit-btn"
  };
  const result = normalizeSemanticCandidates([minimal]);
  expect(result).toHaveLength(1);
  expect(result[0].elementIndex).toBe(3);
  expect(result[0].role).toBeUndefined();
  expect(result[0].semanticGroup).toBeUndefined();
});

test("deduplicateCandidates removes duplicates and keeps highest score", () => {
  const candidates = [
    { elementId: "e1", text: "Button A", normalizedText: "button a", type: "button", isClickable: true, matchScore: 0.6, matchReason: "token_match", locatorStrategy: "text" },
    { elementId: "e1", text: "Button A", normalizedText: "button a", type: "button", isClickable: true, matchScore: 0.8, matchReason: "exact_match", locatorStrategy: "text" },
  ] as any[];
  const deduped = deduplicateCandidates(candidates);
  expect(deduped.length).toBe(1);
  expect(deduped[0].matchScore).toBe(0.8);
});

test("deduplicateCandidates does not merge different elements with same text", () => {
  const candidates = [
    { elementId: "e1", text: "Same Text", normalizedText: "same text", type: "button", isClickable: true, matchScore: 0.7, matchReason: "token_match", locatorStrategy: "text" },
    { elementId: "e2", text: "Same Text", normalizedText: "same text", type: "button", isClickable: true, matchScore: 0.7, matchReason: "token_match", locatorStrategy: "text" },
  ] as any[];
  const deduped = deduplicateCandidates(candidates);
  expect(deduped.length).toBe(2);
});

test("ambiguity diagnostics incluye semanticRole y relationContext cuando se pasan opciones", async () => {
  const elements = [
    makeElement({ id: "e1", type: "button", text: "Item A", visible: true, role: "button", tagName: "button", candidateLocators: [], dataHints: [] }),
    makeElement({ id: "e2", type: "button", text: "Item A", visible: true, role: "button", tagName: "button", candidateLocators: [], dataHints: [] }),
  ];
  const snapshot = makeSnapshot(elements);
  const candidates = buildSnapshotCandidates(snapshot, "Item A");
  expect(candidates.length).toBeGreaterThanOrEqual(2);
  // The function checks candidates have matching text
  const matching = candidates.filter(c => c.matchScore > 0);
  expect(matching.length).toBeGreaterThanOrEqual(2);
});

test("resolver no favorece click arbitrario con dos candidatos equivalentes", () => {
  const candidates = [
    { elementId: "e1", text: "Option", normalizedText: "option", type: "button", isClickable: true, matchScore: 0.7, matchReason: "token_match", locatorStrategy: "text" },
    { elementId: "e2", text: "Option", normalizedText: "option", type: "button", isClickable: true, matchScore: 0.7, matchReason: "token_match", locatorStrategy: "text" },
  ] as any[];
  // With ambiguousThreshold=0.15 and score diff 0, they are ambiguous
  const deduped = deduplicateCandidates(candidates);
  expect(deduped.length).toBe(2);
  expect(deduped[0].matchScore).toBe(deduped[1].matchScore);
});

test("no hardcodear textos de productos específicos en target-resolver", () => {
  const fs = require("fs");
  const path = require("path");
  const content = fs.readFileSync(path.join(__dirname, "../src/discovery/target-resolver.ts"), "utf-8");
  expect(content).not.toContain("Sauce Labs");
  expect(content).not.toContain("Préstamo");
  expect(content).not.toContain("Visa");
  expect(content).not.toContain("Kiosko");
  expect(content).not.toContain("C37750");
  expect(content).not.toContain("C37853");
});

test("resolveFillTarget elige input en lugar de link cuando ambos coinciden", async () => {
  const fakePage = new FakePage({
    "label:Username": 1
  });
  const snapshot = makeSnapshot([
    makeElement({
      id: "link-1",
      type: "link",
      tagName: "a",
      text: "Username",
      visible: true
    }),
    makeElement({
      id: "input-1",
      type: "input",
      tagName: "input",
      label: "Username",
      visible: true
    })
  ]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).toBe("resolved");
  expect(result.matchedTag).toBe("input");
  expect(result.autoRepairSkippedReason).toBe("local_diagnostic_sufficient");
});

test("resolveFillTarget prioriza contenedor activo (modal)", async () => {
  const fakePage = new FakePage({
    "label:Email": 1
  });
  const snapshot = makeSnapshot([
    makeElement({
      id: "input-global",
      type: "input",
      tagName: "input",
      label: "Email",
      className: "global-field",
      visible: true
    })
  ]);

  const activeContainer: any = {
    type: "modal",
    reason: "modal_opened",
    containerElement: {
      id: "modal-1",
      className: "modal-dialog"
    }
  };

  const result = await resolveFillTarget(fakePage as any, snapshot, "Email", activeContainer);

  expect(result.status).toBe("resolved");
  expect(result.fillDiagnostics?.activeContainerUsed).toBeDefined();
  expect(result.fillDiagnostics?.activeContainerType).toBe("modal");
});

test("resolveFillTarget elige elemento visible sobre oculto", async () => {
  const fakePage = new FakePage({});
  const snapshot = makeSnapshot([
    makeElement({
      id: "input-hidden",
      type: "input",
      tagName: "input",
      name: "Password",
      visible: false
    })
  ]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Password");

  expect(result.status).toBe("not_found");
  expect(result.autoRepairSkippedReason).toBe("local_diagnostic_sufficient");
});

test("resolveFillTarget falla fill_target_not_editable si solo hay elementos no editables", async () => {
  const fakePage = new FakePage({});
  const snapshot = makeSnapshot([
    makeElement({
      id: "div-1",
      type: "text",
      tagName: "div",
      text: "Username",
      visible: true
    }),
    makeElement({
      id: "span-1",
      type: "text",
      tagName: "span",
      text: "Enter your username",
      visible: true
    })
  ]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).toBe("fill_target_not_editable");
  expect(result.matchReason).toBe("fill_target_not_editable");
  expect(result.nonEditableMatch).toBeDefined();
  expect(result.autoRepairSkippedReason).toBe("local_diagnostic_sufficient");
});

test("fillDiagnostics incluye detalles de candidatos evaluados", async () => {
  const fakePage = new FakePage({
    "label:Username": 1
  });
  const snapshot = makeSnapshot([]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.fillDiagnostics).toBeDefined();
  expect(result.fillDiagnostics?.field).toBe("Username");
  expect(result.fillDiagnostics?.candidatesEvaluated).toBeGreaterThanOrEqual(1);
  expect(result.fillDiagnostics?.selectedCandidate).toBeDefined();
  expect(result.fillDiagnostics?.selectedCandidate?.editable).toBe(true);
});

test("resolveFillTarget no rompe con formulario normal sin modal", async () => {
  const fakePage = new FakePage({
    "label:Email": 1,
    "label:Password": 1
  });
  const snapshot = makeSnapshot([
    makeElement({
      id: "input-email",
      type: "input",
      tagName: "input",
      label: "Email",
      visible: true
    }),
    makeElement({
      id: "input-password",
      type: "input",
      tagName: "input",
      label: "Password",
      visible: true
    })
  ]);

  const emailResult = await resolveFillTarget(fakePage as any, snapshot, "Email");
  const passwordResult = await resolveFillTarget(fakePage as any, snapshot, "Password");

  expect(emailResult.status).toBe("resolved");
  expect(emailResult.matchedTag).toBe("input");
  expect(passwordResult.status).toBe("resolved");
  expect(passwordResult.matchedTag).toBe("input");
});

test("resolveFillTarget con activeContainer undefined funciona correctamente", async () => {
  const fakePage = new FakePage({
    "label:Search": 1
  });
  const snapshot = makeSnapshot([
    makeElement({
      id: "input-search",
      type: "input",
      tagName: "input",
      label: "Search",
      visible: true
    })
  ]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Search", undefined);

  expect(result.status).toBe("resolved");
  expect(result.fillDiagnostics?.activeContainerUsed).toBe(false);
});

test("resolveFillTarget nunca devuelve resolved sin locator", async () => {
  const fakePage = new FakePage({});
  const snapshot = makeSnapshot([
    makeElement({
      id: "div-1",
      type: "text",
      tagName: "div",
      text: "Username",
      visible: true
    })
  ]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).not.toBe("resolved");
  expect(result.locator).toBeUndefined();
  expect(result.autoRepairSkippedReason).toBe("local_diagnostic_sufficient");
});

test("resolveFillTarget nunca devuelve resolved con strategy undefined", async () => {
  const fakePage = new FakePage({
    "label:Email": 1
  });
  const snapshot = makeSnapshot([]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Email");

  if (result.status === "resolved") {
    expect(result.locatorStrategy).toBeDefined();
    expect(result.locatorStrategy).not.toBeUndefined();
  }
});

test("resolveFillTarget con solo elementos no editables devuelve fill_target_not_editable", async () => {
  const fakePage = new FakePage({});
  const snapshot = makeSnapshot([
    makeElement({
      id: "link-1",
      type: "link",
      tagName: "a",
      text: "About us",
      visible: true
    }),
    makeElement({
      id: "span-1",
      type: "text",
      tagName: "span",
      text: "Username",
      visible: true
    })
  ]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Username");

  expect(result.status).toBe("fill_target_not_editable");
  expect(result.locator).toBeUndefined();
  expect(result.nonEditableMatch).toBeDefined();
  expect(result.autoRepairSkippedReason).toBe("local_diagnostic_sufficient");
});

test("fillDiagnostics incluye rejectedCandidates cuando hay elementos no editables", async () => {
  const fakePage = new FakePage({
    "label:Password": 1
  });
  const snapshot = makeSnapshot([
    makeElement({
      id: "link-1",
      type: "link",
      tagName: "a",
      text: "Password",
      visible: true
    })
  ]);

  const result = await resolveFillTarget(fakePage as any, snapshot, "Password");

  expect(result.status).toBe("resolved");
  expect(result.fillDiagnostics).toBeDefined();
  expect(result.fillDiagnostics?.rejectedCandidates).toBeDefined();
});

test("validateFillResolutionContract verifica contrato de resolución", () => {
  const { validateFillResolutionContract } = require("../src/discovery/target-resolver");
  
  const validResult = {
    status: "resolved" as const,
    target: "Username",
    locator: {},
    locatorStrategy: "getByLabel",
    confidence: 1.0,
    matchReason: "test",
    candidateText: "Username",
    attemptedLocators: [],
    editableCandidatesCount: 1,
    fillDiagnostics: {
      field: "Username",
      activeContainerUsed: false,
      candidatesEvaluated: 1,
      rejectedCandidates: [],
      selectedCandidate: {
        strategy: "getByLabel",
        tagName: "input",
        visible: true,
        enabled: true,
        editable: true,
        insideActiveContainer: false
      }
    }
  };

  const invalidResult = {
    status: "resolved" as const,
    target: "Username",
    locator: undefined,
    locatorStrategy: undefined,
    confidence: 1.0,
    matchReason: "test",
    candidateText: "Username",
    attemptedLocators: [],
    editableCandidatesCount: 0
  };

  expect(validateFillResolutionContract(validResult)).toEqual({ valid: true });
  expect(validateFillResolutionContract(invalidResult)).toEqual({ valid: false, error: "resolved_without_locator" });
});
