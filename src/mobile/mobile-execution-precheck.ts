import type { MobileStep } from "./mobile-step-types";
import { loadMobileRouteProfile } from "./mobile-route-profile";

function normalizeSignalToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

type MobileExecutionSignals = {
  successSignals: string[];
  rejectionSignals: string[];
  validationSignals: string[];
  technicalErrorSignals: string[];
  inductionActions: string[];
};

/**
 * Non-blocking diagnostic about a scenario's functional data profile. Functional data
 * profiles are an OPTIONAL source of preloaded values — their absence or incomplete
 * resolution never makes a scenario non-automatable; it only means the user must supply
 * data manually (dataOverrides) before execution.
 */
export type FunctionalDataDiagnostic =
  | { status: "resolved" }
  | { status: "manual_data_required"; reasonCode: "missing_functional_data_profile" | "unresolved_functional_test_data"; detail: string };

export type ScenarioPrecheckResult =
  | { blocked: false; functionalData?: FunctionalDataDiagnostic }
  | { blocked: true; reasonCode: "non_executable_precondition"; detail: "technical_error_not_inducible" };

export function resolveMobileExecutionSignals(appSlug?: string): MobileExecutionSignals {
  const defaults: MobileExecutionSignals = {
    successSignals: ["otp", "codigo de verificacion", "codigo de validacion"],
    rejectionSignals: ["no fue posible validar", "portal de ventas", "no se permite continuar"],
    validationSignals: ["datos de contacto", "correo electronico", "numero de telefono"],
    technicalErrorSignals: ["inconveniente tecnico", "ocurrio un inconveniente tecnico", "reintentar"],
    inductionActions: ["simular desconexion", "forzar error tecnico", "inducir error tecnico", "deshabilitar red"],
  };
  if (!appSlug) return defaults;
  const profile = loadMobileRouteProfile(appSlug);
  const signals = (profile as unknown as { executionSignals?: Partial<MobileExecutionSignals> })?.executionSignals;
  if (!signals) return defaults;
  return {
    successSignals: signals.successSignals?.length ? signals.successSignals : defaults.successSignals,
    rejectionSignals: signals.rejectionSignals?.length ? signals.rejectionSignals : defaults.rejectionSignals,
    validationSignals: signals.validationSignals?.length ? signals.validationSignals : defaults.validationSignals,
    technicalErrorSignals: signals.technicalErrorSignals?.length ? signals.technicalErrorSignals : defaults.technicalErrorSignals,
    inductionActions: signals.inductionActions?.length ? signals.inductionActions : defaults.inductionActions,
  };
}

function scenarioRequiresTechnicalErrorInduction(steps: MobileStep[], signals: MobileExecutionSignals, contextText?: string): boolean {
  const context = contextText ? normalizeSignalToken(contextText) : "";
  return steps.some((step) => {
    const haystack = normalizeSignalToken(`${step.description ?? ""} ${step.target?.value ?? ""} ${context}`);
    return signals.technicalErrorSignals.some((signal) => haystack.includes(normalizeSignalToken(signal)));
  });
}

function scenarioHasTechnicalInductionAction(steps: MobileStep[], signals: MobileExecutionSignals): boolean {
  return steps.some((step) => {
    const haystack = normalizeSignalToken(`${step.description ?? ""} ${step.target?.value ?? ""} ${step.value ?? ""}`);
    return signals.inductionActions.some((signal) => haystack.includes(normalizeSignalToken(signal)));
  });
}

export function evaluateScenarioPrecheck(
  steps: MobileStep[],
  appSlug?: string,
  contextText?: string,
  requiredDataProfile?: string,
): ScenarioPrecheckResult {
  const executionSignals = resolveMobileExecutionSignals(appSlug);
  if (scenarioRequiresTechnicalErrorInduction(steps, executionSignals, contextText) && !scenarioHasTechnicalInductionAction(steps, executionSignals)) {
    return {
      blocked: true,
      reasonCode: "non_executable_precondition",
      detail: "technical_error_not_inducible",
    };
  }
  if (requiredDataProfile) {
    return { blocked: false, functionalData: evaluateFunctionalDataProfile(appSlug, requiredDataProfile) };
  }
  return { blocked: false };
}

type FunctionalDataProfile = { dataRefs: Record<string, string> };

export function resolveFunctionalDataProfile(appSlug: string | undefined, profileName: string): FunctionalDataProfile | null {
  if (!appSlug) return null;
  const profile = loadMobileRouteProfile(appSlug);
  const profiles = (profile as unknown as { functionalDataProfiles?: Record<string, FunctionalDataProfile> })?.functionalDataProfiles;
  if (!profiles) return null;
  return profiles[profileName] ?? null;
}

function loadTestData(): Record<string, unknown> {
  const raw = process.env.APP_TEST_DATA_JSON;
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // env not configured / malformed — every dataRef will resolve as unresolved
  }
  return {};
}

function resolveTestDataRef(dataRef: string, testData: Record<string, unknown>): string | undefined {
  const trimmed = dataRef.trim();
  if (!trimmed) return undefined;
  const segments = trimmed.split(".");
  let current: unknown = testData;
  for (const segment of segments) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      current = undefined;
      break;
    }
  }
  if (current === undefined || current === null) return undefined;
  if (typeof current === "object") return undefined;
  return String(current);
}

function evaluateFunctionalDataProfile(appSlug: string | undefined, profileName: string): FunctionalDataDiagnostic {
  const profile = resolveFunctionalDataProfile(appSlug, profileName);
  if (!profile) {
    return { status: "manual_data_required", reasonCode: "missing_functional_data_profile", detail: profileName };
  }
  const testData = loadTestData();
  const unresolved = Object.values(profile.dataRefs).filter((dataRef) => resolveTestDataRef(dataRef, testData) === undefined);
  if (unresolved.length > 0) {
    return { status: "manual_data_required", reasonCode: "unresolved_functional_test_data", detail: unresolved.join(",") };
  }
  return { status: "resolved" };
}
