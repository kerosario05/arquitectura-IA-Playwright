"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const object_resolver_1 = require("../src/registry/object-resolver");
const registry = {
    version: "1.0",
    appName: "generic",
    objects: [
        {
            key: "cedulaInput",
            name: "Cédula input",
            description: "Campo de cédula del cliente",
            type: "input",
            locator: { strategy: "label", value: "Cédula" },
            aliases: ["documento", "identificacion"],
            tags: ["cliente"]
        }
    ]
};
(0, test_1.test)("resolves by exact key", () => {
    const result = (0, object_resolver_1.resolveRegistryObject)(registry, "cedulaInput");
    (0, test_1.expect)(result?.key).toBe("cedulaInput");
});
(0, test_1.test)("resolves by alias", () => {
    const result = (0, object_resolver_1.resolveRegistryObject)(registry, "documento");
    (0, test_1.expect)(result?.key).toBe("cedulaInput");
});
(0, test_1.test)("find by text in name", () => {
    const results = (0, object_resolver_1.findRegistryObjectsByText)(registry, "input");
    (0, test_1.expect)(results).toHaveLength(1);
});
(0, test_1.test)("normalizes accents", () => {
    (0, test_1.expect)((0, object_resolver_1.normalizeRegistryText)("Cédula")).toBe("cedula");
    const result = (0, object_resolver_1.resolveRegistryObject)(registry, "identificación");
    (0, test_1.expect)(result?.key).toBe("cedulaInput");
});
