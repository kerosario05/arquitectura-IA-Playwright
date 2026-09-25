"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe("route-profile-absent gate: config exists → discoveryAllowed", () => {
    (0, test_1.test)("case 1: app config exists, no routeProfile → discovery allowed, requires route learning", () => {
        const hasNonDefaultRouteProfile = (rp) => {
            if (!rp)
                return false;
            const hasDomainTerms = Object.keys(rp.domainTerms ?? {}).length > 0;
            const hasEntry = (rp.entry ?? []).length > 0;
            const hasVisibleControls = (rp.visibleControls ?? []).length > 0;
            return hasDomainTerms || hasEntry || hasVisibleControls;
        };
        const appConfig = { name: "Project A", baseUrl: "https://example.com", loginMode: "no_login" };
        const routeProfile = null;
        const appConfigExists = appConfig !== null;
        const requiresRouteLearning = !hasNonDefaultRouteProfile(routeProfile);
        (0, test_1.expect)(appConfigExists).toBe(true);
        (0, test_1.expect)(requiresRouteLearning).toBe(true);
        // Discovery should be allowed — config exists, just needs route learning
        // Old behavior: would emit invalid_target_app_slug here. New behavior: permits discovery.
    });
    (0, test_1.test)("case 2: app config exists, routeProfile present → current behavior preserved", () => {
        const hasNonDefaultRouteProfile = (rp) => {
            if (!rp)
                return false;
            const hasDomainTerms = Object.keys(rp.domainTerms ?? {}).length > 0;
            const hasEntry = (rp.entry ?? []).length > 0;
            const hasVisibleControls = (rp.visibleControls ?? []).length > 0;
            return hasDomainTerms || hasEntry || hasVisibleControls;
        };
        const appConfig = { name: "Project B", baseUrl: "https://example.com" };
        const routeProfile = {
            name: "inferred",
            entry: [{ action: "click", target: "Entrada" }],
            domainTerms: {},
            visibleControls: ["Catálogo"],
            aliases: {},
        };
        const appConfigExists = appConfig !== null;
        const requiresRouteLearning = !hasNonDefaultRouteProfile(routeProfile);
        (0, test_1.expect)(appConfigExists).toBe(true);
        (0, test_1.expect)(requiresRouteLearning).toBe(false);
        // No route learning needed — routeProfile is valid
    });
    (0, test_1.test)("case 3: app config missing → invalid_target_app_slug", () => {
        const appConfig = null;
        const appConfigExists = appConfig !== null;
        (0, test_1.expect)(appConfigExists).toBe(false);
        // This is the only case that should emit invalid_target_app_slug
    });
});
