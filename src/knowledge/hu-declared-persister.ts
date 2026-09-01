/**
 * HU-Declared Knowledge Persister
 *
 * Persists provisional knowledge derived from HU requirements/scenarios
 * after scenario generation completes. Items have source="hu_declared"
 * and are NEVER treated as runtime evidence.
 *
 * Authority contract:
 *   - hu_declared items do NOT enter allowedExecutableClicks
 *   - hu_declared items do NOT mark evidenceBacked=true
 *   - hu_declared items do NOT validate routes
 *   - hu_declared items do NOT eliminate requiresRouteLearning
 *
 * Dedup: same HU regenerates → update existing items (no duplication).
 * Accumulate: different HUs same appSlug → new items appended.
 * Isolation: different appSlugs → no cross-contamination.
 */

import { createHash } from "node:crypto";
import { withTransaction } from "../db/sql-connection";
import { materializeProjectRuntime } from "../db/project-materializer";
import * as fs from "node:fs";
import * as path from "node:path";
import type { KnowledgeItem } from "./runtime-knowledge-persister";
import type {
  FunctionalRequirementAccount,
  FunctionalBranchRef,
} from "../scenarios/scenario-types";
import {
  extractPrerequisiteTargets,
  type PrerequisiteTarget,
} from "../scenarios/scenario-functional-quality";

type RequirementAccountingResult = {
  requirements: FunctionalRequirementAccount[];
  summary: {
    total: number;
    covered: number;
    adaptive: number;
    nonAutomatable: number;
    incompleteRequirement: number;
  };
};

function normKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function stableHash(...parts: string[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 12);
}

function knowledgePath(appSlug: string): string {
  return path.join(
    process.cwd(),
    "automations",
    "apps",
    appSlug,
    "app.knowledge.json",
  );
}

function legacyRead(appSlug: string): { items: KnowledgeItem[] } {
  const kp = knowledgePath(appSlug);
  try {
    if (fs.existsSync(kp)) {
      const parsed = JSON.parse(fs.readFileSync(kp, "utf-8"));
      return parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
    }
  } catch {
    /* ignore */
  }
  return { items: [] };
}

function legacyWrite(appSlug: string, data: { items: KnowledgeItem[] }): void {
  const kp = knowledgePath(appSlug);
  try {
    const tmp = kp + ".tmp";
    const dir = path.dirname(kp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, kp);
  } catch {
    fs.writeFileSync(kp, JSON.stringify(data, null, 2), "utf-8");
  }
}

/**
 * Build hu_declared KnowledgeItems from requirementAccounting and functionalBranches.
 * Each item has a stable deterministic id for dedup across HU regenerations.
 */
