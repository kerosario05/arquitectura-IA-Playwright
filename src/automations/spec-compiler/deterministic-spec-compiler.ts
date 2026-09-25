import path from "node:path";
import {
  SpecExecutionContract,
  SpecExecutionContractStep,
  SpecStepOperation,
  SpecStepTarget,
} from "../spec-execution-contract";
import { ACTION_RUNTIME_METHOD_BY_OPERATION } from "../../types/pom-ownership";
import { buildPortablePathFromSpec } from "../spec-generator-pom";
import type { CertifiedTechnicalTarget } from "../technical-target-materializer";
import { isUniqueLineage } from "../../db/recording-route-observation-repository";

/**
 * First kernel of the deterministic (non-AI) spec compiler.
 *
 * Consumes the existing SpecExecutionContract authority and emits Playwright
 * TypeScript source for a fixed, known-safe subset of CORE operations, using
 * only structured contract fields (operation, target, value/valueKey, oracle).
 * No text interpretation, no AI calls, no browser access, no POM invention.
 */

/**
 * Materialization context: WHERE the compiled source will physically be
 * persisted. Deliberately kept OUT of SpecExecutionContract (which describes
 * only WHAT to execute, never filesystem placement) -- required, not
 * optional, so a caller can never silently receive imports computed relative
 * to the wrong location. `targetSpecPath` is the real (or intended) absolute
 * path of the eventual case.spec.ts; only that value, never appSlug/
 * sectionSlug/scenarioId, is used to derive import paths, and only via the
 * SAME `buildPortablePathFromSpec` the AI-generation path already uses --
 * no second relative-path algorithm.
 */
export type SpecCompileContext = {
  targetSpecPath: string;
};

/**
 * One prior step's replay authority, captured verbatim while compiling that step's OWN
 * click/fill/press call -- never a second locator/value derivation. `replayExpr` is the exact
 * same callback body (as source text) already emitted for that step's `action:`/`fill:`
 * closure (click/fill), or a call to the SAME `pageObject.press({...})` already emitted for a
 * press step. `sensitive` marks a step whose replay must never be attempted automatically (the
 * recorded auth-gate credential fill) -- included in the transported array for transparency
 * (never silently dropped), but excluded from execution by the existing
 * `safeReplayContext`/`isSafeActionToReplay` runtime gate (`!s.sensitive`).
 */
type PreviousStepReplay = {
  scenarioStepIndex: number;
  actionIntent: string;
  targetRef: string;
  sensitive: boolean;
  replayExpr: string;
};

function buildPreviousStepReplaysLiteral(
  replays: readonly PreviousStepReplay[],
  beforeScenarioStepIndex: number,
): string {
  const prior = replays
    .filter((replay) => replay.scenarioStepIndex < beforeScenarioStepIndex)
    .sort((a, b) => a.scenarioStepIndex - b.scenarioStepIndex);
  if (prior.length === 0) return "[]";
  const items = prior.map((replay) => (
    `{ stepIndex: ${replay.scenarioStepIndex}, actionIntent: '${escapeString(replay.actionIntent)}', ` +
    `target: '${escapeString(replay.targetRef)}', sensitive: ${replay.sensitive}, replay: ${replay.replayExpr} }`
  ));
  return `[${items.join(", ")}]`;
}

const PROMOTED_RUNTIME_ABS_PATH = path.resolve(process.cwd(), "src/automations/runtime/promoted-spec-runtime.ts");
const TARGET_RESOLVER_ABS_PATH = path.resolve(process.cwd(), "src/discovery/target-resolver.ts");

function portableImportPath(targetSpecPath: string, absoluteTargetPath: string): string {
  return buildPortablePathFromSpec(targetSpecPath, absoluteTargetPath).replace(/\.ts$/, "");
}

export type SpecCompilerSupportedOperation = Extract<SpecStepOperation, "fill" | "press" | "click">;

/**
 * Deterministic Page Object shell: pure organization/maintainability layer,
 * never scenario authority. It carries no business-specific classes/methods
 * (no LoginPage/ProductPage, no text-derived method names) because no
 * structural, non-text-derived owner/method association exists anywhere the
 * compiler is allowed to consult (SemanticMethodIntent-based ownership in
 * types/pom-ownership.ts is itself text/business-derived and is the same
 * class of authority that produced the historical `executeAction`/POM-drift
 * incident this session traced -- reusing it here would reintroduce exactly
 * that risk). Each method is explicit per operation (never a generic
 * `executeAction`) and forwards its options object unchanged to the SAME
 * existing promoted-runtime action wrapper -- no reinterpretation, no new
 * resolver, no locator invention.
 */
const POM_CLASS_NAME = "DeterministicPromotedPage";
const POM_METHOD_BY_OPERATION: Record<SpecCompilerSupportedOperation, string> = {
  fill: "fill",
  click: "click",
  press: "press",
};

function buildPomClassSource(): string[] {
  return [
    `class ${POM_CLASS_NAME} {`,
    `  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}`,
    `  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }`,
    `  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }`,
    `  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }`,
    `}`,
  ];
}

const SUPPORTED_OPERATIONS: ReadonlySet<SpecStepOperation> = new Set<SpecStepOperation>([
  "fill",
  "press",
  "click",
]);

