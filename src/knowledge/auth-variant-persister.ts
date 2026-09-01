import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { withTransaction } from "../db/sql-connection";
import { materializeProjectRuntime } from "../db/project-materializer";

export type AuthVariantObservation = {
  variantLabel: string;
  locatorIdentity?: string;
  sourceScreenKey: string;
  observedFieldsBefore: string[];
  observedFieldsAfter: string[];
  requiredFieldsMatched: string[];
  postSelectionFingerprint?: string;
  successEvidence?: string;
};

type KnowledgeItem = Record<string, unknown>;

const SENSITIVE_RE = /(password|passwd|pwd|contrase|token|otp|credential|secret)/i;

function sanitizeFields(fields: string[]): string[] {
  return fields
    .map((f) => String(f).trim())
    .filter((f) => f.length > 0)
    // drop any field that looks like containing secret value
    .filter((f) => !SENSITIVE_RE.test(f))
    // also strip values after colon to keep only label
    .map((f) => f.split(":")[0].trim())
    .filter((f) => f.length > 0 && !SENSITIVE_RE.test(f));
}

function sanitizeEvidence(ev?: string): string | undefined {
  if (!ev) return undefined;
  const trimmed = String(ev).trim();
  if (!trimmed) return undefined;
  if (SENSITIVE_RE.test(trimmed)) return undefined;
  return trimmed;
}

function stableId(sourceScreenKey: string, variantLabel: string, locatorIdentity?: string): string {
  const normalizedLabel = variantLabel.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  const keyPart = locatorIdentity?.trim() ? `loc:${locatorIdentity.trim()}` : `lbl:${normalizedLabel}`;
  const hash = createHash("sha256").update(`${sourceScreenKey}:${keyPart}`).digest("hex").slice(0, 12);
  return `av_${hash}`;
}

function knowledgePath(appSlug: string): string {
  return path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
}

function readKnowledge(appSlug: string): { items: KnowledgeItem[] } {
  const kp = knowledgePath(appSlug);
  try {
    if (fs.existsSync(kp)) {
      const parsed = JSON.parse(fs.readFileSync(kp, "utf-8"));
      return parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
    }
  } catch {}
  return { items: [] };
}

function writeKnowledge(appSlug: string, data: { items: KnowledgeItem[] }): void {
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

async function persistToSql(appSlug: string, item: KnowledgeItem): Promise<boolean> {
  try {
    const result = await withTransaction(async (conn) => {
      const rows = await conn.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [appSlug]);
      if (rows.length === 0) return false;
      const projectId = rows[0].id;
      const kRows = await conn.query<{ knowledgeJson: string }>("SELECT knowledgeJson FROM dbo.ProjectKnowledge WITH (UPDLOCK, ROWLOCK) WHERE projectId = ?", [projectId]);
      let data: { items: KnowledgeItem[] } = { items: [] };
      if (kRows.length > 0 && kRows[0].knowledgeJson) {
        try {
          const parsed = JSON.parse(kRows[0].knowledgeJson);
          data = parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
        } catch { data = { items: [] }; }
      }
      const idx = data.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        const existing = data.items[idx] as any;
        // update preserves trusted/validation logic from item
        data.items[idx] = { ...existing, ...item, createdAt: existing.createdAt, runCount: ((existing.runCount as number) ?? 0) + 1 };
      } else {
        data.items.push(item);
      }
      await conn.query("UPDATE dbo.ProjectKnowledge SET knowledgeJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?", [Buffer.from(JSON.stringify(data), "utf16le"), projectId]);
      return true;
    });
    if (result) {
      try { await materializeProjectRuntime({ slug: appSlug }); } catch {}
    }
    return result;
  } catch {
    return false;
  }
}

function buildPostFingerprint(observedFieldsAfter: string[]): string {
  const sorted = [...observedFieldsAfter].map((s) => s.trim().toLowerCase()).sort().join("|");
  return createHash("sha256").update(sorted).digest("hex").slice(0, 12);
}

