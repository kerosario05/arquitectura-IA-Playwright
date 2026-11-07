export type PageState = {
  url: string;
  bodyText: string;
  elementCount: number;
};

export function hasPageTransition(before: PageState, after: PageState, targetText: string): boolean {
  if (before.url !== after.url) return true;

  const normalizedTarget = normalizeTransitionText(targetText);
  const targetWasPresentBefore = before.bodyText.includes(normalizedTarget);
  const targetDisappeared = targetWasPresentBefore && !after.bodyText.includes(normalizedTarget);
  if (targetDisappeared) return true;

  if (computeTextDiffRatio(before.bodyText, after.bodyText) > 0.05) return true;
  return Math.abs(before.elementCount - after.elementCount) > 5;
}

function normalizeTransitionText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function computeTextDiffRatio(before: string, after: string): number {
  const maxLength = Math.max(before.length, after.length);
  if (!maxLength) return 0;
  let changedChars = 0;
  for (let index = 0; index < maxLength; index++) {
    if (before[index] !== after[index]) changedChars++;
  }
  return changedChars / maxLength;
}
