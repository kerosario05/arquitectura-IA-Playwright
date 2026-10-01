const ACTION_START = /;\s*(?=(?:navigate|click|fill|select|type|press|assert|wait)\b)/i;

/** Repairs intake output that flattened an explicitly delimited action sequence into one step. */
export function normalizeTaskSteps(value: unknown): string[] {
  const candidates = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return candidates.flatMap((candidate) => {
    if (typeof candidate !== "string") return [];
    return candidate.split(ACTION_START).map((step) => step.trim()).filter(Boolean);
  });
}

/** A referenced recording's persisted action sequence outranks prose extracted from intake. */
export function selectTaskSteps(intakeSteps: string[], referenceSteps: string[], recording: boolean): string[] {
  return recording && referenceSteps.length > 0 ? referenceSteps : intakeSteps;
}
