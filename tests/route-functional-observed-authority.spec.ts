import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendRouteSuggestionToKnowledge } from "../src/scenarios/app-knowledge-writer";
import type { RouteProfileSuggestion } from "../src/discovery/route-profile-learning";

function suggestion(overrides: Partial<RouteProfileSuggestion> = {}): RouteProfileSuggestion {
  return {
    appSlug: "test-app",
    from: "source",
    to: "destination",
    relation: "child_route",
    source: "successful_transition",
    confidence: 0.99,
    status: "auto_approved",
    evidence: { beforeUrl: "https://example.test/source", afterUrl: "https://example.test/destination" },
    ...overrides,
  };
}

test("route functional observed remains provisional without semantic authority", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "route-authority-"));
  const knowledgeDir = path.join(root, "apps", "test-app");
  fs.mkdirSync(knowledgeDir, { recursive: true });
  const knowledgePath = path.join(knowledgeDir, "app.knowledge.json");
  try {
    const first = await appendRouteSuggestionToKnowledge("test-app", suggestion(), path.join(root));
    expect(first.persisted).toBe(true);
    let data = JSON.parse(fs.readFileSync(knowledgePath, "utf8"));
    expect(data.items[0]).toMatchObject({ validationStatus: "pending", trustedForReuse: false });

    const technical = suggestion({
      from: "technical-source",
      to: "technical-destination",
      evidence: {
        beforeUrl: "https://example.test/a",
        afterUrl: "https://example.test/b",
        transitionValidated: true,
        beforeTechnicalScreenKey: "tech-A",
        afterTechnicalScreenKey: "tech-B",
      },
    });
    await appendRouteSuggestionToKnowledge("test-app", technical, path.join(root));
    data = JSON.parse(fs.readFileSync(knowledgePath, "utf8"));
    const technicalItem = data.items.find((item: any) => item.routeFrom === "technical-source");
    expect(technicalItem).toMatchObject({
      validationStatus: "pending",
      trustedForReuse: false,
      transitionValidated: true,
      sourceTechnicalScreenKey: "tech-A",
      destinationTechnicalScreenKey: "tech-B",
    });

    data.items[0].validationStatus = "pending";
    data.items[0].trustedForReuse = false;
    data.items[0].source = "route_learning";
    fs.writeFileSync(knowledgePath, JSON.stringify(data));
    await appendRouteSuggestionToKnowledge("test-app", suggestion(), path.join(root));
    data = JSON.parse(fs.readFileSync(knowledgePath, "utf8"));
    expect(data.items[0]).toMatchObject({ validationStatus: "pending", trustedForReuse: false });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
