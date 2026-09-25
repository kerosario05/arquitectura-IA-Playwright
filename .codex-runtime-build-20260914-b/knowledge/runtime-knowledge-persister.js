"use strict";
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
exports.persistRuntimeSnapshot = persistRuntimeSnapshot;
exports.persistRuntimeRoute = persistRuntimeRoute;
exports.isMobileRouteTransitionTrustedForReuse = isMobileRouteTransitionTrustedForReuse;
exports.persistRuntimeTransition = persistRuntimeTransition;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const sql_connection_1 = require("../db/sql-connection");
const project_materializer_1 = require("../db/project-materializer");
function knowledgePath(appSlug) {
    return path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
}
/** Canonical SQL-first persistence for a route_transition knowledge item.
 *  Writes to ProjectKnowledge.knowledgeJson via upsert with merge,
 *  then materializes app.knowledge.json from SQL.
 *  Returns true on success, false on SQL failure (fail-closed). */
async function persistTransitionToSql(appSlug, item) {
    try {
        const result = await (0, sql_connection_1.withTransaction)(async (conn) => {
            const rows = await conn.query("SELECT id FROM dbo.Projects WHERE slug = ?", [appSlug]);
            if (rows.length === 0)
                return false;
            const projectId = rows[0].id;
            const kRows = await conn.query("SELECT knowledgeJson FROM dbo.ProjectKnowledge WITH (UPDLOCK, ROWLOCK) WHERE projectId = ?", [projectId]);
            let data = { items: [] };
            if (kRows.length > 0 && kRows[0].knowledgeJson) {
                try {
                    const parsed = JSON.parse(kRows[0].knowledgeJson);
                    data = parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
                }
                catch {
                    data = { items: [] };
                }
            }
            const idx = data.items.findIndex((i) => i.id === item.id);
            if (idx >= 0) {
                const existing = data.items[idx];
                data.items[idx] = {
                    ...existing,
                    ...item,
                    createdAt: existing.createdAt,
                    runCount: (existing.runCount ?? 0) + 1,
                };
                console.log(`[runtime-transition:sql] updated id=${item.id} runCount=${data.items[idx].runCount}`);
            }
            else {
                data.items.push(item);
                console.log(`[runtime-transition:sql] persisted id=${item.id}`);
            }
            // Legacy remediation: demote route_transition items that have trustedForReuse=true
            // but do not meet the composite trust conditions. Idempotent: re-running on already-
            // demoted items is a no-op because they already have trustedForReuse=false.
            let remediatedCount = 0;
            for (const existingItem of data.items) {
                if (existingItem.knowledgeKind !== "route_transition")
                    continue;
                if (existingItem.trustedForReuse !== true)
                    continue;
                // Check all four composite conditions via pure helper.
                const stillTrusted = isMobileRouteTransitionTrustedForReuse({
                    transitionValidated: existingItem.transitionValidated,
                    executionBacked: existingItem.executionBacked,
                    actionSemanticAuthority: existingItem.actionSemanticAuthority,
                    destinationSemanticAuthority: existingItem.destinationSemanticAuthority,
                });
                if (!stillTrusted) {
                    existingItem.trustedForReuse = false;
                    existingItem.validationStatus = "validated_technical";
                    remediatedCount++;
                }
            }
            if (remediatedCount > 0) {
                console.log(`[runtime-transition:sql] legacy_remediation demoted=${remediatedCount} items not meeting composite trust`);
            }
            await conn.query("UPDATE dbo.ProjectKnowledge SET knowledgeJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?", [Buffer.from(JSON.stringify(data), "utf16le"), projectId]);
            return true;
        });
        return result;
    }
    catch (e) {
        console.log(`[runtime-transition:sql] FAILED reason=${e.message}`);
        return false;
    }
}
/** Derive a merge key from a structured control: prefer technical identity (locatorIdentity,
 *  resourceId, contentDesc) over label to avoid collapsing distinct controls with the same label. */