export function extractHuDeclaredItems(
  requirementAccounting: RequirementAccountingResult,
  functionalBranches: FunctionalBranchRef[],
  issueKey?: string,
): KnowledgeItem[] {
  const items: KnowledgeItem[] = [];
  const now = new Date().toISOString();

  for (const req of requirementAccounting.requirements) {
    const category = req.category;
    const normalizedKey = normKey(req.sourceText || req.id);
    const id = `hd_${category}_${stableHash(category, normalizedKey)}`;

    // Explicit prerequisites carry the dynamic action target + normalized action
    // intent, derived from the shared recognizer on the real HU clause. Only what
    // the HU declares is persisted — destination/origin are never inferred here.
    const prerequisite = category === "prerequisite"
      ? extractPrerequisiteTargets(req.sourceText || "")[0]
      : undefined;

    const item: KnowledgeItem = {
      id,
      source: "hu_declared",
      knowledgeKind: "hu_declared",
      category,
      sourceText: (req.sourceText || "").slice(0, 200),
      sourceIssueKey: req.sourceIssueKey || issueKey || "",
      associatedBranchId: req.associatedBranchId ?? "",
      expectedBehavior: req.expectedBehavior ?? "",
      ...(prerequisite
        ? { actionTarget: prerequisite.actionTarget, actionIntent: prerequisite.actionIntent, executionBacked: false }
        : {}),
      validationStatus: "pending",
      trustedForReuse: false,
      runCount: 1,
      createdAt: now,
      lastSeenAt: now,
    };

    items.push(item);
  }

  // Branch-level knowledge from functionalBranches (action → destination hints)
  for (const branch of functionalBranches) {
    const normalizedKey = normKey(
      `${branch.branchId}:${branch.actionIntent}:${branch.expectedDestination ?? ""}`,
    );
    const id = `hd_branch_${stableHash(normalizedKey)}`;

    // Skip if a requirement already created an item for this branch
    if (
      items.some(
        (i) =>
          i.id === id ||
          (i.category === "branch" && i.associatedBranchId === branch.branchId),
      )
    ) continue;

    const item: KnowledgeItem = {
      id,
      source: "hu_declared",
      knowledgeKind: "hu_declared",
      category: "branch",
      branchId: branch.branchId,
      sourceLabel: branch.sourceLabel ?? "",
      actionIntent: branch.actionIntent,
      expectedDestination: branch.expectedDestination ?? "",
      accessIntent: branch.accessIntent,
      evidenceSource: branch.evidenceSource,
      sourceIssueKey: issueKey ?? "",
      validationStatus: "pending",
      trustedForReuse: false,
      runCount: 1,
      createdAt: now,
      lastSeenAt: now,
    };

    items.push(item);
  }

  // Declared path: an ordered declarative route derived unambiguously from the
  // HU. Reuses already-derived prerequisites and functionalBranches — never
  // re-parses with another classifier. Purely declarative: pending, trusted=false,
  // executionBacked=false. It is NOT a validated route and grants no authority.
  for (const branch of functionalBranches) {
    const branchTarget = branch.sourceLabel;
    if (!branchTarget) continue; // no reliable branch action target

    // Applicable prerequisites: branch-specific (associatedBranchId === branch.id)
    // plus global ones from the same HU (empty associatedBranchId).
    const applicable = requirementAccounting.requirements.filter(
      (req) =>
        req.category === "prerequisite" &&
        (req.associatedBranchId === branch.branchId || !req.associatedBranchId),
    );
    const actionable = applicable
      .map((req) => extractPrerequisiteTargets(req.sourceText || "")[0])
      .filter((p): p is PrerequisiteTarget => Boolean(p));

    if (actionable.length === 0) continue; // no artificial single-step path
    if (actionable.length > 1) {
      // No explicit order information — never invent a sequence.
      console.log(
        `[knowledge:hu-declared] declared_path skipped branch=${branch.branchId} reason=ambiguous_prerequisite_order`,
      );
      continue;
    }

    const steps = [
      {
        order: 1,
        stepKind: "prerequisite",
        actionTarget: actionable[0].actionTarget,
        actionIntent: actionable[0].actionIntent,
      },
      {
        order: 2,
        stepKind: "branch_action",
        actionTarget: branchTarget,
        actionIntent: branch.actionIntent,
      },
    ];
    const id = `hd_declared_path_${stableHash(
      issueKey ?? "",
      branch.branchId,
      normKey(actionable[0].actionTarget),
      normKey(branchTarget),
    )}`;
    items.push({
      id,
      source: "hu_declared",
      knowledgeKind: "hu_declared",
      category: "declared_path",
      sourceIssueKey: issueKey ?? "",
      associatedBranchId: branch.branchId,
      steps,
      validationStatus: "pending",
      trustedForReuse: false,
      executionBacked: false,
      runCount: 1,
      createdAt: now,
      lastSeenAt: now,
    });
  }

  return items;
}

/**
 * Persist hu_declared knowledge items for an appSlug.
 *
 * Dedup strategy:
 *   - Same HU regenerates → old hu_declared items from same sourceIssueKey
 *     are replaced (no duplication).
 *   - Different HU same appSlug → items accumulate.
 *   - Different appSlug → isolated.
 *
 * SQL-first: persists to dbo.ProjectKnowledge via transaction, then
 * materializes app.knowledge.json. File fallback if project not registered.
 */
