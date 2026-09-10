import test from "node:test";
import assert from "node:assert/strict";
import { doesVisibleFieldSignalMatch, evaluatePromotedAssertionState, findBestActiveContainerForField, resolvePromotedFieldLocator, resolvePromotedFieldTarget } from "./promoted-spec-runtime";

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

test("structured promoted assertion preserves positive and negative polarity", () => {
  assert.equal(evaluatePromotedAssertionState("https://example.test/dashboard", {
    polarity: "positive",
    expectedUrl: "/dashboard",
  }), true);
  assert.equal(evaluatePromotedAssertionState("https://example.test/login", {
    polarity: "negative",
    expectedUrl: "/dashboard",
  }), true);
  assert.equal(evaluatePromotedAssertionState("https://example.test/dashboard", {
    polarity: "negative",
    expectedUrl: "/dashboard",
  }), false);
});

test("structured promoted assertion fails closed without polarity or descriptor", () => {
  assert.throws(() => evaluatePromotedAssertionState("https://example.test/dashboard", {
    expectedUrl: "/dashboard",
  }), /PROMOTED_ASSERTION_POLARITY_UNRESOLVED/);
  assert.throws(() => evaluatePromotedAssertionState("https://example.test/dashboard", {
    polarity: "negative",
  }), /PROMOTED_ASSERTION_DESCRIPTOR_UNRESOLVED/);
});

test("visible text collections ignore non-strings before normalization", () => {
  const values: unknown[] = [undefined, null, "", "Continuar"];
  const target = normalize("continuar");
  const normalized = values
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .some((value) => normalize(value).includes(target));
  assert.equal(normalized, true);
});

test("invalid-only visible text collections remain a no-match", () => {
  const values: unknown[] = [undefined, null, ""];
  const normalized = values
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .some((value) => normalize(value).includes("continuar"));
  assert.equal(normalized, false);
});

test("fill field resolver accepts modern and legacy aliases fail-closed", () => {
  assert.equal(resolvePromotedFieldTarget({ field: "Campo" }), "Campo");
  assert.equal(resolvePromotedFieldTarget({ target: "Campo" }), "Campo");
  assert.equal(resolvePromotedFieldTarget({ field: "Autenticación", target: "autenticacion" }), "Autenticación");
  assert.throws(() => resolvePromotedFieldTarget({ field: "Campo A", target: "Campo B" }), /conflicting_field_target/);
  assert.throws(() => resolvePromotedFieldTarget({}), /invalid_context_action_target/);
  assert.throws(() => resolvePromotedFieldTarget({ target: "" }), /invalid_context_action_target/);
  assert.throws(() => resolvePromotedFieldTarget({ target: undefined }), /invalid_context_action_target/);
});

test("fill context matches semantic field signals without values", () => {
  assert.equal(doesVisibleFieldSignalMatch(["Campo de prueba"], "campo de prueba"), true);
  assert.equal(doesVisibleFieldSignalMatch(["Identificador"], "identificador"), true);
  assert.equal(doesVisibleFieldSignalMatch(["Ingrese identificador"], "identificador"), true);
  assert.equal(doesVisibleFieldSignalMatch(["Nombre"], "Contraseña"), false);
  assert.equal(doesVisibleFieldSignalMatch([undefined, null, ""], "Campo"), false);
});

test("fill context matches equivalent mojibake field labels", () => {
  assert.equal(doesVisibleFieldSignalMatch(["Contraseña"], "ContraseÃ±a"), true);
});

test("fill context remains fail-closed for a different field", () => {
  assert.equal(doesVisibleFieldSignalMatch(["Nombre de usuario"], "ContraseÃ±a"), false);
});

