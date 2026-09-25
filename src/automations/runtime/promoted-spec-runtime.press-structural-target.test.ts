import assert from "node:assert/strict";
import test from "node:test";
import { PromotedSpecRuntime, parseSerializedTechnicalTargetString } from "./promoted-spec-runtime";

/**
 * FIRST_LOSS (jobId 4bcae275-38d7-487c-926a-24cd882cb8a3): the authoritative Recording/direct-
 * replay resolver resolves `{strategy:"role", value:"textbox|Contraseña"}` uniquely via the
 * shared `recordedLocatorFactory` (target-resolver.ts). `pressPromotedTarget`'s API has no
 * separate structured field, so the SAME serialized string ("role:textbox|Contraseña") arrived
 * as a flat `target`, and was handed to `resolvePromotedFieldLocator` -- a fuzzy human-field-
 * label search that treats the whole garbled string as literal text, matching nothing
 * (`target_not_resolved`). Fixed: `parseSerializedTechnicalTargetString` detects the same
 * `strategy:value` convention and resolves it through the SAME `recordedLocatorFactory` Recording
 * already trusts, never falling through to the fuzzy path once a structured shape is detected.
 */

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

type FakeElement = { role: string; name: string; visible: boolean; disabled: boolean; pressed: string[] };

function makeFakeLocator(elements: FakeElement[]) {
  return {
    count: async () => elements.length,
    first() { return this; },
    isVisible: async () => elements[0]?.visible ?? false,
    isDisabled: async () => elements[0]?.disabled ?? false,
    press: async (key: string) => { elements[0]?.pressed.push(key); },
    click: async () => { throw new Error("click() must never be called for a press operation"); },
  };
}

function createFakePage(registry: FakeElement[], transitionAfterProbe = false) {
  let snapshotCalls = 0;
  return {
    on: () => undefined,
    off: () => undefined,
    context: () => ({ on: () => undefined, off: () => undefined }),
    url: () => "https://example.test/form",
    isClosed: () => false,
    goto: async () => undefined,
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    evaluate: async (_callback: unknown, ...args: unknown[]) => {
      if (args.length > 0) {
        snapshotCalls += 1;
        const transitioned = transitionAfterProbe && snapshotCalls >= 3;
        return {
          url: transitioned ? "https://example.test/next" : "https://example.test/form",
          signature: transitioned ? "new-surface" : "login-surface",
          targetVisible: !transitioned,
          surfaceCount: 1,
        };
      }
      return true;
    },
    locator: (selector: string) => makeFakeLocator([]),
    getByRole: (role: string, opts?: { name?: string; exact?: boolean }) => {
      const matches = registry.filter((el) => el.role === role && (!opts?.name || el.name === opts.name));
      return makeFakeLocator(matches);
    },
  };
}

test("1/parsesRoleAccessibleNameShape. the recorded strategy:value convention is parsed structurally, not as plain text", () => {
  const parsed = parseSerializedTechnicalTargetString("role:textbox|Contraseña");
  assert.deepEqual(parsed, { strategy: "role", value: "textbox|Contraseña" });
});

test("2/plainFieldLabelNotMisparsed. a genuine human field label with no known strategy prefix is never treated as structured", () => {
  assert.equal(parseSerializedTechnicalTargetString("Contraseña"), undefined);
  assert.equal(parseSerializedTechnicalTargetString("Número de identificación"), undefined);
});

test("3/structuralPressResolvesAndDispatches. a role+accessibleName technical target resolves to exactly one Locator and dispatches locator.press(key), never click()", async () => {
  await withEnv({ APP_BASE_URL: "https://example.test", EVIDENCE_ENABLED: undefined }, async () => {
    const contraseña: FakeElement = { role: "textbox", name: "Contraseña", visible: true, disabled: false, pressed: [] };
    const page = createFakePage([contraseña]);
    const runtime = new PromotedSpecRuntime(page as any, { captureDiagnostics: false });
    await runtime.pressPromotedTarget({
      stepIndex: 3,
      target: "role:textbox|Contraseña",
      key: "Enter",
      actionIntent: "press_key",
      expectedEffect: "none",
    });
    assert.deepEqual(contraseña.pressed, ["Enter"]);
  });
});

test("4/zeroMatchesDeterministicFailure. no matching element yields a deterministic target_not_resolved, never a silent pass", async () => {
  await withEnv({ APP_BASE_URL: "https://example.test", EVIDENCE_ENABLED: undefined }, async () => {
    const page = createFakePage([]);
    const runtime = new PromotedSpecRuntime(page as any, { captureDiagnostics: false });
    await assert.rejects(
      () => runtime.pressPromotedTarget({
        stepIndex: 3,
        target: "role:textbox|Contraseña",
        key: "Enter",
        actionIntent: "press_key",
        expectedEffect: "none",
      }),
      /reason=target_not_resolved matchCount=0/,
    );
  });
});

test("5/multipleMatchesFailClosedAmbiguous. more than one eligible match fails closed as ambiguous, never picks one arbitrarily", async () => {
  await withEnv({ APP_BASE_URL: "https://example.test", EVIDENCE_ENABLED: undefined }, async () => {
    const page = createFakePage([
      { role: "textbox", name: "Contraseña", visible: true, disabled: false, pressed: [] },
      { role: "textbox", name: "Contraseña", visible: true, disabled: false, pressed: [] },
    ]);
    const runtime = new PromotedSpecRuntime(page as any, { captureDiagnostics: false });
    await assert.rejects(
      () => runtime.pressPromotedTarget({
        stepIndex: 3,
        target: "role:textbox|Contraseña",
        key: "Enter",
        actionIntent: "press_key",
        expectedEffect: "none",
      }),
      /reason=target_ambiguous matchCount=2/,
    );
  });
});

test("6/asyncPressTransitionUsesSharedWait. a delayed observable transition after Enter passes without an immediate URL or DOM change", async () => {
  await withEnv({ APP_BASE_URL: "https://example.test", EVIDENCE_ENABLED: undefined }, async () => {
    const password: FakeElement = { role: "textbox", name: "Contraseña", visible: true, disabled: false, pressed: [] };
    const runtime = new PromotedSpecRuntime(createFakePage([password], true) as any, { captureDiagnostics: false });
    await runtime.pressPromotedTarget({
      stepIndex: 3,
      target: "role:textbox|Contraseña",
      key: "Enter",
      actionIntent: "press_key",
      expectedEffect: "ui_change",
    });
    assert.deepEqual(password.pressed, ["Enter"]);
  });
});

test("7/pressWithoutObservableOutcomeFailsClosed. Enter with no observable completion remains a failure", async () => {
  await withEnv({
    APP_BASE_URL: "https://example.test",
    EVIDENCE_ENABLED: undefined,
    LOADING_STABILITY_TIMEOUT_MS: "10",
    ASYNC_OPERATION_HARD_SAFETY_CAP_MS: "20",
  }, async () => {
    const password: FakeElement = { role: "textbox", name: "Contraseña", visible: true, disabled: false, pressed: [] };
    const runtime = new PromotedSpecRuntime(createFakePage([password]) as any, { captureDiagnostics: false });
    await assert.rejects(
      runtime.pressPromotedTarget({
        stepIndex: 3,
        target: "role:textbox|Contraseña",
        key: "Enter",
        actionIntent: "press_key",
        expectedEffect: "ui_change",
      }),
      /no_observable_post_action_outcome/,
    );
    assert.deepEqual(password.pressed, ["Enter"]);
  });
});
