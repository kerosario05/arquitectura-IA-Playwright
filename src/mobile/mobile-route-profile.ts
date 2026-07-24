import * as fs from "node:fs";
import * as path from "node:path";
import type { MobileRouteProfile } from "./mobile-route-profile.types";

function profilePath(appSlug: string): string {
  return path.join(process.cwd(), "automations", "apps", appSlug, "mobile.config.json");
}

/**
 * Loads the real-screen grounding data for a mobile app, captured via manual or
 * automated exploration (see src/mobile/appium-session.ts + getPageSource()). Mirrors
 * automations/apps/<slug>/app.config.json's routeProfile for the web pipeline — same
 * purpose (ground AI-generated steps in real UI instead of guessing from HU text
 * alone), separate file because the schema is native-screen shaped, not DOM shaped.
 */
export function loadMobileRouteProfile(appSlug: string): MobileRouteProfile | null {
  const filePath = profilePath(appSlug);
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as MobileRouteProfile;
  } catch (err) {
    console.error(`[mobile:route-profile] failed to parse ${filePath}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export function saveMobileRouteProfile(appSlug: string, profile: MobileRouteProfile): void {
  const filePath = profilePath(appSlug);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), "utf-8");
}