export async function persistHuDeclaredKnowledge(
  appSlug: string,
  requirementAccounting: RequirementAccountingResult,
  functionalBranches: FunctionalBranchRef[],
  issueKey?: string,
): Promise<{
  derived: number;
  inserted: number;
  updated: number;
  deduped: number;
  success: boolean;
}> {
  const newItems = extractHuDeclaredItems(
    requirementAccounting,
    functionalBranches,
    issueKey,
  );

  if (newItems.length === 0) {
    console.log(
      `[knowledge:hu-declared] appSlug=${appSlug} derived=0 inserted=0 updated=0 deduped=0 success=true`,
    );
    return { derived: 0, inserted: 0, updated: 0, deduped: 0, success: true };
  }

  let inserted = 0;
  let updated = 0;

  // SQL-first path
  let sqlResult: { found: boolean; inserted: number; updated: number } | null =
    null;
  try {
    sqlResult = await withTransaction(async (conn) => {
      const rows = await conn.query<{ id: string }>(
        "SELECT id FROM dbo.Projects WHERE slug = ?",
        [appSlug],
      );
      if (rows.length === 0) return { found: false, inserted: 0, updated: 0 };

      const projectId = rows[0].id;

      const kRows = await conn.query<{ knowledgeJson: string }>(
        "SELECT knowledgeJson FROM dbo.ProjectKnowledge WITH (UPDLOCK, ROWLOCK) WHERE projectId = ?",
        [projectId],
      );

      let data: { items: KnowledgeItem[] } = { items: [] };
      if (kRows.length > 0 && kRows[0].knowledgeJson) {
        const parsed = JSON.parse(kRows[0].knowledgeJson);
        data =
          parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
      }

      // Dedup: remove old hu_declared items from same sourceIssueKey
      const sourceIssue = issueKey ?? "";
      if (sourceIssue) {
        data.items = data.items.filter(
          (i) =>
            !(
              i.source === "hu_declared" &&
              (i.sourceIssueKey as string) === sourceIssue
            ),
        );
      }

      let ins = 0;
      let upd = 0;
      const itemsBefore = data.items.length;

      for (const newItem of newItems) {
        const existingIdx = data.items.findIndex(
          (i) => i.id === newItem.id,
        );
        if (existingIdx >= 0) {
          const existing = data.items[existingIdx];
          existing.lastSeenAt = new Date().toISOString();
          existing.runCount = ((existing.runCount as number) ?? 0) + 1;
          existing.sourceText = newItem.sourceText;
          existing.expectedBehavior = newItem.expectedBehavior;
          data.items[existingIdx] = existing;
          upd++;
        } else {
          data.items.push(newItem);
          ins++;
        }
      }

      await conn.query(
        "UPDATE dbo.ProjectKnowledge SET knowledgeJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?",
        // UTF-16LE bytes (SQL_C_BINARY) — see runtime-knowledge-persister.ts.
        [Buffer.from(JSON.stringify(data), "utf16le"), projectId],
      );

      return {
        found: true,
        inserted: ins,
        updated: upd,
      };
    });

    inserted = sqlResult?.inserted ?? 0;
    updated = sqlResult?.updated ?? 0;
  } catch (err) {
    console.error(
      `[knowledge:hu-declared] appSlug=${appSlug} reason=sql_persist_failed err=${(err as Error).message}`,
    );
    return {
      derived: newItems.length,
      inserted: 0,
      updated: 0,
      deduped: newItems.length,
      success: false,
    };
  }

  // Legacy file fallback
  if (!sqlResult || !sqlResult.found) {
    const data = legacyRead(appSlug);
    const sourceIssue = issueKey ?? "";
    if (sourceIssue) {
      data.items = data.items.filter(
        (i) =>
          !(
            i.source === "hu_declared" &&
            (i.sourceIssueKey as string) === sourceIssue
          ),
      );
    }
    for (const newItem of newItems) {
      const existingIdx = data.items.findIndex(
        (i) => i.id === newItem.id,
      );
      if (existingIdx >= 0) {
        data.items[existingIdx] = newItem;
        updated++;
      } else {
        data.items.push(newItem);
        inserted++;
      }
    }
    legacyWrite(appSlug, data);
  }

  // Materialize app.knowledge.json from SQL after commit
  if (sqlResult?.found) {
    try {
      await materializeProjectRuntime({ slug: appSlug });
    } catch {
      /* materialize is best-effort */
    }
  }

  const deduped = newItems.length - inserted;
  console.log(
    `[knowledge:hu-declared] appSlug=${appSlug} derived=${newItems.length} inserted=${inserted} updated=${updated} deduped=${deduped} success=true`,
  );

  return {
    derived: newItems.length,
    inserted,
    updated,
    deduped,
    success: true,
  };
}