function controlMergeKey(ctrl) {
    const locId = typeof ctrl.locatorIdentity === "string" ? ctrl.locatorIdentity.trim() : "";
    if (locId)
        return `loc:${locId}`;
    const resId = typeof ctrl.resourceId === "string" ? ctrl.resourceId.trim() : "";
    if (resId)
        return `res:${resId}`;
    const cd = typeof ctrl.contentDesc === "string" ? ctrl.contentDesc.trim() : "";
    if (cd)
        return `cd:${cd}`;
    return `lbl:${String(ctrl.label ?? "").trim()}`;
}
function itemSignature(item) {
    const kind = item.knowledgeKind ?? "";
    const targets = item.clickTargets ?? [];
    const screenKey = item.screenKey ?? "";
    // Included so two states of one screen stay two items. Kept out of the first-5 truncation the
    // clickTargets use, because the distinguishing text is often not among the first few.
    const assertions = (item.assertionTargets ?? []).slice().sort().join("|");
    const disabled = (item.disabledLabels ?? []).join("|");
    const hash = (0, node_crypto_1.createHash)("sha256")
        .update(`${kind}:${screenKey}:${targets.slice(0, 5).join("|")}:${assertions}:${disabled}`)
        .digest("hex")
        .slice(0, 12);
    return hash;
}
/**
 * Persist a runtime-observed snapshot to app.knowledge.json.
 * Deduplicates by kind + screenKey + normalized clickTargets.
 * Only persist menu snapshots when there are multiple clickTargets.
 */
function persistRuntimeSnapshot(appSlug, snapshot, meta) {
    if (snapshot.clickTargets.length < 1) {
        console.log(`[runtime-knowledge] skipped kind=route_menu_snapshot reason=no_click_targets screen=${snapshot.screenKey}`);
        return;
    }
    // The signature decides whether an observation is a new item or merges into an existing one.
    // clickTargets alone cannot tell two states of the same screen apart: the contact-confirmation
    // screen exposes the same tappables before and after a code is sent, so the state showing the
    // OTP boxes kept collapsing into the first one ever captured and the generator never saw it.
    // assertionTargets carry the texts that do change ("Indica el código recibido en el correo"),
    // and a disabled control is itself a distinct state — a gate still closed.
    const disabledLabels = (snapshot.observedControls ?? [])
        .filter((c) => c.enabled === false)
        .map((c) => `disabled:${c.label ?? ""}`)
        .sort();
    const sign = itemSignature({
        knowledgeKind: "route_menu_snapshot",
        screenKey: snapshot.screenKey,
        clickTargets: snapshot.clickTargets,
        assertionTargets: snapshot.assertionTargets,
        disabledLabels,
    });
    const now = new Date().toISOString();
    const isSuccess = meta.status === "passed" || meta.status === "partial";
    const newItem = {
        id: `rt_menu_${sign}`,
        source: "mcp_runtime_observation",
        issueKey: meta.issueKey ?? "",
        scenarioTitle: meta.scenarioTitle ?? "",
        knowledgeKind: "route_menu_snapshot",
        screenKey: snapshot.screenKey,
        url: snapshot.url,
        clickTargets: snapshot.clickTargets,
        assertionTargets: snapshot.assertionTargets,
        observedControls: snapshot.observedControls,
        accessLevel: meta.accessLevel ?? "authenticated",
        validationStatus: isSuccess ? "validated" : "pending",
        trustedForReuse: isSuccess,
        failureCount: isSuccess ? 0 : 1,
        successCount: isSuccess ? 1 : 0,
        runCount: 1,
        createdAt: now,
        lastSeenAt: now,
        lastValidatedAt: isSuccess ? now : undefined,
    };
    persistItem(appSlug, newItem);
}
/**
 * Persist a runtime-observed functional route to app.knowledge.json.
 */
function persistRuntimeRoute(appSlug, executedSteps, executedClickTargets, meta) {
    if (executedClickTargets.length < 1)
        return;
    const sign = (0, node_crypto_1.createHash)("sha256")
        .update(`route_functional_observed:${executedClickTargets.join("|")}`)
        .digest("hex")
        .slice(0, 12);
    const now = new Date().toISOString();
    const isSuccess = meta.status === "passed";
    const newItem = {
        id: `rt_route_${sign}`,
        source: "mcp_runtime_observation",
        issueKey: meta.issueKey ?? "",
        scenarioTitle: meta.scenarioTitle ?? "",
        knowledgeKind: "route_functional_observed",
        steps: executedSteps,
        clickTargets: executedClickTargets,
        startsFrom: meta.startsFrom ?? "authenticated_state",
        endsAt: meta.endsAt ?? "functional_area",
        validationStatus: isSuccess ? "validated" : "pending",
        trustedForReuse: isSuccess,
        failureCount: isSuccess ? 0 : 1,
        successCount: isSuccess ? 1 : 0,
        runCount: 1,
        createdAt: now,
        lastSeenAt: now,
        lastValidatedAt: isSuccess ? now : undefined,
    };
    persistItem(appSlug, newItem);
}
/**
 * Mirrors an item that was just written to app.knowledge.json into ProjectKnowledge.knowledgeJson.
 *
 * The file is NOT durable on its own. Anything that materializes a project rewrites
 * app.knowledge.json from SQL (`buildKnowledgeFile` emits exactly what SQL holds), and
 * scenario generation materializes as part of persisting hu_declared knowledge. So runtime
 * evidence that only ever reached the file is erased at the very moment the generation that
 * needs it runs — a learned walk disappears before a single locator can be backed by it.
 *
 * Merge semantics stay in `persistItem`: this receives the already-merged item and upserts it
 * by id, so SQL never diverges from the file.
 */
