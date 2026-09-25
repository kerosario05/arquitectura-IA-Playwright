"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const runtime_knowledge_extractor_1 = require("../src/knowledge/runtime-knowledge-extractor");
(0, test_1.test)("runtime snapshot captures structured observed controls additively", async ({ page }) => {
    await page.setContent(`
    <button data-testid="stable-alfa">Control Alfa</button>
    <a href="/destino">Control Beta</a>
    <button>Control Alfa</button>
    <div>Contenido no accionable</div>
  `);
    const snapshot = await (0, runtime_knowledge_extractor_1.extractRuntimeUiSnapshot)(page);
    // Legacy fields preserved.
    (0, test_1.expect)(snapshot.clickTargets).toContain("Control Alfa");
    (0, test_1.expect)(snapshot.clickTargets).toContain("Control Beta");
    (0, test_1.expect)(snapshot.clickTargets).toHaveLength(2);
    // Structured controls, deterministically deduped to the 2 distinct labels.
    (0, test_1.expect)(snapshot.observedControls).toHaveLength(2);
    const alfa = snapshot.observedControls.find((c) => c.label === "Control Alfa");
    const beta = snapshot.observedControls.find((c) => c.label === "Control Beta");
    (0, test_1.expect)(alfa).toBeDefined();
    (0, test_1.expect)(beta).toBeDefined();
    // sourceScreenKey matches the snapshot that observed each control.
    (0, test_1.expect)(alfa.sourceScreenKey).toBe(snapshot.screenKey);
    (0, test_1.expect)(beta.sourceScreenKey).toBe(snapshot.screenKey);
    // Labels preserved.
    (0, test_1.expect)(alfa.businessLabel).toBe("Control Alfa");
    (0, test_1.expect)(beta.businessLabel).toBe("Control Beta");
    // Optional identity only when actually observed.
    (0, test_1.expect)(alfa.locatorIdentity).toBe("stable-alfa");
    (0, test_1.expect)(alfa.role).toBe("button");
    (0, test_1.expect)(beta.href).toBe("/destino");
    (0, test_1.expect)(beta.role).toBe("a");
    // Fields never observed stay absent.
    (0, test_1.expect)(alfa.href).toBeUndefined();
    (0, test_1.expect)(beta.locatorIdentity).toBeUndefined();
});
