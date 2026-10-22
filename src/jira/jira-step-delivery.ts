import { parseStepIntent } from "../discovery/step-intent-parser";
import type { JiraInputRequirement } from "./jira-input-requirements";

/** Generator-only contract; the existing parser/runtime remain authoritative. */
export const JIRA_STEP_DELIVERY_INSTRUCTIONS = `
## Delivery to the existing execution engine
Render ONE operation per step using these natural-language templates:
Abrir la aplicación configurada del proyecto
Presionar "<exact observed control label>"
Ingresar <data description> en "<exact field label>"
Seleccionar <data description> en "<exact field label>"
Validar que se muestre "<source-backed observable target>"
Validar que no se muestre "<source-backed observable target>"
Validar que el campo "<exact field label>" muestre un error de validación
Templates are not UI labels. Use ONLY the selected project's source/knowledge.
An observed and validated edited action outranks a generic request description. If this project's
validated route clicks a channel control, preserve Presionar "<observed label>" at that same stage;
do not turn it back into Solicitar el código por SMS. This is evidence priority, not a global SMS rule.
Knowledge targetKind=semantic_request is a request INTENT, not a literal button label: render it as
Solicitar <request>, never Presionar "<request>". Missing targetKind is legacy evidence, not control-label certification.
Keep editable values in inputRequirements, never {{placeholders}}, selectors or secret literals in steps.
Each fill/select needs one matching inputRequirement with label, operation and 1-based stepIndex.
Preserve its semantic key when repairing; update indices after inserting/splitting/reordering steps.
Distinct security challenges need distinct keys even when field labels repeat.
Preserve every intervening observed action in journey order; never append missing setup at the end.
After the expected rejection, assert its source-backed feedback and forbidden outcome, then STOP that branch.
Never continue into authenticated actions after rejected credentials or an invalid access code.
Keep applicability in conditionRequirements, not "if applicable" inside executable prose.
Never replace value comparisons, field errors or row relations with simple visibility assertions.
Missing route/label/condition evidence stays unresolved: never invent UI or omit an acceptance criterion.
For JIRA_GENERATED_STEP_NOT_ATOMIC split only the affected action using source-backed labels.
For JIRA_GENERATED_FIELD_UNBOUND bind the exact field and operation to its inputRequirement.
Return the complete corrected journey, preserve unaffected steps and update inputRequirements.
Do not put readiness notes such as pending Discovery into expectedResult. Put those notes in
unresolvedUiRequirements. Do not combine several assertions in a single step, including summary lists.
Never quote "a message that reports..." as a UI label. Preserve the source rejection requirement
and mark its actual message surface unresolved when no project observation identifies it.
For JIRA_GENERATED_ASSERTION_NOT_ATOMIC split only the failing validation into separate supported checks,
preserving every subject, polarity and condition binding. Do not split a literal quoted label itself.
For JIRA_GENERATED_NARRATIVE_TARGET use the source-backed rejection requirement with an unresolved
message observation, not a fabricated literal message. For JIRA_GENERATED_REQUEST_AS_CONTROL restore
the learned semantic request when that is the evidence, or the verified control label when available.
For JIRA_GENERATED_EXPECTED_RESULT_IS_READINESS summarize the explicit functional assertions and retain
all preparation uncertainties separately. Never repair an error by deleting its business requirement.
`;

const OPERATIONS = new Set(["action_fill", "action_select", "action_click", "action_submit", "action_press", "assertion"]);

/** Remove exact provider duplicates only; different assertions/data/branches stay distinct. */
export function deduplicateJiraDrafts(candidates:unknown[]):unknown[] {
 const seen=new Set<string>();
 return candidates.filter(candidate=>{
  if(!candidate || typeof candidate!=='object')return true;
  const c=candidate as Record<string,unknown>;
  const signature=JSON.stringify([c.sourceIssueKey,c.steps,c.expectedResult,c.preconditions,c.inputRequirements,c.acceptanceCriteriaRefs]);
  if(seen.has(signature))return false;
  seen.add(signature);return true;
 });
}