async function mirrorItemToSql(appSlug, item) {
    try {
        return await (0, sql_connection_1.withTransaction)(async (conn) => {
            const rows = await conn.query("SELECT id FROM dbo.Projects WHERE slug = ?", [appSlug]);
            if (rows.length === 0) {
                console.log(`[runtime-knowledge:sql] skipped id=${item.id} reason=project_not_registered slug=${appSlug}`);
                return false;
            }
            const projectId = rows[0].id;
            const kRows = await conn.query("SELECT knowledgeJson FROM dbo.ProjectKnowledge WITH (UPDLOCK, ROWLOCK) WHERE projectId = ?", [projectId]);
            if (kRows.length === 0) {
                console.log(`[runtime-knowledge:sql] skipped id=${item.id} reason=no_knowledge_row projectId=${projectId}`);
                return false;
            }
            let data = { items: [] };
            if (kRows[0].knowledgeJson) {
                try {
                    const parsed = JSON.parse(kRows[0].knowledgeJson);
                    data = parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
                }
                catch {
                    data = { items: [] };
                }
            }
            const idx = data.items.findIndex((i) => i.id === item.id);
            if (idx >= 0)
                data.items[idx] = item;
            else
                data.items.push(item);
            await conn.query("UPDATE dbo.ProjectKnowledge SET knowledgeJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?", [Buffer.from(JSON.stringify(data), "utf16le"), projectId]);
            console.log(`[runtime-knowledge:sql] mirrored id=${item.id} kind=${item.knowledgeKind} items=${data.items.length}`);
            return true;
        });
    }
    catch (e) {
        console.log(`[runtime-knowledge:sql] mirror FAILED id=${item.id} reason=${e?.message ?? e}`);
        return false;
    }
}
function persistItem(appSlug, newItem) {
    const kp = knowledgePath(appSlug);
    let data = { items: [] };
    try {
        if (fs.existsSync(kp)) {
            data = JSON.parse(fs.readFileSync(kp, "utf-8"));
        }
    }
    catch {
        data = { items: [] };
    }
    const existingIdx = data.items.findIndex((i) => {
        // Match by kind+signature
        const iKind = i.knowledgeKind;
        const nKind = newItem.knowledgeKind;
        if (iKind !== nKind)
            return false;
        if (nKind === "route_menu_snapshot") {
            // Match on the signature-derived id, not on screenKey. screenKey comes from the screen's
            // heading and is identical across every state of a screen, so matching on it merged them
            // all into one item: the state showing the OTP boxes overwrote the initial one, the file
            // never grew past one entry per screen, and the generator kept reporting that it had no
            // evidence of the OTP screen. Identical states still share an id and still merge.
            return i.id === newItem.id;
        }
        if (nKind === "route_functional_observed") {
            const iTargets = i.clickTargets ?? [];
            const nTargets = newItem.clickTargets ?? [];
            return iTargets.join("|") === nTargets.join("|");
        }
        return false;
    });
    if (existingIdx >= 0) {
        const existing = data.items[existingIdx];
        const isSuccess = newItem.validationStatus === "validated";
        existing.lastSeenAt = new Date().toISOString();
        existing.runCount = (existing.runCount ?? 0) + 1;
        if (isSuccess) {
            existing.successCount = (existing.successCount ?? 0) + 1;
            existing.validationStatus = "validated";
            existing.trustedForReuse = true;
            existing.lastValidatedAt = new Date().toISOString();
        }
        else {
            existing.failureCount = (existing.failureCount ?? 0) + 1;
            if (existing.failureCount > 2) {
                existing.trustedForReuse = false;
            }
        }
        // Refresh observable content from the latest observation.
        existing.clickTargets = newItem.clickTargets;
        existing.assertionTargets = newItem.assertionTargets;
        // observedControls: upgrade legacy strings to structured objects; never degrade rich evidence.
        const existingObserved = existing.observedControls;
        const incomingObserved = newItem.observedControls;
        const incomingIsStructured = Array.isArray(incomingObserved) && incomingObserved.length > 0 && typeof incomingObserved[0] === "object";
        const existingIsStructured = Array.isArray(existingObserved) && existingObserved.length > 0 && typeof existingObserved[0] === "object";
        if (incomingIsStructured && existingIsStructured) {
            // Structured→structured: merge per-control using technical identity as key, never label alone.
            const merged = new Map();
            for (const ctrl of existingObserved) {
                merged.set(controlMergeKey(ctrl), { ...ctrl });
            }
            for (const ctrl of incomingObserved) {
                const key = controlMergeKey(ctrl);
                const prev = merged.get(key);
                if (prev) {
                    for (const [k, v] of Object.entries(ctrl)) {
                        if (v !== undefined && v !== null && v !== "")
                            prev[k] = v;
                    }
                    merged.set(key, prev);
                }
                else {
                    merged.set(key, { ...ctrl });
                }
            }
            existing.observedControls = Array.from(merged.values());
        }
        else if (incomingIsStructured) {
            // Legacy→structured: upgrade.
            existing.observedControls = incomingObserved;
        }
        else if (!existingIsStructured && Array.isArray(incomingObserved)) {
            // Legacy→legacy: refresh.
            existing.observedControls = incomingObserved;
        }
        // Keep existing businessLabels if incoming has them.
        if (newItem.businessLabels)
            existing.businessLabels = newItem.businessLabels;
        if (newItem.transitions)
            existing.transitions = newItem.transitions;
        data.items[existingIdx] = existing;
        console.log(`[runtime-knowledge] updated existing item id=${existing.id} runCount=${existing.runCount}`);
    }
    else {
        data.items.push(newItem);
        console.log(`[runtime-knowledge] persisted kind=${newItem.knowledgeKind} trusted=${newItem.trustedForReuse} status=${newItem.validationStatus}`);
    }
    // Atomic write: write to temp then rename
    try {
        const tmp = kp + ".tmp";
        const dir = path.dirname(kp);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
        fs.renameSync(tmp, kp);
    }
    catch {
        // Fallback: write directly
        fs.writeFileSync(kp, JSON.stringify(data, null, 2), "utf-8");
    }
    // Make it durable. Without this the item lives only in the file, and the next
    // materialization rewrites that file from SQL and drops it. Fire-and-forget with an
    // internal catch: the file write above already succeeded, so a SQL outage must not fail
    // the walk — it only costs durability, which the log records.
    const persisted = existingIdx >= 0 ? data.items[existingIdx] : newItem;
    void mirrorItemToSql(appSlug, persisted);
}
/**
 * Pure helper: determines if a MOBILE route_transition should be trusted for reuse.
 *
 * Composite trust requires ALL FOUR conditions with explicit comparisons:
 *   1. transitionValidated === true  (not undefined, not null, not false)
 *   2. executionBacked === true     (action was actually executed by Appium)
 *   3. actionSemanticAuthority === "validated"
 *   4. destinationSemanticAuthority === "validated"
 *
 * Any other combination → false.
 * Action and destination authorities are independent: both must be validated for trust.
 */
