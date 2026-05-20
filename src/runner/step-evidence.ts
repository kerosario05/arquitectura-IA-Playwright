import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";

function sanitizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function captureStepScreenshot(input: {
  page: Page;
  evidenceDir: string;
  stepIndex: number;
  action: string;
  status: "passed" | "failed";
}): Promise<string> {
  await mkdir(input.evidenceDir, { recursive: true });

  const fileName = `step-${String(input.stepIndex).padStart(3, "0")}-${sanitizeToken(input.action)}-${input.status}.png`;
  const screenshotPath = path.join(input.evidenceDir, fileName);
  await input.page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}
