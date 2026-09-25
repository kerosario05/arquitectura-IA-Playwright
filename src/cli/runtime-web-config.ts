import { config } from "../config/env";
import { loadPromotedAppConfigSync } from "../automations/app-profile";
import { getProjectConfigurationBySlug } from "../db/project-reader";

export type RuntimeWebBaseUrlResolution = {
  appSlug: string;
  source: "project_sql" | "app_config";
  configured?: string;
  effective: string;
  fallbackUsed: boolean;
  ignoreHTTPSErrors?: boolean;
};

function validUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const candidate = value.trim();
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function resolveWebBaseUrl(appSlug: string): RuntimeWebBaseUrlResolution {
  const normalized = appSlug.trim();
  const cfg: any = loadPromotedAppConfigSync({ appSlug: normalized });
  const configured = validUrl(cfg?.baseUrl);
  if (configured) {
    const safe = new URL(configured);
    console.log(`[web:base-url] appSlug=${normalized} source=app_config origin=${safe.origin} pathname=${safe.pathname} fallbackUsed=false`);
    return {
      appSlug: normalized,
      source: "app_config",
      configured,
      effective: configured,
      fallbackUsed: false,
      ...(cfg?.ignoreHTTPSErrors === undefined ? {} : { ignoreHTTPSErrors: Boolean(cfg.ignoreHTTPSErrors) }),
    };
  }

  const envFallback = config.app.baseUrl;
  console.log(`[web:base-url] appSlug=${normalized} source=fallback configuredPresent=${Boolean(configured)} effectivePresent=${Boolean(envFallback)} fallbackUsed=true`);
  throw new Error(`[web:base-url] missing baseUrl for appSlug=${normalized} source=app_config — FAIL CLOSED: create automations/apps/${normalized}/app.config.json with baseUrl. Env fallback present=${Boolean(envFallback)} not used.`);
}

/** SQL project configuration is authoritative; materialized app.config is fallback only. */
export async function resolveRuntimeWebBaseUrl(appSlug: string): Promise<RuntimeWebBaseUrlResolution> {
  const normalized = appSlug.trim();
  try {
    const project = await getProjectConfigurationBySlug(normalized);
    const projectBaseUrl = validUrl(project?.web?.baseUrl);
    if (projectBaseUrl) {
      const safe = new URL(projectBaseUrl);
      console.log(`[web:base-url] appSlug=${normalized} source=project_sql origin=${safe.origin} pathname=${safe.pathname} fallbackUsed=false`);
      return {
        appSlug: normalized,
        source: "project_sql",
        configured: projectBaseUrl,
        effective: projectBaseUrl,
        fallbackUsed: false,
        ...(project?.web?.ignoreHTTPSErrors === undefined ? {} : { ignoreHTTPSErrors: Boolean(project.web.ignoreHTTPSErrors) }),
      };
    }
  } catch (error) {
    console.log(`[web:base-url] appSlug=${normalized} project_sql=unavailable reason=${error instanceof Error ? error.message : String(error)}`);
  }

  return resolveWebBaseUrl(normalized);
}
