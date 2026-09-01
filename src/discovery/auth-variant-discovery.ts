import { persistAuthVariant } from "../knowledge/auth-variant-persister";
import type { RuntimeUiSnapshot } from "../knowledge/runtime-knowledge-extractor";

export type VariantCandidate = {
  variantLabel: string;
  locatorIdentity?: string;
  sourceScreenKey: string;
  role?: string;
  dataToggle?: string;
  ariaSelected?: string | null;
  ariaPressed?: string | null;
  parentRole?: string | null;
  parentDataToggleGroup?: boolean;
};

const SAFE_ROLES = new Set(["tab", "radio", "option", "combobox", "listbox", "menuitemradio", "menuitemcheckbox", "switch"]);

function normalizeField(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

export function isSafeVariantCandidate(ctrl: { role?: string; label?: string; locatorIdentity?: string; dataToggle?: string; ariaSelected?: string | null; ariaPressed?: string | null; parentRole?: string | null }): boolean {
  const role = (ctrl.role ?? "").toLowerCase();
  if (SAFE_ROLES.has(role)) return true;
  const dt = (ctrl as any).dataToggle?.toString().toLowerCase() ?? "";
  if (dt === "tab" || dt === "pill" || dt === "button") return true;
  if (ctrl.ariaSelected !== null && ctrl.ariaSelected !== undefined) return true;
  if (ctrl.ariaPressed !== null && ctrl.ariaPressed !== undefined) return true;
  const pr = (ctrl.parentRole ?? "").toLowerCase();
  if (pr === "tablist" || pr === "radiogroup") return true;
  // parent has data-toggle group (e.g., client-login-btngroup with children data-toggle=tab) -> check via flag
  if ((ctrl as any).parentDataToggleGroup) return true;
  return false;
}

export function getRequiredFieldsFromHuDeclared(huDeclaredItems: Array<{ actionTarget?: string; sourceText?: string; category?: string; scope?: string; kind?: string; classification?: string }>): string[] {
  const fields: string[] = [];
  for (const item of huDeclaredItems) {
    const cat = String((item as any).category ?? "").toLowerCase();
    const scope = String((item as any).scope ?? "").toLowerCase();
    const kind = String((item as any).kind ?? "").toLowerCase();
    const classification = String((item as any).classification ?? "").toLowerCase();
    const isAuth = cat.includes("auth") || scope.includes("auth") || kind.includes("auth") || classification.includes("auth") || cat.includes("input") || scope.includes("input");
    if (!isAuth) continue;
    if ((item as any).actionTarget) fields.push(String((item as any).actionTarget).trim());
  }
  return [...new Set(fields.filter(Boolean))];
}

export type RequiredAuthContext = {
  huDeclaredItems?: Array<{ actionTarget?: string; sourceText?: string; category?: string; scope?: string; kind?: string; classification?: string }>;
  scenario?: any;
  huModel?: any;
  functionalRequirements?: any[];
};

function isAuthKindMeta(v: any): boolean {
  const s = String(v ?? "").toLowerCase();
  return s.includes("auth") || s.includes("credential") || s.includes("input");
}

function isBusinessScopeMeta(v: any): boolean {
  const s = String(v ?? "").toLowerCase();
  return s.includes("business") || s.includes("transaction");
}

export function deriveRequiredAuthFields(ctx: RequiredAuthContext & { explicitFields?: any[] }): string[] {
  // 0) explicitFields direct (used by tests, already classified as auth)
  const explicit = (ctx as any).explicitFields as any[] | undefined;
  if (explicit && Array.isArray(explicit) && explicit.length > 0) {
    const vals: string[] = [];
    for (const f of explicit) {
      const label = String(f.label ?? f.field ?? f.key ?? "").trim();
      if (!label) continue;
      const scope = String(f.scope ?? f.kind ?? f.category ?? "").toLowerCase();
      const isBusiness = isBusinessScopeMeta(scope);
      if (isBusiness) continue;
      // if scope indicates auth or no scope but explicitly provided as auth, include
      const isAuth = isAuthKindMeta(scope) || String(f.source ?? "").toLowerCase().includes("auth") || !scope;
      if (isAuth) vals.push(label);
    }
    if (vals.length > 0) return [...new Set(vals)];
  }
  // 1) HuModel.fields with structured classification
  if (ctx.huModel?.fields && Array.isArray(ctx.huModel.fields)) {
    const authFields: string[] = [];
    for (const f of ctx.huModel.fields) {
      const kind = String(f.kind ?? f.category ?? f.type ?? f.usage ?? f.scope ?? "").toLowerCase();
      const scope = String(f.scope ?? "").toLowerCase();
      const classification = String(f.classification ?? "").toLowerCase();
      const isAuth = kind.includes("auth") || scope.includes("auth") || classification.includes("auth") || kind.includes("input") || kind.includes("credential");
      const isBusiness = isBusinessScopeMeta(kind) || isBusinessScopeMeta(scope) || isBusinessScopeMeta(classification);
      if (isAuth && !isBusiness) {
        const label = String(f.name ?? f.label ?? f.field ?? "").trim();
        if (label) authFields.push(label);
      }
    }
    if (authFields.length > 0) return [...new Set(authFields)];
  }

  // 2) scenario structured fields with metadata (auth vs business via scope/kind)
  if (ctx.scenario) {
    const s: any = ctx.scenario;
    const structuredLists: Array<{ arr: any; getMeta: (item:any)=>any }> = [
      { arr: s.authFields, getMeta: (x:any)=>x },
      { arr: s.inputFields, getMeta: (x:any)=>x },
      { arr: s.requiredFields, getMeta: (x:any)=>x },
      { arr: s.requiredAuthFields, getMeta: (x:any)=>x },
      { arr: s.huFields, getMeta: (x:any)=>x },
    ];
    for (const {arr, getMeta} of structuredLists) {
      if (!Array.isArray(arr) || arr.length===0) continue;
      const filtered: string[] = [];
      for (const item of arr) {
        if (typeof item === "string") {
          // string list without metadata: cannot determine scope, skip unless we know it's auth list
          // For authFields list we assume all are auth
          if (arr === s.authFields || arr === s.requiredAuthFields) filtered.push(String(item).trim());
          continue;
        }
        const meta = getMeta(item);
        const label = String(item.label ?? item.field ?? item.key ?? item.name ?? "").trim();
        if (!label) continue;
        const scope = String(item.scope ?? item.kind ?? item.category ?? meta?.scope ?? meta?.kind ?? "").toLowerCase();
        const isAuth = isAuthKindMeta(item.scope) || isAuthKindMeta(item.kind) || isAuthKindMeta(item.category) || isAuthKindMeta(scope);
        const isBusiness = isBusinessScopeMeta(item.scope) || isBusinessScopeMeta(item.kind) || isBusinessScopeMeta(item.category) || isBusinessScopeMeta(scope);
        if (isAuth && !isBusiness) filtered.push(label);
        else if (!isBusiness && (arr === s.authFields || arr === s.requiredAuthFields)) filtered.push(label);
      }
      if (filtered.length>0) return [...new Set(filtered.filter(Boolean))];
    }

    // 3) scenario.dataRequirements / requiredData structured via metadata source/kind/category/scope/phase/classification (not label)
    const dataReqCandidates = [s.requiredData, s.dataRequirements, s.requiredDataJson];
    for (const cand of dataReqCandidates) {
      if (!cand) continue;
      let arr: any[] = [];
      if (Array.isArray(cand)) arr = cand;
      else if (typeof cand === "string") {
        try { const p = JSON.parse(cand); if (Array.isArray(p)) arr = p; } catch { continue; }
      } else if (typeof cand === "object") continue;
      const filtered: string[] = [];
      for (const item of arr) {
        if (typeof item === "string") continue; // string without metadata cannot be classified as auth
        const label = String(item.label ?? item.field ?? item.key ?? "").trim();
        if (!label) continue;
        const source = String(item.source ?? "").toLowerCase();
        const kind = String(item.kind ?? "").toLowerCase();
        const category = String(item.category ?? "").toLowerCase();
        const scope = String(item.scope ?? "").toLowerCase();
        const phase = String(item.phase ?? "").toLowerCase();
        const classification = String(item.classification ?? "").toLowerCase();
        const meta = `${source} ${kind} ${category} ${scope} ${phase} ${classification}`;
        const isAuth = isAuthKindMeta(source) || isAuthKindMeta(kind) || isAuthKindMeta(category) || isAuthKindMeta(scope) || isAuthKindMeta(phase) || isAuthKindMeta(classification);
        const isBusiness = isBusinessScopeMeta(source) || isBusinessScopeMeta(kind) || isBusinessScopeMeta(category) || isBusinessScopeMeta(scope) || isBusinessScopeMeta(phase) || isBusinessScopeMeta(classification);
        if (isAuth && !isBusiness) filtered.push(label);
      }
      if (filtered.length>0) return [...new Set(filtered)];
    }

    // 4) steps/actions structured: action/type/kind + phase/scope
    if (Array.isArray(s.steps)) {
      const authStepFields: string[] = [];
      for (const st of s.steps) {
        const obj: any = typeof st === "string" ? { action: st } : st;
        const action = String(obj.action ?? obj.type ?? obj.kind ?? "").toLowerCase();
        const kind = String(obj.kind ?? obj.type ?? "").toLowerCase();
        const phase = String(obj.phase ?? obj.scope ?? "").toLowerCase();
        const isFill = kind.includes("fill") || kind.includes("input") || action.includes("fill") || action.includes("input");
        const isAuthScope = phase.includes("auth") || String(obj.scope ?? "").toLowerCase().includes("auth");
        if (isFill && isAuthScope) {
          const label = String(obj.target ?? obj.field ?? obj.label ?? "").trim();
          // try to get target from action string via structured parser result if available
          const structuredTarget = obj.actionTarget ?? obj.target;
          const finalLabel = label || String(structuredTarget ?? "").trim();
          if (finalLabel) authStepFields.push(finalLabel);
        }
      }
      if (authStepFields.length>0) return [...new Set(authStepFields)];
    }

    // 5) functionalRequirementAccounts with category/scope
    if (Array.isArray(ctx.functionalRequirements)) {
      const filtered: string[] = [];
      for (const r of ctx.functionalRequirements) {
        const cat = String(r.category ?? "").toLowerCase();
        const scope = String((r as any).scope ?? "").toLowerCase();
        const kind = String((r as any).kind ?? "").toLowerCase();
        const isAuth = cat.includes("auth") || scope.includes("auth") || kind.includes("auth") || cat.includes("input");
        const isBusiness = isBusinessScopeMeta(cat) || isBusinessScopeMeta(scope) || isBusinessScopeMeta(kind);
        if (isAuth && !isBusiness) {
          const label = String(r.actionTarget ?? (r as any).sourceText ?? "").trim();
          if (label) filtered.push(label);
        }
      }
      if (filtered.length>0) return [...new Set(filtered)];
    }
  }

  // 6) hu_declared only if already classified sufficiently
  if (ctx.huDeclaredItems && ctx.huDeclaredItems.length > 0) {
    const legacy = getRequiredFieldsFromHuDeclared(ctx.huDeclaredItems);
    if (legacy.length > 0) return legacy;
  }

  return [];
}

export function computeRequiredFieldsMatched(requiredFields: string[], observedFieldsAfter: string[]): string[] {
  const normAfter = observedFieldsAfter.map(normalizeField);
  const matched: string[] = [];
  for (const req of requiredFields) {
    const normReq = normalizeField(req);
    if (normAfter.includes(normReq)) matched.push(req);
  }
  return matched;
}

export function isVariantMatch(requiredFields: string[], observedFieldsAfter: string[]): boolean {
  if (requiredFields.length === 0) return false;
  const matched = computeRequiredFieldsMatched(requiredFields, observedFieldsAfter);
  return matched.length === requiredFields.length;
}

export function hasObservableChange(before: string[], after: string[]): boolean {
  const b = new Set(before.map(normalizeField));
  const a = new Set(after.map(normalizeField));
  if (b.size !== a.size) return true;
  for (const v of a) if (!b.has(v)) return true;
  return false;
}

// Pure selection logic for tests: given before fields and candidate after fields, decide which to persist as pending
export function selectPendingVariants(
  requiredFields: string[],
  observedFieldsBefore: string[],
  candidates: Array<{ variantLabel: string; locatorIdentity?: string; sourceScreenKey: string; observedFieldsAfter: string[]; postSelectionFingerprint?: string; role?: string; dataToggle?: string; ariaSelected?: string | null; ariaPressed?: string | null; parentRole?: string | null }>
): Array<{ variantLabel: string; locatorIdentity?: string; sourceScreenKey: string; observedFieldsAfter: string[]; requiredFieldsMatched: string[] }> {
  const result: Array<any> = [];
  for (const c of candidates) {
    const safe = isSafeVariantCandidate({ role: c.role, label: c.variantLabel, locatorIdentity: c.locatorIdentity, dataToggle: (c as any).dataToggle, ariaSelected: (c as any).ariaSelected, ariaPressed: (c as any).ariaPressed, parentRole: (c as any).parentRole });
    if (!safe) continue;
    if (!hasObservableChange(observedFieldsBefore, c.observedFieldsAfter)) continue;
    if (!isVariantMatch(requiredFields, c.observedFieldsAfter)) continue;
    const matched = computeRequiredFieldsMatched(requiredFields, c.observedFieldsAfter);
    result.push({
      variantLabel: c.variantLabel,
      locatorIdentity: c.locatorIdentity,
      sourceScreenKey: c.sourceScreenKey,
      observedFieldsAfter: c.observedFieldsAfter,
      requiredFieldsMatched: matched,
    });
  }
  // If multiple candidates satisfy exactly the same, ambiguous → no arbitrary selection
  if (result.length > 1) {
    const allFull = result.every((r) => r.requiredFieldsMatched.length === requiredFields.length);
    if (allFull) return [];
  }
  return result;
}

export async function discoverAndPersistPendingVariant(
  appSlug: string,
  snapshotBefore: RuntimeUiSnapshot,
  requiredFields: string[],
  deps: {
    getCandidates: (snap: RuntimeUiSnapshot) => VariantCandidate[];
    clickCandidate: (candidate: VariantCandidate) => Promise<RuntimeUiSnapshot | null>;
    restoreState: () => Promise<RuntimeUiSnapshot | null>;
  }
): Promise<{ persisted: number; attempted: number; failClosed: boolean; ambiguous?: boolean }> {
  if (requiredFields.length === 0) return { persisted: 0, attempted: 0, failClosed: true };
  const observedFieldsBefore = snapshotBefore.inputLabels ?? [];
  const rawCandidates = deps.getCandidates(snapshotBefore);
  const safeCandidates = rawCandidates.filter((c) => isSafeVariantCandidate(c as any));
  if (safeCandidates.length === 0) {
    return { persisted: 0, attempted: 0, failClosed: true };
  }
  // First phase: evaluate all safe candidates without persisting to detect ambiguous full matches
  const tentative: Array<{ cand: VariantCandidate; afterSnap: RuntimeUiSnapshot; matched: string[] }> = [];
  let attempted = 0;
  for (const cand of safeCandidates) {
    attempted++;
    const afterSnap = await deps.clickCandidate(cand);
    if (!afterSnap) {
      const restored = await deps.restoreState();
      if (!restored) return { persisted: 0, attempted, failClosed: true };
      continue;
    }
    const observedFieldsAfter = afterSnap.inputLabels ?? [];
    const hasChange = hasObservableChange(observedFieldsBefore, observedFieldsAfter);
    const matched = computeRequiredFieldsMatched(requiredFields, observedFieldsAfter);
    const isMatch = matched.length === requiredFields.length && hasChange;
    if (isMatch) tentative.push({ cand, afterSnap, matched });
    const restored = await deps.restoreState();
    if (!restored) return { persisted: 0, attempted, failClosed: true };
  }
  if (tentative.length === 0) return { persisted: 0, attempted, failClosed: true };
  if (tentative.length > 1) {
    // ambiguous: multiple candidates satisfy exactly → no arbitrary persist
    return { persisted: 0, attempted, failClosed: true, ambiguous: true };
  }
  // Exactly one matching candidate → persist as pending
  const winner = tentative[0];
  await persistAuthVariant(
    appSlug,
    {
      variantLabel: winner.cand.variantLabel,
      locatorIdentity: winner.cand.locatorIdentity,
      sourceScreenKey: winner.cand.sourceScreenKey,
      observedFieldsBefore,
      observedFieldsAfter: winner.afterSnap.inputLabels ?? [],
      requiredFieldsMatched: winner.matched,
      postSelectionFingerprint: winner.afterSnap.screenKey,
    },
    { phase: 1 }
  );
  return { persisted: 1, attempted, failClosed: false };
}
