"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractHuDeclaredItems = extractHuDeclaredItems;
exports.persistHuDeclaredKnowledge = persistHuDeclaredKnowledge;
const node_crypto_1 = require("node:crypto");
const sql_connection_1 = require("../db/sql-connection");
const project_materializer_1 = require("../db/project-materializer");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const scenario_functional_quality_1 = require("../scenarios/scenario-functional-quality");
function normKey(s) {
    return s
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
}
function stableHash(...parts) {
    return (0, node_crypto_1.createHash)("sha256").update(parts.join(":")).digest("hex").slice(0, 12);
}
function knowledgePath(appSlug) {
    return path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
}
function legacyRead(appSlug) {
    const kp = knowledgePath(appSlug);
    try {
        if (fs.existsSync(kp)) {
            const parsed = JSON.parse(fs.readFileSync(kp, "utf-8"));
            return parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
        }
    }
    catch {
        /* ignore */
    }
    return { items: [] };
}
function legacyWrite(appSlug, data) {
    const kp = knowledgePath(appSlug);
    try {
        const tmp = kp + ".tmp";
        const dir = path.dirname(kp);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
        fs.renameSync(tmp, kp);
    }
    catch {
        fs.writeFileSync(kp, JSON.stringify(data, null, 2), "utf-8");
    }
}
/**
 * Build hu_declared KnowledgeItems from requirementAccounting and functionalBranches.
 * Each item has a stable deterministic id for dedup across HU regenerations.
 */
function extractHuDeclaredItems(requirementAccounting, functionalBranches, issueKey) {
    const items = [];
    const now = new Date().toISOString();
    for (const req of requirementAccounting.requirements) {
        const category = req.category;
        const normalizedKey = normKey(req.sourceText || req.id);
        const id = `hd_${category}_${stableHash(category, normalizedKey)}`;
        // Explicit prerequisites carry the dynamic action target + normalized action
        // intent, derived from the shared recognizer on the real HU clause. Only what
        // the HU declares is persisted — destination/origin are never inferred here.
        const prerequisite = category === "prerequisite"
            ? (0, scenario_functional_quality_1.extractPrerequisiteTargets)(req.sourceText || "")[0]
            : undefined;
        const item = {
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
        const normalizedKey = normKey(`${branch.branchId}:${branch.actionIntent}:${branch.expectedDestination ?? ""}`);
        const id = `hd_branch_${stableHash(normalizedKey)}`;
        // Skip if a requirement already created an item for this branch
        if (items.some((i) => i.id === id ||
            (i.category === "branch" && i.associatedBranchId === branch.branchId)))
            continue;
        const item = {
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
        if (!branchTarget)
            continue; // no reliable branch action target
        // Applicable prerequisites: branch-specific (associatedBranchId === branch.id)
        // plus global ones from the same HU (empty associatedBranchId).
        const applicable = requirementAccounting.requirements.filter((req) => req.category === "prerequisite" &&
            (req.associatedBranchId === branch.branchId || !req.associatedBranchId));
        const actionable = applicable
            .map((req) => (0, scenario_functional_quality_1.extractPrerequisiteTargets)(req.sourceText || "")[0])
            .filter((p) => Boolean(p));
        if (actionable.length === 0)
            continue; // no artificial single-step path
        if (actionable.length > 1) {
            // No explicit order information — never invent a sequence.
            console.log(`[knowledge:hu-declared] declared_path skipped branch=${branch.branchId} reason=ambiguous_prerequisite_order`);
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
        const id = `hd_declared_path_${stableHash(issueKey ?? "", branch.branchId, normKey(actionable[0].actionTarget), normKey(branchTarget))}`;
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
async function persistHuDeclaredKnowledge(appSlug, requirementAccounting, functionalBranches, issueKey) {
    const newItems = extractHuDeclaredItems(requirementAccounting, functionalBranches, issueKey);
    if (newItems.length === 0) {
        console.log(`[knowledge:hu-declared] appSlug=${appSlug} derived=0 inserted=0 updated=0 deduped=0 success=true`);
        return { derived: 0, inserted: 0, updated: 0, deduped: 0, success: true };
    }
    let inserted = 0;
    let updated = 0;
    // SQL-first path
    let sqlResult = null;
    try {
        sqlResult = await (0, sql_connection_1.withTransaction)(async (conn) => {
            const rows = await conn.query("SELECT id FROM dbo.Projects WHERE slug = ?", [appSlug]);
            if (rows.length === 0)
                return { found: false, inserted: 0, updated: 0 };
            const projectId = rows[0].id;
            const kRows = await conn.query("SELECT knowledgeJson FROM dbo.ProjectKnowledge WITH (UPDLOCK, ROWLOCK) WHERE projectId = ?", [projectId]);
            let data = { items: [] };
            if (kRows.length > 0 && kRows[0].knowledgeJson) {
                const parsed = JSON.parse(kRows[0].knowledgeJson);
                data =
                    parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
            }
            // Dedup: remove old hu_declared items from same sourceIssueKey
            const sourceIssue = issueKey ?? "";
            if (sourceIssue) {
                data.items = data.items.filter((i) => !(i.source === "hu_declared" &&
                    i.sourceIssueKey === sourceIssue));
            }
            let ins = 0;
            let upd = 0;
            const itemsBefore = data.items.length;
            for (const newItem of newItems) {
                const existingIdx = data.items.findIndex((i) => i.id === newItem.id);
                if (existingIdx >= 0) {
                    const existing = data.items[existingIdx];
                    existing.lastSeenAt = new Date().toISOString();
                    existing.runCount = (existing.runCount ?? 0) + 1;
                    existing.sourceText = newItem.sourceText;
                    existing.expectedBehavior = newItem.expectedBehavior;
                    data.items[existingIdx] = existing;
                    upd++;
                }
                else {
                    data.items.push(newItem);
                    ins++;
                }
            }
            await conn.query("UPDATE dbo.ProjectKnowledge SET knowledgeJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?", 
            // UTF-16LE bytes (SQL_C_BINARY) — see runtime-knowledge-persister.ts.
            [Buffer.from(JSON.stringify(data), "utf16le"), projectId]);
            return {
                found: true,
                inserted: ins,
                updated: upd,
            };
        });
        inserted = sqlResult?.inserted ?? 0;
        updated = sqlResult?.updated ?? 0;
    }
    catch (err) {
        console.error(`[knowledge:hu-declared] appSlug=${appSlug} reason=sql_persist_failed err=${err.message}`);
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
            data.items = data.items.filter((i) => !(i.source === "hu_declared" &&
                i.sourceIssueKey === sourceIssue));
        }
        for (const newItem of newItems) {
            const existingIdx = data.items.findIndex((i) => i.id === newItem.id);
            if (existingIdx >= 0) {
                data.items[existingIdx] = newItem;
                updated++;
            }
            else {
                data.items.push(newItem);
                inserted++;
            }
        }
        legacyWrite(appSlug, data);
    }
    // Materialize app.knowledge.json from SQL after commit
    if (sqlResult?.found) {
        try {
            await (0, project_materializer_1.materializeProjectRuntime)({ slug: appSlug });
        }
        catch {
            /* materialize is best-effort */
        }
    }
    const deduped = newItems.length - inserted;
    console.log(`[knowledge:hu-declared] appSlug=${appSlug} derived=${newItems.length} inserted=${inserted} updated=${updated} deduped=${deduped} success=true`);
    return {
        derived: newItems.length,
        inserted,
        updated,
        deduped,
        success: true,
    };
}
