"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const data_resolver_1 = require("../src/data/data-resolver");
function createContext(entries) {
    const sensitive = entries.filter((entry) => entry.sensitive).length;
    return {
        entries,
        counts: {
            total: entries.length,
            sensitive,
            nonSensitive: entries.length - sensitive
        }
    };
}
(0, test_1.test)("resolves cedula from test data by label", () => {
    const context = createContext([
        { key: "cedula", value: "00112345678", source: "test_data", sensitive: true }
    ]);
    const result = (0, data_resolver_1.resolveDataForField)({ label: "Cédula" }, context, {}, "fail");
    (0, test_1.expect)(result.status).toBe("resolved");
    if (result.status === "resolved") {
        (0, test_1.expect)(result.key).toBe("cedula");
    }
});
(0, test_1.test)("resolves alias codigo to numero2", () => {
    const context = createContext([
        { key: "numero2", value: "123456", source: "test_data", sensitive: false }
    ]);
    const aliases = {
        numero2: ["codigo", "código", "otp", "pin", "token"]
    };
    const result = (0, data_resolver_1.resolveDataForField)({ label: "Código de 6 dígitos" }, context, aliases, "fail");
    (0, test_1.expect)(result.status).toBe("resolved");
    if (result.status === "resolved") {
        (0, test_1.expect)(result.key).toBe("numero2");
    }
});
(0, test_1.test)("resolves APP_USERNAME by semantic hint", () => {
    const context = createContext([
        { key: "APP_USERNAME", value: "usuario_demo", source: "app_username", sensitive: false }
    ]);
    const result = (0, data_resolver_1.resolveDataForField)({ label: "Usuario" }, context, {}, "fail");
    (0, test_1.expect)(result.status).toBe("resolved");
    if (result.status === "resolved") {
        (0, test_1.expect)(["APP_USERNAME", "username"]).toContain(result.key);
    }
});
(0, test_1.test)("resolves APP_PASSWORD by placeholder and marks sensitive", () => {
    const context = createContext([
        { key: "APP_PASSWORD", value: "secret", source: "app_password", sensitive: true }
    ]);
    const result = (0, data_resolver_1.resolveDataForField)({ placeholder: "Contraseña" }, context, {}, "fail");
    (0, test_1.expect)(result.status).toBe("resolved");
    if (result.status === "resolved") {
        (0, test_1.expect)(result.sensitive).toBe(true);
    }
});
(0, test_1.test)("returns missing_input for loan number with fail behavior", () => {
    const context = createContext([]);
    const result = (0, data_resolver_1.resolveDataForField)({ label: "Número de préstamo" }, context, {}, "fail");
    (0, test_1.expect)(result.status).toBe("missing_input");
    if (result.status === "missing_input") {
        (0, test_1.expect)(result.suggestedVariableNames).toEqual(test_1.expect.arrayContaining(["numeroPrestamo", "loanNumber"]));
    }
});
(0, test_1.test)("returns skipped for missing phone with skip behavior", () => {
    const context = createContext([]);
    const result = (0, data_resolver_1.resolveDataForField)({ label: "Teléfono" }, context, {}, "skip");
    (0, test_1.expect)(result.status).toBe("skipped");
});
(0, test_1.test)("does not auto-pick when generic number has multiple candidates", () => {
    const context = createContext([
        { key: "referenciaA", value: "111", source: "test_data", sensitive: false },
        { key: "referenciaB", value: "222", source: "test_data", sensitive: false }
    ]);
    const result = (0, data_resolver_1.resolveDataForField)({ label: "Número" }, context, {}, "fail");
    (0, test_1.expect)(result.status).toBe("missing_input");
});
