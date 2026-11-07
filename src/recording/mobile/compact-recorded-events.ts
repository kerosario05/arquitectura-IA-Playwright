import type { RecordedEvent, RecordedScreen } from "../session-trace.types";

/**
 * Turns what the mobile poller saw into what the user did, like the web recorder's typing
 * coalescing does:
 *
 * - A screen that keeps changing by itself (a "Reenviar código en 0:41" countdown, a loader)
 *   gets a new fingerprint on every read. Those transitions stay between screens of the same
 *   title and are not steps.
 * - Every read during typing sees a partial value ("79", "7968", "796883"); consecutive fills
 *   of one field become a single fill with the last value.
 * - Tapping a field right before typing in it only focuses it; the fill already does that.
 *
 * Transitions between differently titled screens, taps on controls and fills of different
 * fields are untouched, so nothing the user really did is dropped.
 */
export function compactRecordedEvents(events: readonly RecordedEvent[], screens: readonly RecordedScreen[]): RecordedEvent[] {
  const titleOf = new Map(screens.map((screen) => [screen.screenKey, normalize(screen.title)]));
  const sameTitle = (a?: string, b?: string) => {
    const ta = a ? titleOf.get(a) : undefined;
    const tb = b ? titleOf.get(b) : undefined;
    return Boolean(ta && tb && ta === tb);
  };

  // 1. Same-title transitions are not steps, nor a stop on an untitled in-between frame
  //    (a transition animation read mid-way) that the next transition immediately leaves.
  const untitled = (key?: string) => {
    const title = key ? titleOf.get(key) : undefined;
    return !title || title === "unknown";
  };
  const withoutNoise = events.filter((event, index) => {
    if (event.kind !== "screen_change") return true;
    if (sameTitle(event.screenKey, event.toScreenKey)) return false;
    const next = events[index + 1];
    return !(untitled(event.toScreenKey) && next?.kind === "screen_change" && next.screenKey === event.toScreenKey);
  });

  // 2 + 3. Fills of one field collapse to the last value; a focusing tap on it is dropped.
  const result: RecordedEvent[] = [];
  for (const event of withoutNoise) {
    if (event.kind === "fill") {
      const field = fieldKey(event);
      let previousIndex = lastActionIndex(result);
      // A focusing tap on this same field goes; then the fill before it (if any) is compared.
      if (field && previousIndex >= 0 && result[previousIndex].kind === "tap" && fieldKey(result[previousIndex]) === field) {
        result.splice(previousIndex, 1);
        previousIndex = lastActionIndex(result);
      }
      const previous = previousIndex >= 0 ? result[previousIndex] : undefined;
      if (previous && field && previous.kind === "fill" && fieldKey(previous) === field) {
        // Keep the first fill's position and identity, take the final value.
        result[previousIndex] = { ...previous, value: event.value, redactedKey: event.redactedKey ?? previous.redactedKey };
        continue;
      }
    }
    result.push(event);
  }
  return result;
}

function normalize(text: string | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

/** A field is identified by its label plus its first locator (two "Código" boxes differ by locator). */
function fieldKey(event: RecordedEvent): string | undefined {
  const target = event.target;
  if (!target?.label) return undefined;
  const locator = target.locators?.[0];
  return `${normalize(target.label)}|${locator ? `${locator.strategy}:${locator.value}` : ""}`;
}

/** Index of the last event that is an action (tap/fill/swipe), skipping transitions and notes. */
function lastActionIndex(events: readonly RecordedEvent[]): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const kind = events[i].kind;
    if (kind === "tap" || kind === "fill" || kind === "swipe") return i;
    if (kind === "screen_change") return -1;
  }
  return -1;
}
