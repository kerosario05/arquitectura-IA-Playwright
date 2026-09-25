"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBindingCandidateId = buildBindingCandidateId;
exports.canCreateBindingCandidate = canCreateBindingCandidate;
exports.buildBindingCandidate = buildBindingCandidate;
exports.enrichBindingCandidate = enrichBindingCandidate;
exports.buildAuthoritativeBindingId = buildAuthoritativeBindingId;
exports.resolveAuthoritativeBindings = resolveAuthoritativeBindings;
exports.promoteCandidateToAuthoritativeBinding = promoteCandidateToAuthoritativeBinding;
exports.persistAuthoritativeBinding = persistAuthoritativeBinding;
exports.readPersistedAuthoritativeBindings = readPersistedAuthoritativeBindings;
const node_crypto_1 = require("node:crypto");
/**
 * Build a deterministic candidate ID from requirementIds and observed technical identity.
 * The ID is stable across re-observations of the same association.
 *
 * Conceptual: candidateId = H(sortedRequirementIds + fingerprint)
 * The hash is technical identity only — it does NOT grant authority.
 */
function buildBindingCandidateId(requirementIds, fingerprint) {
    const sorted = requirementIds.map((r) => r.trim().toUpperCase()).sort().join("|");
    const normalizedFingerprint = fingerprint.trim().toLowerCase();
    const raw = `binding_candidate:${sorted}:${normalizedFingerprint}`;
    return (0, node_crypto_1.createHash)("sha256").update(raw).digest("hex").slice(0, 16);
}
/**
 * Determine if a runtime transition qualifies for candidate creation.
 * All conditions must be met — this only demonstrates the association was observed.
 */
function canCreateBindingCandidate(transition) {
    return (Boolean(transition.requirementIds && transition.requirementIds.length > 0)
        && transition.transitionValidated === true
        && transition.executionBacked === true
        && transition.actionSemanticAuthority === "validated"
        && Boolean(transition.observedDestinationEvidence));
}
/**
 * Build a binding candidate from a validated runtime transition.
 * Returns undefined if conditions are not met.
 */
function buildBindingCandidate(transitionId, requirementIds, observedEvidence, now) {
    if (requirementIds.length === 0)
        return undefined;
    if (!observedEvidence.fingerprint)
        return undefined;
    const timestamp = now ?? new Date().toISOString();
    return {
        candidateId: buildBindingCandidateId(requirementIds, observedEvidence.fingerprint),
        requirementIds: [...requirementIds],
        sourceTransitionId: transitionId,
        observedDestinationEvidence: observedEvidence,
        observationCount: 1,
        source: "runtime_observed",
        validationStatus: "pending",
        createdAt: timestamp,
        lastObservedAt: timestamp,
    };
}
/**
 * Enrich an existing candidate with a new observation.
 * Increments count, updates timestamps, merges markers. Never changes validationStatus.
 */
function enrichBindingCandidate(existing, newEvidence, now) {
    const timestamp = now ?? new Date().toISOString();
    // Merge markers: keep existing, add new ones not already present.
    // Initialize seen set with existing markers to prevent duplicates.
    const seen = new Set();
    for (const m of existing.observedDestinationEvidence.markers) {
        seen.add(`${m.kind}:${m.value.toLowerCase()}`);
    }
    const mergedMarkers = [...existing.observedDestinationEvidence.markers];
    for (const m of newEvidence.markers) {
        const key = `${m.kind}:${m.value.toLowerCase()}`;
        if (!seen.has(key)) {
            seen.add(key);
            mergedMarkers.push(m);
        }
    }
    return {
        ...existing,
        observedDestinationEvidence: {
            ...existing.observedDestinationEvidence,
            markers: mergedMarkers,
        },
        observationCount: existing.observationCount + 1,
        lastObservedAt: timestamp,
    };
}
/**
 * Build a deterministic binding ID from requirementIds and semantic identity.
 */
function buildAuthoritativeBindingId(requirementIds, semanticIdentity) {
    const sorted = requirementIds.map((r) => r.trim().toUpperCase()).sort().join("|");
    const normalizedIdentity = semanticIdentity.trim().toLowerCase();
    const raw = `auth_binding:${sorted}:${normalizedIdentity}`;
    return (0, node_crypto_1.createHash)("sha256").update(raw).digest("hex").slice(0, 16);
}
/**
 * Resolve authoritative bindings into destination claim definitions.
 * Only validated bindings produce claims. Pending/candidate items are excluded.
 *
 * Preserves the original source (including human_validation) as `authoritySource`.
 */
