import type { Locator, Page } from "@playwright/test";

type SegmentedInputCandidate = { locator: Locator; groupKey: string };

/**
 * Detects a single visible, writable segmented-code group from its current DOM shape.
 * This is deliberately Jira-local: it does not consume recorder evidence or project selectors.
 */
export async function resolveJiraSegmentedCodeGroup(page: Page): Promise<Locator[] | undefined> {
  const candidates: SegmentedInputCandidate[] = [];
  for (const locator of await page.locator('input[maxlength="1"]').all()) {
    if (!await locator.isVisible().catch(() => false)
      || await locator.isDisabled().catch(() => true)
      || !await locator.isEditable().catch(() => false)) continue;
    const identity = await locator.evaluate(element => {
      const input = element as HTMLInputElement;
      const form = input.form;
      const parent = input.parentElement;
      return {
        name: input.name.trim(),
        type: input.type.toLowerCase(),
        formId: form?.id ?? "",
        formAction: form?.getAttribute("action") ?? "",
        parentId: parent?.id ?? "",
        parentTag: parent?.tagName.toLowerCase() ?? "",
        parentClass: typeof parent?.className === "string" ? parent.className.trim().split(/\s+/).sort().join(".") : "",
      };
    });
    // A shared input name or form is structural evidence. Unnamed fields must share the
    // same immediate parent; otherwise unrelated one-character fields are not grouped.
    const groupKey = identity.name
      ? JSON.stringify([identity.type, identity.name, identity.formId, identity.formAction])
      : identity.formId || identity.formAction
        ? JSON.stringify([identity.type, identity.formId, identity.formAction, identity.parentId, identity.parentTag, identity.parentClass])
        : JSON.stringify([identity.type, identity.parentId, identity.parentTag, identity.parentClass]);
    candidates.push({ locator, groupKey });
  }

  const groups = new Map<string, Locator[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.groupKey) ?? [];
    group.push(candidate.locator);
    groups.set(candidate.groupKey, group);
  }
  const plausibleGroups = [...groups.values()].filter(group => group.length >= 4 && group.length <= 8);
  if (!plausibleGroups.length) return undefined;
  if (plausibleGroups.length !== 1) throw new Error("JIRA_SEGMENTED_CODE_GROUP_AMBIGUOUS");
  return plausibleGroups[0];
}

/** Types a single Jira runtime value across a verified segmented control and checks every slot. */
export async function fillJiraSegmentedCode(page: Page, value: string, expectedSegmentCount?: number): Promise<number> {
  const segments = await resolveJiraSegmentedCodeGroup(page);
  if (!segments) throw new Error("JIRA_SEGMENTED_CODE_GROUP_NOT_FOUND");
  if ((expectedSegmentCount !== undefined && segments.length !== expectedSegmentCount) || value.length !== segments.length) {
    throw new Error("JIRA_SEGMENTED_CODE_LENGTH_MISMATCH");
  }
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!await segment.isVisible() || await segment.isDisabled() || !await segment.isEditable()) {
      throw new Error("JIRA_SEGMENTED_CODE_SLOT_NOT_ACTIONABLE");
    }
    await segment.click();
    await segment.press("ControlOrMeta+A").catch(() => undefined);
    await segment.pressSequentially(value[index]);
    const actual = await segment.inputValue().catch(() => "");
    if (actual !== value[index]) throw new Error("JIRA_SEGMENTED_CODE_SLOT_NOT_CONFIRMED");
  }
  for (let index = 0; index < segments.length; index += 1) {
    if (await segments[index].inputValue().catch(() => "") !== value[index]) {
      throw new Error("JIRA_SEGMENTED_CODE_GROUP_NOT_CONFIRMED");
    }
  }
  return segments.length;
}

export function isJiraSegmentedCodeTarget(target: string): boolean {
  const normalized = target.trim();
  return /^(?:c[oó]digo|code|token)$|\b(?:otp|pin)\b|c[oó]digo.{0,35}(?:acceso|verificaci[oó]n|seguridad|sms)|(?:token|clave).{0,35}(?:seguridad|transferencia|sms)/i.test(normalized);
}
