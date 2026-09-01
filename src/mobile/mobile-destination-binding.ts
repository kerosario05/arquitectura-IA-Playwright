import { createHash } from "node:crypto";
import type { MobileObservedDestination } from "./mobile-observed-destination";

/**
 * Mobile destination binding types.
 *
 * Separates two concepts:
 * - MobileDestinationBindingCandidate: runtime-observed association, NOT trusted
 * - MobileAuthoritativeDestinationBinding: approved by a trusted source, CAN feed manifest
 *
 * The candidate NEVER auto-promotes to authoritative. Promotion requires explicit approval.
 */

// ---------------------------------------------------------------------------
// CANDIDATE
// ---------------------------------------------------------------------------

/** Source of a binding candidate. Only "runtime_observed" exists today. */
export type BindingCandidateSource = "runtime_observed";

/** Validation status of a binding candidate. */
export type BindingCandidateValidationStatus = "pending";

/**
 * A possible association detected by runtime.
 * Represents: "when we executed these requirements, we observed this screen".
 * Does NOT represent: "this is the correct screen for these requirements".
 */
export type MobileDestinationBindingCandidate = {
  /** Deterministic candidate ID from requirementIds + technical identity. */
  candidateId: string;
  /** Canonical requirement IDs this candidate relates to. */
  requirementIds: string[];
  /** ID of the route_transition that produced this observation. */
  sourceTransitionId: string;
  /** Observed destination evidence from the transition. */
  observedDestinationEvidence: MobileObservedDestination;
  /** Number of times this same association has been observed. */
  observationCount: number;
  /** Source of this candidate. */
  source: BindingCandidateSource;
  /** Validation status. Candidates are always "pending" — never auto-promoted. */
  validationStatus: BindingCandidateValidationStatus;
  /** When this candidate was first observed. */
  createdAt: string;
  /** When this candidate was last observed. */
  lastObservedAt: string;
};

/**
 * Build a deterministic candidate ID from requirementIds and observed technical identity.
 * The ID is stable across re-observations of the same association.
 *
 * Conceptual: candidateId = H(sortedRequirementIds + fingerprint)
 * The hash is technical identity only — it does NOT grant authority.
 */
