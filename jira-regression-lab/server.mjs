import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

// Solicitudes de demostración compartidas entre la web A (portal) y la web B (/approvals/). Solo en memoria.
// Tipos de solicitud y documentos que exigen: `max` > 1 indica un único control de carga múltiple.
const REQUEST_TYPES = {
  basica: { label: 'Apertura básica', fields: [{ name: 'Documento de identidad', max: 1 }] },
  soporte: { label: 'Apertura con soporte', fields: [{ name: 'Documentos de soporte', max: 2, multiple: true }] },
  ampliada: { label: 'Apertura ampliada', fields: [{ name: 'Documento de identidad', max: 1 }, { name: 'Comprobante de ingresos', max: 1 }, { name: 'Comprobante de domicilio', max: 1 }] },
  corporativa: { label: 'Apertura corporativa', fields: [{ name: 'Documento de identidad', max: 1 }, { name: 'Comprobante de ingresos', max: 1 }, { name: 'Comprobante de domicilio', max: 1 }, { name: 'Acta constitutiva', max: 1 }, { name: 'Registro mercantil', max: 1 }] },
};
const requests = [];
let sequence = 0;
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = async (req) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return null; } };
const view = (item) => ({ ...item, requiredFields: REQUEST_TYPES[item.type].fields });

async function api(req, res, pathname) {
  const parts = pathname.split('/').filter(Boolean); // ['api', 'requests', number?, action?]
  if (parts[1] === 'request-types') return json(res, 200, REQUEST_TYPES);
  if (parts[1] === 'reset' && req.method === 'POST') { requests.length = 0; sequence = 0; return json(res, 200, { ok: true }); }
  if (parts[1] !== 'requests') return json(res, 404, { error: 'not_found' });
  if (parts.length === 2) {
    if (req.method === 'GET') return json(res, 200, { requests: requests.map(view) });
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !REQUEST_TYPES[body.type] || !String(body.subject || '').trim()) return json(res, 400, { error: 'invalid_request' });
      sequence += 1;
      const item = { number: `NS-REQ-${String(sequence).padStart(4, '0')}`, type: body.type, subject: String(body.subject).trim(), amount: Number(body.amount) || 0, status: 'Pendiente de aprobación', documents: [], createdAt: new Date().toISOString() };
      requests.push(item);
      return json(res, 201, view(item));
    }
  }
  const item = requests.find((entry) => entry.number === decodeURIComponent(parts[2] || ''));
  if (!item) return json(res, 404, { error: 'request_not_found' });
  if (parts.length === 3 && req.method === 'GET') return json(res, 200, view(item));
  const action = parts[3];
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (action === 'approve') {
    if (item.status !== 'Pendiente de aprobación') return json(res, 409, { error: 'not_pending', status: item.status });
    item.status = 'Aprobada'; item.approvedAt = new Date().toISOString();
    return json(res, 200, view(item));
  }
  if (action === 'documents') {
    if (item.status !== 'Aprobada') return json(res, 409, { error: 'not_approved', status: item.status });
    const body = await readBody(req);
    const fields = REQUEST_TYPES[item.type].fields;
    const incoming = Array.isArray(body?.documents) ? body.documents : null;
    if (!incoming || !incoming.length) return json(res, 400, { error: 'documents_required' });
    for (const field of fields) {
      const files = incoming.filter((doc) => doc.field === field.name);
      if (!files.length) return json(res, 400, { error: 'document_missing', field: field.name });
      if (files.length > field.max) return json(res, 400, { error: 'too_many_files', field: field.name, max: field.max });
    }
    if (incoming.some((doc) => !fields.some((field) => field.name === doc.field) || !String(doc.name || '').trim())) return json(res, 400, { error: 'invalid_document' });
    // Cada recepción se cuenta: un archivo recibido dos veces queda visible como `received: 2`.
    for (const doc of incoming) {
      const known = item.documents.find((entry) => entry.field === doc.field && entry.name === doc.name);
      if (known) known.received += 1; else item.documents.push({ field: doc.field, name: String(doc.name), size: Number(doc.size) || 0, type: String(doc.type || ''), received: 1 });
    }
    item.status = 'Documentos recibidos';
    return json(res, 200, view(item));
  }
  if (action === 'finish') {
    if (item.status !== 'Documentos recibidos') return json(res, 409, { error: 'documents_pending', status: item.status });
    item.status = 'Finalizada'; item.finishedAt = new Date().toISOString();
    return json(res, 200, view(item));
  }
  return json(res, 404, { error: 'not_found' });
}

createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, app: 'jira-regression-lab' }));
    return;
  }
  if (pathname.startsWith('/api/')) { try { await api(req, res, pathname); } catch { json(res, 500, { error: 'server_error' }); } return; }
  // Web B (aprobaciones) vive en /approvals/; el resto cae en la web A.
  const relative = pathname === '/approvals' || pathname === '/approvals/' ? '/approvals.html' : pathname;
  let candidate = resolve(root, relative === '/' ? 'index.html' : `.${decodeURIComponent(relative)}`);
  if (!candidate.startsWith(resolve(root) + sep) && candidate !== resolve(root, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    let body;
    try { body = await readFile(candidate); }
    catch { candidate = resolve(root, 'index.html'); body = await readFile(candidate); }
    res.writeHead(200, { 'content-type': types[extname(candidate)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(body);
  } catch {
    res.writeHead(500); res.end('Demo site unavailable');
  }
}).listen(port, '0.0.0.0', () => console.log(`[jira-regression-lab] listening on http://127.0.0.1:${port}`));
