import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import {
  canVerifyRecordedSelectionBySuccessorControl,
  canVerifyRecordedSelectionByDialogTransition,
  canVerifyRecordedSelectionBySuccessorDialog,
  getUniqueVisibleDialogContinuationAnchor,
  hasUniqueEnabledRecordedSelectionOwner,
  hasUniqueEnabledRecordedSelectionOwnerInDialog,
  isRecordedSelectionAction,
  readPendingSelectionTag,
} from "./case-discovery";

test("verified custom and dynamic selections never read a removed option locator", async () => {
  const removedOption = { evaluate: async (): Promise<string> => {
    assert.fail("completed selections must not wait for a detached option");
  } };
  for (const state of [
    { runtimeBacked: true, selectionApplied: true, dynamicSelectionApplied: false },
    { runtimeBacked: true, selectionApplied: false, dynamicSelectionApplied: true },
    { runtimeBacked: false, selectionApplied: false, dynamicSelectionApplied: false },
  ]) {
    assert.equal(await readPendingSelectionTag(removedOption, state), "");
  }
});

test("pending native selections still inspect the control before selectOption dispatch", async () => {
  let reads = 0;
  const nativeSelect = { evaluate: async (read: (element: Element) => string) => {
    reads += 1;
    return read({ tagName: "SELECT" } as Element);
  } };
  assert.equal(await readPendingSelectionTag(nativeSelect, {
    runtimeBacked: true, selectionApplied: false, dynamicSelectionApplied: false,
  }), "select");
  assert.equal(reads, 1);
});

test("a pending control that disappears retains the existing failed inspection fallback", async () => {
  assert.equal(await readPendingSelectionTag({ evaluate: async () => { throw new Error("detached"); } }, {
    runtimeBacked: true, selectionApplied: false, dynamicSelectionApplied: false,
  }), "");
});

const verifiedSuccessorDialogEvidence = {
  recordingExecutionContractPresent: true,
  currentActionIsRecordedSelection: true,
  currentValueBacked: true,
  selectionFailureReason: "selection_state_not_verified",
  requestedOptionExactlyMatched: true,
  optionClickDispatched: true,
  visibleDialogsBefore: 0,
  visibleDialogsAfter: 1,
  successorActionRecorded: true,
  successorOwnerUnique: true,
  successorOwnerEnabled: true,
};

test("recorded selection accepts a new dialog only when the exact option and unique successor are verified", () => {
  assert.equal(canVerifyRecordedSelectionBySuccessorDialog(verifiedSuccessorDialogEvidence), true);
  for (const change of [
    { requestedOptionExactlyMatched: false },
    { optionClickDispatched: false },
    { visibleDialogsBefore: 1 },
    { visibleDialogsAfter: 2 },
    { successorActionRecorded: false },
    { successorOwnerUnique: false },
    { successorOwnerEnabled: false },
    { selectionFailureReason: "option_not_supported" },
  ]) {
    assert.equal(canVerifyRecordedSelectionBySuccessorDialog({ ...verifiedSuccessorDialogEvidence, ...change }), false);
  }
});

test("successor dialog verification remains disabled outside a value-backed recording contract", () => {
  assert.equal(canVerifyRecordedSelectionBySuccessorDialog({
    ...verifiedSuccessorDialogEvidence,
    recordingExecutionContractPresent: false,
  }), false);
  assert.equal(canVerifyRecordedSelectionBySuccessorDialog({
    ...verifiedSuccessorDialogEvidence,
    currentValueBacked: false,
  }), false);
});

