/**
 * Teléfonos enmascarados ("(829) ***-**00"): la app muestra el número del CLIENTE, así que cambia
 * cuando el escenario se ejecuta con otra cédula. Un clic grabado sobre uno de ellos no debe
 * depender del número exacto de la grabación.
 */

const MASKED_PHONE = /^\(?\d{3}\)?[\s-]*[*•x]{2,}[\s-]*[*•x]*\d{2,4}$/i;

export function isMaskedPhoneLabel(value: string | undefined): boolean {
  return Boolean(value && MASKED_PHONE.test(value.trim()));
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Teléfonos enmascarados distintos que hay en pantalla (content-desc o text), en orden de aparición. */
export function findMaskedPhoneLabels(pageSource: string): string[] {
  const found: string[] = [];
  for (const match of pageSource.matchAll(/\b(?:content-desc|text)="([^"]*)"/g)) {
    const label = decodeXml(match[1]).trim();
    if (isMaskedPhoneLabel(label) && !found.includes(label)) found.push(label);
  }
  return found;
}
