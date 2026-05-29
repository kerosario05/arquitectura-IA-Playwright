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
  let processed = text;
  
  // Convert list items to separate lines BEFORE stripping tags
  // </li><li> or </li>\n<li> should become line breaks
  processed = processed.replace(/<\/li>\s*<li>/gi, "\n");
  processed = processed.replace(/<\/li>/gi, "\n");
  processed = processed.replace(/<li\s*>/gi, "");
  
  // Convert other block elements to line breaks
  processed = processed.replace(/<br\s*\/?\s*>/gi, "\n");
  processed = processed.replace(/<\/p>/gi, "\n");
  processed = processed.replace(/<p[^>]*>/gi, "\n");
  processed = processed.replace(/<\/div>/gi, "\n");
  processed = processed.replace(/<div[^>]*>/gi, "\n");
  
  // Now strip remaining HTML tags
  processed = processed.replace(/<[^>]+>/g, "");
  
  // Decode HTML entities
  processed = processed.replace(/&nbsp;/gi, " ");
  processed = processed.replace(/&quot;/gi, "\"");
  processed = processed.replace(/&amp;/gi, "&");
  processed = processed.replace(/&lt;/gi, "<");
  processed = processed.replace(/&gt;/gi, ">");
  processed = processed.replace(/&#39;/gi, "'");
  processed = processed.replace(/&apos;/gi, "'");
  
  // Normalize line endings
  processed = processed.replace(/\r\n/g, "\n");
  processed = processed.replace(/\r/g, "\n");
  processed = processed.replace(/\n{3,}/g, "\n\n");
  
  return processed.trim();
}

/**
 * Repair concatenated steps by splitting before MCP action verbs
 * This handles cases where HTML cleanup resulted in:
 * "Clic en "A".Clic en "B".Validar que se muestre "C"."
 */