function resolveAuthoritativeBindings(bindings) {
    return bindings
        .filter((b) => b.validationStatus === "validated")
        .map((b) => ({
        destinationClaimId: buildClaimIdFromBinding(b),
        requirementIds: b.requirementIds,
        kind: "semantic_destination",
        semanticIdentity: b.semanticIdentity,
        source: b.source,
        trustLevel: "validated",
    }));
}
/** Build a claim ID from an authoritative binding (same algorithm as buildDestinationClaimId). */
function buildClaimIdFromBinding(binding) {
    const sorted = binding.requirementIds.map((r) => r.trim().toUpperCase()).sort().join("|");
    const normalizedIdentity = binding.semanticIdentity.trim().toLowerCase();
    const raw = `dest_claim:${sorted}:${normalizedIdentity}`;
    return (0, node_crypto_1.createHash)("sha256").update(raw).digest("hex").slice(0, 16);
}
/**
 * Build a core-owned opaque semantic identity for an authoritative binding.
 * The identity is deterministic from requirementIds + fingerprint, but the hash
 * does NOT grant authority — authority comes from the explicit approval.
 *
 * For human_validation: the caller does NOT provide semanticIdentity.
 * The core generates it from the approved association.
 */
function buildCoreSemanticIdentity(requirementIds, fingerprint) {
    const sorted = requirementIds.map((r) => r.trim().toUpperCase()).sort().join("|");
    const normalizedFingerprint = fingerprint.trim().toLowerCase();
    const raw = `dest_identity:${sorted}:${normalizedFingerprint}`;
    return `dest_${(0, node_crypto_1.createHash)("sha256").update(raw).digest("hex").slice(0, 12)}`;
}
/**
 * Promote a candidate to an authoritative binding.
 * This requires EXPLICIT approval from a trusted source — never called automatically.
 *
 * For human_validation: semanticIdentity is generated core-side (opaque, stable).
 * The caller does NOT provide semanticIdentity — the core owns it.
 *
 * The approvedDestinationProfile is a FROZEN snapshot of the candidate's observed
 * evidence at the moment of approval. Subsequent candidate enrichments do NOT
 * mutate this profile — a new explicit approval is required to change it.
 */
function promoteCandidateToAuthoritativeBinding(candidate, source, now) {
    const timestamp = now ?? new Date().toISOString();
    // Core-owned semantic identity: deterministic from requirementIds + fingerprint.
    // The hash is opaque — authority comes from explicit approval, not from the hash.
    const semanticIdentity = buildCoreSemanticIdentity(candidate.requirementIds, candidate.observedDestinationEvidence.fingerprint ?? "");
    // Freeze the observed evidence snapshot at approval time.
    // This is immutable — future candidate enrichments do NOT change it.
    const frozenProfile = {
        ...candidate.observedDestinationEvidence,
        markers: [...candidate.observedDestinationEvidence.markers],
    };
    return {
        bindingId: buildAuthoritativeBindingId(candidate.requirementIds, semanticIdentity),
        requirementIds: [...candidate.requirementIds],
        semanticIdentity,
        source,
        validationStatus: "validated",
        createdAt: timestamp,
        promotedFromCandidateId: candidate.candidateId,
        approvedFromTransitionId: candidate.sourceTransitionId,
        approvedDestinationProfile: frozenProfile,
    };
}
// ---------------------------------------------------------------------------
// PERSISTENCE (SQL-first pattern via ProjectKnowledge knowledgeJson)
// ---------------------------------------------------------------------------
const sql_connection_1 = require("../db/sql-connection");
const project_materializer_1 = require("../db/project-materializer");
const project_reader_1 = require("../db/project-reader");
/**
 * Persist an authoritative destination binding via SQL-first pattern.
 * Writes to dbo.ProjectKnowledge.knowledgeJson as a knowledge item with
 * knowledgeKind="authoritative_destination_binding".
 *
 * Flow: SQL upsert → materialize → app.knowledge.json
 * Idempotent: same bindingId → upsert (merge), no duplicate.
 */
