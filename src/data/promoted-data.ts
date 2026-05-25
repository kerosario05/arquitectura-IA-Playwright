import fs from "node:fs";
import path from "node:path";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { DataContext, DataContextEntry } from "./data-context";
import { autoGenerateTestData } from "./auto-test-data-generator";

export type PromotedDataSource = "env" | "app_test_data" | "auto_generated" | "alias" | "fixture" | "unknown";

export type PromotedDataManifestEntry = {
  key: string;
  source: PromotedDataSource;
  fieldName: string;
  stepIndex: number;
  valueType: "string" | "number" | "boolean" | "unknown";
  sensitive: boolean;
  demoSafe: boolean;
  required: boolean;
  maskedValue: string;
  value?: string;
};

export type PromotedDataManifest = {
  version: "1.0";
  generatedAt: string;
  entries: PromotedDataManifestEntry[];
};

const SENSITIVE_HINTS = /(password|pass|secret|token|api[_ -]?key|otp|pin|cvv|card[_ -]?number)/i;

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

export function isSensitiveDataKey(key: string): boolean {
  return SENSITIVE_HINTS.test(normalize(key));
}

export function maskValue(value: string, sensitive: boolean): string {
  if (!value) return "";
  if (!sensitive) return value.length > 64 ? `${value.slice(0, 16)}...(${value.length})` : value;
  if (value.length <= 4) return "***";
  return `${"*".repeat(Math.min(8, value.length - 2))}${value.slice(-2)}`;
}

function inferSource(source: DataContextEntry["source"] | undefined): PromotedDataSource {
  if (!source) return "unknown";
  if (source === "environment_variable" || source === "app_username" || source === "app_password") return "env";
  if (source === "test_data") return "app_test_data";
  if (source === "test_data_alias") return "alias";
  if (source === "auto_generated") return "auto_generated";
  if (source === "fixture") return "fixture";
  return "unknown";
}

function canPersistValue(entry: { sensitive: boolean; demoSafe: boolean }): boolean {
  if (entry.sensitive) return false;
  return entry.demoSafe;
}

function findFieldName(step: ExecutionPlan["steps"][number]): string {
  if (!step.target || step.target === "APP_BASE_URL") return "";
  return step.target.name ?? step.target.value ?? step.target.role ?? "";
}

function dataTypeOf(value: unknown): PromotedDataManifestEntry["valueType"] {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "unknown";
}

export function buildPromotedDataManifest(plan: ExecutionPlan, dataContext: DataContext): PromotedDataManifest {
  const entries: PromotedDataManifestEntry[] = [];
  const dataIndex = new Map(dataContext.entries.map((entry) => [normalize(entry.key), entry]));
  const requiredMap = new Map(plan.requiredData.map((item) => [normalize(item.key), item]));

  for (const step of plan.steps) {
    if (step.action !== "fill" && step.action !== "select" && step.action !== "press") continue;
    const key = step.valueKey?.trim();
    if (!key) continue;
    const ctxEntry = dataIndex.get(normalize(key));
    const requiredRef = requiredMap.get(normalize(key));
    const sensitive = requiredRef?.sensitive ?? ctxEntry?.sensitive ?? isSensitiveDataKey(key);
    const demoSafe = !sensitive;
    const value = ctxEntry?.value;
    entries.push({
      key,
      source: inferSource(ctxEntry?.source),
      fieldName: findFieldName(step),
      stepIndex: step.index,
      valueType: dataTypeOf(value),
      sensitive,
      demoSafe,
      required: requiredRef?.required ?? true,
      maskedValue: maskValue(value ?? "", sensitive),
      value: value && canPersistValue({ sensitive, demoSafe }) ? value : undefined
    });
  }

  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    entries
  };
}

export function savePromotedDataManifestSync(filePath: string, manifest: PromotedDataManifest): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf-8");
}