function fakePageForContainer(container: any): any {
  return {
    evaluate: async (callback: (field: string) => unknown, field: string) => {
      const previousDocument = (globalThis as any).document;
      const previousWindow = (globalThis as any).window;
      (globalThis as any).document = { querySelectorAll: () => [container] };
      (globalThis as any).window = { getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
      try {
        return callback(field);
      } finally {
        (globalThis as any).document = previousDocument;
        (globalThis as any).window = previousWindow;
      }
    },
  };
}

test("field container matcher repairs mojibake before native fill selection", async () => {
  const field = {
    name: "password",
    id: "password",
    getAttribute: (attribute: string) => attribute === "type" ? "password" : null,
  };
  const container = {
    textContent: "Contraseña",
    tagName: "FORM",
    id: "login-form",
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 40 }),
    querySelectorAll: () => [field],
  };
  const result = await findBestActiveContainerForField(fakePageForContainer(container), "ContraseÃ±a");
  assert.equal(result.best?.matchingFieldFound, true);
});

test("field container matcher rejects a missing field", async () => {
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
  const result = await findBestActiveContainerForField(fakePageForContainer(container), "Contraseña");
  assert.equal(result.best?.matchingFieldFound, false);
});

function fakeLocator(count: number): any {
  return {
    count: async () => count,
    first() { return this; },
    isVisible: async () => true,
    isDisabled: async () => false,
    evaluate: async () => "input",
  };
}

function fakeResolverPage(label: string): any {
  const container = fakeLocator(1);
  const matching = (_regex: RegExp) => fakeLocator(label === "Contrase\u00f1a" ? 1 : 0);
  container.getByLabel = matching;
  container.getByPlaceholder = () => fakeLocator(0);
  container.getByRole = () => fakeLocator(0);
  container.locator = () => fakeLocator(0);
  return {
    locator: (selector: string) => selector === "#login-form" ? container : fakeLocator(0),
    getByLabel: matching,
    getByPlaceholder: () => fakeLocator(0),
    getByRole: () => fakeLocator(0),
  };
}

test("field locator resolves an equivalent mojibake label", async () => {
  const result = await resolvePromotedFieldLocator(fakeResolverPage("Contrase\u00f1a"), "Contrase\u00c3\u00b1a");
  assert.ok(result?.locator);
  assert.equal(result?.strategy, "page:getByLabel");
});

test("field locator rejects a different label", async () => {
  const result = await resolvePromotedFieldLocator(fakeResolverPage("Nombre de usuario"), "Contrase\u00c3\u00b1a", {
    containerLocator: "#login-form",
  });
  assert.equal(result, undefined);
});

function fakeRawCandidatePage(labels: string[]): any {
  const candidates = labels.map((label) => ({
    count: async () => 1,
    nth: () => undefined,
    isVisible: async () => true,
    isDisabled: async () => false,
    evaluate: async (callback: (element: Element) => unknown) => callback({
      tagName: "INPUT",
      getAttribute: (name: string) => name === "aria-label" ? label : null,
      id: "",
      closest: () => null,
    } as any),
  }));
  const fields = {
    count: async () => candidates.length,
    nth: (index: number) => {
      const candidate = candidates[index];
      candidate.nth = () => candidate;
      return candidate;
    },
  };
  const scope = { locator: () => fields };
  return {
    locator: (selector: string) => selector === "#login-form" ? scope : fields,
    getByLabel: () => fakeLocator(0),
    getByPlaceholder: () => fakeLocator(0),
    getByRole: () => fakeLocator(0),
  };
}

test("semantic candidate resolution preserves the raw matching input", async () => {
  const result = await resolvePromotedFieldLocator(
    fakeRawCandidatePage(["Nombre de usuario", "Contrase\u00f1a"]),
    "Contrase\u00c3\u00b1a",
    { containerLocator: "#login-form" },
  );
  assert.ok(result?.locator);
  assert.equal(result?.strategy, "container:semanticCandidate");
});

test("semantic candidate resolution rejects ambiguous matches", async () => {
  const result = await resolvePromotedFieldLocator(
    fakeRawCandidatePage(["Contrase\u00f1a", "Contrase\u00f1a"]),
    "Contrase\u00c3\u00b1a",
    { containerLocator: "#login-form" },
  );
  assert.equal(result, undefined);
});