export function buildBindingCandidateId(
  requirementIds: string[],
  fingerprint: string,
): string {
  const sorted = requirementIds.map((r) => r.trim().toUpperCase()).sort().join("|");
  const normalizedFingerprint = fingerprint.trim().toLowerCase();
  const raw = `binding_candidate:${sorted}:${normalizedFingerprint}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Determine if a runtime transition qualifies for candidate creation.
 * All conditions must be met — this only demonstrates the association was observed.
 */
export function canCreateBindingCandidate(transition: {
  requirementIds?: string[];
  transitionValidated?: boolean;
  executionBacked?: boolean;
  actionSemanticAuthority?: string;
  observedDestinationEvidence?: MobileObservedDestination;
}): boolean {
  return (
    Boolean(transition.requirementIds && transition.requirementIds.length > 0)
    && transition.transitionValidated === true
    && transition.executionBacked === true
    && transition.actionSemanticAuthority === "validated"
    && Boolean(transition.observedDestinationEvidence)
  );
}

/**
 * Build a binding candidate from a validated runtime transition.
 * Returns undefined if conditions are not met.
 */
export function buildBindingCandidate(
  transitionId: string,
  requirementIds: string[],
  observedEvidence: MobileObservedDestination,
  now?: string,
): MobileDestinationBindingCandidate | undefined {
  if (requirementIds.length === 0) return undefined;
  if (!observedEvidence.fingerprint) return undefined;
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
export function enrichBindingCandidate(
  existing: MobileDestinationBindingCandidate,
  newEvidence: MobileObservedDestination,
  now?: string,
): MobileDestinationBindingCandidate {
  const timestamp = now ?? new Date().toISOString();
  // Merge markers: keep existing, add new ones not already present.
  // Initialize seen set with existing markers to prevent duplicates.
  const seen = new Set<string>();
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

// ---------------------------------------------------------------------------
// AUTHORITATIVE BINDING
// ---------------------------------------------------------------------------

/** Source of an authoritative binding. Only trusted sources qualify. */
export type AuthoritativeBindingSource =
  | "canonical_requirement"
  | "trusted_config"
  | "validated_knowledge"
  | "human_validation";

/** Validation status of an authoritative binding. Must be "validated". */
export type AuthoritativeBindingValidationStatus = "validated";

/**
 * An approved destination binding from a trusted source.
 * This CAN feed into buildMobileDestinationClaimManifest.
 *
 * semanticIdentity is an opaque stable ID — NOT derived from UI text,
 * fingerprint, screenKey, or any automated observation.
 *
 * approvedDestinationProfile is a FROZEN snapshot of the observed evidence
 * at the moment of approval. It is immutable after creation — subsequent
 * candidate enrichments do NOT mutate it. A new explicit approval is required
 * to change the trusted profile.
 */
export type MobileAuthoritativeDestinationBinding = {
  /** Deterministic binding ID. */
  bindingId: string;
  /** Canonical requirement IDs this binding relates to. */
  requirementIds: string[];
  /** Abstract semantic identity of the destination. Core-owned, opaque, stable. */
  semanticIdentity: string;
  /** Source that approved this binding. */
  source: AuthoritativeBindingSource;
  /** Must be "validated" — only validated bindings are authoritative. */
  validationStatus: AuthoritativeBindingValidationStatus;
  /** When this binding was created. */
  createdAt: string;
  /** Optional: candidate ID that was promoted to this binding. */
  promotedFromCandidateId?: string;
  /** ID of the transition whose observation was approved. Used for self-match prevention. */
  approvedFromTransitionId: string;
  /**
   * Frozen snapshot of the observed destination evidence at approval time.
   * This is IMMUTABLE — subsequent candidate enrichments do NOT change it.
   * Contains only observation evidence that existed when the binding was approved.
   */
  approvedDestinationProfile: MobileObservedDestination;
};

/**
 * Build a deterministic binding ID from requirementIds and semantic identity.
 */
export function buildAuthoritativeBindingId(
  requirementIds: string[],
  semanticIdentity: string,
): string {
  const sorted = requirementIds.map((r) => r.trim().toUpperCase()).sort().join("|");
  const normalizedIdentity = semanticIdentity.trim().toLowerCase();
  const raw = `auth_binding:${sorted}:${normalizedIdentity}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Resolve authoritative bindings into destination claim definitions.
 * Only validated bindings produce claims. Pending/candidate items are excluded.
 *
 * Preserves the original source (including human_validation) as `authoritySource`.
 */
export function resolveAuthoritativeBindings(
  bindings: MobileAuthoritativeDestinationBinding[],
): Array<{
  destinationClaimId: string;
  requirementIds: string[];
  kind: "semantic_destination";
  semanticIdentity: string;
  source: AuthoritativeBindingSource;
  trustLevel: "validated";
}> {
  return bindings
    .filter((b) => b.validationStatus === "validated")
    .map((b) => ({
      destinationClaimId: buildClaimIdFromBinding(b),
      requirementIds: b.requirementIds,
      kind: "semantic_destination" as const,
      semanticIdentity: b.semanticIdentity,
      source: b.source,
      trustLevel: "validated" as const,
    }));
}

/** Build a claim ID from an authoritative binding (same algorithm as buildDestinationClaimId). */
function buildClaimIdFromBinding(binding: MobileAuthoritativeDestinationBinding): string {
  const sorted = binding.requirementIds.map((r) => r.trim().toUpperCase()).sort().join("|");
  const normalizedIdentity = binding.semanticIdentity.trim().toLowerCase();
  const raw = `dest_claim:${sorted}:${normalizedIdentity}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Build a core-owned opaque semantic identity for an authoritative binding.
 * The identity is deterministic from requirementIds + fingerprint, but the hash
 * does NOT grant authority — authority comes from the explicit approval.
 *
 * For human_validation: the caller does NOT provide semanticIdentity.
 * The core generates it from the approved association.
 */
function buildCoreSemanticIdentity(
  requirementIds: string[],
  fingerprint: string,
): string {
  const sorted = requirementIds.map((r) => r.trim().toUpperCase()).sort().join("|");
  const normalizedFingerprint = fingerprint.trim().toLowerCase();
  const raw = `dest_identity:${sorted}:${normalizedFingerprint}`;
  return `dest_${createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;
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
export function promoteCandidateToAuthoritativeBinding(
  candidate: MobileDestinationBindingCandidate,
  source: AuthoritativeBindingSource,
  now?: string,
): MobileAuthoritativeDestinationBinding {
  const timestamp = now ?? new Date().toISOString();
  // Core-owned semantic identity: deterministic from requirementIds + fingerprint.
  // The hash is opaque — authority comes from explicit approval, not from the hash.
  const semanticIdentity = buildCoreSemanticIdentity(
    candidate.requirementIds,
    candidate.observedDestinationEvidence.fingerprint ?? "",
  );
  // Freeze the observed evidence snapshot at approval time.
  // This is immutable — future candidate enrichments do NOT change it.
  const frozenProfile: MobileObservedDestination = {
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

import { withTransaction } from "../db/sql-connection";
import { materializeProjectRuntime } from "../db/project-materializer";
import { getProjectConfigurationBySlug } from "../db/project-reader";

/**
 * Persist an authoritative destination binding via SQL-first pattern.
 * Writes to dbo.ProjectKnowledge.knowledgeJson as a knowledge item with
 * knowledgeKind="authoritative_destination_binding".
 *
 * Flow: SQL upsert → materialize → app.knowledge.json
 * Idempotent: same bindingId → upsert (merge), no duplicate.
 */
export async function persistAuthoritativeBinding(
  appSlug: string,
  binding: MobileAuthoritativeDestinationBinding,
): Promise<boolean> {
  const item: Record<string, unknown> = {
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
    await materializeProjectRuntime({ slug: appSlug });
    console.log(`[binding-sql] materialized id=${binding.bindingId}`);
  } catch (e: any) {
    console.log(`[binding-sql] materialize warn id=${binding.bindingId} reason=${e.message}`);
  }
  return true;
}

/** SQL-first write: upsert binding into dbo.ProjectKnowledge.knowledgeJson. */
async function persistBindingToSql(appSlug: string, item: Record<string, unknown>): Promise<boolean> {
  try {
    const result = await withTransaction(async (conn) => {
      const rows = await conn.query<{ id: string }>(
        "SELECT id FROM dbo.Projects WHERE slug = ?", [appSlug]
      );
      if (rows.length === 0) return false;
      const projectId = rows[0].id;

      const kRows = await conn.query<{ knowledgeJson: string }>(
        "SELECT knowledgeJson FROM dbo.ProjectKnowledge WITH (UPDLOCK, ROWLOCK) WHERE projectId = ?",
        [projectId]
      );

      let data: { items: Record<string, unknown>[] } = { items: [] };
      if (kRows.length > 0 && kRows[0].knowledgeJson) {
        try {
          const parsed = JSON.parse(kRows[0].knowledgeJson);
          data = parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
        } catch { data = { items: [] }; }
      }

      const idx = data.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        // Idempotent: same bindingId → update (preserve original createdAt)
        const existing = data.items[idx] as Record<string, unknown>;
        data.items[idx] = {
          ...existing,
          ...item,
          createdAt: existing.createdAt,
        };
        console.log(`[binding-sql] updated id=${item.id}`);
      } else {
        data.items.push(item);
        console.log(`[binding-sql] persisted id=${item.id}`);
      }

      await conn.query(
        "UPDATE dbo.ProjectKnowledge SET knowledgeJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?",
        [Buffer.from(JSON.stringify(data), "utf16le"), projectId]
      );
      return true;
    });
    return result;
  } catch (e: any) {
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
export async function readPersistedAuthoritativeBindings(
  appSlug: string,
): Promise<MobileAuthoritativeDestinationBinding[]> {
  try {
    const cfg = await getProjectConfigurationBySlug(appSlug);
    if (cfg?.knowledge?.knowledgeJson) {
      const data = JSON.parse(cfg.knowledge.knowledgeJson);
      if (data && Array.isArray(data.items)) {
        return filterAuthoritativeBindings(data.items);
      }
    }
    // SQL succeeded but no knowledgeJson — return empty (no stale file fallback)
    return [];
  } catch (e: any) {
    // SQL unavailable: fail-closed. A stale JSON cache must NOT grant authority
    // that SQL has revoked or never granted.
    console.log(`[binding-sql] read FAIL-CLOSED: SQL unavailable, no authority granted: ${e.message}`);
    return [];
  }
}

/** Filter raw items to authoritative bindings with validated status. */
function filterAuthoritativeBindings(items: Record<string, unknown>[]): MobileAuthoritativeDestinationBinding[] {
  const bindings: MobileAuthoritativeDestinationBinding[] = [];
  for (const item of items) {
    if (item.knowledgeKind !== "authoritative_destination_binding") continue;
    if (item.validationStatus !== "validated") continue;
    if (!Array.isArray(item.requirementIds) || item.requirementIds.length === 0) continue;
    if (typeof item.semanticIdentity !== "string" || !item.semanticIdentity) continue;
    if (!item.approvedDestinationProfile || typeof item.approvedDestinationProfile !== "object") continue;
    bindings.push({
      bindingId: String(item.id),
      requirementIds: item.requirementIds as string[],
      semanticIdentity: String(item.semanticIdentity),
      source: item.source as AuthoritativeBindingSource,
      validationStatus: "validated",
      createdAt: String(item.createdAt ?? ""),
      promotedFromCandidateId: item.promotedFromCandidateId as string | undefined,
      approvedFromTransitionId: String(item.approvedFromTransitionId ?? ""),
      approvedDestinationProfile: item.approvedDestinationProfile as MobileObservedDestination,
    });
  }
  return bindings;
}
