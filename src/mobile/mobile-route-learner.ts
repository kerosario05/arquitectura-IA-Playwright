import type { MobileObservedControl, MobileScreenSnapshot } from "./mobile-knowledge-extractor";
import type { MobileStepTarget } from "./mobile-step-types";
import { isContinueLabel, normalizeLabel } from "./mobile-passthrough-screen";

/**
 * Decision core of the mobile route learner.
 *
 * The learner walks an app to capture real screens, so its judgement must be conservative:
 * it only advances when the next action is unambiguous, and it refuses to press anything
 * that could commit the flow (submitting a registration, confirming a transfer). Everything
 * else stops the walk with a reason the caller can act on — seed a step, supply data, or
 * hand the screen to a human.
 *
 * Pure functions over a snapshot, so the whole policy is unit-testable without an emulator.
 */

/** Controls that COMMIT the flow. Checked before continue labels — never auto-pressed. */
const SUBMIT_LABELS = [
  "registrarme",
  "registrar",
  "crear cuenta",
  "crear mi cuenta",
  "finalizar",
  "confirmar",
  "enviar",
  "pagar",
  "transferir",
  "solicitar",
  "firmar",
];

/** Android class names that mean the user must type something. */
const INPUT_CLASS_RE = /EditText|AutoCompleteTextView/i;

export type LearnerStopReason =
  | "needs_input"
  | "submit_guard"
  | "ambiguous_choice"
  | "no_actionable"
  | "loop_detected"
  | "max_screens";

export type LearnerDecision =
  | { kind: "advance"; target: MobileStepTarget; label: string }
  | { kind: "stop"; reason: LearnerStopReason; detail?: string };

export type DecideOptions = {
  /** Refuse to press a control that would commit the flow. Default true. */
  stopBeforeSubmit?: boolean;
  /** Structural fingerprints already visited, to detect a screen that did not change. */
  visitedFingerprints?: ReadonlySet<string>;
  /** Only consider controls owned by this Android package. */
  appPackage?: string;
  /**
   * Labels the caller wants pressed when they appear (e.g. "primera vez" to enter
   * registration from a login screen). Matched as a normalized substring, and honored
   * ahead of the needs_input and ambiguity stops: the caller is steering the walk down a
   * known branch, so a field it does not intend to fill must not end the run.
   *
   * The tap still uses the locator derived from the screen just observed, which is why
   * this succeeds where a hand-written seed step racing the app's first paint does not.
   * The submit guard still wins — steering never presses a control that commits.
   */
  preferLabels?: string[];
  /** Submit labels this walk is authorized to press despite the commit guard. */
  allowSubmitLabels?: string[];
};

export function isSubmitLabel(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const normalized = normalizeLabel(raw);
  if (!normalized) return false;
  return SUBMIT_LABELS.some((kw) => {
    const k = normalizeLabel(kw);
    return normalized === k || normalized.startsWith(`${k} `) || normalized.endsWith(` ${k}`);
  });
}

/**
 * Submit labels the caller explicitly authorized this walk to press.
 *
 * The guard exists so a walk never commits a flow by accident, but some screens cannot be
 * learned without crossing exactly one commit — the OTP entry screen only exists after
 * "Enviar codigo de validacion" is pressed. Naming that single control is far safer than
 * turning the guard off for the whole run, which would also authorize "Registrarme".
 */
export function isAllowedSubmit(label: string | undefined | null, allowSubmitLabels?: string[]): boolean {
  if (!label || !allowSubmitLabels?.length) return false;
  const normalized = normalizeLabel(label);
  return allowSubmitLabels.some((allowed) => {
    const n = normalizeLabel(allowed);
    return n.length > 0 && (normalized === n || normalized.includes(n));
  });
}

/** A commit control the walk must not press: a submit that was not explicitly allowed. */
export function isBlockedSubmitLabel(label: string | undefined | null, allowSubmitLabels?: string[]): boolean {
  return isSubmitLabel(label) && !isAllowedSubmit(label, allowSubmitLabels);
}

/** The label a control is addressed by, preferring its accessibility identity. */
export function controlLabel(c: MobileObservedControl): string {
  return (c.contentDesc ?? c.locatorIdentity ?? c.businessLabel ?? c.label ?? "").trim();
}

