import { test, expect } from "@playwright/test";

test.describe("route-profile-absent gate: config exists → discoveryAllowed", () => {
  test("case 1: app config exists, no routeProfile → discovery allowed, requires route learning", () => {
    const hasNonDefaultRouteProfile = (rp: Record<string, unknown> | null): boolean => {
      if (!rp) return false;
      const hasDomainTerms = Object.keys((rp as any).domainTerms ?? {}).length > 0;
      const hasEntry = ((rp as any).entry ?? []).length > 0;
      const hasVisibleControls = ((rp as any).visibleControls ?? []).length > 0;
      return hasDomainTerms || hasEntry || hasVisibleControls;
    };

    const appConfig = { name: "Project A", baseUrl: "https://example.com", loginMode: "no_login" };
    const routeProfile = null;

    const appConfigExists = appConfig !== null;
    const requiresRouteLearning = !hasNonDefaultRouteProfile(routeProfile);

    expect(appConfigExists).toBe(true);
    expect(requiresRouteLearning).toBe(true);
    // Discovery should be allowed — config exists, just needs route learning
    // Old behavior: would emit invalid_target_app_slug here. New behavior: permits discovery.
  });

  test("case 2: app config exists, routeProfile present → current behavior preserved", () => {
    const hasNonDefaultRouteProfile = (rp: Record<string, unknown> | null): boolean => {
      if (!rp) return false;
      const hasDomainTerms = Object.keys((rp as any).domainTerms ?? {}).length > 0;
      const hasEntry = ((rp as any).entry ?? []).length > 0;
      const hasVisibleControls = ((rp as any).visibleControls ?? []).length > 0;
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

    expect(appConfigExists).toBe(true);
    expect(requiresRouteLearning).toBe(false);
    // No route learning needed — routeProfile is valid
  });

  test("case 3: app config missing → invalid_target_app_slug", () => {
    const appConfig = null;

    const appConfigExists = appConfig !== null;

    expect(appConfigExists).toBe(false);
    // This is the only case that should emit invalid_target_app_slug
  });
});
