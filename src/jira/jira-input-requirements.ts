import { parseStepIntent } from "../discovery/step-intent-parser";
import { JIRA_STEP_DELIVERY_INSTRUCTIONS, JIRA_OUTCOME_DELIVERY_INSTRUCTIONS } from "./jira-step-delivery";

export type JiraInputRequirement = {
  key: string;
  label: string;
  stepIndex: number;
  operation: "fill" | "select";
  required: boolean;
  editable: boolean;
  sensitive: boolean;
  controlType: "text" | "password" | "number" | "date" | "select";
  source: "jira_step";
  dataCondition?: "valid" | "invalid" | "expired";
};

function isPasswordLabel(label: string): boolean {
  return /\bcontrase(?:ñ|n)a\b|\bpassword\b/i.test(label.normalize("NFKC"));
}

const fieldWords = (label: string) => label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 4);

// Semantic qualifiers distinguish fields; a label shortened by dropping one is a different field.
const QUALIFIER_WORDS = new Set(["origen", "destino", "cliente", "emisor", "receptor", "beneficiario", "anterior", "actual", "nueva", "nuevo", "confirmacion", "cuenta"]);
/** Compatible = same words, or one label is the other minus non-qualifier words ("Alias de cuenta" -> "Alias"). Words unique to both sides (numero de cuenta vs cliente) never match. */
function compatibleFieldLabels(a: string, b: string): boolean {
  const [small, large] = [new Set(fieldWords(a)), new Set(fieldWords(b))].sort((x, y) => x.size - y.size);
  if (!small.size || ![...small].every(word => large.has(word))) return false;
  const dropped = [...large].filter(word => !small.has(word));
  // "cuenta" only counts as a qualifier when it is kept on one side; dropping it is the alias-shortening case.
  return dropped.every(word => !QUALIFIER_WORDS.has(word) || (word === "cuenta" && dropped.length === 1 && small.size === 1 && !QUALIFIER_WORDS.has([...small][0])));
}

const TRAILING_FIELD = /^\s*(?:\d+[.)]\s*)?[^"“]*["“][^"”]+["”]\s+en\s+(?:el\s+)?(?:campo\s+)?["“]([^"”]+)["”]\s*\.?\s*$/i;
const NAMED_SAME_VALUE = /\b(?:el\s+mismo|la\s+misma)\s+(?!valor\b|dato\b)[a-záéíóúñ]/i;

const SAVED_ACCOUNT = /\bcuenta\s+ya\s+(?:registrad|guardad)[oa]\b/i;
const SAVE_STEP = /^(?:\d+[.)]\s*)?(?:presionar|clic|click|hacer clic|press)\b.*\b(?:guardar|crear|registrar|enviar|save|create|register|submit)\b/i;