function isMobileRouteTransitionTrustedForReuse(item) {
    return (item.transitionValidated === true
        && item.executionBacked === true
        && item.actionSemanticAuthority === "validated"
        && item.destinationSemanticAuthority === "validated");
}
/**
 * Determine the effective destinationSemanticAuthority from a RuntimeTransitionInput,
 * resolving the deprecated boolean field when the explicit string field is absent.
 */
function resolveDestinationSemanticAuthority(input) {
    return input.destinationSemanticAuthority?.trim()
        || (input.semanticDestinationValidated === true ? "validated" : undefined);
}
/**
 * Persist a runtime-observed transition (source screen → control → destination screen).
 * Only persists when:
 *   - beforeScreenKey !== destinationScreenKey (screen actually changed)
 *   - controlPackage matches expectedAppPackage (app-owned control)
 *   - technical identity exists (locatorIdentity or resourceId)
 *
 * Deduplication: same (sourceScreenKey + control identity + destinationScreenKey) → update runCount.
 */
async function persistRuntimeTransition(appSlug, transition, expectedAppPackage) {
    const source = transition.sourceScreenKey?.trim();
    const dest = transition.destinationScreenKey?.trim();
    const sourceTechnical = transition.sourceTechnicalScreenKey?.trim();
    const destinationTechnical = transition.destinationTechnicalScreenKey?.trim();
    const technicalOnly = !source && !dest && Boolean(sourceTechnical && destinationTechnical && transition.transitionValidated === true);
    if ((!source || !dest || source === dest) && !technicalOnly)
        return false;
    const pkg = transition.controlPackage?.trim();
    if (!technicalOnly && (!pkg || pkg !== expectedAppPackage)) {
        console.log(`[runtime-transition] skipped source=${source} dest=${dest} reason=package_mismatch controlPkg=${pkg ?? "unknown"} expected=${expectedAppPackage}`);
        return false;
    }
    const techIdentity = transition.actionLocatorIdentity?.trim() || transition.controlResourceId?.trim() || "";
    if (!techIdentity) {
        console.log(`[runtime-transition] skipped source=${source} dest=${dest} reason=no_technical_identity`);
        return false;
    }
    const id = (0, node_crypto_1.createHash)("sha256")
        .update(`runtime_transition:${source ?? sourceTechnical}:${techIdentity}:${dest ?? destinationTechnical}`)
        .digest("hex")
        .slice(0, 12);
    const now = new Date().toISOString();
    // Resolve destination semantic authority (explicit string > deprecated boolean).
    const destSemanticAuth = resolveDestinationSemanticAuthority(transition);
    // Composite trust decision via pure helper: ALL FOUR conditions must hold.
    const trusted = isMobileRouteTransitionTrustedForReuse({
        transitionValidated: transition.transitionValidated,
        executionBacked: transition.executionBacked,
        actionSemanticAuthority: transition.actionSemanticAuthority,
        destinationSemanticAuthority: destSemanticAuth,
    });
    const item = {
        id,
        knowledgeKind: "route_transition",
        source: "mcp_runtime_observation",
        ...(source ? { sourceScreenKey: source } : {}),
        ...(dest ? { destinationScreenKey: dest } : {}),
        actionBusinessLabel: transition.actionBusinessLabel,
        actionDescription: transition.actionDescription,
        actionLocatorIdentity: techIdentity,
        controlPackage: pkg,
        controlResourceId: transition.controlResourceId,
        controlContentDesc: transition.controlContentDesc,
        actionIntent: transition.actionIntent,
        ...(transition.sourceTechnicalScreenKey?.trim()
            ? { sourceTechnicalScreenKey: transition.sourceTechnicalScreenKey.trim() }
            : {}),
        ...(transition.destinationTechnicalScreenKey?.trim()
            ? { destinationTechnicalScreenKey: transition.destinationTechnicalScreenKey.trim() }
            : {}),
        ...(transition.transitionValidated !== undefined ? { transitionValidated: transition.transitionValidated } : {}),
        ...(transition.executionBacked !== undefined ? { executionBacked: transition.executionBacked } : {}),
        ...(transition.requirementIds && transition.requirementIds.length > 0 ? { requirementIds: transition.requirementIds } : {}),
        ...(transition.actionSemanticAuthority ? { actionSemanticAuthority: transition.actionSemanticAuthority } : {}),
        // Destination semantic authority: only set when explicitly validated.
        ...(destSemanticAuth ? { destinationSemanticAuthority: destSemanticAuth } : {}),
        ...(transition.branchId ? { branchId: transition.branchId } : {}),
        ...(transition.sourceIssueKey ? { sourceIssueKey: transition.sourceIssueKey } : {}),
        ...(transition.scenarioId ? { scenarioId: transition.scenarioId } : {}),
        ...(transition.observedRouteIdentity ? { observedRouteIdentity: transition.observedRouteIdentity } : {}),
        // Observed destination evidence: observation-only, no authority.
        ...(transition.observedDestinationEvidence ? { observedDestinationEvidence: transition.observedDestinationEvidence } : {}),
        // Binding candidate: observation-only, pending validation. Never auto-promotes.
        ...(transition.bindingCandidate ? { bindingCandidate: transition.bindingCandidate } : {}),
        // validationStatus: "validated" for full semantic validation, "validated_technical" when only technical evidence exists.
        validationStatus: trusted ? "validated" : "validated_technical",
        // trustedForReuse: composite trust via pure helper (all four conditions).
        trustedForReuse: trusted,
        runCount: 1,
        createdAt: now,
        lastSeenAt: now,
        lastValidatedAt: now,
    };
    // SQL-first: write to ProjectKnowledge SQL first, then materialize file
    const sqlOk = await persistTransitionToSql(appSlug, item);
    if (!sqlOk) {
        console.log(`[runtime-transition] FAIL-CLOSED: SQL write failed for id=${id}, file NOT written`);
        return false;
    }
    // Materialize app.knowledge.json from SQL
    try {
        await (0, project_materializer_1.materializeProjectRuntime)({ slug: appSlug });
        console.log(`[runtime-transition] materialized id=${id}`);
    }
    catch (e) {
        console.log(`[runtime-transition] materialize warn id=${id} reason=${e.message}`);
    }
    return true;
}