test("custom recorded option clicks qualify as selections only with exact option authority", () => {
  const productOptionClick = {
    actionType: "action_select" as const,
    recordingActionType: "click" as const,
    technicalTargetRefs: [
      "role:option|Recorded product A",
      "css:#recorded-option",
    ],
  };
  assert.equal(isRecordedSelectionAction({
    ...productOptionClick,
    requestedOption: "Recorded product A",
  }), true);
  const nextRecordedOptionClick = {
    actionType: "action_select" as const,
    recordingActionType: "click" as const,
    technicalTargetRefs: ["role:option|Reference type A"],
  };
  assert.equal(isRecordedSelectionAction(nextRecordedOptionClick), true, "the next recorded option action remains eligible for dialog owner checks");
  assert.equal(canVerifyRecordedSelectionBySuccessorDialog({
    ...verifiedSuccessorDialogEvidence,
    currentActionIsRecordedSelection: isRecordedSelectionAction({
      ...productOptionClick,
      requestedOption: "Recorded product A",
    }),
    successorActionRecorded: true,
  }), true, "the exact product option may be verified by its newly opened dialog and recorded successor action");
  assert.equal(isRecordedSelectionAction({
    ...productOptionClick,
    requestedOption: "Different product",
  }), false);
  assert.equal(isRecordedSelectionAction({
    ...productOptionClick,
    technicalTargetRefs: [
      "role:option|Recorded product A",
      "role:option|Other product",
    ],
  }), false, "ambiguous recorded option authority fails closed");
  assert.equal(isRecordedSelectionAction({
    actionType: "action_click",
    recordingActionType: "click",
    technicalTargetRefs: ["role:option|Recorded product A"],
    requestedOption: "Recorded product A",
  }), false);
  assert.equal(isRecordedSelectionAction({
    actionType: "action_select",
    recordingActionType: "select",
    technicalTargetRefs: [],
  }), true, "native selects retain their existing contract");
});

test("a newly opened dialog may be verified by the next recorded field-opening action", () => {
  const nextActionOpensField = {
    actionType: "action_click" as const,
    recordingActionType: "click" as const,
    technicalTargetRefs: ["role:combobox|Reference code"],
  };
  assert.equal(isRecordedSelectionAction(nextActionOpensField), false);
  assert.equal(canVerifyRecordedSelectionBySuccessorDialog({
    ...verifiedSuccessorDialogEvidence,
    successorActionRecorded: true,
    successorOwnerUnique: true,
    successorOwnerEnabled: true,
  }), true, "the next action can open a recorded field before selecting its option");
});

test("an exact recorded option click that opens an interactive dialog verifies the selection transition", () => {
  const dialogTransitionEvidence = {
    recordingExecutionContractPresent: true,
    currentActionIsRecordedSelection: true,
    currentValueBacked: true,
    selectionFailureReason: "selection_state_not_verified",
    requestedOptionExactlyMatched: true,
    optionClickDispatched: true,
    visibleDialogsBefore: 0,
    visibleDialogsAfter: 1,
  };
  assert.equal(canVerifyRecordedSelectionByDialogTransition(dialogTransitionEvidence), true);

  for (const change of [
    { recordingExecutionContractPresent: false },
    { currentActionIsRecordedSelection: false },
    { currentValueBacked: false },
    { selectionFailureReason: "option_not_supported" },
    { requestedOptionExactlyMatched: false },
    { optionClickDispatched: false },
    { visibleDialogsBefore: 1 },
    { visibleDialogsAfter: 0 },
    { visibleDialogsAfter: 2 },
  ]) {
    assert.equal(canVerifyRecordedSelectionByDialogTransition({ ...dialogTransitionEvidence, ...change }), false);
  }
});

test("a newly visible recorded successor control verifies a selection transition without dialog ARIA", () => {
  const evidence = {
    recordingExecutionContractPresent: true,
    currentActionIsRecordedSelection: true,
    currentValueBacked: true,
    selectionFailureReason: "selection_state_not_verified",
    requestedOptionExactlyMatched: true,
    optionClickDispatched: true,
    successorActionRecorded: true,
    successorOwnerReadyBefore: false,
    successorOwnerUniqueAfter: true,
    successorOwnerEnabledAfter: true,
  };
  assert.equal(canVerifyRecordedSelectionBySuccessorControl(evidence), true);

  for (const change of [
    { recordingExecutionContractPresent: false },
    { currentActionIsRecordedSelection: false },
    { currentValueBacked: false },
    { selectionFailureReason: "option_not_supported" },
    { requestedOptionExactlyMatched: false },
    { optionClickDispatched: false },
    { successorActionRecorded: false },
    { successorOwnerReadyBefore: true },
    { successorOwnerUniqueAfter: false },
    { successorOwnerEnabledAfter: false },
  ]) {
    assert.equal(canVerifyRecordedSelectionBySuccessorControl({ ...evidence, ...change }), false);
  }
});