/** Each input belongs to an observed authored step; repeated labels never share values implicitly. */
export function deriveJiraInputRequirements(steps: string[], declared?: unknown): JiraInputRequirement[] {
  const candidates = Array.isArray(declared) ? declared : [];
  const used = new Set<string>();
  const firstFills = new Map<number, { key: string; operation: string; label: string; text: string }>();
  return steps.flatMap((text, offset) => {
    const parsed = parseStepIntent(text.replace(/^\d+[.)]\s*/, ""));
    const intent = parsed[0];
    if (parsed.length !== 1 || !intent?.actionTarget || !["action_fill", "action_select"].includes(intent.type)) return [];
    if (intent.type === "action_fill" && intent.actionVerb === "clear") return [];
    const operation = intent.type === "action_fill" ? "fill" : "select";
    // "<verbo> ... "<valor>" en "<campo>"": the parser's first quote is the value; the field is the trailing quote.
    const trailingField = operation === "fill" ? text.match(TRAILING_FIELD)?.[1]?.trim() : undefined;
    const label = trailingField || intent.actionTarget;
    // A provider-declared stepIndex can be stale after a repair shifted steps; fall back to a label match unique in the journey.
    const sameField = (item: any) => item?.operation === operation && item.label === label;
    const supplied = candidates.find((item: any) => item?.stepIndex === offset + 1 && sameField(item))
      ?? (candidates.filter(sameField).length === 1 && steps.filter(step => { const other = parseStepIntent(step.replace(/^\d+[.)]\s*/, "")); return other.length === 1 && other[0].actionTarget === label && other[0].type === intent.type; }).length === 1
        ? candidates.find(sameField) : undefined);
    // An aggregate placeholder ("datos requeridos de la solicitud") names no control; Discovery cannot bind a value to it.
    if (/^(?:(?:los|las|todos\s+los|todas\s+las)\s+)?(?:datos|campos|valores|informaci[oó]n)\s+(?:requerid\w*|necesari\w*|obligatori\w*)\b/i.test(label.normalize("NFKC").trim())) return [];
    // A bare profile/mode/tab/segment/button choice (no "en <field>" clause) is a fixed navigation action, not runtime data, even when the provider declared an input for it.
    if (operation === "select" && !intent.valueKey && !intent.selectionField
      && /\b(?:perfil|modo|pesta(?:ñ|n)a|tab|segmento|bot[oó]n)\b/i.test(text) && !/\sen\s+(?:el\s+)?(?:campo\s+)?["'“]/i.test(text)) return [];
    const proposedKey =intent.valueKey ?? (typeof supplied?.key === "string" && /^[\w.-]+$/.test(supplied.key) ? supplied.key : `jira_step_${offset + 1}`);
    // Opt-in same-value binding (duplicate-record journeys): only an explicit pointer to an earlier identical fill step reuses its key.
    const original = Number.isInteger(supplied?.reusesValueOfStepIndex) ? firstFills.get(supplied.reusesValueOfStepIndex) : undefined;
    // Different wording is accepted only with explicit same-value intent ("mismo/misma/igual valor") and a compatible field.
    const sameValueIntent = /\b(?:mism[oa]|igual)\s+(?:valor|dato)\b/i.test(text);
    const explicitReuse = original && original.operation === operation && supplied.reusesValueOfStepIndex < offset + 1
      && (original.text === text.trim().toLowerCase() || (sameValueIntent && compatibleFieldLabels(original.label, label))) ? original : undefined;
    // "el mismo nombre" / "la misma entidad bancaria": bind to the nearest earlier same-operation step with a compatible label.
    const namedReuse = !explicitReuse && NAMED_SAME_VALUE.test(text)
      ? [...firstFills.values()].reverse().find(prior => prior.operation === operation && compatibleFieldLabels(prior.label, label)) : undefined;
    // "la cuenta ya registrada/guardada": the account saved earlier; needs a save between the earlier fill and this one.
    const savedAccountReuse = !explicitReuse && !namedReuse && SAVED_ACCOUNT.test(text)
      ? [...firstFills.entries()].reverse().find(([priorIndex, prior]) => prior.operation === operation && compatibleFieldLabels(prior.label, label)
        && steps.slice(priorIndex, offset).some(step => SAVE_STEP.test(step.trim())))?.[1] : undefined;
    const reuse = explicitReuse ?? namedReuse ?? savedAccountReuse;
    let key = reuse ? reuse.key : used.has(proposedKey) ? `jira_step_${offset + 1}` : proposedKey;
    let suffix = 2;
    while (!reuse && used.has(key)) key = `jira_step_${offset + 1}_${suffix++}`;
    used.add(key);
    firstFills.set(offset + 1, { key, operation, label, text: text.trim().toLowerCase() });
    // Privacy classification and HTML input presentation are separate contracts:
    // a token/code may need redaction in logs while remaining readable/editable.
    const sensitive = supplied?.sensitive === true || supplied?.controlType === "password" || /contrase[nñ]a|password|clave|\bpin\b|\botp\b|\btoken\b|c[oó]digo.*(?:acceso|seguridad|verificaci[oó]n)|\bsms\b/i.test(label);
    const controlType = operation === "select" ? "select" : isPasswordLabel(label) ? "password" : /\bfecha\b|\bdate\b/i.test(label) ? "date" : /\bmonto\b|\bamount\b|\bcantidad\b/i.test(label) ? "number" : "text";
    const qualifier = text;
    const dataCondition = /(?:no v[aá]lid|inv[aá]lid|incorrect|invalid)/i.test(qualifier) ? "invalid" as const : /(?:expirad|vencid|expired)/i.test(qualifier) ? "expired" as const : /(?:v[aá]lid|correct|valid)/i.test(qualifier) ? "valid" as const : ["valid", "invalid", "expired"].includes(supplied?.dataCondition) ? supplied.dataCondition as "valid" | "invalid" | "expired" : undefined;
    return [{ dataCondition, key, label, stepIndex: offset + 1, operation, required: true, editable: true, sensitive, controlType, source: "jira_step" as const }];
  });
}

