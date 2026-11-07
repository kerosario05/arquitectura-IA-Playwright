// Solicitudes (web A): crear una solicitud, continuarla cuando la web B la aprueba y adjuntar documentos.
// Se apoya en las utilidades de app.js (state, shell, pageHead, input, select, esc, root, render, toast).
const requestsView = { mode: 'list', list: [], current: null, types: null, alert: '', dialog: false, stale: true, loaded: false };
const REQUEST_FILE_TYPES = ['pdf', 'png', 'jpg', 'jpeg', 'txt'];
const REQUEST_FILE_MAX_BYTES = 5 * 1024 * 1024;

async function requestsApi(path, method = 'GET', body) {
  const response = await fetch(`/api/${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}
async function requestsRefresh() {
  const [types, list] = await Promise.all([requestsView.types ? { ok: true, data: requestsView.types } : requestsApi('request-types'), requestsApi('requests')]);
  if (types.ok) requestsView.types = types.data;
  if (list.ok) { requestsView.list = list.data.requests; requestsView.loaded = true; }
  if (requestsView.current) requestsView.current = requestsView.list.find((item) => item.number === requestsView.current.number) || requestsView.current;
}

function requestsRows() {
  if (!requestsView.list.length) return '<tr><td colspan="5">Todavía no hay solicitudes.</td></tr>';
  return requestsView.list.map((item) => {
    const action = item.status === 'Pendiente de aprobación'
      ? '<button class="button secondary" disabled>Esperando aprobación</button>'
      : `<button class="button secondary" data-req="open" data-number="${esc(item.number)}">${item.status === 'Finalizada' ? 'Ver' : 'Continuar'}</button>`;
    return `<tr><td>${esc(item.number)}</td><td>${esc(requestsView.types?.[item.type]?.label || item.type)}</td><td>${esc(item.subject)}</td><td><span class="tag">${esc(item.status)}</span></td><td>${action}</td></tr>`;
  }).join('');
}
function requestsDocuments(item) {
  if (!item.documents.length) return '<p class="helper">Todavía no hay documentos adjuntos.</p>';
  return `<ul aria-label="Documentos recibidos">${item.documents.map((doc) => `<li><strong>${esc(doc.field)}</strong>: ${esc(doc.name)}</li>`).join('')}</ul>`;
}
function requestsDialog(item) {
  const fields = item.requiredFields.map((field, index) => `<div class="field"><label for="request-doc-${index}">${esc(field.name)}</label><input id="request-doc-${index}" name="request-doc-${index}" type="file" data-doc-field="${esc(field.name)}" data-doc-max="${field.max}" accept=".pdf,.png,.jpg,.jpeg,.txt" ${field.multiple ? 'multiple' : ''}>${field.multiple ? `<span class="helper">Puedes seleccionar hasta ${field.max} archivos.</span>` : ''}</div>`).join('');
  return `<div class="dialog-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-label="Adjuntar documentos"><h2>Adjuntar documentos</h2><p class="helper">Solicitud ${esc(item.number)}. Formatos permitidos: PDF, PNG, JPG y TXT (máximo 5 MB).</p>${requestsView.alert ? `<div class="alert" role="alert">${esc(requestsView.alert)}</div>` : ''}<form id="request-docs-form" novalidate>${fields}<div class="toolbar"><button class="button" type="submit">Guardar documentos</button><button class="button secondary" type="button" data-req="close-dialog">Cancelar</button></div></form></section></div>`;
}

function requestsPage() {
  if (requestsView.stale) { requestsView.stale = false; requestsRefresh().then(() => { if (state.page === 'requests') render(); }); }
  const back = '<button class="button secondary" data-req="back">Volver a solicitudes</button>';
  let content;
  if (requestsView.mode === 'new') {
    const types = Object.entries(requestsView.types || {}).map(([key, value]) => [key, value.label]);
    content = `${pageHead('Solicitudes', 'Nueva solicitud', 'Registra una solicitud para aprobación.', '')}<div class="card" style="max-width:640px">${requestsView.alert ? `<div class="alert" role="alert">${esc(requestsView.alert)}</div>` : ''}<form id="request-form" novalidate>${select('Tipo de solicitud', 'request-type', types)}${input('Asunto', 'request-subject', '')}${input('Monto', 'request-amount', '', 'number', 'min="0"')}<div class="toolbar"><button class="button" type="submit">Crear solicitud</button><button class="button secondary" type="button" data-req="back">Cancelar</button></div></form></div>`;
  } else if (requestsView.mode === 'created' && requestsView.current) {
    const item = requestsView.current;
    content = `${pageHead('Solicitudes', 'Solicitud creada', 'La solicitud quedó registrada.', '')}<div class="card" style="max-width:640px"><div class="receipt-mark" aria-label="Solicitud creada">✓</div><dl class="request-meta"><dt>Número de solicitud</dt><dd id="request-number">${esc(item.number)}</dd></dl><p role="status" class="helper">Estado: ${esc(item.status)}</p><div class="toolbar">${back}</div></div>`;
  } else if (requestsView.mode === 'detail' && requestsView.current) {
    const item = requestsView.current;
    const actions = [item.status === 'Aprobada' ? '<button class="button" data-req="attach">Adjuntar documentos</button>' : '', item.status === 'Documentos recibidos' ? '<button class="button" data-req="finish">Finalizar solicitud</button>' : '', back].join('');
    content = `${pageHead('Solicitudes', 'Detalle de la solicitud', requestsView.types?.[item.type]?.label || '', '')}<div class="card" style="max-width:720px"><dl class="request-meta"><dt>Número de solicitud</dt><dd id="request-number">${esc(item.number)}</dd><dt>Asunto</dt><dd>${esc(item.subject)}</dd><dt>Estado</dt><dd>${esc(item.status)}</dd></dl>${item.status === 'Finalizada' ? '<p role="status" class="helper">Solicitud finalizada</p>' : ''}<div class="section-title"><h2>Documentos</h2></div>${requestsDocuments(item)}${requestsView.alert && !requestsView.dialog ? `<div class="alert" role="alert">${esc(requestsView.alert)}</div>` : ''}<div class="toolbar">${actions}</div></div>${requestsView.dialog ? requestsDialog(item) : ''}`;
  } else {
    content = `${pageHead('Operaciones', 'Solicitudes', 'Crea solicitudes y continúalas cuando estén aprobadas.', '<button class="button" data-req="new">Nueva solicitud</button>')}<div class="card"><div class="table-wrap"><table aria-label="Solicitudes"><thead><tr><th>Número de solicitud</th><th>Tipo</th><th>Asunto</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${requestsRows()}</tbody></table></div></div>`;
  }
  return shell(content, 'Solicitudes');
}

function requestsGo(mode, patch = {}) { Object.assign(requestsView, { mode, alert: '', dialog: false, ...patch }); render(); }
function bindRequests() {
  if (state.page !== 'requests') { requestsView.stale = true; requestsView.mode = 'list'; requestsView.dialog = false; return; }
  root.querySelectorAll('[data-req]').forEach((button) => button.addEventListener('click', async (event) => {
    event.preventDefault();
    const action = button.dataset.req;
    if (action === 'new') requestsGo('new');
    else if (action === 'back') { requestsView.stale = true; requestsGo('list', { current: null }); }
    else if (action === 'open') { requestsGo('detail', { current: requestsView.list.find((item) => item.number === button.dataset.number) }); }
    else if (action === 'attach') { requestsView.alert = ''; requestsView.dialog = true; render(); }
    else if (action === 'close-dialog') { requestsView.alert = ''; requestsView.dialog = false; render(); }
    else if (action === 'finish') {
      const result = await requestsApi(`requests/${encodeURIComponent(requestsView.current.number)}/finish`, 'POST');
      if (result.ok) { requestsView.current = result.data; requestsView.alert = ''; } else requestsView.alert = 'No se pudo finalizar la solicitud. Intenta nuevamente.';
      render();
    }
  }));
  root.querySelector('#request-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!String(data.get('request-subject') || '').trim()) { requestsView.alert = 'Escribe el asunto de la solicitud.'; render(); return; }
    const result = await requestsApi('requests', 'POST', { type: data.get('request-type'), subject: data.get('request-subject'), amount: data.get('request-amount') });
    if (!result.ok) { requestsView.alert = 'No se pudo crear la solicitud.'; render(); return; }
    requestsView.stale = true;
    requestsGo('created', { current: result.data });
  });
  root.querySelector('#request-docs-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const documents = [];
    for (const inputEl of event.currentTarget.querySelectorAll('input[type="file"]')) {
      const name = inputEl.dataset.docField; const max = Number(inputEl.dataset.docMax); const files = Array.from(inputEl.files || []);
      if (!files.length) { requestsView.alert = `Adjunta el documento "${name}".`; render(); return; }
      if (files.length > max) { requestsView.alert = `Selecciona máximo ${max} archivo(s) en "${name}".`; render(); return; }
      for (const file of files) {
        const extension = file.name.split('.').pop().toLowerCase();
        if (!REQUEST_FILE_TYPES.includes(extension) || file.size > REQUEST_FILE_MAX_BYTES) { requestsView.alert = `El archivo "${file.name}" no es válido para "${name}".`; render(); return; }
        documents.push({ field: name, name: file.name, size: file.size, type: file.type });
      }
    }
    const result = await requestsApi(`requests/${encodeURIComponent(requestsView.current.number)}/documents`, 'POST', { documents });
    if (!result.ok) { requestsView.alert = 'No se pudieron guardar los documentos. Revisa los archivos e intenta nuevamente.'; render(); return; }
    requestsView.current = result.data; requestsView.alert = ''; requestsView.dialog = false; requestsView.stale = true;
    render();
  });
}
