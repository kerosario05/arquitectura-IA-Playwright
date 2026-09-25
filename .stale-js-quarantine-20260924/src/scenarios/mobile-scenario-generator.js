"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveScenarioRequiredData = deriveScenarioRequiredData;
exports.materializeFunctionalPrerequisite = materializeFunctionalPrerequisite;
exports.classifyLocatorExecutionBacking = classifyLocatorExecutionBacking;
exports.generateMobileScenarios = generateMobileScenarios;
exports.mobileScenarioToLaunchScenario = mobileScenarioToLaunchScenario;
const jira_scenario_source_1 = require("./jira-scenario-source");
const ai_provider_factory_1 = require("../ai/ai-provider-factory");
const ai_provider_types_1 = require("../ai/ai-provider.types");
const mobile_scenario_prompt_builder_1 = require("./mobile-scenario-prompt-builder");
const mobile_route_profile_1 = require("../mobile/mobile-route-profile");
const mobile_execution_precheck_1 = require("../mobile/mobile-execution-precheck");
const mobile_knowledge_resolver_1 = require("../mobile/mobile-knowledge-resolver");
const mobile_text_normalization_1 = require("../mobile/mobile-text-normalization");
const scenario_functional_quality_1 = require("./scenario-functional-quality");
const hu_declared_persister_1 = require("../knowledge/hu-declared-persister");
const mobile_step_types_1 = require("../mobile/mobile-step-types");
const mobile_destination_claim_1 = require("../mobile/mobile-destination-claim");
/** Flattens all declared dataFields across every screen of the route profile. */
function collectDeclaredDataFields(routeProfile) {
    if (!routeProfile?.screens)
        return [];
    return Object.values(routeProfile.screens).flatMap((s) => s.dataFields ?? []);
}
/**
 * Builds the editable data-field list from a scenario's steps, classifying each as
 * text (fill) or select (a click that picks a declared dropdown option). Declared
 * dataFields in the route profile drive select detection and enrich text labels.
 */