async function persistAuthoritativeBinding(appSlug, binding) {
    const item = {
        id: binding.bindingId,
        knowledgeKind: "authoritative_destination_binding",
        source: binding.source,
        requirementIds: binding.requirementIds,
        semanticIdentity: binding.semanticIdentity,
        validationStatus: binding.validationStatus,
        promotedFromCandidateId: binding.promotedFromCandidateId,
        approvedDestinationProfile: binding.approvedDestinationProfile,
        createdAt: binding.createdAt,
    };
    // SQL-first: write to ProjectKnowledge.knowledgeJson via transaction.
    const sqlResult = await persistBindingToSql(appSlug, item);
    if (!sqlResult) {
        console.log(`[binding-sql] FAIL-CLOSED: SQL write failed for id=${binding.bindingId}, file NOT written`);
        return false;
    }
    // Materialize app.knowledge.json from SQL.
    try {
        await (0, project_materializer_1.materializeProjectRuntime)({ slug: appSlug });
        console.log(`[binding-sql] materialized id=${binding.bindingId}`);
    }
    catch (e) {
        console.log(`[binding-sql] materialize warn id=${binding.bindingId} reason=${e.message}`);
    }
    return true;
}
/** SQL-first write: upsert binding into dbo.ProjectKnowledge.knowledgeJson. */
async function persistBindingToSql(appSlug, item) {
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
                // Idempotent: same bindingId → update (preserve original createdAt)
                const existing = data.items[idx];
                data.items[idx] = {
                    ...existing,
                    ...item,
                    createdAt: existing.createdAt,
                };
                console.log(`[binding-sql] updated id=${item.id}`);
            }
            else {
                data.items.push(item);
                console.log(`[binding-sql] persisted id=${item.id}`);
            }
            await conn.query("UPDATE dbo.ProjectKnowledge SET knowledgeJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?", [Buffer.from(JSON.stringify(data), "utf16le"), projectId]);
            return true;
        });
        return result;
    }
    catch (e) {
        console.log(`[binding-sql] FAILED reason=${e.message}`);
        return false;
    }
}
/**
 * Read persisted authoritative bindings from SQL-backed ProjectKnowledge.
 *
 * SQL is the source of truth. File fallback is ONLY used when the SQL read
 * succeeds but the project has no knowledgeJson (newly created project).
 *
 * CRITICAL: When SQL throws an error, we fail-closed (return []) instead of
 * falling back to file. A stale JSON cache must NOT grant authority that SQL
 * has revoked or never granted. This prevents the stale cache authority leak.
 */
async function readPersistedAuthoritativeBindings(appSlug) {
    try {
        const cfg = await (0, project_reader_1.getProjectConfigurationBySlug)(appSlug);
        if (cfg?.knowledge?.knowledgeJson) {
            const data = JSON.parse(cfg.knowledge.knowledgeJson);
            if (data && Array.isArray(data.items)) {
                return filterAuthoritativeBindings(data.items);
            }
        }
        // SQL succeeded but no knowledgeJson — return empty (no stale file fallback)
        return [];
    }
    catch (e) {
        // SQL unavailable: fail-closed. A stale JSON cache must NOT grant authority
        // that SQL has revoked or never granted.
        console.log(`[binding-sql] read FAIL-CLOSED: SQL unavailable, no authority granted: ${e.message}`);
        return [];
    }
}
/** Filter raw items to authoritative bindings with validated status. */
function filterAuthoritativeBindings(items) {
    const bindings = [];
    for (const item of items) {
        if (item.knowledgeKind !== "authoritative_destination_binding")
            continue;
        if (item.validationStatus !== "validated")
            continue;
        if (!Array.isArray(item.requirementIds) || item.requirementIds.length === 0)
            continue;
        if (typeof item.semanticIdentity !== "string" || !item.semanticIdentity)
            continue;
        if (!item.approvedDestinationProfile || typeof item.approvedDestinationProfile !== "object")
            continue;
        bindings.push({
            bindingId: String(item.id),
            requirementIds: item.requirementIds,
            semanticIdentity: String(item.semanticIdentity),
            source: item.source,
            validationStatus: "validated",
            createdAt: String(item.createdAt ?? ""),
            promotedFromCandidateId: item.promotedFromCandidateId,
            approvedFromTransitionId: String(item.approvedFromTransitionId ?? ""),
            approvedDestinationProfile: item.approvedDestinationProfile,
        });
    }
    return bindings;
}
