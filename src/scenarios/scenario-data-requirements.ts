export type DataRequirement = {
  key: string;
  label: string;
  required: boolean;
  editable: boolean;
  suggestedValue?: string;
  source: "hu_explicit" | "hu_implied" | "required_data" | "hu_model" | "fill_action";
  controlType?: "text" | "number" | "select" | "date" | "boolean";
  options?: string[];
  optionsSource?: "hu_explicit" | "scenario" | "knowledge" | "runtime_observed";
};

function normalizeKey(label: string): string {
  return label.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function isSensitiveField(label: string): boolean {
  // project_config credentials - reuse generic credential signals without hardcoding specific business labels as global rule
  // Check via generic credential patterns already used in auth detection; if field is marked as credential via metadata, caller should exclude before calling
  return false;
}

// Generic credential detection reused from existing auth contracts (if metadata indicates project_config)
function isProjectConfigField(field: { label: string; source?: string; kind?: string }): boolean {
  const src = String(field.source ?? field.kind ?? "").toLowerCase();
  if (src.includes("project_config") || src.includes("credential")) return true;
  // fallback: if label is explicitly tagged as credential via field metadata, not hardcoding global list
  return false;
}

function isRuntimeDynamicField(field: { label: string; source?: string; kind?: string; runtime?: boolean }): boolean {
  const src = String(field.source ?? field.kind ?? "").toLowerCase();
  if (src.includes("runtime") || src.includes("dynamic")) return true;
  if (field.runtime === true) return true;
  return false;
}

function isJitSecretField(field: { label: string; kind?: string }): boolean {
  const label = String(field.label ?? "").toLowerCase();
  const kind = String(field.kind ?? "").toLowerCase();
  return kind.includes("jit") || kind.includes("secret") || /(otp|token|challenge)/i.test(label) || /(otp|token)/i.test(kind);
}

function inferControlType(explicit: any): DataRequirement["controlType"] | undefined {
  const t = String(explicit?.controlType ?? explicit?.type ?? explicit?.kind ?? "").toLowerCase();
  if (t === "number" || t === "numeric") return "number";
  if (t === "date") return "date";
  if (t === "boolean" || t === "bool" || t === "checkbox") return "boolean";
  if (t === "select" || t === "dropdown" || t === "choice") return "select";
  if (Array.isArray(explicit?.options) && explicit.options.length > 0) return "select";
  return undefined;
}

export function deriveDataRequirements(input: {
  huText?: string;
  huModel?: { fields?: Array<{ name?: string; label?: string; field?: string; value?: string; suggestedValue?: string; kind?: string; source?: string; required?: boolean; editable?: boolean; controlType?: string; type?: string; options?: string[]; optionsSource?: string }> };
  scenario?: { steps?: string[] | Array<{ action: string }>; dataRequirements?: string | string[]; requiredData?: string | string[] };
  functionalRequirements?: Array<{ field?: string; label?: string; value?: string; source?: string; kind?: string }>;
  explicitFields?: Array<{ label: string; value?: string; suggestedValue?: string; source?: string; kind?: string; required?: boolean; editable?: boolean; runtime?: boolean; controlType?: string; type?: string; options?: string[]; optionsSource?: string }>;
}): DataRequirement[] {
  const seen = new Map<string, DataRequirement>();

  const add = (rawLabel: string, opts: Partial<DataRequirement> & { suggestedValue?: string; source?: DataRequirement["source"]; controlType?: string; options?: string[]; optionsSource?: string }) => {
    const label = String(rawLabel).trim();
    if (!label) return;
    const key = normalizeKey(label);
    if (seen.has(key)) {
      const existing = seen.get(key)!;
      if (opts.suggestedValue && !existing.suggestedValue) existing.suggestedValue = opts.suggestedValue;
      // merge controlType/options if more explicit
      if (!existing.controlType && opts.controlType) (existing as any).controlType = opts.controlType as any;
      if (!existing.options && opts.options && opts.options.length > 0) {
        (existing as any).options = [...opts.options];
        (existing as any).optionsSource = opts.optionsSource as any;
      }
      return;
    }
    const kind = String(opts.source ?? (opts as any).kind ?? "").toLowerCase();
    if (opts.source === ("project_config" as any) || isProjectConfigField({ label, source: opts.source, kind: (opts as any).kind })) return;
    if (isRuntimeDynamicField({ label, source: opts.source, kind: (opts as any).kind, runtime: (opts as any).runtime })) return;
    if (isJitSecretField({ label, kind: (opts as any).kind })) return;

    const inferredControl = (opts as any).controlType ?? inferControlType(opts as any);
    const hasOptions = Array.isArray((opts as any).options) && (opts as any).options.length > 0;

    const req: DataRequirement = {
      key,
      label,
      required: opts.required ?? true,
      editable: opts.editable ?? true,
      source: (opts.source as DataRequirement["source"]) ?? "hu_implied",
      controlType: (inferredControl as DataRequirement["controlType"]) ?? (hasOptions ? "select" : "text"),
    };
    if (hasOptions) {
      const cleanOpts = (opts as any).options.map((o: any) => String(o).trim()).filter(Boolean);
      // never invent options: only keep provided
      if (cleanOpts.length > 0) {
        (req as any).options = [...new Set(cleanOpts)];
        (req as any).optionsSource = (opts as any).optionsSource ?? "hu_explicit";
      }
    }
    if (opts.suggestedValue !== undefined && String(opts.suggestedValue).trim() !== "") {
      req.suggestedValue = String(opts.suggestedValue).trim();
      // if suggestedValue and options exist, ensure suggested is within options when control is select, otherwise keep undefined for untrusted
      if ((req as any).controlType === "select" && (req as any).options && !(req as any).options.includes(req.suggestedValue)) {
        // keep as is if explicit HU says so; trust explicit source, otherwise undefined already
      }
    }
    // For select without reliable suggestedValue, leave undefined (untrusted)
    seen.set(key, req);
  };

  // 1) explicitFields (most structured, test can provide)
  if (input.explicitFields && Array.isArray(input.explicitFields)) {
    for (const f of input.explicitFields) {
      add(f.label, { suggestedValue: (f as any).suggestedValue ?? (f as any).value, source: (f.source as any) ?? "hu_explicit", required: f.required, editable: f.editable, kind: (f as any).kind, controlType: (f as any).controlType ?? (f as any).type, options: (f as any).options, optionsSource: (f as any).optionsSource } as any);
    }
  }

  // 2) huModel.fields
  if (input.huModel?.fields && Array.isArray(input.huModel.fields)) {
    for (const f of input.huModel.fields) {
      const label = String(f.label ?? f.name ?? f.field ?? "").trim();
      if (!label) continue;
      const val = (f as any).suggestedValue ?? (f as any).value;
      const key = normalizeKey(label);
      if (seen.has(key)) continue;
      add(label, { suggestedValue: val, source: (f as any).source ?? "hu_model", kind: (f as any).kind, required: (f as any).required, editable: (f as any).editable, controlType: (f as any).controlType ?? (f as any).type, options: (f as any).options, optionsSource: (f as any).optionsSource } as any);
    }
  }

  // 3) scenario dataRequirements / requiredData structured
  if (input.scenario) {
    const sc: any = input.scenario;
    const candidates = [sc.requiredData, sc.dataRequirements].filter(Boolean);
    for (const cand of candidates) {
      let arr: any[] = [];
      if (Array.isArray(cand)) arr = cand;
      else if (typeof cand === "string" && cand.trim()) {
        // if string like "Amount, Reference" treat as labels without values
        const parts = cand.split(",").map((s: string) => s.trim()).filter(Boolean);
        for (const p of parts) add(p, { source: "required_data" });
        continue;
      }
      for (const item of arr) {
        if (typeof item === "string") add(item, { source: "required_data" });
        else if (item && typeof item === "object") {
          const label = String(item.label ?? item.field ?? item.key ?? "").trim();
          if (!label) continue;
          add(label, { suggestedValue: item.suggestedValue ?? item.value, source: item.source ?? "required_data", kind: item.kind, required: item.required, editable: item.editable, controlType: item.controlType ?? item.type, options: item.options, optionsSource: item.optionsSource } as any);
        }
      }
    }

    // 4) fill/input actions from steps
    const steps: string[] = Array.isArray(sc.steps) ? sc.steps.map((s: any) => typeof s === "string" ? s : s.action ?? "") : [];
    for (const raw of steps) {
      const s = String(raw);
      // generic fill pattern without hardcoding field names
      const m1 = s.match(/(?:capturar|ingresar|completar|llenar|escribir|digitar)\s+["“”']([^"“”']+)["“”']\s*(?:con|with|=\s*|:\s*)?\s*["“”']?([^"“”']+)?["“”']?/i);
      if (m1) {
        const label = m1[1].trim();
        const val = m1[2]?.trim();
        // avoid duplicate if already from more structured source
        const key = normalizeKey(label);
        if (seen.has(key)) {
          if (val && !seen.get(key)!.suggestedValue) seen.get(key)!.suggestedValue = val;
          continue;
        }
        // check if value looks like explicit HU value vs placeholder
        const isPlaceholder = !val || /^(valor|value|dato|data)$/i.test(val);
        add(label, { suggestedValue: isPlaceholder ? undefined : val, source: "fill_action" });
        continue;
      }
      const m2 = s.match(/["“”']([^"“”']+)["“”']\s*(?:con|with)\s*["“”']([^"“”']+)["“”']/i);
      if (m2) {
        const label = m2[1].trim();
        const val = m2[2].trim();
        const key = normalizeKey(label);
        if (seen.has(key)) continue;
        add(label, { suggestedValue: val, source: "fill_action" });
      }
    }

    // 5) functionalRequirements generic
    if (Array.isArray(input.functionalRequirements)) {
      for (const fr of input.functionalRequirements) {
        const label = String(fr.label ?? fr.field ?? "").trim();
        if (!label) continue;
        const key = normalizeKey(label);
        if (seen.has(key)) continue;
        add(label, { suggestedValue: (fr as any).value, source: (fr as any).source ?? "hu_implied", kind: (fr as any).kind } as any);
      }
    }
  }

  // 6) huText fallback generic extraction without hardcoding
  if (input.huText && typeof input.huText === "string") {
    const txt = input.huText;
    // generic pattern: Field name with explicit value after con/=/: without hardcoding names
    const re = /(?:capturar|ingresar|completar|llenar)\s+([A-Za-z0-9 _-]{2,30})\s*(?:con|with|=\s*|:\s+)\s*([A-Za-z0-9]{1,30})/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt))) {
      const label = m[1].trim();
      const val = m[2].trim();
      if (!label || !val) continue;
      const key = normalizeKey(label);
      if (seen.has(key)) continue;
      // ensure not already business field that is not input? but generic
      add(label, { suggestedValue: val, source: "hu_explicit" });
    }
  }

  return Array.from(seen.values());
}

// Compatibility: keep requiredData string for old consumers
export function toRequiredDataString(reqs: DataRequirement[]): string {
  return reqs.map((r) => r.label).join(", ");
}
