/** Formatting only: never chooses a control, rewrites a route or infers applicability. */
export function normalizeAuthoredJiraStep(value: string): string {
  const text = value.trim();
  // A simple "action value in field" sentence names its destination field
  // unambiguously. Quote that field so it reaches the same target grammar as
  // Jira-generated steps. Leave composite prose and already-bound steps alone.
  const fieldAction = text.match(/^(ingresar|escribir|digitar|introducir|llenar|completar|seleccionar|elegir|escoger)\s+(.+?)\s+en\s+(?:(?:el|la)\s+)?(?:campo\s+)?([^\s"“”'‘’]+(?:\s+[^\s"“”'‘’]+){0,3})[.]?$/i);
  if (fieldAction && !/["“”'‘’]/.test(fieldAction[2]) && !/[.!?]$/.test(fieldAction[3])
    && !/\b(?:y|luego|despu[eé]s|si|cuando|and|then|if|when)\b|[;{}<>]/i.test(text)) {
    const [, rawVerb, data, rawLabel] = fieldAction;
    const verb = rawVerb[0].toLocaleUpperCase() + rawVerb.slice(1);
    const label = rawLabel.trim();
    return `${verb} ${data.trim()} en "${label[0].toLocaleUpperCase()}${label.slice(1)}"`;
  }
  const match = text.match(/^(?:presionar|pulsar|hacer clic en|clic en|click on|press)\s+(?:(?:el|la|the)\s+)?(?:(?:bot[oó]n|button|enlace|link|pestaña|tab)\s+)?(.+?)[.]?$/i);
  if (!match) return text;
  const target = match[1].trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g,'').trim();
  // Compound/conditional/scoped actions need their existing parser/reviewer;
  // quoting a whole sentence would disguise them as one literal control.
  if (!target || /["“”'‘’\r\n]/.test(target)
    || /\b(?:y|luego|despu[eé]s|si|cuando|and|then|if|when)\b|[;{}<>]/i.test(target)) return text;
  return `Presionar "${target}"`;
}
