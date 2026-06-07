import type { McpRouteProfile } from "./scenario-types";

const SECRET_FIELDS = new Set([
  "username",
  "password",
  "token",
  "apiKey",
  "api_key",
  "apiSecret",
  "api_secret",
  "secret",
  "otp",
  "otpSecret",
  "otp_secret",
  "jwt",
  "refreshToken",
  "refresh_token",
  "accessToken",
  "access_token",
]);

const SECRET_PATTERNS = [
  /APP_PASSWORD/i,
  /APP_USERNAME/i,
  /TESTRAIL_API_KEY/i,
  /JIRA_API_TOKEN/i,
  /OTP_SECRET/i,
  /API_KEY/i,
  /BEARER/i,
  /AUTHORIZATION/i,
];

export type AppProfilePromptContext = {
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  routeProfileName?: string;
  loginMode?: string;
  entrySteps: Array<{ action: string; target: string; when?: string }>;
  navigationHints: Record<string, string[]>;
  aliases: Record<string, string | string[]>;
  domainTerms: Record<string, string | string[]>;
  visibleControls: string[];
  present: boolean;
};

function isSecretKey(key: string): boolean {
  return SECRET_FIELDS.has(key) || SECRET_PATTERNS.some((p) => p.test(key));
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (SECRET_PATTERNS.some((p) => p.test(value))) return "[REDACTED]";
    if (value.length > 200) return value.slice(0, 200) + "...[truncated]";
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") return sanitizeObject(value as Record<string, unknown>);
  return value;
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSecretKey(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = sanitizeValue(value);
  }
  return result as T;
}

export function sanitizeForPrompt(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, "gi"), "[REDACTED]");
  }
  result = result.replace(/(password|token|secret|api[_-]?key)\s*[:=]\s*["']?\S+["']?/gi, "$1=[REDACTED]");
  return result;
}

export function buildAppProfilePromptContext(
  appSlug: string,
  options: {
    targetAppSlug?: string;
    targetAppName?: string;
    routeProfile?: McpRouteProfile | null;
    entrySteps?: Array<{ action: string; target: string; when?: string }>;
    loginMode?: string;
  },
): AppProfilePromptContext {
  const { targetAppSlug, targetAppName, routeProfile, entrySteps, loginMode } = options;

  const hasEntrySteps = entrySteps && entrySteps.length > 0;
  const hasRouteProfile = !!routeProfile && !!routeProfile.name;

  return {
    appSlug,
    targetAppSlug,
    targetAppName,
    routeProfileName: routeProfile?.name,
    loginMode,
    entrySteps: hasEntrySteps ? entrySteps! : [],
    navigationHints: hasRouteProfile ? (routeProfile!.intermediates ?? {}) : {},
    aliases: hasRouteProfile ? (routeProfile!.aliases ?? {}) : {},
    domainTerms: hasRouteProfile ? (routeProfile!.domainTerms ?? {}) : {},
    visibleControls: hasRouteProfile ? (routeProfile!.visibleControls ?? []) : [],
    present: hasEntrySteps || hasRouteProfile,
  };
}

export function formatAppProfileContext(ctx: AppProfilePromptContext): string {
  if (!ctx.present) return "";

  const parts: string[] = [];

  parts.push(`- appSlug: ${ctx.appSlug}${ctx.targetAppSlug ? `\n- targetAppSlug: ${ctx.targetAppSlug}` : ""}${ctx.targetAppName ? `\n- targetAppName: ${ctx.targetAppName}` : ""}${ctx.routeProfileName ? `\n- routeProfile: ${ctx.routeProfileName}` : ""}${ctx.loginMode ? `\n- loginMode: ${ctx.loginMode}` : ""}`);

  if (ctx.entrySteps.length > 0) {
    const formatted = ctx.entrySteps
      .map((es) => `    ${es.action} "${es.target}"${es.when ? ` (${es.when})` : ""}`)
      .join("\n");
    parts.push(`- Entry steps:\n${formatted}`);
  }

  const navKeys = Object.keys(ctx.navigationHints);
  if (navKeys.length > 0) {
    parts.push(`- Navigation hints: ${JSON.stringify(ctx.navigationHints)}`);
  }

  const aliasKeys = Object.keys(ctx.aliases);
  if (aliasKeys.length > 0) {
    parts.push(`- Aliases: ${JSON.stringify(ctx.aliases)}`);
  }

  const termKeys = Object.keys(ctx.domainTerms);
  if (termKeys.length > 0) {
    parts.push(`- Domain terms: ${JSON.stringify(ctx.domainTerms)}`);
  }

  if (ctx.visibleControls.length > 0) {
    parts.push(`- Visible controls: ${ctx.visibleControls.join(", ")}`);
  }

  return parts.join("\n");
}

export function buildEntryPathBlockFromContext(ctx: AppProfilePromptContext): string {
  if (ctx.entrySteps.length > 0) {
    const steps = ctx.entrySteps
      .filter((es) => es.action === "click")
      .map((es, i) => `${i + 1}. Clic en "${es.target}".`)
      .join("\n");
    if (!steps) return "";

    return [
      "",
      "REQUIRED ENTRY PATH:",
      "Every generated scenario must start with these steps, exactly in this order:",
      steps,
      "",
      "These entrySteps are mandatory for navigation. Do not omit them.",
      "Do not start directly inside the module.",
      "Do not assume prior navigation state.",
      "Do not generate manual login, cédula, OTP, PIN, or password steps.",
      "AuthGate/AuthFlow will resolve authentication when the flow enters through the authenticated route.",
    ].join("\n");
  }

  return "";
}

export function logAppProfileContext(ctx: AppProfilePromptContext): void {
  const fields: string[] = [
    `appProfileContext included=${ctx.present}`,
    `appSlug=${ctx.appSlug}`,
    `routeProfile present=${!!ctx.routeProfileName}`,
    `entrySteps count=${ctx.entrySteps.length}`,
    `navigationHints count=${Object.keys(ctx.navigationHints).length}`,
    `domainTerms count=${Object.keys(ctx.domainTerms).length}`,
    `visibleControls count=${ctx.visibleControls.length}`,
    `aliases count=${Object.keys(ctx.aliases).length}`,
  ];
  console.log(`[scenarios:prompt] ${fields.join(" | ")}`);
}