export function jiraScenarioGenerationInstructions(): string {
  // The same delivery grammar is supplied to initial generation and repair prompts.
  return `\n## Jira execution and editable inputs\nFor Jira-generated scenarios, the complete user story and acceptance criteria are authoritative. Document headings (HU, AC, description) are not UI controls. Preserve the ordered journey described in prose, including login and security verification when explicitly in scope. The blanket exclusion of login/OTP/password scenarios does not apply to authentication explicitly required by this Jira story. Include at least one complete successful journey and separate failure journeys for explicitly stated errors. Keep each scenario within one user identity/session and one coherent business objective. When an acceptance workflow changes authenticated roles or user identities, split it into separate self-contained scenarios for each role; never combine logout and login as one step or continue one scenario under a different role. For a story with many independent acceptance criteria, group scenarios by coherent objective while retaining the exact source order within each journey; do not create one oversized scenario spanning unrelated screens or modules. Do not replace entering data with assertions that fields are visible. Use separate atomic actions and meaningful result assertions. Every fill/select action targets exactly one field using its exact source or knowledge label in quotes. Each field listed in the story has its own action and inputRequirement; never group multiple controls into one action, including phrases like "all required fields" or "each required field". Distinguish login verification from transaction authorization. When login is represented by explicit steps, omit authIntent=full_authentication to avoid authenticating before those steps. Use full_authentication only for scenarios whose precondition is an already authenticated user.\nReturn the complete result as one valid JSON response matching the provided schema. No file inspection, file edits, commands or tool calls are needed; all story context is supplied inline. Write natural steps such as Ingresar usuario en "Usuario" or Seleccionar cuenta en "Cuenta de origen", without secret literals or bracketed data placeholders. Return inputRequirements for every fill/select step: {key,label,stepIndex,operation,required:true,editable:true,sensitive,controlType,source:"jira_step"}; stepIndex is 1-based and label is the step's target. Distinct security challenges require distinct keys. For negative cases explicitly state the failing data condition in the action (for example Ingresar un token no válido en "Token") and return dataCondition:"invalid" or "expired" on that inputRequirement. Prior successful authentication inputs must remain valid; never mark all security inputs invalid. A rejection title alone is insufficient. Never invent an invalid literal. When the story specifies choosing a named navigation mode, profile tab, segment or button, emit Presionar "<exact option label from story>". This is a fixed authored UI action, not an editable data selection. Do not invent a container label by combining profile/mode with the option name. Only generate select inputRequirements for an actual data-choice field with a user-supplied value, such as an account list. Do not convert explicit navigation options into generic fields like Seleccionar el perfil en a fabricated label. Preserve exact supplied labels; if a label is unknown, report that uncertainty rather than invent it. Functional nouns in the story are not necessarily literal screen labels: never construct or title-case a control name from prose. If the exact control/error-message wording is unknown, return unresolvedUiRequirements listing the requirement and relevant stepIndex; retain the scenario for review instead of inventing text that passes validation. Preserve conditional source criteria as explicit atomic positive assertions at their correct business stage. Live Discovery observes applicability; never ask the user to configure a condition before Discovery and never skip a requirement just because its target is absent. Include an assertion for every conditional subject whose acceptance clause you claim. A scenario that expects an incomplete operation requires controlled failure setup from the source: use an explicitly stated invalid/expired input relevant to that journey, preserving prior valid setup. Ordinary valid inputs followed by an absence check do not establish that condition. Do not invent network faults, credentials, server errors or test hooks. Unknown UI labels do not justify omitting source-required submit or continue actions: express each action as a semantic target taken from the source intent and put its observation requirement on that action step. For sending verification codes, preserve an explicit request action such as Solicitar el código por SMS when the story names the channel but not the button label; live Discovery must resolve the observed control and certify its target. Never invent a send-button label. Conditional criteria require separate scenarios with declared test conditions; never append cuando aplique or con la condición de que to an otherwise executable step. Do not invent a mechanism for failed transactions: retain the criterion for review when setup is unspecified. Do not invent input values, account options, locators or business rules. Unknown list values remain editable inputs. In each scenario return acceptanceCriteriaRefs with the exact AC identifiers covered. The successful journey must cover the positive criteria in their business order through the final result.\n
Never duplicate an adjacent confirmation assertion group and its submit action. A repeated screen requires a distinct source requirement and distinct step intent; do not repeat the same assertions and Continuar to fill a journey. Preserve conditional acceptance subjects and clause references; do not invent test environment setup steps.
To verify a record after filtering or searching, write Validar que la fila coincidente agregada con <the value just entered> permanezca visible en "<exact table or container name>", taking the container name from the source or from an earlier assertion; never quote the bare phrase "fila coincidente" as the target. When several entered values must appear in a list, assert them all in ONE row step. A filter is proven by a non-matching row seen before and asserted absent after. Never generate a collection-level claim such as "las solicitudes mostradas corresponden al estado seleccionado" unless the journey creates the needed record data or the source/project knowledge declares a matching data fixture in preconditions; otherwise add unresolvedUiRequirements for the missing fixture, leave its acceptance criterion uncovered, and do not mark the scenario executable. Do not assume the environment contains rows: an empty list cannot prove filter/search correctness. Anchor form open/stays-open assertions to the dialog container or a label exclusive to it; when no dialog observation is available, quote a field label that the journey fills inside that form (for example Validar que el formulario con el campo "Alias" permanezca abierto), never the opening button or other text that also exists behind the form, and never an invented label; and treat an already-observed duplicate value as a precondition (no redundant creation; other fields use new values). A duplicate/already-existing rejection may claim its acceptance criteria only if the journey itself creates the record first (enter the values, save, then repeat the identical entry steps) or the source/project knowledge declares the existing record in preconditions. Otherwise omit that criterion from acceptanceCriteriaRefs and leave it uncovered; never write "cuenta ya existente" as if it were data. When a criterion lists alternatives joined by "o" (for example an existing account or a fixed literal such as an alias), cover each alternative in its own scenario and claim the sub-reference in order (ACn.1 for the first alternative, ACn.2 for the second). The sub-reference of an alternative that names a literal may be claimed only by a scenario that enters that exact literal in the matching field and then asserts the rejection; an arbitrary value never covers it, and one scenario never claims two alternatives of the same criterion.
${JIRA_STEP_DELIVERY_INSTRUCTIONS}${JIRA_OUTCOME_DELIVERY_INSTRUCTIONS}`;
}
