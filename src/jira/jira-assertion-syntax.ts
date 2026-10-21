/** Normalize atomic visibility wording without changing its target or polarity. */
export function normalizeJiraAssertionSyntax(text: string): string {
  const unquotedVisibility = text.trim().match(/^(?:Validar|Verificar) que (?:el|la|los|las|un|una) ([^"“”]+?) (no )?(?:est[eé]|est[aá]|est[eé]n|est[aá]n) (?:visibles?|presentes?)[.]?$/i);
  if (unquotedVisibility) {
    return normalizeJiraAssertionSyntax(`Validar que ${unquotedVisibility[2] ? "no " : ""}se muestre "${unquotedVisibility[1]}"`);
  }
  // Quote only the grammatical object of an atomic visibility sentence. Keep
  // the surrounding clause and every subject qualifier; no business vocabulary
  // or assumed synonym is needed for the shared parser to identify the target.
  const scopedVisibility = text.trim().match(/^((?:Validar|Verificar) que (?:el|la|los|las) [^"“”]+? (?:muestre|muestren|muestra|muestran) (?:el|la|los|las|un|una) )([^"“”]+?)([.]?)$/i);
  if (scopedVisibility
    && !/\b(?:no|nunca|jam[aá]s|sin)\b/i.test(scopedVisibility[1])
    && !/\b(?:mayor|menor|igual|superior|inferior|cada|todos|todas)\b|[<>=]|\b(?:y|o)\s+(?:no\s+|se\s+|presionar\b|pulsar\b|hacer\b|ingresar\b|seleccionar\b)/i.test(scopedVisibility[2])) {
    return `${scopedVisibility[1]}"${scopedVisibility[2]}"${scopedVisibility[3]}`;
  }
  const quotedScreen = text.trim().match(/^(?:Validar|Verificar)\s+["“]pantalla de\s+([^"”]+)["”][.]?$/i);
  if (quotedScreen) return `Validar que se muestre "${quotedScreen[1]}"`;
  const screen = text.trim().match(/^(?:Validar|Verificar) que se (?:muestra|muestran|muestre|muestren) ["“]pantalla de\s+([^"”]+)["”][.]?$/i);
  if (screen) return `Validar que se muestre "${screen[1]}"`;
  const semanticAbsence = text.trim().match(/^(?:Validar|Verificar) que se (?:muestre|muestren) ["“](?:la\s+)?(?:ausencia de|absence of)\s+([^"”]+)["”][.]?$/i);
  if (semanticAbsence) return `Validar que no se muestre "${semanticAbsence[1]}"`;
  const absencePrefix = text.trim().match(/^(?:Validar|Verificar) que no\s+(?:est[aá]|est[eé])\s+(?:visible|presente)\s+["“]([^"”]+)["”][.]?$/i);
  if (absencePrefix) return `Validar que no se muestre "${absencePrefix[1]}"`;
  const postfix = text.trim().match(/^(?:Validar|Verificar)\s+["“]([^"”]+)["”]\s+no\s+(?:(?:est[aá]|est[eé])\s+)?(?:visible|presente|presentad[oa]s?|mostrad[oa]s?|aparecid[oa]s?)[.]?$/i);
  if (postfix) return `Validar que no se muestre "${postfix[1]}"`;
  // "la fila con <labels> ... en "<list>"" -> executor wording "la fila coincidente con <labels> ... en "<list>"". Wording only: container and labels are kept verbatim.
  // "el <a> y el <b> ... aparezcan [juntos] en una misma fila de "<list>"" -> "la fila coincidente con el <a> y el <b> ... aparezcan en "<list>"". Needs >=2 articled fields; subject words are kept verbatim so row binding sees every label word; still a row assertion, never plain visibility.
  const fieldPair = text.trim().match(/^((?:Validar|Verificar) que) ((?:el|la|los|las)\s+[^"“”]+?\s+y\s+(?:el|la|los|las)\s+[^"“”]+?)\s+(aparezcan|aparezca|figuren|figure)(?:\s+(?:juntos|juntas))?\s+en\s+(?:una|la)\s+(?:misma\s+)?fila\s+de\s+(["“][^"”]+["”])[.]?$/i);
  if (fieldPair) return `${fieldPair[1]} la fila coincidente con ${fieldPair[2]} ${fieldPair[3]} en ${fieldPair[4]}`;
  const looseRow =text.trim().match(/^((?:Validar|Verificar) que (?:la )?fila) con (\S[^"“”]*?\s+(?:aparezca|aparezcan|figure|figuren|permanezca|permanezcan|se\s+muestre|se\s+muestren)\b[^"“”]*\s+en\s+["“][^"”]+["”][.]?)$/i);
  if (looseRow) return `${looseRow[1]} coincidente con ${looseRow[2]}`;
  // Same, but the field labels are quoted ("... ingresado en "Nombre" y ... en "Alias" aparezca en "<list>""); the executor binds each quoted label to its fill.
  const quotedRow = text.trim().match(/^((?:Validar|Verificar) que (?:la )?fila) con (\S.*?\s+(?:aparezca|aparezcan|figure|figuren|permanezca|permanezcan)\b.*\s+en\s+["“][^"”]+["”][.]?)$/i);
  if (quotedRow && /["“][^"”]+["”].*["“][^"”]+["”]/.test(quotedRow[2])) return `${quotedRow[1]} coincidente con ${quotedRow[2]}`;
  const match = text.trim().match(/^(?:Validar|Verificar) que (no )?se (muestra|muestran|muestre|muestren|informa|informe)\s+(?:(?:el|la|los|las|un|una)\s+)?["“]([^"”]+)["”][.]?$/i);
  if (!match || (match[1] && /^inform/i.test(match[2]))) return text;
  return `Validar que ${match[1] ? 'no ' : ''}se muestre "${match[3]}"`;
}
