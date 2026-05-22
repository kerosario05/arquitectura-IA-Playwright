import type { AuthFlowOptions, AuthFlowResult } from "../types/auth-flow.types";

const AUTH_GATE_KEYWORDS = [
  "identificación del cliente",
  "identificacion del cliente",
  "código otp",
  "codigo otp",
  "confirmar número de teléfono",
  "confirmar numero de teléfono",
  "código de verificación",
  "codigo de verificacion"
];

export type AuthGateDiagnostics = {
  detected: boolean;
  gateType: string;
  detectedAfterStep: string | undefined;
  completedBy: string | undefined;
  dataAlias: string | undefined;
  stagesCompleted: string[];
  landingDetected: string | undefined;
};

export function isLikelyAuthGate(text: string): boolean {
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return AUTH_GATE_KEYWORDS.some((keyword) => {
    const normalizedKeyword = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return normalized.includes(normalizedKeyword);
  });
}

export function buildAuthFlowSpecImport(appSlug: string): string {
  const relativePath = appSlug === "default" ? "../../flows/auth.flow" : `../../flows/auth.flow`;
  return `import { AuthFlow, setAuthFlowTestData } from '${relativePath}';`;
}

export function buildAuthFlowInstantiation(): string {
  return "  const authFlow = new AuthFlow(page);";
}

export function buildSetTestDataCallFromEnv(): string {
  return `  setAuthFlowTestData(resolvePromotedSpecAuthDataFromEnv());`;
}

export function buildAuthFlowCall(options: AuthFlowOptions): string {
  const parts: string[] = [];
  parts.push("  await authFlow.ensureAuthenticated({");
  if (options.alias) {
    parts.push(`    alias: '${options.alias}',`);
  }
  if (options.landing) {
    parts.push(`    landing: '${options.landing}',`);
  }
  parts.push("  });");
  return parts.join("\n");
}

export function buildSetTestDataCall(testDataJson: string): string {
  return `  setAuthFlowTestData(${testDataJson});`;
}
