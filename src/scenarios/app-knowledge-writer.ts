import * as fs from "fs";
import * as path from "path";
import type { AppKnowledge, AppKnowledgeItem } from "./scenario-types";
import type { CoverageContract, CoverageContractItem } from "./scenario-types";
import type { OptionFlow } from "./hu-scope-guard";
import type { RouteProfileSuggestion } from "../discovery/route-profile-learning";

function normalizeForHash(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/^\d+[\.)]\s*/, "")
    .replace(/\s+/g, " ");
}

function normalizeCompare(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

function computeStableId(appSlug: string, issueKey: string, normalizedSteps: string[]): string {
  const stepsHash = normalizedSteps.map(s => normalizeForHash(s)).join("|");
  const raw = `${appSlug}::${issueKey}::${stepsHash}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const chr = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `${appSlug}_${issueKey}_${Math.abs(hash).toString(36)}`;
}

function semanticStepsKey(issueKey: string, steps: string[]): string {
  return `${issueKey}::${steps.map(s => normalizeForHash(s)).join("::")}`;
}

function normalizeForDedup(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^\d+[\.)]\s*/, "")
    .replace(/["""'']/g, '"')
    .replace(/[.!,;:]+$/, "")
    .replace(/\s+/g, " ");
}

function finalDedupKey(appSlug: string, issueKey: string, coverageRefs: string[], steps: string[]): string {
  const refs = [...coverageRefs].sort().join("|");
  const normalized = steps.map(s => normalizeForDedup(s)).join("::");
  return `${appSlug}::${issueKey}::${refs}::${normalized}`;
}

function extractClickTargets(steps: string[]): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const match = step.match(/Clic en "([^"]+)"/i);
    if (match) {
      const t = match[1].normalize("NFC").toLowerCase().trim();
      if (!seen.has(t)) {
        seen.add(t);
        targets.push(match[1]);
      }
    }
  }
  return targets;
}

function extractAssertionTargets(steps: string[]): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const match = step.match(/Validar que se muestre "([^"]+)"/i);
    if (match) {
      const t = match[1].normalize("NFC").toLowerCase().trim();
      if (!seen.has(t)) {
        seen.add(t);
        targets.push(match[1]);
      }
    }
  }
  return targets;
}

function extractNegativeAssertions(steps: string[]): string[] {
  const assertions: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const match = step.match(/Validar que no se muestre "([^"]+)"/i);
    if (match) {
      const t = match[1].normalize("NFC").toLowerCase().trim();
      if (!seen.has(t)) {
        seen.add(t);
        assertions.push(match[1]);
      }
    }
  }
  return assertions;
}

function extractAuthTerms(scenarioText: string, flow: OptionFlow | null): string[] {
  if (!flow || !flow.requiresAuth) return [];
  const terms: string[] = [];
  const seen = new Set<string>();
  const candidates = ["autenticación", "identificación", "login", "autenticación de cliente", "identificación de usuario"];
  for (const term of candidates) {
    if (scenarioText.toLowerCase().includes(term) || (flow.expectedResult && flow.expectedResult.toLowerCase().includes(term))) {
      if (!seen.has(term)) {
        seen.add(term);
        terms.push(term);
      }
    }
  }
  if (terms.length === 0 && flow.requiresAuth) {
    const derived = flow.expectedResult?.toLowerCase().includes("identificaci") ? "identificación" : "autenticación";
    terms.push(derived);
  }
  return terms;
}

function findMatchingOptionFlow(scenarioSteps: string[], scenarioTitle: string, optionFlows: OptionFlow[]): OptionFlow | null {
  const stepText = scenarioSteps.join(" ").toLowerCase().normalize("NFC");
  const titleLower = (scenarioTitle || "").toLowerCase().normalize("NFC");
  for (const flow of optionFlows) {
    if (!flow.optionLabel) continue;
    const label = flow.optionLabel.toLowerCase().normalize("NFC");
    if (stepText.includes(label) || titleLower.includes(label)) {
      return flow;
    }
    if (flow.expectedResult) {
      const result = flow.expectedResult.toLowerCase().normalize("NFC");
      if (stepText.includes(result) || titleLower.includes(result)) {
        return flow;
      }
    }
  }
  return null;
}

function findCoverageRefs(scenarioTitle: string, steps: string[], optionLabels: string[], contract: CoverageContract | null, routeProfile?: any): string[] {
  if (!contract) return [];
  const refs: string[] = [];
  const titleLower = scenarioTitle.toLowerCase().normalize("NFC");
  const stepsText = steps.join(" ").toLowerCase().normalize("NFC");
  const optionText = optionLabels.join(" ").toLowerCase().normalize("NFC");
  const allText = titleLower + " " + stepsText + " " + optionText;
  const cc = contract as any;
  const titleNorm = titleLower;

  // --- Title-only heuristic (absolute priority before exact match) ---
  // Check title first so that step text ("Seleccionar el primer...") cannot
  // contaminate via selection_flow label matches in the exact match loop below.

  // 1. failure_case (before negative_rule to catch "No mostrar...cuando no existe...")
  if (cc.failureCases?.length > 0 && /no\s+se\s+presenta|no\s+existe|no\s+disponible|indisponibilidad|falla|error|no\s+fue\s+posible|incompleto|falta\s+informaci[oó]n|no\s+seleccionable/i.test(titleNorm)) {
    refs.push(cc.failureCases[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.failureCases[0].id}" reason=failure_case source=title`);
    return refs;
  }

  // 2. negative_rule
  if (cc.negativeRules?.length > 0 && /no\s+exponer|n[uú]mero\s+completo|no\s+se\s+muestre|no\s+mostrar|no\s+visualizar|contenido\s+restringido|ocultamiento|restringido/i.test(titleNorm)) {
    refs.push(cc.negativeRules[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.negativeRules[0].id}" reason=negative_rule source=title`);
    return refs;
  }

  // 3. format_rule (before action_options/detail_fields so "formato + detalle" wins format)
  if (cc.formatRules?.length > 0 && /formato|formatos|moneda|porcentaje|tasa|fecha|enmascarad[ao]/i.test(titleNorm)) {
    refs.push(cc.formatRules[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.formatRules[0].id}" reason=format_rule source=title`);
    return refs;
  }

  // 4. action_options (before detail_fields so "opciones + detalle" wins action_options)
  if (cc.actionOptions?.length > 0 && /opciones|acciones|volver|regresar|retorno|posterior(?:es)?|men[uú]\s+principal|finalizar\s+sesi[oó]n|imprimir|enviar/i.test(titleNorm)) {
    refs.push(cc.actionOptions[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.actionOptions[0].id}" reason=action_options source=title`);
    return refs;
  }

  // 5. detail_fields (only if no action_options signals)
  if (cc.detailFields?.length > 0 && /campos\s+principales|campos\s+del\s+detalle|campos\s+requeridos|detalle\s+del|validar\s+campos/i.test(titleNorm) &&
      !/formato|formatos|moneda|porcentaje|tasa|fecha|enmascarad[ao]/i.test(titleNorm) &&
      !/opciones|acciones|volver|regresar|retorno|posterior(?:es)?|men[uú]\s+principal|finalizar\s+sesi[oó]n|imprimir|enviar/i.test(titleNorm)) {
    refs.push(cc.detailFields[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.detailFields[0].id}" reason=detail_fields source=title`);
    return refs;
  }

  // 6. conditional_alert
  if (cc.conditionalAlerts?.length > 0 && /alerta|pr[oó]ximo\s+a\s+vencer|vencimiento\s+pr[oó]ximo|vencimiento\s+cercano/i.test(titleNorm)) {
    refs.push(cc.conditionalAlerts[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.conditionalAlerts[0].id}" reason=conditional_alert source=title`);
    return refs;
  }

  // 7. selection_flow (only if title explicitly mentions selection, and no negative signals)
  if (cc.selectionFlows?.length > 0 && /^(?:seleccionar|escoger|elegir)\b|selecci[oó]n\s+(?:del\s+)?(?:primer|primera)|(?:primer|primera)\s+.*?listado/i.test(titleNorm) &&
      !/no\s+se\s+presenta|no\s+existe|falla|error|retorno|regresar|volver|no\s+mostrar|no\s+visualizar|contenido\s+restringido/i.test(titleNorm)) {
    refs.push(cc.selectionFlows[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.selectionFlows[0].id}" reason=selection_flow source=title`);
    return refs;
  }

  // 8. list_screen (purely list-based; guard against selection/detail/format/alert keywords)
  if (cc.listScreens?.length > 0 && /visualiz(?:aci[oó]n|ar)|ver\s+.*listad|mostrar\s+.*listad|\blistad|lista\s+de|disponibles/i.test(titleNorm) &&
      !/seleccionar|escoger|elegir|detalle|formato|opciones|alerta|falla|error|restringido|no\s+se\s+muestre|regresar|volver|bloqueo|inconsistencia|incompleto|indisponibilidad|ocultamiento|n[uú]mero\s+completo/i.test(titleNorm)) {
    refs.push(cc.listScreens[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.listScreens[0].id}" reason=list_screen source=title`);
    return refs;
  }

  // 9. selectable_options (before navigation)
  if (cc.selectableOptions?.length > 0 && /periodo|rango|opciones?\s+de\s+(periodo|rango|tiempo)|selecci[oó]n\s+por|meses\d|d[ií]as\d|a[nñ]os\d|\d+\s*(mes|d[ií]a|a[nñ]o|semana)/i.test(titleNorm)) {
    refs.push(cc.selectableOptions[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.selectableOptions[0].id}" reason=selectable_options source=title`);
    return refs;
  }

  // 10. visible_message
  if (cc.visibleMessages?.length > 0 && /mensaje|se\s+muestra\s+["""'']|validar\s+mensaje|mensaje\s+visible/i.test(titleNorm)) {
    refs.push(cc.visibleMessages[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.visibleMessages[0].id}" reason=visible_message source=title`);
    return refs;
  }

  // 11. confirmation_flow
  if (cc.confirmationFlows?.length > 0 && /confirmar|confirmaci[oó]n|generar\s+(comprobante|solicitud)|enviar\s+solicitud|descargar\s+comprobante|finalizar\s+operaci[oó]n/i.test(titleNorm)) {
    refs.push(cc.confirmationFlows[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.confirmationFlows[0].id}" reason=confirmation_flow source=title`);
    return refs;
  }

  // 12. delivery_option
  if (cc.deliveryOptions?.length > 0 && /correo|notificar|entrega|env[ií]o|destinatario|notificaci[oó]n/i.test(titleNorm)) {
    refs.push(cc.deliveryOptions[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.deliveryOptions[0].id}" reason=delivery_option source=title`);
    return refs;
  }

  // 13. reference_number (lowest priority, specific before generic)
  if (cc.referenceNumbers?.length > 0 && /referencia|c[oód]igo\s+[úu]nico|n[úu]mero\s+de\s+solicitud|comprobante|n[úu]mero\s+de\s+transacci[oó]n|identificador\s+[úu]nico/i.test(titleNorm)) {
    refs.push(cc.referenceNumbers[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.referenceNumbers[0].id}" reason=reference_number source=title`);
    return refs;
  }

  // 14. navigation (fallback for access-type titles)
  if (cc.navigationItems?.length > 0 && /acceso\s+(?:a\s+)?consulta|navegar\s+(?:a\s+)?consulta|consulta\s+de\s+\w+|navegaci[oó]n\s+a/i.test(titleNorm)) {
    refs.push(cc.navigationItems[0].id);
    console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${cc.navigationItems[0].id}" reason=navigation source=title`);
    return refs;
  }

  // --- No title match → proceed with exact match on combined text ---
  const allItems: CoverageContractItem[] = [
    ...contract.initialActions,
    ...contract.blockedWithoutAction,
    ...contract.postActionScreens,
    ...contract.optionFlows,
    ...contract.negativeRules,
    ...(contract as any).listScreens || [],
    ...(contract as any).selectionFlows || [],
    ...(contract as any).singleItemShortcuts || [],
    ...(contract as any).detailFields || [],
    ...(contract as any).formatRules || [],
    ...(contract as any).actionOptions || [],
    ...(contract as any).conditionalAlerts || [],
    ...(contract as any).failureCases || [],
    ...(contract as any).navigationItems || [],
    ...(contract as any).selectableOptions || [],
    ...(contract as any).visibleMessages || [],
    ...(contract as any).confirmationFlows || [],
    ...(contract as any).deliveryOptions || [],
    ...(contract as any).referenceNumbers || [],
  ];
  for (const item of allItems) {
    if (refs.includes(item.id)) continue;
    const searchTerms: string[] = [
      item.label,
      item.id,
      item.initialAction || "",
      item.optionLabel || "",
      item.negativeTerm || "",
      item.postActionQuestion || "",
      ...((item as any).fieldNames || []),
    ];
    for (const term of searchTerms) {
      const normalized = term.toLowerCase().normalize("NFC");
      if (normalized.length > 0 && allText.includes(normalized)) {
        refs.push(item.id);
        break;
      }
    }
  }

  // --- Fallback: steps-only and combined patterns when title + exact match yielded nothing ---
  if (refs.length === 0) {
    const stepsNorm = stepsText;
    const allNorm = allText;

    // Steps-only fallback (selection_flow only if title has no negative signals)
    if (cc.selectionFlows?.length > 0 && /seleccionar.*(?:primer|primera).*listado|Seleccionar el (?:primer|primera)/i.test(stepsNorm) &&
        !/no\s+se\s+presenta|no\s+existe|falla|error|retorno|regresar|volver|no\s+mostrar|no\s+visualizar|contenido\s+restringido/i.test(titleNorm)) {
      refs.push(cc.selectionFlows[0].id);
    } else if (cc.listScreens?.length > 0 && /listad|disponibles|visualizar|lista\s+de/i.test(stepsNorm)) {
      refs.push(cc.listScreens[0].id);
    }

    // Combined fallback
    if (refs.length === 0) {
      if (cc.selectableOptions?.length > 0 && /periodo|rango|\d+\s*(mes|d[ií]a|a[nñ]o|semana)/i.test(allNorm)) {
        refs.push(cc.selectableOptions[0].id);
      } else if (cc.visibleMessages?.length > 0 && /(se\s+)?muestra.*mensaje|mensaje\s+visible|validar\s+mensaje/i.test(allNorm)) {
        refs.push(cc.visibleMessages[0].id);
      } else if (cc.confirmationFlows?.length > 0 && /confirmar|confirmaci[oó]n|generar\s+(comprobante|solicitud)|descargar/i.test(allNorm)) {
        refs.push(cc.confirmationFlows[0].id);
      } else if (cc.deliveryOptions?.length > 0 && /correo|notificar|env[ií]o\s+(por|a|mediante)/i.test(allNorm)) {
        refs.push(cc.deliveryOptions[0].id);
      } else if (cc.referenceNumbers?.length > 0 && /referencia|c[oód]igo|comprobante|n[úu]mero\s+de\s+/i.test(allNorm)) {
        refs.push(cc.referenceNumbers[0].id);
      } else if (cc.negativeRules?.length > 0 && /(?:no\s+)?(?:restringido|no\s+se\s+muestre|ocultamiento|enmascarado)/i.test(allNorm)) {
        refs.push(cc.negativeRules[0].id);
      } else if (cc.actionOptions?.length > 0 && /opciones\s+(posteriores|visibles|disponibles|de\s+acci[oó]n)/i.test(allNorm)) {
        refs.push(cc.actionOptions[0].id);
      } else if (cc.conditionalAlerts?.length > 0 && /alerta|pr[oó]ximo\s+a\s+vencer/i.test(allNorm)) {
        refs.push(cc.conditionalAlerts[0].id);
      } else if (cc.formatRules?.length > 0 && /formato|moneda|porcentaje/i.test(allNorm)) {
        refs.push(cc.formatRules[0].id);
      } else if (cc.failureCases?.length > 0 && /falla|error|indisponibilidad|incompleto|bloqueo|inconsistencia/i.test(allNorm)) {
        refs.push(cc.failureCases[0].id);
      } else if (cc.detailFields?.length > 0 && /detalle|campos\s+(principales|requeridos|del\s+detalle)/i.test(allNorm)) {
        refs.push(cc.detailFields[0].id);
      } else if (cc.selectionFlows?.length > 0 && /seleccionar|escoger|elegir|(?:primer|primera)\s+.*listado|del\s+listado/i.test(allNorm) &&
          !/no\s+se\s+presenta|no\s+existe|falla|error|retorno|regresar|volver|no\s+mostrar|no\s+visualizar|contenido\s+restringido/i.test(titleNorm)) {
        refs.push(cc.selectionFlows[0].id);
      } else if (cc.navigationItems?.length > 0 && /acceso\s+(?:a\s+)?consulta|consulta\s+de\s+\w+|navegaci[oó]n\s+a/i.test(allNorm)) {
        refs.push(cc.navigationItems[0].id);
      } else if (cc.listScreens?.length > 0 && /listad|disponibles|visualizar|lista\s+de/i.test(allNorm)) {
        refs.push(cc.listScreens[0].id);
      }
    }

    if (refs.length > 0) {
      const reason = refs[0].replace(/_\d+$/, "");
      console.log(`[scenario-coverage] inferredCoverageRef scenario="${scenarioTitle}" ref="${refs[0]}" reason=${reason} source=heuristic`);
    }
  }
  return refs;
}

function normalizeTargetForDedupe(target: string): string {
  return target
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/\s+/g, " ");
}

function stripStepNumber(step: string): string {
  return step.replace(/^\d+[\.)]\s*/, "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildAllowedKnowledgeTerms(contract: CoverageContract | null, optionFlows: OptionFlow[], routeProfile?: any): {
  assertions: string[];
  negatives: string[];
  clicks: string[];
} {
  const assertions = new Set<string>();
  const negatives = new Set<string>();
  const clicks = new Set<string>();
  const addTerm = (s: string | undefined) => { if (s) { const t = normalizeCompare(s); if (t.length > 1) assertions.add(t); } };
  const addClick = (s: string | undefined) => { if (s) { const t = normalizeCompare(s); if (t.length > 1) clicks.add(t); } };
  const addNegative = (s: string | undefined) => { if (s) { const t = normalizeCompare(s); if (t.length > 1) negatives.add(t); } };

  if (contract) {
    const allItems: CoverageContractItem[] = [
      ...contract.initialActions,
      ...contract.blockedWithoutAction,
      ...contract.postActionScreens,
      ...contract.optionFlows,
      ...contract.negativeRules,
      ...(contract as any).listScreens || [],
      ...(contract as any).selectionFlows || [],
      ...(contract as any).singleItemShortcuts || [],
      ...(contract as any).detailFields || [],
      ...(contract as any).formatRules || [],
      ...(contract as any).actionOptions || [],
      ...(contract as any).conditionalAlerts || [],
      ...(contract as any).failureCases || [],
      ...(contract as any).navigationItems || [],
    ];
    for (const item of allItems) {
      addTerm(item.label);
      addTerm(item.optionLabel);
      addTerm(item.expectedResult);
      addTerm(item.negativeTerm);
      addTerm(item.postActionQuestion);
      addTerm(item.initialAction);
      addClick(item.initialAction);
      addClick(item.optionLabel);
      addNegative(item.negativeTerm);
      for (const el of (item as any).initialScreenElements || []) addTerm(el);
      for (const el of (item as any).postActionElements || []) addTerm(el);
      for (const fn of ((item as any).fieldNames || [])) addTerm(fn);
      if (item.requiresAuth && item.expectedResult) {
        const lower = item.expectedResult.normalize("NFC").toLowerCase();
        if (lower.includes("identificaci")) addTerm("identificación");
        if (lower.includes("autenticaci")) addTerm("autenticación");
        if (lower.includes("login")) addTerm("login");
      }
    }
  }

  // Also add option flow labels and expected results from raw flows
  for (const flow of optionFlows) {
    addClick(flow.optionLabel);
    addTerm(flow.optionLabel);
    addTerm(flow.expectedResult);
    if (flow.requiresAuth && flow.expectedResult) {
      const lower = flow.expectedResult.normalize("NFC").toLowerCase();
      if (lower.includes("identificaci")) addTerm("identificación");
      if (lower.includes("autenticaci")) addTerm("autenticación");
      if (lower.includes("login")) addTerm("login");
    }
  }

  // Add terms from routeProfile (trusted navigation path, selection target, etc.)
  // so that out-of-contract filter does not reject known navigation steps.
  if (routeProfile) {
    const rp = routeProfile as any;
    const entryTargets: string[] = [];
    for (const step of (rp._entryPath as any[]) || []) {
      if (step?.target) { addClick(step.target); entryTargets.push(step.target); }
    }
    for (const step of (rp._authenticatedPathArr as any[]) || []) {
      if (step?.target) { addClick(step.target); entryTargets.push(step.target); }
    }
    if (rp._selectionTarget) {
      addClick(rp._selectionTarget);
      addTerm(rp._selectionTarget);
      entryTargets.push(`selectionTarget:${rp._selectionTarget}`);
    }
    for (const sig of (rp._terminalSignals as string[]) || []) { addTerm(sig); entryTargets.push(`signal:${sig}`); }
    for (const da of (rp._detailAssertions as string[]) || []) { addTerm(da); entryTargets.push(`assertion:${da}`); }
    if (entryTargets.length > 0) {
      console.log(`[app-knowledge] trustedRouteTermAllowed terms="${entryTargets.join(', ')}" source=routeProfile`);
    }
  }

  return {
    assertions: Array.from(assertions),
    negatives: Array.from(negatives),
    clicks: Array.from(clicks),
  };
}

export function writeAppKnowledge(
  appSlug: string,
  validatedScenarios: Array<{ title: string; steps: string[]; sourceIssueKey: string; generationSource?: string }>,
  contract: CoverageContract | null,
  optionFlows: OptionFlow[],
  branchConflictTitles: Set<string>,
  outOfScopeRejectedTitles: Set<string>,
  currentIssueKey?: string,
  routeProfile?: any,
  routeResolutionBlocked?: boolean,
  rejectedRouteProfileKeys?: ReadonlyMap<string, string>,
): { added: number; updated: number; unchanged: number; total: number; skipped: { rejected: number; blocked: number; branchConflict: number; outOfScope: number } } {
  const skipped = { rejected: 0, blocked: 0, branchConflict: 0, outOfScope: 0 };

  // validatedScenarios already represents FINAL accepted scenarios from the preview pipeline.
  // They've passed validation, repairs, fallback insertion, branch conflict handling, and
  // out-of-scope filtering. We only need to remove any remaining title-based exclusions.
  // Do NOT filter by sourceIssueKey (rejectedKeys/blockedKeys) — a valid scenario from the
  // same issue key as a rejected/blocked scenario is still valid.
  console.log(`[app-knowledge] inputFinalScenarios count=${validatedScenarios.length}`);

  const finalScenarios = validatedScenarios.filter(sc => {
    const title = sc.title || "";
    if (branchConflictTitles.has(title)) { skipped.branchConflict++; return false; }
    if (outOfScopeRejectedTitles.has(title)) { skipped.outOfScope++; return false; }
    return true;
  });

  // Log accepted count and skipped breakdown
  console.log(`[app-knowledge] acceptedAfterFilters count=${finalScenarios.length}`);
  if (skipped.branchConflict > 0) console.log(`[app-knowledge] skippedBranchConflict count=${skipped.branchConflict}`);
  if (skipped.outOfScope > 0) console.log(`[app-knowledge] skippedOutOfScope count=${skipped.outOfScope}`);

  const hasScenarioData = finalScenarios.length > 0;
  const hasRouteProfileData = routeProfile && 
    ((routeProfile as any)?._selectionTarget as string) && 
    ((routeProfile as any)?._entryPath as any[])?.length > 0 && 
    ((routeProfile as any)?._authenticatedPathArr as any[])?.length > 0 &&
    ((routeProfile as any)?._accessMode as string) === "private";

  // Track route-profile upserts (declared early for TDZ safety)
  let rpAddedCount = 0;
  let rpUpdatedCount = 0;

  const knowledgePath = path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
  const dir = path.dirname(knowledgePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Load existing
  let existing: AppKnowledge | null = null;
  if (fs.existsSync(knowledgePath)) {
    try {
      const raw = fs.readFileSync(knowledgePath, "utf-8");
      existing = JSON.parse(raw) as AppKnowledge;
      console.log(`[app-knowledge] loaded appSlug=${appSlug} items=${existing.items.length}`);
    } catch {
      console.log(`[app-knowledge] loaded appSlug=${appSlug} items=0 reason=parse_error`);
      existing = null;
    }
  }

  // Build allowed knowledge terms from Coverage Contract BEFORE any cleanup or item building.
  // Only terms explicitly mentioned in the contract may appear in knowledge items.
  // Terms from routeProfile, catalog, or product detail are excluded.
  const allowedKnowledgeTerms = buildAllowedKnowledgeTerms(contract, optionFlows, routeProfile);
  const hasRouteRejection = rejectedRouteProfileKeys && rejectedRouteProfileKeys.size > 0;
  const hasCleanupTrigger = routeResolutionBlocked || hasRouteRejection;
  const canForceCleanupByRejectedRoute = routeResolutionBlocked === true && hasRouteRejection;
  const cleanupConfidenceHigh = allowedKnowledgeTerms.assertions.length + allowedKnowledgeTerms.clicks.length >= 4;
  const shouldCleanupCurrentIssue = (hasCleanupTrigger && cleanupConfidenceHigh) || canForceCleanupByRejectedRoute;
  if (hasCleanupTrigger && !shouldCleanupCurrentIssue) {
    console.log(`[app-knowledge] cleanupCurrentIssue skipped reason=insufficient_hu_contract_confidence assertions=${allowedKnowledgeTerms.assertions.length} clicks=${allowedKnowledgeTerms.clicks.length}`);
  }
  if (canForceCleanupByRejectedRoute) {
    console.log(`[app-knowledge] cleanupCurrentIssue forcedByRejectedRoute issue=${currentIssueKey ?? "?"} rejectedRoutes=${rejectedRouteProfileKeys!.size}`);
  }
  const normalizeTerm = (s: string) => normalizeCompare(s);

  const now = nowIso();

  // --- Route classification helpers (generic signal-based, no hardcoded names) ---
  const _classifyAccessLevel = (item: AppKnowledgeItem, matchingFlows: OptionFlow[], contract: CoverageContract | null): "public" | "private" | "authenticated" | "unknown" => {
    if (item.authTerms.length > 0) return "private";
    if (contract?.authenticatedPrecondition) return "authenticated";
    if (matchingFlows.some(f => f.requiresAuth)) return "private";
    if (matchingFlows.length > 0 && matchingFlows.every(f => !f.requiresAuth)) return "public";
    if (contract?.functionalScope === "public_info" || contract?.functionalScope === "entry_menu_or_landing") return "public";
    if (contract?.functionalScope === "private_transactional") return "private";
    return "unknown";
  };
  const _classifyIntent = (item: AppKnowledgeItem, matchingFlows: OptionFlow[], contract: CoverageContract | null): "informational" | "transactional" | "auth_entry" | "menu_entry" | "functional" | "unknown" => {
    if (matchingFlows.some(f => f.requiresAuth)) return "auth_entry";
    if (item.authTerms.length > 0) return "auth_entry";
    if (contract?.functionalScope === "entry_menu_or_landing") return "menu_entry";
    if (contract?.functionalScope === "public_info") return "informational";
    if (contract?.functionalScope === "private_transactional") return "transactional";
    if (matchingFlows.length > 0 && !matchingFlows[0].requiresAuth) {
      const result = (matchingFlows[0].expectedResult || "").toLowerCase();
      if (/informaci.n|detalle|resumen|consulta/i.test(result)) return "informational";
      return "transactional";
    }
    const allText = [item.scenarioTitle, ...item.steps].join(" ").toLowerCase();
    if (/informaci.n|detalle|resumen|saldo/i.test(allText) && !/transferir|pagar|enviar/i.test(allText)) return "informational";
    if (/transferir|pagar|enviar|solicitar|contratar/i.test(allText)) return "transactional";
    if (/men.|opciones|categorias|inicio/i.test(allText)) return "menu_entry";
    return "functional";
  };
  const _classifyStartsFrom = (_item: AppKnowledgeItem, contract: CoverageContract | null): "public_initial" | "authenticated_state" | "unknown" => {
    if (contract?.authenticatedPrecondition) return "authenticated_state";
    return "public_initial";
  };
  const _classifyEndsAt = (_item: AppKnowledgeItem, matchingFlows: OptionFlow[], contract: CoverageContract | null): "public_content" | "auth_gate" | "authenticated_area" | "functional_area" | "unknown" => {
    if (matchingFlows.some(f => f.requiresAuth)) return "auth_gate";
    if (_item.authTerms.length > 0) return "auth_gate";
    if (contract?.functionalScope === "private_transactional") return "authenticated_area";
    if (contract?.functionalScope === "public_info" || contract?.functionalScope === "entry_menu_or_landing") return "public_content";
    return "functional_area";
  };
  const _isLearnedRoute = (coverageRefs: string[]): boolean => {
    return coverageRefs.includes("learned_navigation_path") || coverageRefs.includes("private_entry_path");
  };
  const _isSharedOrAuthRoute = (item: AppKnowledgeItem): boolean => {
    const refs = item.coverageRefs || [];
    if (_isLearnedRoute(refs)) return true;
    if (refs.includes("shared_entry_path")) return true;
    if (refs.some(r => r === "intent:auth_entry")) return true;
    if (refs.some(r => r === "endsAt:auth_gate")) return true;
    if (refs.some(r => r === "startsFrom:public_initial") && refs.some(r => r === "endsAt:auth_gate")) return true;
    return false;
  };

  const existingMap = new Map<string, AppKnowledgeItem>();

  // ── Knowledge scoring and classification helpers ──
  const _computeRouteSignature = (item: AppKnowledgeItem): string => {
    const refs = item.coverageRefs || [];
    const targets = (item.clickTargets || []).map(t => normalizeCompare(t)).join("::");
    const accessMode = refs.find(r => r.startsWith("accessLevel:"))?.split(":")[1] || "unknown";
    const startsFrom = refs.find(r => r.startsWith("startsFrom:"))?.split(":")[1] || "unknown";
    const endsAt = refs.find(r => r.startsWith("endsAt:"))?.split(":")[1] || "unknown";
    return `${appSlug}::${targets}::${accessMode}::${startsFrom}::${endsAt}`;
  };
  const _computeCoverageSignature = (item: AppKnowledgeItem): string => {
    const refs = [...(item.coverageRefs || [])].sort().join("|");
    const steps = (item.steps || []).map(s => normalizeCompare(s)).join("::");
    return `${item.issueKey}::${refs}::${steps}`;
  };
  const _scoreAndClassify = (item: AppKnowledgeItem, isRoute: boolean): AppKnowledgeItem => {
    const refs = item.coverageRefs || [];
    const isLearnedRoute = _isLearnedRoute(refs);
    const isAuthEntry = refs.includes("intent:auth_entry") || refs.includes("endsAt:auth_gate");
    const isFunctional = !isLearnedRoute && !isAuthEntry;
    const isRejected = !item.trustedForReuse && (item.rejectedReason !== undefined);
    if (isLearnedRoute || isRoute) {
      item.routeSignature = _computeRouteSignature(item);
    }
    if (!isLearnedRoute && !isRoute && refs.length > 0) {
      item.coverageSignature = _computeCoverageSignature(item);
    }
    if (isLearnedRoute || isRoute) {
      item.knowledgeKind = isAuthEntry && !isFunctional ? "route_prefix" : "route_functional";
    } else if (isRejected) {
      item.knowledgeKind = "rejected_scenario";
    } else if (isFunctional && refs.length > 0) {
      item.knowledgeKind = refs.some(r => r.startsWith("option_") || r.startsWith("selection_flow_")) ? "scenario_validated" : "scenario_candidate";
    } else {
      item.knowledgeKind = "scenario_candidate";
    }
    let score = 0;
    if (item.knowledgeKind === "route_prefix") score += 40;
    else if (item.knowledgeKind === "route_functional") score += 30;
    else if (item.knowledgeKind === "scenario_validated") score += 20;
    if (refs.length > 0) score += 20;
    if (item.clickTargets.length > 0) score += 15;
    if (item.runCount >= 2) score += 10;
    if (item.trustedForReuse === false) score -= 50;
    if (item.rejectedReason) score -= 30;
    if (item.sourceQuality === "fallback") score -= 40;
    score = Math.max(-100, Math.min(100, score));
    item.confidenceScore = score;
    item.sourceQuality = score >= 40 ? "high" : score >= 10 ? "medium" : score >= -10 ? "low" : "fallback";
    item.validationStatus = score >= 10 ? "validated" : score < -30 ? "rejected" : "pending";
    let gatePassed = true;
    let gateReason = "";
    if (isLearnedRoute || isRoute) {
      if (item.validationStatus !== "validated") { gatePassed = false; gateReason = "validation_status_not_validated"; }
      else if (item.knowledgeKind !== "route_prefix" && item.knowledgeKind !== "route_functional") { gatePassed = false; gateReason = "wrong_knowledge_kind_for_route"; }
      else if ((item.confidenceScore ?? 0) < 50) { gatePassed = false; gateReason = "score_below_50"; }
      else if (!item.routeSignature) { gatePassed = false; gateReason = "missing_route_signature"; }
      else if ((item as any).containsRejectedTargets) { gatePassed = false; gateReason = "contains_rejected_targets"; }
      else if (item.sourceQuality === "fallback") { gatePassed = false; gateReason = "fallback_source"; }
      else { gateReason = "passed"; }
    } else {
      if (item.validationStatus !== "validated") { gatePassed = false; gateReason = "validation_status_not_validated"; }
      else if (item.knowledgeKind !== "scenario_validated") { gatePassed = false; gateReason = "wrong_knowledge_kind_for_scenario"; }
      else if ((item.confidenceScore ?? 0) < 40) { gatePassed = false; gateReason = "score_below_40"; }
      else if ((item.coverageRefs?.length ?? 0) === 0) { gatePassed = false; gateReason = "no_coverage_refs"; }
      else if (!item.coverageSignature) { gatePassed = false; gateReason = "missing_coverage_signature"; }
      else if (item.sourceQuality === "fallback") { gatePassed = false; gateReason = "fallback_source"; }
      else { gateReason = "passed"; }
    }
    item.trustedForReuse = gatePassed;
    item.successCount = item.runCount >= 2 ? item.runCount : 1;
    item.failureCount = item.knowledgeKind?.startsWith("rejected") ? 1 : 0;
    item.lastValidatedAt = now;
    if ((item as any)._isNew) {
      console.log(`[knowledge-classifier] item=${item.id} kind=${item.knowledgeKind} trusted=${item.trustedForReuse} score=${score} gate=${gateReason}`);
    }
    return item;
  };

  if (existing && existing.items.length > 0) {
    // Cleanup: remove items with empty coverageRefs or invalid source
    let removedNoCoverageRef = 0;
    let removedSource = 0;
    let removedOutOfContractTargets = 0;
    const baseItems = existing.items.filter(item => {
      if (!item.coverageRefs || item.coverageRefs.length === 0) {
        removedNoCoverageRef++;
        return false;
      }
      if (item.source !== "scenario_derived") {
        removedSource++;
        return false;
      }
      return true;
    });

    if (removedNoCoverageRef > 0 || removedSource > 0) {
      console.log(`[app-knowledge] cleanup removedNoCoverageRef=${removedNoCoverageRef} removedInvalidSource=${removedSource} kept=${baseItems.length}`);
    }

    // Pre-check: find canonical private route and identify duplicate learned_path items
    // before any preservation filters can rescue them.
    const removedDuplicateRouteIds = new Set<string>();
    {
      // Find canonical private route in baseItems
      let canonicalId: string | null = null;
      let canonicalTargets: string[] = [];
      let canonicalEndsAt: string | null = null;
      for (const item of baseItems) {
        if (!_isLearnedRoute(item.coverageRefs)) continue;
        if (!item.id.startsWith("rp_learned_")) continue;
        const cRefAccess = item.coverageRefs.find(r => r.startsWith("accessLevel:"));
        if (cRefAccess !== "accessLevel:private") continue;
        canonicalId = item.id;
        canonicalEndsAt = item.coverageRefs.find(r => r.startsWith("endsAt:")) || null;
        canonicalTargets = (item.clickTargets || []).map(t => normalizeTargetForDedupe(t));
        break;
      }

      // If no private learned route in baseItems, build virtual canonical from routeProfile
      if (!canonicalId && routeProfile) {
        const rp = routeProfile as any;
        const rpAccessMode = rp._accessMode || rp.accessMode || "";
        if (rpAccessMode === "private") {
          const rpTargets: string[] = [];
          for (const step of (rp._entryPath as any[]) || []) {
            if (step?.target) rpTargets.push(normalizeTargetForDedupe(step.target));
          }
          for (const step of (rp._authenticatedPathArr as any[]) || []) {
            if (step?.target) rpTargets.push(normalizeTargetForDedupe(step.target));
          }
          if (rp._selectionTarget) rpTargets.push(normalizeTargetForDedupe(rp._selectionTarget));
          if (rpTargets.length > 0) {
            canonicalTargets = rpTargets;
            canonicalId = `routeProfile:${rpAccessMode}_${rp._intent || "balance_inquiry"}`;
            canonicalEndsAt = "endsAt:functional_area";
          }
        }
      }

      if (canonicalId && canonicalTargets.length > 0) {
        const canonicalSet = new Set(canonicalTargets);
        const lastCanonicalTarget = canonicalTargets[canonicalTargets.length - 1];
        const canonicalTargetsStr = canonicalTargets.join(" || ");
        for (const item of baseItems) {
          if (item.id === canonicalId) continue;
          if (!_isLearnedRoute(item.coverageRefs)) continue;
          if (!item.id.startsWith("learned_path_")) continue;
          const dRefAccess = item.coverageRefs.find(r => r.startsWith("accessLevel:"));
          const dRefIntent = item.coverageRefs.find(r => r.startsWith("intent:"));
          const isAuthNonPrivate = dRefAccess && dRefAccess !== "accessLevel:private";
          const isValidLearnedIntent = dRefIntent && (
            dRefIntent.endsWith("informational") || dRefIntent.endsWith("transactional") || dRefIntent.endsWith("menu_entry")
          );
          const dEndsAt = item.coverageRefs.find(r => r.startsWith("endsAt:")) || null;
          const sameEndsAt = canonicalEndsAt && dEndsAt && canonicalEndsAt === dEndsAt;
          const itemTargets: string[] = (item.clickTargets || []).map(t => normalizeTargetForDedupe(t));
          const usedTargets = itemTargets.length;
          const overlap = itemTargets.filter(t => canonicalSet.has(t)).length;
          const lastItemTarget = itemTargets.length > 0 ? itemTargets[itemTargets.length - 1] : null;
          const sharesLastTarget = lastCanonicalTarget && lastItemTarget === lastCanonicalTarget;
          const hasOverlap = overlap >= 2;
          const decision = isAuthNonPrivate && isValidLearnedIntent && (sameEndsAt || sharesLastTarget || hasOverlap);
          const refsStr = item.coverageRefs.join(", ");
          const targetsStr = itemTargets.join(" || ");
          console.log(`[route-learning] duplicateCheck id="${item.id}" refs="${refsStr}" issue="${item.issueKey || ""}" normalizedTargets="${targetsStr}" canonical="${canonicalId}" canonicalTargets="${canonicalTargetsStr}" canonicalEndsAt="${canonicalEndsAt}" itemEndsAt="${dEndsAt}" decision="${decision ? "remove" : "keep"}" reason="${decision ? "trusted_private_route_exists" : "conditions_not_met"} auth=${isAuthNonPrivate} intent=${isValidLearnedIntent} sameEndsAt=${sameEndsAt} lastTargetMatch=${sharesLastTarget} overlap=${overlap}/${usedTargets}`);
          if (decision) {
            removedDuplicateRouteIds.add(item.id);
            console.log(`[route-learning] removedDuplicateLearnedRoute duplicate="${item.id}" canonical="${canonicalId}" reason=trusted_private_route_exists`);
          }
        }
        if (removedDuplicateRouteIds.size > 0) {
          console.log(`[route-learning] removedDuplicateLearnedRoutes count=${removedDuplicateRouteIds.size} canonical="${canonicalId}"`);
        }
      } else {
        console.log(`[route-learning] duplicateCheckSkipped canonicalId=${canonicalId} targets=${canonicalTargets.length}`);
      }
    }

    // Separate historical items (different issueKey) from current issue items
    // Historical items are preserved based on structural validity only, not against current contract
    let historicalPreserved = 0;
    let removedCurrentOutOfContract = 0;
    let removedHistoricalOutOfContract = 0;
    let preservedLearnedRoutes = 0;
    const filteredItems = baseItems.filter(item => {
      // Learned routes marked as duplicates are excluded before preservation
      if (removedDuplicateRouteIds.has(item.id)) return false;
      // Preserve learned navigation routes unconditionally (they are app-global routes, not HU-scoped)
      if (_isLearnedRoute(item.coverageRefs)) {
        preservedLearnedRoutes++;
        return true;
      }
      const isHistorical = currentIssueKey && item.issueKey !== currentIssueKey;
      if (isHistorical) {
        // Preserve historical items if structurally valid (source, coverageRefs, steps already checked above)
        historicalPreserved++;
        return true;
      }
      // Current issue items: validate against allowedKnowledgeTerms (only if cleanup confidence is high)
      if (shouldCleanupCurrentIssue) {
        const outContractAssertions = item.assertionTargets.filter(t => {
          const tn = normalizeCompare(t);
          return !allowedKnowledgeTerms.assertions.some(at => tn.includes(at) || at.includes(tn));
        });
        const outContractNegatives = item.negativeAssertions.filter(t => {
          const tn = normalizeCompare(t);
          return !allowedKnowledgeTerms.negatives.some(nt => tn.includes(nt) || nt.includes(tn));
        });
        const outContractClicks = item.clickTargets.filter(t => {
          const tn = normalizeCompare(t);
          return !allowedKnowledgeTerms.clicks.some(ct => tn.includes(ct) || ct.includes(tn));
        });
        const outContractTitle = item.scenarioTitle ? !allowedKnowledgeTerms.assertions.some(at => {
          const tn = normalizeCompare(item.scenarioTitle);
          return tn.includes(at) || at.includes(tn);
        }) && !allowedKnowledgeTerms.clicks.some(ct => {
          const tn = normalizeCompare(item.scenarioTitle);
          return tn.includes(ct) || ct.includes(tn);
        }) : false;
        const allBad = [...outContractAssertions, ...outContractNegatives, ...outContractClicks];
        if (outContractTitle) allBad.push("__title_out_of_contract__");
        if (allBad.length > 0) {
          removedCurrentOutOfContract++;
          return false;
        }
      }
      return true;
    });
    if (historicalPreserved > 0) {
      console.log(`[app-knowledge] cleanup preservedHistoricalItems=${historicalPreserved}`);
    }
    if (removedCurrentOutOfContract > 0 || removedHistoricalOutOfContract > 0) {
      console.log(`[app-knowledge] cleanup removedOutOfContractTargets currentIssue=${removedCurrentOutOfContract} historical=${removedHistoricalOutOfContract} kept=${filteredItems.length}`);
    }
    if (preservedLearnedRoutes > 0) {
      console.log(`[app-knowledge] cleanup preservedLearnedRoutes=${preservedLearnedRoutes}`);
    }

    // Also remove existing items that are incomplete option_flow routes
    // (missing the required initialAction from the contract)
    // Only applies to current issue items; historical items are preserved
    let removedIncompleteRoute = 0;
    let historicalIncompletePreserved = 0;
    const entryAction = contract?.initialActions?.map(a => a.initialAction).find(Boolean);
    const entryActionNorm = entryAction?.normalize("NFC").toLowerCase().trim();
    const routeCompleteItems = filteredItems.filter(item => {
      if (removedDuplicateRouteIds.has(item.id)) return false;
      const isHistorical = currentIssueKey && item.issueKey !== currentIssueKey;
      if (isHistorical) {
        historicalIncompletePreserved++;
        return true;
      }
      if (!entryActionNorm) return true;
      // Learned navigation routes are app-global, not HU-scoped option flows
      if (_isLearnedRoute(item.coverageRefs)) return true;
      const isOptionItem = item.coverageRefs.some(r => r.startsWith("option_")) || item.optionLabels.length > 0;
      if (!isOptionItem) return true;
      const stepsLower = (item.steps || []).map(s => s.normalize("NFC").toLowerCase());
      const hasEntry = stepsLower.some(s => s.includes(entryActionNorm));
      if (!hasEntry) {
        removedIncompleteRoute++;
        return false;
      }
      return true;
    });
    if (historicalIncompletePreserved > 0) {
      console.log(`[app-knowledge] cleanup preservedHistoricalIncompleteRoutes=${historicalIncompletePreserved}`);
    }
    if (removedIncompleteRoute > 0) {
      console.log(`[app-knowledge] cleanup removedIncompleteRoute=${removedIncompleteRoute} kept=${routeCompleteItems.length}`);
    }

    // When route is blocked: remove all current-issue items that aren't learned navigation routes.
    // If the HU cannot resolve to a compatible route, no functional scenarios for that issue are valid.
    let removedBlockedCurrentIssue = 0;
    let preservedLearnedRoutesBlocked = 0;
    let preservedOtherHistoricalBlocked = 0;
    const blockedFilteredItems = routeCompleteItems.filter(item => {
      if (!routeResolutionBlocked || !currentIssueKey || item.issueKey !== currentIssueKey) {
        if (_isLearnedRoute(item.coverageRefs)) preservedLearnedRoutesBlocked++;
        if (currentIssueKey && item.issueKey !== currentIssueKey) preservedOtherHistoricalBlocked++;
        return true;
      }
      if (_isSharedOrAuthRoute(item)) {
        preservedLearnedRoutesBlocked++;
        console.log(`[app-knowledge] cleanupCurrentIssue preserved item=${item.id} issue=${item.issueKey} reason=shared_or_learned_route`);
        return true;
      }
      // Skip aggressive removal when cleanup confidence is low (unless forced by rejected route)
      if (!shouldCleanupCurrentIssue) return true;
      removedBlockedCurrentIssue++;
      return false;
    });
    if (routeResolutionBlocked) {
      const totalCurrentIssue = routeCompleteItems.filter(i => i.issueKey === currentIssueKey).length;
      console.log(`[app-knowledge] cleanupCurrentIssue start issue=${currentIssueKey} items=${totalCurrentIssue}`);
      const cleanupReason = canForceCleanupByRejectedRoute ? "rejected_route_profile_target" : "out_of_hu_contract";
      if (removedBlockedCurrentIssue > 0 || canForceCleanupByRejectedRoute) {
        console.log(`[app-knowledge] cleanupCurrentIssue removed=${removedBlockedCurrentIssue} kept=${blockedFilteredItems.length} reason=${cleanupReason}`);
      }
      console.log(`[app-knowledge] cleanupCurrentIssue skippedHistoricalRoutes=${preservedLearnedRoutesBlocked + preservedOtherHistoricalBlocked}`);
      console.log(`[app-knowledge] learningSkipped issue=${currentIssueKey} reason=route_resolution_blocked`);
    }

    // Semantic dedup: group by (appSlug + issueKey + normalizedSteps), keep one per group
    const semanticMap = new Map<string, AppKnowledgeItem>();
    let removedDuplicates = 0;
    for (const item of blockedFilteredItems) {
      const sk = semanticStepsKey(item.issueKey, item.steps);
      const existing = semanticMap.get(sk);
      if (existing) {
        // Prefer item with non-empty coverageRefs; otherwise keep first
        if (existing.coverageRefs.length === 0 && item.coverageRefs.length > 0) {
          semanticMap.set(sk, item);
        }
        // Merge metadata
        const keeper = semanticMap.get(sk)!;
        keeper.runCount = Math.max(keeper.runCount || 1, item.runCount || 1);
        if (item.createdAt < keeper.createdAt) keeper.createdAt = item.createdAt;
        if (item.lastSeenAt > keeper.lastSeenAt) keeper.lastSeenAt = item.lastSeenAt;
        removedDuplicates++;
      } else {
        semanticMap.set(sk, item);
      }
    }
    if (removedDuplicates > 0) {
      console.log(`[app-knowledge] cleanup removedDuplicates=${removedDuplicates} kept=${semanticMap.size}`);
    }

    // CoverageRef-based dedup: for items with same issueKey and same primary coverageRef,
    // prefer the one with the most complete route (more steps, including entry action)
    const refGroups = new Map<string, AppKnowledgeItem[]>();
    for (const item of semanticMap.values()) {
      if (item.coverageRefs.length > 0) {
        const key = `${item.issueKey}::${item.coverageRefs[0]}`;
        if (!refGroups.has(key)) refGroups.set(key, []);
        refGroups.get(key)!.push(item);
      }
    }
    let removedSubsetDuplicates = 0;
    const dedupedByRef = new Map<string, AppKnowledgeItem>();
    for (const [key, items] of refGroups) {
      if (items.length <= 1) {
        for (const item of items) dedupedByRef.set(item.id, item);
        continue;
      }
      // Find the most complete item (most steps)
      items.sort((a, b) => b.steps.length - a.steps.length);
      const best = items[0];
      dedupedByRef.set(best.id, best);
      for (let i = 1; i < items.length; i++) {
        const subset = items[i];
        const isSubset = subset.steps.every(ss =>
          best.steps.some(bs => normalizeCompare(bs).includes(normalizeCompare(ss)))
        );
        if (isSubset) {
          best.runCount = Math.max(best.runCount || 1, subset.runCount || 1);
          if (subset.createdAt < best.createdAt) best.createdAt = subset.createdAt;
          removedSubsetDuplicates++;
        } else {
          dedupedByRef.set(subset.id, subset);
        }
      }
    }
    // Add items without coverageRefs (shouldn't exist at this point but be safe)
    for (const item of semanticMap.values()) {
      if (!item.coverageRefs || item.coverageRefs.length === 0) {
        dedupedByRef.set(item.id, item);
      }
    }
    if (removedSubsetDuplicates > 0) {
      console.log(`[app-knowledge] cleanup removedSubsetDuplicates=${removedSubsetDuplicates}`);
    }

    for (const item of dedupedByRef.values()) {
      existingMap.set(item.id, item);
    }
    console.log(`[app-knowledge] cleanup kept=${existingMap.size}`);

    // Score and classify existing items
    for (const item of existingMap.values()) {
      if (!item.knowledgeKind) _scoreAndClassify(item, _isLearnedRoute(item.coverageRefs));
    }
  }

  // Early exit: if no new data and no cleanup trigger, skip write
  if (!hasScenarioData && !hasRouteProfileData && !hasCleanupTrigger) {
    console.log(`[app-knowledge] written path=none reason=no_valid_scenarios`);
    return { added: 0, updated: 0, unchanged: 0, total: 0, skipped };
  }

  // Build new items from final scenarios
  const newItems: AppKnowledgeItem[] = [];
  let skippedNoCoverageRef = 0;
  let skippedOutOfContractTargets = 0;
  let skippedIncompleteRoute = 0;

  for (const sc of finalScenarios) {
    const steps = (sc.steps || []).map(stripStepNumber).filter(Boolean);
    if (steps.length === 0) continue;

    const normalizedSteps = steps.map(s => normalizeForHash(s));
    const id = computeStableId(appSlug, sc.sourceIssueKey, normalizedSteps);

    const flow = findMatchingOptionFlow(steps, sc.title || "", optionFlows);
    const scenarioText = [sc.title, ...steps].join(" ");

    const coverageRefs = (sc as any).coverageRefs?.length > 0
      ? (sc as any).coverageRefs
      : findCoverageRefs(sc.title || "", steps, flow?.optionLabel ? [flow.optionLabel] : [], contract, routeProfile);
    if (coverageRefs.length > 0) {
      console.log(`[scenario-coverage] assignedCoverageRefs scenario="${(sc.title || "").substring(0, 60)}" refs=${coverageRefs.length}`);
    }
    const item: AppKnowledgeItem = {
      id,
      source: "scenario_derived",
      issueKey: sc.sourceIssueKey,
      scenarioTitle: sc.title || "",
      coverageRefs,
      steps,
      clickTargets: extractClickTargets(steps),
      assertionTargets: extractAssertionTargets(steps),
      negativeAssertions: extractNegativeAssertions(steps),
      optionLabels: flow?.optionLabel ? [flow.optionLabel] : [],
      authTerms: extractAuthTerms(scenarioText, flow),
      manual: false,
      confidence: "scenario_derived",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      runCount: 1,
    };

    // Normalize clickTargets for all items: lower, trim, strip diacritics, collapse spaces
    const normalizedTargets = item.clickTargets
      .map(t => normalizeTargetForDedupe(t))
      .filter((t, i, arr) => t.length > 0 && (i === 0 || t !== arr[i - 1]));
    const removedDups = item.clickTargets.length - normalizedTargets.length;
    if (removedDups > 0) {
      console.log(`[app-knowledge] normalizedItemSteps removedDuplicateTargets=${removedDups} for issue=${item.issueKey}`);
    }
    item.clickTargets = normalizedTargets;

    // Only save items that map to at least one Coverage Contract item.
    // Extra AI-generated scenarios (detail pages, product sections, etc.)
    // without contract backing are excluded.
    if (item.coverageRefs.length === 0) {
      skippedNoCoverageRef++;
      console.log(`[app-knowledge] skippedNoCoverageRef scenario="${item.scenarioTitle}" issue=${item.issueKey} reason=no_coverage_refs`);
      continue;
    }

    // Validate all targets against allowed knowledge terms from the contract.
    // If any assertionTarget, negativeAssertion, or clickTarget falls outside
    // the contract's scope, reject the item to avoid memory contamination.
    const outOfContractAssertions = item.assertionTargets.filter(t => {
      const tn = normalizeTerm(t);
      return !allowedKnowledgeTerms.assertions.some(at => tn.includes(at) || at.includes(tn));
    });
    const outOfContractNegatives = item.negativeAssertions.filter(t => {
      const tn = normalizeTerm(t);
      return !allowedKnowledgeTerms.negatives.some(nt => tn.includes(nt) || nt.includes(tn));
    });
    const outOfContractClicks = item.clickTargets.filter(t => {
      const tn = normalizeTerm(t);
      return !allowedKnowledgeTerms.clicks.some(ct => tn.includes(ct) || ct.includes(tn));
    });

    const allOutOfContract = [...outOfContractAssertions, ...outOfContractNegatives, ...outOfContractClicks];
    if (allOutOfContract.length > 0) {
      // If scenario has coverageRefs and uses a private trusted routeProfile,
      // degrade to warning instead of hard rejection — the terms come from HU/routeProfile.
      const isTrustedPrivate = item.coverageRefs.length > 0 && routeProfile &&
        (routeProfile as any)._accessMode === "private";
      if (isTrustedPrivate) {
        console.log(`[app-knowledge] outOfContractWarning scenario="${item.scenarioTitle}" terms="${allOutOfContract.join(', ')}" action=kept reason=trusted_private_route_with_coverage`);
      } else {
        skippedOutOfContractTargets++;
        console.log(`[app-knowledge] skippedOutOfContractTargets scenario="${item.scenarioTitle}" terms="${allOutOfContract.join(", ")}"`);
        continue;
      }
    }

    // Reject incomplete option_flow routes: if the contract has an initialAction
    // and this is an option_flow scenario, verify the route starts from the entry point.
    const isOptionFlowItem = item.optionLabels.length > 0 || item.coverageRefs.some(ref => ref.startsWith("option_"));
    if (isOptionFlowItem && contract) {
      const entryAction = contract.initialActions
        .map(a => a.initialAction)
        .find(Boolean)?.normalize("NFC").toLowerCase().trim();
      if (entryAction) {
        const stepsLower = item.steps.map(s => s.normalize("NFC").toLowerCase());
        const hasEntryClick = stepsLower.some(s => s.includes(entryAction));
        if (!hasEntryClick) {
          skippedIncompleteRoute++;
          console.log(`[app-knowledge] skippedIncompleteRoute scenario="${item.scenarioTitle}" missing="${entryAction}"`);
          continue;
        }
      }
    }

    newItems.push(item);
    _scoreAndClassify(item, false);
  }

  console.log(`[app-knowledge] skippedNoCoverageRef count=${skippedNoCoverageRef}`);
  console.log(`[app-knowledge] skippedOutOfContractTargets count=${skippedOutOfContractTargets}`);
  if (skippedIncompleteRoute > 0) console.log(`[app-knowledge] skippedIncompleteRoute count=${skippedIncompleteRoute}`);
  console.log(`[app-knowledge] acceptedAfterCoverageRefs count=${newItems.length}`);

  // --- General route learning: detect and persist reusable navigation paths ---
  const learnedRouteItems: AppKnowledgeItem[] = [];
  let routeSkippedNoClick = 0;
  let routePersisted = 0;
  const routeDedupeSeen = new Set<string>();

  for (const item of newItems) {
    if (item.clickTargets.length === 0) {
      routeSkippedNoClick++;
      continue;
    }

    // If a trusted private routeProfile already exists for this path, skip
    // creating duplicate learned routes from functional scenarios.
    if (routeProfile) {
      const rp = routeProfile as any;
    const rpAccessMode = rp._accessMode || rp.accessMode || "";
    if (rpAccessMode === "private") {
        const knownTargets: string[] = [];
        for (const step of (rp._entryPath as any[]) || []) {
          if (step?.target) knownTargets.push(normalizeTargetForDedupe(step.target));
        }
        for (const step of (rp._authenticatedPathArr as any[]) || []) {
          if (step?.target) knownTargets.push(normalizeTargetForDedupe(step.target));
        }
        if (rp._selectionTarget) knownTargets.push(normalizeTargetForDedupe(rp._selectionTarget));
        if (knownTargets.length > 0) {
          const itemTargets = item.clickTargets.map(t => normalizeTargetForDedupe(t));
          const isSubset = itemTargets.every(t => knownTargets.some(kt => kt === t));
          if (isSubset) {
            console.log(`[route-learning] skippedDuplicateFunctionalRoute scenario="${item.scenarioTitle}" reason=trusted_private_route_exists`);
            continue;
          }
        }
      }
    }

    // Find matching option flows: first by optionLabels, then fallback by steps/title
    let matchingFlows = optionFlows.filter(f => item.optionLabels.includes(f.optionLabel));
    if (matchingFlows.length === 0) {
      const stepText = [...item.steps, item.scenarioTitle].join(" ").toLowerCase().normalize("NFC");
      matchingFlows = optionFlows.filter(f => {
        if (!f.optionLabel) return false;
        const label = f.optionLabel.toLowerCase().normalize("NFC");
        return stepText.includes(label);
      });
    }

    const accessLevel = _classifyAccessLevel(item, matchingFlows, contract);
    const intent = _classifyIntent(item, matchingFlows, contract);
    const startsFrom = _classifyStartsFrom(item, contract);
    const endsAt = _classifyEndsAt(item, matchingFlows, contract);

    // Normalize click targets: lower, trim, strip diacritics, collapse spaces
    const normalizedTargets = item.clickTargets
      .map(t => normalizeTargetForDedupe(t))
      .filter((t, i, arr) => t.length > 0 && (i === 0 || t !== arr[i - 1]));
    const removedDuplicateTargets = item.clickTargets.length - normalizedTargets.length;

    // Determine confidence: if generationSource indicates fallback/repair, mark accordingly
    let routeConfidence: "scenario_derived" = "scenario_derived";

    // Dedupe by appSlug + normalized clickTargets + accessLevel + intent + endsAt
    const clickPath = normalizedTargets.join("::");
    const dedupeKey = `${appSlug}::${clickPath}::${accessLevel}::${intent}::${endsAt}`;
    if (routeDedupeSeen.has(dedupeKey)) continue;
    routeDedupeSeen.add(dedupeKey);

    const routeId = `learned_path_${Math.abs(dedupeKey.split("").reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0)).toString(36)}`;

    // Log classification from option flow (Tarea 4)
    if (matchingFlows.length > 0) {
      const f = matchingFlows[0];
      console.log(`[route-learning] classifiedFromOptionFlow requiresAuth=${f.requiresAuth} accessLevel=${accessLevel} intent=${intent}`);
    }

    if (removedDuplicateTargets > 0) {
      console.log(`[route-learning] normalizedRouteSteps removedDuplicateTargets=${removedDuplicateTargets}`);
    }

    const learnedRouteItem: AppKnowledgeItem = {
      id: routeId,
      source: "scenario_derived",
      issueKey: item.issueKey,
      scenarioTitle: `Ruta ${accessLevel}/${intent}: ${item.optionLabels.join(", ") || item.clickTargets.join(" → ")}`,
      coverageRefs: [
        "learned_navigation_path",
        `accessLevel:${accessLevel}`,
        `intent:${intent}`,
        `startsFrom:${startsFrom}`,
        `endsAt:${endsAt}`,
      ],
      steps: item.steps,
      clickTargets: normalizedTargets,
      assertionTargets: item.assertionTargets,
      negativeAssertions: item.negativeAssertions,
      optionLabels: item.optionLabels,
      authTerms: item.authTerms,
      manual: false,
      confidence: routeConfidence,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      runCount: 1,
      destinationSignals: Array.isArray((routeProfile as any)?._terminalSignals)
        ? (routeProfile as any)._terminalSignals
        : undefined,
    };

    learnedRouteItems.push(learnedRouteItem);
    _scoreAndClassify(learnedRouteItem, true);
    routePersisted++;
    console.log(`[route-learning] candidate issue=${item.issueKey} scenario="${item.scenarioTitle}" accessLevel=${accessLevel} intent=${intent} steps=${item.steps.length} confidence=scenario_derived`);
  }

  if (routePersisted > 0) {
    console.log(`[route-learning] persisted appSlug=${appSlug} items=${routePersisted}`);
  }
  if (routeSkippedNoClick > 0) {
    console.log(`[route-learning] skipped reason=no_click_targets count=${routeSkippedNoClick}`);
  }

  // Add learned routes to newItems for persistence
  for (const lr of learnedRouteItems) {
    newItems.push(lr);
  }

  // --- Route Profile Functional Route: persist confirmed authenticated path from app.config ---
  if (routeProfile) {
    const rp = routeProfile as any;
    const accessMode = rp._accessMode as string | undefined;
    const intent = rp._intent as string | undefined;
    const selectionTarget = rp._selectionTarget as string | undefined;
    const entryPath = rp._entryPath as Array<{ action: string; target: string }> | undefined;
    const authPath = rp._authenticatedPathArr as Array<{ action: string; target: string }> | undefined;
    const rpSource = rp._rpSource as string | undefined;
    const rpConfidence = rp._rpConfidence as string | undefined;
    const terminalSignals = rp._terminalSignals as string[] | undefined;
    const detailAssertions = rp._detailAssertions as string[] | undefined;
    const hasValidAuthPath = accessMode === "private" &&
      entryPath && entryPath.length > 0 &&
      authPath && authPath.length > 0 &&
      selectionTarget;

    if (hasValidAuthPath) {
      // Build click targets from entryPath + authenticatedPath
      const entryClicks = entryPath
        .filter(s => s?.action === "click" && s?.target)
        .map(s => s.target);
      const authClicks = authPath
        .filter(s => s?.action === "click" && s?.target)
        .map(s => s.target);
      const clickTargets = [...entryClicks, ...authClicks];

      // Build steps: Clic en each target, then selection, then terminal validations
      const steps: string[] = clickTargets.map(t => `Clic en "${t}"`);
      if (selectionTarget) {
        steps.push(`Seleccionar el primer ${selectionTarget.toLowerCase()} visible del listado.`);
      }
      if (terminalSignals && terminalSignals.length > 0) {
        for (const sig of terminalSignals) {
          steps.push(`Validar que se muestre "${sig}"`);
        }
      }

      // Build stable dedupe key: accessMode + intent + normalized click path
      const normPath = clickTargets.map(t => normalizeCompare(t)).join("::");
      const dedupeKey = `__rp_route__${appSlug}::${normPath}::${accessMode}::${intent || "unknown"}`;
      const routeId = `rp_learned_${Math.abs(dedupeKey.split("").reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0)).toString(36)}`;

      // Coverage refs: technical navigation refs, not functional
      const startsFrom = "authenticated_home";
      const endsAt = terminalSignals && terminalSignals.length > 0 ? "business_detail" :
        authClicks.length > 0 ? "business_list" : "authenticated_area";
      const coverageRefs = [
        "learned_navigation_path",
        `accessLevel:${accessMode}`,
        `intent:${intent || "unknown"}`,
        `startsFrom:${startsFrom}`,
        `endsAt:${endsAt}`,
      ];

      const rpLearnedItem: AppKnowledgeItem = {
        id: routeId,
        source: "scenario_derived",
        issueKey: currentIssueKey || "app_config",
        scenarioTitle: `Ruta ${accessMode}/${intent || "unknown"}: ${clickTargets.join(" → ")}`,
        coverageRefs,
        steps,
        clickTargets,
        assertionTargets: [...(detailAssertions || terminalSignals || [])],
        negativeAssertions: [],
        optionLabels: selectionTarget ? [selectionTarget] : [],
        authTerms: accessMode === "private" ? ["autenticación"] : [],
        manual: false,
        confidence: "scenario_derived",
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        runCount: 1,
      };

      // Dedupe by checking existingMap (loaded from knowledge file)
      const existingLinks = Array.from(existingMap.values())
        .filter(i => _isLearnedRoute(i.coverageRefs) && i.clickTargets.length > 0);
      const existingMatch = existingLinks.find(i => {
        const iNorm = i.clickTargets.map(t => normalizeCompare(t)).join("::");
        return normalizeCompare(iNorm) === normalizeCompare(normPath);
      });

      if (existingMatch) {
        // Update existing: bump runCount, lastSeenAt, confidence/source
        existingMatch.updatedAt = now;
        existingMatch.lastSeenAt = now;
        existingMatch.runCount = (existingMatch.runCount || 0) + 1;
        if (rpSource === "user_confirmed") existingMatch.source = "scenario_derived"; // keep type
        if (rpConfidence === "high") existingMatch.confidence = "scenario_derived";
        // Merge assertion targets without duplicates
        for (const at of rpLearnedItem.assertionTargets) {
          if (!existingMatch.assertionTargets.includes(at)) {
            existingMatch.assertionTargets.push(at);
          }
        }
        // If existing has no selection step but profile has selectionTarget, add it
        const hasSelection = existingMatch.steps.some(s => /seleccionar.*visible del listado/i.test(s));
        if (selectionTarget && !hasSelection) {
          const insertAfter = existingMatch.steps.length;
          existingMatch.steps.push(`Seleccionar el primer ${selectionTarget.toLowerCase()} visible del listado.`);
          // Update clickTargets too
          if (!existingMatch.clickTargets.includes(selectionTarget)) {
            existingMatch.clickTargets.push(selectionTarget);
          }
        }
        console.log(`[app-knowledge] learnedFunctionalRouteUpsert action=updated id=${routeId}`);
        rpUpdatedCount++;
      } else {
        existingMap.set(routeId, rpLearnedItem);
        _scoreAndClassify(rpLearnedItem, true);
        console.log(`[app-knowledge] learnedFunctionalRouteUpsert action=added id=${routeId}`);
        rpAddedCount++;
      }
      console.log(`[app-knowledge] learnedFunctionalRouteCandidate source=routeProfile accessMode=${accessMode} intent=${intent || "unknown"} steps=${steps.length}`);
    } else {
      console.log(`[app-knowledge] learnedFunctionalRouteSkipped reason=missing_authenticated_path_data`);
    }
  }

  // --- Task 1: Remove duplicate learned_path items when a canonical private route exists ---
  // Works with or without routeProfile: finds canonical by accessLevel:private in existingMap.
  const removedDuplicateRouteIds = new Set<string>();
  {
    // Find the canonical private learned route (from routeProfile upsert OR knowledge file)
    let canonicalId: string | null = null;
    let canonicalTargets: string[] = [];
    let canonicalEndsAt: string | null = null;
    for (const [id, item] of existingMap.entries()) {
      if (!_isLearnedRoute(item.coverageRefs)) continue;
      if (!id.startsWith("rp_learned_")) continue;
      const cRefAccess = item.coverageRefs.find(r => r.startsWith("accessLevel:"));
      if (cRefAccess !== "accessLevel:private") continue;
      canonicalId = id;
      canonicalEndsAt = item.coverageRefs.find(r => r.startsWith("endsAt:")) || null;
      canonicalTargets = (item.clickTargets || []).map(t => normalizeTargetForDedupe(t));
      break;
    }

    // If no private learned route in existingMap, build virtual canonical from routeProfile
    if (!canonicalId && routeProfile) {
      const rp = routeProfile as any;
      const rpAccessMode = rp._accessMode || rp.accessMode || "";
      if (rpAccessMode === "private") {
        const rpTargets: string[] = [];
        for (const step of (rp._entryPath as any[]) || []) {
          if (step?.target) rpTargets.push(normalizeTargetForDedupe(step.target));
        }
        for (const step of (rp._authenticatedPathArr as any[]) || []) {
          if (step?.target) rpTargets.push(normalizeTargetForDedupe(step.target));
        }
        if (rp._selectionTarget) rpTargets.push(normalizeTargetForDedupe(rp._selectionTarget));
        if (rpTargets.length > 0) {
          canonicalTargets = rpTargets;
          canonicalId = `routeProfile:${rpAccessMode}_${rp._intent || "balance_inquiry"}`;
          canonicalEndsAt = "endsAt:functional_area";
        }
      }
    }

    if (canonicalId && canonicalTargets.length > 0) {
      const canonicalSet = new Set(canonicalTargets);
      const lastCanonicalTarget = canonicalTargets[canonicalTargets.length - 1];
      const canonicalTargetsStr = canonicalTargets.join(" || ");
      let removedCount = 0;
      for (const [id, item] of existingMap.entries()) {
        if (id === canonicalId) continue;
        if (!_isLearnedRoute(item.coverageRefs)) continue;
        if (!id.startsWith("learned_path_")) continue;
        const dRefAccess = item.coverageRefs.find(r => r.startsWith("accessLevel:"));
        const dRefIntent = item.coverageRefs.find(r => r.startsWith("intent:"));
        const isAuthNonPrivate = dRefAccess && dRefAccess !== "accessLevel:private";
        const isValidLearnedIntent = dRefIntent && (
          dRefIntent.endsWith("informational") || dRefIntent.endsWith("transactional") || dRefIntent.endsWith("menu_entry")
        );
        const dEndsAt = item.coverageRefs.find(r => r.startsWith("endsAt:")) || null;
        const sameEndsAt = canonicalEndsAt && dEndsAt && canonicalEndsAt === dEndsAt;
        const itemTargets: string[] = (item.clickTargets || []).map(t => normalizeTargetForDedupe(t));
        const usedTargets = itemTargets.length;
        const overlap = itemTargets.filter(t => canonicalSet.has(t)).length;
        const lastItemTarget = itemTargets.length > 0 ? itemTargets[itemTargets.length - 1] : null;
        const sharesLastTarget = lastCanonicalTarget && lastItemTarget === lastCanonicalTarget;
        const hasOverlap = overlap >= 2;
        const decision = isAuthNonPrivate && isValidLearnedIntent && (sameEndsAt || sharesLastTarget || hasOverlap);
        const refsStr = item.coverageRefs.join(", ");
        const targetsStr = itemTargets.join(" || ");
        console.log(`[route-learning] duplicateCheck id="${id}" refs="${refsStr}" issue="${item.issueKey || ""}" normalizedTargets="${targetsStr}" canonical="${canonicalId}" canonicalTargets="${canonicalTargetsStr}" canonicalEndsAt="${canonicalEndsAt}" itemEndsAt="${dEndsAt}" decision="${decision ? "remove" : "keep"}" reason="${decision ? "trusted_private_route_exists" : "conditions_not_met"} auth=${isAuthNonPrivate} intent=${isValidLearnedIntent} sameEndsAt=${sameEndsAt} lastTargetMatch=${sharesLastTarget} overlap=${overlap}/${usedTargets}`);
        if (decision) {
          existingMap.delete(id);
          removedDuplicateRouteIds.add(id);
          removedCount++;
          console.log(`[route-learning] removedDuplicateLearnedRoute duplicate="${id}" canonical="${canonicalId}" reason=trusted_private_route_exists`);
        }
      }
      if (removedCount > 0) {
        console.log(`[route-learning] removedDuplicateLearnedRoutes count=${removedCount} canonical="${canonicalId}"`);
      }
    } else {
      console.log(`[route-learning] duplicateCheckSkipped canonicalId=${canonicalId} targets=${canonicalTargets.length}`);
    }
  }

  // --- Task 2: Correct coverageRefs on historical scenario items with list-only titles ---
  // Fix items that have selection_flow_0 but their title clearly describes a list scenario.
  // If an equivalent list_screen_0 item already exists (same clickTargets), remove the misclassified one.
  {
    let correctedCoverage = 0;
    let removedListDuplicate = 0;
    for (const [id, item] of existingMap.entries()) {
      if (_isLearnedRoute(item.coverageRefs)) continue;
      const title = item.scenarioTitle || "";
      if (!/visualiz(?:aci[oó]n|ar)|validar\s+.*listad|\blistad/i.test(title)) continue;
      if (/seleccionar|escoger|elegir|detalle|formato|opciones|alerta|falla|error|restringido|no\s+se\s+muestre|regresar|volver|bloqueo|inconsistencia|incompleto|indisponibilidad|ocultamiento|n[uú]mero\s+completo/i.test(title)) continue;
      if (!item.coverageRefs.some(r => /^selection_flow_\d+$/.test(r))) continue;
      // Check if an equivalent list_screen_0 item already exists with compatible clickTargets
      const itemClicks: string[] = (item.clickTargets || []).map(t => normalizeTargetForDedupe(t));
      let existingListId: string | null = null;
      for (const [oid, oitem] of existingMap.entries()) {
        if (oid === id) continue;
        if (_isLearnedRoute(oitem.coverageRefs)) continue;
        if (!oitem.coverageRefs.some(r => /^list_screen_\d+$/.test(r))) continue;
        const oClicks = (oitem.clickTargets || []).map(t => normalizeTargetForDedupe(t));
        if (oClicks.length === itemClicks.length && oClicks.every((t, i) => t === itemClicks[i])) {
          existingListId = oid;
          break;
        }
      }
      if (existingListId) {
        existingMap.delete(id);
        removedListDuplicate++;
        console.log(`[app-knowledge] removedDuplicateKnowledgeItem duplicate="${id}" canonical="${existingListId}" reason=list_screen_duplicate`);
      } else {
        const newRefs = item.coverageRefs.map(r => /^selection_flow_\d+$/.test(r) ? r.replace(/^selection_flow_\d+$/, "list_screen_0") : r);
        item.coverageRefs = newRefs;
        correctedCoverage++;
        console.log(`[app-knowledge] correctedCoverageRef scenario="${item.scenarioTitle}" from=selection_flow to=list_screen reason=list_only_title`);
      }
    }
    if (correctedCoverage > 0 || removedListDuplicate > 0) {
      console.log(`[app-knowledge] listScreenCleanup corrected=${correctedCoverage} removedDuplicate=${removedListDuplicate}`);
    }
  }

  // --- Task 2b: Correct coverageRefs on historical items with failure/negative/format/action/detail titles ---
  // These were misclassified as selection_flow_0 in prior runs; fix by title priority.
  {
    let correctedFailure = 0;
    let correctedNegative = 0;
    let correctedFormat = 0;
    let correctedAction = 0;
    let correctedDetail = 0;
    for (const [id, item] of existingMap.entries()) {
      if (_isLearnedRoute(item.coverageRefs)) continue;
      if (!item.coverageRefs.some(r => /^selection_flow_\d+$/.test(r))) continue;
      const title = item.scenarioTitle || "";
      if (/no\s+se\s+presenta|no\s+existe|no\s+disponible|indisponibilidad|falla|error|no\s+fue\s+posible|incompleto|falta\s+informaci[oó]n|no\s+seleccionable/i.test(title)) {
        const newRefs = item.coverageRefs.map(r => /^selection_flow_\d+$/.test(r) ? r.replace(/^selection_flow_\d+$/, "failure_case_0") : r);
        item.coverageRefs = newRefs;
        correctedFailure++;
        console.log(`[app-knowledge] correctedCoverageRef scenario="${item.scenarioTitle}" from=selection_flow_0 to=failure_case_0 reason=title_priority`);
      } else if (/no\s+exponer|n[uú]mero\s+completo|no\s+se\s+muestre|no\s+mostrar|no\s+visualizar|contenido\s+restringido|ocultamiento|restringido/i.test(title)) {
        const newRefs = item.coverageRefs.map(r => /^selection_flow_\d+$/.test(r) ? r.replace(/^selection_flow_\d+$/, "negative_rule_0") : r);
        item.coverageRefs = newRefs;
        correctedNegative++;
        console.log(`[app-knowledge] correctedCoverageRef scenario="${item.scenarioTitle}" from=selection_flow_0 to=negative_rule_0 reason=title_priority`);
      } else if (/formato|formatos|moneda|porcentaje|tasa|fecha|enmascarad[ao]/i.test(title)) {
        const newRefs = item.coverageRefs.map(r => /^selection_flow_\d+$/.test(r) ? r.replace(/^selection_flow_\d+$/, "format_rule_0") : r);
        item.coverageRefs = newRefs;
        correctedFormat++;
        console.log(`[app-knowledge] correctedCoverageRef scenario="${item.scenarioTitle}" from=selection_flow_0 to=format_rule_0 reason=title_priority`);
      } else if (/opciones|acciones|volver|regresar|retorno|posterior(?:es)?|men[uú]\s+principal|finalizar\s+sesi[oó]n|imprimir|enviar/i.test(title)) {
        const newRefs = item.coverageRefs.map(r => /^selection_flow_\d+$/.test(r) ? r.replace(/^selection_flow_\d+$/, "action_options_0") : r);
        item.coverageRefs = newRefs;
        correctedAction++;
        console.log(`[app-knowledge] correctedCoverageRef scenario="${item.scenarioTitle}" from=selection_flow_0 to=action_options_0 reason=title_priority`);
      } else if (/campos\s+principales|campos\s+del\s+detalle|campos\s+requeridos|detalle\s+del|validar\s+campos/i.test(title) &&
          !/formato|formatos|moneda|porcentaje|tasa|fecha|enmascarad[ao]/i.test(title) &&
          !/opciones|acciones|volver|regresar|retorno|posterior(?:es)?|men[uú]\s+principal|finalizar\s+sesi[oó]n|imprimir|enviar/i.test(title)) {
        const newRefs = item.coverageRefs.map(r => /^selection_flow_\d+$/.test(r) ? r.replace(/^selection_flow_\d+$/, "detail_fields_0") : r);
        item.coverageRefs = newRefs;
        correctedDetail++;
        console.log(`[app-knowledge] correctedCoverageRef scenario="${item.scenarioTitle}" from=selection_flow_0 to=detail_fields_0 reason=title_priority`);
      }
    }
    if (correctedFailure > 0 || correctedNegative > 0 || correctedFormat > 0 || correctedAction > 0 || correctedDetail > 0) {
      console.log(`[app-knowledge] titlePriorityCleanup failure=${correctedFailure} negative=${correctedNegative} format=${correctedFormat} action=${correctedAction} detail=${correctedDetail}`);
    }
  }

  // Merge: existing items keep their createdAt, get updatedAt/lastSeenAt/runCount bumped
  let added = rpAddedCount;
  let updated = rpUpdatedCount;
  let unchanged = 0;

  // Re-canonicalize existing learned navigation routes to remove accumulated step pollution
  for (const [id, existingItem] of existingMap.entries()) {
    if (!_isLearnedRoute(existingItem.coverageRefs)) continue;
    const oldSteps = existingItem.steps.length;
    const clickTargets = existingItem.clickTargets || [];
    const assertionTargets = existingItem.assertionTargets || [];
    if (clickTargets.length === 0) continue;

    const endsAtRef = existingItem.coverageRefs.find(r => r.startsWith("endsAt:"));
    const endsAt = endsAtRef ? endsAtRef.split(":")[1] : null;

    // Rebuild canonical steps from clickTargets (deduplicated, no stale accumulation)
    const canonicalSteps: string[] = [];
    const seenClicks = new Set<string>();
    for (const target of clickTargets) {
      const key = normalizeForHash(target);
      if (seenClicks.has(key)) continue;
      seenClicks.add(key);
      canonicalSteps.push(`Clic en "${target}"`);
    }

    // Preserve existing selection step (e.g., "Seleccionar el primer <target> visible del listado.")
    const existingSelectionStep = existingItem.steps.find(s => {
      const stripped = s.replace(/^\d+[\.)]\s*/, "").trim();
      return /^Seleccionar el (primer|primera|último|última)\s+.+?\s+visible del listado\.?$/i.test(stripped);
    });
    const preservedSelection = existingSelectionStep ? existingSelectionStep.replace(/^\d+[\.)]\s*/, "").trim() : null;
    if (preservedSelection) {
      const targetMatch = preservedSelection.match(/Seleccionar el (primer|primera|último|última)\s+(.+?)\s+visible del listado/i);
      const selTarget = targetMatch ? targetMatch[2] : "item";
      console.log(`[route-learning] preservedSelectionStep route=${id} target="${selTarget}" reason=${endsAt || "business_detail"}`);
    }

    // Pick best final assertion based on endsAt, skip generic non-navigational ones
    const genericTerms = ["consulta", "gestión personalizada", "personalizado", "personalizada"];
    const isGeneric = (t: string) => genericTerms.some(g => t.toLowerCase().includes(g));
    let bestAssertion: string | null = null;
    if (endsAt === "auth_gate") {
      const authRelated = assertionTargets.filter(t => /autenticaci[óo]n|identificaci[óo]n|login|flujo/i.test(t));
      if (authRelated.length > 0) bestAssertion = authRelated[authRelated.length - 1];
    }
    if (!bestAssertion) {
      const nonGeneric = assertionTargets.filter(t => !isGeneric(t));
      if (nonGeneric.length > 0) bestAssertion = nonGeneric[nonGeneric.length - 1];
    }
    // Insert preserved selection step after navigation clicks, before assertion
    if (preservedSelection) {
      // Check it's not already in canonicalSteps (shouldn't be, but safety)
      const alreadyHas = canonicalSteps.some(s => normalizeForHash(s) === normalizeForHash(preservedSelection));
      if (!alreadyHas) {
        canonicalSteps.push(preservedSelection);
      }
    }

    if (bestAssertion) {
      canonicalSteps.push(`Validar que se muestre "${bestAssertion}"`);
    }

    const stepsChanged = oldSteps !== canonicalSteps.length ||
      existingItem.steps.some((s, i) => normalizeForHash(s) !== normalizeForHash(canonicalSteps[i] || ""));
    if (stepsChanged) {
      existingItem.steps = canonicalSteps;
      console.log(`[route-learning] recanonicalizedExisting route=${id} oldSteps=${oldSteps} newSteps=${canonicalSteps.length}`);
    }
  }

  for (const item of newItems) {
    const existingItem = existingMap.get(item.id);
    if (existingItem) {
      existingItem.updatedAt = now;
      existingItem.lastSeenAt = now;
      existingItem.runCount = (existingItem.runCount || 0) + 1;

      // Learned navigation routes: canonical merge — keep existing steps, only merge assertions/authTerms
      const isLearnedNav = _isLearnedRoute(item.coverageRefs);
      if (isLearnedNav) {
        // Preserve canonical steps from existing item (do NOT concatenate variants)
        const beforeStepCount = existingItem.steps.length;
        const mergedAssertionsBefore = existingItem.assertionTargets.length;
        // Only merge assertion targets and auth terms (knowledge enrichment, not route pollution)
        for (const t of item.assertionTargets) {
          const tn = normalizeForHash(t);
          if (!existingItem.assertionTargets.some(at => normalizeForHash(at) === tn)) {
            existingItem.assertionTargets.push(t);
          }
        }
        for (const at of item.authTerms) {
          if (!existingItem.authTerms.includes(at)) {
            existingItem.authTerms.push(at);
          }
        }
        const mergedAssertions = existingItem.assertionTargets.length - mergedAssertionsBefore;
        console.log(`[route-learning] canonicalMerge route=${existingItem.id} keptSteps=${beforeStepCount} mergedAssertions=${mergedAssertions} runCount=${existingItem.runCount}`);
      } else {
        // Regular items: merge steps/clickTargets/assertions without duplicates
        for (const step of item.steps) {
          if (!existingItem.steps.some(s => normalizeForHash(s) === normalizeForHash(step))) {
            existingItem.steps.push(step);
          }
        }
        for (const t of item.clickTargets) {
          const tn = normalizeForHash(t);
          if (!existingItem.clickTargets.some(ct => normalizeForHash(ct) === tn)) {
            existingItem.clickTargets.push(t);
          }
        }
        for (const t of item.assertionTargets) {
          const tn = normalizeForHash(t);
          if (!existingItem.assertionTargets.some(at => normalizeForHash(at) === tn)) {
            existingItem.assertionTargets.push(t);
          }
        }
        for (const a of item.negativeAssertions) {
          const an = normalizeForHash(a);
          if (!existingItem.negativeAssertions.some(na => normalizeForHash(na) === an)) {
            existingItem.negativeAssertions.push(a);
          }
        }
        for (const ol of item.optionLabels) {
          if (!existingItem.optionLabels.includes(ol)) {
            existingItem.optionLabels.push(ol);
          }
        }
        for (const at of item.authTerms) {
          if (!existingItem.authTerms.includes(at)) {
            existingItem.authTerms.push(at);
          }
        }
      }
      updated++;
    } else {
      existingMap.set(item.id, item);
      added++;
    }
  }

  const preDedupItems = Array.from(existingMap.values());
  unchanged = preDedupItems.length - added - updated;

  if (newItems.length === 0 && preDedupItems.length > 0) {
    console.log(`[app-knowledge] write skipped reason=no_valid_new_items_preserve_existing total=${preDedupItems.length}`);
  }

  const learnedRouteUpdates = newItems.filter(i => _isLearnedRoute(i.coverageRefs)).reduce((acc, item) => {
    const exists = existingMap.has(item.id);
    acc[exists ? "updated" : "added"]++;
    return acc;
  }, { added: 0, updated: 0 });
  const routeUnchanged = preDedupItems.filter(i => _isLearnedRoute(i.coverageRefs) && !newItems.some(n => n.id === i.id)).length;
  const totalRouteDedupe = learnedRouteUpdates.added + learnedRouteUpdates.updated + routeUnchanged;
  if (totalRouteDedupe > 0) {
    console.log(`[route-learning] dedupe updated=${learnedRouteUpdates.updated} added=${learnedRouteUpdates.added} unchanged=${routeUnchanged}`);
  }

  // Final semantic dedup after merge: group by (appSlug + issueKey + coverageRefs + normalizedSteps)
  // Prefer items with complete routes (include initialAction), more steps, higher runCount.
  const finalDedupMap = new Map<string, AppKnowledgeItem>();
  let finalDedupRemoved = 0;
  let finalPreferredComplete = 0;
  const entryActionNorm = contract?.initialActions?.map(a => a.initialAction).find(Boolean)?.normalize("NFC").toLowerCase().trim();

  for (const item of preDedupItems) {
    const key = finalDedupKey(appSlug, item.issueKey, item.coverageRefs, item.steps);
    const existing = finalDedupMap.get(key);
    if (existing) {
      // Prefer more complete route (has entry action)
      const existingHasEntry = entryActionNorm && existing.steps.some(s => s.normalize("NFC").toLowerCase().includes(entryActionNorm));
      const itemHasEntry = entryActionNorm && item.steps.some(s => s.normalize("NFC").toLowerCase().includes(entryActionNorm));
      let keeper = existing;
      if (!existingHasEntry && itemHasEntry) {
        keeper = item;
        finalPreferredComplete++;
      } else if (existingHasEntry && itemHasEntry && item.steps.length > existing.steps.length) {
        keeper = item;
        finalPreferredComplete++;
      } else if (!existingHasEntry && !itemHasEntry && item.steps.length > existing.steps.length) {
        keeper = item;
      }
      // Merge metadata
      keeper.runCount = Math.max(keeper.runCount || 1, existing.runCount || 1);
      if (existing.createdAt < keeper.createdAt) keeper.createdAt = existing.createdAt;
      if (item.createdAt < keeper.createdAt) keeper.createdAt = item.createdAt;
      if (existing.lastSeenAt > keeper.lastSeenAt) keeper.lastSeenAt = existing.lastSeenAt;
      if (item.lastSeenAt > keeper.lastSeenAt) keeper.lastSeenAt = item.lastSeenAt;
      // Merge arrays without duplicates
      for (const t of existing.clickTargets) { if (!keeper.clickTargets.includes(t)) keeper.clickTargets.push(t); }
      for (const t of item.clickTargets) { if (!keeper.clickTargets.includes(t)) keeper.clickTargets.push(t); }
      for (const t of existing.assertionTargets) { if (!keeper.assertionTargets.includes(t)) keeper.assertionTargets.push(t); }
      for (const t of item.assertionTargets) { if (!keeper.assertionTargets.includes(t)) keeper.assertionTargets.push(t); }
      for (const a of existing.negativeAssertions) { if (!keeper.negativeAssertions.includes(a)) keeper.negativeAssertions.push(a); }
      for (const a of item.negativeAssertions) { if (!keeper.negativeAssertions.includes(a)) keeper.negativeAssertions.push(a); }
      for (const ol of existing.optionLabels) { if (!keeper.optionLabels.includes(ol)) keeper.optionLabels.push(ol); }
      for (const ol of item.optionLabels) { if (!keeper.optionLabels.includes(ol)) keeper.optionLabels.push(ol); }
      for (const at of existing.authTerms) { if (!keeper.authTerms.includes(at)) keeper.authTerms.push(at); }
      for (const at of item.authTerms) { if (!keeper.authTerms.includes(at)) keeper.authTerms.push(at); }
      for (const step of existing.steps) { if (!keeper.steps.some(s => normalizeCompare(s) === normalizeCompare(step))) keeper.steps.push(step); }
      for (const step of item.steps) { if (!keeper.steps.some(s => normalizeCompare(s) === normalizeCompare(step))) keeper.steps.push(step); }
      finalDedupMap.set(key, keeper);
      finalDedupRemoved++;
    } else {
      finalDedupMap.set(key, item);
    }
  }

  if (finalDedupRemoved > 0) {
    console.log(`[app-knowledge] finalDedupe removed=${finalDedupRemoved} total=${finalDedupMap.size}`);
  }
  if (finalPreferredComplete > 0) {
    console.log(`[app-knowledge] finalDedupe preferredCompleteRoute=${finalPreferredComplete}`);
  }

  // Functional dedup for option_flow items: group by (issueKey + primary coverageRef + clickTarget sequence)
  // to merge variants that represent the same navigation route with different validation steps.
  let removedFunctionalVariants = 0;
  const functionalGroups = new Map<string, AppKnowledgeItem[]>();

  for (const item of finalDedupMap.values()) {
    // Learned navigation routes are app-global, not HU-scoped option flows — skip functional dedupe
    if (_isLearnedRoute(item.coverageRefs)) {
      const passKey = `__private_route__${item.id}`;
      functionalGroups.set(passKey, [item]);
      continue;
    }
    const isOptionFlow = item.coverageRefs.some(r => r.startsWith("option_")) || item.optionLabels.length > 0;
    if (isOptionFlow) {
      const clickPath = item.clickTargets.map(t => normalizeCompare(t)).join("|");
      const primaryRef = item.coverageRefs.find(r => r.startsWith("option_")) || item.coverageRefs[0] || "option";
      const groupKey = `${item.issueKey}::${primaryRef}::${clickPath}`;
      if (!functionalGroups.has(groupKey)) functionalGroups.set(groupKey, []);
      functionalGroups.get(groupKey)!.push(item);
    } else {
      const passKey = `__non_option__${item.id}`;
      functionalGroups.set(passKey, [item]);
    }
  }

  const functionalDedupMap = new Map<string, AppKnowledgeItem>();
  for (const [groupKey, items] of functionalGroups) {
    if (items.length === 1) {
      functionalDedupMap.set(items[0].id, items[0]);
      continue;
    }
    // Sort: prefer complete route (has entry action), then minimal steps, then fewer assertions
    const entryActionNormInner = contract?.initialActions
      ?.map(a => a.initialAction).find(Boolean)?.normalize("NFC").toLowerCase().trim();
    items.sort((a, b) => {
      const aHasEntry = entryActionNormInner && a.steps.some(s => s.normalize("NFC").toLowerCase().includes(entryActionNormInner));
      const bHasEntry = entryActionNormInner && b.steps.some(s => s.normalize("NFC").toLowerCase().includes(entryActionNormInner));
      if (aHasEntry && !bHasEntry) return -1;
      if (!aHasEntry && bHasEntry) return 1;
      if (a.steps.length !== b.steps.length) return a.steps.length - b.steps.length;
      return a.assertionTargets.length - b.assertionTargets.length;
    });
    const best = items[0];
    for (let i = 1; i < items.length; i++) {
      const variant = items[i];
      best.runCount = Math.max(best.runCount || 1, variant.runCount || 1);
      if (variant.createdAt < best.createdAt) best.createdAt = variant.createdAt;
      if (variant.lastSeenAt > best.lastSeenAt) best.lastSeenAt = variant.lastSeenAt;
      removedFunctionalVariants++;
    }
    functionalDedupMap.set(best.id, best);
  }

  if (removedFunctionalVariants > 0) {
    console.log(`[app-knowledge] finalDedupe removedFunctionalVariants=${removedFunctionalVariants} total=${functionalDedupMap.size}`);
  }

  // ── Dedupe by routeSignature for learned routes ──
  const routeSigMap = new Map<string, AppKnowledgeItem>();
  let mergedRouteDups = 0;
  for (const item of functionalDedupMap.values()) {
    const sig = item.routeSignature;
    if (!sig || !(item.knowledgeKind === "route_prefix" || item.knowledgeKind === "route_functional")) {
      routeSigMap.set(item.id, item);
      continue;
    }
    const existing = routeSigMap.get(sig);
    if (existing) {
      if ((item.confidenceScore ?? 0) > (existing.confidenceScore ?? 0)) {
        routeSigMap.set(sig, item);
      }
      existing.successCount = Math.max(existing.successCount ?? 1, item.successCount ?? 1);
      existing.failureCount = (existing.failureCount ?? 0) + (item.failureCount ?? 0);
      existing.lastValidatedAt = item.lastValidatedAt || existing.lastValidatedAt;
      mergedRouteDups++;
      console.log(`[knowledge-dedupe] merged route kept=${existing.id} merged=${item.id} reason=same_route_signature`);
    } else {
      routeSigMap.set(sig, item);
    }
  }
  if (mergedRouteDups > 0) {
    const dedupedRouteItems = new Map<string, AppKnowledgeItem>();
    for (const item of routeSigMap.values()) dedupedRouteItems.set(item.id, item);
    // Replace items in functionalDedupMap: keep ones not in route dedup + deduped
    for (const [id, item] of functionalDedupMap) {
      if (!routeSigMap.has(item.routeSignature ?? id)) {
        dedupedRouteItems.set(id, item);
      }
    }
    functionalDedupMap.clear();
    for (const [id, item] of dedupedRouteItems) functionalDedupMap.set(id, item);
    console.log(`[knowledge-dedupe] routeDedupe kept=${functionalDedupMap.size} merged=${mergedRouteDups}`);
  }

  // ── Dedupe by coverageSignature for scenarios ──
  const covSigMap = new Map<string, AppKnowledgeItem>();
  let mergedCovDups = 0;
  for (const item of functionalDedupMap.values()) {
    const sig = item.coverageSignature;
    if (!sig || item.knowledgeKind !== "scenario_validated") {
      covSigMap.set(item.id, item);
      continue;
    }
    const existing = covSigMap.get(sig);
    if (existing) {
      if ((item.confidenceScore ?? 0) > (existing.confidenceScore ?? 0)) {
        covSigMap.set(sig, item);
      }
      existing.successCount = Math.max(existing.successCount ?? 1, item.successCount ?? 1);
      existing.failureCount = (existing.failureCount ?? 0) + (item.failureCount ?? 0);
      existing.lastValidatedAt = item.lastValidatedAt || existing.lastValidatedAt;
      mergedCovDups++;
      console.log(`[knowledge-dedupe] merged scenario kept=${existing.id} merged=${item.id} reason=same_coverage_signature`);
    } else {
      covSigMap.set(sig, item);
    }
  }
  if (mergedCovDups > 0) {
    const dedupedCovItems = new Map<string, AppKnowledgeItem>();
    for (const item of covSigMap.values()) dedupedCovItems.set(item.id, item);
    for (const [id, item] of functionalDedupMap) {
      if (!covSigMap.has(item.coverageSignature ?? id)) {
        dedupedCovItems.set(id, item);
      }
    }
    functionalDedupMap.clear();
    for (const [id, item] of dedupedCovItems) functionalDedupMap.set(id, item);
    console.log(`[knowledge-dedupe] coverageDedupe kept=${functionalDedupMap.size} merged=${mergedCovDups}`);
  }

  const result: AppKnowledge = {
    version: 1,
    appSlug,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    items: Array.from(functionalDedupMap.values()),
  };

  fs.writeFileSync(knowledgePath, JSON.stringify(result, null, 2), "utf-8");

  console.log(`[app-knowledge] dedupe existing=${preDedupItems.length - added - updated} added=${added} updated=${updated} unchanged=${unchanged} total=${result.items.length}`);
  const writeReason = hasCleanupTrigger && !hasScenarioData && !hasRouteProfileData ? "cleanup_current_issue" : "normal";
  console.log(`[app-knowledge] written path=${knowledgePath} added=${added} updated=${updated} total=${result.items.length} reason=${writeReason}`);

  // --- Optional promotion: promote stable learned navigation routes to app.config ---
  const _extractRef = (coverageRefs: string[], prefix: string): string | null => {
    const ref = coverageRefs.find(r => r.startsWith(prefix));
    return ref ? ref.slice(prefix.length) : null;
  };
  const _isCompletePrivateRoute = (rp: any): boolean => {
    if (!rp || rp.accessMode !== "private") return false;
    const intent = rp.intent as string | undefined;
    if (!intent || intent === "none" || intent === "auth_entry") return false;
    if (!rp.entryPath || !Array.isArray(rp.entryPath) || rp.entryPath.length < 1) return false;
    const hasAuthPath = Array.isArray(rp.authenticatedPath) && rp.authenticatedPath.length > 0;
    const hasSignals = (Array.isArray(rp.terminalSignals) && rp.terminalSignals.length > 0) ||
      (Array.isArray(rp.detailAssertions) && rp.detailAssertions.length > 0) ||
      !!rp.selectionTarget;
    const isTrusted = (rp.source === "user_confirmed" || rp.source === "config" || rp.confidence === "high");
    return isTrusted || hasAuthPath || (rp.entryPath.length >= 3 && hasSignals);
  };
  const stablePrivateRoutes = result.items.filter(
    item => {
      if (!_isLearnedRoute(item.coverageRefs)) return false;
      if (item.authTerms.length === 0) return false;
      if ((item.runCount || 1) < 2) return false;
      // Exclude auth_entry-only routes — not functional
      const intent = _extractRef(item.coverageRefs, "intent:");
      const endsAt = _extractRef(item.coverageRefs, "endsAt:");
      if (intent === "auth_entry" || intent === "none") return false;
      if (endsAt === "auth_gate") return false;
      // Must have enough steps for a functional route
      if (item.clickTargets.length < 2) return false;
      return true;
    }
  );
  if (stablePrivateRoutes.length > 0) {
    // Prefer routes with assertionTargets (detail signals) over click-only routes
    const bestFunctional = stablePrivateRoutes.sort((a, b) => {
      const aSignals = (a.assertionTargets?.length || 0) + (a.optionLabels?.length || 0);
      const bSignals = (b.assertionTargets?.length || 0) + (b.optionLabels?.length || 0);
      if (aSignals !== bSignals) return bSignals - aSignals;
      return (b.runCount || 1) - (a.runCount || 1);
    })[0];
    try {
      const appConfigPath = path.join(process.cwd(), "automations", "apps", appSlug, "app.config.json");
      if (fs.existsSync(appConfigPath)) {
        const raw = fs.readFileSync(appConfigPath, "utf-8");
        const appConfigContent = JSON.parse(raw) as any;
        if (!appConfigContent.routeProfiles) appConfigContent.routeProfiles = {};
        const routeProfiles = appConfigContent.routeProfiles as Record<string, any>;
        const existingPrivate = Object.values(routeProfiles).find((p: any) => p?.accessMode === "private");

        if (existingPrivate && _isCompletePrivateRoute(existingPrivate)) {
          console.log(`[route-learning] promotionSkipped reason=already_configured appSlug=${appSlug}`);
        } else if (existingPrivate) {
          // Existing route is incomplete — attempt recovery from app.knowledge
          const recoveryCandidates = result.items.filter(item =>
            _isLearnedRoute(item.coverageRefs) &&
            _extractRef(item.coverageRefs, "intent:") !== "auth_entry" &&
            _extractRef(item.coverageRefs, "intent:") !== "none" &&
            _extractRef(item.coverageRefs, "endsAt:") !== "auth_gate" &&
            item.clickTargets.length > (existingPrivate.entryPath?.length || 0) &&
            (item.assertionTargets?.length > 0 || item.optionLabels?.length > 0)
          );
          if (recoveryCandidates.length > 0) {
            const recoveryRoute = recoveryCandidates.sort((a, b) => (b.runCount || 1) - (a.runCount || 1))[0];
            const recoveryIntent = _extractRef(recoveryRoute.coverageRefs, "intent:") || "informational";
            const clickTargets = recoveryRoute.clickTargets.map(t => ({ action: "click" as const, target: t }));
            // Partition: use existing incomplete route's entryPath as auth prefix, no overlap
            const existingEntryCount = (existingPrivate?.entryPath as any[])?.length || 1;
            const prefixCount = Math.min(existingEntryCount, clickTargets.length);
            const recAuthPath = clickTargets.slice(prefixCount);
            const recKey = `rp_learned_${recoveryRoute.id}`;
            if (!appConfigContent.routeProfiles[recKey]) {
              appConfigContent.routeProfiles[recKey] = {
                accessMode: "private",
                intent: recoveryIntent,
                entryPath: clickTargets,
                authenticatedPath: recAuthPath,
                selectionTarget: recoveryRoute.optionLabels?.[0] || null,
                terminalSignals: recoveryRoute.assertionTargets?.filter((a: string) => a.length < 40) || [],
                detailAssertions: recoveryRoute.assertionTargets || [],
                authProfile: "default",
                confidence: "medium",
                source: "recovered_from_app_knowledge",
              };
              // Remove the old incomplete entry
              for (const [k, v] of Object.entries(routeProfiles)) {
                if ((v as any)?.accessMode === "private" && k !== recKey) {
                  delete routeProfiles[k];
                }
              }
              fs.writeFileSync(appConfigPath, JSON.stringify(appConfigContent, null, 2), "utf-8");
              console.log(`[app-config] recoveredPrivateRouteProfile source=appKnowledge id=${recoveryRoute.id} intent=${recoveryIntent} steps=${recoveryRoute.clickTargets.length} assertions=${recoveryRoute.assertionTargets?.length || 0}`);
              console.log(`[route-learning] promotedToAppConfig appSlug=${appSlug} reason=recovered_from_app_knowledge steps=${clickTargets.length} runCount=${recoveryRoute.runCount}`);
            } else {
              console.log(`[route-learning] promotionSkipped reason=already_recovered appSlug=${appSlug} key=${recKey}`);
            }
          } else {
            // No recovery candidate — skip promotion to avoid writing incomplete route
            console.log(`[route-learning] promotionSkipped reason=incomplete_private_functional_route steps=${bestFunctional.clickTargets.length} intent=${_extractRef(bestFunctional.coverageRefs, "intent:") || "none"}`);
          }
        } else {
          // No existing private route — write complete route if available
          const writeIntent = _extractRef(bestFunctional.coverageRefs, "intent:") || "informational";
          const clickTargets = bestFunctional.clickTargets.map(t => ({ action: "click" as const, target: t }));
          // No auth prefix known — use first step as entry, rest as functional
          const entryPath = clickTargets.length > 0 ? [clickTargets[0]] : [];
          const authPath = clickTargets.length > 1 ? clickTargets.slice(1) : [];
          const profileKey = `private_${Date.now()}`;
          appConfigContent.routeProfiles[profileKey] = {
            accessMode: "private",
            intent: writeIntent,
            entryPath,
            authenticatedPath: authPath,
            selectionTarget: bestFunctional.optionLabels?.[0] || null,
            terminalSignals: bestFunctional.assertionTargets?.filter((a: string) => a.length < 40) || [],
            detailAssertions: bestFunctional.assertionTargets || [],
            authProfile: "default",
            confidence: "scenario_derived",
          };
          fs.writeFileSync(appConfigPath, JSON.stringify(appConfigContent, null, 2), "utf-8");
          console.log(`[route-learning] promotedToAppConfig appSlug=${appSlug} reason=stable_route steps=${clickTargets.length} runCount=${bestFunctional.runCount} intent=${writeIntent}`);
        }
      } else {
        console.log(`[route-learning] promotionSkipped reason=no_app_config appSlug=${appSlug}`);
      }
    } catch {
      console.log(`[route-learning] promotionSkipped reason=write_error appSlug=${appSlug}`);
    }
  } else {
    // No stable functional route — check if existing route is incomplete and try recovery
    try {
      const appConfigPath = path.join(process.cwd(), "automations", "apps", appSlug, "app.config.json");
      if (fs.existsSync(appConfigPath)) {
        const raw = fs.readFileSync(appConfigPath, "utf-8");
        const appConfigContent = JSON.parse(raw) as any;
        const routeProfiles = (appConfigContent?.routeProfiles as Record<string, any>) || {};
        const existingPrivate = Object.values(routeProfiles).find((p: any) => p?.accessMode === "private");
        if (existingPrivate && !_isCompletePrivateRoute(existingPrivate)) {
          // Try recovery from any learned route (even with runCount=1)
          const recoveryCandidates = result.items.filter(item =>
            _isLearnedRoute(item.coverageRefs) &&
            _extractRef(item.coverageRefs, "intent:") !== "auth_entry" &&
            _extractRef(item.coverageRefs, "intent:") !== "none" &&
            _extractRef(item.coverageRefs, "endsAt:") !== "auth_gate" &&
            item.clickTargets.length > (existingPrivate.entryPath?.length || 0) &&
            (item.assertionTargets?.length > 0 || item.optionLabels?.length > 0)
          );
          if (recoveryCandidates.length > 0) {
            const recoveryRoute = recoveryCandidates.sort((a, b) => (b.runCount || 1) - (a.runCount || 1))[0];
            const recoveryIntent = _extractRef(recoveryRoute.coverageRefs, "intent:") || "informational";
            const clickTargets = recoveryRoute.clickTargets.map(t => ({ action: "click" as const, target: t }));
            const existingEntryCount = (existingPrivate?.entryPath as any[])?.length || 1;
            const prefixCount = Math.min(existingEntryCount, clickTargets.length);
            const recAuthPath = clickTargets.slice(prefixCount);
            const recKey = `rp_learned_${recoveryRoute.id}`;
            if (!appConfigContent.routeProfiles[recKey]) {
              appConfigContent.routeProfiles[recKey] = {
                accessMode: "private",
                intent: recoveryIntent,
                entryPath: clickTargets,
                authenticatedPath: recAuthPath,
                selectionTarget: recoveryRoute.optionLabels?.[0] || null,
                terminalSignals: recoveryRoute.assertionTargets?.filter((a: string) => a.length < 40) || [],
                detailAssertions: recoveryRoute.assertionTargets || [],
                authProfile: "default",
                confidence: "medium",
                source: "recovered_from_app_knowledge",
              };
              for (const [k, v] of Object.entries(routeProfiles)) {
                if ((v as any)?.accessMode === "private" && k !== recKey) {
                  delete routeProfiles[k];
                }
              }
              fs.writeFileSync(appConfigPath, JSON.stringify(appConfigContent, null, 2), "utf-8");
              console.log(`[app-config] recoveredPrivateRouteProfile source=appKnowledge id=${recoveryRoute.id} intent=${recoveryIntent} steps=${recoveryRoute.clickTargets.length}`);
            }
          } else {
            console.log(`[route-learning] promotionSkipped reason=incomplete_private_functional_route steps=${existingPrivate.entryPath?.length || 0} intent=none recovery=no_candidate`);
          }
        } else if (existingPrivate) {
          console.log(`[app-config] preservedTrustedRouteProfile key=${Object.keys(routeProfiles).find(k => routeProfiles[k] === existingPrivate)}`);
        }
      }
    } catch {
      // Silent
    }
  }

  // ── Knowledge summary ──
  const routes = result.items.filter(i => i.knowledgeKind === "route_prefix" || i.knowledgeKind === "route_functional");
  const scenarios = result.items.filter(i => i.knowledgeKind === "scenario_validated" || i.knowledgeKind === "scenario_candidate");
  const rejected = result.items.filter(i => i.knowledgeKind === "rejected_route" || i.knowledgeKind === "rejected_scenario");
  const trustedRoutes = routes.filter(i => i.trustedForReuse);
  const trustedScenarios = scenarios.filter(i => i.trustedForReuse);
  const untrusted = result.items.filter(i => !i.trustedForReuse);
  console.log(`[knowledge-summary] routes learned=${routes.length} trusted=${trustedRoutes.length} skipped=${routes.length - trustedRoutes.length} downgraded=${rejected.length}`);
  console.log(`[knowledge-summary] scenarios learned=${scenarios.length} trusted=${trustedScenarios.length} skipped=${scenarios.length - trustedScenarios.length} rejected=${rejected.length}`);
  console.log(`[knowledge-summary] reuse selectedRoutes=${trustedRoutes.length} selectedScenarios=${trustedScenarios.length} skippedUntrusted=${untrusted.length}`);

  return { added, updated, unchanged, total: result.items.length, skipped };
}

export async function appendRouteSuggestionToKnowledge(
  appSlug: string,
  suggestion: RouteProfileSuggestion,
  automationsRoot: string,
): Promise<{ persisted: boolean; duplicate: boolean; error?: string }> {
  if (suggestion.status !== "auto_approved") {
    return { persisted: false, duplicate: false };
  }

  const knowledgePath = path.join(automationsRoot, "apps", appSlug, "app.knowledge.json");
  const dir = path.dirname(knowledgePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let knowledge: AppKnowledge;
  if (fs.existsSync(knowledgePath)) {
    try {
      knowledge = JSON.parse(fs.readFileSync(knowledgePath, "utf-8")) as AppKnowledge;
    } catch {
      knowledge = { version: 1, appSlug, createdAt: nowIso(), updatedAt: nowIso(), items: [] };
    }
  } else {
    knowledge = { version: 1, appSlug, createdAt: nowIso(), updatedAt: nowIso(), items: [] };
  }

  // Canonicalize identity inputs (casing/accents/whitespace-insensitive) without altering stored display values
  const canonSlug = normalizeCompare(appSlug);
  const canonFrom = normalizeCompare(suggestion.from || "");
  const canonTo = normalizeCompare(suggestion.to);
  const canonUrl = normalizeCompare(suggestion.evidence?.afterUrl || "");

  const raw = `${canonSlug}::${canonFrom}::${canonTo}::${canonUrl}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const chr = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  const edgeId = `route_edge_${canonSlug}_${Math.abs(hash).toString(36)}`;

  // Direct id match, then fallback to semantic match for cosmetic variants with a different historical id
  let existing = knowledge.items.find(i => i.id === edgeId);
  if (!existing) {
    existing = knowledge.items.find(i =>
      i.routeFrom != null &&
      i.actionTarget != null &&
      normalizeCompare(i.routeFrom) === canonFrom &&
      normalizeCompare(i.actionTarget) === canonTo &&
      (!i.destinationUrl || normalizeCompare(i.destinationUrl) === canonUrl)
    );
  }
  if (existing) {
    existing.updatedAt = nowIso();
    existing.lastSeenAt = nowIso();
    existing.runCount = (existing.runCount || 0) + 1;
    if (!existing.destinationUrl && suggestion.evidence?.afterUrl) {
      existing.destinationUrl = suggestion.evidence.afterUrl;
    }
    if (suggestion.confidence > (existing.confidenceScore ?? 0)) {
      existing.confidenceScore = suggestion.confidence;
    }
    if (existing.source === "route_learning" && !existing.knowledgeKind) {
      existing.knowledgeKind = "route_functional_observed";
    }
    try {
      knowledge.updatedAt = nowIso();
      fs.writeFileSync(knowledgePath, JSON.stringify(knowledge, null, 2), "utf-8");
      return { persisted: true, duplicate: true };
    } catch (err) {
      return { persisted: false, duplicate: true, error: String(err) };
    }
  }

  const now = nowIso();
  const item: AppKnowledgeItem = {
    id: edgeId,
    source: "scenario_derived",
    issueKey: undefined,
    scenarioTitle: undefined,
    coverageRefs: [
      "learned_navigation_path",
      `relation:${suggestion.relation}`,
    ],
    steps: [`Clic en "${suggestion.to}".`],
    clickTargets: [suggestion.to],
    assertionTargets: [],
    negativeAssertions: [],
    optionLabels: [],
    authTerms: [],
    manual: false,
    confidence: "scenario_derived",
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    runCount: 1,
    validationStatus: "validated",
    trustedForReuse: true,
    successCount: 1,
    confidenceScore: suggestion.confidence,
    knowledgeKind: "route_functional_observed",
    destinationUrl: suggestion.evidence?.afterUrl,
    routeFrom: suggestion.from,
    actionTarget: suggestion.to,
  };

  knowledge.items.push(item);
  try {
    knowledge.updatedAt = now;
    fs.writeFileSync(knowledgePath, JSON.stringify(knowledge, null, 2), "utf-8");
    return { persisted: true, duplicate: false };
  } catch (err) {
    return { persisted: false, duplicate: false, error: String(err) };
  }
}
