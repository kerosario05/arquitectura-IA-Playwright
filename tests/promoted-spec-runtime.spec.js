"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promoted_spec_runtime_1 = require("../src/automations/runtime/promoted-spec-runtime");
const node_path_1 = __importDefault(require("node:path"));
(0, test_1.test)("click exitoso sin retry", async ({ page }) => {
    await page.setContent(`<button id="go" onclick="window.__clicked=true">Go</button>`);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false, retryEnabled: true });
    await runtime.clickPromotedTarget({
        stepIndex: 1,
        target: "Go",
        actionIntent: "click",
        action: async () => { await page.locator("#go").click(); }
    });
    const clicked = await page.evaluate(() => window.__clicked === true);
    (0, test_1.expect)(clicked).toBe(true);
});
(0, test_1.test)("select_visible_item_by_ordinal selecciona el primer producto visible", async ({ page }) => {
    await page.setContent(`
    <div role="list">
      <article class="product-card">
        <button id="card-1" onclick="window.__selected='Tarjeta de Crédito'">Tarjeta de Crédito</button>
      </article>
      <button id="back">Volver</button>
    </div>
  `);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await runtime.clickPromotedTarget({
        stepIndex: 1,
        target: "Seleccionar el primer producto visible del listado",
        actionIntent: "select_visible_item_by_ordinal",
        routeProfile: { domainTerms: ["producto", "tarjeta", "cuenta"], aliases: {}, routes: [] },
        action: async () => { await page.locator("#card-1").click(); }
    });
    const selected = await page.evaluate(() => window.__selected);
    (0, test_1.expect)(selected).toBe("Tarjeta de Crédito");
});
(0, test_1.test)("select_visible_item_by_ordinal selecciona la primera cuenta visible", async ({ page }) => {
    await page.setContent(`
    <button id="ignore">Selecciona una cuenta</button>
    <div class="account-row" role="row">
      <button id="account-1" onclick="window.__selected='Cuenta Corriente'">Cuenta Corriente</button>
    </div>
    <div class="account-row" role="row">
      <button id="account-2" onclick="window.__selected='Cuenta de Ahorros'">Cuenta de Ahorros</button>
    </div>
  `);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await runtime.clickPromotedTarget({
        stepIndex: 2,
        target: "Seleccionar la primera cuenta visible",
        actionIntent: "select_visible_item_by_ordinal",
        routeProfile: { domainTerms: ["cuenta"], aliases: {}, routes: [] },
        action: async () => { await page.locator("#account-1").click(); }
    });
    const selected = await page.evaluate(() => window.__selected);
    (0, test_1.expect)(selected).toBe("Cuenta Corriente");
});
(0, test_1.test)("select_visible_item_by_ordinal selecciona el primer beneficiario visible", async ({ page }) => {
    await page.setContent(`
    <h2>Selecciona un beneficiario</h2>
    <div role="listitem">
      <button id="benef-1" onclick="window.__selected='Beneficiario 1'">Beneficiario 1</button>
    </div>
    <div role="listitem">
      <button id="benef-2" onclick="window.__selected='Beneficiario 2'">Beneficiario 2</button>
    </div>
  `);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await runtime.clickPromotedTarget({
        stepIndex: 3,
        target: "Seleccionar el primer beneficiario",
        actionIntent: "select_visible_item_by_ordinal",
        routeProfile: { domainTerms: ["beneficiario"], aliases: {}, routes: [] },
        action: async () => { await page.locator("#benef-1").click(); }
    });
    const selected = await page.evaluate(() => window.__selected);
    (0, test_1.expect)(selected).toBe("Beneficiario 1");
});
(0, test_1.test)("select_visible_item_by_ordinal excluye headings y textos instructivos", async ({ page }) => {
    await page.setContent(`
    <h2>Selecciona un producto</h2>
    <div class="helper">Elige una opción para continuar</div>
    <article class="product-card">
      <button id="real-1" onclick="window.__selected='Producto real'">Producto real</button>
    </article>
  `);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await runtime.clickPromotedTarget({
        stepIndex: 4,
        target: "Seleccionar el primer producto visible del listado",
        actionIntent: "select_visible_item_by_ordinal",
        routeProfile: { domainTerms: ["producto"], aliases: {}, routes: [] },
        action: async () => { await page.locator("#real-1").click(); }
    });
    const selected = await page.evaluate(() => window.__selected);
    (0, test_1.expect)(selected).toBe("Producto real");
});
(0, test_1.test)("select_visible_item_by_ordinal falla con diagnostico claro cuando no hay candidato seguro", async ({ page }) => {
    await page.setContent(`
    <h2>Selecciona un producto</h2>
    <button>Volver</button>
  `);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await (0, test_1.expect)(runtime.clickPromotedTarget({
        stepIndex: 5,
        target: "Seleccionar el primer producto visible del listado",
        actionIntent: "select_visible_item_by_ordinal",
        routeProfile: { domainTerms: ["producto"], aliases: {}, routes: [] },
        action: async () => { await page.click("#missing"); }
    })).rejects.toThrow(/missing_runtime_context_for_ordinal/);
});
(0, test_1.test)("select_visible_item_by_ordinal falla con missing_runtime_context_for_ordinal cuando no hay listado listo", async ({ page }) => {
    await page.setContent(`<h1>Â¡Hola!</h1><button>Iniciar</button>`);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await (0, test_1.expect)(runtime.clickPromotedTarget({
        stepIndex: 6,
        target: "Seleccionar el primer producto visible del listado",
        actionIntent: "select_visible_item_by_ordinal",
        routeProfile: { domainTerms: ["producto"], aliases: {}, routes: [] },
        action: async () => { throw new Error("should not be called"); }
    })).rejects.toThrow(/missing_runtime_context_for_ordinal/);
});
(0, test_1.test)("click abre modal y se considera exito sin navegacion", async ({ page }) => {
    await page.setContent(`
    <button id="open" onclick="document.getElementById('m').style.display='block'">Open</button>
    <div id="m" role="dialog" style="display:none"><input id="f" /></div>
  `);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false, stabilityTimeoutMs: 1500 });
    await runtime.clickPromotedTarget({
        stepIndex: 2,
        target: "Open",
        actionIntent: "open_modal",
        expectedEffect: "modal_or_form_or_navigation",
        action: async () => {
            await page.locator("#open").click();
            await page.evaluate(() => { document.getElementById("m").style.display = "block"; });
        }
    });
    await (0, test_1.expect)(page.locator("#m")).toBeVisible();
});
(0, test_1.test)("click sin cambio ni modal falla con diagnostics", async ({ page }) => {
    // Test that callback fallback triggers stability check failure when navigation expected but doesn't happen
    // Use target that native resolver can't find to force callback path
    await page.setContent(`<button id="noop">Click Me</button>`);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: true, stabilityTimeoutMs: 1200, captureDiagnostics: false, retryEnabled: false });
    await (0, test_1.expect)(runtime.clickPromotedTarget({
        stepIndex: 3,
        target: "NonExistentButton",
        actionIntent: "navigate",
        expectedEffect: "navigation",
        action: async () => { await page.locator("#noop").click({ noWaitAfter: true }); }
    })).rejects.toThrow();
});
(0, test_1.test)("retry se ejecuta maximo una vez", async ({ page }) => {
    // Use a button without id/text that native resolver can't find, forcing callback fallback
    await page.setContent(`<button onclick="void(0)">Click Me</button>`);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false, retryEnabled: true });
    let attempts = 0;
    await runtime.clickPromotedTarget({
        stepIndex: 4,
        target: "NonExistentButton",
        actionIntent: "click",
        action: async () => {
            attempts += 1;
            if (attempts === 1)
                throw new Error("first fail");
        }
    });
    (0, test_1.expect)(attempts).toBe(2);
});
(0, test_1.test)("no retry para accion sensible", async ({ page }) => {
    // Use a button that native resolver can't find, forcing callback fallback
    await page.setContent(`<button onclick="void(0)">Sensitive Action</button>`);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false, retryEnabled: true, captureDiagnostics: false });
    let attempts = 0;
    await (0, test_1.expect)(runtime.clickPromotedTarget({
        stepIndex: 5,
        target: "NonExistentSensitive",
        actionIntent: "submit",
        sensitive: true,
        action: async () => {
            attempts += 1;
            throw new Error("blocked");
        }
    })).rejects.toThrow();
    (0, test_1.expect)(attempts).toBe(1);
});
(0, test_1.test)("fill usa active container y fallback a page", async ({ page }) => {
    await page.setContent(`
    <button id="open" onclick="document.getElementById('m').style.display='block'">Open</button>
    <div id="m" role="dialog" style="display:none"><input id="inside" /></div>
    <input id="outside" />
  `);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false, stabilityTimeoutMs: 1500 });
    await runtime.clickPromotedTarget({
        stepIndex: 6,
        target: "Open",
        actionIntent: "open_modal",
        expectedEffect: "modal_or_form_or_navigation",
        action: async () => {
            await page.locator("#open").click();
            await page.evaluate(() => { document.getElementById("m").style.display = "block"; });
        }
    });
    await runtime.fillPromotedField({
        stepIndex: 7,
        field: "Name",
        value: "John",
        fill: async () => { await page.locator("#inside").fill("John"); },
        fillInActiveContainer: async () => { await page.locator("#inside").fill("John"); },
        fillInPage: async () => { await page.locator("#outside").fill("John"); }
    });
    await (0, test_1.expect)(page.locator("#inside")).toHaveValue("John");
});
(0, test_1.test)("activeContainer visible sin campo se descarta y usa otro contenedor", async ({ page }) => {
    await page.setContent(`
    <div id="old" role="dialog" style="display:block"><input id="old-field" /></div>
    <div id="new" role="dialog" style="display:block"><label>Name</label><input id="new-field" /></div>
  `);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await runtime.fillPromotedField({
        stepIndex: 9,
        field: "Name",
        value: "Alice",
        fill: async () => { await page.locator("#new-field").fill("Alice"); },
        fillInActiveContainer: async () => { await page.locator("#new-field").fill("Alice"); },
        fillInPage: async () => { await page.locator("#new-field").fill("Alice"); }
    });
    await (0, test_1.expect)(page.locator("#new-field")).toHaveValue("Alice");
});
(0, test_1.test)("activeContainer oculto stale se descarta", async ({ page }) => {
    await page.setContent(`
    <div id="old" role="dialog" style="display:none"><input id="old-field" /></div>
    <div id="new" role="dialog" style="display:block"><label>Email</label><input id="new-field" /></div>
  `);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await runtime.fillPromotedField({
        stepIndex: 10,
        field: "Email",
        value: "a@b.com",
        fill: async () => { await page.locator("#new-field").fill("a@b.com"); },
        fillInActiveContainer: async () => { await page.locator("#new-field").fill("a@b.com"); },
        fillInPage: async () => { await page.locator("#new-field").fill("a@b.com"); }
    });
    await (0, test_1.expect)(page.locator("#new-field")).toHaveValue("a@b.com");
});
(0, test_1.test)("dos modales elige el que contiene field editable", async ({ page }) => {
    await page.setContent(`
    <div id="a" role="dialog" style="display:block"><label>Other</label><input id="other-field" /></div>
    <div id="b" role="dialog" style="display:block"><label>City</label><input id="city-field" /></div>
  `);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await runtime.fillPromotedField({
        stepIndex: 11,
        field: "City",
        value: "Santo Domingo",
        fill: async () => { await page.locator("#city-field").fill("Santo Domingo"); },
        fillInActiveContainer: async () => { await page.locator("#city-field").fill("Santo Domingo"); },
        fillInPage: async () => { await page.locator("#city-field").fill("Santo Domingo"); }
    });
    await (0, test_1.expect)(page.locator("#city-field")).toHaveValue("Santo Domingo");
});
(0, test_1.test)("captura mensaje de dialog", async ({ page }) => {
    await page.setContent(`<button id="a" onclick="alert('ok message')">Alert</button>`);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await runtime.clickPromotedTarget({
        stepIndex: 8,
        target: "Alert",
        actionIntent: "click",
        action: async () => { await page.locator("#a").click(); }
    });
    const msg = await runtime.handlePromotedDialogOrAlert();
    (0, test_1.expect)(msg).toContain("ok message");
    const debug = await runtime.getDebugState();
    (0, test_1.expect)(debug.activeContainer).toBeFalsy();
});
(0, test_1.test)("page fallback funciona si no hay modal valido", async ({ page }) => {
    await page.setContent(`<label>Name</label><input id="page-name" />`);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await runtime.fillPromotedField({
        stepIndex: 12,
        field: "Name",
        value: "Bob",
        fill: async () => { await page.locator("#page-name").fill("Bob"); },
        fillInPage: async () => { await page.locator("#page-name").fill("Bob"); }
    });
    await (0, test_1.expect)(page.locator("#page-name")).toHaveValue("Bob");
});
(0, test_1.test)("error diagnostics incluye contenedores evaluados y screenshot", async ({ page }) => {
    await page.setContent(`<div id="x" role="dialog" style="display:block"><input id="x1" /></div>`);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false, captureDiagnostics: true });
    const evidenceDir = node_path_1.default.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-test");
    await (0, test_1.expect)(runtime.fillPromotedField({
        stepIndex: 13,
        field: "MissingField",
        value: "value",
        evidenceDir,
        fill: async () => { throw new Error("forced"); },
        fillInActiveContainer: async () => { throw new Error("forced-active"); },
        fillInPage: async () => { throw new Error("forced-page"); }
    })).rejects.toThrow(/fillPath|nativeFillAttempted|callbackAttempted|diagnostics/);
});
(0, test_1.test)("fillPromotedField verifies callback was executed", async ({ page }) => {
    await page.setContent(`<label>Name</label><input id="name" />`);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    let callbackCalled = false;
    await runtime.fillPromotedField({
        stepIndex: 14,
        field: "Name",
        value: "Test",
        fill: async () => {
            callbackCalled = true;
            await page.locator("#name").fill("Test");
        }
    });
    (0, test_1.expect)(callbackCalled).toBe(true);
    await (0, test_1.expect)(page.locator("#name")).toHaveValue("Test");
});
(0, test_1.test)("fillPromotedField uses options.value as source of truth", async ({ page }) => {
    await page.setContent(`<label>Email</label><input id="email" />`);
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false });
    await runtime.fillPromotedField({
        stepIndex: 15,
        field: "Email",
        value: "test@example.com",
        fill: async () => { await page.locator("#email").fill("test@example.com"); }
    });
    const value = await page.locator("#email").inputValue();
    (0, test_1.expect)(value).toBe("test@example.com");
});
(0, test_1.test)("return_to_list recovers from home reset using replay metadata", async ({ page }) => {
    const runtime = (0, promoted_spec_runtime_1.createPromotedSpecRuntime)(page, { enabled: false, retryEnabled: false });
    await page.setContent(`<h1>¡Hola!</h1><button>Iniciar</button>`);
    const toDetail = async () => {
        await page.setContent(`
      <h1>Detalle del producto</h1>
      <button id="volver" onclick="document.body.innerHTML='<h1>Consulta de balance</h1><button>Depósitos a plazos</button><button>Depósito a Plazo 1</button>'">Volver</button>
    `);
    };
    await runtime.clickPromotedTarget({
        stepIndex: 7,
        target: "Volver al listado de productos",
        actionIntent: "return_to_list",
        previousStepReplays: [
            { stepIndex: 3, actionIntent: "start_session", target: "Iniciar", replay: async () => { } },
            { stepIndex: 4, actionIntent: "open_product_information", target: "Información de productos", replay: async () => { } },
            { stepIndex: 5, actionIntent: "select_product", target: "Depósitos a plazo", replay: async () => { } },
            { stepIndex: 6, actionIntent: "select_visible_item_by_ordinal", target: "el primer depósito visible del listado", replay: toDetail }
        ],
        lastSelectionStep: { stepIndex: 6, selectedTarget: "el primer depósito visible del listado" },
        lastSelectionReplay: toDetail,
        expectedOwnerPage: "ProductDetailPage",
        action: async () => {
            await page.getByRole("button", { name: "Volver", exact: true }).click();
        }
    });
    await (0, test_1.expect)(page.getByRole("heading", { name: /consulta de balance/i })).toBeVisible();
});
