import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, app: 'jira-regression-lab' }));
    return;
  }
  let candidate = resolve(root, pathname === '/' ? 'index.html' : `.${decodeURIComponent(pathname)}`);
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
