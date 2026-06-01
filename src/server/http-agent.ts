/**
 * Configura TLS y proxy para el servidor HTTP.
 *
 * Variables de entorno:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0   — Deshabilita validación SSL (fix para cert corporativo vencido)
 *   NODE_EXTRA_CA_CERTS=<ruta>       — Ruta al certificado CA corporativo (solución correcta a largo plazo)
 *   HTTPS_PROXY / HTTP_PROXY         — URL del proxy corporativo si aplica
 */
export async function setupHttpAgent(): Promise<void> {
  const rejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  if (rejectUnauthorized === "0") {
    // undici (fetch nativo) no lee NODE_TLS_REJECT_UNAUTHORIZED automáticamente en todos los entornos,
    // pero sí lo lee si se configura antes del primer request. Lo forzamos aquí.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    console.warn("[http-agent] ⚠  SSL verification DISABLED (NODE_TLS_REJECT_UNAUTHORIZED=0)");
    console.warn("[http-agent]    Solución correcta: agrega NODE_EXTRA_CA_CERTS=<ruta-al-cert-corporativo.pem>");
  }
}

export function logNetworkConfig(): void {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const tls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const extraCa = process.env.NODE_EXTRA_CA_CERTS;
  console.log(`[http-agent] TLS verify  : ${tls === "0" ? "⚠  DESHABILITADO" : "habilitado"}`);
  if (extraCa) console.log(`[http-agent] CA extra    : ${extraCa}`);
  if (proxy) console.log(`[http-agent] Proxy       : ${proxy}`);
}
