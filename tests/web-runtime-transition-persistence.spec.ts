import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { persistRuntimeTransition } from "../src/knowledge/runtime-knowledge-persister";

test("persists only validated technical Web transitions", () => {
  const appSlug = `test-web-transition-${Date.now()}`;
  const appDir = path.join(process.cwd(), "automations", "apps", appSlug);
  const knowledgePath = path.join(appDir, "app.knowledge.json");
  fs.mkdirSync(appDir, { recursive: true });
  try {
    const base = {
      sourceTechnicalScreenKey: "tech-A",
      destinationTechnicalScreenKey: "tech-B",
      transitionValidated: true,
      actionLocatorIdentity: "locator-1",
    };
    persistRuntimeTransition(appSlug, base);
    persistRuntimeTransition(appSlug, { ...base, transitionValidated: false, actionLocatorIdentity: "locator-2" });
    persistRuntimeTransition(appSlug, { ...base, destinationTechnicalScreenKey: undefined, actionLocatorIdentity: "locator-3" });
    const data = JSON.parse(fs.readFileSync(knowledgePath, "utf8"));
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      knowledgeKind: "route_transition",
      sourceTechnicalScreenKey: "tech-A",
      destinationTechnicalScreenKey: "tech-B",
      transitionValidated: true,
    });
    expect(data.items[0].sourceScreenKey).toBeUndefined();
    expect(data.items[0].destinationScreenKey).toBeUndefined();
    expect(data.items[0].destinationIdentity).toBeUndefined();
    expect(data.items[0].routeRole).toBeUndefined();
    expect(data.items[0].destinationRole).toBeUndefined();
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});
