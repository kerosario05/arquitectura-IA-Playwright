import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  loadAutomationIndex,
  saveAutomationIndex,
  upsertAutomationIndexEntry
} from "../src/automations/automation-index";
import type { PromotedAutomationIndex, PromotedAutomationIndexEntry } from "../src/types/automation-promotion.types";
import { getTestTempDir, ensureTestTempDir, cleanTestTempDir } from "./helpers/test-temp-dir";

const tmpDir = getTestTempDir("test-automation-index");

function makeEntry(id: string, overrides?: Partial<PromotedAutomationIndexEntry>): PromotedAutomationIndexEntry {
  return {
    id,
    externalId: id,
    caseId: Number(id.replace(/\D/g, "")) || undefined,
    title: `Automation ${id}`,
    planPath: `automations/plans/${id}.plan.json`,
    specPath: `tests/generated/${id}.spec.ts`,
    status: "active",
    source: "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

test.beforeAll(async () => {
  await ensureTestTempDir("test-automation-index");
});

test.afterAll(async () => {
  try {
    await cleanTestTempDir("test-automation-index");
  } catch {
  }
});

test("loadAutomationIndex creates empty index when file does not exist", async () => {
  const indexPath = path.join(tmpDir, "nonexistent.json");
  const index = await loadAutomationIndex(indexPath);
  expect(index.version).toBe("1.0");
  expect(index.automations).toEqual([]);
});

test("loadAutomationIndex loads existing index", async () => {
  const indexPath = path.join(tmpDir, "existing.json");
  const existing: PromotedAutomationIndex = {
    version: "1.0",
    updatedAt: new Date().toISOString(),
    automations: [makeEntry("C1")]
  };
  await saveAutomationIndex(existing, indexPath);
  const loaded = await loadAutomationIndex(indexPath);
  expect(loaded.automations).toHaveLength(1);
  expect(loaded.automations[0].id).toBe("C1");
});

test("loadAutomationIndex throws on invalid version", async () => {
  const indexPath = path.join(tmpDir, "bad-version.json");
  await fs.writeFile(indexPath, JSON.stringify({ version: "99.0", automations: [] }), "utf-8");
  await expect(loadAutomationIndex(indexPath)).rejects.toThrow();
});

test("upsertAutomationIndexEntry adds entry to empty list", () => {
  const index: PromotedAutomationIndex = {
    version: "1.0",
    updatedAt: new Date().toISOString(),
    automations: []
  };
  const result = upsertAutomationIndexEntry(index, makeEntry("C1"));
  expect(result.automations).toHaveLength(1);
  expect(result.automations[0].id).toBe("C1");
});

test("upsertAutomationIndexEntry updates existing entry by id", () => {
  const index: PromotedAutomationIndex = {
    version: "1.0",
    updatedAt: new Date().toISOString(),
    automations: [makeEntry("C1")]
  };
  const updated = makeEntry("C1");
  updated.status = "disabled";
  const result = upsertAutomationIndexEntry(index, updated);
  expect(result.automations).toHaveLength(1);
  expect(result.automations[0].status).toBe("disabled");
  expect(result.automations[0].createdAt).toBe(index.automations[0].createdAt);
});

test("upsertAutomationIndexEntry preserves existing entries when adding new", () => {
  const index: PromotedAutomationIndex = {
    version: "1.0",
    updatedAt: new Date().toISOString(),
    automations: [makeEntry("C1")]
  };
  const result = upsertAutomationIndexEntry(index, makeEntry("C2"));
  expect(result.automations).toHaveLength(2);
});

test("upsertAutomationIndexEntry maintains version 1.0", () => {
  const index: PromotedAutomationIndex = {
    version: "1.0",
    updatedAt: new Date().toISOString(),
    automations: []
  };
  const result = upsertAutomationIndexEntry(index, makeEntry("C1"));
  expect(result.version).toBe("1.0");
});

test("saveAutomationIndex and loadAutomationIndex round-trip correctly", async () => {
  const indexPath = path.join(tmpDir, "roundtrip.json");
  const original: PromotedAutomationIndex = {
    version: "1.0",
    updatedAt: new Date().toISOString(),
    automations: [makeEntry("C1"), makeEntry("C2")]
  };
  await saveAutomationIndex(original, indexPath);
  const loaded = await loadAutomationIndex(indexPath);
  expect(loaded.automations).toHaveLength(2);
  expect(loaded.version).toBe("1.0");
});

test("index entries preserve appSlug and appConfigPath", async () => {
  const indexPath = path.join(tmpDir, "app-aware.json");
  const entry = makeEntry("C-app", {
    appSlug: "profile-a",
    appConfigPath: "automations/apps/profile-a/app.config.json"
  });
  await saveAutomationIndex(
    {
      version: "1.0",
      updatedAt: new Date().toISOString(),
      automations: [entry]
    },
    indexPath
  );

  const loaded = await loadAutomationIndex(indexPath);
  expect(loaded.automations[0].appSlug).toBe("profile-a");
  expect(loaded.automations[0].appConfigPath).toContain("app.config.json");
});