/** Escapes a value for embedding in a UiSelector string literal. */
function escapeForUiSelector(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Builds the strongest available locator for a control, or null when it has none.
 *
 * Exact `accessibilityId` matching is brittle for composite descriptions. When Android
 * builds a container's content-desc by concatenating its children, the result is
 * comma-separated and padded with whitespace on the device (", ¿Primera vez aquí?, Crea tu
 * cuenta en minutos, ") — but the snapshot extractor normalizes that padding away, so an
 * exact selector searches for a string neither side agrees on and silently finds nothing.
 * The padding is unrecoverable here (it is already trimmed), so the comma structure is the
 * signal: for those we anchor on the longest segment with `descriptionContains`, which
 * matches whatever padding the device actually has. Simple labels keep exact matching.
 */
export function controlToTarget(c: MobileObservedControl): MobileStepTarget | null {
  const desc = (c.contentDesc ?? c.locatorIdentity ?? "").trim();
  if (desc) {
    const segments = desc.split(",").map((part) => part.trim()).filter(Boolean);
    if (segments.length > 1) {
      const core = segments.sort((a, b) => b.length - a.length)[0];
      return {
        strategy: "androidUiAutomator",
        value: `new UiSelector().descriptionContains("${escapeForUiSelector(core)}")`,
      };
    }
    return { strategy: "accessibilityId", value: desc };
  }
  const rid = (c.resourceId ?? "").trim();
  if (rid) return { strategy: "id", value: rid };

  const className = (c.className ?? "").trim();
  if (className) {
    // Class alone matches the FIRST element of that class on the screen — tapping it lands on
    // whatever happens to be first, not on the control we meant. A tappable control's visible
    // text is its identity (unlike an input, whose text is replaced by typing), so anchor on it.
    const text = (c.businessLabel ?? c.label ?? "").trim();
    if (text) {
      return {
        strategy: "androidUiAutomator",
        value: `new UiSelector().className("${escapeForUiSelector(className)}").text("${escapeForUiSelector(text)}")`,
      };
    }
    return { strategy: "androidUiAutomator", value: `new UiSelector().className("${escapeForUiSelector(className)}")` };
  }
  return null;
}

/**
 * Locator for a text field, which needs different treatment from a tappable control.
 *
 * Fields in this app expose neither content-desc nor resource-id — only their placeholder
 * text. Anchoring on that text works right up until the moment it matters: typing replaces
 * it, so the executor's read-back finds nothing and reports the fill as `empty_after_fill`.
 * Position among the screen's same-class fields is the one identity that survives typing.
 */
export function inputControlToTarget(
  control: MobileObservedControl,
  allInputs: MobileObservedControl[],
): MobileStepTarget | null {
  const desc = (control.contentDesc ?? control.locatorIdentity ?? "").trim();
  if (desc && !desc.includes(",")) return { strategy: "accessibilityId", value: desc };
  const rid = (control.resourceId ?? "").trim();
  if (rid) return { strategy: "id", value: rid };

  const className = (control.className ?? "").trim();
  if (!className) return null;
  const sameClass = allInputs.filter((c) => (c.className ?? "").trim() === className);
  const instance = sameClass.indexOf(control);
  const selector = `new UiSelector().className("${escapeForUiSelector(className)}")`;
  return {
    strategy: "androidUiAutomator",
    value: instance > 0 ? `${selector}.instance(${instance})` : selector,
  };
}

function ownedByApp(c: MobileObservedControl, appPackage?: string): boolean {
  if (!appPackage) return true;
  return !c.package || c.package === appPackage;
}

/** Controls the user must fill before the screen can advance. */
export function findInputControls(
  snapshot: MobileScreenSnapshot,
  appPackage?: string,
): MobileObservedControl[] {
  return (snapshot.observedControls ?? []).filter(
    (c) => ownedByApp(c, appPackage) && INPUT_CLASS_RE.test(c.className ?? ""),
  );
}

/**
 * Controls that can actually be tapped: an observed control whose label appears in the
 * snapshot's clickTargets (the list the extractor builds from `clickable="true"` nodes)
 * and that carries a usable locator.
 */
export function findActionableControls(
  snapshot: MobileScreenSnapshot,
  appPackage?: string,
): Array<{ control: MobileObservedControl; target: MobileStepTarget; label: string }> {
  const clickable = new Set((snapshot.clickTargets ?? []).map((t) => normalizeLabel(t)).filter(Boolean));
  // One entry per label, keeping the control with the strongest identity. The same visible
  // label is usually exposed twice — a tappable ViewGroup carrying the content-desc and the
  // TextView that renders it — and both look identical to a caller choosing by label, so the
  // weaker one (class-only locator) must not be offered as a separate, tappable option.
  const byLabel = new Map<string, { entry: { control: MobileObservedControl; target: MobileStepTarget; label: string }; rank: number }>();
  for (const c of snapshot.observedControls ?? []) {
    if (!ownedByApp(c, appPackage)) continue;
    const label = controlLabel(c);
    if (!label) continue;
    const key = normalizeLabel(label);
    if (!clickable.has(key)) continue;
    const target = controlToTarget(c);
    if (!target) continue;
    const rank = (c.contentDesc ?? c.locatorIdentity ?? "").trim()
      ? 0
      : ((c.resourceId ?? "").trim() ? 1 : 2);
    const prev = byLabel.get(key);
    if (!prev || rank < prev.rank) byLabel.set(key, { entry: { control: c, target, label }, rank });
  }
  return Array.from(byLabel.values(), (v) => v.entry);
}

/**
 * Data the caller supplies so the walk can cross a screen that asks for input.
 *
 * The learner never invents values: without a matching entry it stops at needs_input and
 * reports what it was missing. `match` is compared as a normalized substring against the
 * field's label/placeholder, which is what the screen actually shows.
 */
export type LearnerFieldData = {
  /** Substring identifying the field, matched against its label/placeholder. */
  match: string;
  /** Text to type. Omit for an entry that only performs `selectFirst`. */
  value?: string;
  /** Control to tap before typing (e.g. choose "Cédula" before the document number). */
  selectFirst?: string;
  /** Resolve the value at runtime as a one-time code instead of typing `value`. */
  otp?: boolean;
};

export type ResolvedFieldFill = {
  /** Locator of the field to fill. */
  target: MobileStepTarget;
  /** The field's on-screen label, for logs and step descriptions. */
  label: string;
  value?: string;
  otp?: boolean;
  selectFirst?: string;
};

export type ScreenDataResolution =
  | { ok: true; fills: ResolvedFieldFill[] }
  | { ok: false; missing: string[] };

/**
 * Pairs every input on the screen with the caller's data. All-or-nothing: a partially
 * filled form would advance into an unpredictable state, so one unmatched field aborts.
 */
export function resolveScreenData(
  snapshot: MobileScreenSnapshot,
  data: LearnerFieldData[] | undefined,
  appPackage?: string,
): ScreenDataResolution {
  const inputs = findInputControls(snapshot, appPackage);
  if (inputs.length === 0) return { ok: true, fills: [] };

  const entries = data ?? [];
  const fills: ResolvedFieldFill[] = [];
  const missing: string[] = [];

  for (const input of inputs) {
    const label = controlLabel(input) || input.label || "";
    const normalized = normalizeLabel(label);
    const entry = entries.find((e) => {
      const m = normalizeLabel(e.match);
      return m.length > 0 && (normalized.includes(m) || m.includes(normalized));
    });
    if (!entry) {
      missing.push(label || "(campo sin etiqueta)");
      continue;
    }
    const target = inputControlToTarget(input, inputs);
    if (!target) {
      missing.push(`${label} (sin locator utilizable)`);
      continue;
    }
    fills.push({ target, label, value: entry.value, otp: entry.otp, selectFirst: entry.selectFirst });
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true, fills };
}

/** First actionable control whose label contains one of the caller's preferred labels. */
function matchPreferredControl(
  actionable: Array<{ target: MobileStepTarget; label: string }>,
  preferLabels?: string[],
): { target: MobileStepTarget; label: string } | undefined {
  if (!preferLabels?.length) return undefined;
  const wanted = preferLabels.map((l) => normalizeLabel(l)).filter(Boolean);
  if (wanted.length === 0) return undefined;
  return actionable.find((a) => {
    const label = normalizeLabel(a.label);
    return wanted.some((w) => label.includes(w));
  });
}

/**
 * Decides what the learner should do on the screen it is looking at.
 * Order matters: a repeated screen means the last tap did nothing, an input means the walk
 * needs data it must not invent, and a commit control ends the walk before side effects.
 */
export function decideNextAction(
  snapshot: MobileScreenSnapshot,
  opts: DecideOptions = {},
): LearnerDecision {
  const stopBeforeSubmit = opts.stopBeforeSubmit !== false;

  if (opts.visitedFingerprints?.has(snapshot.fingerprint)) {
    return { kind: "stop", reason: "loop_detected", detail: `screen ${snapshot.screenKey} did not change` };
  }

  const actionable = findActionableControls(snapshot, opts.appPackage);

  const submits = actionable.filter((a) => isBlockedSubmitLabel(a.label, opts.allowSubmitLabels));
  const submitBlocked = submits.length > 0 && stopBeforeSubmit;

  // Caller-steered branch: honored before needs_input, but never over the submit guard.
  const preferred = matchPreferredControl(actionable, opts.preferLabels);
  if (preferred && !isBlockedSubmitLabel(preferred.label, opts.allowSubmitLabels)) {
    return { kind: "advance", target: preferred.target, label: preferred.label };
  }

  const inputs = findInputControls(snapshot, opts.appPackage);
  if (inputs.length > 0) {
    const labels = inputs.map((c) => controlLabel(c) || c.label || "(sin etiqueta)").slice(0, 6);
    return { kind: "stop", reason: "needs_input", detail: `campos por completar: ${labels.join(", ")}` };
  }

  if (actionable.length === 0) {
    return { kind: "stop", reason: "no_actionable", detail: `sin controles accionables en ${snapshot.screenKey}` };
  }

  if (submitBlocked) {
    return {
      kind: "stop",
      reason: "submit_guard",
      detail: `no se presiona "${submits[0].label}" (confirmaria el flujo)`,
    };
  }

  const continues = actionable.filter((a) => isContinueLabel(a.label));
  if (continues.length === 1) {
    return { kind: "advance", target: continues[0].target, label: continues[0].label };
  }
  if (continues.length > 1) {
    return {
      kind: "stop",
      reason: "ambiguous_choice",
      detail: `varios controles de avance: ${continues.map((c) => c.label).join(" | ")}`,
    };
  }

  return {
    kind: "stop",
    reason: "ambiguous_choice",
    detail: `ningun control de avance evidente entre: ${actionable.map((a) => a.label).slice(0, 6).join(" | ")}`,
  };
}
