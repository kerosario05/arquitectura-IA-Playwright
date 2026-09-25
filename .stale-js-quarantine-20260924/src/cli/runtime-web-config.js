"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWebBaseUrl = resolveWebBaseUrl;
exports.resolveRuntimeWebBaseUrl = resolveRuntimeWebBaseUrl;
const env_1 = require("../config/env");
const app_profile_1 = require("../automations/app-profile");
const project_reader_1 = require("../db/project-reader");
function validUrl(value) {
    if (typeof value !== "string" || value.trim().length === 0)
        return undefined;
    const candidate = value.trim();
    try {
        const parsed = new URL(candidate);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : undefined;
    }
    catch {
        return undefined;
    }
}
function resolveWebBaseUrl(appSlug) {
    const normalized = appSlug.trim();
    const cfg = (0, app_profile_1.loadPromotedAppConfigSync)({ appSlug: normalized });
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
    const envFallback = env_1.config.app.baseUrl;
    console.log(`[web:base-url] appSlug=${normalized} source=fallback configuredPresent=${Boolean(configured)} effectivePresent=${Boolean(envFallback)} fallbackUsed=true`);
    throw new Error(`[web:base-url] missing baseUrl for appSlug=${normalized} source=app_config — FAIL CLOSED: create automations/apps/${normalized}/app.config.json with baseUrl. Env fallback present=${Boolean(envFallback)} not used.`);
}
/** SQL project configuration is authoritative; materialized app.config is fallback only. */
async function resolveRuntimeWebBaseUrl(appSlug) {
    const normalized = appSlug.trim();
    try {
        const project = await (0, project_reader_1.getProjectConfigurationBySlug)(normalized);
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
    }
    catch (error) {
        console.log(`[web:base-url] appSlug=${normalized} project_sql=unavailable reason=${error instanceof Error ? error.message : String(error)}`);
    }
    return resolveWebBaseUrl(normalized);
}
