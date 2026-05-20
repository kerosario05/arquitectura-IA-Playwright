export function normalizeAppProfile(value?: string): string {
  if (!value || !value.trim()) return "default";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "default";
}

export function getCurrentAppProfile(): string {
  return normalizeAppProfile(process.env.APP_PROFILE);
}

export function shouldRunGeneratedSpec(input: {
  specProfile?: string;
  currentProfile?: string;
}): boolean {
  const current = normalizeAppProfile(input.currentProfile ?? getCurrentAppProfile());
  const spec = normalizeAppProfile(input.specProfile);
  return current === spec;
}

export function buildGeneratedSpecSkipReason(input: {
  specProfile?: string;
  currentProfile?: string;
}): string | undefined {
  if (shouldRunGeneratedSpec(input)) return undefined;
  const current = normalizeAppProfile(input.currentProfile ?? getCurrentAppProfile());
  const spec = normalizeAppProfile(input.specProfile);
  return `Skipped because APP_PROFILE "${current}" does not match spec profile "${spec}"`;
}
