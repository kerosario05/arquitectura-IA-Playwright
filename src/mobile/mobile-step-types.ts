export type MobileLocatorStrategy = "accessibilityId" | "id" | "xpath" | "androidUiAutomator" | "className";

export type MobileStepTarget = {
  strategy: MobileLocatorStrategy;
  value: string;
};

export type MobileStepAction =
  | "launchApp"
  | "click"
  | "fill"
  | "assertVisible"
  | "assertEnabled"
  | "assertDisabled"
  | "waitFor"
  | "screenshot";

export type MobileStepActionRole = "open_selector" | "select_option";
export type MobileStepExpectedState = "selector_open" | "option_selected";

export type MobileStep = {
  index?: number;
  action: MobileStepAction;
  actionRole?: MobileStepActionRole;
  expectedState?: MobileStepExpectedState;
  requiredNextTarget?: MobileStepTarget;
  description?: string;
  target?: MobileStepTarget;
  value?: string;
  timeoutMs?: number;
  /**
   * Declares that this step requires a runtime-resolved OTP (dynamic, one-time code).
   * The AI NEVER writes a concrete OTP; identityField/channel are optional hints resolved
   * from evidence/config when safely known, otherwise left for runtime to resolve.
   */
  otp?: {
    required: true;
    identityField?: string;
    channel?: string;
  };
};

export type MobileStepResult = {
  index: number;
  action: MobileStepAction;
  description?: string;
  status: "passed" | "failed" | "skipped_dependency_failed";
  reasonCode?: string;
  errorMessage?: string;
  primaryCauseStepIndex?: number;
  diagnosticsPath?: string;
  defectEligible?: boolean;
  targetResolved?: boolean;
  enabledObserved?: boolean;
  enabledSource?: string;
  fieldLocated?: boolean;
  valueEntered?: string;
  fieldAccepted?: boolean;
  acceptanceSource?: string;
  screenshotPath?: string;
  durationMs: number;
  /** Technical identity of the exact control that was resolved and executed by the Appium
   *  executor. Values come from the real DOM element attributes (resource-id, content-desc,
   *  package, class), NOT from step.target or post-hoc matching. Undefined when the driver
   *  couldn't capture the attributes. */
  executedControl?: {
    locatorIdentity?: string;
    resourceId?: string;
    contentDesc?: string;
    package?: string;
    className?: string;
  };
};

/**
 * A data field surfaced to the user so they can supply a real value before execution.
 * The example/default value pre-fills it; if the user overrides it, the real value is
 * applied to the matching step at run time (keyed by stepIndex).
 *
 * - kind "text": maps to a `fill` step; the override replaces its `value`.
 * - kind "select": maps to a `click` step that picks a dropdown option; the override
 *   re-targets that click to the chosen option using `applyTargetTemplate`.
 */
export type MobileDataField = {
  key: string;          // display/grouping slug derived from label
  label: string;        // human-readable, from step.description or target label
  kind: "text" | "select";
  stepIndex: number;    // index of the step this field maps to (authoritative override key)
  exampleValue: string; // the value/option currently in the step (pre-fill)
  sensitive: boolean;   // display hint (document/cédula/otp/password/email → mask in UI)
  options?: string[];   // for kind="select": the allowed choices
  defaultValue?: string; // for kind="select": the pre-selected option
  /** For kind="select": locator template with `{{value}}` to build the click target for the chosen option. */
  applyTargetTemplate?: { strategy: MobileLocatorStrategy; value: string };
  /**
   * For kind="select": the STRUCTURAL locator of the selector's opener/toggle (distinct from the
   * option target in `applyTargetTemplate`). Transported from the declared `matchLocator`. Used by
   * applyDataOverrides only to materialize a safe opener when the scenario carries only the option
   * step. Optional: when absent, no opener is synthesized (fail-safe emits the option alone).
   */
  openerLocator?: { strategy: MobileLocatorStrategy; value: string };
};

const SENSITIVE_KEYWORDS = [
  "documento", "cedula", "cédula", "pasaporte", "identificacion", "identificación",
  "otp", "contrasena", "contraseña", "password", "correo", "email", "tarjeta", "cvv", "pin"
];