/** Exact requirement lineage only; no synonym inference or comparison downgrade. */
export function bindKnownJiraObservables(steps:string[], observed:Array<{requirement:string;target:string}>):string[] {
 const normalize=(text:string)=>text.trim().replace(/[.!]+$/,'').toLocaleLowerCase();
 return steps.map(step=>{
  if(!/^(?:Validar|Verificar)\b/i.test(step) || /\bno\s+(?:se\s+)?(?:muestre|informe)|compar|coincid|igual|mismo valor/i.test(step))return step;
  const targets=[...new Set(observed.filter(item=>normalize(item.requirement)===normalize(step)).map(item=>item.target))];
  if(targets.length!==1 || !targets[0].trim() || /["\r\n]/.test(targets[0]))return step;
  return `Validar que se muestre "${targets[0]}"`;
 });
}

export const JIRA_OUTCOME_DELIVERY_INSTRUCTIONS = `
## Evidence-grounded outcomes
An invalid input does NOT imply a field-level validation error. Preserve the rejection surface
documented by this story or the selected project's knowledge: message/dialog, field error, or another
explicit observable. Use field-validation syntax ONLY when that evidence identifies a field-linked error.
If the source names a visible rejection message, use Validar que se muestre "<source message>".
Never invent a message, quote a narrative screen description as an exact UI label, or convert a modal
into a field error. Unknown UI surfaces belong in unresolvedUiRequirements with their stepIndex.
Before asserting absence of success, establish a source-backed positive observable context after submit:
the documented rejection or observed state. For JIRA_ABSENCE_REQUIRES_OBSERVED_CONTEXT restore that check.
Keep the negative assertion, its polarity and every preceding required action.
Visibility of a field name proves neither its value nor equality with the value entered/selected.
When the source requires matching amounts, entities, dates or references, preserve that requirement;
use an existing supported value/row oracle only when its source-backed binding/container is available.
Otherwise record the precise missing value comparison in unresolvedUiRequirements; never claim the
criterion is verified merely because the label is visible. Do not erase the criterion or weaken it.
Keep each explicitly required failure branch, including credential rejection when the source requires it.
Repair malformed drafts for those branches; do not substitute an unrelated failure or omit the branch.
ExpectedResult must describe the explicit step oracles with matching subjects and polarities, not introduce
an additional compound assertion or claim business state changes that no step actually verifies.
`;

/** Correct an invented field-error surface only from an unambiguous source message.
 * No source message/ambiguous evidence => keep the draft for existing AI repair/review.
 */
export function repairSourceBackedRejectionMessages(steps: string[], sourceText: string): string[] {
  const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const clauses = sourceText.split(/\r?\n/).filter(Boolean);
  return steps.map(step => {
    const field = step.match(/^Validar que el campo "([^"]+)" muestre un error de validación[.]?$/i)?.[1];
    if (!field) return step;
    const relevant = clauses.filter(clause => fold(clause).includes(fold(field))
      && /\b(?:inv[aá]lid\w*|incorrect\w*|rechaz\w*|expir\w*|vencid\w*)\b/i.test(clause));
    if (relevant.some(clause => /(?:error|validaci[oó]n).{0,35}(?:asociad\w* al campo|junto al campo|debajo del campo)|campo.{0,35}(?:inv[aá]lido|error de validaci[oó]n)/i.test(clause))) return step;
    const messages = [...new Set(relevant.flatMap(clause => [...clause.matchAll(/(?:mensaje|di[aá]logo|popup|alerta|message|dialog)\s*(?:(?:de\s+error|de\s+rechazo)\s*)?[:]?\s*["“]([^"”]+)["”]/gi)].map(match => match[1].trim())))];
    return messages.length === 1 ? `Validar que se muestre "${messages[0]}"` : step;
  });
}

export function auditJiraStepDelivery(steps: string[], fields: JiraInputRequirement[], sourceText = '') {
  return steps.flatMap((step, offset) => {
    const operations = parseStepIntent(step).filter(intent => OPERATIONS.has(intent.type));
    const issue = (reason: string) => [{ reason, stepIndex: offset + 1, step }];
    const requestAsControl=step.match(/^Presionar "((?:el|la)\s+.+?\s+(?:por|by)\s+.+)"[.]?$/i)?.[1];
    if (requestAsControl && !sourceText.includes(`"${requestAsControl}"`)) return issue('JIRA_GENERATED_REQUEST_AS_CONTROL');
    if (/^(?:Validar|Verificar)\b/i.test(step)
      && !/fila coincidente|matching row/i.test(step)) {
      const unquoted=step.replace(/["“][^"”]+["”]/g,'"target"');
      if (/,.*\b(?:y|e|and)\b|\by\s+(?:que\s+)?no\s+(?:se\s+)?(?:muestre|presente)/i.test(unquoted)) return issue('JIRA_GENERATED_ASSERTION_NOT_ATOMIC');
      if (/["“](?:un|el|a|the)\s+(?:mensaje|message)\s+(?:que|that)\b/i.test(step)) return issue('JIRA_GENERATED_NARRATIVE_TARGET');
    }
    if (operations.length > 1) return issue("JIRA_GENERATED_STEP_NOT_ATOMIC");
    const intent = operations[0];
    if (!intent || !["action_fill", "action_select"].includes(intent.type) || intent.actionVerb === "clear") return [];
    const operation = intent.type === "action_fill" ? "fill" : "select";
    const label = intent.selectionField || intent.actionTarget;
    if (!label) return issue("JIRA_GENERATED_FIELD_UNBOUND");
    const matches = fields.filter(field => field.stepIndex === offset + 1 && field.operation === operation && field.label === label);
    return matches.length === 1 ? [] : issue("JIRA_GENERATED_FIELD_UNBOUND");
  });
}
