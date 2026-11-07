import { request } from 'playwright';
import { withPortalSession } from './data-cedulas-reuse';

export type LexisResult = 'clear' | 'match' | 'unavailable';

export function classifyPortalLexisResponse(value: unknown, identification: string): LexisResult {
  let body: any;
  try { body = typeof value === 'string' ? JSON.parse(value) : value; } catch { return 'unavailable'; }
  const results = body?.searchResults;
  if (String(body?.retCode) !== '0' || !results || !Array.isArray(results.records)) return 'unavailable';
  if (String(results.clientReference ?? '').replace(/\D/g, '') !== identification.replace(/\D/g, '')) return 'unavailable';
  return results.records.length ? 'match' : 'clear';
}

export function buildPortalLexisPayload(customer: Record<string, unknown>) {
  const join = (...values: unknown[]) => values.map(v => String(v ?? '').trim()).filter(Boolean).join(' ');
  const sex = String(customer.Sexo ?? '').trim().toUpperCase();
  const genero = ['M', 'MASCULINO'].includes(sex) ? 'Masculino'
    : ['F', 'FEMENINO'].includes(sex) ? 'Femenino' : undefined;
  const payload = {
    clientReference: String(customer.Cedula ?? '').replace(/\D/g, ''),
    firstName: join(customer.PrimerNombre, customer.SegundoNombre),
    lastName: join(customer.PrimerApellido, customer.SegundoApellido),
    genero,
    pais: String(customer.Nacionalidad ?? '').trim().toUpperCase() === 'DOMINICANA'
      ? 'Republica Dominicana' : String(customer.Nacionalidad ?? '').trim(),
    title: 'Unset', identificationType: 'Cedula', tipoCliente: 'PersonaFisica',
  };
  if (!/^\d{11}$/.test(payload.clientReference) || !payload.firstName || !payload.lastName || !genero || !payload.pais) return null;
  return payload;
}

export async function screenPortalLexis(customer: Record<string, unknown>, database: string): Promise<LexisResult> {
  const endpoint = process.env.DATA_CEDULAS_LEXIS_PORTAL_URL;
  // A portal is bound to its own environment; never screen QA2 against QA1.
  if (!endpoint || process.env.DATA_CEDULAS_LEXIS_PORTAL_DATABASE?.toUpperCase() !== database.toUpperCase()) return 'unavailable';
  let url: URL;
  try { url = new URL(endpoint); } catch { return 'unavailable'; }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) return 'unavailable';
  const payload = buildPortalLexisPayload(customer);
  if (!payload) {
    console.warn('[data-cedulas][lexis-portal] payload_incomplete (cédula, nombre, apellido, sexo o nacionalidad faltan)');
    return 'unavailable';
  }
  const headers: Record<string, string> = {};
  const authorization = process.env.DATA_CEDULAS_LEXIS_PORTAL_AUTHORIZATION || process.env.PORTAL_COMERCIAL_QA_API_AUTHORIZATION;
  const cookie = process.env.DATA_CEDULAS_LEXIS_PORTAL_COOKIE || process.env.PORTAL_COMERCIAL_QA_API_COOKIE;
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  // No static token: sign in with the configured Lexis Portal user (the session is cached), so the
  // screening does not stop when a pasted token expires.
  const username = process.env.DATA_CEDULAS_LEXIS_PORTAL_USERNAME?.trim();
  const password = process.env.DATA_CEDULAS_LEXIS_PORTAL_PASSWORD;
  if (!authorization && !cookie && username && password) {
    try {
      const response = await withPortalSession({ baseUrl: url.origin, username, password }, (http) => http('POST', url.pathname + url.search, { body: payload }));
      if (response.status !== 200) {
        console.warn(`[data-cedulas][lexis-portal] status=${response.status}`);
        return 'unavailable';
      }
      const verdict = classifyPortalLexisResponse(response.body, payload.clientReference);
      if (verdict === 'unavailable') console.warn(`[data-cedulas][lexis-portal] unexpected_response retCode=${String(response.body?.retCode)} hasRecords=${Array.isArray(response.body?.searchResults?.records)}`);
      return verdict;
    } catch {
      console.warn('[data-cedulas][lexis-portal] session_request_failed');
      return 'unavailable';
    }
  }
  const configuredTimeout = Number(process.env.DATA_CEDULAS_LEXIS_TIMEOUT_MS || 5000);
  const client = await request.newContext({
    ignoreHTTPSErrors: process.env.DATA_CEDULAS_LEXIS_PORTAL_IGNORE_HTTPS_ERRORS === 'true',
    timeout: Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 5000,
    extraHTTPHeaders: headers,
  });
  try {
    const response = await client.post(url.href, { data: payload, maxRedirects: 0 });
    if (response.status() !== 200) {
      console.warn(`[data-cedulas][lexis-portal] status=${response.status()}`);
      return 'unavailable';
    }
    return classifyPortalLexisResponse(await response.json(), payload.clientReference);
  } catch {
    console.warn('[data-cedulas][lexis-portal] request_failed');
    return 'unavailable';
  } finally { await client.dispose(); }
}