export async function persistAuthVariant(
  appSlug: string,
  obs: AuthVariantObservation,
  opts: { phase: 1 | 2; issueKey?: string }
): Promise<KnowledgeItem> {
  const sanitizedBefore = sanitizeFields(obs.observedFieldsBefore);
  const sanitizedAfter = sanitizeFields(obs.observedFieldsAfter);
  const sanitizedRequired = sanitizeFields(obs.requiredFieldsMatched);
  const sanitizedSuccess = sanitizeEvidence(obs.successEvidence);
  const sanitizedVariantLabel = String(obs.variantLabel).split(":")[0].trim();
  // never store sensitive variantLabel if it contains secret
  const finalVariantLabel = SENSITIVE_RE.test(sanitizedVariantLabel) ? "redacted_variant" : sanitizedVariantLabel;
  const finalLocator = obs.locatorIdentity && !SENSITIVE_RE.test(obs.locatorIdentity) ? obs.locatorIdentity.trim() : undefined;

  const id = stableId(obs.sourceScreenKey, finalVariantLabel, finalLocator);
  const now = new Date().toISOString();
  const postFingerprint = obs.postSelectionFingerprint?.trim() || buildPostFingerprint(sanitizedAfter);

  // Determine validation status per contract
  const isPhase2 = opts.phase === 2 && Boolean(sanitizedSuccess);
  const validationStatus = isPhase2 ? "validated" : "pending";
  const trustedForReuse = isPhase2;

  // Try load existing to preserve creation time and handle duplicate prevention
  const existingData = readKnowledge(appSlug);
  const existing = existingData.items.find((i) => i.id === id) as any;

  let item: KnowledgeItem;
  if (existing) {
    // update same identity, no duplicate
    item = {
      ...existing,
      variantLabel: finalVariantLabel,
      ...(finalLocator ? { locatorIdentity: finalLocator } : {}),
      sourceScreenKey: obs.sourceScreenKey,
      observedFieldsBefore: sanitizedBefore,
      observedFieldsAfter: sanitizedAfter,
      requiredFieldsMatched: sanitizedRequired,
      postSelectionFingerprint: postFingerprint,
      ...(sanitizedSuccess ? { successEvidence: sanitizedSuccess } : {}),
      validationStatus,
      trustedForReuse,
      updatedAt: now,
      lastSeenAt: now,
      runCount: ((existing.runCount as number) ?? 0) + 1,
      ...(isPhase2 ? { lastValidatedAt: now } : {}),
    };
    // phase2 must not downgrade validated to pending; keep validated if already validated
    if (existing.validationStatus === "validated" && !isPhase2) {
      (item as any).validationStatus = "validated";
      (item as any).trustedForReuse = true;
    }
  } else {
    item = {
      id,
      source: "runtime",
      knowledgeKind: "auth_variant",
      variantLabel: finalVariantLabel,
      ...(finalLocator ? { locatorIdentity: finalLocator } : {}),
      sourceScreenKey: obs.sourceScreenKey,
      observedFieldsBefore: sanitizedBefore,
      observedFieldsAfter: sanitizedAfter,
      requiredFieldsMatched: sanitizedRequired,
      postSelectionFingerprint: postFingerprint,
      ...(sanitizedSuccess ? { successEvidence: sanitizedSuccess } : {}),
      validationStatus,
      trustedForReuse,
      issueKey: opts.issueKey ?? "",
      runCount: 1,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      ...(isPhase2 ? { lastValidatedAt: now } : {}),
    };
  }

  // Persist: try SQL first, fallback to file
  const sqlOk = await persistToSql(appSlug, item);
  if (!sqlOk) {
    const data = readKnowledge(appSlug);
    const idx = data.items.findIndex((i) => i.id === id);
    if (idx >= 0) data.items[idx] = item;
    else data.items.push(item);
    writeKnowledge(appSlug, data);
  } else {
    // also keep file in sync via materialize already, but ensure file reflects
    const data = readKnowledge(appSlug);
    const idx = data.items.findIndex((i) => i.id === id);
    if (idx >= 0) data.items[idx] = item;
    else data.items.push(item);
    writeKnowledge(appSlug, data);
  }

  return item;
}

export function getAuthVariantKnowledge(appSlug: string, variantLabel: string, sourceScreenKey: string, locatorIdentity?: string): KnowledgeItem | null {
  const id = stableId(sourceScreenKey, variantLabel, locatorIdentity);
  const data = readKnowledge(appSlug);
  return (data.items.find((i) => i.id === id) as KnowledgeItem) ?? null;
}

export function listAuthVariantKnowledge(appSlug: string): KnowledgeItem[] {
  const data = readKnowledge(appSlug);
  return data.items.filter((i) => (i as any).knowledgeKind === "auth_variant") as KnowledgeItem[];
}
