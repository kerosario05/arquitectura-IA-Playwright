"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
(0, test_1.test)("existe la documentacion de arquitectura IA", () => {
    const path = (0, node_path_1.join)(process.cwd(), "docs", "ai-repair-architecture.md");
    (0, test_1.expect)((0, node_fs_1.existsSync)(path)).toBe(true);
});
(0, test_1.test)("la documentacion define limites clave", () => {
    const path = (0, node_path_1.join)(process.cwd(), "docs", "ai-repair-architecture.md");
    const content = (0, node_fs_1.readFileSync)(path, "utf8");
    (0, test_1.expect)(content).toContain("La IA no reemplaza el motor MCP");
    (0, test_1.expect)(content).toContain("La IA NO debe:");
    (0, test_1.expect)(content.toLowerCase()).toContain("controlar el navegador");
    (0, test_1.expect)(content).toContain("IA no modifica repo");
    (0, test_1.expect)(content).toContain("IA no inventa selectores");
    (0, test_1.expect)(content).toContain("target_not_found");
    (0, test_1.expect)(content).toContain("route_recovery");
    (0, test_1.expect)(content).toContain("assertion_resolution");
    (0, test_1.expect)(content).toContain("selection_resolution");
});