export function loadPromotedDataManifestSync(filePath: string): PromotedDataManifest | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as PromotedDataManifest;
    if (!parsed || !Array.isArray(parsed.entries)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export type PromotedDataContext = DataContext & {
  diagnostics: {
    hydratedFromManifestKeys: string[];
    generatedFallbackKeys: string[];
  };
};

function toMap(entries: DataContextEntry[]): Map<string, DataContextEntry> {
  return new Map(entries.map((entry) => [normalize(entry.key), entry]));
}

export function buildPromotedDataContext(options: {
  baseDataContext: DataContext;
  manifest?: PromotedDataManifest;
  testDataProfile?: string;
  autoGenerateTestData?: boolean;
  autoGenerateSensitiveData?: boolean;
}): PromotedDataContext {
  const map = toMap(options.baseDataContext.entries);
  const hydratedFromManifestKeys: string[] = [];
  const generatedFallbackKeys: string[] = [];
  const profile = (options.testDataProfile ?? "qa").toLowerCase();
  const allowDemoFallback = options.autoGenerateTestData === true && (profile === "demo" || profile === "ecommerce" || profile === "qa");

  for (const item of options.manifest?.entries ?? []) {
    const nKey = normalize(item.key);
    const existing = map.get(nKey);
    if (!existing && item.value) {
      map.set(nKey, { key: item.key, value: item.value, source: "promoted_manifest", sensitive: item.sensitive });
      hydratedFromManifestKeys.push(item.key);
      continue;
    }
    if (!existing && item.required && allowDemoFallback && item.demoSafe) {
      const generated = autoGenerateTestData(item.key, item.fieldName, "promoted_spec_hydration", {
        enabled: true,
        profile: profile as any,
        generateSensitiveData: options.autoGenerateSensitiveData === true
      });
      if (generated.generated && generated.value) {
        map.set(nKey, { key: item.key, value: generated.value, source: "auto_generated", sensitive: Boolean(generated.sensitive) });
        generatedFallbackKeys.push(item.key);
      }
    }
  }

  const entries = Array.from(map.values());
  const sensitiveCount = entries.filter((entry) => entry.sensitive).length;
  return {
    entries,
    counts: {
      total: entries.length,
      sensitive: sensitiveCount,
      nonSensitive: entries.length - sensitiveCount
    },
    diagnostics: {
      hydratedFromManifestKeys,
      generatedFallbackKeys
    }
  };
}

export function requirePromotedData(
  dataContext: { entries: Array<{ key: string; value: string }> },
  key: string,
  meta?: { fieldName?: string; stepIndex?: number }
): string {
  const nKey = normalize(key);
  const found = dataContext.entries.find((entry) => normalize(entry.key) === nKey);
  if (!found || !found.value || found.value.trim().length === 0) {
    const fieldMeta = meta?.fieldName ? ` field="${meta.fieldName}"` : "";
    const stepMeta = meta?.stepIndex !== undefined ? ` stepIndex=${meta.stepIndex}` : "";
    throw new Error(`Missing required promoted data key "${key}".${fieldMeta}${stepMeta}`.trim());
  }
  return found.value;
}

export function toSafeTsVariableName(key: string): string {
  const normalized = key
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.replace(/^[^a-zA-Z_$]+/, ""))
    .filter(Boolean);

  if (normalized.length === 0) return "dataValue";
  const [first, ...rest] = normalized;
  const camel = `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest.map((p) => `${p.charAt(0).toUpperCase()}${p.slice(1)}`).join("")}`;
  return /^[A-Za-z_$]/.test(camel) ? camel : `data${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

export function buildDataKeyVariableMap(keys: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const usedNames = new Map<string, number>();
  for (const key of keys) {
    if (map.has(key)) continue;
    const base = toSafeTsVariableName(key);
    const current = usedNames.get(base) ?? 0;
    const name = current === 0 ? base : `${base}${current + 1}`;
    usedNames.set(base, current + 1);
    map.set(key, name);
  }
  return map;
}
