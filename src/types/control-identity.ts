import { createHash } from "node:crypto";
import type { CandidateLocator } from "./page-snapshot.types";

export type ControlIdentitySignals = {
  tagName?: string;
  inputType?: string;
  role?: string;
  name?: string;
  id?: string;
  ariaControls?: string;
  candidateLocator?: Pick<CandidateLocator, "strategy" | "role" | "exact">;
};

export type ControlIdentity = {
  fingerprint: string;
  source: "runtime";
  signals: ControlIdentitySignals;
};

export type RuntimeControlMetadata = ControlIdentitySignals & {
  snapshotId?: string;
};

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function buildRuntimeControlIdentity(metadata: RuntimeControlMetadata): ControlIdentity | null {
  const normalizedId = normalize(metadata.id);
  const signals: ControlIdentitySignals = {
    tagName: normalize(metadata.tagName),
    inputType: normalize(metadata.inputType),
    role: normalize(metadata.role),
    name: normalize(metadata.name),
    id: normalizedId && !/^el-\d+$/.test(normalizedId) ? normalizedId : undefined,
    ariaControls: normalize(metadata.ariaControls),
    candidateLocator: metadata.candidateLocator
      ? {
          strategy: metadata.candidateLocator.strategy,
          ...(metadata.candidateLocator.role ? { role: normalize(metadata.candidateLocator.role) } : {}),
          ...(metadata.candidateLocator.exact !== undefined ? { exact: metadata.candidateLocator.exact } : {}),
        }
      : undefined,
  };
  const structuralSignals = [signals.tagName, signals.inputType, signals.role, signals.name, signals.id, signals.ariaControls, signals.candidateLocator?.strategy]
    .filter(Boolean);
  if (structuralSignals.length < 2) return null;
  const canonical = JSON.stringify(signals);
  return {
    fingerprint: createHash("sha256").update(canonical).digest("hex"),
    source: "runtime",
    signals,
  };
}

export function matchControlIdentity(a: ControlIdentity | null | undefined, b: ControlIdentity | null | undefined): "match" | "no_match" | "unknown" {
  if (!a || !b || !a.fingerprint || !b.fingerprint) return "unknown";
  return a.fingerprint === b.fingerprint ? "match" : "no_match";
}
