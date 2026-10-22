/** Formatting only: never chooses a control, rewrites a route or infers applicability. */
export function normalizeAuthoredJiraStep(value: string): string {
  const text = value.trim();
  const match = text.match(/^(?:presionar|pulsar|hacer clic en|clic en|click on|press)\s+(?:(?:el|la|the)\s+)?(?:(?:bot[oó]n|button|enlace|link|pestaña|tab)\s+)?(.+?)[.]?$/i);
  if (!match) return text;
  const target = match[1].trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g,'').trim();
  // Compound/conditional/scoped actions need their existing parser/reviewer;
  // quoting a whole sentence would disguise them as one literal control.
  if (!target || /["“”'‘’\r\n]/.test(target)
    || /\b(?:y|luego|despu[eé]s|si|cuando|and|then|if|when)\b|[;{}<>]/i.test(target)) return text;
  return `Presionar "${target}"`;
}
