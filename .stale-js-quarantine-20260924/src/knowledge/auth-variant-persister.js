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
exports.persistAuthVariant = persistAuthVariant;
exports.getAuthVariantKnowledge = getAuthVariantKnowledge;
exports.listAuthVariantKnowledge = listAuthVariantKnowledge;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const sql_connection_1 = require("../db/sql-connection");
const project_materializer_1 = require("../db/project-materializer");
const SENSITIVE_RE = /(password|passwd|pwd|contrase|token|otp|credential|secret)/i;
function sanitizeFields(fields) {
    return fields
        .map((f) => String(f).trim())
        .filter((f) => f.length > 0)
        // drop any field that looks like containing secret value
        .filter((f) => !SENSITIVE_RE.test(f))
        // also strip values after colon to keep only label
        .map((f) => f.split(":")[0].trim())
        .filter((f) => f.length > 0 && !SENSITIVE_RE.test(f));
}
function sanitizeEvidence(ev) {
    if (!ev)
        return undefined;
    const trimmed = String(ev).trim();
    if (!trimmed)
        return undefined;
    if (SENSITIVE_RE.test(trimmed))
        return undefined;
    return trimmed;
}
function stableId(sourceScreenKey, variantLabel, locatorIdentity) {
    const normalizedLabel = variantLabel.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
    const keyPart = locatorIdentity?.trim() ? `loc:${locatorIdentity.trim()}` : `lbl:${normalizedLabel}`;
    const hash = (0, node_crypto_1.createHash)("sha256").update(`${sourceScreenKey}:${keyPart}`).digest("hex").slice(0, 12);
    return `av_${hash}`;
}
function knowledgePath(appSlug) {
    return path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
}
function readKnowledge(appSlug) {
    const kp = knowledgePath(appSlug);
    try {
        if (fs.existsSync(kp)) {
            const parsed = JSON.parse(fs.readFileSync(kp, "utf-8"));
            return parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
        }
    }
    catch { }
    return { items: [] };
}
function writeKnowledge(appSlug, data) {
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
async function persistToSql(appSlug, item) {
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
                // update preserves trusted/validation logic from item
                data.items[idx] = { ...existing, ...item, createdAt: existing.createdAt, runCount: (existing.runCount ?? 0) + 1 };
            }
            else {
                data.items.push(item);
            }
            await conn.query("UPDATE dbo.ProjectKnowledge SET knowledgeJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?", [Buffer.from(JSON.stringify(data), "utf16le"), projectId]);
            return true;
        });
        if (result) {
            try {
                await (0, project_materializer_1.materializeProjectRuntime)({ slug: appSlug });
            }
            catch { }
        }
        return result;
    }
    catch {
        return false;
    }
}
function buildPostFingerprint(observedFieldsAfter) {
    const sorted = [...observedFieldsAfter].map((s) => s.trim().toLowerCase()).sort().join("|");
    return (0, node_crypto_1.createHash)("sha256").update(sorted).digest("hex").slice(0, 12);
}
async function persistAuthVariant(appSlug, obs, opts) {
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
    const existing = existingData.items.find((i) => i.id === id);
    let item;
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
            runCount: (existing.runCount ?? 0) + 1,
            ...(isPhase2 ? { lastValidatedAt: now } : {}),
        };
        // phase2 must not downgrade validated to pending; keep validated if already validated
        if (existing.validationStatus === "validated" && !isPhase2) {
            item.validationStatus = "validated";
            item.trustedForReuse = true;
        }
    }
    else {
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
        if (idx >= 0)
            data.items[idx] = item;
        else
            data.items.push(item);
        writeKnowledge(appSlug, data);
    }
    else {
        // also keep file in sync via materialize already, but ensure file reflects
        const data = readKnowledge(appSlug);
        const idx = data.items.findIndex((i) => i.id === id);
        if (idx >= 0)
            data.items[idx] = item;
        else
            data.items.push(item);
        writeKnowledge(appSlug, data);
    }
    return item;
}
function getAuthVariantKnowledge(appSlug, variantLabel, sourceScreenKey, locatorIdentity) {
    const id = stableId(sourceScreenKey, variantLabel, locatorIdentity);
    const data = readKnowledge(appSlug);
    return data.items.find((i) => i.id === id) ?? null;
}
function listAuthVariantKnowledge(appSlug) {
    const data = readKnowledge(appSlug);
    return data.items.filter((i) => i.knowledgeKind === "auth_variant");
}
