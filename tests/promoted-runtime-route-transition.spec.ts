import { expect, test } from "@playwright/test";
import { PromotedSpecRuntime } from "../src/automations/runtime/promoted-spec-runtime";

test("promoted positive URL assertion waits for a delayed login redirect", async ({ page }) => {
  await page.route("https://promoted-route-transition.test/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === "/login"
      ? `<!doctype html><html><body><main>Login</main><script>setTimeout(() => location.assign('/dashboard'), 200)</script></body></html>`
      : `<!doctype html><html><body><main>Dashboard</main></body></html>`;
    await route.fulfill({ status: 200, contentType: "text/html", body });
  });
  await page.goto("https://promoted-route-transition.test/login");

  const runtime = new PromotedSpecRuntime(page, { captureDiagnostics: false });
  (runtime as any).ensureInitialEvidence = async () => undefined;
  (runtime as any).captureEvidenceStep = async () => undefined;

  await runtime.expectPromotedVisible({
    stepIndex: 5,
    target: "Continuar",
    polarity: "positive",
    expectedUrl: "/dashboard",
    assertion: async () => expect(page).toHaveURL(/\/dashboard$/),
  });

  await expect(page).toHaveURL(/\/dashboard$/);
});
