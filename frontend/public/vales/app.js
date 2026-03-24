/* ══════════════════════════════════════════════════════════════════════════════
   MÓDULO VALES DE ADICIÓN — SPA vanilla JS
   ══════════════════════════════════════════════════════════════════════════════ */

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  user: null,
  token: null,
  section: 'dashboard',
  // Cachés
  items: [],
  tanques: [],
  lineas: [],
  inventario: [],
  // Formulario crear vale
  valeDetalle: [],
  // Inactividad
  _actTimer: null
};

// ── Menú por rol ──────────────────────────────────────────────────────────────
const MENU = {
  consulta: [
    ['consulta-vales', '📋', 'Consulta Vales'],
    ['inventario',     '📦', 'Inventario'],
    ['kardex',         '📜', 'Kardex']
  ],
  operador: [
    ['crear-vale',         '➕', 'Crear Vale'],
    ['consulta-vales',     '📋', 'Consulta Vales'],
    ['correcciones',       '🔧', 'Correcciones'],
    ['entrada-inventario', '📥', 'Recepción'],
    ['inventario',         '📦', 'Inventario'],
    ['kardex',             '📜', 'Kardex']
  ],
  admin: [
    ['crear-vale',         '➕', 'Crear Vale'],
    ['consulta-vales',     '📋', 'Consulta Vales'],
    ['correcciones',       '🔧', 'Correcciones'],
    ['entrada-inventario', '📥', 'Recepción'],
    ['inventario',         '📦', 'Inventario'],
    ['kardex',             '📜', 'Kardex'],
    ['---', '', 'Catálogos'],
    ['items',    '🧪', 'Productos'],
    ['tanques',  '🏭', 'Tanques'],
    ['usuarios', '👤', 'Usuarios']
  ]
};

const SECTION_TITLES = {
  'dashboard':         'Inicio',
  'crear-vale':        'Crear Vale',
  'consulta-vales':    'Consulta de Vales',
  'correcciones':      'Correcciones',
  'entrada-inventario':'Recepción de Material',
  'inventario':        'Inventario Actual',
  'kardex':            'Kardex',
  'items':             'Catálogo de Productos',
  'tanques':           'Catálogo de Tanques',
  'usuarios':          'Gestión de Usuarios'
};

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch('/api/vales' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
const GET  = (p)    => api('GET',    p);
const POST = (p, b) => api('POST',   p, b);
const PUT  = (p, b) => api('PUT',    p, b);
const PATCH= (p, b) => api('PATCH',  p, b);

// ── Inactividad (15 min) ──────────────────────────────────────────────────────
function resetTimer() {
  clearTimeout(state._actTimer);
  state._actTimer = setTimeout(() => { logout(); }, 15 * 60 * 1000);
}
document.addEventListener('mousemove', resetTimer);
document.addEventListener('keydown', resetTimer);

// ── Auth ──────────────────────────────────────────────────────────────────────
function tryRestore() {
  const t = localStorage.getItem('vales_token');
  const u = localStorage.getItem('vales_user');
  if (t && u) { state.token = t; state.user = JSON.parse(u); return true; }
  return false;
}
function saveSession(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem('vales_token', token);
  localStorage.setItem('vales_user', JSON.stringify(user));
}
function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem('vales_token');
  localStorage.removeItem('vales_user');
  render();
}

// ── Navegación ────────────────────────────────────────────────────────────────
function navigate(section) {
  state.section = section;
  renderMain();
}

// ── Render raíz ───────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!state.user) { app.innerHTML = renderLogin(); bindLogin(); return; }
  app.innerHTML = renderLayout();
  bindNav();
  renderMain();
  resetTimer();
}

// ── Login ─────────────────────────────────────────────────────────────────────
function renderLogin() {
  return `
  <div class="vales-login">
    <div class="login-card">
      <div class="login-logo">
        <div class="icon">📋</div>
        <h1>Registros de Calidad</h1>
        <p>Vales de Adición · Control de insumos</p>
      </div>
      <label>Correo electrónico</label>
      <input type="email" id="l-email" placeholder="usuario@empresa.com" />
      <label>Contraseña</label>
      <input type="password" id="l-pass" placeholder="••••••••" />
      <button class="btn-login" id="btn-login">Ingresar</button>
      <p class="login-error" id="login-err"></p>
    </div>
  </div>`;
}
function bindLogin() {
  const btn = document.getElementById('btn-login');
  const doLogin = async () => {
    const email = document.getElementById('l-email').value.trim();
    const pass  = document.getElementById('l-pass').value;
    const err   = document.getElementById('login-err');
    btn.disabled = true; btn.textContent = 'Verificando...';
    try {
      const res = await fetch('/api/vales/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass })
      });
      const data = await res.json();
      if (!res.ok) { err.textContent = data.error || 'Error al iniciar sesión'; btn.disabled = false; btn.textContent = 'Ingresar'; return; }
      saveSession(data.token, data.user);
      render();
    } catch(e) { err.textContent = 'Error de red'; btn.disabled = false; btn.textContent = 'Ingresar'; }
  };
  btn.addEventListener('click', doLogin);
  document.getElementById('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

// ── Layout (sidebar + main) ───────────────────────────────────────────────────
function renderLayout() {
  const role = state.user.vales_role;
  const menuItems = MENU[role] || [];
  const menuHtml = menuItems.map(([id, icon, label]) => {
    if (id === '---') return `<div class="v-nav-group">${label}</div>`;
    return `<div class="v-nav-item${state.section === id ? ' active' : ''}" data-nav="${id}">${icon} ${label}</div>`;
  }).join('');

  const roleBadge = { admin: 'badge-admin', operador: 'badge-operador', consulta: 'badge-consulta' }[role] || 'badge-sin';

  return `
  <div class="vales-layout">
    <nav class="v-sidebar">
      <div class="v-sidebar-brand">
        <div class="s-icon">📋</div>
        <div>
          <div class="s-title">Registros de Calidad</div>
          <div class="s-sub">Vales de Adición</div>
        </div>
      </div>
      <div class="v-nav">${menuHtml}</div>
      <div class="v-sidebar-footer">
        <div class="v-user-info">
          <strong>${state.user.full_name}</strong>
          <span class="badge-role ${roleBadge}">${role}</span>
        </div>
        <button class="btn-logout" id="btn-logout">Cerrar sesión</button>
      </div>
    </nav>
    <div class="v-main">
      <div class="v-topbar">
        <h2 id="topbar-title">${SECTION_TITLES[state.section] || ''}</h2>
      </div>
      <div class="v-content" id="v-content"></div>
    </div>
  </div>`;
}
function bindNav() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });
  document.getElementById('btn-logout')?.addEventListener('click', logout);
}

