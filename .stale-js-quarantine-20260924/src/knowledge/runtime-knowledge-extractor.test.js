"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const test_1 = require("@playwright/test");
const runtime_knowledge_extractor_1 = require("./runtime-knowledge-extractor");
(0, node_test_1.default)("captures grid row/cell/header context for editors", async () => {
    const browser = await test_1.chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`
      <style>table { width: 800px; } td, th { width: 200px; height: 30px; }</style>
      <table aria-label="Colaboradores">
        <thead><tr><th>Tipo</th><th>Correo electrónico</th><th>Monto</th></tr></thead>
        <tbody><tr data-id="row-1">
          <td><select aria-label="Indicar..."><option>analista</option></select></td>
          <td><input placeholder="Indicar..." aria-label="Indicar..." /></td>
          <td><select aria-label="DOP"></select><input placeholder="campo" /></td>
        </tr></tbody>
      </table>
    `);
        const snapshot = await (0, runtime_knowledge_extractor_1.extractRuntimeUiSnapshot)(page);
        strict_1.default.equal(snapshot.gridMetadata?.detected, true);
        strict_1.default.ok((snapshot.gridMetadata?.rows ?? 0) >= 2);
        strict_1.default.ok((snapshot.gridMetadata?.cells ?? 0) >= 3);
        strict_1.default.deepEqual(snapshot.gridMetadata?.headers, ["Tipo", "Correo electrónico", "Monto"]);
        const editors = snapshot.observedControls.filter((control) => control.rowIdentity === "row-1");
        strict_1.default.ok(editors.length >= 4);
        strict_1.default.ok(editors.some((control) => control.headerContext === "Correo electrónico"));
        strict_1.default.ok(editors.some((control) => control.headerContext === "Monto"));
        strict_1.default.ok(snapshot.gridMetadata?.headerRelationships.some((item) => item.header === "Monto"));
    }
    finally {
        await browser.close();
    }
});
