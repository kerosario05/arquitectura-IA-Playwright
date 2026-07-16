/**
 * Passive HU-Driven Route Evidence
 * Analyzes Jira HU to detect business intent, product category, access mode
 * Returns compact evidence to inject into prompt for domain-coherent scenario generation
 */

export interface HUEvidence {
  businessIntent: string; // balance_inquiry, account_statement, product_payment, etc.
  productCategory: string; // term_deposit, credit_card, cash_account, loan
  accessMode: "public" | "private";
  allowedTerms: string[];
  blockedTerms: string[];
  labelHints: string[];
  mcpStepRules: string[];
  gaps: string[];
}

function normalizeText(text: string): string {
  const accents: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };
  return (text || "").toLowerCase().replace(/[áéíóú]/g, (m) => accents[m] || m);
}

function detectBusinessIntent(summary: string, description: string): string {
  const combined = normalizeText(`${summary} ${description}`);

  if (/consulta.*balance|balance|saldo/.test(combined)) return "balance_inquiry";
  if (/estado.*cuenta|extracto/.test(combined)) return "account_statement";
  if (/pago|transferencia/.test(combined)) return "product_payment";
  if (/deposito.*plazo|certificado/.test(combined)) return "term_deposit";
  if (/tarjeta.*credito|credito/.test(combined)) return "credit_card";
  if (/cuenta.*efectivo|cuenta.*corriente|ahorro/.test(combined)) return "cash_account";
  if (/prestamo|credito/.test(combined)) return "loan";

  return "generic";
}

function detectProductCategory(summary: string, description: string): string {
  const combined = normalizeText(`${summary} ${description}`);

  if (/deposito.*plazo|certificado|plazo/.test(combined)) return "term_deposit";
  if (/tarjeta.*credito/.test(combined)) return "credit_card";
  if (/cuenta.*efectivo|cuenta.*corriente|ahorro/.test(combined)) return "cash_account";
  if (/prestamo/.test(combined)) return "loan";

  return "generic";
}

function detectAccessMode(summary: string, description: string): "public" | "private" {
  const combined = normalizeText(`${summary} ${description}`);

  const publicIndicators = /informacion.*producto|catalogo|beneficio|descripcion/;
  const privateIndicators = /sesion.*valida|autenticado|b2000|transaccion|balance|pago|estado.*cuenta/;

  if (publicIndicators.test(combined)) return "public";
  if (privateIndicators.test(combined)) return "private";

  return "private"; // default
}

function buildAllowedTerms(productCategory: string): string[] {
  const terms: Record<string, string[]> = {
    term_deposit: [
      "Consulta de balance",
      "Depósitos a Plazo",
      "Número de certificado",
      "Monto del Depósito a Plazo",
      "Tasa de Interés",
      "Fecha de Vencimiento",
      "Estado",
      "Intereses Generados",
      "Tipo de Depósito",
      "Volver",
      "Finalizar sesión",
    ],
    credit_card: [
      "Tarjetas de Crédito",
      "Número de tarjeta",
      "Balance Actual",
      "Balance Disponible",
      "Fecha de corte",
      "Fecha de Vencimiento de Pago",
      "Volver",
      "Finalizar sesión",
    ],
    cash_account: [
      "Cuentas de efectivo",
      "Cuenta de Ahorro",
      "Cuenta Corriente",
      "Balance Actual",
      "Balance Disponible",
      "Volver",
      "Finalizar sesión",
    ],
    loan: [
      "Préstamos",
      "Número de préstamo",
      "Balance pendiente",
      "Fecha próximo pago",
      "Monto último pago",
      "Volver",
      "Finalizar sesión",
    ],
  };

  return terms[productCategory] || [];
}

function buildBlockedTerms(productCategory: string): string[] {
  const blocked: Record<string, string[]> = {
    term_deposit: [
      "Tarjeta de Crédito",
      "Tarjetas",
      "Préstamo",
      "Préstamos",
      "Cuenta Corriente",
      "Cuenta de Ahorro",
      "Catálogo de Productos",
    ],
    credit_card: ["Depósito a Plazo", "Depositos a Plazo", "Préstamo", "Préstamos"],
    cash_account: ["Depósito a Plazo", "Depositos a Plazo", "Tarjeta de Crédito", "Préstamo"],
    loan: ["Depósito a Plazo", "Tarjeta de Crédito", "Cuenta de Ahorro"],
  };

  return blocked[productCategory] || [];
}

export function enrichWithPassiveHUEvidence(input: {
  jiraKey: string;
  summary: string;
  description: string;
  appSlug?: string;
  testrailSectionName?: string;
}): HUEvidence {
  const businessIntent = detectBusinessIntent(input.summary, input.description);
  const productCategory = detectProductCategory(input.summary, input.description);
  const accessMode = detectAccessMode(input.summary, input.description);
  const allowedTerms = buildAllowedTerms(productCategory);
  const blockedTerms = buildBlockedTerms(productCategory);

  const labelHints =
    productCategory === "term_deposit"
      ? ["Depósitos a Plazo", "Certificado", "Tasa Interés", "Fecha Vencimiento"]
      : productCategory === "credit_card"
        ? ["Tarjeta de Crédito", "Balance", "Límite"]
        : productCategory === "cash_account"
          ? ["Cuenta de Efectivo", "Saldo", "Transacciones"]
          : ["Préstamo", "Cuota", "Balance Pendiente"];

  const mcpStepRules = [
    "Use MCP-friendly steps: 'Hacer clic en', 'Validar que se muestre', 'Seleccionar', 'Ingresar'",
    "Avoid narrative steps or descriptions",
    "Each step must be actionable and testable",
    `Allowed products for this HU: ${allowedTerms.join(", ")}`,
    `DO NOT use blocked terms: ${blockedTerms.join(", ")}`,
  ];

  const gaps: string[] = [];
  if (productCategory === "generic") {
    gaps.push("Could not detect specific product from HU - using fallback");
  }
  if (accessMode === "public" && input.testrailSectionName?.includes("private")) {
    gaps.push("Public HU but TestRail section suggests private access - verify");
  }

  console.log(
    `[hu-evidence] issue=${input.jiraKey} intent=${businessIntent} product=${productCategory} ` +
      `accessMode=${accessMode} allowed=${allowedTerms.length} blocked=${blockedTerms.length}`,
  );

  return {
    businessIntent,
    productCategory,
    accessMode,
    allowedTerms,
    blockedTerms,
    labelHints,
    mcpStepRules,
    gaps,
  };
}

export function formatHUEvidenceForPrompt(evidence: HUEvidence, issueKey: string): string {
  return `## HU-DRIVEN ROUTE EVIDENCE (${issueKey})

**Business Intent:** ${evidence.businessIntent}
**Product Category:** ${evidence.productCategory}
**Access Mode:** ${evidence.accessMode}

**Allowed UI Terms:** ${evidence.allowedTerms.join(", ")}

**BLOCKED Terms (DO NOT USE):** ${evidence.blockedTerms.join(", ")}

**Label Hints:** ${evidence.labelHints.join(", ")}

**MCP Step Rules:**
${evidence.mcpStepRules.map((r) => `- ${r}`).join("\n")}

${evidence.gaps.length > 0 ? `**Gaps/Warnings:**\n${evidence.gaps.map((g) => `- ${g}`).join("\n")}` : ""}
`;
}