// ── Render sección actual ─────────────────────────────────────────────────────
async function renderMain() {
  const el = document.getElementById('v-content');
  const title = document.getElementById('topbar-title');
  if (!el) return;
  if (title) title.textContent = SECTION_TITLES[state.section] || '';
  document.querySelectorAll('[data-nav]').forEach(n => {
    n.classList.toggle('active', n.dataset.nav === state.section);
  });
  el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div>';
  try {
    switch (state.section) {
      case 'dashboard':         el.innerHTML = await viewDashboard(); break;
      case 'crear-vale':        el.innerHTML = viewCrearVale(); bindCrearVale(); return;
      case 'consulta-vales':    el.innerHTML = await viewConsultaVales(); bindConsultaVales(); return;
      case 'correcciones':      el.innerHTML = await viewCorrecciones(); bindCorrecciones(); return;
      case 'entrada-inventario':el.innerHTML = viewEntradaInventario(); bindEntradaInventario(); return;
      case 'inventario':        el.innerHTML = await viewInventario(); bindInventario(); return;
      case 'kardex':            el.innerHTML = await viewKardex(); bindKardex(); return;
      case 'items':             el.innerHTML = await viewItems(); bindItems(); return;
      case 'tanques':           el.innerHTML = await viewTanques(); bindTanques(); return;
      case 'usuarios':          el.innerHTML = await viewUsuarios(); bindUsuarios(); return;
      default: el.innerHTML = '<p>Sección no encontrada</p>';
    }
  } catch(e) {
    el.innerHTML = `<div class="alert alert-warn">⚠️ Error al cargar: ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTAS
// ══════════════════════════════════════════════════════════════════════════════

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function viewDashboard() {
  const [vales, inv, corr] = await Promise.all([
    GET('/vales?fecha_ini=' + today()),
    GET('/inventario'),
    GET('/correcciones')
  ]);
  const hoy = vales.length;
  const totalKg = vales.reduce((s, v) => s + (v.detalle || []).reduce((ss, d) => ss + (d.kg_equivalentes || 0), 0), 0);
  const items = inv.length;
  const corrHoy = corr.filter(c => c.created_at?.slice(0,10) === today()).length;

  return `
  <div class="stat-grid">
    <div class="stat-card">
      <div class="stat-icon" style="background:#fef3c7">📋</div>
      <div><div class="stat-value">${hoy}</div><div class="stat-label">Vales hoy</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:#dcfce7">⚖️</div>
      <div><div class="stat-value">${totalKg.toFixed(1)}</div><div class="stat-label">kg despachados hoy</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:#dbeafe">🧪</div>
      <div><div class="stat-value">${items}</div><div class="stat-label">Productos en inventario</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:#f3e8ff">🔧</div>
      <div><div class="stat-value">${corrHoy}</div><div class="stat-label">Correcciones hoy</div></div>
    </div>
  </div>
  <div class="table-card">
    <div class="table-header"><h3>Últimos vales de hoy</h3></div>
    <div class="table-scroll">
      ${hoy === 0 ? '<div class="empty-state"><div class="icon">📋</div><p>Sin vales registrados hoy</p></div>' : `
      <table>
        <thead><tr><th>Folio</th><th>Hora</th><th>Línea</th><th>Turno</th><th>Solicita</th><th>Items</th><th>kg total</th></tr></thead>
        <tbody>${vales.slice(0, 15).map(v => {
          const kgTotal = (v.detalle || []).reduce((s, d) => s + (d.kg_equivalentes || 0), 0);
          return `<tr>
            <td class="mono">${v.folio_vale}</td>
            <td>${v.hora || '-'}</td>
            <td>${v.linea}</td>
            <td>${v.turno || '-'}</td>
            <td>${v.solicita || '-'}</td>
            <td>${(v.detalle || []).length}</td>
            <td class="kg-value">${kgTotal.toFixed(3)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`}
    </div>
  </div>`;
}

// ── Crear Vale ────────────────────────────────────────────────────────────────
function viewCrearVale() {
  state.valeDetalle = [];
  return `
  <div class="form-card">
    <h3>📋 Encabezado del vale</h3>
    <div class="form-grid">
      <div class="form-group"><label>Línea *</label><select id="v-linea"><option value="">-- Seleccionar --</option></select></div>
      <div class="form-group"><label>Turno</label>
        <select id="v-turno"><option value="">--</option><option>1</option><option>2</option><option>3</option></select>
      </div>
      <div class="form-group"><label>Fecha</label><input type="date" id="v-fecha" value="${today()}" /></div>
      <div class="form-group"><label>Hora</label><input type="time" id="v-hora" value="${nowTime()}" /></div>
      <div class="form-group"><label>Solicita</label><input type="text" id="v-solicita" placeholder="Nombre" /></div>
      <div class="form-group"><label>Adiciona</label><input type="text" id="v-adiciona" placeholder="Nombre" /></div>
      <div class="form-group"><label>Coordinador</label><input type="text" id="v-coord" placeholder="Nombre" /></div>
      <div class="form-group full"><label>Comentarios</label><input type="text" id="v-comentarios" placeholder="Observaciones opcionales" /></div>
    </div>
  </div>

  <div class="form-card">
    <h3>🧪 Agregar detalle</h3>
    <div class="form-row">
      <div class="form-group"><label>Tanque</label><select id="v-tanque"><option value="">-- Seleccionar línea primero --</option></select></div>
      <div class="form-group"><label>Producto</label><select id="v-item"><option value="">-- Seleccionar tanque primero --</option></select></div>
      <div class="form-group"><label>Tipo adición</label><select id="v-tipo"><option value="">--</option></select></div>
      <div class="form-group"><label>Cantidad</label><input type="number" id="v-cantidad" step="0.001" min="0" placeholder="0.000" style="width:110px" /></div>
      <div class="form-group"><label>Titulación</label><input type="text" id="v-tit" placeholder="Opcional" style="width:100px" /></div>
      <div class="form-group"><label>&nbsp;</label>
        <button class="btn btn-primary" id="btn-add-det">+ Agregar</button>
      </div>
    </div>
    <div id="kg-preview" style="font-size:12px;color:#d97706;margin-bottom:8px;"></div>
    <div id="detalle-lista"></div>
  </div>

  <div style="display:flex;gap:10px;justify-content:flex-end">
    <button class="btn btn-outline" onclick="navigate('consulta-vales')">Cancelar</button>
    <button class="btn btn-primary" id="btn-guardar-vale">💾 Guardar Vale</button>
  </div>`;
}

function bindCrearVale() {
  // Load líneas
  GET('/lineas').then(lineas => {
    const sel = document.getElementById('v-linea');
    lineas.forEach(l => sel.add(new Option(l, l)));
  }).catch(() => {});

  // Línea → Tanques
  document.getElementById('v-linea').addEventListener('change', async function() {
    const linea = this.value;
    const selTanque = document.getElementById('v-tanque');
    const selItem = document.getElementById('v-item');
    const selTipo = document.getElementById('v-tipo');
    selTanque.innerHTML = '<option value="">-- Seleccionar --</option>';
    selItem.innerHTML = '<option value="">--</option>';
    selTipo.innerHTML = '<option value="">--</option>';
    if (!linea) return;
    const tanques = await GET('/tanques?linea=' + encodeURIComponent(linea));
    tanques.filter(t => t.activo).forEach(t => {
      selTanque.add(new Option(`${t.no_tanque} - ${t.nombre_tanque}`, JSON.stringify(t)));
    });
  });

  // Tanque → Items
  document.getElementById('v-tanque').addEventListener('change', async function() {
    const selItem = document.getElementById('v-item');
    const selTipo = document.getElementById('v-tipo');
    selItem.innerHTML = '<option value="">-- Seleccionar --</option>';
    selTipo.innerHTML = '<option value="">--</option>';
    if (!this.value) return;
    const tanque = JSON.parse(this.value);
    const allItems = await GET('/items?vigente=true');
    const autorizados = tanque.items_autorizados || [];
    const items = autorizados.length > 0
      ? allItems.filter(i => autorizados.includes(i.item))
      : allItems;
    items.forEach(i => selItem.add(new Option(`${i.item} — ${i.presentacion}`, JSON.stringify(i))));
  });

  // Item → Tipos de adición
  document.getElementById('v-item').addEventListener('change', async function() {
    const selTipo = document.getElementById('v-tipo');
    selTipo.innerHTML = '<option value="">--</option>';
    document.getElementById('kg-preview').textContent = '';
    if (!this.value) return;
    const item = JSON.parse(this.value);
    const adiciones = await GET('/item-adiciones/' + item.id);
    if (adiciones.length > 0) {
      adiciones.filter(a => a.activo).forEach(a => selTipo.add(new Option(a.tipo_adicion, a.tipo_adicion)));
    } else {
      // Default: todos los tipos disponibles según propiedades del item
      const tipos = ['KG'];
      if (item.peso_kg > 0) tipos.push('TAMBO');
      if (item.densidad > 0) { tipos.push('PORRON_15L'); tipos.push('LITRO'); }
      tipos.forEach(t => selTipo.add(new Option(t, t)));
    }
  });

  // Preview kg
  const previewKg = () => {
    const itemVal = document.getElementById('v-item').value;
    const tipo    = document.getElementById('v-tipo').value;
    const cant    = parseFloat(document.getElementById('v-cantidad').value) || 0;
    if (!itemVal || !tipo || cant <= 0) { document.getElementById('kg-preview').textContent = ''; return; }
    const item = JSON.parse(itemVal);
    const kg = calcKgFront(tipo, cant, item);
    document.getElementById('kg-preview').textContent = `≈ ${kg.toFixed(3)} kg equivalentes`;
  };
  document.getElementById('v-tipo').addEventListener('change', previewKg);
  document.getElementById('v-cantidad').addEventListener('input', previewKg);

  // Agregar detalle
  document.getElementById('btn-add-det').addEventListener('click', () => {
    const tanqueVal = document.getElementById('v-tanque').value;
    const itemVal   = document.getElementById('v-item').value;
    const tipo      = document.getElementById('v-tipo').value;
    const cant      = parseFloat(document.getElementById('v-cantidad').value);
    const tit       = document.getElementById('v-tit').value.trim();
    if (!tanqueVal || !itemVal || !tipo || !cant || cant <= 0) {
      alert('Completa: tanque, producto, tipo de adición y cantidad'); return;
    }
    const tanque = JSON.parse(tanqueVal);
    const item   = JSON.parse(itemVal);
    const kg     = calcKgFront(tipo, cant, item);
    state.valeDetalle.push({ no_tanque: tanque.no_tanque, nombre_tanque: tanque.nombre_tanque, item: item.item, presentacion: item.presentacion, tipo_adicion: tipo, cantidad: cant, kg_equivalentes: kg, titulacion: tit });
    renderDetalleLista();
    document.getElementById('v-cantidad').value = '';
    document.getElementById('v-tit').value = '';
    document.getElementById('kg-preview').textContent = '';
  });

  // Guardar
  document.getElementById('btn-guardar-vale').addEventListener('click', guardarVale);
}

function renderDetalleLista() {
  const el = document.getElementById('detalle-lista');
  if (!el) return;
  if (state.valeDetalle.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = `
  <table class="detail-table">
    <thead><tr><th>Tanque</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>kg equiv.</th><th>Titulación</th><th></th></tr></thead>
    <tbody>${state.valeDetalle.map((d, i) => `
      <tr>
        <td>${d.no_tanque} <small>${d.nombre_tanque}</small></td>
        <td>${d.item} <small>${d.presentacion}</small></td>
        <td>${d.tipo_adicion}</td>
        <td>${d.cantidad}</td>
        <td class="kg-value">${d.kg_equivalentes.toFixed(3)}</td>
        <td>${d.titulacion || '-'}</td>
        <td><button class="btn btn-danger btn-xs" onclick="removeDetalle(${i})">✕</button></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}
window.removeDetalle = function(i) { state.valeDetalle.splice(i, 1); renderDetalleLista(); };

async function guardarVale() {
  const linea = document.getElementById('v-linea').value;
  if (!linea) { alert('Selecciona una línea'); return; }
  if (state.valeDetalle.length === 0) { alert('Agrega al menos un producto al detalle'); return; }
  const body = {
    linea,
    turno:       document.getElementById('v-turno').value,
    fecha:       document.getElementById('v-fecha').value,
    hora:        document.getElementById('v-hora').value,
    solicita:    document.getElementById('v-solicita').value.trim(),
    adiciona:    document.getElementById('v-adiciona').value.trim(),
    coordinador: document.getElementById('v-coord').value.trim(),
    comentarios: document.getElementById('v-comentarios').value.trim(),
    detalle: state.valeDetalle.map(d => ({
      no_tanque: d.no_tanque, nombre_tanque: d.nombre_tanque,
      item: d.item, tipo_adicion: d.tipo_adicion,
      cantidad: d.cantidad, titulacion: d.titulacion
    }))
  };
  const btn = document.getElementById('btn-guardar-vale');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    const vale = await POST('/vales', body);
    alert(`✅ Vale guardado: ${vale.folio_vale}`);
    state.valeDetalle = [];
    navigate('consulta-vales');
  } catch(e) {
    alert('Error: ' + e.message);
    btn.disabled = false; btn.textContent = '💾 Guardar Vale';
  }
}

// ── Consulta Vales ────────────────────────────────────────────────────────────
async function viewConsultaVales() {
  const lineas = await GET('/lineas').catch(() => []);
  const ini = monthStart();
  const fin = today();
  let html = `
  <div class="filters-bar">
    <div><label style="font-size:12px;font-weight:600;color:#78716c">Desde</label><br><input type="date" id="f-ini" value="${ini}" /></div>
    <div><label style="font-size:12px;font-weight:600;color:#78716c">Hasta</label><br><input type="date" id="f-fin" value="${fin}" /></div>
    <div><label style="font-size:12px;font-weight:600;color:#78716c">Folio</label><br><input type="text" id="f-folio" placeholder="VA-..." style="width:150px" /></div>
    <div><label style="font-size:12px;font-weight:600;color:#78716c">Línea</label><br>
      <select id="f-linea"><option value="">Todas</option>${lineas.map(l => `<option>${l}</option>`).join('')}</select>
    </div>
    <div style="align-self:flex-end"><button class="btn btn-primary" id="btn-buscar">🔍 Buscar</button></div>
  </div>
  <div id="vales-result"></div>`;
  return html;
}
function bindConsultaVales() {
  const buscar = async () => {
    const ini   = document.getElementById('f-ini').value;
    const fin   = document.getElementById('f-fin').value;
    const folio = document.getElementById('f-folio').value.trim();
    const linea = document.getElementById('f-linea').value;
    let q = '?';
    if (ini)   q += `fecha_ini=${ini}&`;
    if (fin)   q += `fecha_fin=${fin}&`;
    if (folio) q += `folio=${encodeURIComponent(folio)}&`;
    if (linea) q += `linea=${encodeURIComponent(linea)}&`;
    const el = document.getElementById('vales-result');
    el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Buscando...</p></div>';
    try {
      const vales = await GET('/vales' + q);
      if (vales.length === 0) { el.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>Sin resultados</p></div>'; return; }
      el.innerHTML = `
      <div class="table-card">
        <div class="table-header"><h3>${vales.length} vale(s)</h3></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Folio</th><th>Fecha</th><th>Hora</th><th>Turno</th><th>Línea</th><th>Solicita</th><th>Items</th><th>kg total</th><th></th></tr></thead>
            <tbody>${vales.map(v => {
              const kgT = (v.detalle || []).reduce((s, d) => s + (d.kg_equivalentes || 0), 0);
              return `<tr>
                <td class="mono">${v.folio_vale}</td>
                <td>${v.fecha}</td><td>${v.hora||'-'}</td><td>${v.turno||'-'}</td>
                <td>${v.linea}</td><td>${v.solicita||'-'}</td>
                <td>${(v.detalle||[]).length}</td>
                <td class="kg-value">${kgT.toFixed(3)}</td>
                <td><button class="btn btn-outline btn-sm" onclick="verVale('${v.folio_vale}')">Ver</button></td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
    } catch(e) { el.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`; }
  };
  document.getElementById('btn-buscar').addEventListener('click', buscar);
  buscar();
}
window.verVale = async function(folio) {
  try {
    const v = await GET('/vales/' + folio);
    const kgT = (v.detalle || []).reduce((s, d) => s + (d.kg_equivalentes || 0), 0);
    showModal(`
      <h3>📋 ${v.folio_vale}</h3>
      <div class="vale-meta">
        <span><strong>Fecha:</strong> ${v.fecha}</span>
        <span><strong>Hora:</strong> ${v.hora||'-'}</span>
        <span><strong>Turno:</strong> ${v.turno||'-'}</span>
        <span><strong>Línea:</strong> ${v.linea}</span>
        <span><strong>Solicita:</strong> ${v.solicita||'-'}</span>
        <span><strong>Adiciona:</strong> ${v.adiciona||'-'}</span>
        <span><strong>Coordinador:</strong> ${v.coordinador||'-'}</span>
        <span><strong>Capturó:</strong> ${v.usuario||'-'}</span>
      </div>
      ${v.comentarios ? `<div class="alert alert-info mt-2">💬 ${v.comentarios}</div>` : ''}
      <h4 style="margin:16px 0 8px;font-size:13px;font-weight:700">Detalle (${(v.detalle||[]).length} línea(s) · ${kgT.toFixed(3)} kg total)</h4>
      <table class="detail-table">
        <thead><tr><th>Tanque</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>kg</th><th>Titulación</th></tr></thead>
        <tbody>${(v.detalle||[]).map(d => `
          <tr><td>${d.no_tanque} ${d.nombre_tanque}</td><td>${d.item}</td><td>${d.tipo_adicion}</td>
          <td>${d.cantidad}</td><td class="kg-value">${(d.kg_equivalentes||0).toFixed(3)}</td><td>${d.titulacion||'-'}</td></tr>`).join('')}
        </tbody>
      </table>
      ${(v.correcciones||[]).length > 0 ? `
        <h4 style="margin:16px 0 8px;font-size:13px;font-weight:700">Correcciones (${v.correcciones.length})</h4>
        <table class="detail-table">
          <thead><tr><th>Folio corr.</th><th>Tipo</th><th>Item</th><th>kg</th><th>Comentario</th></tr></thead>
          <tbody>${v.correcciones.map(c => `
            <tr><td class="mono">${c.folio_correccion}</td><td>${c.tipo}</td><td>${c.item}</td>
            <td>${(c.kg||0).toFixed(3)}</td><td>${c.comentario||'-'}</td></tr>`).join('')}
          </tbody>
        </table>` : ''}
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="window.print()">🖨️ Imprimir</button>
        <button class="btn btn-primary" onclick="closeModal()">Cerrar</button>
      </div>`);
  } catch(e) { alert('Error: ' + e.message); }
};

// ── Correcciones ──────────────────────────────────────────────────────────────
async function viewCorrecciones() {
  const corr = await GET('/correcciones');
  return `
  <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
    <button class="btn btn-primary" id="btn-nueva-corr">+ Nueva Corrección</button>
  </div>
  <div class="table-card">
    <div class="table-header"><h3>Correcciones registradas</h3></div>
    <div class="table-scroll">
      ${corr.length === 0 ? '<div class="empty-state"><div class="icon">🔧</div><p>Sin correcciones</p></div>' : `
      <table>
        <thead><tr><th>Folio corrección</th><th>Folio origen</th><th>Tipo</th><th>Item</th><th>Cantidad</th><th>kg</th><th>Usuario</th><th>Fecha</th><th>Comentario</th></tr></thead>
        <tbody>${corr.map(c => `<tr>
          <td class="mono">${c.folio_correccion}</td>
          <td class="mono">${c.folio_origen}</td>
          <td><span class="badge-role ${c.tipo==='DEVOLVER'?'badge-entrada':'badge-salida'}">${c.tipo}</span></td>
          <td>${c.item}</td>
          <td>${c.cantidad} ${c.unidad}</td>
          <td class="kg-value">${(c.kg||0).toFixed(3)}</td>
          <td>${c.usuario}</td>
          <td>${c.created_at?.slice(0,16)||''}</td>
          <td>${c.comentario||'-'}</td>
        </tr>`).join('')}</tbody>
      </table>`}
    </div>
  </div>`;
}
function bindCorrecciones() {
  document.getElementById('btn-nueva-corr')?.addEventListener('click', () => showModalCorreccion());
}
function showModalCorreccion() {
  showModal(`
    <h3>🔧 Nueva Corrección de Vale</h3>
    <div class="form-group"><label>Folio de vale origen *</label><input type="text" id="c-folio" placeholder="VA-YYYYMMDD-001" /></div>
    <div class="form-row mt-1">
      <div class="form-group"><label>Item (código) *</label><input type="text" id="c-item" placeholder="COD-ITEM" /></div>
      <div class="form-group"><label>Tipo *</label>
        <select id="c-tipo"><option value="">--</option><option value="DEVOLVER">DEVOLVER (devolver al inventario)</option><option value="DESCONTAR">DESCONTAR (quitar del inventario)</option></select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Unidad</label>
        <select id="c-unidad"><option value="KG">KG</option><option value="TAMBO">TAMBO</option><option value="PORRON_15L">PORRON_15L</option><option value="LITRO">LITRO</option></select>
      </div>
      <div class="form-group"><label>Cantidad *</label><input type="number" id="c-cant" step="0.001" min="0" /></div>
    </div>
    <div class="form-group mt-1"><label>Comentario</label><input type="text" id="c-coment" /></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="btn-save-corr">Guardar Corrección</button>
    </div>`);
  document.getElementById('btn-save-corr').addEventListener('click', async () => {
    const body = {
      folio_origen: document.getElementById('c-folio').value.trim().toUpperCase(),
      item:         document.getElementById('c-item').value.trim().toUpperCase(),
      tipo:         document.getElementById('c-tipo').value,
      unidad:       document.getElementById('c-unidad').value,
      cantidad:     parseFloat(document.getElementById('c-cant').value),
      comentario:   document.getElementById('c-coment').value.trim()
    };
    if (!body.folio_origen || !body.item || !body.tipo || !body.cantidad) {
      alert('Completa todos los campos requeridos'); return;
    }
    try {
      await POST('/correcciones', body);
      closeModal();
      navigate('correcciones');
    } catch(e) { alert('Error: ' + e.message); }
  });
}

// ── Entrada Inventario ────────────────────────────────────────────────────────
function viewEntradaInventario() {
  return `
  <div class="form-card" style="max-width:520px">
    <h3>📥 Recepción de Material</h3>
    <div class="form-group"><label>Producto (código) *</label><input type="text" id="e-item" placeholder="COD-ITEM" /></div>
    <div class="form-row mt-1">
      <div class="form-group"><label>Unidad *</label>
        <select id="e-unidad"><option value="KG">KG</option><option value="TAMBO">TAMBO</option><option value="PORRON_15L">PORRON_15L</option><option value="LITRO">LITRO</option></select>
      </div>
      <div class="form-group"><label>Cantidad *</label><input type="number" id="e-cant" step="0.001" min="0" /></div>
    </div>
    <div class="form-group mt-1"><label>Referencia / Comentario</label><input type="text" id="e-coment" placeholder="Ej. Factura #1234" /></div>
    <div style="margin-top:16px;display:flex;gap:10px">
      <button class="btn btn-primary" id="btn-save-entrada">💾 Registrar Entrada</button>
    </div>
    <div id="entrada-msg" style="margin-top:12px"></div>
  </div>`;
}
function bindEntradaInventario() {
  document.getElementById('btn-save-entrada').addEventListener('click', async () => {
    const body = {
      item:      document.getElementById('e-item').value.trim().toUpperCase(),
      unidad:    document.getElementById('e-unidad').value,
      cantidad:  parseFloat(document.getElementById('e-cant').value),
      comentario:document.getElementById('e-coment').value.trim()
    };
    if (!body.item || !body.cantidad) { alert('Item y cantidad requeridos'); return; }
    const msg = document.getElementById('entrada-msg');
    try {
      const res = await POST('/inventario/entrada', body);
      msg.innerHTML = `<div class="alert alert-success">✅ Entrada registrada. Stock actual: <strong>${parseFloat(res.existencia_kg).toFixed(3)} kg</strong></div>`;
      document.getElementById('e-item').value = '';
      document.getElementById('e-cant').value = '';
      document.getElementById('e-coment').value = '';
    } catch(e) { msg.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`; }
  });
}

// ── Inventario ────────────────────────────────────────────────────────────────
async function viewInventario() {
  const inv = await GET('/inventario');
  const role = state.user.vales_role;
  return `
  <div class="table-card">
    <div class="table-header"><h3>Stock actual — ${inv.length} producto(s)</h3></div>
    <div class="table-scroll">
      ${inv.length === 0 ? '<div class="empty-state"><div class="icon">📦</div><p>Sin registros de inventario</p></div>' : `
      <table>
        <thead><tr><th>Código</th><th>Presentación</th><th>Proveedor</th><th>Existencia (kg)</th><th>Precio/kg</th><th>Moneda</th><th>Actualización</th>${role==='admin'?'<th></th>':''}</tr></thead>
        <tbody>${inv.map(i => `<tr>
          <td><strong>${i.item}</strong></td>
          <td>${i.presentacion||'-'}</td>
          <td>${i.proveedor||'-'}</td>
          <td class="kg-value" style="${parseFloat(i.existencia_kg)<0?'color:#dc2626':''}">${parseFloat(i.existencia_kg).toFixed(3)}</td>
          <td>${i.precio_kg||0}</td>
          <td>${i.moneda||'MXN'}</td>
          <td style="font-size:12px">${i.ultima_actualizacion?.slice(0,16)||'-'}</td>
          ${role==='admin'?`<td><button class="btn btn-outline btn-xs" onclick="ajustarInventario('${i.item}',${i.existencia_kg})">Ajustar</button></td>`:''}
        </tr>`).join('')}</tbody>
      </table>`}
    </div>
  </div>`;
}
function bindInventario() {}
window.ajustarInventario = function(item, existActual) {
  showModal(`
    <h3>📦 Ajuste de Inventario</h3>
    <p style="font-size:13px;color:#78716c;margin-bottom:14px">Producto: <strong>${item}</strong><br>Existencia actual: <strong>${parseFloat(existActual).toFixed(3)} kg</strong></p>
    <div class="form-group"><label>Nueva existencia (kg) *</label><input type="number" id="aj-kg" step="0.001" value="${parseFloat(existActual).toFixed(3)}" /></div>
    <div class="form-group mt-1"><label>Comentario</label><input type="text" id="aj-coment" placeholder="Motivo del ajuste" /></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="btn-aj">Guardar Ajuste</button>
    </div>`);
  document.getElementById('btn-aj').addEventListener('click', async () => {
    const kg = parseFloat(document.getElementById('aj-kg').value);
    if (isNaN(kg)) { alert('Ingresa un valor válido'); return; }
    try {
      await POST('/inventario/ajuste', { item, existencia_kg: kg, comentario: document.getElementById('aj-coment').value.trim() });
      closeModal();
      navigate('inventario');
    } catch(e) { alert('Error: ' + e.message); }
  });
};

// ── Kardex ────────────────────────────────────────────────────────────────────
async function viewKardex() {
  const items = await GET('/items').catch(() => []);
  return `
  <div class="filters-bar">
    <div><label style="font-size:12px;font-weight:600;color:#78716c">Producto</label><br>
      <select id="k-item" style="min-width:180px">
        <option value="">Todos</option>
        ${items.map(i => `<option value="${i.item}">${i.item} — ${i.presentacion}</option>`).join('')}
      </select>
    </div>
    <div><label style="font-size:12px;font-weight:600;color:#78716c">Desde</label><br><input type="date" id="k-ini" value="${monthStart()}" /></div>
    <div><label style="font-size:12px;font-weight:600;color:#78716c">Hasta</label><br><input type="date" id="k-fin" value="${today()}" /></div>
    <div style="align-self:flex-end"><button class="btn btn-primary" id="btn-k-buscar">🔍 Buscar</button></div>
  </div>
  <div id="kardex-result"></div>`;
}
function bindKardex() {
  const buscar = async () => {
    const item = document.getElementById('k-item').value;
    const ini  = document.getElementById('k-ini').value;
    const fin  = document.getElementById('k-fin').value;
    let q = '?';
    if (item) q += `item=${encodeURIComponent(item)}&`;
    if (ini)  q += `fecha_ini=${ini}&`;
    if (fin)  q += `fecha_fin=${fin}&`;
    const el = document.getElementById('kardex-result');
    el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div></div>';
    try {
      const rows = await GET('/kardex' + q);
      const TIPO_BADGE = {
        SALIDA:'badge-salida', ENTRADA:'badge-entrada', AJUSTE:'badge-ajuste',
        CORRECCION_ENTRADA:'badge-corr', CORRECCION_SALIDA:'badge-corr', INVENTARIO_INICIAL:'badge-consulta'
      };
      el.innerHTML = `
      <div class="table-card">
        <div class="table-header"><h3>${rows.length} movimiento(s)</h3></div>
        <div class="table-scroll">
          ${rows.length===0?'<div class="empty-state"><div class="icon">📜</div><p>Sin movimientos</p></div>':`
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Referencia</th><th>Producto</th><th>Cantidad</th><th>Unidad</th><th>kg</th><th>Línea</th><th>Tanque</th><th>Usuario</th></tr></thead>
            <tbody>${rows.map(r=>`<tr>
              <td style="font-size:12px">${r.created_at?.slice(0,16)||''}</td>
              <td><span class="badge-role ${TIPO_BADGE[r.tipo]||'badge-sin'}" style="font-size:10px">${r.tipo}</span></td>
              <td class="mono">${r.referencia||'-'}</td>
              <td>${r.item}</td>
              <td>${r.cantidad}</td><td>${r.unidad}</td>
              <td class="kg-value">${(r.kg||0).toFixed(3)}</td>
              <td>${r.linea||'-'}</td><td>${r.no_tanque||'-'}</td>
              <td>${r.usuario||'-'}</td>
            </tr>`).join('')}</tbody>
          </table>`}
        </div>
      </div>`;
    } catch(e) { el.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`; }
  };
  document.getElementById('btn-k-buscar').addEventListener('click', buscar);
  buscar();
}

// ── Catálogo Items ────────────────────────────────────────────────────────────
async function viewItems() {
  const items = await GET('/items');
  return `
  <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
    <button class="btn btn-primary" id="btn-nuevo-item">+ Nuevo Producto</button>
  </div>
  <div class="table-card">
    <div class="table-header"><h3>${items.length} producto(s)</h3></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Código</th><th>Presentación</th><th>Proveedor</th><th>Peso/tambo (kg)</th><th>Densidad</th><th>Precio/kg</th><th>Moneda</th><th>Vigente</th><th></th></tr></thead>
        <tbody>${items.length===0?'<tr><td colspan="9" class="text-center" style="padding:24px;color:#78716c">Sin productos</td></tr>':
          items.map(i=>`<tr>
            <td><strong>${i.item}</strong></td>
            <td>${i.presentacion}</td><td>${i.proveedor||'-'}</td>
            <td>${i.peso_kg||0}</td><td>${i.densidad||0}</td>
            <td>${i.precio_kg||0}</td><td>${i.moneda||'MXN'}</td>
            <td>${i.vigente?'✅':'❌'}</td>
            <td><button class="btn btn-outline btn-xs" onclick="editItem(${i.id})">Editar</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}
function bindItems() {
  document.getElementById('btn-nuevo-item')?.addEventListener('click', () => showModalItem(null));
}
window.editItem = async function(id) {
  const items = await GET('/items');
  const item = items.find(i => i.id === id);
  if (item) showModalItem(item);
};
function showModalItem(item) {
  const isEdit = !!item;
  showModal(`
    <h3>${isEdit ? '✏️ Editar Producto' : '+ Nuevo Producto'}</h3>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px">
      ${!isEdit ? `<div class="form-group"><label>Código *</label><input type="text" id="it-code" value="${item?.item||''}" /></div>` : `<div class="form-group"><label>Código</label><input type="text" id="it-code" value="${item?.item||''}" disabled /></div>`}
      <div class="form-group"><label>Presentación *</label><input type="text" id="it-pres" value="${item?.presentacion||''}" /></div>
      <div class="form-group"><label>Proveedor</label><input type="text" id="it-prov" value="${item?.proveedor||''}" /></div>
      <div class="form-group"><label>Peso/tambo (kg)</label><input type="number" id="it-peskg" step="0.001" value="${item?.peso_kg||0}" /></div>
      <div class="form-group"><label>Densidad (kg/L)</label><input type="number" id="it-dens" step="0.001" value="${item?.densidad||0}" /></div>
      <div class="form-group"><label>Precio/kg</label><input type="number" id="it-precio" step="0.01" value="${item?.precio_kg||0}" /></div>
      <div class="form-group"><label>Precio/item</label><input type="number" id="it-pitem" step="0.01" value="${item?.precio_item||0}" /></div>
      <div class="form-group"><label>Moneda</label>
        <select id="it-mon"><option ${item?.moneda==='MXN'?'selected':''}>MXN</option><option ${item?.moneda==='USD'?'selected':''}>USD</option></select>
      </div>
      <div class="form-group"><label>Vigente</label>
        <select id="it-vig"><option value="true" ${item?.vigente!==false?'selected':''}>Sí</option><option value="false" ${item?.vigente===false?'selected':''}>No</option></select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="btn-save-item">${isEdit?'Guardar cambios':'Crear'}</button>
    </div>`);
  document.getElementById('btn-save-item').addEventListener('click', async () => {
    const body = {
      item:         document.getElementById('it-code').value.trim().toUpperCase(),
      presentacion: document.getElementById('it-pres').value.trim(),
      proveedor:    document.getElementById('it-prov').value.trim(),
      peso_kg:      parseFloat(document.getElementById('it-peskg').value) || 0,
      densidad:     parseFloat(document.getElementById('it-dens').value) || 0,
      precio_kg:    parseFloat(document.getElementById('it-precio').value) || 0,
      precio_item:  parseFloat(document.getElementById('it-pitem').value) || 0,
      moneda:       document.getElementById('it-mon').value,
      vigente:      document.getElementById('it-vig').value === 'true'
    };
    try {
      if (isEdit) await PATCH('/items/' + item.id, body);
      else await POST('/items', body);
      closeModal();
      navigate('items');
    } catch(e) { alert('Error: ' + e.message); }
  });
}

// ── Catálogo Tanques ──────────────────────────────────────────────────────────
async function viewTanques() {
  const [tanques, items] = await Promise.all([GET('/tanques'), GET('/items?vigente=true')]);
  return `
  <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
    <button class="btn btn-primary" id="btn-nuevo-tanque">+ Nuevo Tanque</button>
  </div>
  <div class="table-card">
    <div class="table-header"><h3>${tanques.length} tanque(s)</h3></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Línea</th><th>No. Tanque</th><th>Nombre</th><th>Tipo</th><th>Productos autorizados</th><th>Activo</th><th></th></tr></thead>
        <tbody>${tanques.length===0?'<tr><td colspan="7" class="text-center" style="padding:24px;color:#78716c">Sin tanques</td></tr>':
          tanques.map(t=>`<tr>
            <td>${t.linea}</td><td><strong>${t.no_tanque}</strong></td>
            <td>${t.nombre_tanque||'-'}</td><td>${t.tipo||'-'}</td>
            <td style="font-size:11px">${(t.items_autorizados||[]).join(', ')||'Todos'}</td>
            <td>${t.activo?'✅':'❌'}</td>
            <td><button class="btn btn-outline btn-xs" onclick="editTanque(${t.id})">Editar</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}
function bindTanques() {
  document.getElementById('btn-nuevo-tanque')?.addEventListener('click', async () => {
    const items = await GET('/items?vigente=true');
    showModalTanque(null, items);
  });
}
window.editTanque = async function(id) {
  const [tanques, items] = await Promise.all([GET('/tanques'), GET('/items?vigente=true')]);
  const t = tanques.find(x => x.id === id);
  if (t) showModalTanque(t, items);
};
function showModalTanque(tanque, items) {
  const isEdit = !!tanque;
  const autorizados = tanque?.items_autorizados || [];
  showModal(`
    <h3>${isEdit ? '✏️ Editar Tanque' : '+ Nuevo Tanque'}</h3>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label>Línea *</label><input type="text" id="tk-linea" value="${tanque?.linea||''}" ${isEdit?'disabled':''} /></div>
      <div class="form-group"><label>No. Tanque *</label><input type="text" id="tk-no" value="${tanque?.no_tanque||''}" ${isEdit?'disabled':''} /></div>
      <div class="form-group"><label>Nombre del tanque</label><input type="text" id="tk-nombre" value="${tanque?.nombre_tanque||''}" /></div>
      <div class="form-group"><label>Tipo</label><input type="text" id="tk-tipo" value="${tanque?.tipo||''}" /></div>
      ${isEdit?`<div class="form-group"><label>Activo</label><select id="tk-activo"><option value="true" ${tanque?.activo?'selected':''}>Sí</option><option value="false" ${!tanque?.activo?'selected':''}>No</option></select></div>`:''}
    </div>
    <div class="form-group" style="margin-top:12px">
      <label>Productos autorizados <small style="color:#78716c">(ninguno = todos permitidos)</small></label>
      <div style="max-height:160px;overflow-y:auto;border:1.5px solid #e7e5e4;border-radius:8px;padding:8px;margin-top:4px">
        ${items.map(i=>`
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 0;cursor:pointer">
            <input type="checkbox" value="${i.item}" ${autorizados.includes(i.item)?'checked':''} class="tk-item-check"/>
            ${i.item} — ${i.presentacion}
          </label>`).join('')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="btn-save-tanque">${isEdit?'Guardar cambios':'Crear'}</button>
    </div>`);
  document.getElementById('btn-save-tanque').addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('.tk-item-check:checked')].map(c => c.value);
    const body = {
      linea:            document.getElementById('tk-linea').value.trim(),
      no_tanque:        document.getElementById('tk-no').value.trim(),
      nombre_tanque:    document.getElementById('tk-nombre').value.trim(),
      tipo:             document.getElementById('tk-tipo').value.trim(),
      items_autorizados: checked,
      ...(isEdit ? { activo: document.getElementById('tk-activo').value === 'true' } : {})
    };
    try {
      if (isEdit) await PATCH('/tanques/' + tanque.id, body);
      else await POST('/tanques', body);
      closeModal();
      navigate('tanques');
    } catch(e) { alert('Error: ' + e.message); }
  });
}

// ── Usuarios ──────────────────────────────────────────────────────────────────
async function viewUsuarios() {
  const users = await GET('/usuarios');
  const ROLE_LABELS = { admin: '👑 Admin', operador: '⚙️ Operador', consulta: '👁️ Consulta' };
  return `
  <div class="alert alert-info" style="margin-bottom:16px">
    ℹ️ Aquí puedes asignar acceso al módulo de Vales a cualquier usuario del sistema.
    Los 3 niveles son: <strong>Admin</strong> (acceso total), <strong>Operador</strong> (crear vales, recepción) y <strong>Consulta</strong> (solo lectura).
  </div>
  <div class="table-card">
    <div class="table-header"><h3>${users.length} usuario(s) del sistema</h3></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Nombre</th><th>Correo</th><th>Rol (Compras)</th><th>Activo</th><th>Acceso Vales</th><th></th></tr></thead>
        <tbody>${users.map(u=>`<tr>
          <td><strong>${u.full_name}</strong></td>
          <td style="font-size:12px">${u.email}</td>
          <td style="font-size:12px">${u.role_code}</td>
          <td>${u.active?'✅':'❌'}</td>
          <td>
            <span class="badge-role ${u.vales_role?({'admin':'badge-admin','operador':'badge-operador','consulta':'badge-consulta'}[u.vales_role]||'badge-sin'):'badge-sin'}">
              ${u.vales_role ? ROLE_LABELS[u.vales_role] : '— Sin acceso —'}
            </span>
          </td>
          <td>
            <select class="usr-role-sel" data-id="${u.id}" style="font-size:12px;padding:4px 6px;border:1.5px solid #e7e5e4;border-radius:6px">
              <option value="">Sin acceso</option>
              <option value="consulta"  ${u.vales_role==='consulta' ?'selected':''}>Consulta</option>
              <option value="operador"  ${u.vales_role==='operador' ?'selected':''}>Operador</option>
              <option value="admin"     ${u.vales_role==='admin'    ?'selected':''}>Admin</option>
            </select>
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;
}
function bindUsuarios() {
  document.querySelectorAll('.usr-role-sel').forEach(sel => {
    sel.addEventListener('change', async function() {
      const id = Number(this.dataset.id);
      const vales_role = this.value || null;
      try {
        await PATCH('/usuarios/' + id + '/vales-role', { vales_role });
        // Visual feedback
        const row = this.closest('tr');
        const badge = row.querySelector('.badge-role');
        const ROLE_LABELS = { admin: '👑 Admin', operador: '⚙️ Operador', consulta: '👁️ Consulta' };
        badge.textContent = vales_role ? ROLE_LABELS[vales_role] : '— Sin acceso —';
        badge.className = 'badge-role ' + (vales_role ? ({'admin':'badge-admin','operador':'badge-operador','consulta':'badge-consulta'}[vales_role]||'badge-sin') : 'badge-sin');
      } catch(e) { alert('Error: ' + e.message); this.value = ''; }
    });
  });
}

// ── Modal helper ──────────────────────────────────────────────────────────────
function showModal(html) {
  let ov = document.getElementById('modal-overlay');
  if (!ov) { ov = document.createElement('div'); ov.id = 'modal-overlay'; document.body.appendChild(ov); }
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal-box">${html}</div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
}
window.closeModal = function() {
  const ov = document.getElementById('modal-overlay');
  if (ov) ov.remove();
};

// ── Utilidades ────────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }
function nowTime() { return new Date().toTimeString().slice(0, 5); }
function monthStart() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }
function calcKgFront(tipo, cant, item) {
  const c = parseFloat(cant) || 0;
  switch (tipo) {
    case 'KG':        return c;
    case 'TAMBO':     return c * (parseFloat(item.peso_kg) || 0);
    case 'PORRON_15L': return c * 15 * (parseFloat(item.densidad) || 0);
    case 'LITRO':     return c * (parseFloat(item.densidad) || 0);
    default:          return c;
  }
}

// ── Arranque ──────────────────────────────────────────────────────────────────
if (tryRestore()) {
  render();
} else {
  render();
}