export type SpecCompileBinding = {
  scenarioStepIndex: number;
  operation: string;
  runtimeMethod: string;
  /**
   * The explicit, operation-named method on the generated deterministic Page
   * Object (fill/click/press) that this binding's call was emitted through.
   * Purely a maintainability/organization layer -- it never decides operation,
   * target, order, or authority; it forwards 1:1 to `runtimeMethod`. Absent
   * for oracle bindings (expectPromotedVisible), which stay outside the POM.
   */
  pomMethod?: string;
  targetRef?: string;
  dataRef?: string;
  /**
   * True only when this binding's target was emitted under an explicit upstream
   * resolutionState="runtime_resolution_required" signal: physical resolution is
   * delegated to the existing promoted runtime (which fails closed on 0/>1 match),
   * not asserted as certified here. Absent for every other binding.
   */
  runtimeResolutionRequired?: boolean;
};

export type SpecCompileResult = {
  source: string;
  bindings: SpecCompileBinding[];
  unsupportedCapabilities: string[];
};

function escapeString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

function jsonLiteral(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Deterministic mapping from a structured SpecStepTarget to a Playwright
 * locator expression. Mirrors the strategy vocabulary already established by
 * the recorded-target resolution authority (role/text/label/placeholder/
 * testid/css) -- never derived from business-facing label text when a
 * technical strategy/value pair already exists.
 */
function buildLocatorExpression(target: SpecStepTarget): string | undefined {
  switch (target.strategy) {
    case "role": {
      if (!target.role) return undefined;
      const opts: string[] = [];
      if (target.name !== undefined) opts.push(`name: '${escapeString(target.name)}'`);
      if (target.exact) opts.push("exact: true");
      const optsExpr = opts.length > 0 ? `, { ${opts.join(", ")} }` : "";
      return `page.getByRole('${escapeString(target.role)}'${optsExpr})`;
    }
    case "text":
      if (!target.value) return undefined;
      return `page.getByText('${escapeString(target.value)}'${target.exact ? ", { exact: true }" : ""})`;
    case "label":
      if (!target.value) return undefined;
      return `page.getByLabel('${escapeString(target.value)}')`;
    case "placeholder":
      if (!target.value) return undefined;
      return `page.getByPlaceholder('${escapeString(target.value)}')`;
    case "data-testid":
    case "testid":
      if (!target.value) return undefined;
      return `page.getByTestId('${escapeString(target.value)}')`;
    case "css":
      if (!target.value) return undefined;
      return `page.locator('${escapeString(target.value)}')`;
    default:
      return undefined;
  }
}

/**
 * Serializes a structured target into the flat "strategy:value" string that
 * pressPromotedTarget's API already accepts (its only supported transport --
 * it has no locator-callback parameter). Same vocabulary as buildLocatorExpression.
 */
function serializeStructuredTarget(target: SpecStepTarget): string | undefined {
  if (target.strategy === "role" && (target.role || target.name)) {
    return `role:${target.role ?? ""}|${target.name ?? ""}`;
  }
  if (target.value) {
    return `${target.strategy}:${target.value}`;
  }
  return undefined;
}

function displayTargetRef(target: SpecStepTarget): string {
  return target.name ?? target.value ?? serializeStructuredTarget(target) ?? target.strategy;
}

/**
 * Opaque pass-through to the SAME shared CORE resolution entrypoint Recording/
 * Replay already uses (parseSerializedTechnicalTargetString + recordedLocatorFactory,
 * both from the runtime/target-resolver authority). The compiler never parses or
 * reinterprets technicalTargetRef itself -- it only forwards the literal string
 * into the existing parser, so "role:button|Depurar" can never degrade into
 * business-text locators like getByText('Depurar').
 */
function buildTechnicalTargetRefLocatorExpression(technicalTargetRef: string): string {
  return `recordedLocatorFactory(page, parseSerializedTechnicalTargetString('${escapeString(technicalTargetRef)}')!)!`;
}

function hasTechnicalTargetRef(step: SpecExecutionContractStep): step is SpecExecutionContractStep & { technicalTargetRef: string } {
  return typeof step.technicalTargetRef === "string" && step.technicalTargetRef.trim().length > 0;
}

/**
 * Existing readiness/certification authority for a step's target, independent
 * of the legacy `technicalTargetRef` field. `certifiedTechnicalTarget` is the
 * SAME CORE materializer output (technical-target-materializer.ts) used for
 * both Recording- and Discovery-sourced steps: `targetType: "structural"`
 * (certificationTier 1-4) is promotion-safe technical identity;
 * `targetType: "display"` (tier 5) is the materializer's own weakest-but-still
 * -certified fallback, structurally identical to the existing target.strategy/
 * value used today. A "structural" candidate the materializer's own evidence
 * marks ambiguous (identityAmbiguous / structuralIdentityMatchCount > 1) is
 * explicitly a resolution-time fail-closed concern per that module's own
 * documented intent -- never silently promoted into a locator here.
 */
type ActionTargetAuthority =
  | { kind: "technical_ref"; ref: string }
  // structuralTarget is set ONLY when the certified structural identity is rich enough
  // (structuralContext.owner present) for the shared resolveRecordedStructuralOwner resolver to
  // have any chance of using it -- never for a bare stableDirectAttributes-only candidate with no
  // owner, which stays on the existing ref-only (locatorCandidates[0]) path unchanged.
  | { kind: "certified_structural"; ref: string; structuralTarget?: CertifiedTechnicalTarget }
  | { kind: "runtime_deferred"; ref: string }
  // LAST-RESORT, EXECUTION-ONLY: a runtime_resolution_required step with NO structured
  // locator/certified-target evidence at all (technicalTargetCandidates/certifiedTechnicalTarget/
  // plan target all absent), but a captured SemanticRuntimeEvidence. Never a ref -- there is none.
  | { kind: "semantic_runtime_only" }
  | { kind: "display_fallback" }
  | { kind: "insufficient"; reason: string };

function firstStructuredEvidenceRef(step: SpecExecutionContractStep): string | undefined {
  const candidate = step.certifiedTechnicalTarget?.locatorCandidates?.[0];
  if (candidate?.strategy && candidate.value) {
    return `${candidate.strategy}:${candidate.value}`;
  }
  return step.target ? serializeStructuredTarget(step.target) : undefined;
}

/**
 * The SAME tier/non-ambiguity/candidate validation the pre-existing certifiedTechnicalTarget
 * branch below already applies to a "no technicalTargetRef" step -- extracted so it can also run
 * BEFORE the technicalTargetRef check, for the case where both coexist on the same step (real
 * steps 4/7: an earlier-provenance technicalTargetRef alongside a freshly-materialized,
 * non-ambiguous structural certification). Returns undefined (never "insufficient") when this
 * fresh certification isn't valid/usable, so the caller falls through to existing behavior
 * unchanged -- this never fabricates a locator and never itself produces a failure verdict.
 */
function resolveCertifiedStructuralAuthority(step: SpecExecutionContractStep): ActionTargetAuthority | undefined {
  const cert = step.certifiedTechnicalTarget;
  if (!cert || cert.targetType !== "structural") return undefined;
  const ctx = cert.structuralContext;
  const ambiguous =
    ctx?.identityAmbiguous === true ||
    (typeof ctx?.structuralIdentityMatchCount === "number" && ctx.structuralIdentityMatchCount > 1);
  if (ambiguous) return undefined;
  const candidate = cert.locatorCandidates?.[0];
  if (candidate?.strategy && candidate.value) {
    // Transport the full structural identity to the promoted runtime ONLY when it is rich
    // enough (an owner tag present) for the shared resolveRecordedStructuralOwner resolver to
    // have any chance of using it -- otherwise this is left undefined and the emitted candidate
    // stays on the existing ref-only (locatorCandidates[0]) path, unchanged.
    // FIRST_LOSS fix (jobId cfca5acb-...): this only ever checked ctx?.owner?.tag, never
    // ctx?.deterministicStructuralIdentity -- but resolveRecordedStructuralOwner (the SAME
    // shared resolver clickPromotedTargetViaStructuralAuthority calls, fail-closed by design
    // with NO fallback once structuralTarget is attached) unconditionally requires
    // deterministicStructuralIdentity===true as its very first gate, regardless of owner.tag or
    // topology authority. A field-scoped-fallback certification (tier=1, strategy=recorded:css --
    // the recovery path taken whenever the originally recorded target no longer matches the live
    // page, a routine occurrence for any aged recording against an evolving UI, not specific to
    // any one app) never sets that flag, so the compiler was attaching a structuralTarget doomed
    // to fail every promoted run: confirmed live -- resolveRecordedStructuralOwner returned
    // reason=owner_not_deterministic with no [recording-replay][structural-match] "invoked" log at
    // all, and clickPromotedTargetViaStructuralAuthority throws immediately with no fallback.
    // Requiring the exact same flag the runtime resolver requires means the compiler now only
    // ever promises what that resolver can actually deliver; anything less falls through to the
    // existing, more permissive ref-only/technical_ref path below, which already has real
    // retry/fallback semantics.
    // FIRST_LOSS fix (jobId b5915a66-..., same physical case, next boundary after the
    // deterministicStructuralIdentity fix above): deterministicStructuralIdentity===true alone is
    // NOT sufficient either -- resolveRecordedStructuralOwner ALSO unconditionally requires at
    // least one durable anchor (a non-empty stableDirectAttributes/stableDescendants) OR a proven
    // topology tie-break (topologyTieBreakUnique + structuralIdentityMatchCount===1 + a non-empty
    // semanticShape); with none of those, it fails closed with reason=
    // no_stable_anchor_or_topology_authority -- confirmed live via the Playwright trace's own
    // captured console output for this exact case (a tier-4 generic role:button certification
    // with only semanticShape+landmarkAncestor, no stable attributes/descendants, no topology
    // tie-break at all). Same shared resolver, same principle as the fix above: the compiler must
    // replicate every one of the runtime's own unconditional gates, not just the first one hit.
    const hasStableAnchor = Boolean(
      (ctx?.stableDirectAttributes && Object.keys(ctx.stableDirectAttributes).length > 0)
      || (ctx?.stableDescendants && ctx.stableDescendants.length > 0),
    );
    const hasTopologyAuthority = Boolean(
      ctx?.topologyTieBreakUnique === true
      && ctx.structuralIdentityMatchCount === 1
      && (ctx.semanticShape?.length ?? 0) > 0,
    );
    const structuralTarget = ctx?.owner?.tag
      && ctx.deterministicStructuralIdentity === true
      && (hasStableAnchor || hasTopologyAuthority)
      ? cert
      : undefined;
    // FIRST_LOSS fix (jobId 71728dc2-..., same physical case, next boundary again): a bare
    // role-only locator (value has no "|name" qualifier -- technical-target-materializer.ts's own
    // Tier 4 comment: "structural owner alone... Ambiguity is a resolution-time concern handled
    // fail-closed by resolveRecordedStructuralOwner at runtime -- not here") was NEVER meant to
    // stand alone as a plain ref: it was always designed to be paired with the full
    // structuralTarget so the shared resolver's own anchor/topology disambiguation could narrow
    // it down. Once structuralTarget is correctly withheld (the fix above), this same bare ref
    // was still being handed to the generic ref-only click path, which does getByRole('button')
    // with no name filter at all -- confirmed live: resolved to 8 elements, strict-mode click
    // failure. A role locator WITH a name qualifier (Tier 2 shape, "role|name") is real,
    // independent authority and is untouched; only the nameless Tier-4 shape is withheld here,
    // and only when it cannot carry its required structuralTarget escort.
    const bareRoleLocator = candidate.strategy === "role" && !candidate.value.includes("|");
    if (!structuralTarget && bareRoleLocator) return undefined;
    return {
      kind: "certified_structural",
      ref: `${candidate.strategy}:${candidate.value}`,
      ...(structuralTarget ? { structuralTarget } : {}),
    };
  }
  return undefined;
}

function resolveActionTargetAuthority(step: SpecExecutionContractStep): ActionTargetAuthority {
  // resolutionState is transported verbatim from upstream (never recalculated here --
  // see spec-execution-contract.ts). An explicit upstream decision takes precedence over
  // this module's own certifiedTechnicalTarget-derived inference below.
  if (step.resolutionState === "unresolved_unrecoverable") {
    return { kind: "insufficient", reason: "unresolved_unrecoverable" };
  }
  // FIRST_LOSS fix (jobId 25a2af2e-1ef3-4661-b156-5417c8783fe1): a coexisting, earlier-provenance
  // technicalTargetRef must never opaque a freshly-materialized, non-ambiguous certified
  // structural target -- but only when this step's identity is not already explicitly deferred
  // to live resolution (runtime_resolution_required), which this preference must never
  // upgrade/bypass. When the fresh certification isn't valid/usable, existing behavior below is
  // untouched.
  if (step.resolutionState !== "runtime_resolution_required") {
    const certifiedStructural = resolveCertifiedStructuralAuthority(step);
    if (certifiedStructural) {
      return certifiedStructural;
    }
  }
  if (hasTechnicalTargetRef(step)) {
    return { kind: "technical_ref", ref: step.technicalTargetRef };
  }
  if (step.resolutionState === "runtime_resolution_required") {
    // Upstream already decided this step's identity is intentionally deferred to live
    // resolution (not ambiguous/invalid) -- any structured evidence already on the
    // contract (certified candidate or plain target.strategy/value) is sufficient to
    // hand to the SAME existing runtime resolver, which fails closed on 0/>1 match at
    // execution time. Never marked/emitted as certified.
    const ref = firstStructuredEvidenceRef(step);
    if (ref) {
      return { kind: "runtime_deferred", ref };
    }
    // No locator/certified evidence at all, but a captured, capture-time-unique
    // SemanticRuntimeEvidence exists -- the last-resort, execution-only authority. Never
    // reconstructed here; transported verbatim from upstream (spec-execution-contract.ts).
    if (step.semanticRuntimeEvidence || step.playwrightRecorderEvidence) {
      return { kind: "semantic_runtime_only" };
    }
    return { kind: "insufficient", reason: "runtime_resolution_required_missing_structured_evidence" };
  }
  const cert = step.certifiedTechnicalTarget;
  // No certification was ever attempted/available for this step (distinct from an
  // attempted-and-weak/ambiguous result) -- this is not new negative evidence against
  // target.strategy/value, so the existing display fallback stays valid, unchanged.
  if (!cert) {
    return { kind: "display_fallback" };
  }
  if (cert.targetType === "structural") {
    // FIRST_LOSS fix (jobId 71728dc2-..., same physical case, next boundary again): this used to
    // be its own inline reimplementation of certified-structural resolution -- ambiguity check,
    // bare candidate ref -- completely separate from resolveCertifiedStructuralAuthority above,
    // sharing none of its deterministicStructuralIdentity/stable-anchor/bare-role-locator guards.
    // step.resolutionState !== "runtime_resolution_required" already tried
    // resolveCertifiedStructuralAuthority(step) once above in this same call, before falling
    // through here; a second, unguarded reimplementation just re-derived the exact same doomed
    // bare "role:button" ref that call had already (correctly) withheld -- confirmed live: it
    // reached the promoted runtime as a plain getByRole('button') with no name filter, matched 8
    // elements, and failed strict-mode. Reusing the SAME already-fixed function here instead of a
    // second copy is both the fix and the guarantee that this never re-diverges again. The
    // ambiguous-specific reason code is preserved (existing test coverage asserts on it exactly).
    const ctx = cert.structuralContext;
    const ambiguous =
      ctx?.identityAmbiguous === true ||
      (typeof ctx?.structuralIdentityMatchCount === "number" && ctx.structuralIdentityMatchCount > 1);
    if (ambiguous) {
      return { kind: "insufficient", reason: "ambiguous_structural_certification" };
    }
    return resolveCertifiedStructuralAuthority(step) ?? { kind: "insufficient", reason: "structural_certification_missing_candidate" };
  }
  if (cert.targetType === "display") {
    return { kind: "display_fallback" };
  }
  return { kind: "insufficient", reason: "no_technical_certification" };
}

/**
 * Deterministic env-var name for a dataset key, reusing the same
 * PROMOTED_<NORMALIZED> convention already used at runtime for dataset
 * resolution (promoted-spec-runtime.ts). Values are never embedded literally;
 * only the key/ref is transported through the generated source.
 */
function dataRefEnvExpression(valueKey: string): string {
  const normalized = valueKey
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return `String(process.env['PROMOTED_${normalized}'] ?? '')`;
}

function compileFillStep(
  step: SpecExecutionContractStep,
  lines: string[],
  bindings: SpecCompileBinding[],
  unsupportedCapabilities: string[],
  previousStepReplays: PreviousStepReplay[],
): void {
  const target = step.target;
  const authority = resolveActionTargetAuthority(step);

  let locatorExpr: string | undefined;
  let refForBinding: string | undefined;
  const isRuntimeDeferred = authority.kind === "runtime_deferred" || authority.kind === "semantic_runtime_only";
  const usesRefLocator = authority.kind === "technical_ref" || authority.kind === "certified_structural" || authority.kind === "runtime_deferred";

  if (usesRefLocator) {
    refForBinding = (authority as { ref: string }).ref;
    locatorExpr = buildTechnicalTargetRefLocatorExpression(refForBinding);
  } else if (authority.kind === "display_fallback" || authority.kind === "semantic_runtime_only") {
    locatorExpr = target ? buildLocatorExpression(target) : undefined;
  } else {
    unsupportedCapabilities.push(`scenarioStepIndex=${step.scenarioStepIndex}:fill_insufficient_authority:${authority.reason}`);
    return;
  }
  if (!locatorExpr) {
    unsupportedCapabilities.push(`scenarioStepIndex=${step.scenarioStepIndex}:fill_missing_structured_target`);
    return;
  }
  const runtimeMethod = ACTION_RUNTIME_METHOD_BY_OPERATION.fill;
  if (!runtimeMethod) {
    unsupportedCapabilities.push(`scenarioStepIndex=${step.scenarioStepIndex}:no_runtime_authority:fill`);
    return;
  }
  const targetRef = usesRefLocator ? refForBinding! : displayTargetRef(target!);
  const valueExpr = step.valueKey ? dataRefEnvExpression(step.valueKey) : `'${escapeString(step.value ?? "")}'`;
  const pomMethod = POM_METHOD_BY_OPERATION.fill;

  lines.push(`    await pageObject.${pomMethod}({`);
  lines.push(`      stepIndex: ${step.scenarioStepIndex},`);
  lines.push(`      target: '${escapeString(targetRef)}',`);
  lines.push(`      value: ${valueExpr},`);
  if (step.valueKey) {
    lines.push(`      valueKey: '${escapeString(step.valueKey)}',`);
  }
  if (usesRefLocator) {
    lines.push(`      technicalTargetRefs: ['${escapeString(refForBinding!)}'],`);
  }
  if (isRuntimeDeferred && step.playwrightRecorderEvidence) {
    lines.push(`      playwrightRecorderEvidence: ${JSON.stringify(step.playwrightRecorderEvidence)},`);
  }
  if (step.authGateExpected) {
    // Structured auth-gate credential authority, transported verbatim from the contract so the
    // promoted runtime's contextual guard can distinguish an auth credential fill (compatible
    // with the login/auth-gate screen) from a business form fill (still fail-closed there).
    lines.push("      authGateExpected: true,");
  }
  lines.push(`      fill: async () => { await ${locatorExpr}.fill(${valueExpr}); }`);
  lines.push(`    });`);

  bindings.push({
    scenarioStepIndex: step.scenarioStepIndex,
    operation: "fill",
    runtimeMethod,
    pomMethod,
    targetRef,
    dataRef: step.valueKey,
    ...(isRuntimeDeferred ? { runtimeResolutionRequired: true } : {}),
  });

  // The recorded auth-gate credential fill (structured `authGateExpected` authority, never
  // inferred from field text/valueKey) is marked sensitive so the runtime's existing
  // `!s.sensitive` replay gate excludes it -- transported for transparency, never silently
  // omitted, but never auto-replayed.
  previousStepReplays.push({
    scenarioStepIndex: step.scenarioStepIndex,
    actionIntent: "restore_recorded_context",
    targetRef,
    sensitive: Boolean(step.authGateExpected),
    replayExpr: `async () => { await ${locatorExpr}.fill(${valueExpr}); }`,
  });
}

function compilePressStep(
  step: SpecExecutionContractStep,
  lines: string[],
  bindings: SpecCompileBinding[],
  unsupportedCapabilities: string[],
  previousStepReplays: PreviousStepReplay[],
): void {
  if (step.resolutionState === "unresolved_unrecoverable") {
    unsupportedCapabilities.push(`scenarioStepIndex=${step.scenarioStepIndex}:press_insufficient_authority:unresolved_unrecoverable`);
    return;
  }
  const target = step.target;
  const usesTechnicalRef = hasTechnicalTargetRef(step);
  // technicalTargetRef is already the exact opaque "strategy:value" string
  // pressPromotedTarget's own parseSerializedTechnicalTargetString expects --
  // forwarded as-is, never reconstructed via serializeStructuredTarget.
  const resolvedTarget = usesTechnicalRef ? step.technicalTargetRef : target ? serializeStructuredTarget(target) : undefined;
  const key = step.value;
  if (!resolvedTarget || !key) {
    unsupportedCapabilities.push(`scenarioStepIndex=${step.scenarioStepIndex}:press_missing_structured_target_or_key`);
    return;
  }
  const runtimeMethod = ACTION_RUNTIME_METHOD_BY_OPERATION.press;
  if (!runtimeMethod) {
    unsupportedCapabilities.push(`scenarioStepIndex=${step.scenarioStepIndex}:no_runtime_authority:press`);
    return;
  }

  const pomMethod = POM_METHOD_BY_OPERATION.press;
  lines.push(`    await pageObject.${pomMethod}({`);
  lines.push(`      stepIndex: ${step.scenarioStepIndex},`);
  lines.push(`      target: '${escapeString(resolvedTarget)}',`);
  lines.push(`      key: '${escapeString(key)}'`);
  lines.push(`    });`);

  bindings.push({
    scenarioStepIndex: step.scenarioStepIndex,
    operation: "press",
    runtimeMethod,
    pomMethod,
    targetRef: resolvedTarget,
  });

  previousStepReplays.push({
    scenarioStepIndex: step.scenarioStepIndex,
    actionIntent: "restore_recorded_context",
    targetRef: resolvedTarget,
    sensitive: false,
    replayExpr: `async () => { await pageObject.${pomMethod}({ stepIndex: ${step.scenarioStepIndex}, target: '${escapeString(resolvedTarget)}', key: '${escapeString(key)}' }); }`,
  });
}

// ARIA roles whose click semantics are a selection/toggle STATE change, never a navigation/
// modal/generic UI change -- structural authority (the recording's own persisted technical
// target role), never inferred from step/target text.
const SELECTION_LIKE_ROLES = new Set(["option", "checkbox", "radio", "switch", "tab", "menuitemcheckbox", "menuitemradio"]);

function recordedRole(ref: string | undefined): string | undefined {
  if (!ref?.trim()) return undefined;
  const [strategy, value] = ref.split(":", 2);
  if (strategy?.trim().toLowerCase() !== "role" || !value) return undefined;
  const separator = value.indexOf("|");
  return (separator >= 0 ? value.slice(0, separator) : value).trim().toLowerCase();
}

function isSelectionLikeRecordedRole(step: SpecExecutionContractStep): boolean {
  const role = recordedRole(step.technicalTargetRef) ?? step.technicalTargetRefs?.map(recordedRole).find(Boolean);
  return Boolean(role && SELECTION_LIKE_ROLES.has(role));
}

/**
 * LINEAGE INVARIANT: `controlIdentity` is only trusted for a selection-state completion
 * expectation when (controlIdentity, recordingActionType) is genuinely unique among this
 * scenario's own steps -- reuses the SAME `isUniqueLineage` predicate the learned-route
 * authority lineage already uses (db/recording-route-observation-repository.ts), never a second
 * uniqueness concept. A repeated control (e.g. two identical confirmation dialogs) fails closed:
 * no semantic enrichment, `ui_change` stays the expectation, unchanged.
 */
function hasUniqueControlLineage(step: SpecExecutionContractStep, allSteps: readonly SpecExecutionContractStep[]): boolean {
  if (!step.controlIdentity || !step.recordingActionType) return false;
  const interactions = allSteps
    .filter((s): s is SpecExecutionContractStep & { controlIdentity: string; recordingActionType: string } =>
      Boolean(s.controlIdentity && s.recordingActionType))
    .map((s) => ({ controlIdentity: s.controlIdentity, action: s.recordingActionType }));
  return isUniqueLineage(interactions, step.controlIdentity, step.recordingActionType);
}

function compileClickStep(
  step: SpecExecutionContractStep,
  allSteps: readonly SpecExecutionContractStep[],
  lines: string[],
  bindings: SpecCompileBinding[],
  unsupportedCapabilities: string[],
  previousStepReplays: PreviousStepReplay[],
): void {
  const target = step.target;
  const authority = resolveActionTargetAuthority(step);

  let locatorExpr: string | undefined;
  let refForBinding: string | undefined;
  const isRuntimeDeferred = authority.kind === "runtime_deferred" || authority.kind === "semantic_runtime_only";
  const usesRefLocator = authority.kind === "technical_ref" || authority.kind === "certified_structural" || authority.kind === "runtime_deferred";

  if (usesRefLocator) {
    refForBinding = (authority as { ref: string }).ref;
    locatorExpr = buildTechnicalTargetRefLocatorExpression(refForBinding);
  } else if (authority.kind === "display_fallback" || authority.kind === "semantic_runtime_only") {
    // The generic display/text fallback locator is independent, pre-existing behavior for the
    // final `action:` callback closure -- never derived FROM `semanticRuntimeEvidence`, which is
    // instead emitted as its own structured field below and resolved by the shared runtime
    // resolver BEFORE this callback is ever reached.
    locatorExpr = target ? buildLocatorExpression(target) : undefined;
  } else {
    unsupportedCapabilities.push(`scenarioStepIndex=${step.scenarioStepIndex}:click_insufficient_authority:${authority.reason}`);
    return;
  }
  if (!locatorExpr) {
    unsupportedCapabilities.push(`scenarioStepIndex=${step.scenarioStepIndex}:click_missing_structured_target`);
    return;
  }
  const runtimeMethod = ACTION_RUNTIME_METHOD_BY_OPERATION.click;
  if (!runtimeMethod) {
    unsupportedCapabilities.push(`scenarioStepIndex=${step.scenarioStepIndex}:no_runtime_authority:click`);
    return;
  }
  const targetRef = usesRefLocator ? refForBinding! : displayTargetRef(target!);
  const pomMethod = POM_METHOD_BY_OPERATION.click;

  // Structured authority only (recorded ARIA role + verified, non-positional control lineage) --
  // never inferred from target/step text. Fails closed to the existing generic `ui_change`
  // whenever either signal is missing or the lineage is ambiguous.
  const selectionLike = isSelectionLikeRecordedRole(step) && hasUniqueControlLineage(step, allSteps);
  lines.push(`    await pageObject.${pomMethod}({`);
  lines.push(`      stepIndex: ${step.scenarioStepIndex},`);
  lines.push(`      target: '${escapeString(targetRef)}',`);
  lines.push(`      actionIntent: 'click',`);
  lines.push(`      expectedEffect: '${selectionLike ? "selection_state_change" : "ui_change"}',`);
  if (usesRefLocator) {
    lines.push(`      technicalTargetRefs: ['${escapeString(refForBinding!)}'],`);
  }
  // Transported ONLY for certified_structural authority rich enough for the shared
  // resolveRecordedStructuralOwner resolver (structuralContext.owner present) -- never for a
  // bare technical_ref/runtime_deferred/display authority, which keep the existing ref-only
  // callback path unchanged.
  if (authority.kind === "certified_structural" && authority.structuralTarget) {
    lines.push(`      structuralTarget: ${JSON.stringify(authority.structuralTarget)},`);
  }
  // Transported ONLY for runtime_resolution_required clicks (never upgrades/replaces
  // technicalTargetRefs/firstStructuredEvidenceRef above) -- lets clickPromotedTarget retry via
  // the SAME shared field-scoped resolver Discovery's own live walk already used for this step.
  if (isRuntimeDeferred && step.associatedField) {
    lines.push(`      associatedField: '${escapeString(step.associatedField)}',`);
  }
  // LAST-RESORT, EXECUTION-ONLY: emitted as STRUCTURED DATA (never a getByText/text=/nth/first/
  // last/coordinate selector) -- the shared runtime resolver re-proves uniqueness live, this
  // never certifies/upgrades resolutionState. Transported verbatim, never reconstructed from
  // `originalText`/scenario prose.
  if (isRuntimeDeferred && step.semanticRuntimeEvidence) {
    lines.push(`      semanticRuntimeEvidence: ${JSON.stringify(step.semanticRuntimeEvidence)},`);
  }
  if (isRuntimeDeferred && step.playwrightRecorderEvidence) {
    lines.push(`      playwrightRecorderEvidence: ${JSON.stringify(step.playwrightRecorderEvidence)},`);
  }
  // Transported so a session-timeout/home-reset precondition detected before this click can
  // recover the prior identification/navigation context (see `detectHomeResetOrInactivity` +
  // `safeReplayContext` in promoted-spec-runtime.ts) instead of failing closed with
  // `session_reset_unrecoverable_missing_replay_callback` purely for lack of transport. Every
  // entry reuses a PRIOR step's own already-compiled callback verbatim -- never a second
  // locator/value derivation -- and never includes this step or any later one.
  lines.push(`      previousStepReplays: ${buildPreviousStepReplaysLiteral(previousStepReplays, step.scenarioStepIndex)},`);
  lines.push(`      action: async () => { await ${locatorExpr}.click(); }`);
  lines.push(`    });`);

  bindings.push({
    scenarioStepIndex: step.scenarioStepIndex,
    operation: "click",
    runtimeMethod,
    pomMethod,
    targetRef,
    ...(isRuntimeDeferred ? { runtimeResolutionRequired: true } : {}),
  });

  previousStepReplays.push({
    scenarioStepIndex: step.scenarioStepIndex,
    actionIntent: "restore_recorded_context",
    targetRef,
    sensitive: false,
    replayExpr: `async () => { await ${locatorExpr}.click(); }`,
  });
}

function compileNavigationTransitionOracle(
  step: SpecExecutionContractStep,
  lines: string[],
  bindings: SpecCompileBinding[],
  unsupportedCapabilities: string[],
): void {
  const oracle = step.oracle;
  const urlPattern = oracle?.mechanism?.expected?.urlPattern;
  if (!oracle || oracle.type !== "navigation_transition" || !urlPattern) {
    unsupportedCapabilities.push(
      `scenarioStepIndex=${step.scenarioStepIndex}:oracle_unsupported:${oracle?.type ?? "none"}`,
    );
    return;
  }
  const targetRef = step.target ? displayTargetRef(step.target) : `scenarioStep${step.scenarioStepIndex}`;
  const polarity = oracle.polarity ?? "positive";

  lines.push(`    await promotedRuntime.expectPromotedVisible({`);
  lines.push(`      stepIndex: ${step.scenarioStepIndex},`);
  lines.push(`      target: '${escapeString(targetRef)}',`);
  lines.push(`      polarity: ${jsonLiteral(polarity)},`);
  lines.push(`      expectedUrl: '${escapeString(urlPattern)}',`);
  lines.push(`      assertion: async () => { await expect(page).toHaveURL(${jsonLiteral(urlPattern)}); }`);
  lines.push(`    });`);

  bindings.push({
    scenarioStepIndex: step.scenarioStepIndex,
    operation: step.operation,
    runtimeMethod: "expectPromotedVisible",
    targetRef,
  });
}

/**
 * Pure, deterministic compiler: same contract + same compile context always
 * yields byte-for-byte identical source. Not wired into production spec
 * generation, Auto-POM, QA Lab, or promotion -- caller-only, additive kernel.
 * `compileContext.targetSpecPath` is required (never defaulted) so import
 * paths are never silently computed relative to the wrong location.
 */
export function compileDeterministicSpec(contract: SpecExecutionContract, compileContext: SpecCompileContext): SpecCompileResult {
  const bindings: SpecCompileBinding[] = [];
  const unsupportedCapabilities: string[] = [];
  const lines: string[] = [];

  const promotedRuntimeImportPath = portableImportPath(compileContext.targetSpecPath, PROMOTED_RUNTIME_ABS_PATH);
  const targetResolverImportPath = portableImportPath(compileContext.targetSpecPath, TARGET_RESOLVER_ABS_PATH);

  const usesTechnicalTargetRef = contract.steps.some((s) => {
    if (s.required === false) return false;
    const authority = resolveActionTargetAuthority(s);
    return authority.kind === "technical_ref" || authority.kind === "certified_structural" || authority.kind === "runtime_deferred";
  });
  // Structural, not regex-on-source: mirrors compileNavigationTransitionOracle's
  // own success condition exactly, so `expect` is imported iff an oracle call that
  // actually uses it will be emitted.
  const usesExpectOracle = contract.steps.some((s) =>
    s.required !== false
    && s.oracle?.type === "navigation_transition"
    && typeof s.oracle.mechanism?.expected?.urlPattern === "string"
    && s.oracle.mechanism.expected.urlPattern.trim().length > 0
  );

  lines.push(usesExpectOracle ? `import { test, expect } from '@playwright/test';` : `import { test } from '@playwright/test';`);
  lines.push(
    usesTechnicalTargetRef
      ? `import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '${promotedRuntimeImportPath}';`
      : `import { createPromotedSpecRuntime } from '${promotedRuntimeImportPath}';`,
  );
  if (usesTechnicalTargetRef) {
    lines.push(`import { recordedLocatorFactory } from '${targetResolverImportPath}';`);
  }
  lines.push(``);
  lines.push(...buildPomClassSource());
  lines.push(``);
  lines.push(`test('${escapeString(contract.title)}', async ({ page }) => {`);
  if (contract.appSlug) {
    // Enables the EXISTING promoted-runtime persisted-contract lookup
    // (promoted-field-target-contract.ts's resolvePromotedFieldIdentityFromPersistedContract,
    // which locates automations/apps/<APP_SLUG>/sections/<SECTION_SLUG>/cases/*/plan.json by
    // APP_SLUG/SECTION_SLUG env vars, same convention as the existing AI-generated spec
    // header) to find this step's certifiedTechnicalTarget and hand it to clickPromotedTarget/
    // fillPromotedField's already-wired resolveActionTarget structural-owner/field-scoped
    // resolution -- never a new resolver, never invented locators.
    lines.push(`  process.env.APP_SLUG = '${escapeString(contract.appSlug)}';`);
    if (contract.sectionSlug) {
      lines.push(`  process.env.SECTION_SLUG = '${escapeString(contract.sectionSlug)}';`);
    }
    lines.push(`  process.env.SCENARIO_ID = '${escapeString(contract.scenarioId)}';`);
    // contract.title is the same authoritative field already used for the test
    // name above (spec-execution-contract.ts: `title: plan.scenario.title`) --
    // never inferred from step text/appSlug/scenarioId.
    lines.push(`  process.env.SCENARIO_TITLE = '${escapeString(contract.title)}';`);
  }
  lines.push(`  const promotedRuntime = createPromotedSpecRuntime(page);`);
  lines.push(`  const pageObject = new ${POM_CLASS_NAME}(promotedRuntime);`);
  lines.push(`  try {`);

  // Accumulates, in original step order, every prior click/fill/press step's own
  // already-compiled callback -- so a LATER click step can transport a real
  // `previousStepReplays` array instead of a hardcoded `[]`. See `PreviousStepReplay`.
  const previousStepReplays: PreviousStepReplay[] = [];

  for (const step of contract.steps) {
    if (step.required === false) continue;

    // Action and oracle are independent semantics that may coexist on the
    // same contract step (e.g. click + navigation_transition). The action,
    // when present, is always emitted first; the oracle never replaces it.
    const isSupportedAction = SUPPORTED_OPERATIONS.has(step.operation);
    const hasNavigationOracle = step.oracle?.type === "navigation_transition";

    if (isSupportedAction) {
      switch (step.operation as SpecCompilerSupportedOperation) {
        case "fill":
          compileFillStep(step, lines, bindings, unsupportedCapabilities, previousStepReplays);
          break;
        case "press":
          compilePressStep(step, lines, bindings, unsupportedCapabilities, previousStepReplays);
          break;
        case "click":
          compileClickStep(step, contract.steps, lines, bindings, unsupportedCapabilities, previousStepReplays);
          break;
      }
    } else if (!hasNavigationOracle) {
      unsupportedCapabilities.push(`scenarioStepIndex=${step.scenarioStepIndex}:operation_unsupported:${step.operation}`);
    }

    if (hasNavigationOracle) {
      compileNavigationTransitionOracle(step, lines, bindings, unsupportedCapabilities);
    }
  }

  lines.push(`  } finally {`);
  lines.push(`    await promotedRuntime.finishEvidence();`);
  lines.push(`  }`);
  lines.push(`});`);
  lines.push(``);

  return {
    source: lines.join("\n"),
    bindings,
    unsupportedCapabilities,
  };
}
