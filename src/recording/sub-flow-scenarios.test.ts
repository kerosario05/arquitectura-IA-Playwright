import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecordedEvent } from "./session-trace.types";
import { detectSubFlowBranches } from "./sub-flow-scenarios";

const BASE = "https://kiosk.local";
let seq = 0;

function navigate(path: string): RecordedEvent {
  seq += 1;
  return { seq, t: seq, kind: "navigate", screenKey: "s", url: `${BASE}${path}` } as RecordedEvent;
}
function tap(label: string, onPath: string): RecordedEvent {
  seq += 1;
  return { seq, t: seq, kind: "tap", screenKey: "s", url: `${BASE}${onPath}`, target: { label, locators: [] } } as RecordedEvent;
}

/** Shape of recording 73f03712: three explorations from the catalog, unnamed back arrows, logout. */
function catalogWalkthrough(): RecordedEvent[] {
  seq = 0;
  return [
    navigate("/"),
    tap("Explora nuestros productos", "/"), navigate("/product-catalog"),
    tap("Tarjetas", "/product-catalog"), navigate("/product-subcategory?category=cards"),
    tap("Tarjeta de Crédito", "/product-subcategory?category=cards"), navigate("/product-subcategory?category=cards&subcategory=credit"),
    tap("control", "/product-subcategory?category=cards&subcategory=credit"), navigate("/product-subcategory?category=cards"),
    tap("control", "/product-subcategory?category=cards"), navigate("/product-catalog"),
    tap("Cuentas", "/product-catalog"), navigate("/product-subcategory?category=accounts"),
    tap("Cuenta de Ahorro", "/product-subcategory?category=accounts"), navigate("/product-subcategory?category=accounts&subcategory=savings"),
    tap("Volver", "/product-subcategory?category=accounts&subcategory=savings"), navigate("/product-subcategory?category=accounts"),
    tap("Volver", "/product-subcategory?category=accounts"), navigate("/product-catalog"),
    tap("Préstamos", "/product-catalog"), navigate("/product-subcategory?category=loans"),
    tap("Préstamo Personal", "/product-subcategory?category=loans"),
    navigate("/product-subcategory?category=loans&subcategory=personal"), navigate("/product-extended?product=prestamo-personal"),
    tap("Finalizar sesión", "/product-extended?product=prestamo-personal"), navigate("/"),
  ];
}

function labels(events: RecordedEvent[], indices: number[]): string[] {
  return indices.map((index) => events[index].target!.label);
}

test("one branch per exploration: shared path kept, returns and logout left out", () => {
  const events = catalogWalkthrough();
  const branches = detectSubFlowBranches(events);
  assert.deepEqual(branches.map((branch) => labels(events, branch.actionIndices)), [
    ["Explora nuestros productos", "Tarjetas", "Tarjeta de Crédito"],
    ["Explora nuestros productos", "Cuentas", "Cuenta de Ahorro"],
    ["Explora nuestros productos", "Préstamos", "Préstamo Personal"],
  ]);
});

test("a branch keeps each action's own navigations, including an app redirect", () => {
  const events = catalogWalkthrough();
  const loans = detectSubFlowBranches(events)[2];
  const keptUrls = loans.keptIndices.filter((index) => events[index].kind === "navigate").map((index) => events[index].url!.replace(BASE, ""));
  assert.deepEqual(keptUrls, [
    "/",
    "/product-catalog",
    "/product-subcategory?category=loans",
    "/product-subcategory?category=loans&subcategory=personal",
    "/product-extended?product=prestamo-personal",
  ]);
  assert.ok(!keptUrls.includes("/product-subcategory?category=cards"), "another branch's pages never leak in");
});

test("a straight walkthrough with no return is not split", () => {
  seq = 0;
  const events = [
    navigate("/"),
    tap("Explora nuestros productos", "/"), navigate("/product-catalog"),
    tap("Tarjetas", "/product-catalog"), navigate("/product-subcategory?category=cards"),
  ];
  assert.deepEqual(detectSubFlowBranches(events), []);
});

test("walking the same path twice, or entering and leaving without choosing, is not a second case", () => {
  seq = 0;
  const repeated = [
    navigate("/"),
    tap("Explora nuestros productos", "/"), navigate("/product-catalog"),
    tap("Préstamos", "/product-catalog"), navigate("/product-subcategory?category=loans"),
    tap("Volver", "/product-subcategory?category=loans"), navigate("/product-catalog"),
    tap("Préstamos", "/product-catalog"), navigate("/product-subcategory?category=loans"),
  ];
  assert.deepEqual(detectSubFlowBranches(repeated), [], "one distinct case left: nothing to split");

  seq = 0;
  const peek = [
    navigate("/"),
    tap("Explora nuestros productos", "/"), navigate("/product-catalog"),
    tap("Volver", "/product-catalog"), navigate("/"),
    tap("Explora nuestros productos", "/"), navigate("/product-catalog"),
    tap("Tarjetas", "/product-catalog"), navigate("/product-subcategory?category=cards"),
  ];
  assert.deepEqual(detectSubFlowBranches(peek), [], "the peek is only the start of the real branch");
});
