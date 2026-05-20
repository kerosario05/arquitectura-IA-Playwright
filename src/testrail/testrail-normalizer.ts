import type { RawTestRailCase, TestScenario, TestScenarioStep } from "../types/testrail.types";

const hintDictionary = [
  "cedula",
  "cédula",
  "documento",
  "identificacion",
  "identificación",
  "codigo",
  "código",
  "otp",
  "pin",
  "token",
  "telefono",
  "teléfono",
  "celular",
  "monto",
  "importe",
  "amount",
  "valor",
  "cuenta",
  "account",
  "prestamo",
  "préstamo",
  "loan",
  "cliente",
  "customer",
  "email",
  "correo",
  "usuario",
  "user",
  "password",
  "contraseña",
  "clave"
];

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanText(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const cleaned = stripHtml(value).trim();
  return cleaned || undefined;
}

function splitIntoSteps(customSteps: string, expected?: string): TestScenarioStep[] {
  const normalized = cleanText(customSteps);
  if (!normalized) {
    return [];
  }

  const parts = normalized
    .split(/\n\s*(?:\d+[\.)]|-|\*)\s*/g)
    .map((item) => item.trim())
    .filter(Boolean);

  const expandedParts: string[] = [];
  for (const part of parts) {
    const lines = part.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const actionPatterns = [
        /^clic\s+en\s+['"]/i,
        /^click\s+on\s+['"]/i,
        /^hacer\s+clic\s+en\s+['"]/i,
        /^presionar\s+['"]/i,
        /^seleccionar\s+['"]/i,
        /^abrir\s+/i,
        /^ingresar\s+/i,
        /^validar\s+/i,
        /^verificar\s+/i,
        /^comprobar\s+/i,
        /^esperar\s+/i,
        /^navegar\s+/i,
        /^ir\s+a\s+/i
      ];
      const looksLikeMultipleActions = lines.some((line) =>
        actionPatterns.some((p) => p.test(line))
      );

      if (looksLikeMultipleActions) {
        expandedParts.push(...lines);
      } else {
        expandedParts.push(part);
      }
    } else {
      expandedParts.push(part);
    }
  }

  const actions = expandedParts.length > 0 ? expandedParts : [normalized];
  return actions.map((action, index) => {
    const expectedText = index === actions.length - 1 ? cleanText(expected) : undefined;
    return {
      index: index + 1,
      action,
      expected: expectedText,
      dataHints: extractDataHintsFromText(`${action}\n${expectedText ?? ""}`)
    };
  });
}

export function extractDataHintsFromText(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const unique = new Set<string>();
  for (const hint of hintDictionary) {
    const normalizedHint = hint
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (normalized.includes(normalizedHint)) {
      unique.add(normalizedHint);
    }
  }

  return Array.from(unique);
}

export function normalizeTestRailCase(rawCase: RawTestRailCase): TestScenario {
  const title = cleanText(rawCase.title) ?? `Case ${rawCase.id}`;
  const preconditions = cleanText(rawCase.custom_preconds);
  const references = cleanText(rawCase.refs);

  let steps: TestScenarioStep[] = [];

  if (Array.isArray(rawCase.custom_steps_separated) && rawCase.custom_steps_separated.length > 0) {
    steps = rawCase.custom_steps_separated.map((step, index) => {
      const action = cleanText(step.content) ?? `Step ${index + 1}`;
      const expected = cleanText(step.expected);
      const info = cleanText(step.additional_info);
      const hintSource = `${action}\n${expected ?? ""}\n${info ?? ""}\n${preconditions ?? ""}`;

      return {
        index: index + 1,
        action,
        expected,
        dataHints: extractDataHintsFromText(hintSource)
      };
    });
  } else if (rawCase.custom_steps) {
    steps = splitIntoSteps(rawCase.custom_steps, rawCase.custom_expected).map((step) => ({
      ...step,
      dataHints: extractDataHintsFromText(
        `${step.action}\n${step.expected ?? ""}\n${cleanText(rawCase.custom_preconds) ?? ""}`
      )
    }));
  }

  if (steps.length === 0) {
    steps = [
      {
        index: 1,
        action: title,
        expected: undefined,
        dataHints: extractDataHintsFromText(`${title}\n${preconditions ?? ""}`)
      }
    ];
  }

  return {
    source: "testrail",
    externalId: `C${rawCase.id}`,
    caseId: rawCase.id,
    title,
    preconditions,
    references,
    steps,
    raw: rawCase
  };
}

export function normalizeTestRailCases(rawCases: RawTestRailCase[]): TestScenario[] {
  return rawCases.map((rawCase) => normalizeTestRailCase(rawCase));
}
