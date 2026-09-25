"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const promoted_spec_runtime_1 = require("./promoted-spec-runtime");
const normalize = (value) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
(0, node_test_1.default)("structured promoted assertion preserves positive and negative polarity", () => {
    strict_1.default.equal((0, promoted_spec_runtime_1.evaluatePromotedAssertionState)("https://example.test/dashboard", {
        polarity: "positive",
        expectedUrl: "/dashboard",
    }), true);
    strict_1.default.equal((0, promoted_spec_runtime_1.evaluatePromotedAssertionState)("https://example.test/login", {
        polarity: "negative",
        expectedUrl: "/dashboard",
    }), true);
    strict_1.default.equal((0, promoted_spec_runtime_1.evaluatePromotedAssertionState)("https://example.test/dashboard", {
        polarity: "negative",
        expectedUrl: "/dashboard",
    }), false);
});
(0, node_test_1.default)("structured promoted assertion fails closed without polarity or descriptor", () => {
    strict_1.default.throws(() => (0, promoted_spec_runtime_1.evaluatePromotedAssertionState)("https://example.test/dashboard", {
        expectedUrl: "/dashboard",
    }), /PROMOTED_ASSERTION_POLARITY_UNRESOLVED/);
    strict_1.default.throws(() => (0, promoted_spec_runtime_1.evaluatePromotedAssertionState)("https://example.test/dashboard", {
        polarity: "negative",
    }), /PROMOTED_ASSERTION_DESCRIPTOR_UNRESOLVED/);
});
(0, node_test_1.default)("visible text collections ignore non-strings before normalization", () => {
    const values = [undefined, null, "", "Continuar"];
    const target = normalize("continuar");
    const normalized = values
        .filter((value) => typeof value === "string" && value.trim() !== "")
        .some((value) => normalize(value).includes(target));
    strict_1.default.equal(normalized, true);
});
(0, node_test_1.default)("invalid-only visible text collections remain a no-match", () => {
    const values = [undefined, null, ""];
    const normalized = values
        .filter((value) => typeof value === "string" && value.trim() !== "")
        .some((value) => normalize(value).includes("continuar"));
    strict_1.default.equal(normalized, false);
});
(0, node_test_1.default)("fill field resolver accepts modern and legacy aliases fail-closed", () => {
    strict_1.default.equal((0, promoted_spec_runtime_1.resolvePromotedFieldTarget)({ field: "Campo" }), "Campo");
    strict_1.default.equal((0, promoted_spec_runtime_1.resolvePromotedFieldTarget)({ target: "Campo" }), "Campo");
    strict_1.default.equal((0, promoted_spec_runtime_1.resolvePromotedFieldTarget)({ field: "Autenticación", target: "autenticacion" }), "Autenticación");
    strict_1.default.throws(() => (0, promoted_spec_runtime_1.resolvePromotedFieldTarget)({ field: "Campo A", target: "Campo B" }), /conflicting_field_target/);
    strict_1.default.throws(() => (0, promoted_spec_runtime_1.resolvePromotedFieldTarget)({}), /invalid_context_action_target/);
    strict_1.default.throws(() => (0, promoted_spec_runtime_1.resolvePromotedFieldTarget)({ target: "" }), /invalid_context_action_target/);
    strict_1.default.throws(() => (0, promoted_spec_runtime_1.resolvePromotedFieldTarget)({ target: undefined }), /invalid_context_action_target/);
});
(0, node_test_1.default)("fill context matches semantic field signals without values", () => {
    strict_1.default.equal((0, promoted_spec_runtime_1.doesVisibleFieldSignalMatch)(["Campo de prueba"], "campo de prueba"), true);
    strict_1.default.equal((0, promoted_spec_runtime_1.doesVisibleFieldSignalMatch)(["Identificador"], "identificador"), true);
    strict_1.default.equal((0, promoted_spec_runtime_1.doesVisibleFieldSignalMatch)(["Ingrese identificador"], "identificador"), true);
    strict_1.default.equal((0, promoted_spec_runtime_1.doesVisibleFieldSignalMatch)(["Nombre"], "Contraseña"), false);
    strict_1.default.equal((0, promoted_spec_runtime_1.doesVisibleFieldSignalMatch)([undefined, null, ""], "Campo"), false);
});
(0, node_test_1.default)("fill context matches equivalent mojibake field labels", () => {
    strict_1.default.equal((0, promoted_spec_runtime_1.doesVisibleFieldSignalMatch)(["Contraseña"], "ContraseÃ±a"), true);
});
(0, node_test_1.default)("fill context remains fail-closed for a different field", () => {
    strict_1.default.equal((0, promoted_spec_runtime_1.doesVisibleFieldSignalMatch)(["Nombre de usuario"], "ContraseÃ±a"), false);
});
function fakePageForContainer(container) {
    return {
        evaluate: async (callback, field) => {
            const previousDocument = globalThis.document;
            const previousWindow = globalThis.window;
            globalThis.document = { querySelectorAll: () => [container] };
            globalThis.window = { getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
            try {
                return callback(field);
            }
            finally {
                globalThis.document = previousDocument;
                globalThis.window = previousWindow;
            }
        },
    };
}
(0, node_test_1.default)("field container matcher repairs mojibake before native fill selection", async () => {
    const field = {
        name: "password",
        id: "password",
        getAttribute: (attribute) => attribute === "type" ? "password" : null,
    };
    const container = {
        textContent: "Contraseña",
        tagName: "FORM",
        id: "login-form",
        getAttribute: () => null,
        getBoundingClientRect: () => ({ width: 100, height: 40 }),
        querySelectorAll: () => [field],
    };
    const result = await (0, promoted_spec_runtime_1.findBestActiveContainerForField)(fakePageForContainer(container), "ContraseÃ±a");
    strict_1.default.equal(result.best?.matchingFieldFound, true);
});
(0, node_test_1.default)("field container matcher rejects a missing field", async () => {
    const field = {
        name: "username",
        id: "username",
        getAttribute: () => null,
    };
    const container = {
        textContent: "Nombre de usuario",
        tagName: "FORM",
        id: "login-form",
        getAttribute: () => null,
        getBoundingClientRect: () => ({ width: 100, height: 40 }),
        querySelectorAll: () => [field],
    };
    const result = await (0, promoted_spec_runtime_1.findBestActiveContainerForField)(fakePageForContainer(container), "Contraseña");
    strict_1.default.equal(result.best?.matchingFieldFound, false);
});
function fakeLocator(count) {
    return {
        count: async () => count,
        first() { return this; },
        isVisible: async () => true,
        isDisabled: async () => false,
        evaluate: async () => "input",
    };
}
function fakeResolverPage(label) {
    const container = fakeLocator(1);
    const matching = (_regex) => fakeLocator(label === "Contrase\u00f1a" ? 1 : 0);
    container.getByLabel = matching;
    container.getByPlaceholder = () => fakeLocator(0);
    container.getByRole = () => fakeLocator(0);
    container.locator = () => fakeLocator(0);
    return {
        locator: (selector) => selector === "#login-form" ? container : fakeLocator(0),
        getByLabel: matching,
        getByPlaceholder: () => fakeLocator(0),
        getByRole: () => fakeLocator(0),
    };
}
(0, node_test_1.default)("field locator resolves an equivalent mojibake label", async () => {
    const result = await (0, promoted_spec_runtime_1.resolvePromotedFieldLocator)(fakeResolverPage("Contrase\u00f1a"), "Contrase\u00c3\u00b1a");
    strict_1.default.ok(result?.locator);
    strict_1.default.equal(result?.strategy, "page:getByLabel");
});
(0, node_test_1.default)("field locator rejects a different label", async () => {
    const result = await (0, promoted_spec_runtime_1.resolvePromotedFieldLocator)(fakeResolverPage("Nombre de usuario"), "Contrase\u00c3\u00b1a", {
        containerLocator: "#login-form",
    });
    strict_1.default.equal(result, undefined);
});
function fakeRawCandidatePage(labels) {
    const candidates = labels.map((label) => ({
        count: async () => 1,
        nth: () => undefined,
        isVisible: async () => true,
        isDisabled: async () => false,
        evaluate: async (callback) => callback({
            tagName: "INPUT",
            getAttribute: (name) => name === "aria-label" ? label : null,
            id: "",
            closest: () => null,
        }),
    }));
    const fields = {
        count: async () => candidates.length,
        nth: (index) => {
            const candidate = candidates[index];
            candidate.nth = () => candidate;
            return candidate;
        },
    };
    const scope = { locator: () => fields };
    return {
        locator: (selector) => selector === "#login-form" ? scope : fields,
        getByLabel: () => fakeLocator(0),
        getByPlaceholder: () => fakeLocator(0),
        getByRole: () => fakeLocator(0),
    };
}
(0, node_test_1.default)("semantic candidate resolution preserves the raw matching input", async () => {
    const result = await (0, promoted_spec_runtime_1.resolvePromotedFieldLocator)(fakeRawCandidatePage(["Nombre de usuario", "Contrase\u00f1a"]), "Contrase\u00c3\u00b1a", { containerLocator: "#login-form" });
    strict_1.default.ok(result?.locator);
    strict_1.default.equal(result?.strategy, "container:semanticCandidate");
});
(0, node_test_1.default)("semantic candidate resolution rejects ambiguous matches", async () => {
    const result = await (0, promoted_spec_runtime_1.resolvePromotedFieldLocator)(fakeRawCandidatePage(["Contrase\u00f1a", "Contrase\u00f1a"]), "Contrase\u00c3\u00b1a", { containerLocator: "#login-form" });
    strict_1.default.equal(result, undefined);
});
