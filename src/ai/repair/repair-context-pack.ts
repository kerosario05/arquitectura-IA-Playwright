type RepairCandidate = {
  candidateId: string;
  role?: string;
  name?: string;
  text?: string;
  visible: boolean;
  enabled?: boolean;
  clickable?: boolean;
  editable?: boolean;
  semanticRelation?: string;
  score?: number;
  sensitive?: boolean;
};

export type RepairContextPackInput = {
  appSlug: string;
  failure: string;
  currentStep: string;
  currentUrl: string;
  snapshotSummary?: Record<string, unknown>;
  candidates: RepairCandidate[];
  runtimeEvidenceTrace?: unknown;
  structuralEvidence?: unknown;
  feedbackEvidence?: unknown;
  pendingAssertions?: string[];
  previousActions?: string[];
  previousFills?: string[];
  constraints?: string[];
  maxChars: number;
};

export type RepairContextPack = Omit<RepairContextPackInput, "maxChars">;

const SECRET_PATTERNS = [
  /password/gi,
  /contrasena/gi,
  /otp/gi,
  /token/gi,
  /api[-_ ]?key/gi,
  /authorization/gi,
  /secret/gi
];

function redactSecrets(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

function safeClone(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(safeClone);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = redactSecrets(k);
    out[key] = safeClone(v);
  }
  return out;
}

export function buildRepairContextPack(input: RepairContextPackInput): RepairContextPack {
  const filteredCandidates = input.candidates
    .filter((candidate) => candidate.visible)
    .map((candidate) => ({
    candidateId: candidate.candidateId,
    role: candidate.role,
    name: candidate.name ? redactSecrets(candidate.name) : undefined,
    text: candidate.text ? redactSecrets(candidate.text) : undefined,
    visible: candidate.visible,
    enabled: candidate.enabled,
    clickable: candidate.clickable,
    editable: candidate.editable,
    semanticRelation: candidate.semanticRelation,
    score: candidate.score,
    sensitive: candidate.sensitive
  }));

  const pack: RepairContextPack = {
    appSlug: input.appSlug,
    failure: redactSecrets(input.failure),
    currentStep: redactSecrets(input.currentStep),
    currentUrl: input.currentUrl,
    snapshotSummary: safeClone(input.snapshotSummary) as Record<string, unknown> | undefined,
    candidates: filteredCandidates,
    runtimeEvidenceTrace: safeClone(input.runtimeEvidenceTrace),
    structuralEvidence: safeClone(input.structuralEvidence),
    feedbackEvidence: safeClone(input.feedbackEvidence),
    pendingAssertions: input.pendingAssertions?.map(redactSecrets),
    previousActions: input.previousActions?.map(redactSecrets),
    previousFills: input.previousFills?.map(redactSecrets),
    constraints: input.constraints?.map(redactSecrets)
  };

  const serialized = JSON.stringify(pack);
  if (serialized.length <= input.maxChars) return pack;

  const compact: RepairContextPack = {
    ...pack,
    runtimeEvidenceTrace: undefined,
    structuralEvidence: undefined,
    feedbackEvidence: undefined,
    previousActions: pack.previousActions?.slice(-5),
    previousFills: pack.previousFills?.slice(-5),
    candidates: pack.candidates.slice(0, 30)
  };

  const compactSerialized = JSON.stringify(compact);
  if (compactSerialized.length <= input.maxChars) return compact;

  return {
    ...compact,
    snapshotSummary: { truncated: true },
    candidates: compact.candidates.slice(0, 10),
    pendingAssertions: compact.pendingAssertions?.slice(0, 5)
  };
}