test("recorded successor control discovery supports an unlabelled structural modal", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><span role="combobox" aria-label="Product"></span></main>');
    const before = await hasUniqueEnabledRecordedSelectionOwner(page, ["Choose a reference"]);
    assert.deepEqual({ unique: before.unique, enabled: before.enabled }, { unique: false, enabled: false });

    await page.locator("main").evaluate((main) => {
      main.insertAdjacentHTML("afterend", `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,.4)">
          <section style="position:absolute; inset:10%; background:white">
            <label for="reference">Choose a reference</label>
            <input id="reference" role="combobox" aria-label="Choose a reference">
          </section>
        </div>
      `);
    });
    const after = await hasUniqueEnabledRecordedSelectionOwner(page, ["Choose a reference"]);
    assert.equal(after.unique, true);
    assert.equal(after.enabled, true);
    assert.equal(await after.locator?.getAttribute("aria-label"), "Choose a reference");
  } finally {
    await browser.close();
  }
});

test("dialog transition continuation requires one visible dialog with an enabled interactive control", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div role="dialog" aria-modal="true">
        <label for="reference">Reference</label>
        <input id="reference" role="combobox" placeholder="Choose an option">
      </div>
    `);
    assert.ok(await getUniqueVisibleDialogContinuationAnchor(page));

    await page.setContent('<div role="dialog" aria-modal="true"><p>Completed</p></div>');
    assert.equal(await getUniqueVisibleDialogContinuationAnchor(page), undefined);

    await page.setContent('<div role="dialog" aria-modal="true"><button disabled>Continue</button></div>');
    assert.equal(await getUniqueVisibleDialogContinuationAnchor(page), undefined);
  } finally {
    await browser.close();
  }
});

test("recorded successor control must be uniquely matched and enabled inside the new dialog", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div role="dialog" aria-modal="true">
        <label for="reference">Código referente</label>
        <input id="reference" role="combobox" placeholder="Seleccione una opción">
      </div>
    `);
    const uniqueOwner = await hasUniqueEnabledRecordedSelectionOwnerInDialog(page, ["Seleccione una opción"]);
    assert.deepEqual({ unique: uniqueOwner.unique, enabled: uniqueOwner.enabled }, { unique: true, enabled: true });
    assert.ok(uniqueOwner.locator, "a verified successor owner must be available as the continuation anchor");
    assert.equal(await uniqueOwner.locator.getAttribute("placeholder"), "Seleccione una opción");

    await page.locator('[role="dialog"]').evaluate((dialog) => {
      dialog.insertAdjacentHTML("beforeend", '<input role="combobox" placeholder="Seleccione una opción">');
    });
    const duplicateOwner = await hasUniqueEnabledRecordedSelectionOwnerInDialog(page, ["Seleccione una opción"]);
    assert.deepEqual({ unique: duplicateOwner.unique, enabled: duplicateOwner.enabled }, { unique: false, enabled: false });
    assert.equal(duplicateOwner.locator, undefined, "ambiguous successors must not yield a locator");

    await page.locator('[role="dialog"] input[role="combobox"]').nth(1).evaluate((element) => element.remove());
    await page.locator('[role="dialog"] input[role="combobox"]').evaluate((element) => {
      (element as HTMLInputElement).disabled = true;
    });
    const disabledOwner = await hasUniqueEnabledRecordedSelectionOwnerInDialog(page, ["Seleccione una opción"]);
    assert.deepEqual({ unique: disabledOwner.unique, enabled: disabledOwner.enabled }, { unique: true, enabled: false });
    assert.equal(disabledOwner.locator, undefined, "disabled successors must not yield a locator");
  } finally {
    await browser.close();
  }
});
