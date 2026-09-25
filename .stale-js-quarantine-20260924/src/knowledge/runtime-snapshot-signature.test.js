"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const runtime_knowledge_persister_1 = require("./runtime-knowledge-persister");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
const SLUG = "__sig-test-app";
const FILE = path.join(process.cwd(), "automations", "apps", SLUG, "app.knowledge.json");
function reset() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    if (fs.existsSync(FILE))
        fs.unlinkSync(FILE);
}
function items() {
    if (!fs.existsSync(FILE))
        return [];
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const all = Array.isArray(raw) ? raw : (raw.items ?? []);
    return all.filter((i) => i.knowledgeKind === "route_menu_snapshot");
}
/** The contact-confirmation screen: the same tappables in every state — only the texts change. */
const CLICKS = ["kev*****05@gmail.com", "Enviar código de validación", "(829) ***-**00", "Continuar", "Salir"];
function snap(over) {
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
    };
}
const INITIAL = snap({ assertionTargets: ["Hola Nr2rc, valida tus datos"], continuarEnabled: false });
const CODE_SENT = snap({
    assertionTargets: ["Hola Nr2rc, valida tus datos", "Indica el código recibido en el correo"],
    continuarEnabled: false,
});
const GATE_OPEN = snap({ assertionTargets: ["Hola Nr2rc, valida tus datos"], continuarEnabled: true });
console.log("\npersistRuntimeSnapshot signature");
reset();
(0, runtime_knowledge_persister_1.persistRuntimeSnapshot)(SLUG, INITIAL, { status: "passed" });
test("persists the first state", () => node_assert_1.default.strictEqual(items().length, 1));
(0, runtime_knowledge_persister_1.persistRuntimeSnapshot)(SLUG, INITIAL, { status: "passed" });
test("an identical capture merges, it does not duplicate", () => node_assert_1.default.strictEqual(items().length, 1));
(0, runtime_knowledge_persister_1.persistRuntimeSnapshot)(SLUG, CODE_SENT, { status: "passed" });
test("the OTP state is kept as its own item — same tappables, different texts", () => node_assert_1.default.strictEqual(items().length, 2));
(0, runtime_knowledge_persister_1.persistRuntimeSnapshot)(SLUG, GATE_OPEN, { status: "passed" });
test("the open-gate state is kept too — same texts, Continuar now enabled", () => node_assert_1.default.strictEqual(items().length, 3));
test("the OTP state is findable in the file", () => node_assert_1.default.ok(items().some((i) => JSON.stringify(i).includes("Indica el código recibido"))));
test("a still-closed gate is recorded as disabled", () => node_assert_1.default.ok(items().some((i) => (i.observedControls ?? []).some((c) => c.enabled === false))));
fs.rmSync(path.dirname(FILE), { recursive: true, force: true });
console.log("\nlisto");
