// Northstar Aprobaciones (web B): aprueba las solicitudes que crea la web A. Credenciales sintéticas de demostración.
const APPROVALS_DEMO = { user: 'qa_aprobador', password: 'ApprovalDemo2026' };
const approvalsRoot = document.querySelector('#approvals');
const approvalsState = { authenticated: false, alert: '', toast: '', pending: [], search: '', confirming: null, loading: false };
const approvalsEsc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function approvalsLoad() {
  const response = await fetch('/api/requests', { headers: { 'content-type': 'application/json' } });
  const data = await response.json().catch(() => ({ requests: [] }));
  approvalsState.pending = (data.requests || []).filter((item) => item.status === 'Pendiente de aprobación');
}
function approvalsToast(message) {
  approvalsState.toast = message; approvalsRender();
  setTimeout(() => { approvalsState.toast = ''; approvalsRoot.querySelector('.toast')?.remove(); }, 2800);
}
function approvalsLogin() {
  return `<div class="login-shell"><section class="login-card"><div class="login-brand"><div class="brand-mark">N</div><strong>Northstar Aprobaciones</strong></div><h1>Acceso de aprobadores</h1><p>Ingresa con tu usuario de aprobaciones.</p>${approvalsState.alert ? `<div class="alert" role="alert">${approvalsEsc(approvalsState.alert)}</div>` : ''}<form id="approvals-login" novalidate><div class="field"><label for="approvals-user">Usuario de aprobaciones</label><input id="approvals-user" name="approvals-user" autocomplete="off"></div><div class="field"><label for="approvals-password">Contraseña de aprobaciones</label><input id="approvals-password" name="approvals-password" type="password" autocomplete="off"></div><button class="button" type="submit">Ingresar a aprobaciones</button></form></section></div>`;
}
function approvalsPage() {
  const term = approvalsState.search.trim().toLowerCase();
  const rows = approvalsState.pending.filter((item) => !term || `${item.number} ${item.subject}`.toLowerCase().includes(term));
  const body = rows.length
    ? rows.map((item) => `<tr><td>${approvalsEsc(item.number)}</td><td>${approvalsEsc(item.subject)}</td><td><span class="tag">${approvalsEsc(item.status)}</span></td><td><button class="button" data-approve="${approvalsEsc(item.number)}">Aprobar</button></td></tr>`).join('')
    : '<tr><td colspan="4">No hay solicitudes pendientes de aprobación.</td></tr>';
  const dialog = approvalsState.confirming ? `<div class="dialog-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-label="Confirmar aprobación"><h2>Confirmar aprobación</h2><p>¿Confirmas la aprobación de la solicitud <strong>${approvalsEsc(approvalsState.confirming)}</strong>?</p><div class="toolbar"><button class="button" data-confirm="yes">Confirmar aprobación</button><button class="button secondary" data-confirm="no">Cancelar</button></div></section></div>` : '';
  return `<main class="main"><header class="page-head"><div><p class="eyebrow">Northstar Aprobaciones</p><h1>Solicitudes pendientes de aprobación</h1></div><button class="button secondary" data-signout="1">Cerrar sesión</button></header><div class="card"><div class="toolbar"><div class="grow"><input class="control" aria-label="Buscar solicitud" placeholder="Número o asunto de la solicitud" value="${approvalsEsc(approvalsState.search)}" data-search="1"></div></div><div class="table-wrap"><table aria-label="Solicitudes pendientes de aprobación"><thead><tr><th>Número de solicitud</th><th>Asunto</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${body}</tbody></table></div></div></main>${dialog}${approvalsState.toast ? `<div class="toast" role="status">${approvalsEsc(approvalsState.toast)}</div>` : ''}`;
}
function approvalsRender() {
  approvalsRoot.innerHTML = approvalsState.authenticated ? approvalsPage() : approvalsLogin();
  approvalsRoot.querySelector('#approvals-login')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get('approvals-user') !== APPROVALS_DEMO.user || data.get('approvals-password') !== APPROVALS_DEMO.password) { approvalsState.alert = 'Las credenciales de aprobaciones no son válidas.'; approvalsRender(); return; }
    approvalsState.alert = ''; approvalsState.authenticated = true;
    await approvalsLoad(); approvalsRender();
  });
  approvalsRoot.querySelector('[data-search]')?.addEventListener('input', (event) => {
    approvalsState.search = event.currentTarget.value; const position = event.currentTarget.selectionStart; approvalsRender();
    const next = approvalsRoot.querySelector('[data-search]'); next?.focus(); next?.setSelectionRange(position, position);
  });
  approvalsRoot.querySelectorAll('[data-approve]').forEach((button) => button.addEventListener('click', () => { approvalsState.confirming = button.dataset.approve; approvalsRender(); }));
  approvalsRoot.querySelectorAll('[data-confirm]').forEach((button) => button.addEventListener('click', async () => {
    const number = approvalsState.confirming; approvalsState.confirming = null;
    if (button.dataset.confirm !== 'yes') { approvalsRender(); return; }
    const response = await fetch(`/api/requests/${encodeURIComponent(number)}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' } });
    await response.json().catch(() => ({}));
    await approvalsLoad();
    // La aprobación solo se informa si el servidor la confirmó.
    approvalsToast(response.ok ? 'Solicitud aprobada.' : 'No se pudo aprobar la solicitud.');
  }));
  approvalsRoot.querySelector('[data-signout]')?.addEventListener('click', () => { approvalsState.authenticated = false; approvalsState.search = ''; approvalsRender(); });
}
approvalsRender();
