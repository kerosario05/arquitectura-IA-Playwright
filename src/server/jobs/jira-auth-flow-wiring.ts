/** `observedStage` is set when the executor already saw a pending stage; the flow must not restart from home. */
export type JiraAuthFlow = (observedStage?: string) => Promise<{ success: boolean }>;

/**
 * Decides whether the browser port gets the profile's AuthFlow.
 * - explicit full_authentication: required; when authored credential entry is present without
 *   configured auth-gate data, loading is best-effort because the scenario owns the login steps.
 * - implicit (no authIntent) with loginMode=password: best effort, so the executor can finish a gate
 *   (e.g. OTP) that follows the classic login; load failure just means no flow.
 * - gate_observation / no_login / other modes: never loaded.
 */
export async function resolveJiraAuthFlow(input: {
  authIntent?: string;
  loginMode?: string;
  hasPasswordCredentials: boolean;
  /** The scenario already contains executable username/password fill steps. */
  hasAuthoredCredentialEntry?: boolean;
  /** Profile configures an auth gate (identification/otp): a load failure must not be swallowed. */
  hasAuthGateData?: boolean;
  load: () => Promise<JiraAuthFlow>;
}): Promise<JiraAuthFlow | undefined> {
  const explicit = input.authIntent === "full_authentication";
  const implicit = !input.authIntent && input.loginMode === "password";
  if (!explicit && !implicit) return undefined;
  try {
    return await input.load();
  } catch (error) {
    // The scenario owns the login interaction. Without configured MFA/identity data, do not
    // make execution depend on an unrelated project AuthFlow being present.
    if (explicit && input.hasAuthoredCredentialEntry && !input.hasAuthGateData) return undefined;
    if (input.hasAuthGateData) throw error;
    if (implicit || (input.loginMode === "password" && input.hasPasswordCredentials)) return undefined;
    throw error;
  }
}

// Normalized keys (lowercase, alphanumerics only). Security/transfer tokens are deliberately NOT OTP aliases.
const IDENTIFIER_ALIASES: Record<string, "rnc" | "cedula" | undefined> = {
  companyidentifier: "rnc", rnc: "rnc", cedula: "cedula", identificationnumber: undefined,
};
const FIELD_ALIASES: Record<string, string[]> = {
  username: ["username", "usuario"],
  password: ["password", "contrasena"],
  otp: ["otp", "accesscode", "verificationcode", "codigo", "codigoacceso"],
};

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

/**
 * AuthFlow reads `clients.defaultClient`; profiles may store the same fields as top-level keys,
 * dotted keys (`auth.company_identifier`) or under an `auth` object, using generic aliases
 * (rnc/usuario/contrasena/codigo...). Map them into `clients.defaultClient` without overriding an
 * existing structured client. identificationType is inferred only from rnc/cedula-style source keys.
 * Returns a copy.
 */
export function mapJiraAuthTestData(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  const data: Record<string, unknown> = { ...(raw ?? {}) };
  const clients = data.clients && typeof data.clients === "object" ? { ...(data.clients as Record<string, unknown>) } : {};
  if (clients.defaultClient) return data;
  const auth = data.auth && typeof data.auth === "object" ? (data.auth as Record<string, unknown>) : {};
  // Earlier sources win: top-level, then nested auth, then dotted `auth.*` keys.
  const dotted = Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith("auth."))
    .map(([k, v]) => [k.slice(5), v]));
  const sources = [data, auth, dotted].map(s => Object.entries(s).map(([k, v]) => [normalizeKey(k), str(v)] as const));
  const pick = (aliases: string[]) => {
    for (const source of sources) for (const [k, v] of source) if (v && aliases.includes(k)) return { k, v };
    return undefined;
  };

  const client: Record<string, string> = {};
  const id = pick(Object.keys(IDENTIFIER_ALIASES));
  if (id) {
    client.identificationNumber = id.v;
    const type = pick(["identificationtype"])?.v ?? IDENTIFIER_ALIASES[id.k];
    if (type) client.identificationType = type;
  }
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const hit = pick(aliases);
    if (hit) client[field] = hit.v;
  }
  if (!client.identificationNumber && !client.otp) return data;
  clients.defaultClient = client;
  return { ...data, clients };
}

export function hasJiraAuthGateData(mapped: Record<string, unknown>): boolean {
  const client = (mapped.clients as Record<string, Record<string, unknown>> | undefined)?.defaultClient;
  return Boolean(client && (client.identificationNumber || client.otp));
}