function deriveRequiredData(steps, routeProfile) {
    const normalizeToken = (value) => (0, mobile_text_normalization_1.repairUtf8Mojibake)(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    const declared = collectDeclaredDataFields(routeProfile);
    const declaredSelects = declared.filter((d) => d.kind === "select");
    const declaredTexts = declared.filter((d) => d.kind === "text");
    const workingSteps = [...steps];
    const fields = [];
    // (depKey, insertion index) for text fields that declare a dependency, used to
    // materialize the dependent select when it is missing from the scenario steps.
    const pendingDeps = [];
    steps.forEach((step, idx) => {
        const targetValue = (0, mobile_text_normalization_1.repairUtf8Mojibake)(step.target?.value ?? "");
        const normalizedTargetValue = normalizeToken(targetValue);
        if (step.action === "fill") {
            // A value resolved at runtime via structured step metadata (e.g. an OTP declared with
            // step.otp.required === true) must NOT be surfaced as a manual input. The step remains
            // visible in PASOS; only the manual data request is dropped. This is metadata-driven, never
            // text-driven, so it applies to any future runtime-resolved datum with the same pattern.
            if (step.otp?.required === true) {
                return;
            }
            // Match a declared text field by its locator to inherit its label/sensitivity.
            const match = declaredTexts.find((d) => d.matchLocator.value === targetValue);
            const label = match?.label || step.description?.trim() || targetValue || `Campo ${idx + 1}`;
            fields.push({
                key: match?.key || (0, mobile_step_types_1.slugifyDataKey)(label),
                label,
                kind: "text",
                stepIndex: idx,
                exampleValue: step.value ?? match?.exampleValue ?? "",
                sensitive: match ? match.sensitive : (0, mobile_step_types_1.isSensitiveDataLabel)(label)
            });
            if (match?.dependsOn) {
                pendingDeps.push({ depKey: match.dependsOn, beforeStepIndex: idx });
            }
            return;
        }
        if (step.action === "click" && targetValue) {
            // A click that selects a declared dropdown option (target mentions one of the options).
            for (const sel of declaredSelects) {
                const template = sel.applyTargetTemplate;
                let matchedOption;
                if (template?.value) {
                    // When applyTargetTemplate is declared, prefer matching by strategy: the rendered target
                    // ({{value}} substituted by an option) must match the step target value. When the AI
                    // generates a different strategy (e.g. accessibilityId instead of androidUiAutomator),
                    // fall back to direct text matching so the select field is still detected.
                    const sameStrategy = template.strategy === step.target?.strategy;
                    if (sameStrategy) {
                        matchedOption = (sel.options ?? []).find((opt) => {
                            const rendered = template.value.replace(/{{value}}/g, opt);
                            return normalizeToken(rendered) === normalizeToken(targetValue);
                        });
                    }
                    if (!matchedOption) {
                        // Fallback: match the raw target value against option text by exact (normalized)
                        // equality. This detects the selection when the AI uses a different locator strategy
                        // (e.g. accessibilityId "Cédula de identidad") while NOT counting the selector-opener
                        // click (whose value is a full UiSelector like descriptionContains("Cédula de
                        // identidad") that only contains the option text as a substring).
                        matchedOption = (sel.options ?? []).find((opt) => normalizedTargetValue === normalizeToken(opt));
                    }
                }
                else {
                    // Backward-compatible fallback for selects without an applyTargetTemplate.
                    matchedOption = (sel.options ?? []).find((opt) => normalizedTargetValue.includes(normalizeToken(opt)));
                }
                if (matchedOption) {
                    fields.push({
                        key: sel.key,
                        label: sel.label,
                        kind: "select",
                        stepIndex: idx,
                        exampleValue: matchedOption,
                        sensitive: sel.sensitive,
                        options: sel.options,
                        defaultValue: sel.defaultValue,
                        applyTargetTemplate: sel.applyTargetTemplate,
                        openerLocator: sel.matchLocator
                    });
                    break;
                }
            }
        }
    });
    // Resolve declared dependencies for fields the scenario actually uses. Only when the
    // dependent select is NOT already present do we materialize an open-selector click before
    // the dependent step (the option click itself is appended at runtime by applyDataOverrides
    // from the user's dataOverride value via applyTargetTemplate). Process in descending index
    // so earlier insertions don't disturb the positions of later ones.
    const usedKeys = new Set(fields.map((f) => normalizeToken(f.key)));
    const resolveDependency = (depKey, beforeStepIndex) => {
        const depSelect = declaredSelects.find((d) => d.key === depKey);
        if (!depSelect)
            return;
        if (usedKeys.has(normalizeToken(depSelect.key)))
            return; // already detected from a real step
        if (depSelect.kind !== "select" || !depSelect.applyTargetTemplate)
            return; // only materializable selects
        // If an open-selector click for this select already exists in the steps (e.g. from a prior
        // generation/re-run), reuse it instead of injecting a duplicate.
        const existingOpenerIndex = workingSteps.findIndex((s) => s.action === "click" && s.target?.value === depSelect.matchLocator.value);
        let openerStepIndex = existingOpenerIndex;
        if (existingOpenerIndex === -1) {
            workingSteps.splice(beforeStepIndex, 0, {
                action: "click",
                description: `Abrir selector de ${depSelect.label}`,
                target: depSelect.matchLocator,
            });
            openerStepIndex = beforeStepIndex;
            // Shift existing fields at/after the insertion point by one step.
            for (const f of fields) {
                if (f.stepIndex >= beforeStepIndex)
                    f.stepIndex += 1;
            }
        }
        fields.push({
            key: depSelect.key,
            label: depSelect.label,
            kind: "select",
            stepIndex: openerStepIndex,
            exampleValue: depSelect.defaultValue ?? depSelect.options?.[0] ?? "",
            sensitive: depSelect.sensitive,
            options: depSelect.options,
            defaultValue: depSelect.defaultValue,
            applyTargetTemplate: depSelect.applyTargetTemplate,
            openerLocator: depSelect.matchLocator
        });
        usedKeys.add(normalizeToken(depSelect.key));
    };
    pendingDeps
        .slice()
        .sort((a, b) => b.beforeStepIndex - a.beforeStepIndex)
        .forEach((dep) => resolveDependency(dep.depKey, dep.beforeStepIndex));
    // Guarantee each logical datum appears exactly once, deduplicating by normalized key.
    // For select fields, equivalent detections contribute their unique options (union).
    const seenKeys = new Set();
    const deduped = [];
    for (const field of fields) {
        const normalizedKey = normalizeToken(field.key);
        if (seenKeys.has(normalizedKey)) {
            const existing = deduped.find((f) => normalizeToken(f.key) === normalizedKey);
            if (existing && existing.kind === "select" && field.kind === "select") {
                existing.options = Array.from(new Set([...(existing.options ?? []), ...(field.options ?? [])]));
                if (!existing.defaultValue && field.defaultValue)
                    existing.defaultValue = field.defaultValue;
            }
            continue;
        }
        seenKeys.add(normalizedKey);
        deduped.push(field);
    }
    // Order fields by their effective stepIndex so requiredData reflects execution order.
    // Fields without a valid index sort last while keeping their relative (stable) order.
    deduped.sort((a, b) => (a.stepIndex ?? Infinity) - (b.stepIndex ?? Infinity));
    return { steps: workingSteps, fields: deduped };
}
function deriveScenarioRequiredData(steps, routeProfile) {
    return deriveRequiredData(steps, routeProfile).fields;
}
/** Phrases that indicate a FUNCTIONAL prerequisite (the user must already be at / have passed
 *  a later app state) as opposed to a merely descriptive precondition. Neutral, app-agnostic —
 *  no hardcoded labels, document types or business values. */
const PREREQUISITE_STATE_RE = /\b(?:ya (?:supero|completo|completo|realizo|realizo|cargo|cargo|registro|registro|valido|valido|acepto|acepto)|previamente (?:supero|completo|valido|registro|realizo|cargo)|supero (?:las|la|el|los) (?:validaciones|verificaciones|identidad)|paso por|esta (?:pre)?(?:validado|verificado|autenticado|registrado)|cliente (?:ya )?(?:supero|completo|valido|registro|esta (?:pre)?validado|prevalidado)|usuario (?:ya )?(?:supero|completo|valido|registro|esta (?:pre)?validado|prevalidado)|ya se encuentra en|ya esta en|alcanzo el estado|se encuentra en la pantalla)\b/i;
/** Signals a scenario is pretending to start at a later screen: after launchApp the very next
 *  step is a pure assertion/check on a non-entry screen, with no navigation/fill to reach it. */
function startsAtLaterScreenWithoutPath(steps) {
    if (steps.length < 2 || steps[0]?.action !== "launchApp")
        return false;
    const second = steps[1];
    if (!second)
        return false;
    const isAssert = second.action === "assertVisible" || second.action === "assertEnabled" || second.action === "assertDisabled";
    if (!isAssert)
        return false;
    // A fill/click path would begin the setup; a pure assert right after launch implies magic state.
    return !steps.slice(1).some((s) => s.action === "fill" || s.action === "click");
}
/** Finds a route profile flow whose trigger keywords match the functional precondition text
 *  (or the scenario title/step descriptions, which often restate the required state). Matching
 *  tolerates morphological variants (plural/gender) by checking keyword tokens as substrings. */
function matchFlowForPrerequisite(routeProfile, preconditionText, contextText = "") {
    if (!routeProfile?.flows)
        return null;
    const corpus = (0, mobile_text_normalization_1.repairUtf8Mojibake)(`${preconditionText} ${contextText}`).toLowerCase();
    const tokens = corpus.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
    for (const [flowId, flow] of Object.entries(routeProfile.flows)) {
        const keywords = (flow.triggerKeywords ?? []).map((kw) => (0, mobile_text_normalization_1.repairUtf8Mojibake)(kw).toLowerCase());
        for (const kw of keywords) {
            if (corpus.includes(kw))
                return { flow, flowId };
            // Morphological tolerance: count how many significant keyword tokens appear inside the
            // corpus as substrings (covers plural/gender inflections like validacion(s), cliente(s)).
            const kwTokens = kw.split(/[^a-z0-9]+/).filter((t) => t.length >= 5);
            const hits = kwTokens.filter((tk) => tokens.some((c) => c.includes(tk))).length;
            if (kwTokens.length > 0 && hits >= Math.max(1, Math.ceil(kwTokens.length / 2)))
                return { flow, flowId };
        }
    }
    return null;
}
/**
 * Strict flow matching for intent-driven materialization.
 *
 * Unlike matchFlowForPrerequisite — whose morphological tolerance is deliberately loose
 * because it runs on an explicit precondition sentence — this runs on EVERY story's text,
 * so a loose match silently routes a login story down the registration flow. It therefore
 * requires the whole trigger keyword to appear as a word-bounded phrase, and when several
 * flows match it prefers the most specific (longest) keyword instead of declaration order.
 */
function matchFlowByIntent(routeProfile, text) {
    if (!routeProfile?.flows)
        return null;
    const corpus = ` ${(0, mobile_text_normalization_1.repairUtf8Mojibake)(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
    if (corpus.trim().length === 0)
        return null;
    let best = null;
    for (const [flowId, flow] of Object.entries(routeProfile.flows)) {
        for (const rawKw of flow.triggerKeywords ?? []) {
            const kw = (0, mobile_text_normalization_1.repairUtf8Mojibake)(rawKw).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
            if (!kw)
                continue;
            if (!corpus.includes(` ${kw} `))
                continue;
            if (!best || kw.length > best.keyword.length)
                best = { flow, flowId, keyword: kw };
        }
    }
    return best;
}
/**
 * True when the scenario's own steps already walk every targeted step of the flow's entry
 * path. Prevents prepending a duplicate registration prologue to a scenario the AI already
 * wrote end-to-end from the app launch.
 */
function scenarioAlreadyCoversFlowEntry(scenario, flow) {
    const targeted = flow.entrySteps.filter((st) => Boolean(st.target?.value));
    if (targeted.length === 0)
        return true;
    const present = new Set(scenario.steps.map((s) => s.target?.value).filter((v) => Boolean(v)));
    return targeted.every((st) => present.has(st.target.value));
}
/** Collects the data fields of every screen a flow touches (entry screen + screens referenced
 *  by its entry steps via description/screen mentions) so a prerequisite can surface them. */
function collectFlowDataFields(routeProfile, flow) {
    if (!routeProfile?.screens)
        return [];
    const ids = new Set();
    if (flow.entryFromScreen)
        ids.add(flow.entryFromScreen);
    // Best-effort: any screen whose title/description text appears in an entry step description.
    for (const st of flow.entrySteps) {
        const desc = (0, mobile_text_normalization_1.repairUtf8Mojibake)(st.description ?? "").toLowerCase();
        for (const [id, screen] of Object.entries(routeProfile.screens)) {
            if (desc.includes((0, mobile_text_normalization_1.repairUtf8Mojibake)(screen.title).toLowerCase()))
                ids.add(id);
        }
    }
    const fields = [];
    for (const id of ids) {
        const screen = routeProfile.screens[id];
        if (screen?.dataFields)
            fields.push(...screen.dataFields);
    }
    return fields;
}
/**
 * Materializes a functional prerequisite into real navigation steps + data requirements when
 * the route profile has a matching flow. If no route is known, marks requiresRouteLearning so
 * the scenario is NOT silently left as a launchApp → assert on a later screen (magic state).
 */
function materializeFunctionalPrerequisite(scenario, routeProfile) {
    if (scenario.requiresRouteLearning)
        return scenario;
    const preconditions = scenario.preconditions ?? [];
    const functionalPrecondition = preconditions.find((p) => PREREQUISITE_STATE_RE.test(p));
    const scenarioText = `${scenario.title} ${preconditions.join(" ")} ${scenario.steps.map((s) => `${s.description ?? ""} ${s.target?.value ?? ""}`).join(" ")}`;
    let matched;
    if (functionalPrecondition) {
        // Scenario already contains an explicit setup path — nothing to materialize.
        if (scenario.steps.some((s) => s.action === "fill") || scenario.steps.some((s) => s.action === "click" && s.target?.value)) {
            return scenario;
        }
        matched = matchFlowForPrerequisite(routeProfile, functionalPrecondition, scenarioText);
        if (!matched) {
            console.log(`[mobile:prerequisite] appSlug=${routeProfile?.appSlug ?? "-"} scenario=${scenario.scenarioId} status=requires_route_learning precondition="${functionalPrecondition.slice(0, 120)}" flow=none`);
            return { ...scenario, requiresRouteLearning: true };
        }
    }
    else {
        // Intent-driven materialization: the story itself belongs to a flow (a registration HU
        // describes a step *inside* registration), so the scenario must start at the flow's
        // beginning instead of assuming the app is already on a mid-flow screen. Only the flow's
        // triggerKeywords decide this — no intent is hardcoded here.
        const byIntent = matchFlowByIntent(routeProfile, scenarioText);
        if (!byIntent)
            return scenario;
        if (scenarioAlreadyCoversFlowEntry(scenario, byIntent.flow))
            return scenario;
        matched = { flow: byIntent.flow, flowId: byIntent.flowId };
        console.log(`[mobile:prerequisite] appSlug=${routeProfile?.appSlug ?? "-"} scenario=${scenario.scenarioId} status=flow_intent_matched flow=${byIntent.flowId} keyword="${byIntent.keyword}" source=hu_text`);
    }
    const { flow } = matched;
    const prerequisiteSteps = flow.entrySteps
        .filter((st) => st.action !== "launchApp" && st.action !== "screenshot")
        .map((st) => ({
        action: st.action,
        description: st.description ?? `${st.action} ${st.target?.value ?? ""}`.trim(),
        target: st.target,
        value: st.value,
    }));
    const flowFields = collectFlowDataFields(routeProfile, flow);
    const extraData = flowFields.map((df) => {
        const stepIdx = prerequisiteSteps.findIndex((st) => st.target?.value === df.matchLocator.value);
        return {
            key: df.key,
            label: df.label,
            kind: df.kind,
            stepIndex: stepIdx >= 0 ? stepIdx : 0,
            exampleValue: df.exampleValue ?? df.defaultValue ?? "",
            sensitive: df.sensitive,
            options: df.kind === "select" ? df.options : undefined,
            defaultValue: df.kind === "select" ? df.defaultValue : undefined,
            applyTargetTemplate: df.kind === "select" ? df.applyTargetTemplate : undefined,
            openerLocator: df.kind === "select" ? df.matchLocator : undefined,
        };
    });
    // Merge with existing requiredData (dedupe by key), preserving explicit fields.
    const existingKeys = new Set((scenario.requiredData ?? []).map((f) => f.key));
    const mergedData = [...(scenario.requiredData ?? [])];
    for (const f of extraData) {
        if (!existingKeys.has(f.key)) {
            mergedData.push(f);
            existingKeys.add(f.key);
        }
    }
    console.log(`[mobile:prerequisite] appSlug=${routeProfile?.appSlug ?? "-"} scenario=${scenario.scenarioId} status=materialized flow=${matched.flowId} steps=${prerequisiteSteps.length} dataFields=${extraData.length}`);
    return { ...scenario, prerequisiteSteps, requiredData: mergedData, requiresRouteLearning: false };
}
/** Normalizes a token for evidence matching: repairs mojibake, strips accents, lowercases. */
function normalizeLocatorToken(value) {
    return (0, mobile_text_normalization_1.repairUtf8Mojibake)(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}
/** Field keys that carry TECHNICAL locator identity per strategy. Only these can back a
 *  generated technical locator. Semantic label/text fields NEVER appear here. */
const TECHNICAL_FIELD_KEYS = {
    accessibilityId: ["accessibilityId", "contentDesc", "content-desc", "accessibility-id"],
    id: ["resourceId", "resource-id", "id"],
    xpath: ["xpath", "locatorIdentity"],
    className: ["className", "class", "locatorIdentity"],
    androidUiAutomator: ["androidUiAutomator", "locatorIdentity", "uiAutomator"],
};
function isLocatorStrategy(value) {
    return value === "accessibilityId" || value === "id" || value === "xpath" || value === "className" || value === "androidUiAutomator";
}
function collectStringArray(value) {
    if (Array.isArray(value))
        return value.filter((v) => typeof v === "string");
    if (typeof value === "string")
        return [value];
    return [];
}
function collectTechnicalFromControl(value, strategy) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return [];
    const rec = value;
    const out = [];
    // Explicit strategy/value pair (e.g. { strategy: "accessibilityId", value: "x" }).
    if (typeof rec.strategy === "string" && isLocatorStrategy(rec.strategy) && rec.strategy === strategy && typeof rec.value === "string") {
        out.push(rec.value);
    }
    for (const key of TECHNICAL_FIELD_KEYS[strategy]) {
        out.push(...collectStringArray(rec[key]));
    }
    return out;
}
/**
 * Builds per-strategy sets of TECHNICAL locator identity observed at runtime, plus a set of
 * SEMANTIC control identities. Only the technical set can grant locatorExecutionBacked.
 */
function buildEvidenceSets(knowledge) {
    const technicalByStrategy = new Map();
    const semantic = new Set();
    for (const item of knowledge.items ?? []) {
        if (item.source !== "mcp_runtime_observation")
            continue;
        if (item.validationStatus !== "validated" || item.trustedForReuse !== true)
            continue;
        // SEMANTIC evidence: labels, visible text, business labels, click targets.
        for (const t of [
            ...(item.clickTargets ?? []),
            ...(item.businessLabels ?? []),
            ...(item.assertionTargets ?? []),
        ]) {
            if (typeof t === "string" && t.trim())
                semantic.add(normalizeLocatorToken(t));
        }
        // observedControls may be strings (semantic) or structured controls (may carry technical
        // attributes). Keep semantic labels always; collect technical per strategy when present.
        for (const c of item.observedControls ?? []) {
            if (typeof c === "string") {
                if (c.trim())
                    semantic.add(normalizeLocatorToken(c));
                continue;
            }
            if (c && typeof c === "object") {
                const rec = c;
                for (const t of collectStringArray(rec.label))
                    if (t.trim())
                        semantic.add(normalizeLocatorToken(t));
                for (const t of collectStringArray(rec.businessLabel))
                    if (t.trim())
                        semantic.add(normalizeLocatorToken(t));
                for (const strategy of Object.keys(TECHNICAL_FIELD_KEYS)) {
                    for (const t of collectTechnicalFromControl(c, strategy)) {
                        if (t.trim()) {
                            if (!technicalByStrategy.has(strategy))
                                technicalByStrategy.set(strategy, new Set());
                            technicalByStrategy.get(strategy).add(normalizeLocatorToken(t));
                        }
                    }
                }
            }
        }
        // Item-level technical attributes (direct fields), per strategy.
        for (const strategy of Object.keys(TECHNICAL_FIELD_KEYS)) {
            for (const key of TECHNICAL_FIELD_KEYS[strategy]) {
                for (const t of collectStringArray(item[key])) {
                    if (t.trim()) {
                        if (!technicalByStrategy.has(strategy))
                            technicalByStrategy.set(strategy, new Set());
                        technicalByStrategy.get(strategy).add(normalizeLocatorToken(t));
                    }
                }
            }
        }
    }
    return { technicalByStrategy, semantic };
}
/**
 * Classifies each AI-generated technical locator: it is execution-backed ONLY when runtime
 * evidence contains a matching TECHNICAL attribute for the same strategy (accessibilityId,
 * resource-id, xpath/locatorIdentity, className identity, androidUiAutomator identity).
 * Semantic matches (labels/text) never grant technical authority — if the required technical
 * attribute is absent, the locator stays unbacked (requiresRouteLearning).
 */
/**
 * Backs an `androidUiAutomator` locator by the TECHNICAL attribute it actually anchors on.
 *
 * A UiSelector is an expression, not an identity, so comparing the whole string against
 * observed evidence can never match — which left every `descriptionContains("Continuar")`
 * unbacked even when a control with exactly that content-desc had just been walked. Worse,
 * the route learner itself emits this form, so its own recorded steps failed the gate.
 *
 * The anchor literal is what decides whether the selector resolves at runtime, so that is what
 * gets checked, against the same evidence the equivalent direct strategy would use:
 * `description*` → observed content-desc, `resourceId` → observed resource-id. `text(...)` is
 * deliberately NOT accepted: visible text is semantic evidence, and semantic evidence never
 * grants technical authority. `className(...)` alone identifies nothing.
 */
function isUiSelectorBacked(strategy, raw, contentDescEvidence, resourceIdEvidence) {
    if (strategy !== "androidUiAutomator")
        return false;
    const anchors = (method) => {
        const re = new RegExp(`\\.${method}\\(\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*\\)`, "g");
        const out = [];
        for (const m of raw.matchAll(re))
            out.push(m[1].replace(/\\"/g, '"'));
        return out;
    };
    // Exact-identity forms: the observed attribute must equal the anchor.
    for (const value of [...anchors("description"), ...anchors("descriptionMatches")]) {
        if (contentDescEvidence.has(normalizeLocatorToken(value)))
            return true;
    }
    for (const value of anchors("resourceId")) {
        if (resourceIdEvidence.has(normalizeLocatorToken(value)))
            return true;
    }
    // Containment form: the selector resolves when SOME observed content-desc contains it,
    // which is exactly the runtime semantics of descriptionContains.
    for (const value of anchors("descriptionContains")) {
        const needle = normalizeLocatorToken(value);
        if (!needle)
            continue;
        for (const observed of contentDescEvidence) {
            if (observed.includes(needle))
                return true;
        }
    }
    return false;
}
/**
 * Accepts the positional locator a text field is addressed by.
 *
 * Text fields in these apps expose no content-desc and no resource-id, and their visible text
 * is the placeholder — which typing replaces, so anchoring on it breaks the moment the value
 * is entered. `inputControlToTarget` therefore locates an input by class plus position on
 * purpose. Demanding a technical attribute for a `fill` contradicts the engine's own strategy
 * for inputs and makes every form-filling scenario permanently unexecutable.
 *
 * The tie to reality is kept: the class must have been observed at runtime. Only the identity
 * requirement is relaxed, and only for `fill` — clicks and assertions stay strict, since those
 * do have a stable technical identity to demand.
 */
function isObservedInputLocator(strategy, raw, classEvidence) {
    if (strategy !== "androidUiAutomator")
        return false;
    const match = raw.trim().match(/^new UiSelector\(\)\.className\("((?:[^"\\]|\\.)*)"\)(?:\.instance\(\d+\))?$/);
    if (!match)
        return false;
    return classEvidence.has(normalizeLocatorToken(match[1].replace(/\\"/g, '"')));
}
function classifyLocatorExecutionBacking(scenario, knowledge) {
    const { technicalByStrategy, semantic } = buildEvidenceSets(knowledge);
    const contentDescEvidence = technicalByStrategy.get("accessibilityId") ?? new Set();
    const resourceIdEvidence = technicalByStrategy.get("id") ?? new Set();
    const classEvidence = technicalByStrategy.get("className") ?? new Set();
    let anyTargetStep = false;
    let allBacked = true;
    let anySemanticOnly = false;
    const unbacked = [];
    for (const step of scenario.steps ?? []) {
        const raw = step.target?.value ?? "";
        if (!raw.trim())
            continue;
        const strategy = step.target?.strategy;
        if (!isLocatorStrategy(strategy))
            continue;
        anyTargetStep = true;
        const normalized = normalizeLocatorToken(raw);
        const technicalBacked = (technicalByStrategy.get(strategy)?.has(normalized) ?? false)
            || isUiSelectorBacked(strategy, raw, contentDescEvidence, resourceIdEvidence)
            || (step.action === "fill" && isObservedInputLocator(strategy, raw, classEvidence));
        const semanticMatch = semantic.has(normalized);
        if (!technicalBacked) {
            allBacked = false;
            if (semanticMatch)
                anySemanticOnly = true;
            unbacked.push(`${strategy}:${raw.slice(0, 60)}`);
        }
    }
    const requiresRouteLearning = anyTargetStep ? !allBacked : (scenario.requiresRouteLearning ?? false);
    const locatorExecutionBacked = anyTargetStep ? allBacked : (scenario.locatorExecutionBacked ?? false);
    if (unbacked.length > 0) {
        console.log(`[mobile:locator-authority] appSlug=${scenario.sourceIssueKey ? "-" : "-"} scenario=${scenario.scenarioId} status=${anySemanticOnly ? "semantic_only_unbacked" : "unbacked"} targets=${unbacked.length} locatorExecutionBacked=false requiresRouteLearning=true`);
    }
    return { ...scenario, requiresRouteLearning, locatorExecutionBacked };
}
const TARGET_REQUIRED_ACTIONS = new Set([
    "click",
    "fill",
    "assertVisible",
    "assertEnabled",
    "assertDisabled",
    "waitFor",
]);
function resolveScenarioContainer(parsed) {
    if (!parsed) {
        return { rawScenarios: [], rawRejected: [], contractValid: false };
    }
    const candidates = [
        parsed,
        typeof parsed.result === "object" && parsed.result && !Array.isArray(parsed.result) ? parsed.result : {},
        typeof parsed.payload === "object" && parsed.payload && !Array.isArray(parsed.payload) ? parsed.payload : {},
        typeof parsed.data === "object" && parsed.data && !Array.isArray(parsed.data) ? parsed.data : {},
    ];
    for (const container of candidates) {
        const scenarios = Array.isArray(container.scenarios)
            ? container.scenarios
            : Array.isArray(container.stories)
                ? container.stories
                : null;
        const rejected = Array.isArray(container.rejected) ? container.rejected : [];
        if (scenarios || rejected.length > 0) {
            return {
                rawScenarios: scenarios ?? [],
                rawRejected: rejected,
                contractValid: true,
            };
        }
    }
    return { rawScenarios: [], rawRejected: [], contractValid: false };
}
function isMobileStepAction(value) {
    return value === "launchApp" ||
        value === "click" ||
        value === "fill" ||
        value === "assertVisible" ||
        value === "assertEnabled" ||
        value === "assertDisabled" ||
        value === "waitFor" ||
        value === "screenshot";
}
function normalizeStep(rawStep) {
    if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) {
        return { reason: "invalid_step_object" };
    }
    const stepRecord = rawStep;
    if (!isMobileStepAction(stepRecord.action)) {
        return { reason: "invalid_step_action" };
    }
    const action = stepRecord.action;
    let target;
    if (TARGET_REQUIRED_ACTIONS.has(action)) {
        const rawTarget = stepRecord.target;
        if (!rawTarget || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
            return { reason: "missing_step_target" };
        }
        const targetRecord = rawTarget;
        const strategy = typeof targetRecord.strategy === "string" ? targetRecord.strategy : "";
        const value = typeof targetRecord.value === "string" ? targetRecord.value.trim() : "";
        const validStrategy = strategy === "accessibilityId" || strategy === "id" || strategy === "xpath" || strategy === "androidUiAutomator" || strategy === "className";
        if (!validStrategy || !value) {
            return { reason: "invalid_step_target" };
        }
        target = { strategy: strategy, value };
    }
    // OTP metadata: accept only the structured declaration { required: true, identityField?, channel? }.
    // NEVER accept a static OTP value (string code). If the AI leaked a concrete OTP (in "otp" or a
    // "value" like "123456"/"000000"), treat the step as invalid so no fake code reaches runtime.
    let otp;
    if (stepRecord.otp !== undefined && stepRecord.otp !== null) {
        const rawOtp = stepRecord.otp;
        if (typeof rawOtp === "object" && !Array.isArray(rawOtp)) {
            const required = rawOtp.required === true;
            const leakedCode = (typeof rawOtp.code === "string" && /^\d{4,8}$/.test(rawOtp.code.trim())) ||
                (typeof rawOtp.value === "string" && /^\d{4,8}$/.test(rawOtp.value.trim())) ||
                (typeof rawOtp.otp === "string" && /^\d{4,8}$/.test(rawOtp.otp.trim()));
            if (required && !leakedCode) {
                otp = {
                    required: true,
                    identityField: typeof rawOtp.identityField === "string" && rawOtp.identityField.trim()
                        ? rawOtp.identityField.trim()
                        : undefined,
                    channel: typeof rawOtp.channel === "string" && rawOtp.channel.trim()
                        ? rawOtp.channel.trim()
                        : undefined,
                };
            }
            else if (leakedCode) {
                return { reason: "static_otp_not_allowed" };
            }
        }
    }
    // If the step is a fill and the AI wrote a static 6-digit code into value in an OTP context
    // (explicit banned "000000", or description referencing OTP/código), reject it — dynamic OTP
    // must be resolved at runtime, never hardcoded.
    if (action === "fill") {
        const rawValue = typeof stepRecord.value === "string" ? stepRecord.value.trim() : "";
        const rawDesc = typeof stepRecord.description === "string" ? stepRecord.description.toLowerCase() : "";
        const otpContext = /otp|codigo|cod\.|verificacion|validacion de codigo/i.test(rawDesc);
        const looksStaticOtp = otpContext && /^\d{6}$/.test(rawValue) && rawValue !== "";
        if (looksStaticOtp && stepRecord.otp === undefined) {
            return { reason: "static_otp_not_allowed" };
        }
    }
    const normalized = {
        action,
        description: typeof stepRecord.description === "string" ? stepRecord.description : undefined,
        target,
        value: typeof stepRecord.value === "string" ? stepRecord.value : undefined,
        timeoutMs: typeof stepRecord.timeoutMs === "number" && Number.isFinite(stepRecord.timeoutMs) && stepRecord.timeoutMs > 0
            ? stepRecord.timeoutMs
            : undefined,
        otp,
    };
    return { step: normalized };
}
function classifyProviderError(error) {
    if (!(error instanceof ai_provider_types_1.AiProviderError)) {
        return "ai_provider_failed";
    }
    if (error.code === "copilot_cli_empty_output" ||
        error.code === "claude_cli_empty_output" ||
        error.code === "ai_provider_output_missing") {
        return "ai_empty_output";
    }
    if (error.code === "ai_provider_invalid_json") {
        return "ai_invalid_json";
    }
    if (error.code === "copilot_cli_execution_failed" ||
        error.code === "claude_cli_execution_failed" ||
        error.code === "ai_provider_process_error" ||
        error.code === "ai_provider_http_error" ||
        error.code === "ai_provider_timeout") {
        return "ai_provider_failed";
    }
    return "ai_provider_failed";
}
function readErrorExitCode(error) {
    if (!(error instanceof ai_provider_types_1.AiProviderError) || !error.diagnostics)
        return undefined;
    const raw = error.diagnostics.exitCode;
    if (typeof raw === "number" && Number.isFinite(raw))
        return raw;
    if (typeof raw === "string" && raw.trim()) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
}
function readErrorOutputLength(error) {
    if (!(error instanceof ai_provider_types_1.AiProviderError) || !error.diagnostics)
        return 0;
    const diagnostics = error.diagnostics;
    const stdout = diagnostics.stdout;
    if (typeof stdout === "string")
        return stdout.length;
    const stdoutPreview = diagnostics.stdoutPreview;
    if (typeof stdoutPreview === "string")
        return stdoutPreview.length;
    return 0;
}
function parseRequiresManualData(value) {
    return typeof value === "boolean" ? value : value === "true" || value === 1;
}
/** Canonicalizes a criterion identifier so AI-declared and HU-extracted ids compare equal. */
function normalizeCriterionId(raw) {
    return raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}
function parseCriterionIds(value) {
    if (!Array.isArray(value))
        return undefined;
    const ids = Array.from(new Set(value
        .filter((v) => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
        .map(normalizeCriterionId)));
    return ids.length > 0 ? ids : undefined;
}
function parseStepRequirementRefs(value, stepCount) {
    if (!Array.isArray(value) || value.length === 0)
        return undefined;
    const refs = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
            continue;
        const r = raw;
        const idx = typeof r.stepIndex === "number" && Number.isInteger(r.stepIndex) && r.stepIndex >= 0 && r.stepIndex < stepCount
            ? r.stepIndex
            : undefined;
        if (idx === undefined)
            continue;
        const ids = Array.isArray(r.requirementIds)
            ? Array.from(new Set(r.requirementIds.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean).map(normalizeCriterionId)))
            : [];
        if (ids.length > 0)
            refs.push({ stepIndex: idx, requirementIds: ids });
    }
    return refs.length > 0 ? refs : undefined;
}
function validateStepRequirementRefs(refs, canonicalIds) {
    const canonicalSet = new Set(canonicalIds);
    return refs
        .map((ref) => {
        const validIds = ref.requirementIds.filter((id) => canonicalSet.has(id));
        return validIds.length > 0 ? { stepIndex: ref.stepIndex, requirementIds: validIds } : null;
    })
        .filter((ref) => ref !== null);
}
/**
 * Extracts acceptance-criterion identifiers from the HU text delivered to the generator.
 * Supports explicit labels (CA/AC/CRIT/CRITERIO/CRITÉRIO + number) and falls back to a
 * numbered/bulleted list when no explicit labels exist. Returns canonical ids (e.g. "CA01").
 */
function extractCriterionIds(text) {
    if (!text)
        return [];
    const ids = new Set();
    const labelRe = /\b(?:CA|AC|CRIT|CRITERIO|CRITÉRIO)\s*[-#.:]?\s*\d{1,3}\b/gi;
    let m;
    while ((m = labelRe.exec(text)) !== null) {
        ids.add(normalizeCriterionId(m[0]));
    }
    if (ids.size > 0)
        return Array.from(ids);
    let ordinal = 0;
    const listIds = [];
    for (const line of text.split(/\r?\n/)) {
        if (/^\s*\d{1,3}\s*[.)]\s+/.test(line)) {
            ordinal++;
            listIds.push(`C${ordinal}`);
        }
    }
    return listIds;
}
const CRITERION_STATUS_RANK = {
    covered: 4,
    blocked: 3,
    rejected: 2,
    missing: 1,
};
/**
 * Builds per-criterion coverage after generation + precheck. Known criterion ids start as
 * "missing" and are promoted by declared coverage: accepted scenarios → "covered", precheck
 * blocks (technical incapability) → "blocked", AI-rejected → "rejected". Higher rank wins.
 */
function buildCriterionCoverage(knownIds, accepted, aiRejected, blocked) {
    const map = new Map();
    const ensure = (id) => {
        let c = map.get(id);
        if (!c) {
            c = { criterionId: id, status: "missing", scenarioIds: [] };
            map.set(id, c);
        }
        return c;
    };
    for (const id of knownIds)
        ensure(id);
    const apply = (id, nextStatus, scenarioId, reasonCode) => {
        const c = ensure(id);
        if (CRITERION_STATUS_RANK[nextStatus] > CRITERION_STATUS_RANK[c.status]) {
            c.status = nextStatus;
            if (reasonCode !== undefined)
                c.reasonCode = reasonCode;
        }
        if (scenarioId && !c.scenarioIds.includes(scenarioId)) {
            c.scenarioIds.push(scenarioId);
        }
    };
    for (const s of accepted) {
        for (const id of s.coveredCriteria ?? [])
            apply(id, "covered", s.scenarioId);
    }
    for (const b of blocked) {
        for (const id of b.coveredCriteria ?? [])
            apply(id, "blocked", undefined, b.reasonCode);
    }
    for (const r of aiRejected) {
        for (const id of r.coveredCriteria ?? [])
            apply(id, "rejected");
    }
    return Array.from(map.values());
}
function parseAiScenarios(parsed, fallbackIssueKey, routeProfile, knowledge, destinationClaimManifest) {
    const scenarios = [];
    const rejected = [];
    const droppedReasons = [];
    let droppedCount = 0;
    const container = resolveScenarioContainer(parsed);
    const rawScenarios = container.rawScenarios;
    let localIndex = 0;
    for (const s of rawScenarios) {
        if (!s || typeof s !== "object" || Array.isArray(s)) {
            droppedCount++;
            droppedReasons.push("invalid_scenario_object");
            continue;
        }
        const rawScenario = s;
        const rawSteps = Array.isArray(rawScenario.steps) ? rawScenario.steps : [];
        if (rawSteps.length === 0) {
            droppedCount++;
            droppedReasons.push("missing_steps");
            continue;
        }
        const normalizedSteps = [];
        let invalidStepReason;
        for (const rawStep of rawSteps) {
            const normalized = normalizeStep(rawStep);
            if (!normalized.step) {
                invalidStepReason = normalized.reason ?? "invalid_step_contract";
                break;
            }
            normalizedSteps.push(normalized.step);
        }
        if (invalidStepReason) {
            droppedCount++;
            droppedReasons.push(invalidStepReason);
            continue;
        }
        const sourceIssueKey = typeof rawScenario.sourceIssueKey === "string" ? rawScenario.sourceIssueKey : fallbackIssueKey;
        localIndex++;
        const steps = normalizedSteps;
        // deriveRequiredData may materialize a dependent select click, so it can change `steps`.
        const derivedData = deriveRequiredData(steps, routeProfile);
        let scenario = {
            // Assigned server-side (not by the AI) so it's stable across re-runs and
            // guaranteed unique — launchExecution() rejects duplicate scenarioIds.
            scenarioId: `MOBILE-${sourceIssueKey}-${String(localIndex).padStart(3, "0")}`,
            sourceIssueKey,
            title: typeof rawScenario.title === "string" ? rawScenario.title : fallbackIssueKey,
            steps: derivedData.steps,
            expectedResult: typeof rawScenario.expectedResult === "string" && rawScenario.expectedResult.trim()
                ? rawScenario.expectedResult.trim()
                : "El escenario se ejecuta sin errores.",
            preconditions: Array.isArray(rawScenario.preconditions)
                ? rawScenario.preconditions.filter((p) => typeof p === "string")
                : [],
            requiredData: derivedData.fields,
            requiredDataProfile: typeof rawScenario.requiredDataProfile === "string" && rawScenario.requiredDataProfile.trim()
                ? rawScenario.requiredDataProfile.trim()
                : undefined,
            requiresManualData: parseRequiresManualData(rawScenario.requiresManualData),
            coveredCriteria: parseCriterionIds(rawScenario.coveredCriteria),
            stepRequirementRefs: parseStepRequirementRefs(rawScenario.stepRequirementRefs, steps.length),
            stepDestinationExpectations: (0, mobile_destination_claim_1.parseStepDestinationExpectations)(rawScenario.stepDestinationExpectations, steps.length, parseCriterionIds(rawScenario.coveredCriteria) ?? [], destinationClaimManifest),
        };
        scenario = materializeFunctionalPrerequisite(scenario, routeProfile);
        scenario = classifyLocatorExecutionBacking(scenario, knowledge ?? { items: [] });
        scenarios.push(scenario);
    }
    const rawRejected = container.rawRejected;
    for (const r of rawRejected) {
        rejected.push({
            sourceIssueKey: typeof r?.sourceIssueKey === "string" ? String(r.sourceIssueKey) : fallbackIssueKey,
            reason: typeof r?.reason === "string" ? String(r.reason) : "issue_not_mobile_automatable",
            coveredCriteria: parseCriterionIds(r.coveredCriteria)
        });
    }
    return {
        scenarios,
        rejected,
        diagnostics: {
            parsed: Boolean(parsed),
            contractValid: container.contractValid,
            rawScenarioCount: rawScenarios.length,
            rawRejectedCount: rawRejected.length,
            normalizationDroppedCount: droppedCount,
            dropReasons: Array.from(new Set(droppedReasons)),
            finalScenarioCount: scenarios.length,
            finalRejectedCount: rejected.length,
        },
    };
}
/**
 * Generates mobile (Appium) test steps from Jira issues via AI. Each issue gets its
 * own independent AI call — batching multiple issues into one prompt is what caused
 * the equivalent web pipeline to silently drop all but the first issue (see the
 * scenario-preview.service.ts fix earlier this session); this generator is built to
 * not repeat that mistake.
 *
 * There is no mobile equivalent of the web route-profile/app.knowledge grounding yet,
 * so steps are generated from the HU text alone and will often need manual correction
 * before they reliably drive a real app — same quality ceiling the web pipeline hits
 * for issues without a matching routeProfile.
 */
async function generateMobileScenarios(jiraConfig, projectKey, sprintId, status, maxResults = 50, appSlug, deps = {}) {
    const loadIssues = deps.loadIssues ?? jira_scenario_source_1.loadJiraIssues;
    const createProvider = deps.createProvider ?? ai_provider_factory_1.createScenarioAiProvider;
    const logger = deps.logger ?? console;
    const loadedIssues = await loadIssues(jiraConfig, projectKey, sprintId, status, maxResults);
    const selectedIssueKeys = Array.isArray(deps.selectedIssueKeys)
        ? deps.selectedIssueKeys.map((key) => key?.trim()).filter((key) => Boolean(key))
        : [];
    const selectedIssueKeySet = new Set(selectedIssueKeys);
    const issues = selectedIssueKeySet.size > 0
        ? loadedIssues.filter((issue) => selectedIssueKeySet.has(issue.key))
        : loadedIssues;
    if (selectedIssueKeySet.size > 0) {
        logger.log(`[mobile:scenarios] selectedIssueKeys requested=${selectedIssueKeySet.size} matched=${issues.length} loaded=${loadedIssues.length}`);
    }
    if (issues.length === 0) {
        deps.onIssuesResolved?.([]);
        return { scenarios: [], rejected: [], issuesFound: 0, criterionCoverage: [], diagnosticsByIssue: {} };
    }
    deps.onIssuesResolved?.(issues.map((issue) => issue.key));
    const routeProfile = appSlug ? (0, mobile_route_profile_1.loadMobileRouteProfile)(appSlug) : null;
    const knowledge = appSlug ? (0, mobile_knowledge_resolver_1.loadMobileKnowledge)(appSlug) : { items: [] };
    if (appSlug) {
        logger.log(`[mobile:scenarios] routeProfile appSlug=${appSlug} found=${routeProfile !== null} screens=${routeProfile?.screens ? Object.keys(routeProfile.screens).length : 0} knowledgeItems=${knowledge.items.length}`);
    }
    // Build destination claim manifest BEFORE provider call from authoritative sources.
    // This manifest establishes which destination claims are valid. The provider can only
    // REFERENCE claims in this manifest, not create new ones.
    const allCanonicalIds = issues.flatMap((issue) => extractCriterionIds(issue.acceptanceCriteria || issue.description || ""));
    const routeProfileScreenIds = routeProfile?.screens ? Object.keys(routeProfile.screens) : undefined;
    const destinationClaimManifest = (0, mobile_destination_claim_1.buildMobileDestinationClaimManifest)(allCanonicalIds, routeProfileScreenIds);
    if (destinationClaimManifest.length > 0) {
        logger.log(`[mobile:scenarios] destinationClaimManifest claims=${destinationClaimManifest.length}`);
    }
    else {
        logger.log(`[mobile:scenarios] destinationClaimManifest claims=0 (no authoritative requirement→destination binding)`);
    }
    const scenarios = [];
    const rejected = [];
    const criterionCoverage = [];
    const diagnosticsByIssue = {};
    for (const [issueIndex, issue] of issues.entries()) {
        const issueStartedAtMs = Date.now();
        const issueStartedAt = new Date(issueStartedAtMs).toISOString();
        deps.onIssueStart?.({
            issueKey: issue.key,
            index: issueIndex,
            total: issues.length,
            startedAt: issueStartedAt,
        });
        logger.log(`[mobile:scenarios] generating steps for issue=${issue.key}`);
        try {
            const provider = await createProvider();
            const huText = [issue.summary, issue.description, issue.acceptanceCriteria].filter(Boolean).join(" ");
            const learnedScreens = (0, mobile_knowledge_resolver_1.selectRelevantMobileKnowledge)(knowledge, huText);
            if (learnedScreens.length > 0) {
                logger.log(`[mobile:scenarios] issue=${issue.key} injecting ${learnedScreens.length} learned screen(s) from previous runs`);
            }
            const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(issue, routeProfile, learnedScreens, destinationClaimManifest);
            const response = await provider.completeJson({
                messages,
                purpose: "scenario_generation",
                requireJson: true
            });
            const parsed = parseAiScenarios(response.parsedJson, issue.key, routeProfile, knowledge, destinationClaimManifest);
            const issueScenarios = parsed.scenarios;
            const issueRejected = parsed.rejected;
            let classifiedReason;
            const issueAccepted = [];
            const canonicalIds = extractCriterionIds(issue.acceptanceCriteria || issue.description || "");
            const blockedForCoverage = [];
            if (issueScenarios.length === 0 && issueRejected.length === 0) {
                if (!parsed.diagnostics.contractValid) {
                    classifiedReason = "ai_contract_mismatch";
                }
                else if (parsed.diagnostics.normalizationDroppedCount > 0) {
                    classifiedReason = "all_scenarios_dropped";
                }
                else if ((response.rawText ?? "").trim().length === 0) {
                    classifiedReason = "ai_empty_output";
                }
                else {
                    classifiedReason = "ai_empty_output";
                }
                rejected.push({ sourceIssueKey: issue.key, reason: classifiedReason });
            }
            else {
                const precheckExcluded = [];
                for (const scenario of issueScenarios) {
                    const precheck = (0, mobile_execution_precheck_1.evaluateScenarioPrecheck)(scenario.steps, appSlug, scenario.expectedResult, scenario.requiredDataProfile);
                    if (precheck.blocked) {
                        precheckExcluded.push({
                            sourceIssueKey: issue.key,
                            reason: `${precheck.reasonCode}:${precheck.detail}`,
                            coveredCriteria: scenario.coveredCriteria,
                        });
                        blockedForCoverage.push({ coveredCriteria: scenario.coveredCriteria, reasonCode: precheck.reasonCode });
                        console.log(`[mobile-scenarios:precheck] excluded=${scenario.scenarioId} reasonCode=${precheck.reasonCode} detail=${precheck.detail}`);
                    }
                    else {
                        const functionalData = precheck.functionalData;
                        if (functionalData?.status === "manual_data_required") {
                            scenario.requiresManualData = true;
                            console.log(`[mobile-scenarios:precheck] manualDataRequired=${scenario.scenarioId} reasonCode=${functionalData.reasonCode} detail=${functionalData.detail}`);
                        }
                        else if (functionalData?.status === "resolved") {
                            scenario.requiresManualData = false;
                            console.log(`[mobile-scenarios:precheck] functionalDataResolved=${scenario.scenarioId}`);
                        }
                        if (scenario.stepRequirementRefs && canonicalIds.length > 0) {
                            scenario.stepRequirementRefs = validateStepRequirementRefs(scenario.stepRequirementRefs, canonicalIds);
                        }
                        // Validate destination expectations against stepRequirementRefs (fail-closed).
                        if (scenario.stepDestinationExpectations && scenario.stepDestinationExpectations.length > 0) {
                            scenario.stepDestinationExpectations = (0, mobile_destination_claim_1.validateStepDestinationExpectations)(scenario.stepDestinationExpectations, scenario.stepRequirementRefs);
                            if (scenario.stepDestinationExpectations.length === 0) {
                                scenario.stepDestinationExpectations = undefined;
                            }
                        }
                        scenarios.push(scenario);
                        issueAccepted.push(scenario);
                    }
                }
                rejected.push(...issueRejected, ...precheckExcluded);
            }
            const issueCoverage = buildCriterionCoverage(extractCriterionIds(issue.acceptanceCriteria || issue.description || ""), issueAccepted, issueRejected, blockedForCoverage);
            criterionCoverage.push(...issueCoverage);
            const missingCriteria = issueCoverage.filter((c) => c.status === "missing");
            const hasMissing = missingCriteria.length > 0;
            logger.log(`[mobile:scenarios:coverage] issue=${issue.key} complete=${!hasMissing} criteria=${issueCoverage.length} covered=${issueCoverage.filter((c) => c.status === "covered").length} blocked=${issueCoverage.filter((c) => c.status === "blocked").length} rejected=${issueCoverage.filter((c) => c.status === "rejected").length} missing=${missingCriteria.length} missingIds=${missingCriteria.map((c) => c.criterionId).join(",") || "-"}`);
            const finalRejectedCount = issueRejected.length + (classifiedReason ? 1 : 0);
            const issueDiagnostics = {
                providerExitCode: response.diagnostics?.exitCode,
                rawOutputLength: response.rawText?.length ?? 0,
                parsed: parsed.diagnostics.parsed,
                contractValid: parsed.diagnostics.contractValid,
                rawScenarioCount: parsed.diagnostics.rawScenarioCount,
                rawRejectedCount: parsed.diagnostics.rawRejectedCount,
                normalizationDroppedCount: parsed.diagnostics.normalizationDroppedCount,
                dropReasons: parsed.diagnostics.dropReasons,
                finalScenarioCount: issueScenarios.length,
                finalRejectedCount,
                classifiedReason,
            };
            diagnosticsByIssue[issue.key] = issueDiagnostics;
            logger.log(`[mobile:scenarios:diag] issue=${issue.key} providerExitCode=${response.diagnostics?.exitCode ?? "n/a"} rawOutputLength=${response.rawText?.length ?? 0} parsed=${parsed.diagnostics.parsed} contractValid=${parsed.diagnostics.contractValid} rawScenarioCount=${parsed.diagnostics.rawScenarioCount} rawRejectedCount=${parsed.diagnostics.rawRejectedCount} normalizationDroppedCount=${parsed.diagnostics.normalizationDroppedCount} dropReasons=${parsed.diagnostics.dropReasons.join(",") || "-"} finalScenarioCount=${issueScenarios.length} finalRejectedCount=${finalRejectedCount} classifiedReason=${classifiedReason ?? "-"}`);
            logger.log(`[mobile:scenarios] issue=${issue.key} scenarios=${issueScenarios.length} rejected=${finalRejectedCount}`);
            // ── hu_declared knowledge persistence (shared with Web) ────────────
            if (appSlug) {
                try {
                    const huText = [issue.summary, issue.description, issue.acceptanceCriteria].filter(Boolean).join(" ");
                    const requirementAccounting = (0, scenario_functional_quality_1.buildRequirementAccounting)([], [], huText, issue.key);
                    const result = await (0, hu_declared_persister_1.persistHuDeclaredKnowledge)(appSlug, requirementAccounting, [], issue.key);
                    logger.log(`[mobile:hu-declared] appSlug=${appSlug} issueKey=${issue.key} derived=${result.derived} inserted=${result.inserted} updated=${result.updated} deduped=${result.deduped}`);
                }
                catch (err) {
                    console.warn(`[mobile:hu-declared] appSlug=${appSlug} issueKey=${issue.key} reason=persist_failed err=${err.message}`);
                }
            }
            const issueFinishedAtMs = Date.now();
            const issueFinishedAt = new Date(issueFinishedAtMs).toISOString();
            deps.onIssueCompleted?.({
                issueKey: issue.key,
                index: issueIndex,
                total: issues.length,
                status: "completed",
                startedAt: issueStartedAt,
                finishedAt: issueFinishedAt,
                durationMs: issueFinishedAtMs - issueStartedAtMs,
                scenarios: issueScenarios,
                rejected: classifiedReason ? [...issueRejected, { sourceIssueKey: issue.key, reason: classifiedReason }] : issueRejected,
                criterionCoverage: issueCoverage,
                diagnostics: issueDiagnostics,
                classifiedReason,
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const classifiedReason = classifyProviderError(err);
            rejected.push({ sourceIssueKey: issue.key, reason: classifiedReason });
            const issueDiagnostics = {
                providerExitCode: readErrorExitCode(err),
                rawOutputLength: readErrorOutputLength(err),
                parsed: false,
                contractValid: false,
                rawScenarioCount: 0,
                rawRejectedCount: 0,
                normalizationDroppedCount: 0,
                dropReasons: [],
                finalScenarioCount: 0,
                finalRejectedCount: 1,
                classifiedReason,
            };
            diagnosticsByIssue[issue.key] = issueDiagnostics;
            const issueCoverage = buildCriterionCoverage(extractCriterionIds(issue.acceptanceCriteria || issue.description || ""), [], [], []);
            criterionCoverage.push(...issueCoverage);
            logger.error(`[mobile:scenarios] issue=${issue.key} generation failed reason=${classifiedReason} message=${message}`);
            logger.log(`[mobile:scenarios:diag] issue=${issue.key} providerExitCode=${readErrorExitCode(err) ?? "n/a"} rawOutputLength=${readErrorOutputLength(err)} parsed=false contractValid=false rawScenarioCount=0 rawRejectedCount=0 normalizationDroppedCount=0 dropReasons=- finalScenarioCount=0 finalRejectedCount=1 classifiedReason=${classifiedReason}`);
            const issueCoverageMissing = issueCoverage.filter((c) => c.status === "missing").length;
            logger.log(`[mobile:scenarios:coverage] issue=${issue.key} complete=${issueCoverageMissing === 0} criteria=${issueCoverage.length} covered=0 blocked=0 rejected=0 missing=${issueCoverageMissing} missingIds=${issueCoverage.filter((c) => c.status === "missing").map((c) => c.criterionId).join(",") || "-"}`);
            const issueFinishedAtMs = Date.now();
            const issueFinishedAt = new Date(issueFinishedAtMs).toISOString();
            deps.onIssueCompleted?.({
                issueKey: issue.key,
                index: issueIndex,
                total: issues.length,
                status: "failed",
                startedAt: issueStartedAt,
                finishedAt: issueFinishedAt,
                durationMs: issueFinishedAtMs - issueStartedAtMs,
                scenarios: [],
                rejected: [{ sourceIssueKey: issue.key, reason: classifiedReason }],
                criterionCoverage: issueCoverage,
                diagnostics: issueDiagnostics,
                classifiedReason,
                errorMessage: message,
            });
        }
    }
    return { scenarios, rejected, issuesFound: issues.length, criterionCoverage, diagnosticsByIssue };
}
/**
 * Converts an AI-generated mobile scenario into the shape the (unmodified, reused)
 * web TestRail publish pipeline expects. `steps` becomes one human-readable row per
 * MobileStep (its `description`), matching how web scenario steps are already plain
 * strings — the structured MobileStep[] (locators/values) stays with the caller for
 * execution, it is not needed by TestRail.
 */
function mobileScenarioToLaunchScenario(s) {
    const setupSteps = (s.prerequisiteSteps ?? [])
        .map((st) => st.description?.trim() || `${st.action} ${st.target?.value ?? st.value ?? ""}`.trim());
    const scenarioSteps = s.steps.map((st) => st.description?.trim() || `${st.action} ${st.target?.value ?? st.value ?? ""}`.trim());
    const metadata = {};
    if (s.requiresRouteLearning)
        metadata.requiresRouteLearning = true;
    if (s.prerequisiteSteps?.length)
        metadata.prerequisiteSteps = s.prerequisiteSteps.length;
    if (s.requiredDataProfile)
        metadata.requiredDataProfile = s.requiredDataProfile;
    return {
        scenarioId: s.scenarioId,
        title: s.title,
        steps: [...setupSteps, ...scenarioSteps],
        expectedResult: s.expectedResult,
        preconditions: s.preconditions,
        sourceIssueKey: s.sourceIssueKey,
        // The shared launch orchestrator classifies anything without `mcpExecutable === true` as
        // "adaptive", and then blocks it for lacking targetScreen/actualChain/requiredChain —
        // web-only fields a mobile scenario never has. Every mobile scenario therefore fell out as
        // "no launchable scenarios", no matter how well it had been learned. Mobile readiness is
        // decided before this adapter runs: the route already excluded everything still requiring
        // route learning, so what reaches here is exactly the executable set.
        mcpExecutable: s.requiresRouteLearning !== true,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
}
