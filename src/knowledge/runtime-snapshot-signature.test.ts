import assert from "node:assert";
import { persistRuntimeSnapshot } from "./runtime-knowledge-persister";
import * as fs from "node:fs";
import * as path from "node:path";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

const SLUG = "__sig-test-app";
const FILE = path.join(process.cwd(), "automations", "apps", SLUG, "app.knowledge.json");

function reset(): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
}
function items(): Array<Record<string, unknown>> {
  if (!fs.existsSync(FILE)) return [];
  const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const all = Array.isArray(raw) ? raw : (raw.items ?? []);
  return all.filter((i: Record<string, unknown>) => i.knowledgeKind === "route_menu_snapshot");
}

/** The contact-confirmation screen: the same tappables in every state — only the texts change. */
const CLICKS = ["kev*****05@gmail.com", "Enviar código de validación", "(829) ***-**00", "Continuar", "Salir"];
function snap(over: { assertionTargets: string[]; continuarEnabled: boolean }) {
  return {
    screenKey: "screen",
    url: "mobile://screen",
    clickTargets: CLICKS,
    businessLabels: CLICKS,
    observedControls: [
      { label: "Continuar", sourceScreenKey: "screen", enabled: over.continuarEnabled },
      { label: "Salir", sourceScreenKey: "screen", enabled: true },
    ],
    assertionTargets: over.assertionTargets,
    headings: [],
    inputLabels: [],
    selectLabels: [],
    capturedAt: new Date().toISOString(),
  } as never;
}

const INITIAL = snap({ assertionTargets: ["Hola Nr2rc, valida tus datos"], continuarEnabled: false });
const CODE_SENT = snap({
  assertionTargets: ["Hola Nr2rc, valida tus datos", "Indica el código recibido en el correo"],
  continuarEnabled: false,
});
const GATE_OPEN = snap({ assertionTargets: ["Hola Nr2rc, valida tus datos"], continuarEnabled: true });

console.log("\npersistRuntimeSnapshot signature");

reset();
persistRuntimeSnapshot(SLUG, INITIAL, { status: "passed" });
test("persists the first state", () => assert.strictEqual(items().length, 1));

persistRuntimeSnapshot(SLUG, INITIAL, { status: "passed" });
test("an identical capture merges, it does not duplicate", () => assert.strictEqual(items().length, 1));

persistRuntimeSnapshot(SLUG, CODE_SENT, { status: "passed" });
test("the OTP state is kept as its own item — same tappables, different texts", () =>
  assert.strictEqual(items().length, 2));

persistRuntimeSnapshot(SLUG, GATE_OPEN, { status: "passed" });
test("the open-gate state is kept too — same texts, Continuar now enabled", () =>
  assert.strictEqual(items().length, 3));

test("the OTP state is findable in the file", () =>
  assert.ok(items().some((i) => JSON.stringify(i).includes("Indica el código recibido"))));

test("a still-closed gate is recorded as disabled", () =>
  assert.ok(items().some((i) =>
    ((i.observedControls as Array<Record<string, unknown>>) ?? []).some((c) => c.enabled === false))));

fs.rmSync(path.dirname(FILE), { recursive: true, force: true });
console.log("\nlisto");
