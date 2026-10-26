import type { AiMessage } from '../ai/ai-provider.types';

const PREFIX_GUIDANCE = '\nvalidatedJourneyPrefixes is a lossless dictionary of repeated steps. For each validatedJourney with stepsPrefixId, reconstruct its full steps by concatenating the referenced prefix.steps and stepsSuffix before using it. inputRequirements.stepIndex refers to that full sequence, never the suffix. Preserve every action, label and branch; return complete steps in any correction, never prefix references.';

/** Factor exact shared prefixes only; retain every journey, field and original index. */
export function compactJiraGenerationMessages(messages: AiMessage[]): AiMessage[] {
  let compacted = false;
  const result = messages.map(message => {
    if (message.role !== 'user') return message;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(message.content); } catch { return message; }
    if (!payload || !Array.isArray(payload.validatedJourneys) || payload.validatedJourneyPrefixes) return message;
    const journeys = payload.validatedJourneys as Record<string, unknown>[];
    const groups = new Map<string, number[]>();
    journeys.forEach((journey, index) => {
      if (!journey || !Array.isArray(journey.steps) || journey.steps.length < 3) return;
      const key = JSON.stringify([journey.sourceIssueKey, journey.authIntent, journey.steps.slice(0, 3)]);
      groups.set(key, [...(groups.get(key) ?? []), index]);
    });
    const prefixes: Array<{id: string; sourceIssueKey: unknown; authIntent: unknown; steps: unknown[]}> = [];
    const output = [...journeys];
    for (const indices of groups.values()) {
      if (indices.length < 2) continue;
      const first = journeys[indices[0]], steps = first.steps as unknown[];
      let length = steps.length;
      for (const index of indices.slice(1)) {
        const other = journeys[index].steps as unknown[];
        let common = 0;
        while (common < Math.min(length, other.length) && steps[common] === other[common]) common++;
        length = common;
      }
      const prefix = {id: `prefix-${prefixes.length + 1}`, sourceIssueKey:first.sourceIssueKey, authIntent:first.authIntent, steps:steps.slice(0,length)};
      const factored = indices.map(index => {
        const {steps: original, ...rest} = journeys[index];
        return {...rest, stepsPrefixId:prefix.id, stepsSuffix:(original as unknown[]).slice(length)};
      });
      // Do not increase a small context just to introduce indirection.
      if (JSON.stringify({prefix,factored}).length >= JSON.stringify(indices.map(index=>journeys[index])).length) continue;
      prefixes.push(prefix);
      indices.forEach((index, offset) => { output[index] = factored[offset]; });
    }
    if (!prefixes.length) return message;
    const content = JSON.stringify({...payload, validatedJourneys:output, validatedJourneyPrefixes:prefixes});
    if (content.length + PREFIX_GUIDANCE.length >= message.content.length) return message;
    compacted = true;
    return {...message, content};
  });
  if (!compacted) return result;
  const output = result.map(message=>message.role==='system' ? {...message,content:message.content+PREFIX_GUIDANCE} : message);
  console.log(`[jira-generation:context] mode=shared_prefixes originalChars=${messages.reduce((sum,message)=>sum+message.content.length,0)} compactChars=${output.reduce((sum,message)=>sum+message.content.length,0)}`);
  return output;
}
