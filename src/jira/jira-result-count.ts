const fold = (value: string): string => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");

/** Assertion that only requires a visible result-count indicator ("indicador de cantidad de resultados"). */
export function isJiraResultCountAssertion(expected: string): boolean {
  const text = fold(expected);
  return /\b(?:resultados?|results?)\b/.test(text)
    && /\b(?:indicador|contador|conteo|cantidad|total|count|counter|indicator)\b/.test(text)
    && !/\b(?:sin|no|ningun|ninguna|vacio|vacia|empty|without|0|cero)\b/.test(text);
}

/** Compact visible count label such as "1 resultados" or "12 results"; prose containing it does not qualify. */
export function isJiraResultCountText(observed: string): boolean {
  return /^\d+\s+(?:resultados?|results?)$/.test(fold(observed).replace(/\s+/g, " ").trim());
}