/** Detects whether a data field is sensitive from its label (for UI masking). */
export function isSensitiveDataLabel(label: string): boolean {
  const normalized = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return SENSITIVE_KEYWORDS.some((kw) => normalized.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
}

/** Builds a stable, readable slug key from a field label. */
export function slugifyDataKey(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "campo";
}

/**
 * Returns a copy of `steps` with the user-supplied real values applied to the matching
 * steps (by index). Steps without an override keep their original value. Never mutates
 * the input array.
 *
 * - text field → replaces the `fill` step's `value`.
 * - select field → re-targets the `click` step to the chosen option using the field's
 *   `applyTargetTemplate` (`{{value}}` substituted). Needs `requiredData` to know the
 *   field kind + template; without it, only text (fill) overrides are applied.
 */
export function applyDataOverrides(
  steps: MobileStep[],
  overridesByStepIndex: Record<number, string> | undefined,
  requiredData?: MobileDataField[]
): MobileStep[] {
  if (!overridesByStepIndex || Object.keys(overridesByStepIndex).length === 0) {
    return steps;
  }
  const fieldByStep = new Map<number, MobileDataField>();
  for (const f of requiredData ?? []) fieldByStep.set(f.stepIndex, f);

  const result: MobileStep[] = [];
  const consumed = new Set<number>();

  // Structural role detection (never by description text). An option is a click whose target
  // equals the field's applyTargetTemplate rendered with one of its options, OR is structurally
  // marked select_option.
  const isOptionStep = (s: MobileStep | undefined, f: MobileDataField): boolean => {
    if (!s || s.action !== "click" || !f.applyTargetTemplate) return false;
    if (s.actionRole === "select_option") return true;
    return (f.options ?? []).some((opt) => s.target?.value === f.applyTargetTemplate!.value.replace(/{{value}}/g, opt));
  };
  const isOpenerMarked = (s: MobileStep | undefined): boolean => s?.actionRole === "open_selector";

  const renderedFor = (field: MobileDataField, opt: string) =>
    field.applyTargetTemplate!.value.replace(/{{value}}/g, opt);

  for (let idx = 0; idx < steps.length; idx++) {
    if (consumed.has(idx)) continue;
    const step = steps[idx];
    const override = overridesByStepIndex[idx];
    if (typeof override !== "string") {
      result.push(step);
      continue;
    }
    const field = fieldByStep.get(idx);

    if (step.action === "click" && field?.kind === "select" && field.applyTargetTemplate) {
      const buildOption = (base?: MobileStep): MobileStep => ({
        ...(base ?? { action: "click" as const }),
        action: "click",
        actionRole: "select_option",
        expectedState: "option_selected",
        requiredNextTarget: base?.requiredNextTarget ?? steps[idx + 1]?.target,
        description: `Seleccionar ${field.label}: ${override}`,
        target: { strategy: field.applyTargetTemplate.strategy, value: renderedFor(field, override) },
      });

      const anchorIsOption = isOptionStep(step, field);

      if (anchorIsOption) {
        // Local opener = ONLY the immediately-preceding step of the original array. Never scan
        // arbitrary earlier positions for an opener.
        const prev = idx > 0 ? steps[idx - 1] : undefined;
        const localOpener =
          prev &&
          prev.action === "click" &&
          !isOptionStep(prev, field) &&
          !fieldByStep.has(idx - 1) &&
          !consumed.has(idx - 1)
            ? prev
            : undefined;
        if (localOpener) {
          // The opener was already emitted at its own position (idx-1 has no field/override).
          // Emit ONLY the option here; never re-emit the opener (no duplication).
          consumed.add(idx - 1);
          result.push(buildOption(step));
        } else if (field.openerLocator) {
          // Only-option case WITH a structural opener locator: materialize exactly ONE safe opener
          // from field.openerLocator (the declared toggle target, distinct from the option target),
          // then emit the option. This never uses applyTargetTemplate/defaultValue/exampleValue to
          // build the opener, never clones the option's target, and never scans for a global click.
          result.push({
            action: "click",
            actionRole: "open_selector",
            expectedState: "selector_open",
            description: `Abrir selector de ${field.label}`,
            target: { strategy: field.openerLocator.strategy, value: field.openerLocator.value },
          });
          result.push(buildOption(step));
        } else {
          // Only-option case WITHOUT an opener locator: fail-safe. Do NOT fabricate an opener — the
          // only structural metadata (applyTargetTemplate) describes the option target, not an
          // opener, so synthesizing one would open the selector without selecting. Emit ONLY the
          // single select_option step.
          result.push(buildOption(step));
        }
        continue;
      }

      // Anchor is the opener (or a plain click treated as opener). Pair with an option that is
      // LOCAL (immediately after); otherwise materialize a single option from the override.
      const optionAfter =
        idx + 1 < steps.length && isOptionStep(steps[idx + 1], field) && !consumed.has(idx + 1)
          ? steps[idx + 1]
          : undefined;
      const opener: MobileStep = {
        ...step,
        actionRole: "open_selector",
        expectedState: "selector_open",
      };
      if (optionAfter) {
        consumed.add(idx + 1);
        result.push(opener);
        result.push(buildOption(optionAfter));
      } else {
        result.push(opener);
        result.push(buildOption(undefined));
      }
      continue;
    }

    if (step.action === "fill" && (!field || field.kind === "text")) {
      result.push({ ...step, value: override });
      continue;
    }

    result.push(step);
  }

  return result;
}
