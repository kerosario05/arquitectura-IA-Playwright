import type { Locator, Page } from "@playwright/test";

export type RecordedSelectionDialogTransitionEvidence = {
  recordingExecutionContractPresent: boolean;
  currentActionIsRecordedSelection: boolean;
  currentValueBacked: boolean;
  selectionFailureReason?: string;
  requestedOptionExactlyMatched: boolean;
  optionClickDispatched: boolean;
  visibleDialogsBefore: number;
  visibleDialogsAfter: number;
};

export function canVerifyRecordedSelectionByDialogTransition(
  evidence: RecordedSelectionDialogTransitionEvidence,
): boolean {
  return evidence.recordingExecutionContractPresent
    && evidence.currentActionIsRecordedSelection
    && evidence.currentValueBacked
    && evidence.selectionFailureReason === "selection_state_not_verified"
    && evidence.requestedOptionExactlyMatched
    && evidence.optionClickDispatched
    && evidence.visibleDialogsBefore === 0
    && evidence.visibleDialogsAfter === 1;
}

export async function getUniqueVisibleDialogContinuationAnchor(page: Page): Promise<Locator | undefined> {
  const dialogs = page.locator('[role="dialog"], [aria-modal="true"]').filter({ visible: true });
  if (await dialogs.count().catch(() => 0) !== 1) return undefined;
  const dialog = dialogs.first();
  const controls = dialog.locator(
    'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="combobox"], [aria-haspopup="listbox"]',
  ).filter({ visible: true });
  for (let index = 0; index < await controls.count().catch(() => 0); index += 1) {
    const control = controls.nth(index);
    if (!(await control.isEnabled().catch(() => false))) continue;
    if (await control.getAttribute("aria-disabled").catch(() => null) === "true") continue;
    return dialog;
  }
  return undefined;
}

export async function countVisibleDialogSurfaces(page: Page): Promise<number> {
  return page.locator('[role="dialog"], [aria-modal="true"]')
    .filter({ visible: true })
    .count()
    .catch(() => 0);
}
