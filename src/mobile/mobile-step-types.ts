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

export type MobileStep = {
  index?: number;
  action: MobileStepAction;
  description?: string;
  target?: MobileStepTarget;
  value?: string;
  timeoutMs?: number;
};

export type MobileStepResult = {
  index: number;
  action: MobileStepAction;
  description?: string;
  status: "passed" | "failed";
  errorMessage?: string;
  screenshotPath?: string;
  durationMs: number;
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

  return steps.flatMap((step, idx): MobileStep[] => {
    const override = overridesByStepIndex[idx];
    if (typeof override !== "string") return [step];

    const field = fieldByStep.get(idx);

    if (step.action === "click" && field?.kind === "select" && field.applyTargetTemplate) {
      // The AI's single click only OPENS the dropdown (shows the current value). Keep it
      // as the open action, then append a click on the chosen option to actually pick +
      // close it. This also fixes the latent case where the option was never selected.
      const optionStep: MobileStep = {
        action: "click",
        description: `Seleccionar ${field.label}: ${override}`,
        target: {
          strategy: field.applyTargetTemplate.strategy,
          value: field.applyTargetTemplate.value.replace("{{value}}", override)
        }
      };
      return [step, optionStep];
    }

    if (step.action === "fill" && (!field || field.kind === "text")) {
      return [{ ...step, value: override }];
    }

    return [step];
  });
}