function repairConcatenatedSteps(text: string): { repaired: string; wasRepaired: boolean; verbsDetected: number } {
  let repaired = text;
  let verbsDetected = 0;
  
  // Action verb patterns that typically start a new step
  // Keep the period in the output
  const actionVerbPatterns = [
    { pattern: /\.(Clic\s+en)/gi, replacement: ".$1" },
    { pattern: /\.(Click\s+on)/gi, replacement: ".$1" },
    { pattern: /\.(Hacer\s+clic\s+en)/gi, replacement: ".$1" },
    { pattern: /\.(Presionar)/gi, replacement: ".$1" },
    { pattern: /\.(Seleccionar)/gi, replacement: ".$1" },
    { pattern: /\.(Validar\s+que)/gi, replacement: ".$1" },
    { pattern: /\.(Verificar\s+que)/gi, replacement: ".$1" },
    { pattern: /\.(Comprobar\s+que)/gi, replacement: ".$1" },
    { pattern: /\.(Esperar\s+que)/gi, replacement: ".$1" },
    { pattern: /\.(Esperar)/gi, replacement: ".$1" },
    { pattern: /\.(Navegar\s+a)/gi, replacement: ".$1" },
    { pattern: /\.(Ir\s+a)/gi, replacement: ".$1" },
    { pattern: /\.(Abrir)/gi, replacement: ".$1" },
    { pattern: /\.(Ingresar)/gi, replacement: ".$1" },
    { pattern: /\.(Completar)/gi, replacement: ".$1" }
  ];
  
  for (const { pattern, replacement } of actionVerbPatterns) {
    const matches = repaired.match(pattern);
    if (matches) {
      verbsDetected += matches.length;
      repaired = repaired.replace(pattern, replacement);
    }
  }
  
  // Also handle cases without period: "..."Clic en" (quote followed by verb)
  const quoteVerbPatterns = [
    { pattern: /(")(Clic\s+en)/gi, replacement: "$1\n$2" },
    { pattern: /(")(Validar\s+que)/gi, replacement: "$1\n$2" },
    { pattern: /(")(Seleccionar)/gi, replacement: "$1\n$2" }
  ];
  
  for (const { pattern, replacement } of quoteVerbPatterns) {
    const matches = repaired.match(pattern);
    if (matches) {
      verbsDetected += matches.length;
      repaired = repaired.replace(pattern, replacement);
    }
  }
  
  const wasRepaired = verbsDetected > 0;
  return { repaired, wasRepaired, verbsDetected };
}

function cleanText(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const cleaned = stripHtml(value).trim();
  return cleaned || undefined;
}

/**
 * Clean and format expected result text for readability
 * Preserves list structure and repairs concatenated items
 */
function cleanExpectedResult(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  let processed = stripHtml(value);
  
  // Repair concatenated expected result items
  const repairResult = repairConcatenatedSteps(processed);
  processed = repairResult.repaired;
  
  // Add newlines after periods followed by capital letters (sentence boundaries)
  processed = processed.replace(/\.([A-Z])/g, ".\n$1");
  
  if (repairResult.wasRepaired) {
    console.log(`[testcase-parser] repairedExpectedResult=true count=${repairResult.verbsDetected}`);
  }
  
  processed = processed.trim();
  return processed || undefined;
}

function splitIntoSteps(customSteps: string, expected?: string): TestScenarioStep[] {
  const normalized = cleanText(customSteps);
  if (!normalized) {
    return [];
  }

  // Detect if HTML lists were present
  const hasHtmlLists = /<ol|<ul|<li/i.test(customSteps);
  const hasLineBreaks = /\n/.test(normalized);
  
  // Repair concatenated steps
  const repairResult = repairConcatenatedSteps(normalized);
  let textToSplit = repairResult.repaired;
  
  if (repairResult.wasRepaired) {
    console.log(`[testcase-parser] repairedConcatenatedSteps=true count=${repairResult.verbsDetected} originalLength=${normalized.length}`);
  }
  
  // Split by newline (added by repair function)
  textToSplit = textToSplit.replace(/\.\s*(Clic\s+en|Click\s+on|Validar\s+que|Verificar\s+que|Esperar|Seleccionar|Presionar|Navegar|Ingresar|Completar)/gi, ".\n$1");
  
  // First split by numbered list patterns
  let parts = textToSplit
    .split(/\n\s*(?:\d+[\.)])\s*/g)
    .map((item) => item.trim())
    .filter(Boolean);
  
  // If no numbered lists found, split by bullet points
  if (parts.length === 1 && !hasHtmlLists) {
    parts = textToSplit
      .split(/\n\s*(?:-|\*)\s*/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  
  // If still single part, split by newlines
  if (parts.length === 1) {
    parts = textToSplit
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const expandedParts: string[] = [];
  for (const part of parts) {
    // Strip leading step numbers from the action text
    const cleanedPart = part.replace(/^\d+[\.)]\s*/, "").trim();
    
    const lines = cleanedPart.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
        expandedParts.push(cleanedPart);
      }
    } else {
      expandedParts.push(cleanedPart);
    }
  }

  const actions = expandedParts.length > 0 ? expandedParts : [normalized];
  
  // Diagnostic logging
  console.log(`[testcase-parser] parsedSteps=${actions.length} source=testrail`);
  console.log(`[testcase-parser] htmlListDetected=${hasHtmlLists} lineBreaksPreserved=${hasLineBreaks || repairResult.wasRepaired}`);
  
  if (actions.length === 1 && repairResult.verbsDetected > 1) {
    console.log(`[testcase-parser] suspiciousConcatenatedSteps=true verbsDetected=${repairResult.verbsDetected} originalLength=${normalized.length}`);
  }
  
  return actions.map((action, index) => {
    const expectedText = index === actions.length - 1 ? cleanExpectedResult(expected) : undefined;
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
      const expected = cleanExpectedResult(step.expected);
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
    raw: rawCase,
    sectionId: rawCase.section_id,
    sectionName: undefined
  };
}

export function normalizeTestRailCases(rawCases: RawTestRailCase[]): TestScenario[] {
  return rawCases.map((rawCase) => normalizeTestRailCase(rawCase));
}
