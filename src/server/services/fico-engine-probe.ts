import { request } from "playwright";
import { getPortalCancellationEnvironment } from "./portal-comercial-request-cancellation";

/**
 * Direct call to the Portal's FICO decision engine, the same endpoint the pre-qualification screen
 * uses (POST /api/proxy/api/Procesos/Bizagi/MotorDecisionesFICO). It lets a candidate id be checked
 * against the engine before a whole UI run. The engine pulls the bureau live, so each call is a
 * real consultation: keep it for a handful of candidates, never a bulk scan.
 */
export const FICO_ENDPOINT = "/api/proxy/api/Procesos/Bizagi/MotorDecisionesFICO";
const ENDPOINT = FICO_ENDPOINT;

/** Values of the recorded Portal Comercial "Préstamos Personales Nuevos" pre-qualification. */
export type FicoFields = Record<"numeroSolicitud" | "tipoCartera" | "tipoProducto" | "reportCode" | "codigoReferente" | "plazo" | "tasa"
  | "montoSolicitadoPesos" | "mesesEnpleo" | "tipoIngreso" | "telefono", string>;

export const DEFAULT_FICO_REQUEST: FicoFields = {
  numeroSolicitud: "MPN-3214",
  tipoCartera: "5",
  tipoProducto: "24",
  reportCode: "HCI",
  codigoReferente: "844",
  plazo: "12",
  tasa: "20.15",
  montoSolicitadoPesos: "50000",
  mesesEnpleo: "72",
  tipoIngreso: "ASALARIADO",
  telefono: "829-220-2121",
};

export type FicoRequest = FicoFields & { identification: string };

export function buildFicoRequest(identification: string, overrides: Partial<FicoFields> = {}): FicoRequest {
  const digits = identification.replace(/\D/g, "");
  if (!digits) throw new Error("identification es obligatoria");
  return { ...DEFAULT_FICO_REQUEST, ...overrides, identification: digits };
}

export type FicoProductSummary = {
  product: string;
  decision: string;
  capacityNow: number | null;
  capacityFuture: number | null;
  rejectionFlags: string[];
  /** Every rule the engine reported for the product, whatever its decision ("Referido", "Pre-aprobado", ...). */
  allDecisions: string[];
};

export type FicoSummary = {
  approved: boolean;
  finalDecision: string;
  cvIncomeEstimator: number | null;
  products: FicoProductSummary[];
  /** Rules reported at participant level, outside any product. */
  participantDecisions: string[];
};

/** Approved only when the engine's final decision is not a rejection for the loan being requested. */
export function summarizeFicoResponse(payload: any, product = "Prestamo Consumo"): FicoSummary {
  const participant = payload?.participantes?.[0];
  const products: FicoProductSummary[] = (participant?.productos ?? []).map((item: any) => ({
    product: String(item?.tipoProducto ?? ""),
    decision: String(item?.finalDecision ?? ""),
    capacityNow: typeof item?.capacidadDeudaActual === "number" ? item.capacidadDeudaActual : null,
    capacityFuture: typeof item?.capacidadDeudaFutura === "number" ? item.capacidadDeudaFutura : null,
    rejectionFlags: (item?.decisiones ?? [])
      .filter((decision: any) => /rechaz/i.test(String(decision?.decision ?? "")))
      .map((decision: any) => `${decision.flag}: ${decision.razonDecision}`),
    allDecisions: (item?.decisiones ?? []).map((decision: any) => `${decision.decision}/${decision.flag}: ${decision.razonDecision}`),
  }));
  const requested = products.find((item) => item.product.toLowerCase() === product.toLowerCase());
  const income = Number(payload?.cvIncomeEstimator);
  return {
    approved: requested ? !/rechaz/i.test(requested.decision) : false,
    finalDecision: String(participant?.finalDecision ?? ""),
    cvIncomeEstimator: Number.isFinite(income) ? income : null,
    products,
    participantDecisions: (participant?.decisiones ?? []).map((decision: any) => `${decision.decision}/${decision.flag}: ${decision.razonDecision}`),
  };
}

/** Asks the engine through an open Portal session whether the cédula gets the loan (a throwaway request number is accepted). */
export async function ficoApprovesLoan(
  http: (method: "POST", path: string, options: { body: unknown }) => Promise<{ status: number; body: any }>,
  identification: string,
): Promise<{ approved: boolean; detail: string }> {
  const response = await http("POST", FICO_ENDPOINT, { body: buildFicoRequest(identification, { numeroSolicitud: "QA-PRUEBA-0001" }) });
  if (response.status !== 200) throw new Error(`Motor FICO respondió HTTP ${response.status}`);
  const summary = summarizeFicoResponse(response.body);
  const reasons = [...summary.participantDecisions, ...summary.products.flatMap((item) => item.rejectionFlags)];
  return { approved: summary.approved && !summary.participantDecisions.some((item) => /rechaz/i.test(item)), detail: reasons.slice(0, 3).join(" | ") || summary.finalDecision };
}

export async function consultFicoEngine(
  identification: string,
  overrides: Partial<FicoFields> = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<FicoSummary> {
  const config = getPortalCancellationEnvironment(env);
  if (!config.configured || !config.baseUrl) {
    throw new Error("Portal API no configurado: defina PORTAL_COMERCIAL_QA_API_BASE_URL y PORTAL_COMERCIAL_QA_API_AUTHORIZATION (o _COOKIE)");
  }
  const url = new URL(ENDPOINT, config.baseUrl);
  if (!config.allowedHosts.includes(url.hostname.toLowerCase())) throw new Error("Host no permitido para el motor FICO");
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (config.authorization) headers.Authorization = config.authorization;
  if (config.cookie) headers.Cookie = config.cookie;
  const client = await request.newContext({ ignoreHTTPSErrors: true, timeout: 60000 });
  try {
    const response = await client.post(url.toString(), { headers, data: buildFicoRequest(identification, overrides), maxRedirects: 0 });
    if (response.status() !== 200) throw new Error(`Motor FICO respondió HTTP ${response.status()}`);
    return summarizeFicoResponse(await response.json());
  } finally {
    await client.dispose();
  }
}
