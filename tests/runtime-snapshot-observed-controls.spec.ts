import { test, expect } from "@playwright/test";
import { extractRuntimeUiSnapshot } from "../src/knowledge/runtime-knowledge-extractor";

test("runtime snapshot captures structured observed controls additively", async ({ page }) => {
  await page.setContent(`
    <button data-testid="stable-alfa">Control Alfa</button>
    <a href="/destino">Control Beta</a>
    <button>Control Alfa</button>
    <div>Contenido no accionable</div>
  `);

  const snapshot = await extractRuntimeUiSnapshot(page);

  // Legacy fields preserved.
  expect(snapshot.clickTargets).toContain("Control Alfa");
  expect(snapshot.clickTargets).toContain("Control Beta");
  expect(snapshot.clickTargets).toHaveLength(2);

  // Structured controls, deterministically deduped to the 2 distinct labels.
  expect(snapshot.observedControls).toHaveLength(2);
  const alfa = snapshot.observedControls.find((c) => c.label === "Control Alfa");
  const beta = snapshot.observedControls.find((c) => c.label === "Control Beta");
  expect(alfa).toBeDefined();
  expect(beta).toBeDefined();

  // sourceScreenKey matches the snapshot that observed each control.
  expect(alfa!.sourceScreenKey).toBe(snapshot.screenKey);
  expect(beta!.sourceScreenKey).toBe(snapshot.screenKey);

  // Labels preserved.
  expect(alfa!.businessLabel).toBe("Control Alfa");
  expect(beta!.businessLabel).toBe("Control Beta");

  // Optional identity only when actually observed.
  expect(alfa!.locatorIdentity).toBe("stable-alfa");
  expect(alfa!.role).toBe("button");
  expect(beta!.href).toBe("/destino");
  expect(beta!.role).toBe("a");

  // Fields never observed stay absent.
  expect(alfa!.href).toBeUndefined();
  expect(beta!.locatorIdentity).toBeUndefined();
});