import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { scanCurrentPage } from "../explorer/page-scanner";
import { buildProposedObjects } from "./proposed-object-builder";
import type { ProposedObject, DiscoveryScanResult } from "../types/discovery.types";

export type DiscoveryScanOptions = {
  page: Page;
  outputPath?: string;
  screenshotPath?: string;
  minConfidence?: number;
};

export async function runDiscoveryScan(options: DiscoveryScanOptions): Promise<DiscoveryScanResult> {
  const { page, outputPath, screenshotPath, minConfidence = 0 } = options;

  const snapshot = await scanCurrentPage(page);

  if (screenshotPath) {
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }

  const candidates = buildProposedObjects(snapshot.elements);

  const proposedObjects: ProposedObject[] = candidates
    .filter((c) => c.confidence >= minConfidence)
    .map((c) => ({
      key: c.key,
      name: c.name,
      description: `${c.reason}. Type: ${c.type}. Locator: ${c.locator.strategy}="${c.locator.value ?? c.locator.role}"`,
      type: c.type,
      locator: c.locator,
      aliases: [],
      required: false,
      stable: c.confidence >= 0.8,
      tags: [`discovered`, c.type],
      confidence: c.confidence,
      reason: c.reason,
      sourceElementId: c.element.id
    }));

  const highConfidence = proposedObjects.filter((o) => o.confidence >= 0.8).length;
  const mediumConfidence = proposedObjects.filter((o) => o.confidence >= 0.6 && o.confidence < 0.8).length;
  const lowConfidence = proposedObjects.filter((o) => o.confidence < 0.6).length;

  const byType: Record<string, number> = {};
  for (const obj of proposedObjects) {
    byType[obj.type] = (byType[obj.type] || 0) + 1;
  }

  const result: DiscoveryScanResult = {
    version: "1.0",
    url: snapshot.url,
    title: snapshot.title,
    scannedAt: new Date().toISOString(),
    totalElementsScanned: snapshot.summary.totalElements,
    proposedObjects,
    summary: {
      highConfidence,
      mediumConfidence,
      lowConfidence,
      byType
    }
  };

  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");
  }

  return result;
}

export function printDiscoverySummary(result: DiscoveryScanResult): void {
  console.log(`\nDiscovery Scan Results`);
  console.log(`=====================`);
  console.log(`URL: ${result.url}`);
  console.log(`Title: ${result.title}`);
  console.log(`Scanned at: ${result.scannedAt}`);
  console.log(`Total elements scanned: ${result.totalElementsScanned}`);
  console.log(`Proposed objects: ${result.proposedObjects.length}`);
  console.log(`  High confidence (≥0.8): ${result.summary.highConfidence}`);
  console.log(`  Medium confidence (0.6-0.8): ${result.summary.mediumConfidence}`);
  console.log(`  Low confidence (<0.6): ${result.summary.lowConfidence}`);
  console.log(`\nBy type:`);
  for (const [type, count] of Object.entries(result.summary.byType)) {
    console.log(`  ${type}: ${count}`);
  }

  if (result.proposedObjects.length > 0) {
    console.log(`\nTop proposed objects:`);
    const sorted = [...result.proposedObjects].sort((a, b) => b.confidence - a.confidence);
    for (const obj of sorted.slice(0, 10)) {
      console.log(`  [${obj.confidence.toFixed(2)}] ${obj.key} (${obj.type}) - ${obj.name.slice(0, 40)}`);
    }
  }
}
