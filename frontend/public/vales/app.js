/* ══════════════════════════════════════════════════════════════════════════════
   MÓDULO VALES DE ADICIÓN — SPA vanilla JS
   ══════════════════════════════════════════════════════════════════════════════ */

// ── Generador de PDF Vale de Adición (formato original) ───────────────────────
function generarValePDF(v) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  const mL = 15, mR = 15, mT = 14, pgW = 215.9;
  const usableW = pgW - mL - mR;
  let y = mT;

  const correcciones = v.correcciones || [];
  const tieneCorrecciones = correcciones.length > 0;

  // ── Título ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('VALE DE ADICIÓN DE PRODUCTO QUÍMICO', mL, y);

  // ── Sello VALE CON CORRECCIÓN (esquina superior derecha) ──────────────────
  if (tieneCorrecciones) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 0, 0);
    doc.setDrawColor(180, 0, 0);
    doc.setLineWidth(0.6);
    const sellW = 58, sellH = 9;
    const sellX = pgW - mR - sellW;
    doc.rect(sellX, mT - 6, sellW, sellH);
    doc.text(`VALE CON CORRECCIÓN (${correcciones.length})`, sellX + sellW / 2, mT - 0.5, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
  }
  y += 7;

  // ── Folio ─────────────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Folio: ', mL, y);
  doc.setFont('helvetica', 'normal');
  doc.text(String(v.folio_vale || '—'), mL + 14, y);
  y += 6;

  // ── Línea 1: Fecha / Hora / Turno / Línea ─────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.text('Fecha: ', mL, y);
  doc.setFont('helvetica', 'normal'); doc.text(String(v.fecha || '—'), mL + 14, y);

  doc.setFont('helvetica', 'bold'); doc.text('Hora: ', mL + 50, y);
  doc.setFont('helvetica', 'normal'); doc.text(String(v.hora || '—'), mL + 62, y);

  doc.setFont('helvetica', 'bold'); doc.text('Turno: ', mL + 90, y);
  doc.setFont('helvetica', 'normal'); doc.text(String(v.turno || '—'), mL + 104, y);

  doc.setFont('helvetica', 'bold'); doc.text('Línea: ', mL + 125, y);
  doc.setFont('helvetica', 'normal'); doc.text(String(v.linea || '—'), mL + 138, y);
  y += 6;

  // ── Línea 2: Solicita / Adiciona / Coordinador ────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.text('Solicita: ', mL, y);
  doc.setFont('helvetica', 'normal'); doc.text(String(v.solicita || '—'), mL + 18, y);

  doc.setFont('helvetica', 'bold'); doc.text('Adiciona: ', mL + 70, y);
  doc.setFont('helvetica', 'normal'); doc.text(String(v.adiciona || '__________'), mL + 88, y);

  doc.setFont('helvetica', 'bold'); doc.text('Coordinador: ', mL + 130, y);
  doc.setFont('helvetica', 'normal'); doc.text(String(v.coordinador || '__________'), mL + 158, y);
  y += 8;

  // ── Tabla de partidas ─────────────────────────────────────────────────────
  const detalles = v.detalle || [];
  const TIPO_LABELS = { KG: 'KG', TAMBO: 'TAMBO', PORRON_15L: 'PORRÓN 15L', LITRO: 'LITRO' };

  doc.autoTable({
    startY: y,
    margin: { left: mL, right: mR },
    head: [['#', 'Tanque', 'Producto / Item', 'Tipo', 'Cant.', 'kg eq.']],
    body: detalles.map((d, i) => [
      i + 1,
      `${d.no_tanque || ''}${d.nombre_tanque ? ' - ' + d.nombre_tanque : ''}`,
      d.item || '—',
      TIPO_LABELS[(d.tipo_adicion || '').toUpperCase()] || d.tipo_adicion || '—',
      String(d.cantidad ?? '—'),
      (d.kg_equivalentes || 0).toFixed(2)
    ]),
    columnStyles: {
      0: { cellWidth: 8,  halign: 'center' },
      1: { cellWidth: 30 },
      2: { cellWidth: 80 },
      3: { cellWidth: 22 },
      4: { cellWidth: 18, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' }
    },
    headStyles: { fillColor: [210, 210, 210], textColor: 0, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9, font: 'helvetica' },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    styles: { cellPadding: 2, valign: 'top' },
  });

  y = doc.lastAutoTable.finalY + 8;

  // ── Comentarios ───────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Comentarios', mL, y);
  y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const comentariosText = (v.comentarios || '').trim() ||
    '____________________________________________\n____________________________________________';
  const comentLines = doc.splitTextToSize(comentariosText, usableW);
  doc.text(comentLines, mL, y);
  y += comentLines.length * 5 + 10;

  // ── Firmas ────────────────────────────────────────────────────────────────
  const colW = usableW / 3;
  const firmaLabels = ['Solicita', 'Adiciona', 'Coordinador'];
  firmaLabels.forEach((lbl, i) => {
    const x = mL + i * colW + colW / 2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(lbl, x, y, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text('____________________', x, y + 8, { align: 'center' });
  });
  y += 22;

  // ── Correcciones aplicadas ─────────────────────────────────────────────────
  if (tieneCorrecciones) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(180, 0, 0);
    doc.text('CORRECCIONES APLICADAS', mL, y);
    doc.setTextColor(0, 0, 0);
    y += 2;

    doc.autoTable({
      startY: y,
      margin: { left: mL, right: mR },
      head: [['Folio corrección', 'Tipo', 'Item', 'Cantidad', 'kg', 'Realizada por', 'Fecha', 'Comentario']],
      body: correcciones.map(c => [
        c.folio_correccion || '—',
        c.tipo || '—',
        c.item || '—',
        `${c.cantidad ?? '—'} ${c.unidad || ''}`.trim(),
        (c.kg || 0).toFixed(3),
        c.usuario || '—',
        c.created_at ? String(c.created_at).substring(0, 16).replace('T', ' ') : '—',
        c.comentario || '—'
      ]),
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 20 },
        2: { cellWidth: 45 },
        3: { cellWidth: 20, halign: 'right' },
        4: { cellWidth: 15, halign: 'right' },
        5: { cellWidth: 25 },
        6: { cellWidth: 22 },
        7: { cellWidth: 'auto' }
      },
      headStyles: { fillColor: [220, 180, 180], textColor: 0, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 7.5, font: 'helvetica' },
      alternateRowStyles: { fillColor: [255, 248, 248] },
      styles: { cellPadding: 1.5, valign: 'top' },
    });
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const pgH = 279.4;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  doc.setTextColor(128, 128, 128);
  doc.text("SGC 4-PR-15, Rev. 2, 01-02-'26   TRA: 6 meses   TRAM: No aplica", mL, pgH - 8);
  doc.setTextColor(0, 0, 0);

  doc.save(`${v.folio_vale || 'vale'}.pdf`);
}
window.generarValePDF = generarValePDF;

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
    ['kardex',             '📜', 'Kardex'],
    ['---', '', 'Titulaciones'],
    ['titulaciones',       '🔬', 'Registrar'],
    ['tit-reporte',        '📊', 'Reporte'],
    ['tit-estadisticas',   '📈', 'Estadísticas']
  ],
  admin: [
    ['crear-vale',         '➕', 'Crear Vale'],
    ['consulta-vales',     '📋', 'Consulta Vales'],
    ['reportes',           '📊', 'Reportes'],
    ['correcciones',       '🔧', 'Correcciones'],
    ['entrada-inventario', '📥', 'Recepción'],
    ['inventario',         '📦', 'Inventario'],
    ['kardex',             '📜', 'Kardex'],
    ['---', '', 'Titulaciones'],
    ['titulaciones',       '🔬', 'Registrar'],
    ['tit-reporte',        '📊', 'Reporte'],
    ['tit-estadisticas',   '📈', 'Estadísticas'],
    ['tit-catalogo',       '⚙️', 'Catálogo Parámetros'],
    ['---', '', 'Certificados'],
    ['cert-calidad',       '📄', 'Certificados SKF'],
    ['---', '', 'Catálogos'],
    ['items',    '🧪', 'Productos'],
    ['tanques',  '🏭', 'Tanques'],
    ['usuarios', '👤', 'Usuarios'],
    ['---', '', 'Herramientas'],
    ['importar-sqlite', '🗄️', 'Importar SQLite']
  ]
};

const SECTION_TITLES = {
  'dashboard':         'Inicio',
  'crear-vale':        'Crear Vale',
  'consulta-vales':    'Consulta de Vales',
  'reportes':          'Reportes de Consumo',
  'correcciones':      'Correcciones',
  'entrada-inventario':'Recepción de Material',
  'inventario':        'Inventario Actual',
  'kardex':            'Kardex',
  'items':             'Catálogo de Productos',
  'tanques':           'Catálogo de Tanques',
  'usuarios':          'Gestión de Usuarios',
  'importar-sqlite':   'Importar desde Base Antigua (SQLite)',
  'titulaciones':      'Registrar Titulación',
  'tit-reporte':       'Reporte de Titulaciones',
  'tit-estadisticas':  'Estadísticas SPC',
  'tit-catalogo':      'Catálogo de Parámetros',
  'cert-calidad':      'Certificados de Calidad SKF'
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
  if (res.status === 401) { logout(); return; }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
const GET  = (p)    => api('GET',    p);
const POST = (p, b) => api('POST',   p, b);
const PUT  = (p, b) => api('PUT',    p, b);
const PATCH= (p, b) => api('PATCH',  p, b);
const DEL  = (p)    => api('DELETE', p);
const esc  = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

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
        <button class="btn-logout" id="btn-change-pwd" style="margin-bottom:6px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;">🔑 Cambiar contraseña</button>
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
  document.getElementById('btn-change-pwd')?.addEventListener('click', openChangePwdModal);
}

function openChangePwdModal() {
  showModal(`
    <h3>🔑 Cambiar contraseña</h3>
    <div class="form-group" style="margin-bottom:12px"><label>Contraseña actual</label><input class="form-input" type="password" id="cp-cur" autocomplete="current-password"/></div>
    <div class="form-group" style="margin-bottom:12px"><label>Nueva contraseña</label><input class="form-input" type="password" id="cp-new" placeholder="Mínimo 6 caracteres" autocomplete="new-password"/></div>
    <div class="form-group" style="margin-bottom:16px"><label>Confirmar nueva contraseña</label><input class="form-input" type="password" id="cp-conf" autocomplete="new-password"/></div>
    <p id="cp-err" style="color:#dc2626;font-size:13px;margin:0 0 12px;display:none"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn-primary" id="cp-save">Guardar</button>
    </div>
  `);
  document.getElementById('cp-save').onclick = async () => {
    const cur  = document.getElementById('cp-cur').value;
    const nw   = document.getElementById('cp-new').value;
    const conf = document.getElementById('cp-conf').value;
    const errEl = document.getElementById('cp-err');
    const showErr = msg => { errEl.textContent = msg; errEl.style.display = ''; };
    errEl.style.display = 'none';
    if (!cur || !nw || !conf) return showErr('Completa todos los campos');
    if (nw.length < 6) return showErr('La nueva contraseña debe tener al menos 6 caracteres');
    if (nw !== conf) return showErr('Las contraseñas nuevas no coinciden');
    const btn = document.getElementById('cp-save');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await POST('/auth/change-password', { current_password: cur, new_password: nw });
      closeModal(); alert('Contraseña actualizada correctamente');
    } catch(e) {
      btn.disabled = false; btn.textContent = 'Guardar'; showErr(e.message);
    }
  };
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
      case 'reportes':          el.innerHTML = await viewReportes(); bindReportes(); return;
      case 'kardex':            el.innerHTML = await viewKardex(); bindKardex(); return;
      case 'items':             el.innerHTML = await viewItems(); bindItems(); return;
      case 'tanques':           el.innerHTML = await viewTanques(); bindTanques(); return;
      case 'usuarios':          el.innerHTML = await viewUsuarios(); bindUsuarios(); return;
      case 'importar-sqlite':   el.innerHTML = await viewImportarSqlite(); bindImportarSqlite(); return;
      case 'titulaciones':      el.innerHTML = await viewTitulaciones(); bindTitulaciones(); return;
      case 'tit-reporte':       el.innerHTML = await viewTitReporte(); bindTitReporte(); return;
      case 'tit-estadisticas':  el.innerHTML = await viewTitEstadisticas(); bindTitEstadisticas(); return;
      case 'tit-catalogo':      el.innerHTML = await viewTitCatalogo(); bindTitCatalogo(); return;
      case 'cert-calidad':      el.innerHTML = await viewCertCalidad(); bindCertCalidad(); return;
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
    if (autorizados.length === 0) {
      selItem.innerHTML = '<option value="">— Sin productos asignados —</option>';
      return;
    }
    const items = allItems.filter(i => autorizados.includes(i.item));
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
    // Generar PDF automáticamente con los datos completos del vale recién creado
    try {
      const valeCompleto = await GET('/vales/' + vale.folio_vale);
      generarValePDF(valeCompleto);
    } catch(_) { /* no bloquear si falla el PDF */ }
    alert(`✅ Vale guardado: ${vale.folio_vale}\n\nSe generó el PDF automáticamente.`);
    state.valeDetalle = [];
    navigate('consulta-vales');
  } catch(e) {
    alert('Error: ' + e.message);
    btn.disabled = false; btn.textContent = '💾 Guardar Vale';
  }
}

// ── Consulta Vales ────────────────────────────────────────────────────────────
async function viewConsultaVales() {
  const [lineas, items] = await Promise.all([
    GET('/lineas').catch(() => []),
    GET('/items').catch(() => [])
  ]);
  const ini = monthStart();
  const fin = today();
  return `
  <div class="tab-bar" style="display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid #e7e5e4">
    <button class="tab-btn tab-active" id="tab-porvale" onclick="switchConsultaTab('porvale')">📋 Por Vale</button>
    <button class="tab-btn" id="tab-poritem" onclick="switchConsultaTab('poritem')">🧪 Por Item</button>
  </div>

  <!-- Tab: Por Vale -->
  <div id="panel-porvale">
    <div class="filters-bar">
      <div><label class="flabel">Desde</label><br><input type="date" id="fv-ini" value="${ini}" /></div>
      <div><label class="flabel">Hasta</label><br><input type="date" id="fv-fin" value="${fin}" /></div>
      <div><label class="flabel">Folio</label><br><input type="text" id="fv-folio" placeholder="VA-..." style="width:150px" /></div>
      <div><label class="flabel">Línea</label><br>
        <select id="fv-linea"><option value="">Todas</option>${lineas.map(l=>`<option>${l}</option>`).join('')}</select>
      </div>
      <div style="align-self:flex-end;display:flex;gap:8px">
        <button class="btn btn-primary" id="btn-buscar-vale">🔍 Buscar</button>
        ${state.user?.vales_role === 'admin' ? `<button class="btn btn-outline" id="btn-export-vale">⬇️ Excel</button>` : ''}
        ${state.user?.vales_role === 'admin' ? `<button class="btn btn-outline" id="btn-import-vale">📤 Importar</button><button class="btn btn-outline" id="btn-repair-fechas" title="Corregir fechas mal importadas">🔧 Reparar fechas</button>` : ''}
      </div>
    </div>
    <div id="result-porvale"></div>
  </div>

  <!-- Tab: Por Item -->
  <div id="panel-poritem" style="display:none">
    <div class="filters-bar">
      <div><label class="flabel">Desde</label><br><input type="date" id="fi-ini" value="${ini}" /></div>
      <div><label class="flabel">Hasta</label><br><input type="date" id="fi-fin" value="${fin}" /></div>
      <div><label class="flabel">Producto</label><br>
        <select id="fi-item" style="min-width:200px"><option value="">Todos</option>${items.map(i=>`<option value="${i.item}">${i.item}</option>`).join('')}</select>
      </div>
      <div><label class="flabel">Línea</label><br>
        <select id="fi-linea"><option value="">Todas</option>${lineas.map(l=>`<option>${l}</option>`).join('')}</select>
      </div>
      <div style="align-self:flex-end;display:flex;gap:8px">
        <button class="btn btn-primary" id="btn-buscar-item">🔍 Buscar</button>
        <button class="btn btn-outline" id="btn-export-item">📥 CSV</button>
        ${state.user?.vales_role === 'admin' ? `<button class="btn btn-outline" id="btn-export-item-xlsx">⬇️ Excel</button>` : ''}
        ${state.user?.vales_role === 'admin' ? `<button class="btn btn-outline" id="btn-import-item">📤 Importar</button>` : ''}
      </div>
    </div>
    <div id="result-poritem"></div>
  </div>`;
}

function bindConsultaVales() {
  // ── Tab switcher ──
  window.switchConsultaTab = function(tab) {
    document.getElementById('panel-porvale').style.display = tab === 'porvale' ? '' : 'none';
    document.getElementById('panel-poritem').style.display = tab === 'poritem'  ? '' : 'none';
    document.getElementById('tab-porvale').classList.toggle('tab-active', tab === 'porvale');
    document.getElementById('tab-poritem').classList.toggle('tab-active', tab === 'poritem');
  };

  // ── Búsqueda por Vale ──
  let _valesData = [];
  const buscarVale = async () => {
    const ini   = document.getElementById('fv-ini').value;
    const fin   = document.getElementById('fv-fin').value;
    const folio = document.getElementById('fv-folio').value.trim();
    const linea = document.getElementById('fv-linea').value;
    let q = '?';
    if (ini)   q += `fecha_ini=${ini}&`;
    if (fin)   q += `fecha_fin=${fin}&`;
    if (folio) q += `folio=${encodeURIComponent(folio)}&`;
    if (linea) q += `linea=${encodeURIComponent(linea)}&`;
    const el = document.getElementById('result-porvale');
    el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Buscando...</p></div>';
    try {
      const vales = await GET('/vales' + q);
      _valesData = vales;
      if (vales.length === 0) { el.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>Sin resultados</p></div>'; return; }
      el.innerHTML = `
      <div class="table-card">
        <div class="table-header"><h3>${vales.length} vale(s)</h3></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Folio</th><th>Fecha</th><th>Hora</th><th>Turno</th><th>Línea</th><th>Solicita</th><th>Items</th><th>kg total</th><th></th></tr></thead>
            <tbody>${vales.map(v => {
              const kgT = (v.detalle||[]).reduce((s,d) => s+(d.kg_equivalentes||0),0);
              const isAdmin = state.user?.vales_role === 'admin';
              return `<tr>
                <td class="mono">${v.folio_vale}</td>
                <td>${v.fecha}</td><td>${v.hora||'-'}</td><td>${v.turno||'-'}</td>
                <td>${v.linea}</td><td>${v.solicita||'-'}</td>
                <td>${(v.detalle||[]).length}</td>
                <td class="kg-value">${kgT.toFixed(3)}</td>
                <td style="display:flex;gap:4px">
                  <button class="btn btn-outline btn-sm" onclick="verVale('${v.folio_vale}')">Ver</button>
                  ${isAdmin ? `<button class="btn btn-outline btn-sm" onclick="editVale('${v.folio_vale}')">✏️</button>` : ''}
                  ${isAdmin ? `<button class="btn btn-outline btn-sm" style="color:#dc2626" onclick="eliminarVale('${v.folio_vale}')">🗑️</button>` : ''}
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
    } catch(e) { el.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`; }
  };
  document.getElementById('btn-buscar-vale').addEventListener('click', buscarVale);
  window._buscarVale = buscarVale;
  buscarVale();

  window.eliminarVale = async function(folio) {
    if (!confirm(`¿Eliminar el vale ${folio}?\n\nEsta acción revertirá el inventario y no puede deshacerse.`)) return;
    try {
      await DEL('/vales/' + folio);
      buscarVale();
    } catch(e) { alert('Error: ' + e.message); }
  };

  // ── Export Excel — Por Vale (solo admin) ──
  document.getElementById('btn-export-vale')?.addEventListener('click', () => {
    if (!_valesData.length) { alert('Primero realiza una búsqueda'); return; }
    const rows = [];
    _valesData.forEach(v => {
      const detalles = v.detalle || [];
      if (detalles.length === 0) {
        rows.push({ Folio: v.folio_vale, Fecha: v.fecha, Hora: v.hora||'', Turno: v.turno||'', Línea: v.linea, Solicita: v.solicita||'', Adiciona: v.adiciona||'', Coordinador: v.coordinador||'', Comentarios: v.comentarios||'', 'No. Tanque': '', 'Nombre Tanque': '', Producto: '', 'Tipo Adición': '', Cantidad: '', 'kg Equiv.': '', Titulación: '' });
      } else {
        detalles.forEach(d => {
          rows.push({ Folio: v.folio_vale, Fecha: v.fecha, Hora: v.hora||'', Turno: v.turno||'', Línea: v.linea, Solicita: v.solicita||'', Adiciona: v.adiciona||'', Coordinador: v.coordinador||'', Comentarios: v.comentarios||'', 'No. Tanque': d.no_tanque||'', 'Nombre Tanque': d.nombre_tanque||'', Producto: d.item||'', 'Tipo Adición': d.tipo_adicion||'', Cantidad: d.cantidad||0, 'kg Equiv.': d.kg_equivalentes||0, Titulación: d.titulacion||'' });
        });
      }
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vales');
    const ini = document.getElementById('fv-ini').value;
    const fin = document.getElementById('fv-fin').value;
    XLSX.writeFile(wb, `vales_${ini}_${fin}.xlsx`);
  });

  // ── Búsqueda por Item ──
  let _detallesData = [];
  const buscarItem = async () => {
    const ini   = document.getElementById('fi-ini').value;
    const fin   = document.getElementById('fi-fin').value;
    const item  = document.getElementById('fi-item').value;
    const linea = document.getElementById('fi-linea').value;
    let q = '?';
    if (ini)   q += `fecha_ini=${ini}&`;
    if (fin)   q += `fecha_fin=${fin}&`;
    if (item)  q += `item=${encodeURIComponent(item)}&`;
    if (linea) q += `linea=${encodeURIComponent(linea)}&`;
    const el = document.getElementById('result-poritem');
    el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Buscando...</p></div>';
    try {
      const rows = await GET('/detalles' + q);
      _detallesData = rows;
      if (rows.length === 0) { el.innerHTML = '<div class="empty-state"><div class="icon">🧪</div><p>Sin resultados</p></div>'; return; }
      const totalKg = rows.reduce((s,r)=>s+(r.kg||0),0);
      el.innerHTML = `
      <div class="table-card">
        <div class="table-header">
          <h3>${rows.length} adición(es) · ${totalKg.toFixed(3)} kg total</h3>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Hora</th><th>Turno</th><th>Folio Vale</th><th>Línea</th><th>Tanque</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>kg</th><th>Titulación</th><th>Solicita</th><th>Adiciona</th>${state.user?.vales_role==='admin'?'<th></th>':''}</tr></thead>
            <tbody>${rows.map(r=>`<tr>
              <td>${r.fecha}</td><td>${r.hora||'-'}</td><td>${r.turno||'-'}</td>
              <td class="mono">${r.folio_vale}</td>
              <td>${r.linea}</td><td title="${r.nombre_tanque}">${r.no_tanque}</td>
              <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.item}">${r.item}</td>
              <td>${r.tipo_adicion}</td>
              <td style="text-align:right">${r.cantidad}</td>
              <td class="kg-value">${(r.kg||0).toFixed(3)}</td>
              <td>${r.titulacion||'-'}</td>
              <td>${r.solicita||'-'}</td>
              <td>${r.adiciona||'-'}</td>
              ${state.user?.vales_role==='admin'?`<td><button class="btn btn-outline btn-xs" onclick="editDetalle('${r.folio_vale}',${r.id})">✏️</button></td>`:''}
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
    } catch(e) { el.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`; }
  };
  document.getElementById('btn-buscar-item').addEventListener('click', buscarItem);

  // ── Export CSV ──
  document.getElementById('btn-export-item').addEventListener('click', () => {
    if (!_detallesData.length) { alert('Primero realiza una búsqueda'); return; }
    const headers = ['Fecha','Hora','Turno','Folio Vale','Línea','No. Tanque','Nombre Tanque','Producto','Tipo Adición','Cantidad','kg','Titulación','Solicita','Adiciona','Coordinador','Comentarios'];
    const rows = _detallesData.map(r => [
      r.fecha, r.hora, r.turno, r.folio_vale, r.linea, r.no_tanque, r.nombre_tanque,
      r.item, r.tipo_adicion, r.cantidad, (r.kg||0).toFixed(3), r.titulacion,
      r.solicita, r.adiciona, r.coordinador, r.comentarios
    ].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `adiciones_${document.getElementById('fi-ini').value}_${document.getElementById('fi-fin').value}.csv`;
    a.click();
  });

  // ── Export Excel — Por Item (solo admin) ──
  document.getElementById('btn-export-item-xlsx')?.addEventListener('click', () => {
    if (!_detallesData.length) { alert('Primero realiza una búsqueda'); return; }
    const rows = _detallesData.map(r => ({
      Fecha: r.fecha, Hora: r.hora||'', Turno: r.turno||'', 'Folio Vale': r.folio_vale,
      Línea: r.linea, 'No. Tanque': r.no_tanque||'', 'Nombre Tanque': r.nombre_tanque||'',
      Producto: r.item, 'Tipo Adición': r.tipo_adicion, Cantidad: r.cantidad,
      kg: r.kg||0, Titulación: r.titulacion||'', Solicita: r.solicita||'',
      Adiciona: r.adiciona||'', Coordinador: r.coordinador||'', Comentarios: r.comentarios||''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Por Producto');
    const ini = document.getElementById('fi-ini').value;
    const fin = document.getElementById('fi-fin').value;
    XLSX.writeFile(wb, `adiciones_${ini}_${fin}.xlsx`);
  });

  // ── Import Excel (admin) — ambos tabs usan la misma función ──
  // Normaliza cualquier valor de fecha a YYYY-MM-DD
  function normFecha(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
    if (typeof v === 'number') {
      if (v < 1) return '';
      const d = new Date(Math.round((v - 25569) * 86400000));
      return isNaN(d) ? '' : d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const ddmm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2,'0')}-${ddmm[1].padStart(2,'0')}`;
    const parsed = new Date(s);
    return isNaN(parsed) ? s.slice(0, 10) : parsed.toISOString().slice(0, 10);
  }

  const doImportExcel = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const arrayBuffer = await file.arrayBuffer();
        // cellDates:true → SheetJS entrega fechas como objetos Date (más fiable)
        const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!rows.length) { alert('El archivo está vacío'); return; }
        // Normalizar fechas antes de enviar al servidor
        rows.forEach(r => { if (r['Fecha'] !== undefined) r['Fecha'] = normFecha(r['Fecha']); });
        const isPorVale = rows[0]['Folio'] !== undefined;
        const folios = [...new Set(rows.map(r => String(r['Folio'] || r['Folio Vale'] || '')).filter(Boolean))];
        if (!folios.length) { alert('No se encontraron folios en el archivo'); return; }
        if (!confirm(`Importar ${rows.length} fila(s) de ${folios.length} folio(s)\nFormato detectado: ${isPorVale ? 'Por Vale' : 'Por Item'}\n\nSe sustituirá la información de cada folio incluido.\n¿Continuar?`)) return;
        const result = await POST('/import-excel', { rows });
        let msg = `✅ Importación completada:\n• ${result.created} folio(s) creados\n• ${result.updated} folio(s) actualizados`;
        if (result.fechas_reparadas > 0) msg += `\n• ${result.fechas_reparadas} fecha(s) corregidas automáticamente`;
        if (result.errors?.length) msg += `\n\n⚠️ Advertencias (${result.errors.length}):\n` + result.errors.slice(0, 8).join('\n');
        alert(msg);
        buscarVale();
        buscarItem();
      } catch (err) {
        alert('Error al procesar el archivo: ' + err.message);
      }
    };
    input.click();
  };
  document.getElementById('btn-import-vale')?.addEventListener('click', doImportExcel);
  document.getElementById('btn-import-item')?.addEventListener('click', doImportExcel);
  document.getElementById('btn-repair-fechas')?.addEventListener('click', async () => {
    if (!confirm('¿Reparar fechas mal importadas en todos los vales?')) return;
    try {
      const r = await POST('/repair-fechas', {});
      alert(r.message || 'Listo');
      await renderTab(state.activeTab);
    } catch (e) { alert(e.message); }
  });
}
window.verVale = async function(folio) {
  try {
    const v = await GET('/vales/' + folio);
    window._valeActual = v;
    const kgT = (v.detalle || []).reduce((s, d) => s + (d.kg_equivalentes || 0), 0);
    const isAdmin = state.user?.vales_role === 'admin';
    const numCorr = (v.correcciones || []).length;
    showModal(`
      <h3>📋 ${v.folio_vale}${numCorr > 0 ? ` <span style="background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;border:1px solid #fca5a5;vertical-align:middle">CORREGIDO (${numCorr})</span>` : ''}</h3>
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
        <thead><tr><th>Tanque</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>kg</th><th>Titulación</th>${isAdmin?'<th></th>':''}</tr></thead>
        <tbody>${(v.detalle||[]).map(d => `
          <tr><td>${d.no_tanque} ${d.nombre_tanque}</td><td>${d.item}</td><td>${d.tipo_adicion}</td>
          <td>${d.cantidad}</td><td class="kg-value">${(d.kg_equivalentes||0).toFixed(3)}</td><td>${d.titulacion||'-'}</td>
          ${isAdmin?`<td><button class="btn btn-outline btn-xs" onclick="editDetalle('${v.folio_vale}',${d.id})">✏️</button></td>`:''}</tr>`).join('')}
        </tbody>
      </table>
      ${(v.correcciones||[]).length > 0 ? `
        <h4 style="margin:16px 0 8px;font-size:13px;font-weight:700;color:#b91c1c">Correcciones aplicadas (${v.correcciones.length})</h4>
        <table class="detail-table">
          <thead><tr><th>Folio corrección</th><th>Tipo</th><th>Item</th><th>Cantidad</th><th>kg</th><th>Realizada por</th><th>Fecha</th><th>Comentario</th></tr></thead>
          <tbody>${v.correcciones.map(c => `
            <tr style="background:#fff5f5">
              <td class="mono">${c.folio_correccion}</td>
              <td><span style="background:#fee2e2;color:#b91c1c;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:600">${c.tipo}</span></td>
              <td>${c.item}</td>
              <td>${c.cantidad ?? '-'} ${c.unidad||''}</td>
              <td>${(c.kg||0).toFixed(3)}</td>
              <td>${c.usuario||'-'}</td>
              <td style="white-space:nowrap">${c.created_at ? String(c.created_at).substring(0,16).replace('T',' ') : '-'}</td>
              <td>${c.comentario||'-'}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : ''}
      <div class="modal-actions">
        ${isAdmin ? `<button class="btn btn-outline" onclick="editVale('${v.folio_vale}')">✏️ Editar encabezado</button>` : ''}
        <button class="btn btn-outline" onclick="generarValePDF(window._valeActual)">📄 Generar PDF</button>
        <button class="btn btn-primary" onclick="closeModal()">Cerrar</button>
      </div>`);
  } catch(e) { alert('Error: ' + e.message); }
};

// ── Editar encabezado de vale (admin) ─────────────────────────────────────────
window.editVale = async function(folio) {
  try {
    const [v, lineas] = await Promise.all([GET('/vales/' + folio), GET('/lineas').catch(()=>[])]);
    showModal(`
      <h3>✏️ Editar Vale ${v.folio_vale}</h3>
      <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div class="form-group"><label>Fecha</label><input type="date" id="ev-fecha" value="${v.fecha||''}" /></div>
        <div class="form-group"><label>Hora</label><input type="time" id="ev-hora" value="${v.hora||''}" /></div>
        <div class="form-group"><label>Turno</label>
          <select id="ev-turno">
            ${['','1','2','3'].map(t=>`<option value="${t}" ${v.turno===t?'selected':''}>${t||'—'}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Línea</label>
          <select id="ev-linea">
            ${lineas.map(l=>`<option value="${l}" ${v.linea===l?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Solicita</label><input type="text" id="ev-solicita" value="${v.solicita||''}" /></div>
        <div class="form-group"><label>Adiciona</label><input type="text" id="ev-adiciona" value="${v.adiciona||''}" /></div>
        <div class="form-group"><label>Coordinador</label><input type="text" id="ev-coord" value="${v.coordinador||''}" /></div>
        <div class="form-group" style="grid-column:1/-1"><label>Comentarios</label><input type="text" id="ev-coments" value="${v.comentarios||''}" /></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" id="btn-ev-save">Guardar cambios</button>
      </div>`);
    document.getElementById('btn-ev-save').addEventListener('click', async () => {
      const btn = document.getElementById('btn-ev-save');
      btn.disabled = true; btn.textContent = 'Guardando...';
      try {
        await PATCH('/vales/' + folio, {
          fecha:       document.getElementById('ev-fecha').value,
          hora:        document.getElementById('ev-hora').value,
          turno:       document.getElementById('ev-turno').value,
          linea:       document.getElementById('ev-linea').value,
          solicita:    document.getElementById('ev-solicita').value,
          adiciona:    document.getElementById('ev-adiciona').value,
          coordinador: document.getElementById('ev-coord').value,
          comentarios: document.getElementById('ev-coments').value
        });
        closeModal();
        navigate('consulta-vales');
      } catch(e) { alert('Error: ' + e.message); btn.disabled = false; btn.textContent = 'Guardar cambios'; }
    });
  } catch(e) { alert('Error: ' + e.message); }
};

// ── Editar línea de detalle (admin) ───────────────────────────────────────────
window.editDetalle = async function(folio, detalleId) {
  try {
    const v = await GET('/vales/' + folio);
    const d = (v.detalle || []).find(x => x.id === detalleId);
    if (!d) { alert('Línea no encontrada'); return; }
    const TIPOS = ['KG','TAMBO','PORRON_15L','LITRO'];
    showModal(`
      <h3>✏️ Editar línea — ${folio}</h3>
      <p style="color:#78716c;font-size:13px;margin-bottom:14px">
        <strong>${d.item}</strong> · ${d.no_tanque} ${d.nombre_tanque}
      </p>
      <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div class="form-group"><label>Tipo de adición</label>
          <select id="ed-tipo">
            ${TIPOS.map(t=>`<option value="${t}" ${d.tipo_adicion===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Cantidad</label>
          <input type="number" id="ed-cant" step="0.001" min="0" value="${d.cantidad||0}" />
        </div>
        <div class="form-group" style="grid-column:1/-1"><label>Titulación</label>
          <input type="text" id="ed-tit" value="${d.titulacion||''}" />
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" id="btn-ed-save">Guardar cambios</button>
      </div>`);
    document.getElementById('btn-ed-save').addEventListener('click', async () => {
      const btn = document.getElementById('btn-ed-save');
      btn.disabled = true; btn.textContent = 'Guardando...';
      try {
        await PATCH('/vales/' + folio + '/detalle/' + detalleId, {
          tipo_adicion: document.getElementById('ed-tipo').value,
          cantidad:     parseFloat(document.getElementById('ed-cant').value) || 0,
          titulacion:   document.getElementById('ed-tit').value
        });
        closeModal();
        verVale(folio);
      } catch(e) { alert('Error: ' + e.message); btn.disabled = false; btn.textContent = 'Guardar cambios'; }
    });
  } catch(e) { alert('Error: ' + e.message); }
};

// ── Reportes de Consumo (admin) ───────────────────────────────────────────────
// Estado del navegador de períodos
const RPS = { tipo: 'semana', fecha: today(), linea: '', modo: 'kg', _data: null, _charts: {} };

function navFecha(dir) {
  const d = new Date(RPS.fecha + 'T12:00:00Z');
  if (RPS.tipo === 'semana') {
    d.setUTCDate(d.getUTCDate() + dir * 7);
  } else if (RPS.tipo === 'mes') {
    d.setUTCMonth(d.getUTCMonth() + dir);
    d.setUTCDate(1);
  } else {
    d.setUTCFullYear(d.getUTCFullYear() + dir);
  }
  RPS.fecha = d.toISOString().slice(0, 10);
}

async function viewReportes() {
  const lineas = await GET('/lineas').catch(() => []);
  const _hoy = today();
  const _d30 = new Date(_hoy + 'T12:00:00Z'); _d30.setUTCDate(_d30.getUTCDate() - 30);
  const _ini30 = _d30.toISOString().slice(0, 10);
  return `
  <!-- Tabs principales de Reportes -->
  <div class="tab-bar" style="display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid #e7e5e4">
    <button class="tab-btn tab-active" id="rpt-main-tab-consumo" onclick="switchRptMainTab('consumo')">📊 Consumo</button>
    <button class="tab-btn" id="rpt-main-tab-diario" onclick="switchRptMainTab('diario')">📅 Consumo Diario</button>
    <button class="tab-btn" id="rpt-main-tab-comp" onclick="switchRptMainTab('comp')">🔬 Real vs Teórico</button>
    <button class="tab-btn" id="rpt-main-tab-procesos" onclick="switchRptMainTab('procesos')">🏭 Reporte para Procesos</button>
    <button class="tab-btn" id="rpt-main-tab-poritem" onclick="switchRptMainTab('poritem')">📦 Reporte por ítem</button>
  </div>

  <!-- Panel: Consumo (existing content) -->
  <div id="rpt-panel-consumo">
  <!-- Barra de navegación -->
  <div class="rpt-nav">
    <div class="rpt-tipo-btns">
      <button class="rpt-tipo-btn${RPS.tipo==='semana'?' active':''}" onclick="rptSetTipo('semana')">Semana</button>
      <button class="rpt-tipo-btn${RPS.tipo==='mes'   ?' active':''}" onclick="rptSetTipo('mes')">Mes</button>
      <button class="rpt-tipo-btn${RPS.tipo==='anio'  ?' active':''}" onclick="rptSetTipo('anio')">Año</button>
    </div>
    <div class="rpt-period-nav">
      <button class="rpt-arrow" onclick="rptNav(-1)">◀</button>
      <span id="rpt-label" style="font-weight:700;font-size:14px;min-width:260px;text-align:center">—</span>
      <button class="rpt-arrow" onclick="rptNav(1)">▶</button>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <select id="rpt-linea" style="font-size:13px" onchange="rptSetLinea(this.value)">
        <option value="">Todas las líneas</option>
        ${lineas.map(l=>`<option value="${l}"${RPS.linea===l?' selected':''}>${l}</option>`).join('')}
      </select>
      <div style="display:flex;gap:2px;border:1px solid #d6d3d1;border-radius:6px;overflow:hidden">
        <button id="rpt-modo-kg"  class="btn btn-sm${RPS.modo==='kg'?' btn-primary':' btn-outline'}" style="border-radius:0;border:none" onclick="rptSetModo('kg')">kg</button>
        <button id="rpt-modo-mxn" class="btn btn-sm${RPS.modo==='mxn'?' btn-primary':' btn-outline'}" style="border-radius:0;border:none;border-left:1px solid #d6d3d1" onclick="rptSetModo('mxn')">$</button>
      </div>
      <button class="btn btn-outline btn-sm" onclick="rptExport()">📥 CSV</button>
    </div>
  </div>

  <!-- KPIs -->
  <div id="rpt-kpis" class="rpt-kpis"></div>

  <!-- Alerta de subida -->
  <div id="rpt-alertas"></div>

  <!-- Gráficas -->
  <div class="rpt-charts-grid">
    <div class="table-card">
      <div class="table-header"><h3>📈 Tendencia</h3><span id="rpt-vs-label" style="font-size:12px;color:#78716c"></span></div>
      <div style="padding:12px"><canvas id="chart-tendencia" height="200"></canvas></div>
    </div>
    <div class="table-card">
      <div class="table-header"><h3>🏆 Top productos (kg)</h3></div>
      <div style="padding:12px"><canvas id="chart-productos" height="200"></canvas></div>
    </div>
  </div>

  <!-- Tablas -->
  <div class="rpt-tables-grid">
    <div class="table-card">
      <div class="table-header"><h3>📦 Por Producto</h3></div>
      <div class="table-scroll" id="rpt-tabla-productos"></div>
    </div>
    <div class="table-card">
      <div class="table-header"><h3>🏭 Por Línea</h3></div>
      <div class="table-scroll" id="rpt-tabla-lineas"></div>
    </div>
  </div>
  </div><!-- end rpt-panel-consumo -->

  <!-- Panel: Reporte para Procesos -->
  <div id="rpt-panel-procesos" style="display:none">
    <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">
      <div><label class="flabel">Año</label><br>
        <select id="proc-year" style="font-size:13px">${[2024,2025,2026,2027].map(y=>`<option value="${y}"${y===new Date().getFullYear()?' selected':''}>${y}</option>`).join('')}</select>
      </div>
      <button class="btn btn-primary" id="proc-btn">🔍 Generar</button>
      <div style="display:flex;gap:2px;border:1px solid #d6d3d1;border-radius:6px;overflow:hidden">
        <button id="proc-periodo-week"  class="btn btn-sm btn-primary" style="border-radius:0;border:none" onclick="procSetPeriodo('week')">Semanas</button>
        <button id="proc-periodo-month" class="btn btn-sm btn-outline" style="border-radius:0;border:none;border-left:1px solid #d6d3d1" onclick="procSetPeriodo('month')">Meses</button>
      </div>
      <div style="display:flex;gap:2px;border:1px solid #d6d3d1;border-radius:6px;overflow:hidden">
        <button id="proc-modo-kg"  class="btn btn-sm btn-primary" style="border-radius:0;border:none" onclick="procSetModo('kg')">kg</button>
        <button id="proc-modo-mxn" class="btn btn-sm btn-outline" style="border-radius:0;border:none;border-left:1px solid #d6d3d1" onclick="procSetModo('mxn')">$</button>
      </div>
      <button class="btn btn-outline" id="proc-export-btn">📥 CSV</button>
    </div>
    <div id="proc-result"></div>
  </div>

  <!-- Panel: Comparativo Real vs Teórico -->
  <div id="rpt-panel-comp" style="display:none">
    <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">
      <div><label class="flabel">Año</label><br>
        <select id="comp-year" style="font-size:13px">${[2025,2026,2027].map(y=>`<option value="${y}"${y===new Date().getFullYear()?' selected':''}>${y}</option>`).join('')}</select>
      </div>
      <div><label class="flabel">Semana inicio</label><br><input type="number" id="comp-w-ini" value="1" min="1" max="52" style="width:70px;font-size:13px"/></div>
      <div><label class="flabel">Semana fin</label><br><input type="number" id="comp-w-fin" value="${new Date().getMonth()*4+4}" min="1" max="52" style="width:70px;font-size:13px"/></div>
      <button class="btn btn-primary" id="comp-btn">🔍 Calcular</button>
      <button class="btn btn-outline" id="comp-export-btn">📥 CSV</button>
    </div>
    <div id="comp-result"></div>
  </div>

  <!-- Panel: Reporte por ítem -->
  <div id="rpt-panel-poritem" style="display:none">
    <!-- Barra superior: año + toggles + acción -->
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px;padding:12px 16px;background:#fff;border:1px solid #e7e5e4;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.05)">
      <div>
        <div class="flabel" style="margin-bottom:3px">Año</div>
        <select id="pi-year" style="font-size:13px;border:1px solid #d6d3d1;border-radius:6px;padding:4px 8px">${[2024,2025,2026,2027].map(y=>`<option value="${y}"${y===new Date().getFullYear()?' selected':''}>${y}</option>`).join('')}</select>
      </div>
      <div>
        <div class="flabel" style="margin-bottom:3px">Período</div>
        <div style="display:flex;gap:0;border:1px solid #d6d3d1;border-radius:6px;overflow:hidden">
          <button id="pi-periodo-week"  class="btn btn-sm btn-primary" style="border-radius:0;border:none;padding:5px 12px" onclick="piSetPeriodo('week')">Semanas</button>
          <button id="pi-periodo-month" class="btn btn-sm btn-outline" style="border-radius:0;border:none;border-left:1px solid #d6d3d1;padding:5px 12px" onclick="piSetPeriodo('month')">Meses</button>
        </div>
      </div>
      <div>
        <div class="flabel" style="margin-bottom:3px">Unidad</div>
        <div style="display:flex;gap:0;border:1px solid #d6d3d1;border-radius:6px;overflow:hidden">
          <button id="pi-modo-kg"  class="btn btn-sm btn-primary" style="border-radius:0;border:none;padding:5px 14px" onclick="piSetModo('kg')">kg</button>
          <button id="pi-modo-mxn" class="btn btn-sm btn-outline" style="border-radius:0;border:none;border-left:1px solid #d6d3d1;padding:5px 14px" onclick="piSetModo('mxn')">$</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:flex-end;margin-left:4px">
        <button class="btn btn-primary" id="pi-btn" style="padding:6px 18px">🔍 Generar</button>
        <button class="btn btn-outline" id="pi-export-btn" style="padding:6px 14px">📥 CSV</button>
      </div>
    </div>

    <!-- Panel de filtros (aparece tras cargar datos) -->
    <div id="pi-filtros" style="display:none;margin-bottom:14px;padding:14px 16px;background:#fafaf9;border:1px solid #e7e5e4;border-radius:10px">
      <div style="display:grid;gap:14px">

        <!-- Líneas -->
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span style="font-size:11px;font-weight:700;color:#78716c;text-transform:uppercase;letter-spacing:.5px">🏭 Líneas</span>
            <button onclick="piSelAll('lineas',true)"  style="font-size:11px;color:#2563eb;background:none;border:none;cursor:pointer;padding:0">Todas</button>
            <button onclick="piSelAll('lineas',false)" style="font-size:11px;color:#9ca3af;background:none;border:none;cursor:pointer;padding:0">Ninguna</button>
          </div>
          <div id="pi-pills-lineas" style="display:flex;gap:6px;flex-wrap:wrap"></div>
        </div>

        <!-- Tanques (dependiente de líneas) -->
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span style="font-size:11px;font-weight:700;color:#78716c;text-transform:uppercase;letter-spacing:.5px">🪣 Tanques</span>
            <button onclick="piSelAll('tanques',true)"  style="font-size:11px;color:#2563eb;background:none;border:none;cursor:pointer;padding:0">Todos</button>
            <button onclick="piSelAll('tanques',false)" style="font-size:11px;color:#9ca3af;background:none;border:none;cursor:pointer;padding:0">Ninguno</button>
          </div>
          <div id="pi-pills-tanques" style="display:flex;gap:6px;flex-wrap:wrap"></div>
        </div>

        <!-- Buscar ítem -->
        <div>
          <div style="font-size:11px;font-weight:700;color:#78716c;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">🔍 Buscar ítem</div>
          <input type="text" id="pi-search-item" placeholder="Filtrar por nombre de ítem…"
            oninput="piSetItemSearch(this.value)"
            style="width:100%;max-width:340px;font-size:13px;padding:6px 10px;border:1px solid #d6d3d1;border-radius:6px;box-sizing:border-box"/>
        </div>
      </div>
    </div>

    <div id="pi-result"></div>
  </div>

  <!-- Panel: Consumo Diario -->
  <div id="rpt-panel-diario" style="display:none">
    <!-- Filtros únicos (tabla + gráfica comparten el mismo contexto) -->
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px;padding:12px 14px;background:#fafaf9;border:1px solid #e7e5e4;border-radius:8px">
      <div>
        <label class="flabel">Fecha inicio</label><br>
        <input type="date" id="dia-fecha-ini" value="${_ini30}" style="font-size:13px"/>
      </div>
      <div>
        <label class="flabel">Fecha fin</label><br>
        <input type="date" id="dia-fecha-fin" value="${_hoy}" style="font-size:13px"/>
      </div>
      <div>
        <label class="flabel">Línea</label><br>
        <select id="dia-linea" style="font-size:13px">
          <option value="">Todas las líneas</option>
        </select>
      </div>
      <div>
        <label class="flabel">Tanque</label><br>
        <select id="dia-tanque" style="font-size:13px">
          <option value="">Todos los tanques</option>
        </select>
      </div>
      <div>
        <label class="flabel">Producto</label><br>
        <select id="dia-item" style="font-size:13px">
          <option value="">Todos</option>
        </select>
      </div>
      <button class="btn btn-primary btn-sm" id="dia-btn-consultar">🔍 Consultar</button>
      <button class="btn btn-outline btn-sm" id="dia-btn-csv">📥 CSV datos filtrados</button>
    </div>

    <!-- Tabla resultado -->
    <div class="table-card" style="margin-bottom:16px">
      <div class="table-header">
        <h3>📋 Consumo por Día · Línea · Tanque · Producto</h3>
        <span id="dia-tabla-totales" style="font-size:12px;color:#78716c"></span>
      </div>
      <div class="table-scroll" id="dia-tabla-body">
        <div class="empty-state" style="padding:24px"><div class="icon">📅</div><p>Selecciona un rango de fechas y consulta</p></div>
      </div>
    </div>

    <!-- Gráfica — controles solo granularidad + unidad -->
    <div class="table-card">
      <div class="table-header" style="flex-wrap:wrap;gap:8px">
        <h3>📈 Adiciones · <em id="dia-graf-item-label" style="font-style:normal;color:#d97706">haz clic en un producto de la tabla</em></h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div style="display:flex;gap:2px;border:1px solid #d6d3d1;border-radius:6px;overflow:hidden">
            <button id="dia-gran-turno"  class="btn btn-sm btn-outline"  style="border-radius:0;border:none"                            onclick="diaSetGran('turno')">Turno</button>
            <button id="dia-gran-dia"    class="btn btn-sm btn-primary"  style="border-radius:0;border:none;border-left:1px solid #d6d3d1" onclick="diaSetGran('dia')">Día</button>
            <button id="dia-gran-semana" class="btn btn-sm btn-outline"  style="border-radius:0;border:none;border-left:1px solid #d6d3d1" onclick="diaSetGran('semana')">Semana</button>
            <button id="dia-gran-mes"    class="btn btn-sm btn-outline"  style="border-radius:0;border:none;border-left:1px solid #d6d3d1" onclick="diaSetGran('mes')">Mes</button>
          </div>
          <div style="display:flex;gap:2px;border:1px solid #d6d3d1;border-radius:6px;overflow:hidden">
            <button id="dia-modo-kg"  class="btn btn-sm btn-primary" style="border-radius:0;border:none"                            onclick="diaSetModo('kg')">kg</button>
            <button id="dia-modo-mxn" class="btn btn-sm btn-outline" style="border-radius:0;border:none;border-left:1px solid #d6d3d1" onclick="diaSetModo('$')">$</button>
          </div>
        </div>
      </div>
      <div style="padding:8px 14px 0">
        <div id="dia-graf-titulo" style="display:none;padding:7px 12px;background:#fef9c3;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#78350f;line-height:1.6"></div>
      </div>
      <div style="padding:8px 12px 12px">
        <div id="dia-graf-container" style="height:400px;position:relative;overflow:hidden">
          <div class="empty-state" style="padding:24px"><div class="icon">📈</div><p>Haz clic en un producto de la tabla para ver su gráfica</p></div>
        </div>
      </div>
    </div>
  </div>`;
}

function bindReportes() {
  window.rptSetTipo = function(t) {
    RPS.tipo = t;
    RPS.fecha = today();
    rptLoad();
  };
  window.rptNav = function(dir) {
    navFecha(dir);
    rptLoad();
  };
  window.rptSetLinea = function(l) {
    RPS.linea = l;
    rptLoad();
  };
  window.rptSetModo = function(m) {
    RPS.modo = m;
    document.getElementById('rpt-modo-kg') ?.classList.toggle('btn-primary', m === 'kg');
    document.getElementById('rpt-modo-kg') ?.classList.toggle('btn-outline',  m !== 'kg');
    document.getElementById('rpt-modo-mxn')?.classList.toggle('btn-primary', m === 'mxn');
    document.getElementById('rpt-modo-mxn')?.classList.toggle('btn-outline',  m !== 'mxn');
    if (RPS._data) renderRptTables(RPS._data);
  };
  window.rptExport = function() {
    const d = RPS._data;
    if (!d) return;
    const hdr = ['Producto', `${d.periodoActual.label} (kg)`, `${d.periodoAnterior.label} (kg)`, 'Δ kg', 'Δ %'];
    const rows = d.byProducto.map(r => [
      `"${r.item}"`, r.actual.toFixed(3), r.anterior.toFixed(3),
      r.delta.toFixed(3), r.pct.toFixed(1)+'%'
    ].join(','));
    const csv = [hdr.join(','), ...rows].join('\r\n');
    const blob = new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `consumos_${RPS.tipo}_${RPS.fecha}.csv`;
    a.click();
  };

  window.switchRptMainTab = function(tab) {
    ['consumo','diario','comp','procesos','poritem'].forEach(t => {
      const panel = document.getElementById(`rpt-panel-${t}`);
      const btn   = document.getElementById(`rpt-main-tab-${t}`);
      if (panel) panel.style.display = t === tab ? '' : 'none';
      if (btn)   btn.classList.toggle('tab-active', t === tab);
    });
    if (tab === 'diario') diaInitFiltros();
  };

  const runComparativo = async () => {
    const year  = document.getElementById('comp-year').value;
    const wIni  = document.getElementById('comp-w-ini').value;
    const wFin  = document.getElementById('comp-w-fin').value;
    const res   = document.getElementById('comp-result');
    res.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Calculando...</p></div>';
    try {
      const d = await GET(`/reportes/comparativo?year=${year}&week_ini=${wIni}&week_fin=${wFin}`);
      if (!d.items || d.items.length === 0) {
        res.innerHTML = '<div class="empty-state"><div class="icon">🔬</div><p>Sin datos para comparar. Asegúrate de que los ítems de Compras tengan el campo "Ítem en Vales" configurado y haya capturas semanales registradas.</p></div>';
        return;
      }
      window._compData = d;
      res.innerHTML = d.items.map(item => {
        const totalReal = item.weeks.reduce((s,w) => s + (w.consumo_real_kg||0), 0);
        const totalTeo  = item.weeks.reduce((s,w) => s + (w.consumo_teorico_kg||0), 0);
        const diff = totalReal - totalTeo;
        const pct  = totalTeo > 0 ? (diff/totalTeo)*100 : null;
        const alerta = pct !== null && Math.abs(pct) > 15;
        return `
        <div class="table-card" style="margin-bottom:16px">
          <div class="table-header">
            <h3>${item.item}</h3>
            <div style="display:flex;gap:8px;align-items:center;font-size:12px">
              ${alerta ? `<span style="background:#fef3c7;color:#92400e;padding:3px 8px;border-radius:6px;font-weight:700">⚠️ Diferencia ${pct!==null?pct.toFixed(1)+'%':''}</span>` : ''}
              <span style="color:#78716c">Real: <strong>${totalReal.toFixed(1)} kg</strong></span>
              <span style="color:#78716c">Teórico: <strong>${totalTeo.toFixed(1)} kg</strong></span>
            </div>
          </div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Semana</th><th style="text-align:right">Stock (${item.unidad})</th><th style="text-align:right">Pedido recibido</th><th style="text-align:right">Consumo Real (kg)</th><th style="text-align:right">Consumo Vales (kg)</th><th style="text-align:right">Diferencia (kg)</th><th>Estado</th></tr></thead>
              <tbody>${item.weeks.map(w => {
                const d2 = w.diferencia;
                const p2 = w.pct_diferencia;
                const clr = d2===null?'#a8a29e':Math.abs(p2||0)>15?'#dc2626':'#16a34a';
                return `<tr>
                  <td>S${w.week}</td>
                  <td style="text-align:right">${w.stock_actual!==null?w.stock_actual:'—'}</td>
                  <td style="text-align:right;color:#16a34a">${w.pedido_recibido||0}</td>
                  <td style="text-align:right;font-weight:600">${w.consumo_real_kg!==null?w.consumo_real_kg.toFixed(2):'—'}</td>
                  <td style="text-align:right">${w.consumo_teorico_kg.toFixed(2)}</td>
                  <td style="text-align:right;font-weight:600;color:${clr}">${d2!==null?(d2>0?'+':'')+d2.toFixed(2):'—'}</td>
                  <td><span style="font-size:11px;padding:2px 6px;border-radius:4px;background:${Math.abs(p2||0)>15?'#fef3c7':'#f0fff4'};color:${clr}">${p2!==null?(Math.abs(p2)>15?'⚠️ ':'')+p2.toFixed(1)+'%':'—'}</span></td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </div>`;
      }).join('');
    } catch(e) { res.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`; }
  };

  // ── Tab: Reporte para Procesos ──────────────────────────────────────────────
  let _procData = null;
  let _procModo    = 'kg';
  let _procPeriodo = 'week';

  window.procSetModo = function(m) {
    _procModo = m;
    document.getElementById('proc-modo-kg') ?.classList.toggle('btn-primary', m === 'kg');
    document.getElementById('proc-modo-kg') ?.classList.toggle('btn-outline',  m !== 'kg');
    document.getElementById('proc-modo-mxn')?.classList.toggle('btn-primary', m === 'mxn');
    document.getElementById('proc-modo-mxn')?.classList.toggle('btn-outline',  m !== 'mxn');
    if (_procData) renderProcesos(_procData, _procModo, _procPeriodo);
  };

  window.procSetPeriodo = function(p) {
    _procPeriodo = p;
    document.getElementById('proc-periodo-week') ?.classList.toggle('btn-primary', p === 'week');
    document.getElementById('proc-periodo-week') ?.classList.toggle('btn-outline',  p !== 'week');
    document.getElementById('proc-periodo-month')?.classList.toggle('btn-primary', p === 'month');
    document.getElementById('proc-periodo-month')?.classList.toggle('btn-outline',  p !== 'month');
    if (_procData) renderProcesos(_procData, _procModo, _procPeriodo);
  };

  const MESES_PROC = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  function fmtProc(cell, modo) {
    if (!cell) return '<span style="color:#e7e5e4">—</span>';
    if (modo === 'mxn') return cell.mxn > 0 ? `$${cell.mxn.toLocaleString('es-MX',{maximumFractionDigits:0})}` : '<span style="color:#e7e5e4">—</span>';
    return cell.kg > 0 ? cell.kg.toFixed(1) : '<span style="color:#e7e5e4">—</span>';
  }

  function renderProcesos(data, modo, periodo = 'week') {
    const res = document.getElementById('proc-result');
    if (!data || !data.lineas || data.lineas.length === 0) {
      res.innerHTML = '<div class="empty-state"><div class="icon">🏭</div><p>Sin datos para este año.</p></div>';
      return;
    }
    const showWeeks  = periodo === 'week';
    const showMonths = periodo === 'month';
    const weeks  = showWeeks  ? data.weeks  : [];
    const months = showMonths ? data.months : [];

    // Paleta KPI Costos (azul/slate)
    const C = {
      thead:      { bg: '#1d4ed8', color: '#fff' },
      theadMonth: { bg: '#1e40af', color: '#bfdbfe' },
      theadTotal: { bg: '#1e3a8a', color: '#fff' },
      linea:      { bg: '#1e3a8a', color: '#fff', sticky: '#1e3a8a' },
      lineaMes:   { bg: '#1e40af', color: '#bfdbfe' },
      lineaTot:   { bg: '#172554', color: '#fff' },
      tipo:       { bg: '#dbeafe', color: '#1e40af', sticky: '#dbeafe' },
      tipoMes:    { bg: '#bfdbfe', color: '#1e40af' },
      tipoTot:    { bg: '#93c5fd', color: '#1e3a8a' },
      item:       { bg: '#fff',    color: '#374151', sticky: '#fff' },
      itemMes:    { bg: '#eff6ff', color: '#374151' },
      itemTot:    { bg: '#dbeafe', color: '#1e40af' },
    };

    // Header row
    const thWeeks  = weeks.map(w  => `<th style="text-align:right;min-width:60px;font-size:11px;white-space:nowrap;background:${C.thead.bg};color:${C.thead.color}">S${w}</th>`).join('');
    const thMonths = months.map(m => `<th style="text-align:right;min-width:72px;font-size:11px;white-space:nowrap;background:${C.theadMonth.bg};color:${C.theadMonth.color}">${MESES_PROC[m-1]}</th>`).join('');
    const thTotal  = `<th style="text-align:right;min-width:80px;font-size:11px;font-weight:700;background:${C.theadTotal.bg};color:${C.theadTotal.color}">TOTAL</th>`;

    let rows = '';
    data.lineas.forEach(linea => {
      // Fila TOTAL línea
      const lwCells = weeks.map(w  => `<td style="text-align:right;font-weight:700;font-size:12px;background:${C.linea.bg};color:${C.linea.color}">${fmtProc(linea.weeks[w], modo)}</td>`).join('');
      const lmCells = months.map(m => `<td style="text-align:right;font-weight:700;font-size:12px;background:${C.lineaMes.bg};color:${C.lineaMes.color}">${fmtProc(linea.months[m], modo)}</td>`).join('');
      const ltCell  = `<td style="text-align:right;font-weight:700;font-size:12px;background:${C.lineaTot.bg};color:${C.lineaTot.color}">${fmtProc(linea.total, modo)}</td>`;
      rows += `<tr>
        <td style="font-weight:800;padding:7px 10px;font-size:13px;white-space:nowrap;position:sticky;left:0;background:${C.linea.sticky};color:${C.linea.color};z-index:2;border-top:2px solid #1d4ed8">${linea.linea}</td>
        ${lwCells}${lmCells}${ltCell}
      </tr>`;

      linea.tipos.forEach(tipo => {
        // Fila subtotal por tipo
        const twCells = weeks.map(w  => `<td style="text-align:right;font-weight:600;font-size:12px;background:${C.tipo.bg};color:${C.tipo.color}">${fmtProc(tipo.weeks[w], modo)}</td>`).join('');
        const tmCells = months.map(m => `<td style="text-align:right;font-weight:600;font-size:12px;background:${C.tipoMes.bg};color:${C.tipo.color}">${fmtProc(tipo.months[m], modo)}</td>`).join('');
        const ttCell  = `<td style="text-align:right;font-weight:700;font-size:12px;background:${C.tipoTot.bg};color:${C.linea.bg}">${fmtProc(tipo.total, modo)}</td>`;
        rows += `<tr>
          <td style="padding:5px 10px 5px 22px;font-size:12px;font-weight:700;white-space:nowrap;position:sticky;left:0;background:${C.tipo.sticky};color:${C.tipo.color};z-index:2">↳ ${tipo.tipo}</td>
          ${twCells}${tmCells}${ttCell}
        </tr>`;

        tipo.items.forEach(item => {
          // Fila por ítem
          const iwCells = weeks.map(w  => `<td style="text-align:right;font-size:11px;background:${C.item.bg};color:${C.item.color}">${fmtProc(item.weeks[w], modo)}</td>`).join('');
          const imCells = months.map(m => `<td style="text-align:right;font-size:11px;background:${C.itemMes.bg};color:${C.item.color}">${fmtProc(item.months[m], modo)}</td>`).join('');
          const itCell  = `<td style="text-align:right;font-size:11px;font-weight:600;background:${C.itemTot.bg};color:${C.tipo.color}">${fmtProc(item.total, modo)}</td>`;
          rows += `<tr>
            <td style="padding:3px 10px 3px 38px;font-size:11px;color:#374151;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis;position:sticky;left:0;background:${C.item.sticky};z-index:2" title="${item.item}">${item.item}</td>
            ${iwCells}${imCells}${itCell}
          </tr>`;
        });
      });
    });

    res.innerHTML = `
    <div class="table-card">
      <div style="overflow-x:auto;max-height:70vh;overflow-y:auto">
        <table style="border-collapse:collapse;font-size:12px;min-width:100%">
          <thead style="position:sticky;top:0;z-index:3">
            <tr>
              <th style="text-align:left;padding:8px 10px;min-width:220px;position:sticky;left:0;background:${C.thead.bg};color:${C.thead.color};z-index:4">Línea / Tipo / Ítem</th>
              ${thWeeks}
              ${thMonths}
              ${thTotal}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }

  const runProcesos = async () => {
    const year = document.getElementById('proc-year').value;
    const res  = document.getElementById('proc-result');
    res.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Generando reporte...</p></div>';
    try {
      const data = await GET(`/reportes/procesos?year=${year}`);
      _procData = data;
      renderProcesos(data, _procModo, _procPeriodo);
    } catch(e) { res.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`; }
  };

  document.getElementById('proc-btn').addEventListener('click', runProcesos);
  document.getElementById('proc-export-btn').addEventListener('click', () => {
    if (!_procData) { alert('Primero genera el reporte'); return; }
    const data = _procData;
    const weeks  = data.weeks;
    const months = data.months;
    const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const hdr = ['Línea','Tipo','Ítem', ...weeks.map(w=>`S${w} kg`), ...weeks.map(w=>`S${w} $`), ...months.map(m=>MESES[m-1]+' kg'), ...months.map(m=>MESES[m-1]+' $'), 'Total kg','Total $'];
    const csvRows = [hdr.join(',')];
    data.lineas.forEach(l => l.tipos.forEach(t => t.items.forEach(it => {
      const wKg  = weeks.map(w => (it.weeks[w]?.kg  || 0).toFixed(3));
      const wMxn = weeks.map(w => (it.weeks[w]?.mxn || 0).toFixed(2));
      const mKg  = months.map(m => (it.months[m]?.kg  || 0).toFixed(3));
      const mMxn = months.map(m => (it.months[m]?.mxn || 0).toFixed(2));
      csvRows.push([`"${l.linea}"`,`"${t.tipo}"`,`"${it.item}"`, ...wKg,...wMxn,...mKg,...mMxn, it.total.kg.toFixed(3), it.total.mxn.toFixed(2)].join(','));
    })));
    const blob = new Blob(['\uFEFF'+csvRows.join('\r\n')], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `procesos_${data.year}.csv`; a.click();
  });
  // ── fin Tab Procesos ──────────────────────────────────────────────────────────

  // ── Tab: Reporte por ítem ─────────────────────────────────────────────────────
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let _piData       = null;
  let _piModo       = 'kg';
  let _piPeriodo    = 'week';
  let _piLineas     = new Set();   // líneas activas
  let _piTanques    = new Set();   // tanques activos
  let _piItemSearch = '';
  // linea → Set de tanques que tienen datos en esa línea
  let _piLtMap      = {};

  // Pill helpers
  const PILL_ON  = 'display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid #2563eb;background:#2563eb;color:#fff;transition:all .15s';
  const PILL_OFF = 'display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid #d6d3d1;background:#f5f5f4;color:#78716c;transition:all .15s';
  const PILL_DIS = 'display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:20px;font-size:12px;cursor:default;border:1.5px solid #e7e5e4;background:#fafaf9;color:#c4b5a5;opacity:.6';

  function piRenderLinePills() {
    const el = document.getElementById('pi-pills-lineas');
    if (!el || !_piData) return;
    el.innerHTML = _piData.lineas.map(l =>
      `<button style="${_piLineas.has(l) ? PILL_ON : PILL_OFF}" onclick="piToggleLinea('${esc(l)}')">${esc(l)}</button>`
    ).join('');
  }

  function piGetAvailableTanques() {
    // tanques que existen en al menos una línea activa
    const avail = new Set();
    for (const linea of _piLineas) {
      (_piLtMap[linea] || []).forEach(t => avail.add(t));
    }
    return avail;
  }

  function piRenderTanquePills() {
    const el = document.getElementById('pi-pills-tanques');
    if (!el || !_piData) return;
    const avail = piGetAvailableTanques();
    el.innerHTML = _piData.tanques.map(t => {
      if (!avail.has(t)) return `<span style="${PILL_DIS}">${esc(t)}</span>`;
      return `<button style="${_piTanques.has(t) ? PILL_ON : PILL_OFF}" onclick="piToggleTanque('${esc(t)}')">${esc(t)}</button>`;
    }).join('');
  }

  window.piToggleLinea = function(linea) {
    if (_piLineas.has(linea)) _piLineas.delete(linea); else _piLineas.add(linea);
    // Remove tanques that are no longer available from active set
    const avail = piGetAvailableTanques();
    for (const t of [..._piTanques]) { if (!avail.has(t)) _piTanques.delete(t); }
    // Auto-add tanques of newly activated línea
    if (_piLineas.has(linea)) (_piLtMap[linea] || []).forEach(t => _piTanques.add(t));
    piRenderLinePills();
    piRenderTanquePills();
    if (_piData) renderPorItem();
  };

  window.piToggleTanque = function(tanque) {
    if (_piTanques.has(tanque)) _piTanques.delete(tanque); else _piTanques.add(tanque);
    piRenderTanquePills();
    if (_piData) renderPorItem();
  };

  window.piSelAll = function(group, val) {
    if (group === 'lineas') {
      _piData.lineas.forEach(l => val ? _piLineas.add(l) : _piLineas.delete(l));
      if (val) _piData.tanques.forEach(t => _piTanques.add(t));
      else     _piTanques.clear();
    } else {
      const avail = piGetAvailableTanques();
      avail.forEach(t => val ? _piTanques.add(t) : _piTanques.delete(t));
    }
    piRenderLinePills();
    piRenderTanquePills();
    if (_piData) renderPorItem();
  };

  window.piSetItemSearch = function(v) {
    _piItemSearch = v;
    if (_piData) renderPorItem();
  };

  window.piSetModo = function(m) {
    _piModo = m;
    document.getElementById('pi-modo-kg') ?.classList.toggle('btn-primary', m === 'kg');
    document.getElementById('pi-modo-kg') ?.classList.toggle('btn-outline',  m !== 'kg');
    document.getElementById('pi-modo-mxn')?.classList.toggle('btn-primary', m === 'mxn');
    document.getElementById('pi-modo-mxn')?.classList.toggle('btn-outline',  m !== 'mxn');
    if (_piData) renderPorItem();
  };

  window.piSetPeriodo = function(p) {
    _piPeriodo = p;
    document.getElementById('pi-periodo-week') ?.classList.toggle('btn-primary', p === 'week');
    document.getElementById('pi-periodo-week') ?.classList.toggle('btn-outline',  p !== 'week');
    document.getElementById('pi-periodo-month')?.classList.toggle('btn-primary', p === 'month');
    document.getElementById('pi-periodo-month')?.classList.toggle('btn-outline',  p !== 'month');
    if (_piData) renderPorItem();
  };

  function piCellFromBLT(it, periodKey, periodo) {
    let kg = 0, mxn = 0;
    for (const [ltKey, ltd] of Object.entries(it.by_linea_tanque)) {
      const sep = ltKey.indexOf('|');
      const linea  = ltKey.slice(0, sep);
      const tanque = ltKey.slice(sep + 1);
      if (!_piLineas.has(linea) || !_piTanques.has(tanque)) continue;
      const src = periodo === 'week' ? ltd.weeks : ltd.months;
      if (src[periodKey]) { kg += src[periodKey].kg; mxn += src[periodKey].mxn; }
    }
    return { kg, mxn };
  }

  const MESES_PI = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  function fmtPI(cell, modo) {
    if (!cell || (cell.kg === 0 && cell.mxn === 0)) return '<span style="color:#e7e5e4">—</span>';
    if (modo === 'mxn') return cell.mxn > 0 ? `$${cell.mxn.toLocaleString('es-MX',{maximumFractionDigits:0})}` : '<span style="color:#e7e5e4">—</span>';
    return cell.kg > 0 ? cell.kg.toFixed(1) : '<span style="color:#e7e5e4">—</span>';
  }

  function renderPorItem() {
    const res = document.getElementById('pi-result');
    if (!_piData || !_piData.items.length) {
      res.innerHTML = '<div class="empty-state"><div class="icon">📦</div><p>Sin datos para este año.</p></div>';
      return;
    }
    const C = {
      thead:    { bg: '#1d4ed8', color: '#fff' },
      theadM:   { bg: '#1e40af', color: '#bfdbfe' },
      theadTot: { bg: '#1e3a8a', color: '#fff' },
      item:     { bg: '#fff',    color: '#374151' },
      itemMes:  { bg: '#eff6ff', color: '#374151' },
      itemTot:  { bg: '#dbeafe', color: '#1e40af' },
    };

    const periodo   = _piPeriodo;
    const periods   = periodo === 'week' ? _piData.weeks : _piData.months;
    const isFiltered = _piLineas.size < _piData.lineas.length || _piTanques.size < _piData.tanques.length;
    const search    = _piItemSearch.trim().toLowerCase();

    const thPeriods = periods.map(p => {
      const lbl = periodo === 'week' ? `S${p}` : MESES_PI[p-1];
      const bg  = periodo === 'week' ? C.thead.bg : C.theadM.bg;
      const clr = periodo === 'week' ? C.thead.color : C.theadM.color;
      return `<th style="text-align:right;min-width:60px;font-size:11px;white-space:nowrap;background:${bg};color:${clr}">${lbl}</th>`;
    }).join('');
    const thTotal = `<th style="text-align:right;min-width:80px;font-size:11px;font-weight:700;background:${C.theadTot.bg};color:${C.theadTot.color}">TOTAL</th>`;

    let rows = '';
    for (const it of _piData.items) {
      if (search && !it.item.toLowerCase().includes(search)) continue;
      let totalKg = 0, totalMxn = 0;
      const pCells = periods.map(p => {
        const cell = isFiltered ? piCellFromBLT(it, p, periodo) : (periodo === 'week' ? it.weeks[p] : it.months[p]);
        if (cell) { totalKg += cell.kg || 0; totalMxn += cell.mxn || 0; }
        const bg = periodo === 'week' ? C.item.bg : C.itemMes.bg;
        return `<td style="text-align:right;font-size:11px;background:${bg};color:${C.item.color}">${fmtPI(cell, _piModo)}</td>`;
      }).join('');
      if (!totalKg && !totalMxn) continue;
      rows += `<tr>
        <td style="padding:5px 10px;font-size:12px;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis;position:sticky;left:0;background:${C.item.bg};color:${C.item.color};z-index:2;border-bottom:1px solid #f3f4f6" title="${esc(it.item)}">${esc(it.item)}</td>
        ${pCells}
        <td style="text-align:right;font-size:11px;font-weight:700;background:${C.itemTot.bg};color:${C.theadTot.bg}">${fmtPI({kg:totalKg,mxn:totalMxn}, _piModo)}</td>
      </tr>`;
    }

    if (!rows) {
      res.innerHTML = '<div class="empty-state"><div class="icon">📦</div><p>Sin datos con los filtros seleccionados.</p></div>';
      return;
    }

    res.innerHTML = `
    <div class="table-card">
      <div style="overflow-x:auto;max-height:70vh;overflow-y:auto">
        <table style="border-collapse:collapse;font-size:12px;min-width:100%">
          <thead style="position:sticky;top:0;z-index:3">
            <tr>
              <th style="text-align:left;padding:8px 10px;min-width:220px;position:sticky;left:0;background:${C.thead.bg};color:${C.thead.color};z-index:4">Ítem</th>
              ${thPeriods}
              ${thTotal}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }

  const runPorItem = async () => {
    const year = document.getElementById('pi-year').value;
    const res  = document.getElementById('pi-result');
    res.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Generando reporte...</p></div>';
    try {
      const data = await GET(`/reportes/por-item?year=${year}`);
      _piData    = data;
      _piLineas  = new Set(data.lineas);
      _piTanques = new Set(data.tanques);

      // Build linea→tanques map from by_linea_tanque keys across all items
      _piLtMap = {};
      for (const it of data.items) {
        for (const ltKey of Object.keys(it.by_linea_tanque)) {
          const sep    = ltKey.indexOf('|');
          const linea  = ltKey.slice(0, sep);
          const tanque = ltKey.slice(sep + 1);
          if (!_piLtMap[linea]) _piLtMap[linea] = new Set();
          _piLtMap[linea].add(tanque);
        }
      }

      // Reset item search
      _piItemSearch = '';
      const si = document.getElementById('pi-search-item');
      if (si) si.value = '';

      document.getElementById('pi-filtros').style.display = '';
      piRenderLinePills();
      piRenderTanquePills();
      renderPorItem();
    } catch(e) { res.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`; }
  };

  document.getElementById('pi-btn').addEventListener('click', runPorItem);

  document.getElementById('pi-export-btn').addEventListener('click', () => {
    if (!_piData) { alert('Primero genera el reporte'); return; }
    const data    = _piData;
    const periodo = _piPeriodo;
    const periods = periodo === 'week' ? data.weeks : data.months;
    const MESES   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const pHdr    = periods.map(p => periodo === 'week' ? `S${p} kg` : MESES[p-1] + ' kg');
    const pHdrMxn = periods.map(p => periodo === 'week' ? `S${p} $`  : MESES[p-1] + ' $');
    const hdr = ['Ítem', ...pHdr, ...pHdrMxn, 'Total kg', 'Total $'];
    const isFiltered = _piLineas.size < data.lineas.length || _piTanques.size < data.tanques.length;
    const search = _piItemSearch.trim().toLowerCase();
    const csvRows = [hdr.join(',')];
    for (const it of data.items) {
      if (search && !it.item.toLowerCase().includes(search)) continue;
      let totalKg = 0, totalMxn = 0;
      const wKg  = periods.map(p => { const c = isFiltered ? piCellFromBLT(it,p,periodo) : (periodo==='week'?it.weeks[p]:it.months[p]); totalKg += c?.kg||0; return (c?.kg||0).toFixed(3); });
      const wMxn = periods.map(p => { const c = isFiltered ? piCellFromBLT(it,p,periodo) : (periodo==='week'?it.weeks[p]:it.months[p]); totalMxn += c?.mxn||0; return (c?.mxn||0).toFixed(2); });
      if (!totalKg && !totalMxn) continue;
      csvRows.push([`"${it.item}"`, ...wKg, ...wMxn, totalKg.toFixed(3), totalMxn.toFixed(2)].join(','));
    }
    const blob = new Blob(['\uFEFF'+csvRows.join('\r\n')], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `por_item_${data.year}.csv`; a.click();
  });
  // ── fin Tab Reporte por ítem ───────────────────────────────────────────────────

  // ── Tab: Consumo Diario ───────────────────────────────────────────────────────
  const DIA = { gran: 'dia', modo: 'kg', _chart: null, _data: null, _chartData: null, _catItems: [] };

  // Poblar selects de filtros al iniciar el tab (solo catálogos)
  window.diaInitFiltros = async function() {
    if (DIA._catItems.length) return;
    try {
      const d = await GET('/reportes/diario?fecha_ini=2020-01-01&fecha_fin=2099-12-31');
      DIA._catItems = d.items || [];
      const selLinea  = document.getElementById('dia-linea');
      const selTanque = document.getElementById('dia-tanque');
      const selItem   = document.getElementById('dia-item');
      (d.lineas  || []).forEach(l => selLinea ?.insertAdjacentHTML('beforeend', `<option value="${l}">${l}</option>`));
      (d.tanques || []).forEach(t => selTanque?.insertAdjacentHTML('beforeend', `<option value="${t}">${t}</option>`));
      (d.items   || []).forEach(i => selItem  ?.insertAdjacentHTML('beforeend', `<option value="${i}">${i}</option>`));
    } catch(e) { /* silencioso */ }
  };

  window.diaSetGran = function(g) {
    DIA.gran = g;
    ['turno','dia','semana','mes'].forEach(x => {
      document.getElementById(`dia-gran-${x}`)?.classList.toggle('btn-primary', x === g);
      document.getElementById(`dia-gran-${x}`)?.classList.toggle('btn-outline',  x !== g);
    });
    if (!DIA._chartData) {
      const cont = document.getElementById('dia-graf-container');
      if (cont) cont.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">📈</div><p>Haz clic en un producto de la tabla para ver su gráfica</p></div>';
      return;
    }
    diaLoadGrafica();
  };

  window.diaSetModo = function(m) {
    DIA.modo = m;
    document.getElementById('dia-modo-kg') ?.classList.toggle('btn-primary', m === 'kg');
    document.getElementById('dia-modo-kg') ?.classList.toggle('btn-outline',  m !== 'kg');
    document.getElementById('dia-modo-mxn')?.classList.toggle('btn-primary', m === '$');
    document.getElementById('dia-modo-mxn')?.classList.toggle('btn-outline',  m !== '$');
    if (DIA._chartData) renderDiaChart(DIA._chartData);
  };

  document.getElementById('dia-btn-consultar').addEventListener('click', async () => {
    const fIni  = document.getElementById('dia-fecha-ini').value;
    const fFin  = document.getElementById('dia-fecha-fin').value;
    const linea  = document.getElementById('dia-linea').value;
    const tanque = document.getElementById('dia-tanque').value;
    const item   = document.getElementById('dia-item').value;
    if (!fIni || !fFin) { alert('Selecciona el rango de fechas'); return; }
    const tbody = document.getElementById('dia-tabla-body');
    tbody.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando...</p></div>';
    try {
      let q = `/reportes/diario?fecha_ini=${fIni}&fecha_fin=${fFin}`;
      if (linea)  q += `&linea=${encodeURIComponent(linea)}`;
      if (tanque) q += `&no_tanque=${encodeURIComponent(tanque)}`;
      if (item)   q += `&item=${encodeURIComponent(item)}`;
      const d = await GET(q);
      DIA._data = d;
      renderDiaTablaCuerpo(d);
      // Si hay un producto seleccionado en el filtro, auto-cargar su gráfica
      if (item) diaLoadGrafica();
    } catch(e) {
      tbody.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`;
    }
  });

  function renderDiaTablaCuerpo(d) {
    const tbody = document.getElementById('dia-tabla-body');
    const totEl = document.getElementById('dia-tabla-totales');
    if (!d.rows || d.rows.length === 0) {
      tbody.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>Sin datos para los filtros seleccionados</p></div>';
      if (totEl) totEl.textContent = '';
      return;
    }
    const fmtKg  = v => v.toFixed(2) + ' kg';
    const fmtMxn = v => '$' + v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    tbody.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Fecha</th><th>Línea</th><th>Tanque</th><th>Producto</th>
            <th style="text-align:right">Adiciones</th>
            <th style="text-align:right">Total kg</th>
            <th style="text-align:right">Total $</th>
          </tr>
        </thead>
        <tbody>
          ${d.rows.map(r => `
            <tr style="cursor:pointer" title="Clic para graficar este producto" onclick="diaSeleccionarItem('${r.item.replace(/'/g,"\\'")}')">
              <td style="white-space:nowrap">${r.fecha}</td>
              <td><span style="background:#fef9c3;color:#854d0e;padding:2px 7px;border-radius:4px;font-size:12px;font-weight:700">${r.linea||'—'}</span></td>
              <td style="white-space:nowrap"><span style="font-weight:600">${r.no_tanque||'—'}</span>${r.nombre_tanque?`<br><span style="font-size:11px;color:#78716c">${r.nombre_tanque}</span>`:''}</td>
              <td style="font-weight:600;font-size:13px">${r.item}</td>
              <td style="text-align:right;color:#78716c">${r.adiciones}</td>
              <td style="text-align:right;font-weight:600">${fmtKg(r.kg)}</td>
              <td style="text-align:right;color:#16a34a;font-weight:600">${fmtMxn(r.dinero)}</td>
            </tr>`).join('')}
          <tr style="background:#f5f5f4;font-weight:700;border-top:2px solid #d6d3d1">
            <td colspan="5" style="text-align:right">TOTAL</td>
            <td style="text-align:right">${fmtKg(d.totales.kg)}</td>
            <td style="text-align:right;color:#16a34a">${fmtMxn(d.totales.dinero)}</td>
          </tr>
        </tbody>
      </table>`;
    if (totEl) totEl.textContent = `${d.rows.length} registros · ${fmtKg(d.totales.kg)} · ${fmtMxn(d.totales.dinero)}`;
  }

  // Clic en fila de tabla → selecciona item en filtro unificado y carga gráfica
  window.diaSeleccionarItem = function(item) {
    const sel = document.getElementById('dia-item');
    if (sel) sel.value = item;
    diaLoadGrafica();
  };

  async function diaLoadGrafica() {
    // Lee SIEMPRE de los filtros unificados
    const item   = document.getElementById('dia-item')?.value;
    const linea  = document.getElementById('dia-linea')?.value;
    const tanque = document.getElementById('dia-tanque')?.value;
    const fIni   = document.getElementById('dia-fecha-ini')?.value;
    const fFin   = document.getElementById('dia-fecha-fin')?.value;
    if (!item) return;
    const cont   = document.getElementById('dia-graf-container');
    const titulo = document.getElementById('dia-graf-titulo');
    const lbl    = document.getElementById('dia-graf-item-label');
    if (!cont) return;
    cont.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando gráfica...</p></div>';
    if (titulo) titulo.style.display = 'none';
    try {
      let q = `/reportes/diario/grafica?item=${encodeURIComponent(item)}&granularidad=${DIA.gran}`;
      if (linea)  q += `&linea=${encodeURIComponent(linea)}`;
      if (tanque) q += `&no_tanque=${encodeURIComponent(tanque)}`;
      if (fIni)   q += `&fecha_ini=${fIni}`;
      if (fFin)   q += `&fecha_fin=${fFin}`;
      const d = await GET(q);
      DIA._chartData = d;
      // Encabezado dinámico
      if (lbl) lbl.textContent = d.item;
      if (titulo) {
        const granLabel = { turno:'por Turno', dia:'por Día', semana:'por Semana', mes:'por Mes' }[d.granularidad] || d.granularidad;
        const partes = [
          `<strong>Producto:</strong> ${d.item}`,
          `<strong>Período:</strong> ${fIni||'—'} → ${fFin||'—'}`,
          `<strong>Vista:</strong> ${granLabel}`
        ];
        if (linea)  partes.push(`<strong>Línea:</strong> ${linea}`);
        if (tanque) partes.push(`<strong>Tanque:</strong> ${tanque}`);
        titulo.innerHTML = partes.join('&nbsp;&nbsp;·&nbsp;&nbsp;');
        titulo.style.display = '';
      }
      // Altura FIJA — no dinámica (evita problemas de render con muchos datos)
      cont.innerHTML = '<canvas id="dia-chart" style="width:100%;height:100%"></canvas>';
      cont.style.height = '400px';
      renderDiaChart(d);
    } catch(e) {
      cont.innerHTML = `<div class="alert alert-warn">Error al cargar gráfica: ${e.message}</div>`;
    }
  }

  // Plugin inline: valores dentro de las barras
  const _diaBarLabels = {
    id: '_diaBarLabels',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      chart.data.datasets.forEach((ds, i) => {
        if (!chart.isDatasetVisible(i)) return;
        const meta = chart.getDatasetMeta(i);
        meta.data.forEach((bar, j) => {
          const val = ds.data[j];
          if (!val || val <= 0) return;
          const barH = Math.abs(bar.y - bar.base);
          if (barH < 14) return;
          const label = ds._fmtLabel ? ds._fmtLabel(val) : String(val);
          ctx.save();
          ctx.font = `bold ${barH < 22 ? 9 : 10}px sans-serif`;
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,0.4)';
          ctx.shadowBlur = 2;
          ctx.fillText(label, bar.x, (bar.y + bar.base) / 2);
          ctx.restore();
        });
      });
    }
  };

  function renderDiaChart(d) {
    const canvas = document.getElementById('dia-chart');
    if (!canvas) return;
    if (DIA._chart) { DIA._chart.destroy(); DIA._chart = null; }
    const useMxn    = DIA.modo === '$';
    const fmtShort  = v => useMxn
      ? '$' + (v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(0))
      : v.toFixed(1) + ' kg';
    const fmtTick   = v => useMxn
      ? '$' + v.toLocaleString('es-MX', { maximumFractionDigits: 0 })
      : v.toFixed(1) + ' kg';
    const fmtTip    = v => useMxn
      ? '$' + v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : v.toFixed(3) + ' kg';

    const scaleY = { beginAtZero: true, ticks: { font: { size: 11 }, callback: fmtTick }, grid: { color: 'rgba(0,0,0,0.05)' } };
    const scaleX = { ticks: { font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 30 } };
    const plugCfg = {
      legend:  { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label || ''}: ${fmtTip(ctx.raw)}` } }
    };

    if (d.granularidad === 'turno') {
      const mk = (lbl, vals, bg, bc) => ({ label: lbl, data: vals, backgroundColor: bg, borderColor: bc, borderWidth: 1, _fmtLabel: fmtShort });
      DIA._chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: d.buckets.map(b => b.label),
          datasets: [
            mk('T1', d.buckets.map(b => useMxn ? b.T1d : b.T1), '#3b82f6cc', '#3b82f6'),
            mk('T2', d.buckets.map(b => useMxn ? b.T2d : b.T2), '#f59e0bcc', '#f59e0b'),
            mk('T3', d.buckets.map(b => useMxn ? b.T3d : b.T3), '#8b5cf6cc', '#8b5cf6')
          ]
        },
        plugins: [_diaBarLabels],
        options: { responsive: true, maintainAspectRatio: false, plugins: plugCfg,
          scales: { x: { ...scaleX, stacked: true }, y: { ...scaleY, stacked: true } } }
      });
    } else {
      DIA._chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: d.buckets.map(b => b.label),
          datasets: [{
            label: useMxn ? `$ · ${d.item}` : `kg · ${d.item}`,
            data:  d.buckets.map(b => useMxn ? b.dinero : b.kg),
            backgroundColor: '#d97706cc', borderColor: '#d97706', borderWidth: 1.5,
            _fmtLabel: fmtShort
          }]
        },
        plugins: [_diaBarLabels],
        options: { responsive: true, maintainAspectRatio: false, plugins: plugCfg,
          scales: { y: scaleY, x: scaleX } }
      });
    }
  }

  document.getElementById('dia-btn-csv').addEventListener('click', () => {
    const d = DIA._data;
    if (!d || !d.rows || d.rows.length === 0) { alert('Primero consulta datos'); return; }
    const fIni = document.getElementById('dia-fecha-ini').value;
    const fFin = document.getElementById('dia-fecha-fin').value;
    const hdr  = ['Fecha','Línea','Tanque No','Tanque Nombre','Producto','Adiciones','kg','$'];
    const rows = d.rows.map(r => [
      r.fecha, `"${r.linea||''}"`, `"${r.no_tanque||''}"`, `"${r.nombre_tanque||''}"`,
      `"${r.item}"`, r.adiciones, r.kg.toFixed(3), r.dinero.toFixed(2)
    ].join(','));
    const csv  = [hdr.join(','), ...rows, ['','','','','TOTAL','',d.totales.kg.toFixed(3),d.totales.dinero.toFixed(2)].join(',')].join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `consumo_diario_${fIni}_${fFin}.csv`;
    a.click();
  });
  // ── fin Tab Consumo Diario ────────────────────────────────────────────────────

  document.getElementById('comp-btn').addEventListener('click', runComparativo);
  document.getElementById('comp-export-btn').addEventListener('click', () => {
    const d = window._compData;
    if (!d) { alert('Primero calcula el comparativo'); return; }
    const hdr = ['Producto','Semana','Stock','Pedido recibido','Consumo Real kg','Consumo Teórico kg','Diferencia kg','Diferencia %'];
    const rows = d.items.flatMap(item => item.weeks.map(w => [
      `"${item.item}"`, w.week, w.stock_actual??'', w.pedido_recibido||0,
      w.consumo_real_kg!==null?w.consumo_real_kg.toFixed(3):'',
      w.consumo_teorico_kg.toFixed(3),
      w.diferencia!==null?w.diferencia.toFixed(3):'',
      w.pct_diferencia!==null?w.pct_diferencia.toFixed(1)+'%':''
    ].join(',')));
    const csv = [hdr.join(','), ...rows].join('\r\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `comparativo_${d.year}_s${d.week_ini}-s${d.week_fin}.csv`; a.click();
  });

  rptLoad();
}

async function rptLoad() {
  // Actualizar botones tipo activo
  document.querySelectorAll('.rpt-tipo-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.toLowerCase().includes(
      RPS.tipo === 'semana' ? 'sem' : RPS.tipo === 'mes' ? 'mes' : 'año'
    ));
  });

  const el = id => document.getElementById(id);
  if (el('rpt-label')) el('rpt-label').textContent = 'Cargando...';

  try {
    let q = `/reportes/periodo?tipo=${RPS.tipo}&fecha=${RPS.fecha}`;
    if (RPS.linea) q += `&linea=${encodeURIComponent(RPS.linea)}`;
    const d = await GET(q);
    RPS._data = d;

    // Label del período
    if (el('rpt-label')) el('rpt-label').textContent = d.periodoActual.label;
    if (el('rpt-vs-label')) el('rpt-vs-label').textContent = `vs ${d.periodoAnterior.label}`;

    // Alertas
    if (el('rpt-alertas')) {
      el('rpt-alertas').innerHTML = d.alertas.length > 0 ? `
        <div class="alert alert-warn" style="margin-bottom:16px">
          ⚠️ <strong>Alerta de consumo elevado:</strong>
          ${d.alertas.map(a=>`<strong>${a.item.length>40?a.item.slice(0,40)+'…':a.item}</strong> (+${a.pct.toFixed(0)}%)`).join(' · ')}
        </div>` : '';
    }

    // Gráfica tendencia
    const COLORS = { actual: '#d97706', anterior: '#a8a29e' };
    const ctxT = el('chart-tendencia');
    if (ctxT) {
      if (RPS._charts.tendencia) RPS._charts.tendencia.destroy();
      RPS._charts.tendencia = new Chart(ctxT, {
        type: 'bar',
        data: {
          labels: d.tendencia.map(b => b.label),
          datasets: [
            { label: d.periodoActual.label,   data: d.tendencia.map(b=>b.actual),   backgroundColor: '#d97706cc', borderColor: '#d97706', borderWidth: 1.5 },
            { label: d.periodoAnterior.label, data: d.tendencia.map(b=>b.anterior), backgroundColor: '#a8a29e66', borderColor: '#a8a29e', borderWidth: 1.5 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
          scales: { y: { beginAtZero: true, ticks: { font: { size: 11 } } }, x: { ticks: { font: { size: 11 } } } }
        }
      });
      ctxT.parentElement.style.height = '220px';
    }

    // Gráfica top productos (horizontal)
    const top10 = d.byProducto.slice(0, 10);
    const ctxP = el('chart-productos');
    if (ctxP) {
      if (RPS._charts.productos) RPS._charts.productos.destroy();
      RPS._charts.productos = new Chart(ctxP, {
        type: 'bar',
        data: {
          labels: top10.map(r => r.item.length > 30 ? r.item.slice(0,30)+'…' : r.item),
          datasets: [
            { label: d.periodoActual.label,   data: top10.map(r=>r.actual),   backgroundColor: '#d97706cc' },
            { label: d.periodoAnterior.label, data: top10.map(r=>r.anterior), backgroundColor: '#a8a29e66' }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
          scales: { x: { beginAtZero: true, ticks: { font: { size: 11 } } }, y: { ticks: { font: { size: 10 } } } }
        }
      });
      ctxP.parentElement.style.height = Math.max(180, top10.length * 28 + 50) + 'px';
    }

    renderRptTables(d);

  } catch(e) {
    const el2 = document.getElementById('rpt-kpis');
    if (el2) el2.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`;
  }
}

function renderRptTables(d) {
  const el = id => document.getElementById(id);
  const esMxn = RPS.modo === 'mxn';
  const fmt = (kg, mxn) => esMxn
    ? `$${(mxn||0).toLocaleString('es-MX',{minimumFractionDigits:0,maximumFractionDigits:0})}`
    : `${(kg||0).toFixed(1)} kg`;
  const unidad = esMxn ? '$' : 'kg';

  const fmtDelta = (dkg, dmxn, pct) => {
    const val = esMxn ? dmxn : dkg;
    if (!val) return '<span style="color:#a8a29e">—</span>';
    const clr = val > 0 ? '#dc2626' : '#16a34a';
    const fv = esMxn
      ? `$${Math.abs(val).toLocaleString('es-MX',{maximumFractionDigits:0})}`
      : `${Math.abs(val).toFixed(1)} kg`;
    return `<span style="color:${clr};font-weight:700">${val>0?'+':'-'}${fv} (${val>0?'+':''}${(pct||0).toFixed(1)}%)</span>`;
  };

  // KPIs con modo
  const t = d.totales;
  const kgDelta = t.actual - t.anterior;
  const kgPct   = t.anterior > 0 ? ((kgDelta/t.anterior)*100).toFixed(1) : '—';
  const vDelta  = t.vales_actual - t.vales_anterior;
  const kgClr   = kgDelta >= 0 ? '#dc2626' : '#16a34a';
  const vClr    = vDelta  >= 0 ? '#dc2626' : '#16a34a';
  const mxnDelta = (t.dinero_actual||0) - (t.dinero_anterior||0);
  const mxnPct   = (t.dinero_anterior||0) > 0 ? ((mxnDelta/(t.dinero_anterior||1))*100).toFixed(1) : '—';
  if (el('rpt-kpis')) el('rpt-kpis').innerHTML = `
    <div class="rpt-kpi"><div class="rpt-kpi-val">${t.actual.toFixed(1)}</div><div class="rpt-kpi-lbl">kg despachados</div>
      <div class="rpt-kpi-sub" style="color:${kgClr}">${kgDelta>=0?'+':''}${kgDelta.toFixed(1)} kg (${kgDelta>=0?'+':''}${kgPct}%) vs anterior</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-val">$${((t.dinero_actual||0)/1000).toFixed(1)}k</div><div class="rpt-kpi-lbl">costo estimado</div>
      <div class="rpt-kpi-sub" style="color:${mxnDelta>=0?'#dc2626':'#16a34a'}">${mxnDelta>=0?'+':'-'}$${Math.abs(mxnDelta).toLocaleString('es-MX',{maximumFractionDigits:0})} (${mxnDelta>=0?'+':''}${mxnPct}%)</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-val">${t.vales_actual}</div><div class="rpt-kpi-lbl">vales emitidos</div>
      <div class="rpt-kpi-sub" style="color:${vClr}">${vDelta>=0?'+':''}${vDelta} vs anterior</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-val">${t.anterior.toFixed(1)}</div><div class="rpt-kpi-lbl">kg período anterior</div>
      <div class="rpt-kpi-sub" style="color:#78716c">${d.periodoAnterior.label}</div></div>`;

  // Tabla productos
  if (el('rpt-tabla-productos')) el('rpt-tabla-productos').innerHTML = d.byProducto.length === 0
    ? '<div class="empty-state"><div class="icon">📦</div><p>Sin datos</p></div>'
    : `<table><thead><tr><th>Producto</th><th style="text-align:right">Actual (${unidad})</th><th style="text-align:right">Anterior (${unidad})</th><th>Variación</th></tr></thead>
       <tbody>${d.byProducto.map(r=>`<tr>
         <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.item}">${r.item}</td>
         <td style="text-align:right;font-weight:700">${fmt(r.actual, r.dinero_actual)}</td>
         <td style="text-align:right;color:#78716c">${fmt(r.anterior, r.dinero_anterior)}</td>
         <td>${fmtDelta(r.delta, r.dinero_delta, r.pct)}</td>
       </tr>`).join('')}</tbody>
       <tfoot><tr style="background:#fef3c7;font-weight:700">
         <td>TOTAL</td>
         <td style="text-align:right">${fmt(t.actual, t.dinero_actual)}</td>
         <td style="text-align:right">${fmt(t.anterior, t.dinero_anterior)}</td>
         <td>${fmtDelta(t.actual-t.anterior, (t.dinero_actual||0)-(t.dinero_anterior||0), t.anterior>0?((t.actual-t.anterior)/t.anterior)*100:0)}</td>
       </tr></tfoot></table>`;

  // Tabla líneas con desglose de productos
  if (el('rpt-tabla-lineas')) el('rpt-tabla-lineas').innerHTML = d.byLinea.length === 0
    ? '<div class="empty-state"><div class="icon">🏭</div><p>Sin datos</p></div>'
    : `<table><thead><tr><th>Línea / Producto</th><th style="text-align:right">Actual (${unidad})</th><th style="text-align:right">Anterior (${unidad})</th><th>Variación</th></tr></thead>
       <tbody>${d.byLinea.map((r,i)=>{
         const rowId = `linea-prods-${i}`;
         const prodsHtml = (r.productos||[]).map(p=>`<tr class="${rowId}" style="display:none;background:#fafaf9">
           <td style="padding-left:28px;font-size:12px;color:#57534e">↳ ${p.item}</td>
           <td style="text-align:right;font-size:12px">${fmt(p.actual, p.dinero_actual)}</td>
           <td style="text-align:right;font-size:12px;color:#78716c">${fmt(p.anterior, p.dinero_anterior)}</td>
           <td></td>
         </tr>`).join('');
         return `<tr style="cursor:pointer" onclick="toggleLinea('${rowId}',this)">
           <td style="font-weight:600">▶ ${r.linea} <span style="font-size:11px;color:#a8a29e">(${(r.productos||[]).length} productos)</span></td>
           <td style="text-align:right;font-weight:700">${fmt(r.actual, r.dinero_actual)}</td>
           <td style="text-align:right;color:#78716c">${fmt(r.anterior, r.dinero_anterior)}</td>
           <td>${fmtDelta(r.delta, r.dinero_delta, r.pct)}</td>
         </tr>${prodsHtml}`;
       }).join('')}</tbody></table>`;
}

window.toggleLinea = function(rowId, trEl) {
  const rows = document.querySelectorAll(`.${rowId}`);
  const open = rows[0]?.style.display !== 'none';
  rows.forEach(r => r.style.display = open ? 'none' : '');
  const arrow = trEl.querySelector('td:first-child');
  if (arrow) arrow.innerHTML = arrow.innerHTML.replace(open ? '▼' : '▶', open ? '▶' : '▼');
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
  document.getElementById('btn-nueva-corr')?.addEventListener('click', () => showModalCorreccion().catch(e => alert('Error: ' + e.message)));
}
async function showModalCorreccion() {
  // Cargar vales de los últimos 90 días
  const ini = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const vales = await GET('/vales?fecha_ini=' + ini).catch(() => []);

  showModal(`
    <h3>🔧 Nueva Corrección de Vale</h3>
    <div class="form-group">
      <label>Folio de vale origen *</label>
      <select id="c-folio" style="width:100%">
        <option value="">-- Seleccionar folio --</option>
        ${vales.map(v => `<option value="${v.folio_vale}">${v.folio_vale} &nbsp;·&nbsp; ${v.fecha} &nbsp;·&nbsp; ${v.linea}${v.solicita ? ' · ' + v.solicita : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-group" id="c-items-group" style="display:none">
      <label>Item a corregir *</label>
      <select id="c-item-sel" style="width:100%">
        <option value="">-- Seleccionar item del vale --</option>
      </select>
    </div>
    <div id="c-form-fields" style="display:none">
      <div class="form-row mt-1">
        <div class="form-group">
          <label>Item (código)</label>
          <input type="text" id="c-item" readonly style="background:#f5f5f4;font-weight:700" />
        </div>
        <div class="form-group">
          <label>Tipo de corrección *</label>
          <select id="c-tipo">
            <option value="">--</option>
            <option value="DEVOLVER">DEVOLVER (regresar al inventario)</option>
            <option value="DESCONTAR">DESCONTAR (quitar del inventario)</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Unidad</label>
          <select id="c-unidad">
            <option value="KG">KG</option>
            <option value="TAMBO">TAMBO</option>
            <option value="PORRON_15L">PORRON_15L</option>
            <option value="LITRO">LITRO</option>
          </select>
        </div>
        <div class="form-group">
          <label>Cantidad *</label>
          <input type="number" id="c-cant" step="0.001" min="0" />
        </div>
      </div>
      <div class="form-group mt-1"><label>Comentario</label><input type="text" id="c-coment" /></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-corr">Guardar Corrección</button>
      </div>
    </div>
    <div id="c-cancel-row" style="margin-top:16px;display:flex;justify-content:flex-end">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
    </div>`);

  // Folio seleccionado → cargar items del vale
  document.getElementById('c-folio').addEventListener('change', function() {
    const folio = this.value;
    const vale = vales.find(v => v.folio_vale === folio);
    const itemsGroup  = document.getElementById('c-items-group');
    const formFields  = document.getElementById('c-form-fields');
    const cancelRow   = document.getElementById('c-cancel-row');
    formFields.style.display = 'none';
    if (!vale) { itemsGroup.style.display = 'none'; cancelRow.style.display = 'flex'; return; }

    const detalles = vale.detalle || [];
    const selItem = document.getElementById('c-item-sel');
    selItem.innerHTML = '<option value="">-- Seleccionar item del vale --</option>';
    detalles.forEach(d => {
      const label = `${d.item}${d.no_tanque ? ' · Tanque ' + d.no_tanque : ''} · ${d.tipo_adicion} · ${d.cantidad}`;
      selItem.add(new Option(label, JSON.stringify(d)));
    });
    itemsGroup.style.display = '';
    cancelRow.style.display = 'flex';
  });

  // Item seleccionado → precargar campos
  document.getElementById('c-item-sel').addEventListener('change', function() {
    const formFields = document.getElementById('c-form-fields');
    const cancelRow  = document.getElementById('c-cancel-row');
    if (!this.value) { formFields.style.display = 'none'; cancelRow.style.display = 'flex'; return; }
    const det = JSON.parse(this.value);
    document.getElementById('c-item').value = det.item;
    const selUnidad = document.getElementById('c-unidad');
    [...selUnidad.options].forEach(o => { o.selected = o.value === det.tipo_adicion; });
    document.getElementById('c-cant').value = det.cantidad;
    formFields.style.display = '';
    cancelRow.style.display = 'none';
  });

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
        <thead><tr><th>Línea</th><th>No. Tanque</th><th>Nombre</th><th>Tipo</th><th>Enjuague</th><th>Productos autorizados</th><th>Activo</th><th></th></tr></thead>
        <tbody>${tanques.length===0?'<tr><td colspan="8" class="text-center" style="padding:24px;color:#78716c">Sin tanques</td></tr>':
          tanques.map(t=>`<tr>
            <td>${t.linea}</td><td><strong>${t.no_tanque}</strong></td>
            <td>${t.nombre_tanque||'-'}</td><td>${t.tipo||'-'}</td>
            <td>${t.es_enjuague?'🚿':'—'}</td>
            <td style="font-size:11px">${(t.items_autorizados||[]).join(', ')||'<span style="color:#9ca3af">—</span>'}</td>
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
  if (t) showModalTanque(t, items, 'tanques');
};
function showModalTanque(tanque, items, returnView) {
  const isEdit = !!tanque;
  const autorizados = tanque?.items_autorizados || [];
  showModal(`
    <h3>${isEdit ? '✏️ Editar Tanque' : '+ Nuevo Tanque'}</h3>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label>Línea *</label><input type="text" id="tk-linea" value="${tanque?.linea||''}" /></div>
      <div class="form-group"><label>No. Tanque *</label><input type="text" id="tk-no" value="${tanque?.no_tanque||''}" /></div>
      <div class="form-group"><label>Nombre del tanque</label><input type="text" id="tk-nombre" value="${tanque?.nombre_tanque||''}" /></div>
      <div class="form-group"><label>Tipo</label><input type="text" id="tk-tipo" value="${tanque?.tipo||''}" /></div>
      <div class="form-group"><label>Químico activo <small style="color:#78716c">(907 / 1207 / vacío)</small></label><input type="text" id="tk-quimico" value="${tanque?.quimico_activo||''}" placeholder="Ej: 907 — vacío si no aplica" /></div>
      <div class="form-group" style="display:flex;align-items:center;gap:10px;padding-top:22px">
        <input type="checkbox" id="tk-enjuague" ${tanque?.es_enjuague?'checked':''} style="width:16px;height:16px" />
        <label for="tk-enjuague" style="margin:0;cursor:pointer">🚿 Es tanque de enjuague</label>
      </div>
      ${isEdit?`<div class="form-group"><label>Activo</label><select id="tk-activo"><option value="true" ${tanque?.activo!==false?'selected':''}>Sí</option><option value="false" ${tanque?.activo===false?'selected':''}>No</option></select></div>`:''}
    </div>
    <div class="form-group" style="margin-top:12px">
      <label>Productos autorizados <small style="color:#78716c">Dejar vacío si no aplica adición de químicos</small></label>
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
      quimico_activo:   document.getElementById('tk-quimico').value.trim() || null,
      es_enjuague:      document.getElementById('tk-enjuague').checked,
      items_autorizados: checked,
      ...(isEdit ? { activo: document.getElementById('tk-activo').value === 'true' } : {})
    };
    try {
      if (isEdit) await PATCH('/tanques/' + tanque.id, body);
      else await POST('/tanques', body);
      closeModal();
      navigate(returnView || 'tanques');
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

// ── Importar SQLite ────────────────────────────────────────────────────────────
async function viewImportarSqlite() {
  return `
  <div class="table-card" style="max-width:820px">
    <div class="table-header">
      <h3>🗄️ Importar desde base de datos SQLite (sistema antiguo)</h3>
    </div>
    <div style="padding:20px">
      <p style="color:#78716c;margin-bottom:16px">
        Selecciona el archivo <strong>materiales.sqlite</strong> desde tu computadora. La herramienta
        importará o actualizará: productos, tanques, tipos de adición, vales, kardex y correcciones.
        Los registros que ya existen se omiten o actualizan según corresponda.
      </p>

      <div class="form-group" style="margin-bottom:18px">
        <label>Archivo SQLite</label>
        <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
          <label class="btn btn-outline" style="cursor:pointer;margin:0">
            📂 Examinar...
            <input type="file" id="sq-file" accept=".sqlite,.sqlite3,.db" style="display:none" />
          </label>
          <span id="sq-filename" style="color:#78716c;font-size:13px">Ningún archivo seleccionado</span>
        </div>
        <small style="color:#78716c;display:block;margin-top:4px">
          Ruta habitual: <code style="font-size:11px">...cuestoquimicos\_internal\materiales.sqlite</code>
        </small>
      </div>

      <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:18px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="sq-items" checked> <span>Productos &amp; tipos de adición</span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="sq-tanques" checked> <span>Tanques / líneas</span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="sq-vales" checked> <span>Vales (registros)</span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="sq-kardex" checked> <span>Kardex</span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="sq-correc" checked> <span>Correcciones</span>
        </label>
      </div>

      <div style="display:flex;gap:10px;margin-bottom:20px">
        <button class="btn btn-outline" id="btn-sq-preview">🔍 Vista previa (sin cambios)</button>
        <button class="btn btn-primary" id="btn-sq-execute" style="background:#dc7429">⬆️ Importar ahora</button>
      </div>

      <div id="sq-results"></div>
    </div>
  </div>`;
}

function bindImportarSqlite() {
  document.getElementById('sq-file')?.addEventListener('change', function() {
    const name = this.files[0]?.name || 'Ningún archivo seleccionado';
    document.getElementById('sq-filename').textContent = name;
  });

  function buildFormData(mode) {
    const file = document.getElementById('sq-file')?.files[0];
    if (!file) return null;
    const fd = new FormData();
    fd.append('sqlite_file', file);
    fd.append('mode', mode);
    fd.append('import_items',        document.getElementById('sq-items').checked);
    fd.append('import_tanques',      document.getElementById('sq-tanques').checked);
    fd.append('import_vales',        document.getElementById('sq-vales').checked);
    fd.append('import_kardex',       document.getElementById('sq-kardex').checked);
    fd.append('import_correcciones', document.getElementById('sq-correc').checked);
    return fd;
  }

  async function postFormData(fd) {
    const res = await fetch('/api/vales/import-sqlite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      body: fd
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  function renderStats(data) {
    const s = data.stats;
    const isExec = data.mode === 'execute';
    const color = isExec ? '#16a34a' : '#2563eb';

    function row(name, stats) {
      if (!stats) return '';
      const parts = [];
      if (stats.nuevos      != null) parts.push(`<span style="color:#16a34a"><strong>${stats.nuevos}</strong> nuevos</span>`);
      if (stats.actualizados!= null) parts.push(`<span style="color:#d97706"><strong>${stats.actualizados}</strong> actualizados</span>`);
      if (stats.sin_cambios != null) parts.push(`<span style="color:#78716c">${stats.sin_cambios} sin cambios</span>`);
      if (stats.omitidos    != null) parts.push(`<span style="color:#78716c">${stats.omitidos} ya existían</span>`);
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6"><strong>${name}</strong></td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#64748b">${stats.total} en SQLite</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${parts.join(' · ')}</td>
      </tr>`;
    }

    return `
    <div style="border:2px solid ${color};border-radius:8px;overflow:hidden">
      <div style="background:${color};color:#fff;padding:10px 16px;font-weight:600">
        ${isExec ? '✅ Importación completada' : '🔍 Vista previa'} — ${new Date().toLocaleString('es-MX')}
      </div>
      <table style="width:100%;border-collapse:collapse">
        <tbody>
          ${row('Productos', s.items)}
          ${row('Tipos de adición', s.adiciones)}
          ${row('Tanques / líneas', s.tanques)}
          ${row('Vales (registros)', s.vales)}
          ${row('Kardex', s.kardex)}
          ${row('Correcciones', s.correcciones)}
        </tbody>
      </table>
      ${isExec
        ? '<div style="padding:12px 16px;background:#f0fdf4;color:#15803d;font-weight:500">✔ Datos guardados correctamente. Puedes navegar a las secciones para verificar.</div>'
        : '<div style="padding:12px 16px;color:#1e40af;font-size:13px">Para aplicar los cambios, haz clic en <strong>Importar ahora</strong>.</div>'}
    </div>`;
  }

  document.getElementById('btn-sq-preview')?.addEventListener('click', async () => {
    const el = document.getElementById('sq-results');
    const fd = buildFormData('preview');
    if (!fd) { el.innerHTML = `<div class="alert alert-warn">⚠️ Selecciona primero el archivo SQLite.</div>`; return; }
    el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Analizando base de datos...</p></div>';
    try {
      el.innerHTML = renderStats(await postFormData(fd));
    } catch(e) {
      el.innerHTML = `<div class="alert alert-warn">⚠️ Error: ${e.message}</div>`;
    }
  });

  document.getElementById('btn-sq-execute')?.addEventListener('click', async () => {
    const el = document.getElementById('sq-results');
    const fd = buildFormData('execute');
    if (!fd) { el.innerHTML = `<div class="alert alert-warn">⚠️ Selecciona primero el archivo SQLite.</div>`; return; }
    if (!confirm('¿Confirmas la importación? Los datos nuevos se agregarán y los catálogos (productos/tanques) se actualizarán.')) return;
    el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Importando datos, por favor espera...</p></div>';
    try {
      const data = await postFormData(fd);
      el.innerHTML = renderStats(data);
      state.items  = await GET('/items');
      state.tanques = await GET('/tanques');
    } catch(e) {
      el.innerHTML = `<div class="alert alert-warn">⚠️ Error: ${e.message}</div>`;
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO TITULACIONES
// ══════════════════════════════════════════════════════════════════════════════

// ── Helpers SPC ───────────────────────────────────────────────────────────────
function spcStats(valores) {
  const n = valores.length;
  if (n === 0) return null;
  const mean = valores.reduce((s, v) => s + v, 0) / n;
  const variance = valores.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(n - 1, 1);
  const sigma = Math.sqrt(variance);
  const rangos = valores.slice(1).map((v, i) => Math.abs(v - valores[i]));
  const mrBar = rangos.length ? rangos.reduce((s, r) => s + r, 0) / rangos.length : 0;
  return { n, mean, sigma, mrBar, rangos };
}
function spcCpCpk(mean, sigma, lsl, usl) {
  if (!sigma || sigma === 0) return { cp: null, cpk: null };
  const cp = (lsl != null && usl != null) ? (usl - lsl) / (6 * sigma) : null;
  const cpkU = usl != null ? (usl - mean) / (3 * sigma) : null;
  const cpkL = lsl != null ? (mean - lsl) / (3 * sigma) : null;
  const cpk = cpkU != null && cpkL != null ? Math.min(cpkU, cpkL) : (cpkU ?? cpkL);
  return { cp, cpk };
}
function estadoColor(estado) {
  return estado === 'fuera' ? '#ef4444' : estado === 'limite' ? '#f59e0b' : estado === 'ok' ? '#22c55e' : estado === 'paro_linea' ? '#6b7280' : '#94a3b8';
}
function estadoBadge(estado) {
  const map = { ok:'✅ OK', limite:'⚠️ Límite', fuera:'🔴 Fuera', sin_dato:'—', paro_linea:'⛔ Paro' };
  return map[estado] || estado;
}
function getTurnoActual() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return { turno: 1, saludo: 'Buenos días' };
  if (h >= 14 && h < 22) return { turno: 2, saludo: 'Buenas tardes' };
  return { turno: 3, saludo: 'Buenas noches' };
}

// ── CPK Semanal Dashboard ─────────────────────────────────────────────────────

// Parámetros monitoreados: BAKER (70, 85, 92) y LINEA 3 (46, 52)
const CPK_MONITORED = [
  { id: 70, grupo: 'baker' },
  { id: 85, grupo: 'baker' },
  { id: 92, grupo: 'baker' },
  { id: 46, grupo: 'l3'    },
  { id: 52, grupo: 'l3'    },
];

function semanaActual() {
  const now = new Date();
  const day = now.getDay();
  const diffMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now); mon.setDate(now.getDate() + diffMon);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = d => d.toISOString().slice(0, 10);
  const lb  = d => d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
  return { ini: fmt(mon), fin: fmt(sun), label: `${lb(mon)} – ${lb(sun)} ${now.getFullYear()}` };
}

function cpkColorInfo(cpk) {
  if (cpk === null || !isFinite(cpk))
    return { bg: '#f1f5f9', border: '#cbd5e1', text: '#64748b', label: 'Sin datos', emoji: '—' };
  if (cpk < 1)
    return { bg: '#fee2e2', border: '#fca5a5', text: '#dc2626', label: 'No capaz',  emoji: '🔴' };
  if (cpk < 1.33)
    return { bg: '#fef3c7', border: '#fde68a', text: '#d97706', label: 'Marginal',  emoji: '🟡' };
  if (cpk < 1.67)
    return { bg: '#dcfce7', border: '#86efac', text: '#16a34a', label: 'Capaz',     emoji: '🟢' };
  return   { bg: '#bbf7d0', border: '#4ade80', text: '#14532d', label: 'Alt. capaz','emoji': '💚' };
}

async function loadCpkSemanal(el) {
  if (!el) return;
  const semana = semanaActual();
  el.innerHTML = `<span style="color:#94a3b8;font-size:13px">⏳ Calculando CPK semanal...</span>`;

  const results = await Promise.all(
    CPK_MONITORED.map(cfg =>
      GET(`/titulaciones/estadisticas/valores?parametro_id=${cfg.id}&fecha_ini=${semana.ini}&fecha_fin=${semana.fin}`)
        .then(d => ({ ...d, _grupo: cfg.grupo }))
        .catch(() => null)
    )
  );

  const renderCard = (data) => {
    if (!data) return '';
    const { param, valores } = data;
    const vals = (valores || []).map(v => v.valor).filter(v => v != null);
    const lsl = param.valor_min, usl = param.valor_max;
    let cpkVal = null;
    if (vals.length >= 2 && (lsl != null || usl != null)) {
      const st = spcStats(vals);
      const { cpk } = spcCpCpk(st.mean, st.sigma, lsl, usl);
      cpkVal = cpk != null && isFinite(cpk) ? cpk : null;
    }
    const c = cpkColorInfo(cpkVal);
    return `
      <button class="cpk-card-btn" data-param-id="${param.id}"
        style="background:${c.bg};border:1.5px solid ${c.border};border-radius:10px;padding:12px 14px;
               min-width:150px;max-width:175px;cursor:pointer;text-align:left;display:block;
               font-family:inherit;transition:transform .12s,box-shadow .12s"
        onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 14px #0001'"
        onmouseout="this.style.transform='';this.style.boxShadow=''">
        <div style="font-size:10px;font-weight:700;color:#6b7280;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${param.no_tanque}</div>
        <div style="font-size:11px;color:#374151;margin-bottom:8px;font-weight:500">${param.nombre_parametro}</div>
        <div style="font-size:30px;font-weight:800;color:${c.text};line-height:1.1">${cpkVal !== null ? cpkVal.toFixed(2) : '—'}</div>
        <div style="font-size:11px;font-weight:600;color:${c.text};margin:3px 0 6px">${c.emoji} ${c.label}</div>
        <div style="font-size:10px;color:#9ca3af">n = ${vals.length} medición${vals.length !== 1 ? 'es' : ''}</div>
      </button>`;
  };

  const renderGrupo = (titulo, items) => `
    <div style="min-width:180px">
      <div style="font-size:10px;font-weight:700;letter-spacing:.6px;color:#6b7280;text-transform:uppercase;margin-bottom:8px">${titulo}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${items.map(renderCard).join('')}</div>
    </div>`;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <span style="font-size:14px;font-weight:700;color:#1e293b">📊 CPK Semanal</span>
      <span style="font-size:11px;color:#78716c;background:#f1f5f9;padding:2px 10px;border-radius:20px">${semana.label}</span>
      <button onclick="loadCpkSemanal(document.getElementById('cpk-semanal-grid'))"
        style="font-size:11px;padding:3px 10px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;color:#374151">↻ Actualizar</button>
    </div>
    <div style="display:flex;gap:24px;flex-wrap:wrap">
      ${renderGrupo('🏭 Baker', results.filter(r => r?._grupo === 'baker'))}
      ${renderGrupo('🏭 Línea 3', results.filter(r => r?._grupo === 'l3'))}
    </div>`;

  // Guardar results para el click
  window._cpkResults = results;
  window._cpkSemana  = semana;

  el.querySelectorAll('.cpk-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid  = Number(btn.dataset.paramId);
      const data = (window._cpkResults || []).find(r => r?.param?.id === pid);
      if (data) openCpkDetalle(data, window._cpkSemana);
    });
  });
}

function openCpkDetalle(data, semana) {
  const { param, valores } = data;
  const vals = (valores || []).map(v => v.valor).filter(v => v != null);
  const lsl = param.valor_min, usl = param.valor_max;

  if (vals.length < 2) {
    showModal(`
      <h3>📊 ${param.no_tanque} — ${param.nombre_parametro}</h3>
      <p style="color:#78716c;font-size:13px">Insuficientes datos esta semana (n = ${vals.length}).</p>
      <div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">Cerrar</button></div>`);
    return;
  }

  const stats = spcStats(vals);
  const { cp, cpk } = spcCpCpk(stats.mean, stats.sigma, lsl, usl);
  const c = cpkColorInfo(cpk);

  // Puntos fuera de especificación (re-evaluado con lsl/usl actuales)
  const fueraPoints = (valores || []).filter(v => {
    const val = v.valor;
    if (val == null) return false;
    if (lsl != null && val < lsl) return true;
    if (usl != null && val > usl) return true;
    return false;
  });

  const tablaFuera = fueraPoints.length === 0
    ? `<p style="color:#16a34a;font-size:13px;padding:6px 0;margin:0">✅ Sin puntos fuera de especificación esta semana.</p>`
    : `<div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#fef2f2;text-align:left">
            <th style="padding:5px 10px">Fecha</th>
            <th style="padding:5px 8px;text-align:center">Turno</th>
            <th style="padding:5px 8px;text-align:center">Tit.</th>
            <th style="padding:5px 8px;text-align:center">Valor (${param.unidad||''})</th>
            <th style="padding:5px 10px">Analista</th>
          </tr></thead>
          <tbody>${fueraPoints.map(v => {
            const tit = (v.clave || '').split('.')[1] || '?';
            const bajo = lsl != null && v.valor < lsl;
            const alto = usl != null && v.valor > usl;
            return `<tr style="border-bottom:1px solid #fee2e2">
              <td style="padding:5px 10px">${v.fecha || '—'}</td>
              <td style="padding:5px 8px;text-align:center">T${v.turno || '?'}</td>
              <td style="padding:5px 8px;text-align:center">${tit}</td>
              <td style="padding:5px 8px;text-align:center;font-weight:700;color:#dc2626">
                ${bajo ? '↓' : alto ? '↑' : ''} ${v.valor}
              </td>
              <td style="padding:5px 10px;font-size:12px">${v.analista || '—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;

  const canvasId = `cpk-chart-${param.id}`;
  const statsCards = [
    ['μ',   stats.mean.toFixed(3),  '#dbeafe'],
    ['σ',   stats.sigma.toFixed(3), '#f3e8ff'],
    ['n',   stats.n,                '#f1f5f9'],
    ...(cp  != null ? [['Cp',  cp.toFixed(2),  cp>=1.33?'#dcfce7':cp>=1?'#fef3c7':'#fee2e2']]  : []),
    ...(cpk != null ? [['Cpk', cpk.toFixed(2), cpk>=1.33?'#dcfce7':cpk>=1?'#fef3c7':'#fee2e2']] : []),
  ];

  showModal(`
    <h3 style="margin:0 0 3px;font-size:15px">${param.no_tanque} — ${param.nombre_parametro}</h3>
    <p style="margin:0 0 12px;font-size:11px;color:#78716c">${semana.label}${lsl!=null&&usl!=null?' · Spec: '+lsl+'–'+usl+' '+(param.unidad||''):''}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      ${statsCards.map(([lab, val, bg]) => `
        <div style="background:${bg};border-radius:8px;padding:7px 14px;text-align:center;min-width:60px">
          <div style="font-size:11px;font-weight:700;color:#374151">${lab}</div>
          <div style="font-size:20px;font-weight:800;color:#1e293b">${val}</div>
        </div>`).join('')}
    </div>
    ${cpk != null ? `
    <div style="background:${c.bg};border:1px solid ${c.border};border-radius:6px;padding:6px 12px;font-size:12px;color:${c.text};font-weight:600;margin-bottom:12px">
      ${c.emoji} ${c.label} — Cpk = ${cpk.toFixed(2)}
      ${cpk < 1 ? ' — ⚠️ Proceso no capaz, requiere acción inmediata'
        : cpk < 1.33 ? ' — Proceso marginalmente capaz'
        : cpk < 1.67 ? ' — Proceso capaz'
        : ' — Proceso altamente capaz'}
    </div>` : ''}
    <div style="height:230px;position:relative;margin-bottom:16px"><canvas id="${canvasId}"></canvas></div>
    <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">
      ⚠️ Registros fuera de especificación — ${fueraPoints.length} punto${fueraPoints.length !== 1 ? 's' : ''}
    </div>
    ${tablaFuera}
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-primary" onclick="closeModal()">Cerrar</button>
    </div>`);

  // Gráfica de control
  setTimeout(() => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const allVals = (valores || []).map(v => v.valor);
    const labels  = (valores || []).map(v => `${v.fecha||''} T${v.turno||''}.${ (v.clave||'').split('.')[1]||'' }`);
    const ucl = stats.mean + 3 * stats.sigma;
    const lcl = Math.max(0, stats.mean - 3 * stats.sigma);
    const ptColors = allVals.map(v => {
      if (lsl != null && v < lsl) return '#ef4444';
      if (usl != null && v > usl) return '#ef4444';
      return '#3b82f6';
    });
    new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: param.nombre_parametro, data: allVals, borderColor: '#3b82f6', backgroundColor: ptColors.map(c => c + '33'), pointBackgroundColor: ptColors, pointRadius: 4, tension: 0.3, fill: false },
          ...(usl != null ? [{ label: `USL (${usl})`, data: Array(labels.length).fill(usl), borderColor: '#ef4444', borderDash: [5,5], pointRadius: 0, tension: 0 }] : []),
          ...(lsl != null ? [{ label: `LSL (${lsl})`, data: Array(labels.length).fill(lsl), borderColor: '#ef4444', borderDash: [5,5], pointRadius: 0, tension: 0 }] : []),
          { label: `UCL (${ucl.toFixed(2)})`, data: Array(labels.length).fill(ucl), borderColor: '#f59e0b', borderDash: [3,3], pointRadius: 0, tension: 0 },
          { label: `X̄ (${stats.mean.toFixed(3)})`,  data: Array(labels.length).fill(stats.mean), borderColor: '#22c55e', borderDash: [4,2], pointRadius: 0, tension: 0 },
          ...(lcl > 0 ? [{ label: `LCL (${lcl.toFixed(2)})`, data: Array(labels.length).fill(lcl), borderColor: '#f59e0b', borderDash: [3,3], pointRadius: 0, tension: 0 }] : []),
        ]
      },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 10 }, boxWidth: 18 } } },
        scales: {
          y: { title: { display: true, text: `${param.nombre_parametro} (${param.unidad||''})`, font: { size: 10 } } },
          x: { ticks: { font: { size: 9 }, maxRotation: 45 } }
        }
      }
    });
  }, 60);
}

// ── Registrar Titulación ───────────────────────────────────────────────────────
async function viewTitulaciones() {
  const [lineas, titHoy] = await Promise.all([
    GET('/lineas').catch(() => []),
    GET(`/titulaciones?fecha_ini=${today()}&fecha_fin=${today()}`).catch(() => [])
  ]);
  const { turno, saludo } = getTurnoActual();

  // Construir resumen por línea para el turno actual
  // Guardar datos para que bindTitulaciones pueda acceder a los detalles
  window._titResumenData = { lineas, titHoy, turno, fecha: today() };

  const resumenLineas = lineas.map(linea => {
    const t1 = titHoy.find(h => h.linea === linea && h.turno === turno && h.numero_titulacion === 1);
    const t2 = titHoy.find(h => h.linea === linea && h.turno === turno && h.numero_titulacion === 2);
    const badge = (h, num) => {
      const base = `class="tit-resumen-badge" data-linea="${linea}" data-turno="${turno}" data-num="${num}" data-tid="${h?.id||''}" data-estado="${h ? h.estado : 'pendiente'}" style="cursor:pointer;border:none;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;`;
      if (!h)                                          return `<button ${base}background:#fef2f2;color:#dc2626">❌ Pendiente</button>`;
      if (h.estado === 'paro_linea')                   return `<button ${base}background:#f3f4f6;color:#6b7280">⛔ Paro</button>`;
      if (h.estado === 'fuera_de_rango')               return `<button ${base}background:#fee2e2;color:#dc2626">🔴 Fuera rango</button>`;
      if (h.estado === 'completo' || h.estado === 'corregido') return `<button ${base}background:#dcfce7;color:#16a34a">✅ OK</button>`;
      return `<button ${base}background:#fef3c7;color:#d97706">⏳ Parcial</button>`;
    };
    const pendiente1 = !t1;
    const pendiente2 = !t2;
    const rowBg = (pendiente1 || pendiente2) ? '#fffbeb' : '';
    return `<tr style="background:${rowBg}">
      <td style="padding:6px 12px;font-size:13px;font-weight:600">${linea}</td>
      <td style="padding:6px 10px">${badge(t1,1)} <span style="font-size:11px;color:#78716c">${turno}.1</span></td>
      <td style="padding:6px 10px">${badge(t2,2)} <span style="font-size:11px;color:#78716c">${turno}.2</span></td>
    </tr>`;
  }).join('');

  const totalPendientes = lineas.reduce((acc, linea) => {
    const t1 = titHoy.find(h => h.linea === linea && h.turno === turno && h.numero_titulacion === 1);
    const t2 = titHoy.find(h => h.linea === linea && h.turno === turno && h.numero_titulacion === 2);
    return acc + (!t1 ? 1 : 0) + (!t2 ? 1 : 0);
  }, 0);

  const panelColor = totalPendientes === 0 ? '#f0fdf4' : '#fffbeb';
  const panelBorder = totalPendientes === 0 ? '#bbf7d0' : '#fde68a';

  return `
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-bottom:20px;max-width:900px">
    <div id="cpk-semanal-grid"><span style="color:#94a3b8;font-size:13px">⏳ Calculando CPK semanal...</span></div>
  </div>
  <div style="background:${panelColor};border:1px solid ${panelBorder};border-radius:10px;padding:16px 20px;margin-bottom:20px;max-width:900px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div>
        <span style="font-size:16px;font-weight:700">${saludo}, ${state.user?.full_name?.split(' ')[0] || state.user?.full_name || ''}!</span>
        <span style="font-size:13px;color:#78716c;margin-left:10px">Turno ${turno} · ${today()}</span>
      </div>
      <span style="font-size:13px;font-weight:600;color:${totalPendientes===0?'#16a34a':'#d97706'}">
        ${totalPendientes===0 ? '✅ Todas las titulaciones completas' : `⚠️ ${totalPendientes} titulación(es) pendiente(s)`}
      </span>
    </div>
    <table style="border-collapse:collapse;width:100%">
      <thead><tr>
        <th style="padding:5px 12px;font-size:12px;text-align:left;color:#78716c;font-weight:600">Línea</th>
        <th style="padding:5px 10px;font-size:12px;text-align:left;color:#78716c;font-weight:600">Titulación ${turno}.1</th>
        <th style="padding:5px 10px;font-size:12px;text-align:left;color:#78716c;font-weight:600">Titulación ${turno}.2</th>
      </tr></thead>
      <tbody>${resumenLineas}</tbody>
    </table>
  </div>
  <div class="form-card" style="max-width:900px">
    <h3>🔬 Nueva Titulación</h3>
    <div class="form-grid" style="grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      <div class="form-group"><label>Línea *</label>
        <select id="tit-linea"><option value="">-- Seleccionar --</option>
          ${lineas.map(l => `<option>${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Fecha</label><input type="date" id="tit-fecha" value="${today()}" /></div>
      <div class="form-group"><label>Turno *</label>
        <select id="tit-turno"><option value="">--</option><option value="1" ${turno===1?'selected':''}>1</option><option value="2" ${turno===2?'selected':''}>2</option><option value="3" ${turno===3?'selected':''}>3</option></select>
      </div>
      <div class="form-group"><label>Titulación</label>
        <select id="tit-num"><option value="1">1ª del turno (x.1)</option><option value="2">2ª del turno (x.2)</option></select>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-primary" id="btn-tit-cargar">Cargar formulario</button>
      <button class="btn btn-outline" id="btn-tit-paro" style="color:#6b7280;border-color:#d1d5db">⛔ Turno no trabajado</button>
      <span id="tit-clave-label" style="align-self:center;font-size:13px;color:#78716c"></span>
    </div>
    <div id="tit-form-area"></div>
  </div>`;
}

function bindTitulaciones() {
  // ── CPK Semanal ────────────────────────────────────────────────────────────
  loadCpkSemanal(document.getElementById('cpk-semanal-grid'));

  // ── Badges del resumen de turno ────────────────────────────────────────────
  document.querySelectorAll('.tit-resumen-badge').forEach(btn => {
    btn.addEventListener('click', () => {
      const { linea, turno, num, tid, estado } = btn.dataset;
      const { titHoy, fecha } = window._titResumenData || {};
      const h = tid ? (titHoy||[]).find(x => x.id === Number(tid)) : null;

      // ── Pendiente: no registrada ─────────────────────────────────────────
      if (estado === 'pendiente') {
        showModal(`
          <h3 style="margin:0 0 8px">❌ Titulación pendiente</h3>
          <p style="font-size:13px;color:#374151;margin-bottom:4px"><strong>${linea}</strong> — Turno ${turno}.${num} · ${fecha}</p>
          <p style="font-size:13px;color:#78716c;margin-bottom:20px">Esta titulación aún no ha sido registrada.</p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button class="btn btn-primary" id="badge-ir-registrar">📝 Registrar ahora</button>
            <button class="btn btn-outline" id="badge-marcar-paro" style="color:#6b7280;border-color:#d1d5db">⛔ Marcar como turno no trabajado</button>
            <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
          </div>`);
        document.getElementById('badge-ir-registrar').onclick = () => {
          closeModal();
          document.getElementById('tit-linea').value = linea;
          document.getElementById('tit-fecha').value = fecha;
          document.getElementById('tit-turno').value = turno;
          document.getElementById('tit-num').value = num;
          document.getElementById('btn-tit-cargar').click();
          document.getElementById('tit-form-area')?.scrollIntoView({ behavior: 'smooth' });
        };
        document.getElementById('badge-marcar-paro').onclick = async () => {
          if (!confirm(`¿Marcar turno ${turno}.${num} de ${linea} (${fecha}) como turno no trabajado?`)) return;
          try {
            await POST('/titulaciones', { linea, fecha, turno: Number(turno), numero_titulacion: Number(num), paro_linea: true });
            closeModal();
            navigate('titulaciones');
          } catch(e) { alert('Error: ' + e.message); }
        };
        return;
      }

      // ── Paro: info ───────────────────────────────────────────────────────
      if (estado === 'paro_linea') {
        showModal(`
          <h3 style="margin:0 0 8px">⛔ Turno no trabajado</h3>
          <p style="font-size:13px;color:#374151"><strong>${linea}</strong> — Turno ${turno}.${num} · ${fecha}</p>
          <p style="font-size:13px;color:#78716c;margin-top:8px">Este turno fue marcado como paro de línea y no cuenta en estadísticas.</p>
          <div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">Cerrar</button></div>`);
        return;
      }

      // ── Fuera de rango: mostrar parámetros problemáticos ─────────────────
      if (estado === 'fuera_de_rango') {
        const fuera = (h?.detalle||[]).filter(d => d.estado_param === 'fuera' || d.estado_param === 'limite');
        const lista = fuera.map(d => {
          const p = d.param || {};
          const rango = p.tipo_rango==='entre' ? `${p.valor_min}–${p.valor_max}` : p.tipo_rango==='maximo' ? `≤ ${p.valor_max}` : p.tipo_rango==='minimo' ? `≥ ${p.valor_min}` : '—';
          const esBajo = (p.tipo_rango==='minimo'||p.tipo_rango==='entre') && d.valor_registrado < p.valor_min;
          const color = d.estado_param==='fuera' ? '#dc2626' : '#d97706';
          const flecha = esBajo ? '↓' : '↑';
          return `<tr style="border-bottom:1px solid #fee2e2">
            <td style="padding:5px 10px;font-size:13px;font-weight:600">${p.nombre_parametro||'?'}</td>
            <td style="padding:5px 8px;font-size:12px;color:#78716c;text-align:center">${rango} ${p.unidad||''}</td>
            <td style="padding:5px 8px;text-align:center;font-weight:700;color:${color}">${flecha} ${d.valor_registrado??'—'}</td>
            <td style="padding:5px 8px;font-size:11px;color:#b45309">${p.quimico ? '→ '+p.quimico : ''}</td>
          </tr>`;
        }).join('');
        showModal(`
          <h3 style="margin:0 0 8px;color:#dc2626">🔴 Parámetros fuera de rango</h3>
          <p style="font-size:13px;color:#78716c;margin-bottom:12px"><strong>${linea}</strong> — Turno ${turno}.${num} · ${fecha}</p>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr style="background:#fef2f2">
                <th style="padding:5px 10px;text-align:left">Parámetro</th>
                <th style="padding:5px 8px;text-align:center">Rango</th>
                <th style="padding:5px 8px;text-align:center">Valor</th>
                <th style="padding:5px 8px;text-align:left">Quimico</th>
              </tr></thead>
              <tbody>${lista}</tbody>
            </table>
          </div>
          <div class="modal-actions">
            <button class="btn btn-outline" onclick="closeModal()">Cerrar</button>
            <button class="btn btn-primary" onclick="closeModal();verTitulacion(${h?.id})">Ver completa</button>
          </div>`);
        return;
      }

      // ── Parcial/pendiente con datos: mostrar parámetros sin dato ────────
      if (h && (h.estado === 'pendiente' || estado === 'pendiente')) {
        const sinDato = (h?.detalle||[]).filter(d => d.estado_param === 'sin_dato');
        const lista = sinDato.map(d => {
          const p = d.param || {};
          return `<li style="padding:3px 0;font-size:13px"><strong>${p.no_tanque||''}</strong> — ${p.nombre_parametro||'?'} <span style="color:#78716c">(${p.unidad||''})</span></li>`;
        }).join('');
        showModal(`
          <h3 style="margin:0 0 8px;color:#d97706">⏳ Parámetros sin registrar</h3>
          <p style="font-size:13px;color:#78716c;margin-bottom:12px"><strong>${linea}</strong> — Turno ${turno}.${num} · ${fecha}</p>
          <ul style="padding-left:18px;margin:0 0 16px">${lista||'<li style="color:#78716c">Sin detalles disponibles</li>'}</ul>
          <div class="modal-actions">
            <button class="btn btn-outline" onclick="closeModal()">Cerrar</button>
            <button class="btn btn-primary" onclick="closeModal();editTitulacion(${h?.id},'${linea}',${turno},${num},'${fecha}')">✏️ Completar ahora</button>
          </div>`);
        return;
      }

      // ── OK / Corregido: ver detalle ──────────────────────────────────────
      if (h) { closeModal(); verTitulacion(h.id); }
    });
  });

  // ── Turno no trabajado ─────────────────────────────────────────────────────
  document.getElementById('btn-tit-paro').addEventListener('click', async () => {
    const linea = document.getElementById('tit-linea').value;
    const fecha = document.getElementById('tit-fecha').value;
    const turno = document.getElementById('tit-turno').value;
    if (!linea || !fecha || !turno) { alert('Selecciona línea, fecha y turno antes de marcar paro'); return; }
    if (!confirm(`¿Marcar turno ${turno} del ${fecha} en ${linea} como "Turno no trabajado"?\nEsto registrará todas las titulaciones del turno como paro de línea y no contarán en estadísticas.`)) return;
    try {
      // Registrar num=1 y num=2 como paro
      await Promise.all([1, 2].map(num =>
        POST('/titulaciones', { linea, fecha, turno: Number(turno), numero_titulacion: num, paro_linea: true }).catch(e => {
          if (!e.message?.includes('409') && !e.message?.includes('Ya existe')) throw e;
        })
      ));
      alert(`⛔ Turno ${turno} de ${linea} marcado como no trabajado.`);
      navigate('titulaciones');
    } catch(e) { alert('Error: ' + e.message); }
  });

  document.getElementById('btn-tit-cargar').addEventListener('click', async () => {
    const linea = document.getElementById('tit-linea').value;
    const fecha = document.getElementById('tit-fecha').value;
    const turno = document.getElementById('tit-turno').value;
    const num   = document.getElementById('tit-num').value;
    if (!linea || !fecha || !turno) { alert('Selecciona línea, fecha y turno'); return; }
    const clave = `${turno}.${num}`;
    document.getElementById('tit-clave-label').textContent = `Titulación ${clave} — ${fecha}`;
    const area = document.getElementById('tit-form-area');
    area.innerHTML = '<div class="empty-state"><div class="icon">⏳</div></div>';
    try {
      // Verificar si ya existe
      const existentes = await GET(`/titulaciones?linea=${encodeURIComponent(linea)}&fecha_ini=${fecha}&fecha_fin=${fecha}`);
      const yaExiste = existentes.find(h => h.turno === Number(turno) && h.numero_titulacion === Number(num));

      // Cargar parámetros + tanques para saber químicos activos
      const [tanques, params] = await Promise.all([
        GET('/tanques?linea=' + encodeURIComponent(linea)),
        GET('/parametros-titulacion?activo=true')
      ]);
      // Filtrar parámetros de esta línea
      const paramsLinea = params.filter(p => {
        const t = tanques.find(x => x.id === p.tanque_id);
        if (!t) return false;
        if (p.frecuencia === 1 && Number(num) !== 1) return false;
        return true;
      });

      if (paramsLinea.length === 0) {
        area.innerHTML = `<div class="alert alert-warn">⚠️ No hay parámetros activos para <strong>${linea}</strong>.<br>
          Ve a <em>Catálogo Parámetros</em> para configurarlos o corre el seed inicial.</div>
          <button class="btn btn-outline" onclick="POST('/parametros-titulacion/seed',{}).then(()=>navigate('titulaciones'))">Cargar seed inicial</button>`;
        return;
      }

      // Agrupar por tanque
      const grupos = {};
      paramsLinea.forEach(p => {
        const key = p.tanque_id;
        if (!grupos[key]) grupos[key] = { tanque: tanques.find(t => t.id === p.tanque_id), params: [] };
        grupos[key].params.push(p);
      });

      const valoresPrevios = {};
      if (yaExiste) {
        yaExiste.detalle?.forEach(d => { valoresPrevios[d.parametro_id] = d.valor_registrado; });
      }

      const gruposHtml = Object.values(grupos).sort((a, b) => String(a.tanque?.no_tanque||'').localeCompare(String(b.tanque?.no_tanque||''), undefined, {numeric:true})).map(g => {
        const t = g.t || g.tanque;
        const quimicoLabel = t?.quimico_activo ? ` <small style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:3px">${t.quimico_activo}</small>` : '';
        const rowsHtml = g.params.sort((a,b)=>a.orden-b.orden).map(p => {
          const rangoTxt = p.tipo_rango === 'entre' ? `${p.valor_min} – ${p.valor_max}${p.objetivo!=null?' / obj:'+p.objetivo:''}` :
                           p.tipo_rango === 'maximo' ? `máx ${p.valor_max}` :
                           p.tipo_rango === 'minimo' ? `mín ${p.valor_min}` : '—';
          const prev = valoresPrevios[p.id] != null ? valoresPrevios[p.id] : '';
          return `<tr>
            <td style="font-size:13px">${p.nombre_parametro}${p.frecuencia===1?' <small style="color:#78716c">(1×turno)</small>':''}</td>
            <td style="font-size:12px;color:#78716c">${rangoTxt} ${p.unidad}</td>
            <td><input type="number" step="any" class="tit-input" data-pid="${p.id}" data-min="${p.valor_min??''}" data-max="${p.valor_max??''}" data-tipo="${p.tipo_rango}" style="width:100px;padding:4px 8px;border:1.5px solid #e7e5e4;border-radius:6px" value="${prev}" oninput="titColorInput(this)" /></td>
            <td id="tit-estado-${p.id}" style="font-size:12px;min-width:70px"></td>
            <td><input type="text" class="tit-obs" data-pid="${p.id}" placeholder="Obs." style="width:140px;padding:4px 8px;border:1.5px solid #e7e5e4;border-radius:6px;font-size:12px" /></td>
          </tr>`;
        }).join('');
        return `
        <div class="table-card" style="margin-bottom:12px">
          <div class="table-header" style="background:#f8fafc;padding:10px 16px">
            <h4 style="margin:0;font-size:14px">${t?.no_tanque || ''} — ${t?.nombre_tanque || ''}${quimicoLabel}</h4>
          </div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Parámetro</th><th>Rango / Objetivo</th><th>Valor</th><th>Estado</th><th>Observaciones</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>`;
      }).join('');

      area.innerHTML = `
        ${yaExiste ? `<div class="alert alert-info" style="margin-bottom:12px">✏️ Esta titulación ya existe (ID ${yaExiste.id}). Al guardar se <strong>sobreescribirán</strong> los valores (corrección).</div>` : ''}
        ${gruposHtml}
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
          <button class="btn btn-outline" onclick="navigate('tit-reporte')">Cancelar</button>
          <button class="btn btn-primary" id="btn-tit-guardar">💾 Guardar Titulación</button>
        </div>`;

      window._titContext = { linea, fecha, turno: Number(turno), num: Number(num), yaExiste, paramsLinea };

      window.titColorInput = function(input) {
        const pid = Number(input.dataset.pid);
        const val = parseFloat(input.value);
        const tipo = input.dataset.tipo;
        const min = parseFloat(input.dataset.min);
        const max = parseFloat(input.dataset.max);
        const estadoEl = document.getElementById('tit-estado-' + pid);
        if (!isNaN(val)) {
          let estado = 'ok';
          if (tipo === 'maximo' && val > max) estado = 'fuera';
          if (tipo === 'minimo' && val < min) estado = 'fuera';
          if (tipo === 'entre' && (val < min || val > max)) estado = 'fuera';
          input.style.borderColor = estadoColor(estado);
          input.style.background = estado === 'fuera' ? '#fef2f2' : estado === 'limite' ? '#fffbeb' : '';
          if (estadoEl) estadoEl.innerHTML = `<span style="color:${estadoColor(estado)};font-weight:600">${estadoBadge(estado)}</span>`;
        } else {
          input.style.borderColor = '';
          input.style.background = '';
          if (estadoEl) estadoEl.textContent = '';
        }
      };

      document.getElementById('btn-tit-guardar').addEventListener('click', async () => {
        const ctx = window._titContext;
        const valores = {};
        const observaciones = {};
        document.querySelectorAll('.tit-input').forEach(inp => {
          const pid = Number(inp.dataset.pid);
          const v = inp.value.trim();
          if (v !== '') valores[pid] = parseFloat(v);
        });
        document.querySelectorAll('.tit-obs').forEach(inp => {
          const pid = Number(inp.dataset.pid);
          if (inp.value.trim()) observaciones[pid] = inp.value.trim();
        });

        const btn = document.getElementById('btn-tit-guardar');
        btn.disabled = true; btn.textContent = 'Guardando...';

        try {
          let result;
          if (ctx.yaExiste) {
            result = await PATCH('/titulaciones/' + ctx.yaExiste.id, { valores, observaciones });
          } else {
            result = await POST('/titulaciones', {
              linea: ctx.linea, fecha: ctx.fecha, turno: ctx.turno,
              numero_titulacion: ctx.num, valores, observaciones
            });
          }

          // Si hay parámetros fuera de rango → modal de alerta diferenciada
          const fueraParams = (result.detalle || []).filter(d => d.estado_param === 'fuera');
          if (fueraParams.length > 0) {
            const bajos = [], altos = [];
            fueraParams.forEach(d => {
              const p = ctx.paramsLinea.find(x => x.id === d.parametro_id);
              if (!p) return;
              const val = d.valor_registrado;
              const esBajo = (p.tipo_rango === 'minimo' && val < p.valor_min) ||
                             (p.tipo_rango === 'entre'  && val < p.valor_min);
              if (esBajo) bajos.push({ d, p });
              else        altos.push({ d, p });
            });
            const listaHtml = (items, color, icono, etiqueta) => items.length === 0 ? '' : `
              <p style="font-size:12px;font-weight:700;color:${color};margin:10px 0 4px">${icono} ${etiqueta}</p>
              <ul style="margin:0 0 8px;padding-left:18px;font-size:13px">
                ${items.map(({d,p}) => `<li>
                  <strong>${p.no_tanque}</strong> — ${p.nombre_parametro}:
                  <span style="color:${color};font-weight:700"> ${d.valor_registrado} ${p.unidad||''}</span>
                  ${p.tipo_rango==='entre'?`(rango: ${p.valor_min}–${p.valor_max})`:p.tipo_rango==='minimo'?`(mín: ${p.valor_min})`:p.tipo_rango==='maximo'?`(máx: ${p.valor_max})`:''}
                  ${p.quimico ? `<br><span style="font-size:11px;color:#b45309">→ Requiere ajuste de <strong>${p.quimico}</strong></span>` : ''}
                </li>`).join('')}
              </ul>`;
            const hayBajos = bajos.length > 0;
            showModal(`
              <h3 style="color:#dc2626;margin:0 0 8px">⚠️ Parámetros fuera de especificación</h3>
              ${listaHtml(bajos, '#dc2626', '↓', 'Bajos — se requiere adición')}
              ${listaHtml(altos, '#ea580c', '↑', 'Altos — sobre especificación')}
              <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;font-size:12px;color:#92400e;margin-top:8px">
                ⚠️ Es necesario realizar una corrección y validar el parámetro nuevamente después del ajuste.
              </div>
              <div class="modal-actions" style="margin-top:16px">
                <button class="btn btn-outline" onclick="closeModal();navigate('tit-reporte')">Guardar sin ajuste</button>
                <button class="btn btn-outline" onclick="closeModal();generarReporteTitulacion(${result.id||result.header?.id})">📄 Ver reporte</button>
                ${hayBajos ? `<button class="btn btn-primary" onclick="closeModal();navigate('crear-vale')" style="background:#dc2626">Generar vale de adición</button>` : ''}
              </div>`);
          } else {
            const savedId = result.id || result.header?.id;
            showModal(`
              <h3 style="color:#16a34a;margin:0 0 10px">✅ Titulación guardada</h3>
              <p style="color:#374151;margin-bottom:16px">${ctx.linea} — ${ctx.turno} Tit. ${ctx.num} registrada correctamente.</p>
              <div class="modal-actions">
                <button class="btn btn-outline" onclick="closeModal();navigate('titulaciones')">Seguir capturando</button>
                <button class="btn btn-primary" onclick="closeModal();generarReporteTitulacion(${savedId})">📄 Generar reporte</button>
              </div>`);
          }
        } catch(e) {
          if (e.message.includes('409') || e.message.includes('Ya existe')) {
            alert('Esta titulación ya existe. Recarga el formulario para editarla.');
          } else {
            alert('Error: ' + e.message);
          }
          btn.disabled = false; btn.textContent = '💾 Guardar Titulación';
        }
      });

    } catch(e) {
      area.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`;
    }
  });
}

// ── Reporte Titulaciones ───────────────────────────────────────────────────────
async function viewTitReporte() {
  const lineas = await GET('/lineas').catch(() => []);
  return `
  <div class="filters-bar" style="flex-wrap:wrap;gap:8px">
    <div><label class="flabel">Línea</label><br>
      <select id="tr-linea"><option value="">Todas</option>${lineas.map(l=>`<option>${l}</option>`).join('')}</select>
    </div>
    <div><label class="flabel">Desde</label><br><input type="date" id="tr-ini" value="${monthStart()}" /></div>
    <div><label class="flabel">Hasta</label><br><input type="date" id="tr-fin" value="${today()}" /></div>
    <div><label class="flabel">Turno</label><br>
      <select id="tr-turno"><option value="">Todos</option><option>1</option><option>2</option><option>3</option></select>
    </div>
    <div><label class="flabel">Estado</label><br>
      <select id="tr-estado"><option value="">Todos</option>
        <option value="completo">Completo</option><option value="fuera_de_rango">Fuera rango</option>
        <option value="corregido">Corregido</option><option value="pendiente">Pendiente</option>
      </select>
    </div>
    <div style="align-self:flex-end;display:flex;gap:8px">
      <button class="btn btn-primary" id="btn-tr-buscar">🔍 Buscar</button>
      <button class="btn btn-outline" id="btn-tr-export">⬇️ Excel</button>
    </div>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
    <span style="font-size:12px;color:#78716c;align-self:center">Período rápido:</span>
    <button class="btn btn-outline btn-sm" onclick="trPeriodo('semana')">Esta semana</button>
    <button class="btn btn-outline btn-sm" onclick="trPeriodo('semana-ant')">Semana anterior</button>
    <button class="btn btn-outline btn-sm" onclick="trPeriodo('mes')">Este mes</button>
    <button class="btn btn-outline btn-sm" onclick="trPeriodo('mes-ant')">Mes anterior</button>
    <button class="btn btn-outline btn-sm" onclick="trPeriodo('sem4')">Últimas 4 semanas</button>
    <button class="btn btn-outline btn-sm" onclick="trPeriodo('anio')">2026 completo</button>
    <div style="margin-left:auto;display:flex;gap:6px;align-items:center">
      <span style="font-size:12px;color:#78716c">Vista:</span>
      <button class="btn btn-outline btn-sm" id="tr-vista-lista" onclick="trSetVista('lista')">Lista</button>
      <button class="btn btn-outline btn-sm" id="tr-vista-pivot" onclick="trSetVista('pivot')">Tabla</button>
    </div>
  </div>
  <div id="tr-result"></div>`;
}

window._trVista = 'lista';
window.trSetVista = function(v) {
  window._trVista = v;
  document.getElementById('tr-vista-lista')?.classList.toggle('btn-primary', v==='lista');
  document.getElementById('tr-vista-lista')?.classList.toggle('btn-outline', v!=='lista');
  document.getElementById('tr-vista-pivot')?.classList.toggle('btn-primary', v==='pivot');
  document.getElementById('tr-vista-pivot')?.classList.toggle('btn-outline', v!=='pivot');
  document.getElementById('btn-tr-buscar')?.click();
};

window.trPeriodo = function(tipo) {
  const now = new Date();
  let ini, fin = today();
  if (tipo === 'semana') {
    const day = now.getDay() || 7; // 1=Mon..7=Sun
    const mon = new Date(now); mon.setDate(now.getDate() - day + 1);
    ini = mon.toISOString().slice(0,10);
  } else if (tipo === 'semana-ant') {
    const day = now.getDay() || 7;
    const mon = new Date(now); mon.setDate(now.getDate() - day - 6);
    const sun = new Date(now); sun.setDate(now.getDate() - day);
    ini = mon.toISOString().slice(0,10); fin = sun.toISOString().slice(0,10);
  } else if (tipo === 'mes') {
    ini = monthStart();
  } else if (tipo === 'mes-ant') {
    const prev = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    ini = prev.toISOString().slice(0,10); fin = prevEnd.toISOString().slice(0,10);
  } else if (tipo === 'sem4') {
    const d = new Date(now); d.setDate(d.getDate()-28);
    ini = d.toISOString().slice(0,10);
  } else if (tipo === 'anio') {
    ini = '2026-01-01'; fin = '2026-12-31';
  }
  document.getElementById('tr-ini').value = ini;
  document.getElementById('tr-fin').value = fin;
  document.getElementById('btn-tr-buscar').click();
};

function renderTitLista(rows) {
  const ESTADO_BADGE = {
    completo:      '<span style="background:#dcfce7;color:#16a34a;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600">✅ OK</span>',
    fuera_de_rango:'<span style="background:#fee2e2;color:#dc2626;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600">🔴 Fuera</span>',
    corregido:     '<span style="background:#fef3c7;color:#d97706;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600">✏️ Corr.</span>',
    pendiente:     '<span style="background:#f1f5f9;color:#64748b;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600">⏳</span>',
    paro_linea:    '<span style="background:#f3f4f6;color:#6b7280;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600">⛔ Paro</span>'
  };
  return `<div class="table-card">
    <div class="table-header"><h3>${rows.length} titulación(es)</h3></div>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Fecha</th><th>Línea</th><th>Turno</th><th>Analista</th><th>Estado</th>
          <th style="text-align:center">OK / Fuera / Total</th><th></th>
        </tr></thead>
        <tbody>${rows.map(r => {
          const total = (r.detalle||[]).length;
          const fuera = (r.detalle||[]).filter(d=>d.estado_param==='fuera').length;
          const ok    = (r.detalle||[]).filter(d=>d.estado_param==='ok').length;
          const rowBg = fuera>0 ? 'background:#fff5f5' : '';
          return `<tr style="${rowBg}">
            <td style="font-weight:600">${r.fecha}</td>
            <td style="font-size:12px">${r.linea}</td>
            <td style="text-align:center">${r.clave_titulacion}</td>
            <td style="font-size:12px;color:#78716c">${r.analista||'-'}</td>
            <td>${ESTADO_BADGE[r.estado]||r.estado}</td>
            <td style="text-align:center;font-size:12px">
              <span style="color:#16a34a;font-weight:600">${ok}</span>
              ${fuera>0?` / <span style="color:#dc2626;font-weight:600">${fuera}</span>`:''}
              / ${total}
            </td>
            <td style="white-space:nowrap">
              <button class="btn btn-outline btn-sm" onclick="verTitulacion(${r.id})">Ver</button>
              <button class="btn btn-outline btn-sm" onclick="editTitulacion(${r.id},'${r.linea}',${r.turno},${r.numero_titulacion},'${r.fecha}')">✏️</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

function renderTitPivot(rows) {
  // Agrupar por línea → tabla pivote: filas=titulaciones, columnas=params
  const lines = [...new Set(rows.map(r=>r.linea))].sort();
  return lines.map(linea => {
    const lineRows = rows.filter(r=>r.linea===linea).sort((a,b)=>a.fecha.localeCompare(b.fecha)||a.clave_titulacion.localeCompare(b.clave_titulacion));
    // Construir mapa de parámetros únicos
    const paramMap = {};
    lineRows.forEach(h => (h.detalle||[]).forEach(d => {
      if (!paramMap[d.parametro_id]) paramMap[d.parametro_id] = d.param||{};
    }));
    // Agrupar params por tanque
    const byTank = {};
    Object.entries(paramMap).forEach(([pid, p]) => {
      const tk = p.no_tanque||'?';
      if (!byTank[tk]) byTank[tk] = [];
      byTank[tk].push({ pid: Number(pid), ...p });
    });
    const tanks = Object.keys(byTank).sort();
    // Ordenar params dentro de cada tanque por orden
    tanks.forEach(tk => byTank[tk].sort((a,b)=>(a.orden||0)-(b.orden||0)));
    const allParams = tanks.flatMap(tk => byTank[tk]);

    // Header row 1: tanque grupos
    const thTanques = tanks.map(tk => {
      const cnt = byTank[tk].length;
      const shortTk = tk.replace(/^T\d+:\s*/,'');
      return `<th colspan="${cnt}" style="background:#1e3a5f;color:#fff;text-align:center;font-size:11px;padding:5px 4px;border:1px solid #334155">${shortTk}</th>`;
    }).join('');

    // Header row 2: param names (click → ver/editar especificaciones)
    const thParams = allParams.map(p =>
      `<th data-pid="${p.pid}" style="background:#334155;color:#e2e8f0;text-align:center;font-size:10px;padding:4px 3px;border:1px solid #475569;white-space:nowrap;max-width:80px;overflow:hidden;text-overflow:ellipsis;cursor:pointer" title="${p.nombre_parametro} — Click para ver especificaciones">${p.nombre_parametro.length>10?p.nombre_parametro.slice(0,9)+'…':p.nombre_parametro}</th>`
    ).join('');

    // Data rows
    const dataRows = lineRows.map(h => {
      const detalleMap = {};
      (h.detalle||[]).forEach(d => { detalleMap[d.parametro_id] = d; });
      const esParo = h.estado === 'paro_linea';
      const fuera = (h.detalle||[]).filter(d=>d.estado_param==='fuera').length;
      const rowBg = esParo ? '#f3f4f6' : fuera>0 ? '#fff5f5' : '';
      const cells = allParams.map(p => {
        if (esParo) return `<td style="border:1px solid #e7e5e4;text-align:center;font-size:11px;color:#9ca3af;background:#f9fafb">⛔</td>`;
        const d = detalleMap[p.pid];
        // Sin detalle = parámetro no programado para esta titulación (N/A)
        if (!d) return `<td style="border:1px solid #e7e5e4;text-align:center;font-size:10px;color:#d1d5db;background:#fafafa">N/A</td>`;
        const val = d.valor_registrado;
        // Sin valor pero sí programado = sin dato
        if (val === null || val === undefined) return `<td style="border:1px solid #e7e5e4;text-align:center;font-size:11px;color:#9ca3af">—</td>`;
        const bg = d.estado_param==='fuera' ? '#fee2e2' : d.estado_param==='limite' ? '#fffbeb' : '';
        const fc = d.estado_param==='fuera' ? '#dc2626' : '';
        const corrMark = d.corregido ? ' <span style="font-size:9px;color:#d97706" title="Corregido">✏</span>' : '';
        return `<td style="border:1px solid #e7e5e4;text-align:center;font-size:11px;padding:3px 4px;background:${bg};color:${fc};font-weight:${fc?'700':'normal'}">${val}${corrMark}</td>`;
      }).join('');
      return `<tr style="background:${rowBg}">
        <td style="border:1px solid #e7e5e4;padding:3px 6px;font-size:12px;white-space:nowrap;font-weight:600">${h.fecha}</td>
        <td style="border:1px solid #e7e5e4;padding:3px 6px;font-size:11px;text-align:center">${h.clave_titulacion}</td>
        <td style="border:1px solid #e7e5e4;padding:3px 6px;font-size:11px;color:#78716c">${h.analista||'-'}</td>
        ${cells}
        <td style="border:1px solid #e7e5e4;padding:3px 4px">${esParo ? '' : `<button class="btn btn-outline btn-xs" onclick="verTitulacion(${h.id})">Ver</button>`}</td>
      </tr>`;
    }).join('');

    return `<div class="table-card" style="margin-bottom:16px">
      <div class="table-header" style="background:#1e3a5f"><h3 style="color:#fff">${linea} — ${lineRows.length} titulaciones</h3></div>
      <div style="overflow-x:auto">
        <table style="border-collapse:collapse;min-width:100%;font-size:12px">
          <thead>
            <tr>
              <th rowspan="2" style="background:#0f2340;color:#fff;padding:5px 8px;border:1px solid #334155;white-space:nowrap">Fecha</th>
              <th rowspan="2" style="background:#0f2340;color:#fff;padding:5px 6px;border:1px solid #334155">Turno</th>
              <th rowspan="2" style="background:#0f2340;color:#fff;padding:5px 6px;border:1px solid #334155">Analista</th>
              ${thTanques}
              <th rowspan="2" style="background:#0f2340;color:#fff;border:1px solid #334155"></th>
            </tr>
            <tr>${thParams}</tr>
          </thead>
          <tbody>${dataRows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

function bindTitReporte() {
  let _titData = [];
  const buscar = async () => {
    const linea  = document.getElementById('tr-linea').value;
    const ini    = document.getElementById('tr-ini').value;
    const fin    = document.getElementById('tr-fin').value;
    const turno  = document.getElementById('tr-turno').value;
    const estado = document.getElementById('tr-estado').value;
    let q = '?';
    if (linea)  q += `linea=${encodeURIComponent(linea)}&`;
    if (ini)    q += `fecha_ini=${ini}&`;
    if (fin)    q += `fecha_fin=${fin}&`;
    if (turno)  q += `turno=${turno}&`;
    if (estado) q += `estado=${estado}&`;
    const el = document.getElementById('tr-result');
    el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div></div>';
    try {
      const rows = await GET('/titulaciones' + q);
      _titData = rows;
      if (!rows.length) { el.innerHTML = '<div class="empty-state"><div class="icon">🔬</div><p>Sin titulaciones en este rango</p></div>'; return; }

      const total = rows.length;
      const nFuera = rows.filter(r=>r.estado==='fuera_de_rango').length;
      const nOk    = rows.filter(r=>r.estado==='completo').length;
      const nCorr  = rows.filter(r=>r.estado==='corregido').length;

      const resumen = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 16px;min-width:100px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:#16a34a">${total}</div>
          <div style="font-size:11px;color:#78716c">Total</div>
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 16px;min-width:100px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:#16a34a">${nOk}</div>
          <div style="font-size:11px;color:#78716c">Completas</div>
        </div>
        ${nFuera>0?`<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 16px;min-width:100px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:#dc2626">${nFuera}</div>
          <div style="font-size:11px;color:#78716c">Fuera de rango</div>
        </div>`:''}
        ${nCorr>0?`<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 16px;min-width:100px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:#d97706">${nCorr}</div>
          <div style="font-size:11px;color:#78716c">Corregidas</div>
        </div>`:''}
      </div>`;

      if (window._trVista === 'pivot') {
        el.innerHTML = resumen + renderTitPivot(rows);
        // Click en cabecera de parámetro → ver/editar especificaciones
        el.querySelectorAll('th[data-pid]').forEach(th => {
          th.addEventListener('click', async () => {
            const pid = Number(th.dataset.pid);
            const params = await GET('/parametros-titulacion').catch(() => []);
            const p = params.find(x => x.id === pid);
            if (!p) return;
            const isAdmin = state.user?.vales_role === 'admin';
            const rangoLabel = p.tipo_rango === 'entre' ? 'Entre (mín – máx)' : p.tipo_rango === 'maximo' ? 'Máximo' : p.tipo_rango === 'minimo' ? 'Mínimo' : 'Sin rango';
            showModal(`
              <h3 style="margin:0 0 4px">📋 ${p.nombre_parametro}</h3>
              <p style="margin:0 0 16px;font-size:12px;color:#78716c">${p.no_tanque} — ${p.nombre_tanque}${p.quimico ? ' · ' + p.quimico : ''}</p>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
                <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Tipo de rango</label>
                  ${isAdmin ? `<select id="ep-tipo" style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:13px">
                    <option value="ninguno" ${p.tipo_rango==='ninguno'?'selected':''}>Sin rango</option>
                    <option value="entre" ${p.tipo_rango==='entre'?'selected':''}>Entre (mín – máx)</option>
                    <option value="maximo" ${p.tipo_rango==='maximo'?'selected':''}>Máximo</option>
                    <option value="minimo" ${p.tipo_rango==='minimo'?'selected':''}>Mínimo</option>
                  </select>` : `<span style="font-size:13px">${rangoLabel}</span>`}
                </div>
                <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Unidad</label>
                  ${isAdmin ? `<input id="ep-unidad" value="${p.unidad||''}" style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:13px"/>` : `<span style="font-size:13px">${p.unidad||'—'}</span>`}
                </div>
                <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Valor mínimo</label>
                  ${isAdmin ? `<input id="ep-min" type="number" step="any" value="${p.valor_min??''}" style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:13px"/>` : `<span style="font-size:13px">${p.valor_min??'—'}</span>`}
                </div>
                <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Valor máximo</label>
                  ${isAdmin ? `<input id="ep-max" type="number" step="any" value="${p.valor_max??''}" style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:13px"/>` : `<span style="font-size:13px">${p.valor_max??'—'}</span>`}
                </div>
                <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Objetivo</label>
                  ${isAdmin ? `<input id="ep-obj" type="number" step="any" value="${p.objetivo??''}" style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:13px"/>` : `<span style="font-size:13px">${p.objetivo??'—'}</span>`}
                </div>
                <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Frecuencia</label>
                  <span style="font-size:13px">${p.frecuencia===1?'1× por turno':'2× por turno'}</span>
                </div>
              </div>
              <div id="ep-msg" style="font-size:12px;color:#dc2626;margin-bottom:8px"></div>
              <div class="modal-actions">
                <button class="btn btn-outline" onclick="closeModal()">Cerrar</button>
                ${isAdmin ? `<button class="btn btn-primary" id="ep-save-btn">💾 Guardar cambios</button>` : ''}
              </div>`);
            if (isAdmin) {
              document.getElementById('ep-save-btn').addEventListener('click', async () => {
                const saveBtn = document.getElementById('ep-save-btn');
                const msgEl = document.getElementById('ep-msg');
                saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
                try {
                  const payload = {
                    tipo_rango: document.getElementById('ep-tipo').value,
                    unidad: document.getElementById('ep-unidad').value,
                    valor_min: document.getElementById('ep-min').value !== '' ? parseFloat(document.getElementById('ep-min').value) : null,
                    valor_max: document.getElementById('ep-max').value !== '' ? parseFloat(document.getElementById('ep-max').value) : null,
                    objetivo: document.getElementById('ep-obj').value !== '' ? parseFloat(document.getElementById('ep-obj').value) : null
                  };
                  await PATCH('/parametros-titulacion/' + pid, payload);
                  closeModal();
                  buscar();
                } catch(e) {
                  msgEl.textContent = e.message || 'Error al guardar';
                  saveBtn.disabled = false; saveBtn.textContent = '💾 Guardar cambios';
                }
              });
            }
          });
        });
      } else {
        el.innerHTML = resumen + renderTitLista(rows);
      }
    } catch(e) { el.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`; }
  };
  document.getElementById('btn-tr-buscar').addEventListener('click', buscar);
  // Sync vista buttons on bind
  trSetVista(window._trVista || 'lista');
  buscar();

  // Export Excel
  document.getElementById('btn-tr-export').addEventListener('click', () => {
    if (!_titData.length) { alert('Primero realiza una búsqueda'); return; }
    const rows = [];
    _titData.forEach(h => {
      (h.detalle||[]).forEach(d => {
        const p = d.param || {};
        rows.push({
          Fecha: h.fecha, Línea: h.linea, Clave: h.clave_titulacion, Turno: h.turno,
          Analista: h.analista||'', Estado: h.estado,
          Tanque: p.no_tanque||'', 'Nombre Tanque': p.nombre_tanque||'',
          Parámetro: p.nombre_parametro||'', Unidad: p.unidad||'',
          'Rango Min': p.valor_min??'', 'Rango Max': p.valor_max??'', Objetivo: p.objetivo??'',
          Valor: d.valor_registrado??'', 'Estado Parámetro': d.estado_param,
          Corregido: d.corregido?'Sí':'No', 'Valor Original': d.valor_original??'',
          Observaciones: d.observaciones||''
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Titulaciones');
    XLSX.writeFile(wb, `titulaciones_${document.getElementById('tr-ini').value}_${document.getElementById('tr-fin').value}.xlsx`);
  });
}

window.verTitulacion = async function(id) {
  const t = await GET('/titulaciones/' + id);
  const grupos = {};
  (t.detalle||[]).forEach(d => {
    const p = d.param || {};
    const key = p.no_tanque || p.tanque_id || 'sin';
    if (!grupos[key]) grupos[key] = { tanque: p.no_tanque || ('Tanque ' + p.tanque_id), rows: [] };
    grupos[key].rows.push(d);
  });

  const fuera = (t.detalle||[]).filter(d=>d.estado_param==='fuera').length;
  const estadoColor2 = fuera>0 ? '#dc2626' : '#16a34a';
  const estadoTxt = fuera>0 ? `🔴 ${fuera} fuera de rango` : '✅ Todo en rango';

  const html = Object.values(grupos).map(g => {
    const tkShort = g.tanque.replace(/^T\d+:\s*/,'');
    return `<div style="margin-bottom:10px;border:1px solid #e7e5e4;border-radius:6px;overflow:hidden">
      <div style="background:#1e3a5f;color:#fff;font-size:12px;font-weight:700;padding:6px 12px">${g.tanque}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:5px 10px;border-bottom:1px solid #e7e5e4;text-align:left">Parámetro</th>
          <th style="padding:5px 8px;border-bottom:1px solid #e7e5e4;text-align:center">Rango</th>
          <th style="padding:5px 10px;border-bottom:1px solid #e7e5e4;text-align:center">Valor</th>
          <th style="padding:5px 8px;border-bottom:1px solid #e7e5e4;text-align:center">Estado</th>
          <th style="padding:5px 8px;border-bottom:1px solid #e7e5e4;text-align:left;color:#78716c">Obs.</th>
        </tr></thead>
        <tbody>${g.rows.map(d => {
          const p = d.param||{};
          const rango = p.tipo_rango==='entre' ? `${p.valor_min??''}–${p.valor_max??''}` : p.tipo_rango==='maximo' ? `≤ ${p.valor_max}` : p.tipo_rango==='minimo' ? `≥ ${p.valor_min}` : '—';
          const bg = d.estado_param==='fuera'?'#fef2f2':d.estado_param==='limite'?'#fffbeb':'';
          const fc = d.estado_param==='fuera'?'#dc2626':'';
          return `<tr style="background:${bg};border-bottom:1px solid #f3f4f6">
            <td style="padding:5px 10px">${p.nombre_parametro||'?'}${p.unidad?' <span style="color:#78716c;font-size:10px">('+p.unidad+')</span>':''}</td>
            <td style="padding:5px 8px;text-align:center;color:#64748b;font-size:11px">${rango}</td>
            <td style="padding:5px 10px;text-align:center;font-weight:700;font-size:14px;color:${fc||'#1e293b'}">${d.valor_registrado??'—'}${d.corregido?' <small style="color:#d97706;font-size:10px">(corr.)</small>':''}</td>
            <td style="padding:5px 8px;text-align:center"><span style="color:${estadoColor(d.estado_param)};font-weight:600;font-size:12px">${estadoBadge(d.estado_param)}</span></td>
            <td style="padding:5px 8px;color:#78716c;font-size:11px">${d.observaciones||''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }).join('');

  // Historial de correcciones
  const corregidos = (t.detalle||[]).filter(d => d.corregido && d.valor_original !== null);
  const historialHtml = corregidos.length === 0 ? '' : `
    <div style="margin-top:14px;border:1px solid #fde68a;border-radius:6px;overflow:hidden">
      <div style="background:#fef3c7;padding:7px 12px;font-size:12px;font-weight:700;color:#92400e">✏️ Historial de correcciones (${corregidos.length})</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#fffbeb">
          <th style="padding:5px 10px;text-align:left;border-bottom:1px solid #fde68a">Parámetro</th>
          <th style="padding:5px 8px;text-align:center;border-bottom:1px solid #fde68a">Valor original</th>
          <th style="padding:5px 8px;text-align:center;border-bottom:1px solid #fde68a">Corregido a</th>
          <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #fde68a">Por</th>
          <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #fde68a">Fecha/hora</th>
        </tr></thead>
        <tbody>${corregidos.map(d => {
          const p = d.param || {};
          const corrAt = d.corrected_at ? new Date(d.corrected_at).toLocaleString('es-MX',{dateStyle:'short',timeStyle:'short'}) : '—';
          return `<tr style="border-bottom:1px solid #fef9c3">
            <td style="padding:5px 10px;font-weight:600">${p.nombre_parametro||'?'} <span style="color:#78716c;font-size:10px">(${p.unidad||''})</span></td>
            <td style="padding:5px 8px;text-align:center;color:#dc2626;font-weight:700">${d.valor_original??'—'}</td>
            <td style="padding:5px 8px;text-align:center;color:#16a34a;font-weight:700">${d.valor_corregido??'—'}</td>
            <td style="padding:5px 8px;color:#78716c">${d.corrected_by||'—'}</td>
            <td style="padding:5px 8px;color:#78716c">${corrAt}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;

  showModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px">
      <div>
        <h3 style="margin:0">🔬 ${t.linea} — Turno ${t.clave_titulacion}</h3>
        <p style="margin:4px 0 0;font-size:12px;color:#78716c">${t.fecha} · Analista: ${t.analista||'-'}</p>
      </div>
      <span style="font-size:13px;font-weight:700;color:${estadoColor2}">${estadoTxt}</span>
    </div>
    <div style="max-height:65vh;overflow-y:auto;padding-right:4px">${html}${historialHtml}</div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="editTitulacion(${t.id},'${t.linea}',${t.turno},${t.numero_titulacion},'${t.fecha}')">✏️ Editar</button>
      <button class="btn btn-outline" onclick="generarReporteTitulacion(${t.id})">📄 Reporte</button>
      <button class="btn btn-primary" onclick="closeModal()">Cerrar</button>
    </div>`);
};

window.editTitulacion = function(id, linea, turno, num, fecha) {
  navigate('titulaciones');
  setTimeout(() => {
    document.getElementById('tit-linea').value = linea;
    document.getElementById('tit-fecha').value = fecha;
    document.getElementById('tit-turno').value = String(turno);
    document.getElementById('tit-num').value = String(num);
    document.getElementById('btn-tit-cargar').click();
  }, 200);
};

// ── Estadísticas SPC ──────────────────────────────────────────────────────────
async function viewTitEstadisticas() {
  const lineas = await GET('/lineas').catch(() => []);
  return `
  <div class="filters-bar" style="flex-wrap:wrap">
    <div><label class="flabel">Línea *</label><br>
      <select id="spc-linea"><option value="">-- Seleccionar --</option>${lineas.map(l=>`<option>${l}</option>`).join('')}</select>
    </div>
    <div><label class="flabel">Tanque</label><br>
      <select id="spc-tanque" style="min-width:200px"><option value="">-- Seleccionar línea --</option></select>
    </div>
    <div><label class="flabel">Parámetro</label><br>
      <select id="spc-param" style="min-width:160px"><option value="">-- Seleccionar tanque --</option></select>
    </div>
    <div><label class="flabel">Vista</label><br>
      <select id="spc-vista"><option value="diaria">Diaria</option><option value="semanal">Semanal</option><option value="mensual">Mensual (SPC)</option></select>
    </div>
    <div><label class="flabel">Desde</label><br><input type="date" id="spc-ini" value="${monthStart()}" /></div>
    <div><label class="flabel">Hasta</label><br><input type="date" id="spc-fin" value="${today()}" /></div>
    <div style="align-self:flex-end"><button class="btn btn-primary" id="btn-spc-buscar">Graficar</button></div>
  </div>
  <div id="spc-result"></div>`;
}

function bindTitEstadisticas() {
  document.getElementById('spc-linea').addEventListener('change', async function() {
    const linea = this.value;
    const selT = document.getElementById('spc-tanque');
    selT.innerHTML = '<option value="">-- Seleccionar --</option>';
    document.getElementById('spc-param').innerHTML = '<option value="">-- Seleccionar tanque --</option>';
    if (!linea) return;
    const [tanques, params] = await Promise.all([
      GET('/tanques?linea=' + encodeURIComponent(linea)),
      GET('/parametros-titulacion?activo=true')
    ]);
    const tkConParams = tanques.filter(t => params.some(p => p.tanque_id === t.id));
    tkConParams.forEach(t => selT.add(new Option(`${t.no_tanque} — ${t.nombre_tanque}`, JSON.stringify(t))));
  });

  document.getElementById('spc-tanque').addEventListener('change', async function() {
    const selP = document.getElementById('spc-param');
    selP.innerHTML = '<option value="">-- Seleccionar --</option>';
    if (!this.value) return;
    const tanque = JSON.parse(this.value);
    const params = await GET('/parametros-titulacion?activo=true&tanque_id=' + tanque.id);
    params.forEach(p => selP.add(new Option(`${p.nombre_parametro} (${p.unidad||'sin ud.'})`, JSON.stringify(p))));
  });

  document.getElementById('btn-spc-buscar').addEventListener('click', async () => {
    const paramVal = document.getElementById('spc-param').value;
    if (!paramVal) { alert('Selecciona línea, tanque y parámetro'); return; }
    const param = JSON.parse(paramVal);
    const ini   = document.getElementById('spc-ini').value;
    const fin   = document.getElementById('spc-fin').value;
    const vista = document.getElementById('spc-vista').value;
    const el    = document.getElementById('spc-result');
    el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div></div>';
    try {
      const data = await GET(`/titulaciones/estadisticas/valores?parametro_id=${param.id}&fecha_ini=${ini}&fecha_fin=${fin}`);
      if (!data.valores?.length) { el.innerHTML = '<div class="empty-state"><div class="icon">📈</div><p>Sin datos en el período</p></div>'; return; }
      renderSPCCharts(el, data, vista);
    } catch(e) { el.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`; }
  });
}

function renderSPCCharts(el, data, vista) {
  const { param, valores } = data;
  const vals = valores.map(v => v.valor);
  const labels = valores.map(v => `${v.fecha} T${v.turno}.${v.clave?.split('.')[1]||''}`);
  const lsl = param.valor_min, usl = param.valor_max, obj = param.objetivo;
  const stats = spcStats(vals);
  const { cp, cpk } = spcCpCpk(stats.mean, stats.sigma, lsl, usl);

  const ucl = stats.mean + 3 * stats.sigma;
  const lcl = stats.mean - 3 * stats.sigma;

  // Agrupar por período si semanal/mensual
  let groupedLabels = labels, groupedVals = vals;
  if (vista === 'semanal' || vista === 'mensual') {
    const grupos = {};
    valores.forEach(v => {
      const key = vista === 'semanal' ? v.fecha?.slice(0,7) + '-S' + Math.ceil(new Date(v.fecha).getDate()/7) : v.fecha?.slice(0,7);
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(v.valor);
    });
    groupedLabels = Object.keys(grupos);
    groupedVals = groupedLabels.map(k => { const vs = grupos[k]; return vs.reduce((s,v)=>s+v,0)/vs.length; });
  }

  const canvasId1 = 'spc-chart-main', canvasId2 = 'spc-chart-mr';
  const canvasId3 = 'spc-chart-hist', canvasId4 = 'spc-chart-np';

  const statsHtml = `
  <div class="stat-grid" style="margin-bottom:16px">
    <div class="stat-card"><div class="stat-icon" style="background:#dbeafe">μ</div>
      <div><div class="stat-value">${stats.mean.toFixed(3)}</div><div class="stat-label">Media</div></div></div>
    <div class="stat-card"><div class="stat-icon" style="background:#f3e8ff">σ</div>
      <div><div class="stat-value">${stats.sigma.toFixed(3)}</div><div class="stat-label">Desv. Estándar</div></div></div>
    <div class="stat-card"><div class="stat-icon" style="background:#dcfce7">n</div>
      <div><div class="stat-value">${stats.n}</div><div class="stat-label">Observaciones</div></div></div>
    ${cp!=null?`<div class="stat-card"><div class="stat-icon" style="background:${cp>=1.33?'#dcfce7':cp>=1?'#fef3c7':'#fee2e2'}">Cp</div>
      <div><div class="stat-value">${cp.toFixed(3)}</div><div class="stat-label">Índice Cp${cp<1?' 🔴':cp<1.33?' ⚠️':' ✅'}</div></div></div>`:''}
    ${cpk!=null?`<div class="stat-card"><div class="stat-icon" style="background:${cpk>=1.33?'#dcfce7':cpk>=1?'#fef3c7':'#fee2e2'}">Cpk</div>
      <div><div class="stat-value">${cpk.toFixed(3)}</div><div class="stat-label">Índice Cpk${cpk<1?' 🔴':cpk<1.33?' ⚠️':' ✅'}</div></div></div>`:''}
  </div>
  ${cp!=null?`<div class="alert alert-info" style="margin-bottom:16px;font-size:13px">
    <strong>Interpretación:</strong> ${cpk>=1.67?'Proceso altamente capaz (Cpk≥1.67)':cpk>=1.33?'Proceso capaz (Cpk≥1.33)':cpk>=1?'Proceso marginalmente capaz (1≤Cpk<1.33)':'⚠️ Proceso no capaz (Cpk<1) — requiere mejora'}
  </div>`:''}`;

  el.innerHTML = statsHtml + `
  <div class="table-card" style="margin-bottom:16px">
    <div class="table-header"><h3>📈 ${param.nombre_parametro} · ${param.no_tanque} (${param.nombre_tanque})</h3></div>
    <div style="padding:16px;height:300px;position:relative"><canvas id="${canvasId1}"></canvas></div>
  </div>
  ${vista === 'mensual' ? `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div class="table-card">
      <div class="table-header"><h3>📊 Rangos Móviles</h3></div>
      <div style="padding:16px;height:240px;position:relative"><canvas id="${canvasId2}"></canvas></div>
    </div>
    <div class="table-card">
      <div class="table-header"><h3>📊 Histograma de Capacidad</h3></div>
      <div style="padding:16px;height:240px;position:relative"><canvas id="${canvasId3}"></canvas></div>
    </div>
  </div>
  <div class="table-card" style="margin-bottom:16px">
    <div class="table-header"><h3>📉 Gráfica de Probabilidad Normal</h3></div>
    <div style="padding:16px;height:280px;position:relative"><canvas id="${canvasId4}"></canvas></div>
  </div>` : ''}`;

  // Gráfica principal
  setTimeout(() => {
    const colors = (vista === 'mensual' ? groupedVals : vals).map(v => {
      if (usl != null && v > usl) return '#ef4444';
      if (lsl != null && v < lsl) return '#ef4444';
      return '#3b82f6';
    });
    new Chart(document.getElementById(canvasId1), {
      type: 'line',
      data: {
        labels: vista === 'mensual' ? groupedLabels : labels,
        datasets: [
          { label: param.nombre_parametro, data: vista==='mensual'?groupedVals:vals, borderColor: '#3b82f6', backgroundColor: colors.map(c=>c+'33'), pointBackgroundColor: colors, tension: 0.3, fill: false },
          ...(usl!=null?[{ label:`LSC (${usl})`, data: Array(labels.length).fill(usl), borderColor:'#ef4444', borderDash:[5,5], pointRadius:0, tension:0 }]:[]),
          ...(lsl!=null?[{ label:`LIC (${lsl})`, data: Array(labels.length).fill(lsl), borderColor:'#ef4444', borderDash:[5,5], pointRadius:0, tension:0 }]:[]),
          ...(obj!=null?[{ label:`Objetivo (${obj})`, data: Array(labels.length).fill(obj), borderColor:'#16a34a', borderDash:[4,4], pointRadius:0, tension:0 }]:[]),
          ...(vista==='mensual'?[
            { label:`UCL (${ucl.toFixed(2)})`, data: Array(labels.length).fill(ucl), borderColor:'#f59e0b', borderDash:[3,3], pointRadius:0 },
            { label:`LCL (${lcl.toFixed(2)})`, data: Array(labels.length).fill(lcl), borderColor:'#f59e0b', borderDash:[3,3], pointRadius:0 }
          ]:[])
        ]
      },
      options: { animation: false, responsive:true, maintainAspectRatio: false, plugins:{ legend:{ position:'top' } }, scales:{ y:{ title:{ display:true, text:`${param.nombre_parametro} (${param.unidad||''})` } } } }
    });

    if (vista === 'mensual') {
      // Rangos móviles
      const mrl = stats.rangos;
      const mrcl = stats.mrBar * 3.267;
      new Chart(document.getElementById(canvasId2), {
        type:'bar',
        data:{ labels: labels.slice(1), datasets:[
          { label:'Rango Móvil', data:mrl, backgroundColor:'#a78bfa' },
          { label:`UCL_MR (${mrcl.toFixed(2)})`, data:Array(mrl.length).fill(mrcl), type:'line', borderColor:'#ef4444', borderDash:[4,4], pointRadius:0 }
        ]},
        options:{ animation: false, responsive:true, maintainAspectRatio: false, plugins:{ legend:{ position:'top' } } }
      });

      // Histograma
      const sorted = [...vals].sort((a,b)=>a-b);
      const bins = 8;
      const minV = sorted[0], maxV = sorted[sorted.length-1];
      const step = (maxV - minV) / bins || 1;
      const buckets = Array.from({length:bins}, (_,i) => ({ label: (minV+i*step).toFixed(2), count: 0 }));
      vals.forEach(v => {
        const idx = Math.min(Math.floor((v-minV)/step), bins-1);
        if (buckets[idx]) buckets[idx].count++;
      });
      new Chart(document.getElementById(canvasId3), {
        type:'bar',
        data:{ labels: buckets.map(b=>b.label), datasets:[
          { label:'Frecuencia', data: buckets.map(b=>b.count), backgroundColor:'#60a5fa' },
          ...(lsl!=null?[{ label:`LSL (${lsl})`, data:Array(bins).fill(0), type:'line', borderColor:'#ef4444', borderDash:[4,4], pointRadius:0 }]:[]),
          ...(usl!=null?[{ label:`USL (${usl})`, data:Array(bins).fill(0), type:'line', borderColor:'#ef4444', borderDash:[4,4], pointRadius:0 }]:[])
        ]},
        options:{ animation: false, responsive:true, maintainAspectRatio: false, plugins:{ legend:{ position:'top' } }, scales:{ y:{ title:{ display:true, text:'Frecuencia' } } } }
      });

      // Normal probability plot
      const n = sorted.length;
      const npLabels = sorted.map((v,i) => {
        const p = (i+0.5)/n;
        const z = Math.sqrt(2) * erfinvApprox(2*p-1);
        return { x: z, y: v };
      });
      new Chart(document.getElementById(canvasId4), {
        type:'scatter',
        data:{ datasets:[{ label:'Datos', data: npLabels, backgroundColor:'#3b82f6' }]},
        options:{ animation: false, responsive:true, maintainAspectRatio: false, plugins:{ legend:{ position:'top' } }, scales:{ x:{ title:{ display:true, text:'Cuantil Normal (z)' } }, y:{ title:{ display:true, text:param.nombre_parametro } } } }
      });
    }
  }, 0);
}

function erfinvApprox(x) {
  // Aproximación Beasley-Springer-Moro
  const a = [0, 2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
  const b = [0, -8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833];
  const c = [0.3374754822726147, 0.9761690190917186, 0.1607979714918209, 0.0276438810333863, 0.0038405729373609, 0.0003951896511349, 0.0000321767881768, 0.0000002888167364, 0.0000003960315187];
  const p = (x < 0 ? 1 : 0) + Math.abs(x) * 0.5;
  if (p < 0.02425) {
    const q = Math.sqrt(-2*Math.log(p));
    return (((((((c[8]*q+c[7])*q+c[6])*q+c[5])*q+c[4])*q+c[3])*q+c[2])*q+c[1]) / ((((((((1)*q+0)*q+0)*q+0)*q+0)*q+0)*q+0)*q+1) * (x<0?-1:1);
  }
  const q = p - 0.5, r = q*q;
  return (((((a[4]*r+a[3])*r+a[2])*r+a[1])*r+1)*q) / ((((b[4]*r+b[3])*r+b[2])*r+b[1])*r+1) * (x<0?-1:1);
}

// ── Lectura de Excel y carga directa ─────────────────────────────────────────
const TIT_EXACT_COLS = {
  'LINEA 1': [
    { no: 'T2: ADEHESIVO 1753',      nom: '% Sólidos',    qui: null,   col: 3  },
    { no: 'T18: SELLO',              nom: 'Concentración', qui: null,   col: 4  },
    { no: 'T18: SELLO',              nom: 'pH',            qui: null,   col: 5  },
    { no: 'T18: SELLO',              nom: 'PPMs',          qui: null,   col: 6  },
    { no: 'T8: DESENGRASE 1',        nom: 'AT',            qui: null,   col: 10 },
    { no: 'T8: DESENGRASE 1',        nom: 'Temperatura',   qui: null,   col: 13 },
    { no: 'T9: DESENGRASE 2',        nom: 'AT',            qui: null,   col: 14 },
    { no: 'T9: DESENGRASE 2',        nom: 'Temperatura',   qui: null,   col: 15 },
    { no: 'T12: PICLADO',            nom: 'AT',            qui: null,   col: 30 },
    { no: 'T12: PICLADO',            nom: 'Fe',            qui: null,   col: 31 },
    { no: 'T14: FOSFATO MACRO',      nom: 'AT',            qui: null,   col: 39 },
    { no: 'T14: FOSFATO MACRO',      nom: 'AL',            qui: null,   col: 40 },
    { no: 'T14: FOSFATO MACRO',      nom: 'Fe',            qui: null,   col: 41 },
    { no: 'T14: FOSFATO MACRO',      nom: 'Peso Fosfato',  qui: null,   col: 42 },
    { no: 'T14: FOSFATO MACRO',      nom: 'RA',            qui: null,   col: 43 },
    { no: 'T15: FOSFATO MICRO',      nom: 'AT',            qui: null,   col: 48 },
    { no: 'T15: FOSFATO MICRO',      nom: 'AL',            qui: null,   col: 49 },
    { no: 'T15: FOSFATO MICRO',      nom: 'Fe',            qui: null,   col: 50 },
    { no: 'T15: FOSFATO MICRO',      nom: 'CA',            qui: null,   col: 51 },
    { no: 'T15: FOSFATO MICRO',      nom: 'Peso Fosfato',  qui: null,   col: 52 },
    { no: 'T15: FOSFATO MICRO',      nom: 'RA',            qui: null,   col: 53 },
  ],
  'LINEA 3': [
    { no: 'T3: SELLO',               nom: 'Concentración', qui: null,   col: 6  },
    { no: 'T3: SELLO',               nom: 'pH',            qui: null,   col: 7  },
    { no: 'T3: SELLO',               nom: 'PPMs',          qui: null,   col: 8  },
    { no: 'T6: DESENGRASE 1',        nom: 'AL',            qui: '907',  col: 11 },
    { no: 'T6: DESENGRASE 1',        nom: 'pH',            qui: '907',  col: 12 },
    { no: 'T6: DESENGRASE 1',        nom: 'Temperatura',   qui: '907',  col: 13 },
    { no: 'T6: DESENGRASE 1',        nom: 'AL',            qui: '1207', col: 11 },
    { no: 'T6: DESENGRASE 1',        nom: 'Temperatura',   qui: '1207', col: 13 },
    { no: 'T7: DESENGRASE 2',        nom: 'AL',            qui: '907',  col: 15 },
    { no: 'T7: DESENGRASE 2',        nom: 'pH',            qui: '907',  col: 16 },
    { no: 'T7: DESENGRASE 2',        nom: 'Temperatura',   qui: '907',  col: 18 },
    { no: 'T7: DESENGRASE 2',        nom: 'AL',            qui: '1207', col: 15 },
    { no: 'T7: DESENGRASE 2',        nom: 'Temperatura',   qui: '1207', col: 18 },
    { no: 'T8: DESENGRASE 3',        nom: 'AT',            qui: '907',  col: 19 },
    { no: 'T8: DESENGRASE 3',        nom: 'pH',            qui: '907',  col: 20 },
    { no: 'T8: DESENGRASE 3',        nom: 'Temperatura',   qui: '907',  col: 22 },
    { no: 'T11: PICLADO',            nom: 'AT',            qui: null,   col: 27 },
    { no: 'T11: PICLADO',            nom: 'Fe',            qui: null,   col: 28 },
    { no: 'T14: MICRO 1',            nom: 'AT',            qui: null,   col: 33 },
    { no: 'T14: MICRO 1',            nom: 'AL',            qui: null,   col: 34 },
    { no: 'T14: MICRO 1',            nom: 'RA',            qui: null,   col: 35 },
    { no: 'T14: MICRO 1',            nom: 'Fe',            qui: null,   col: 36 },
    { no: 'T14: MICRO 1',            nom: 'Peso Fosfato',  qui: null,   col: 37 },
    { no: 'T14: MICRO 1',            nom: 'Temperatura',   qui: null,   col: 39 },
    { no: 'T16: MICRO 2',            nom: 'AT',            qui: null,   col: 42 },
    { no: 'T16: MICRO 2',            nom: 'AL',            qui: null,   col: 43 },
    { no: 'T16: MICRO 2',            nom: 'RA',            qui: null,   col: 44 },
    { no: 'T16: MICRO 2',            nom: 'Fe',            qui: null,   col: 45 },
    { no: 'T16: MICRO 2',            nom: 'Peso Fosfato',  qui: null,   col: 46 },
    { no: 'T16: MICRO 2',            nom: 'Temperatura',   qui: null,   col: 48 },
  ],
  'LINEA 4': [
    { no: 'T2: SELLO',               nom: 'Concentración', qui: null,   col: 3  },
    { no: 'T2: SELLO',               nom: 'pH',            qui: null,   col: 4  },
    { no: 'T2: SELLO',               nom: 'PPMs',          qui: null,   col: 5  },
    { no: 'T4: DESENGRASE 1',        nom: 'AT',            qui: null,   col: 9  },
    { no: 'T4: DESENGRASE 1',        nom: 'Temperatura',   qui: null,   col: 12 },
    { no: 'T5: DESENGRASE 2',        nom: 'AL',            qui: null,   col: 13 },
    { no: 'T5: DESENGRASE 2',        nom: 'Temperatura',   qui: null,   col: 17 },
    { no: 'T7: PICLADO',             nom: 'AT',            qui: null,   col: 21 },
    { no: 'T7: PICLADO',             nom: 'Fe',            qui: null,   col: 22 },
    { no: 'T9: SALES',               nom: 'pH',            qui: null,   col: 26 },
    { no: 'T9: SALES',               nom: 'PPMs',          qui: null,   col: 27 },
    { no: 'T10: FOSFATO MANGANESO',  nom: 'AT',            qui: null,   col: 28 },
    { no: 'T10: FOSFATO MANGANESO',  nom: 'AL',            qui: null,   col: 29 },
    { no: 'T10: FOSFATO MANGANESO',  nom: 'Fe',            qui: null,   col: 30 },
    { no: 'T10: FOSFATO MANGANESO',  nom: 'Peso Fosfato',  qui: null,   col: 31 },
    { no: 'T10: FOSFATO MANGANESO',  nom: 'RA',            qui: null,   col: 32 },
    { no: 'T10: FOSFATO MANGANESO',  nom: 'Temperatura',   qui: null,   col: 33 },
  ],
  'BAKER': [
    { no: 'T02: ADH 1753',           nom: '% Sólidos',    qui: null,   col: 3  },
    { no: 'T04: SELLO',              nom: 'Concentración', qui: null,   col: 4  },
    { no: 'T04: SELLO',              nom: 'pH',            qui: null,   col: 5  },
    { no: 'T04: SELLO',              nom: 'PPMs',          qui: null,   col: 6  },
    { no: 'T07: D1',                 nom: 'AT',            qui: '1207', col: 10 },
    { no: 'T08: STRP',               nom: 'AL',            qui: null,   col: 14 },
    { no: 'T08: STRP',               nom: 'Temperatura',   qui: null,   col: 15 },
    { no: 'T10: D2',                 nom: 'AT',            qui: '1207', col: 20 },
    { no: 'T13: PICLADO',            nom: 'AT',            qui: null,   col: 30 },
    { no: 'T13: PICLADO',            nom: 'Fe',            qui: null,   col: 31 },
    { no: 'T16: MACRO',              nom: 'AT',            qui: null,   col: 39 },
    { no: 'T16: MACRO',              nom: 'AL',            qui: null,   col: 40 },
    { no: 'T16: MACRO',              nom: 'Fe',            qui: null,   col: 41 },
    { no: 'T16: MACRO',              nom: 'Peso Fosfato',  qui: null,   col: 42 },
    { no: 'T16: MACRO',              nom: 'RA',            qui: null,   col: 43 },
    { no: 'T16: MACRO',              nom: 'Temperatura',   qui: null,   col: 44 },
    { no: 'T18: MICRO',              nom: 'AT',            qui: null,   col: 48 },
    { no: 'T18: MICRO',              nom: 'AL',            qui: null,   col: 49 },
    { no: 'T18: MICRO',              nom: 'Fe',            qui: null,   col: 50 },
    { no: 'T18: MICRO',              nom: 'CA',            qui: null,   col: 51 },
    { no: 'T18: MICRO',              nom: 'Peso Fosfato',  qui: null,   col: 52 },
    { no: 'T18: MICRO',              nom: 'RA',            qui: null,   col: 53 },
    { no: 'T18: MICRO',              nom: 'Temperatura',   qui: null,   col: 54 },
  ]
};

const TIT_HOJAS = [
  { linea: 'LINEA 1', hoja: 'Titulacion linea 1', skipRows: 3 },
  { linea: 'LINEA 3', hoja: 'Titulación L3',       skipRows: 1 },
  { linea: 'LINEA 4', hoja: 'Titulación L4',       skipRows: 1 },
  { linea: 'BAKER',   hoja: 'Titulacion Baker',    skipRows: 1 },
];

async function readExcelTitulaciones(file, params) {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });

  // Lookup param por (no_tanque, nombre_param, quimico) → param
  const paramLookup = {};
  params.forEach(p => {
    const no = p.no_tanque || p.nombre_tanque || '';
    paramLookup[`${no}||${p.nombre_parametro}||${p.quimico||''}`] = p;
  });

  // paramColMap por línea: param.id → colIndex
  const getParamColMap = (linea) => {
    const map = {};
    (TIT_EXACT_COLS[linea] || []).forEach(e => {
      const p = paramLookup[`${e.no}||${e.nom}||${e.qui||''}`];
      if (p) map[p.id] = e.col;
    });
    return map;
  };

  const excelDateToISO = (v) => {
    if (!v) return null;
    if (typeof v === 'number') {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  };

  const SERIAL_2026 = 46023;
  // Formato compacto: rows = [{l, f, t, n, a, v: {pid: valor}}]
  // Solo se incluyen valores no-nulos para mantener el payload pequeño (~300KB)
  const rows = [];
  const previewHeaders = [];
  const warnings = [];

  TIT_HOJAS.forEach(({ linea, hoja, skipRows }) => {
    const ws = wb.Sheets[hoja];
    if (!ws) { warnings.push(`Hoja no encontrada: "${hoja}"`); return; }

    if (ws['!ref']) {
      const m = ws['!ref'].match(/^([A-Z]+\d+):([A-Z]+)(\d+)$/);
      if (m) {
        const colN = m[2].split('').reduce((n,c) => n*26+c.charCodeAt(0)-64, 0);
        if (colN > 70) {
          const lim = (n=>{let s='';while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-(n%26||26))/26);}return s;})(70);
          ws['!ref'] = `${m[1]}:${lim}${m[3]}`;
        }
      }
    }

    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const sheetRows = data.slice(skipRows).filter(r => {
      if (!r[0]) return false;
      if (typeof r[0] === 'number') return r[0] >= SERIAL_2026;
      return String(r[0]).startsWith('2026');
    });

    const paramColMap = getParamColMap(linea);
    const lineaParams = params.filter(p => {
      const no = p.no_tanque || p.nombre_tanque || '';
      return (TIT_EXACT_COLS[linea] || []).some(e => e.no === no);
    });

    if (!lineaParams.length) { warnings.push(`Sin parámetros en DB para ${linea}`); return; }

    sheetRows.forEach(row => {
      const fecha = excelDateToISO(row[0]);
      if (!fecha) return;
      const parts = String(row[1]||'').trim().split('.');
      const turno = parseInt(parts[0]), numTit = parseInt(parts[1]);
      if (isNaN(turno)||isNaN(numTit)||turno<1||turno>3||numTit<1||numTit>2) return;

      const analista = row[2] && typeof row[2]==='string' ? row[2].trim() : '';
      const vals = {};
      let hayValor = false;
      lineaParams.forEach(param => {
        if (param.frecuencia === 1 && numTit !== 1) return;
        const col = paramColMap[param.id];
        if (col != null && row[col] != null) {
          const v = parseFloat(row[col]);
          if (!isNaN(v)) { vals[param.id] = v; hayValor = true; }
        }
      });

      if (hayValor) {
        rows.push({ l: linea, f: fecha, t: turno, n: numTit, a: analista, v: vals });
        previewHeaders.push({ linea, fecha });
      }
    });
  });

  return { rows, previewHeaders, warnings };
}

// ── Catálogo Parámetros (admin) ───────────────────────────────────────────────
async function viewTitCatalogo() {
  const [tanques, params, items] = await Promise.all([
    GET('/tanques').catch(()=>[]),
    GET('/parametros-titulacion').catch(()=>[]),
    GET('/items?vigente=true').catch(()=>[])
  ]);
  const lineas = [...new Set(tanques.map(t=>t.linea))].filter(Boolean).sort();
  window._catalogData = { tanques, params, items };
  return `
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
    <button class="btn btn-primary" id="btn-param-nuevo">+ Parámetro</button>
    <button class="btn btn-outline" id="btn-tanque-nuevo">🏭 + Tanque</button>
    <button class="btn btn-outline" id="btn-param-export">⬇️ Exportar</button>
    <button class="btn btn-outline" id="btn-param-seed" style="color:#78716c">🔄 Seed inicial</button>
    <button class="btn btn-outline" id="btn-import-historial" style="background:#fffbeb;border-color:#f59e0b;color:#92400e">📥 Importar historial 2026</button>
    <button class="btn btn-outline" id="btn-excel-upload" style="background:#f0fdf4;border-color:#86efac;color:#15803d">📤 Cargar Excel</button>
    <input type="file" id="excel-file-input" accept=".xlsx,.xls" style="display:none" />
    <div style="align-self:center;margin-left:auto">
      <label class="flabel">Filtrar línea:</label>
      <select id="pc-filtro-linea" style="margin-left:8px">
        <option value="">Todas</option>${lineas.map(l=>`<option>${l}</option>`).join('')}
      </select>
    </div>
  </div>
  <div id="pc-table-area">
    ${renderParamCatalog(params, tanques, '')}
  </div>`;
}

function getParamLinea(p, tanques) {
  if (p.linea) return p.linea;
  return tanques.find(x => x.id === p.tanque_id)?.linea || '?';
}

function renderParamCatalog(params, tanques, filtroLinea) {
  const filtered = filtroLinea ? params.filter(p => getParamLinea(p, tanques) === filtroLinea) : params;
  if (!filtered.length) return '<div class="empty-state"><div class="icon">⚙️</div><p>Sin parámetros. Usa "Seed inicial" para cargar los predeterminados.</p></div>';

  const lineas = [...new Set(filtered.map(p => getParamLinea(p, tanques)))].sort();
  const CELL = 'padding:3px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0;cursor:pointer;border-bottom:1px solid #f1f5f9';
  const TH   = 'padding:4px 6px;font-size:11px;font-weight:600;color:#64748b;text-align:left;white-space:nowrap;border-bottom:1px solid #e2e8f0';
  const INP  = 'width:100%;box-sizing:border-box;font-size:11px;border:1px solid #3b82f6;border-radius:2px;padding:1px 3px;background:#eff6ff;outline:none';
  const _nrItems = window._catalogData?.items || [];
  const quimicoNRopts = '<option value="">— Sin químico —</option>' + _nrItems.map(it => `<option value="${esc(it.item)}">${esc(it.item)}${it.presentacion?' — '+esc(it.presentacion):''}</option>`).join('');

  return lineas.map(linea => {
    const lineaTanques = tanques.filter(t => t.linea === linea).sort((a,b) => String(a.no_tanque).localeCompare(String(b.no_tanque)));
    const pLinea = filtered.filter(p => getParamLinea(p, tanques) === linea);
    const totalActivos = pLinea.filter(p => p.activo !== false).length;

    const tbodyRows = lineaTanques.map(t => {
      const pTanque = pLinea.filter(p => p.tanque_id === t.id).sort((a,b) => (a.orden||0)-(b.orden||0));
      const enjLabel = t.es_enjuague ? `<span style="background:#e0f2fe;color:#0369a1;padding:0 5px;border-radius:8px;font-size:10px;margin-left:4px">Enjuague</span>` : '';
      const quimLabel = t.quimico_activo ? `<span style="background:#dbeafe;color:#1e40af;padding:0 5px;border-radius:8px;font-size:10px;margin-left:4px">${esc(t.quimico_activo)}</span>` : '';

      const tankHdr = `<tr style="background:${t.es_enjuague?'#f0f9ff':'#f8fafc'}">
        <td colspan="10" style="padding:4px 8px;border-top:2px solid ${t.es_enjuague?'#bae6fd':'#d1d5db'};border-bottom:1px solid #e2e8f0">
          <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
            <span style="font-size:12px;font-weight:700;color:#1e293b">🪣 ${esc(t.no_tanque)} — ${esc(t.nombre_tanque)}</span>
            ${quimLabel}${enjLabel}
            <span style="font-size:10px;color:#9ca3af;margin-left:2px">${pTanque.length} param.</span>
            <div style="margin-left:auto;display:flex;gap:3px;align-items:center">
              <button class="btn btn-outline btn-xs btn-toggle-enjuague" data-tid="${t.id}" data-enjuague="${t.es_enjuague?'1':'0'}" style="font-size:10px;padding:1px 5px">${t.es_enjuague?'→Proceso':'→Enjuague'}</button>
              <button class="btn btn-outline btn-xs btn-edit-tanque" data-tid="${t.id}" style="font-size:10px;padding:1px 5px">✏️</button>
              <button class="btn btn-outline btn-xs btn-del-tanque" data-tid="${t.id}" style="font-size:10px;padding:1px 5px;color:#dc2626;border-color:#fca5a5">🗑️</button>
              <button class="btn btn-primary btn-xs btn-add-param-tanque" data-tanque-id="${t.id}" style="font-size:10px;padding:2px 8px">+ Param</button>
            </div>
          </div>
        </td>
      </tr>`;

      const paramRows = pTanque.length === 0
        ? `<tr><td colspan="10" style="text-align:center;color:#9ca3af;font-size:11px;padding:5px;border-bottom:1px solid #f1f5f9">Sin parámetros — usa "+ Param" para agregar</td></tr>`
        : pTanque.map(p => {
            const actBg  = p.activo!==false ? '#dcfce7' : '#f3f4f6';
            const actCol = p.activo!==false ? '#16a34a' : '#9ca3af';
            return `<tr data-pid="${p.id}" style="opacity:${p.activo!==false?1:0.5};font-size:12px">
              <td class="ec" data-field="nombre_parametro" data-val="${esc(p.nombre_parametro)}" data-pid="${p.id}" style="${CELL};font-weight:600;color:#1e293b" title="${esc(p.nombre_parametro)}">${esc(p.nombre_parametro)}</td>
              <td class="ec" data-field="quimico" data-val="${esc(p.quimico||'')}" data-pid="${p.id}" style="${CELL}" title="${esc(p.quimico||'')}">
                ${p.quimico?`<span style="background:#dbeafe;color:#1e40af;padding:0 4px;border-radius:3px;font-size:11px">${esc(p.quimico)}</span>`:'<span style="color:#d1d5db">—</span>'}
              </td>
              <td class="ec ec-num" data-field="valor_min" data-val="${p.valor_min??''}" data-pid="${p.id}" style="${CELL};text-align:right;color:#374151">${p.valor_min??'<span style="color:#d1d5db">—</span>'}</td>
              <td class="ec ec-num" data-field="valor_max" data-val="${p.valor_max??''}" data-pid="${p.id}" style="${CELL};text-align:right;color:#374151">${p.valor_max??'<span style="color:#d1d5db">—</span>'}</td>
              <td class="ec ec-num" data-field="objetivo" data-val="${p.objetivo??''}" data-pid="${p.id}" style="${CELL};text-align:right;color:#374151">${p.objetivo??'<span style="color:#d1d5db">—</span>'}</td>
              <td class="ec" data-field="unidad" data-val="${esc(p.unidad||'')}" data-pid="${p.id}" style="${CELL};color:#6b7280" title="${esc(p.unidad||'')}">${esc(p.unidad)||'<span style="color:#d1d5db">—</span>'}</td>
              <td class="ec ec-frec" data-field="frecuencia" data-val="${p.frecuencia}" data-pid="${p.id}" style="${CELL};text-align:center;color:#374151">${p.frecuencia}/t</td>
              <td class="ec ec-num" data-field="orden" data-val="${p.orden||0}" data-pid="${p.id}" style="${CELL};text-align:center;color:#374151">${p.orden||0}</td>
              <td style="padding:2px 4px;text-align:center;border-bottom:1px solid #f1f5f9">
                <button class="btn-toggle-activo" data-pid="${p.id}" data-activo="${p.activo!==false?'1':'0'}"
                  style="border:none;cursor:pointer;background:${actBg};color:${actCol};padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600;white-space:nowrap">
                  ${p.activo!==false?'✅':'❌'}
                </button>
              </td>
              <td style="padding:2px 3px;text-align:center;white-space:nowrap;border-bottom:1px solid #f1f5f9">
                <button class="btn btn-outline btn-xs" onclick="openParamChart(${p.id})" title="Ver gráfica" style="padding:1px 5px;font-size:11px">📈</button>
                <button class="btn-del-param btn btn-outline btn-xs" data-pid="${p.id}" title="Quitar parámetro" style="padding:1px 6px;font-size:12px;color:#dc2626;border-color:#fca5a5;font-weight:700">×</button>
              </td>
            </tr>`;
          }).join('');

      const newRow = `<tr class="new-param-row" data-tid="${t.id}" style="display:none;background:#eff6ff">
        <td style="padding:2px 3px"><input class="np-nombre" placeholder="Nombre *" style="${INP}" /></td>
        <td style="padding:2px 3px"><select class="np-quimico" style="${INP};padding:1px 2px">${quimicoNRopts}</select></td>
        <td style="padding:2px 3px"><input class="np-min" type="number" step="any" placeholder="Mín" style="${INP};text-align:right" /></td>
        <td style="padding:2px 3px"><input class="np-max" type="number" step="any" placeholder="Máx" style="${INP};text-align:right" /></td>
        <td style="padding:2px 3px"><input class="np-obj" type="number" step="any" placeholder="Obj" style="${INP};text-align:right" /></td>
        <td style="padding:2px 3px"><input class="np-unidad" placeholder="Unidad" style="${INP}" /></td>
        <td style="padding:2px 3px">
          <select class="np-frec" style="${INP};padding:1px 2px">
            <option value="2">2/t</option><option value="1">1/t</option>
          </select>
        </td>
        <td style="padding:2px 3px"><input class="np-orden" type="number" min="0" placeholder="0" value="0" style="${INP};text-align:right" /></td>
        <td style="padding:2px 3px;text-align:center">
          <button class="np-save btn btn-primary btn-xs" data-tid="${t.id}" style="font-size:10px;padding:1px 8px" title="Guardar">✓</button>
        </td>
        <td style="padding:2px 3px;text-align:center">
          <button class="np-cancel btn btn-outline btn-xs" style="font-size:10px;padding:1px 8px" title="Cancelar (Esc)">✕</button>
        </td>
      </tr>`;

      return tankHdr + paramRows + newRow;
    }).join('');

    return `
    <div class="table-card" style="margin-bottom:12px">
      <div class="table-header" style="background:#1e3a5f;display:flex;align-items:center;justify-content:space-between;padding:8px 14px">
        <h3 style="color:#fff;margin:0;font-size:14px">${esc(linea)}</h3>
        <span style="font-size:12px;color:#93c5fd">${totalActivos} activo(s) / ${pLinea.length} total</span>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;table-layout:fixed">
          <colgroup>
            <col style="width:150px">
            <col style="width:88px">
            <col style="width:50px">
            <col style="width:50px">
            <col style="width:50px">
            <col style="width:63px">
            <col style="width:44px">
            <col style="width:38px">
            <col style="width:52px">
            <col style="width:60px">
          </colgroup>
          <thead><tr style="background:#f1f5f9">
            <th style="${TH}">Parámetro</th>
            <th style="${TH}">Químico</th>
            <th style="${TH};text-align:right">Mín</th>
            <th style="${TH};text-align:right">Máx</th>
            <th style="${TH};text-align:right">Obj</th>
            <th style="${TH}">Unidad</th>
            <th style="${TH};text-align:center">Freq</th>
            <th style="${TH};text-align:center">Orden</th>
            <th style="${TH};text-align:center">Estado</th>
            <th style="${TH}"></th>
          </tr></thead>
          <tbody>${tbodyRows || '<tr><td colspan="10" style="text-align:center;color:#9ca3af;font-size:12px;padding:10px">Sin tanques configurados para esta línea.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

// Alias para compatibilidad con filtro
function renderParamTable(params, tanques, filtroLinea) {
  return renderParamCatalog(params, tanques, filtroLinea);
}

window.openParamChart = async function(paramId) {
  const params = await GET('/parametros-titulacion').catch(()=>[]);
  const param = params.find(p => p.id === paramId);
  if (!param) { alert('Parámetro no encontrado'); return; }

  // Mostrar modal con loading
  showModal(`
    <h3>📈 ${param.nombre_parametro} — ${param.no_tanque||''}</h3>
    <p style="font-size:12px;color:#78716c">Comportamiento semanal — 2026</p>
    <div id="param-chart-area" style="min-height:340px"><div class="empty-state"><div class="icon">⏳</div></div></div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeModal()">Cerrar</button></div>
  `);

  try {
    const data = await GET('/titulaciones/estadisticas/valores?parametro_id=' + paramId + '&fecha_ini=2026-01-01&fecha_fin=' + today());
    const el = document.getElementById('param-chart-area');
    if (!el) return;
    if (!data.valores?.length) {
      el.innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>Sin datos registrados</p></div>';
      return;
    }
    renderSPCCharts(el, data, 'semanal');
  } catch(e) {
    const el = document.getElementById('param-chart-area');
    if (el) el.innerHTML = `<div class="alert alert-warn">Error: ${e.message}</div>`;
  }
};

function bindTitCatalogo() {
  // ── Exportar catálogo a Excel ──────────────────────────────────────────────
  document.getElementById('btn-param-export').addEventListener('click', () => {
    const { tanques, params } = window._catalogData || {};
    if (!params?.length) { alert('No hay parámetros para exportar'); return; }
    const rows = params.sort((a,b) => {
      const la = getParamLinea(a, tanques), lb = getParamLinea(b, tanques);
      return la.localeCompare(lb) || (a.tanque_id - b.tanque_id) || (a.orden||0) - (b.orden||0);
    }).map(p => {
      const t = tanques.find(x => x.id === p.tanque_id);
      return {
        Línea:           getParamLinea(p, tanques),
        'No. Tanque':    t?.no_tanque || p.no_tanque || '',
        'Nombre Tanque': t?.nombre_tanque || p.nombre_tanque || '',
        Parámetro:       p.nombre_parametro,
        Químico:         p.quimico || '',
        'Tipo Rango':    p.tipo_rango,
        'Valor Mín':     p.valor_min ?? '',
        'Valor Máx':     p.valor_max ?? '',
        Objetivo:        p.objetivo ?? '',
        Unidad:          p.unidad || '',
        'Frecuencia/turno': p.frecuencia,
        Orden:           p.orden || 0,
        Activo:          p.activo !== false ? 'Sí' : 'No'
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [14,12,20,22,10,10,10,10,10,8,16,6,6].map(w=>({wch:w}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Parámetros');
    XLSX.writeFile(wb, `catalogo-parametros-${today()}.xlsx`);
  });

  // ── Toggle activo (delegado sobre toda el área) ────────────────────────────
  document.getElementById('pc-table-area').addEventListener('click', async e => {
    const btn = e.target.closest('.btn-toggle-activo');
    if (!btn) return;
    const pid = Number(btn.dataset.pid);
    const activo = btn.dataset.activo === '1';
    try {
      await PATCH('/parametros-titulacion/' + pid, { activo: !activo });
      // Actualizar UI sin recargar
      btn.dataset.activo = activo ? '0' : '1';
      const nuevoActivo = !activo;
      btn.style.background = nuevoActivo ? '#dcfce7' : '#f3f4f6';
      btn.style.color = nuevoActivo ? '#16a34a' : '#6b7280';
      btn.textContent = nuevoActivo ? '✅ Activo' : '❌ Inactivo';
      const row = btn.closest('tr');
      if (row) { row.style.opacity = nuevoActivo ? '1' : '0.55'; row.style.background = nuevoActivo ? '' : '#fafafa'; }
      // Actualizar cache local
      if (window._catalogData?.params) {
        const p = window._catalogData.params.find(x => x.id === pid);
        if (p) p.activo = nuevoActivo;
      }
    } catch(e) { alert('Error: ' + e.message); }
  });

  // ── Botón + Tanque (barra superior) ────────────────────────────────────────
  document.getElementById('btn-tanque-nuevo').addEventListener('click', async () => {
    const items = await GET('/items?vigente=true').catch(()=>[]);
    showModalTanque(null, items, 'tit-catalogo');
  });

  // ── Acciones sobre tanques (delegado en pc-table-area) ─────────────────────
  document.getElementById('pc-table-area').addEventListener('click', async e => {
    // [+ Param] por tanque → fila inline
    const btnAddParam = e.target.closest('.btn-add-param-tanque');
    if (btnAddParam) {
      const tid = btnAddParam.dataset.tanqueId;
      const row = document.querySelector(`.new-param-row[data-tid="${tid}"]`);
      if (!row) return;
      row.style.display = '';
      const inp = row.querySelector('.np-nombre');
      if (inp) inp.focus();
      return;
    }

    // Toggle enjuague
    const btnEnj = e.target.closest('.btn-toggle-enjuague');
    if (btnEnj) {
      const tid = Number(btnEnj.dataset.tid);
      const esEnj = btnEnj.dataset.enjuague === '1';
      try {
        await PATCH('/tanques/' + tid, { es_enjuague: !esEnj });
        if (window._catalogData?.tanques) {
          const t = window._catalogData.tanques.find(x => x.id === tid);
          if (t) t.es_enjuague = !esEnj;
        }
        // Rerender
        const { tanques, params } = window._catalogData || {};
        const filtro = document.getElementById('pc-filtro-linea')?.value || '';
        document.getElementById('pc-table-area').innerHTML = renderParamCatalog(params, tanques, filtro);
      } catch(err) { alert('Error: ' + err.message); }
      return;
    }

    // Editar tanque
    const btnEditTk = e.target.closest('.btn-edit-tanque');
    if (btnEditTk) {
      const tid = Number(btnEditTk.dataset.tid);
      const { tanques } = window._catalogData || {};
      const tanque = (tanques||[]).find(t => t.id === tid);
      if (!tanque) return;
      const items = await GET('/items?vigente=true').catch(()=>[]);
      showModalTanque(tanque, items, 'tit-catalogo');
      return;
    }

    // Eliminar tanque
    const btnDelTk = e.target.closest('.btn-del-tanque');
    if (btnDelTk) {
      const tid = Number(btnDelTk.dataset.tid);
      const { tanques } = window._catalogData || {};
      const tanque = (tanques||[]).find(t => t.id === tid);
      if (!confirm(`¿Eliminar tanque "${tanque?.no_tanque} — ${tanque?.nombre_tanque}"?\nSolo se puede eliminar si no tiene parámetros activos.`)) return;
      try {
        await fetch(`/api/vales/tanques/${tid}`, { method: 'DELETE', credentials: 'include' }).then(async r => {
          if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Error'); }
          return r.json();
        });
        if (window._catalogData?.tanques) {
          window._catalogData.tanques = window._catalogData.tanques.filter(t => t.id !== tid);
        }
        const { tanques: tks, params } = window._catalogData || {};
        const filtro = document.getElementById('pc-filtro-linea')?.value || '';
        document.getElementById('pc-table-area').innerHTML = renderParamCatalog(params, tks, filtro);
      } catch(err) { alert('Error: ' + err.message); }
      return;
    }
  });

  document.getElementById('btn-param-seed').addEventListener('click', async () => {
    const db = await GET('/parametros-titulacion').catch(()=>[]);
    if (db.length > 0 && !confirm(`Ya existen ${db.length} parámetros. ¿Forzar reset y recargar seed inicial?\nSe perderá el catálogo actual.`)) return;
    try {
      const r = await POST('/parametros-titulacion/seed', { reset: db.length > 0 });
      alert(`✅ Seed cargado: ${r.total} parámetros`);
      navigate('tit-catalogo');
    } catch(e) { alert('Error: ' + e.message); }
  });

  document.getElementById('btn-import-historial').addEventListener('click', async () => {
    if (!confirm('¿Importar el historial de titulaciones 2026 desde el Excel?\n\nSolo se ejecuta si no hay titulaciones registradas.\nEsto puede tardar unos segundos.')) return;
    const btn = document.getElementById('btn-import-historial');
    btn.disabled = true; btn.textContent = '⏳ Importando...';
    try {
      const r = await POST('/admin/import-historial', { force: true });
      if (r.ok) {
        alert(`✅ ${r.mensaje}\n\nParámetros: ${r.parametros}\nTitulaciones: ${r.headers}\nLecturas: ${r.detalles}`);
      } else {
        alert(`ℹ️ ${r.mensaje}`);
      }
    } catch(e) {
      alert('Error: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '📥 Importar historial Excel 2026';
    }
  });

  // ── Cargar desde Excel ──────────────────────────────────────────────────────
  document.getElementById('btn-excel-upload').addEventListener('click', () => {
    document.getElementById('excel-file-input').value = '';
    document.getElementById('excel-file-input').click();
  });

  document.getElementById('excel-file-input').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    const btn = document.getElementById('btn-excel-upload');
    btn.disabled = true; btn.textContent = '⏳ Leyendo Excel...';
    try {
      // Preview rápido en el navegador
      const params = await GET('/parametros-titulacion');
      if (!params.length) {
        alert('Primero carga el catálogo de parámetros (Seed inicial).');
        btn.disabled=false; btn.textContent='📤 Cargar desde Excel'; return;
      }

      const { rows, previewHeaders, warnings } = await readExcelTitulaciones(file, params);

      if (!previewHeaders.length) {
        alert('No se encontraron titulaciones 2026 en el archivo.\nVerifica que sea: 4-CA-102 Rev. 0 Reporte titulaciones.xlsx');
        btn.disabled=false; btn.textContent='📤 Cargar desde Excel'; return;
      }

      const byLinea = {};
      previewHeaders.forEach(h => { byLinea[h.linea] = (byLinea[h.linea]||0)+1; });
      const resumenTxt = Object.entries(byLinea).map(([l,n]) => `• ${l}: ${n} titulaciones`).join('\n');
      const warnTxt = warnings.length ? '\n\n⚠️ ' + warnings.join('\n') : '';
      const payloadKB = Math.round(JSON.stringify(rows).length / 1024);

      const ok = confirm(`✅ Excel leído (${payloadKB} KB de datos):\n\n${resumenTxt}\nTotal: ${previewHeaders.length} titulaciones${warnTxt}\n\n¿Importar a la base de datos?\n(Sobreescribirá el historial existente)`);
      if (!ok) { btn.disabled=false; btn.textContent='📤 Cargar desde Excel'; return; }

      btn.textContent = '⏳ Importando...';
      const r = await POST('/admin/import-excel-compact', { force: true, rows });
      if (r.ok) {
        const lineas = Object.entries(r.resumen||{}).map(([l,n])=>`• ${l}: ${n}`).join('\n');
        alert(`✅ ${r.mensaje}\n\n${lineas}`);
      } else {
        alert(`ℹ️ ${r.mensaje}`);
      }
    } catch(e) {
      alert('Error al importar: ' + e.message);
    } finally {
      btn.disabled=false; btn.textContent='📤 Cargar desde Excel';
    }
  });

  document.getElementById('btn-param-nuevo').addEventListener('click', async () => {
    const [tanques, items] = await Promise.all([GET('/tanques'), GET('/items?vigente=true')]);
    showModalParam(null, tanques, null, items);
  });

  document.getElementById('pc-filtro-linea').addEventListener('change', async function() {
    const [tanques, params] = await Promise.all([GET('/tanques'), GET('/parametros-titulacion')]);
    document.getElementById('pc-table-area').innerHTML = renderParamTable(params, tanques, this.value);
  });

  // ── Edición inline al hacer clic en celda ──────────────────────────────────
  document.getElementById('pc-table-area').addEventListener('click', e => {
    const td = e.target.closest('td.ec');
    if (!td) return;
    if (td.querySelector('input,select')) return; // ya en edición
    const pid   = Number(td.dataset.pid);
    const field = td.dataset.field;
    const origVal = td.dataset.val;

    td.innerHTML = '';
    let input;
    if (field === 'frecuencia') {
      input = document.createElement('select');
      input.innerHTML = '<option value="2">2/t</option><option value="1">1/t</option>';
      input.value = origVal;
    } else if (field === 'quimico') {
      input = document.createElement('select');
      const items = window._catalogData?.items || [];
      input.innerHTML = '<option value="">— Sin químico —</option>'
        + items.map(it => `<option value="${esc(it.item)}" ${origVal === it.item ? 'selected' : ''}>${esc(it.item)}${it.presentacion ? ' — ' + esc(it.presentacion) : ''}</option>`).join('');
      if (!items.length) {
        // fallback: cargar de API si no están en caché
        GET('/items?vigente=true').then(loaded => {
          if (window._catalogData) window._catalogData.items = loaded;
          input.innerHTML = '<option value="">— Sin químico —</option>'
            + loaded.map(it => `<option value="${esc(it.item)}" ${origVal === it.item ? 'selected' : ''}>${esc(it.item)}${it.presentacion ? ' — ' + esc(it.presentacion) : ''}</option>`).join('');
        }).catch(()=>{});
      }
    } else {
      input = document.createElement('input');
      input.type = td.classList.contains('ec-num') ? 'number' : 'text';
      input.step = 'any';
      input.value = origVal;
      if (td.classList.contains('ec-num')) input.style.textAlign = 'right';
    }
    input.style.cssText = 'width:100%;box-sizing:border-box;font-size:11px;border:1px solid #3b82f6;border-radius:2px;padding:1px 3px;background:#eff6ff;outline:none';
    td.appendChild(input);
    input.focus();
    if (input.select) input.select();

    let done = false;
    const restore = () => { restoreParamCell(td, field, origVal); };
    const save = async () => {
      if (done) return; done = true;
      const newVal = input.value.trim();
      if (newVal === origVal) { restore(); return; }
      const body = {};
      if (['valor_min','valor_max','objetivo'].includes(field)) {
        body[field] = newVal === '' ? null : Number(newVal);
        // recalcular tipo_rango
        const row = td.closest('tr[data-pid]');
        if (row) {
          const getV = f => { const c = row.querySelector(`td[data-field="${f}"]`); return c ? c.dataset.val : ''; };
          const mn = field === 'valor_min' ? newVal : getV('valor_min');
          const mx = field === 'valor_max' ? newVal : getV('valor_max');
          body.tipo_rango = (mn !== '' && mx !== '') ? 'entre' : mn !== '' ? 'minimo' : mx !== '' ? 'maximo' : 'ninguno';
        }
      } else if (field === 'frecuencia') {
        body[field] = Number(newVal);
      } else {
        body[field] = newVal || null;
      }
      try {
        await PATCH('/parametros-titulacion/' + pid, body);
        const p = (window._catalogData?.params||[]).find(x => x.id === pid);
        if (p) { p[field] = body[field]; if (body.tipo_rango) p.tipo_rango = body.tipo_rango; }
        td.dataset.val = newVal;
        restoreParamCell(td, field, newVal);
      } catch(err) { restore(); alert('Error: ' + err.message); }
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); done = true; input.removeEventListener('blur', save); restore(); }
    });
  });

  // ── Nueva fila inline: guardar / cancelar ─────────────────────────────────
  document.getElementById('pc-table-area').addEventListener('click', async e => {
    const btnSave = e.target.closest('.np-save');
    if (btnSave) {
      const row = btnSave.closest('tr.new-param-row');
      if (!row) return;
      const tid    = Number(row.dataset.tid);
      const nombre = row.querySelector('.np-nombre').value.trim();
      if (!nombre) { row.querySelector('.np-nombre').focus(); return; }
      const mn = row.querySelector('.np-min').value;
      const mx = row.querySelector('.np-max').value;
      const ob = row.querySelector('.np-obj').value;
      const body = {
        tanque_id:        tid,
        nombre_parametro: nombre,
        quimico:          row.querySelector('.np-quimico').value.trim() || null,
        tipo_rango:       (mn !== '' && mx !== '') ? 'entre' : mn !== '' ? 'minimo' : mx !== '' ? 'maximo' : 'ninguno',
        valor_min:        mn !== '' ? Number(mn) : null,
        valor_max:        mx !== '' ? Number(mx) : null,
        objetivo:         ob !== '' ? Number(ob) : null,
        unidad:           row.querySelector('.np-unidad').value.trim() || '',
        frecuencia:       Number(row.querySelector('.np-frec').value) || 2,
        orden:            Number(row.querySelector('.np-orden')?.value) || 0
      };
      try {
        const created = await POST('/parametros-titulacion', body);
        if (window._catalogData?.params) window._catalogData.params.push(created);
        const { tanques, params } = window._catalogData || {};
        const filtro = document.getElementById('pc-filtro-linea')?.value || '';
        document.getElementById('pc-table-area').innerHTML = renderParamCatalog(params, tanques, filtro);
      } catch(err) { alert('Error: ' + err.message); }
      return;
    }
    const btnCancel = e.target.closest('.np-cancel');
    if (btnCancel) {
      const row = btnCancel.closest('tr.new-param-row');
      if (row) { row.style.display = 'none'; row.querySelectorAll('input,select').forEach(i => i.value = i.tagName === 'SELECT' ? i.options[0]?.value : ''); }
      return;
    }
  });

  // ── Eliminar parámetro (× botón) ─────────────────────────────────────────
  document.getElementById('pc-table-area').addEventListener('click', async e => {
    const btn = e.target.closest('.btn-del-param');
    if (!btn) return;
    const pid = Number(btn.dataset.pid);
    const p = (window._catalogData?.params||[]).find(x => x.id === pid);
    if (!confirm(`¿Quitar parámetro "${p?.nombre_parametro}"?\n(Si tiene historial quedará inactivo, si no tiene historial se eliminará)`)) return;
    try {
      const result = await DEL('/parametros-titulacion/' + pid);
      if (result.deactivated) {
        if (window._catalogData?.params) { const x = window._catalogData.params.find(x => x.id === pid); if (x) x.activo = false; }
      } else {
        if (window._catalogData?.params) window._catalogData.params = window._catalogData.params.filter(x => x.id !== pid);
      }
      const { tanques, params } = window._catalogData || {};
      const filtro = document.getElementById('pc-filtro-linea')?.value || '';
      document.getElementById('pc-table-area').innerHTML = renderParamCatalog(params, tanques, filtro);
    } catch(err) { alert('Error: ' + err.message); }
  });
}

function restoreParamCell(td, field, val) {
  const v = val ?? '';
  if (field === 'quimico') {
    td.innerHTML = v ? `<span style="background:#dbeafe;color:#1e40af;padding:0 4px;border-radius:3px;font-size:11px">${esc(v)}</span>` : '<span style="color:#d1d5db">—</span>';
  } else if (field === 'frecuencia') {
    td.textContent = (v || 2) + '/t';
  } else if (['valor_min','valor_max','objetivo'].includes(field)) {
    td.innerHTML = (v !== '' && v !== null) ? esc(String(v)) : '<span style="color:#d1d5db">—</span>';
  } else {
    td.innerHTML = v ? esc(v) : '<span style="color:#d1d5db">—</span>';
  }
}

window.editParam = async function(id) {
  const [params, tanques, items] = await Promise.all([GET('/parametros-titulacion'), GET('/tanques'), GET('/items?vigente=true')]);
  const param = params.find(p => p.id === id);
  if (param) showModalParam(param, tanques, null, items);
};

function showModalParam(param, tanques, preselectedTanque, items = []) {
  const isEdit = !!param;
  const isPresel = !isEdit && !!preselectedTanque;
  const lineas = [...new Set(tanques.map(t=>t.linea))].filter(Boolean).sort();
  const editLinea = param ? tanques.find(t=>t.id===param.tanque_id)?.linea : null;
  const quimicoOpts = [
    `<option value="">— Sin químico (aplica siempre) —</option>`,
    ...items.map(it => `<option value="${it.item}" ${param?.quimico===it.item?'selected':''}>${it.item}${it.presentacion?' — '+it.presentacion:''}</option>`)
  ].join('');
  showModal(`
    <h3>${isEdit?'✏️ Editar Parámetro':'+ Nuevo Parámetro'}</h3>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label>Línea *</label>
        <select id="pm-linea" ${(isEdit||isPresel)?'disabled':''}>
          ${lineas.map(l=>`<option value="${l}" ${(editLinea||preselectedTanque?.linea)===l?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Tanque *</label>
        <select id="pm-tanque" ${isPresel?'disabled':''}>
          ${isEdit ? `<option value="${param.tanque_id}">${param.no_tanque} — ${param.nombre_tanque}</option>`
            : isPresel ? `<option value="${preselectedTanque.id}">${preselectedTanque.no_tanque} — ${preselectedTanque.nombre_tanque}</option>`
            : '<option value="">-- primero elige línea --</option>'}
        </select>
      </div>
      <div class="form-group"><label>Nombre parámetro *</label><input type="text" id="pm-nombre" value="${param?.nombre_parametro||''}" /></div>
      <div class="form-group"><label>Químico (opcional)</label>
        <select id="pm-quimico">${quimicoOpts}</select>
      </div>
      <div class="form-group"><label>Tipo rango</label>
        <select id="pm-tipo">
          <option value="ninguno" ${param?.tipo_rango==='ninguno'?'selected':''}>Ninguno (solo registro)</option>
          <option value="entre" ${param?.tipo_rango==='entre'?'selected':''}>Entre min y max</option>
          <option value="maximo" ${param?.tipo_rango==='maximo'?'selected':''}>Máximo</option>
          <option value="minimo" ${param?.tipo_rango==='minimo'?'selected':''}>Mínimo</option>
        </select>
      </div>
      <div class="form-group"><label>Unidad</label><input type="text" id="pm-unidad" value="${param?.unidad||''}" placeholder="pts, °C, ppm, %, g/m²" /></div>
      <div class="form-group"><label>Valor mínimo</label><input type="number" step="any" id="pm-min" value="${param?.valor_min??''}" /></div>
      <div class="form-group"><label>Valor máximo</label><input type="number" step="any" id="pm-max" value="${param?.valor_max??''}" /></div>
      <div class="form-group"><label>Objetivo</label><input type="number" step="any" id="pm-obj" value="${param?.objetivo??''}" /></div>
      <div class="form-group"><label>Frecuencia por turno</label>
        <select id="pm-frec"><option value="2" ${param?.frecuencia!==1?'selected':''}>2 veces (x.1 y x.2)</option><option value="1" ${param?.frecuencia===1?'selected':''}>1 vez (solo x.1)</option></select>
      </div>
      <div class="form-group"><label>Orden en pantalla</label><input type="number" id="pm-orden" value="${param?.orden||0}" min="0" /></div>
      ${isEdit?`<div class="form-group"><label>Activo</label>
        <select id="pm-activo"><option value="true" ${param?.activo!==false?'selected':''}>Sí</option><option value="false" ${param?.activo===false?'selected':''}>No</option></select>
      </div>`:''}
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="btn-pm-save">${isEdit?'Guardar cambios':'Crear'}</button>
    </div>`);

  // Línea → Tanques en el modal de creación (solo sin pre-selección)
  if (!isEdit && !isPresel) {
    const updateTanques = async () => {
      const linea = document.getElementById('pm-linea').value;
      const sel = document.getElementById('pm-tanque');
      sel.innerHTML = '<option value="">-- Seleccionar --</option>';
      if (!linea) return;
      const tks = tanques.filter(t=>t.linea===linea);
      tks.forEach(t => sel.add(new Option(`${t.no_tanque} — ${t.nombre_tanque}`, t.id)));
    };
    document.getElementById('pm-linea').addEventListener('change', updateTanques);
    updateTanques();
  }

  document.getElementById('btn-pm-save').addEventListener('click', async () => {
    const body = {
      tanque_id:       Number(document.getElementById('pm-tanque').value),
      nombre_parametro:document.getElementById('pm-nombre').value.trim(),
      quimico:         document.getElementById('pm-quimico').value.trim() || null,
      tipo_rango:      document.getElementById('pm-tipo').value,
      unidad:          document.getElementById('pm-unidad').value.trim(),
      valor_min:       document.getElementById('pm-min').value !== '' ? document.getElementById('pm-min').value : null,
      valor_max:       document.getElementById('pm-max').value !== '' ? document.getElementById('pm-max').value : null,
      objetivo:        document.getElementById('pm-obj').value  !== '' ? document.getElementById('pm-obj').value  : null,
      frecuencia:      Number(document.getElementById('pm-frec').value),
      orden:           Number(document.getElementById('pm-orden').value) || 0,
      ...(isEdit ? { activo: document.getElementById('pm-activo').value === 'true' } : {})
    };
    if (!body.tanque_id || !body.nombre_parametro) { alert('Tanque y nombre son requeridos'); return; }
    try {
      if (isEdit) await PATCH('/parametros-titulacion/' + param.id, body);
      else await POST('/parametros-titulacion', body);
      closeModal();
      navigate('tit-catalogo');
    } catch(e) { alert('Error: ' + e.message); }
  });
}

// ── Reporte de Titulación (HTML imprimible) ───────────────────────────────────
async function generarReporteTitulacion(headerId) {
  const [header, params_cat, tanques_cat] = await Promise.all([
    GET('/titulaciones/' + headerId),
    GET('/parametros-titulacion'),
    GET('/tanques')
  ]);
  if (!header) { alert('No se encontró la titulación'); return; }

  const detalleMap = {};
  (header.detalle || []).forEach(d => { detalleMap[d.parametro_id] = d; });

  const linea = header.linea;
  const tanquesLinea = tanques_cat.filter(t => t.linea === linea).sort((a,b) => String(a.no_tanque).localeCompare(String(b.no_tanque)));
  const paramsLinea = params_cat.filter(p => tanquesLinea.some(t => t.id === p.tanque_id) && p.activo !== false);

  const enjuagues = tanquesLinea.filter(t => t.es_enjuague);
  const proceso   = tanquesLinea.filter(t => !t.es_enjuague);

  const turnoLabel = { T1:'Turno 1 (6:00–14:00)', T2:'Turno 2 (14:00–22:00)', T3:'Turno 3 (22:00–6:00)' }[header.turno] || header.turno;
  const fecha = header.fecha ? header.fecha.split('T')[0].split('-').reverse().join('/') : '—';

  function colorCell(det) {
    if (!det || det.valor_registrado === null || det.valor_registrado === undefined) return { bg:'#f3f4f6', color:'#9ca3af', txt:'—' };
    const st = det.estado_param;
    if (st === 'ok')     return { bg:'#bbf7d0', color:'#15803d', txt: String(det.valor_registrado) };
    if (st === 'limite') return { bg:'#fef08a', color:'#854d0e', txt: String(det.valor_registrado) };
    if (st === 'fuera')  return { bg:'#fecaca', color:'#991b1b', txt: String(det.valor_registrado) };
    if (st === 'paro_linea') return { bg:'#f3f4f6', color:'#6b7280', txt:'⛔' };
    return { bg:'#f3f4f6', color:'#6b7280', txt: String(det.valor_registrado) };
  }

  function rangoTxt(p) {
    if (p.tipo_rango === 'entre')  return `${p.valor_min??'—'} – ${p.valor_max??'—'}`;
    if (p.tipo_rango === 'maximo') return `≤ ${p.valor_max??'—'}`;
    if (p.tipo_rango === 'minimo') return `≥ ${p.valor_min??'—'}`;
    return '—';
  }

  function renderParamRow(p) {
    const det = detalleMap[p.id];
    const c = colorCell(det);
    const obj = p.objetivo != null ? p.objetivo : '';
    const rango = rangoTxt(p);
    const unidad = p.unidad ? ` <span style="color:#9ca3af;font-size:10px">(${p.unidad})</span>` : '';
    return `<tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:3px 8px;font-size:13px;color:#1e293b;white-space:nowrap"><strong>${p.nombre_parametro}</strong>${unidad}</td>
      <td style="padding:3px 6px;text-align:center;white-space:nowrap">
        <span style="display:inline-block;min-width:48px;padding:3px 8px;border-radius:4px;font-weight:800;font-size:15px;background:${c.bg};color:${c.color}">${c.txt}</span>
      </td>
      <td style="padding:3px 6px;font-size:12px;color:#6b7280;white-space:nowrap">rango ${rango}</td>
      <td style="padding:3px 6px;font-size:12px;color:#6b7280;white-space:nowrap">${obj ? obj+' obj' : ''}</td>
    </tr>`;
  }

  function renderTanqueCard(t) {
    const ps = paramsLinea.filter(p => p.tanque_id === t.id).sort((a,b)=>(a.orden||0)-(b.orden||0));
    if (!ps.length) return '';
    const qLabel = t.quimico_activo ? ` <span style="background:#3b82f6;color:#fff;padding:1px 5px;border-radius:3px;font-size:11px">${t.quimico_activo}</span>` : '';
    return `<div style="border:1.5px solid #cbd5e1;border-radius:6px;overflow:hidden;break-inside:avoid">
      <div style="background:#1e3a5f;color:#fff;padding:5px 10px;font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${t.no_tanque} — ${t.nombre_tanque}${qLabel}
      </div>
      <table style="width:100%;border-collapse:collapse">
        <tbody>${ps.map(renderParamRow).join('')}</tbody>
      </table>
    </div>`;
  }

  function renderEnjuagueRow(t) {
    const ps = paramsLinea.filter(p => p.tanque_id === t.id).sort((a,b)=>(a.orden||0)-(b.orden||0));
    if (!ps.length) return '';
    const filas = ps.map(p => {
      const det = detalleMap[p.id];
      const c = colorCell(det);
      return `<tr style="border-bottom:1px solid #f0f9ff">
        <td style="padding:3px 6px;font-size:12px;color:#1e293b">${p.nombre_parametro}${p.unidad?` <span style="color:#9ca3af;font-size:10px">(${p.unidad})</span>`:''}</td>
        <td style="padding:3px 5px;text-align:center">
          <span style="display:inline-block;min-width:40px;padding:2px 5px;border-radius:3px;font-weight:800;font-size:13px;background:${c.bg};color:${c.color}">${c.txt}</span>
        </td>
      </tr>`;
    }).join('');
    return `<div style="margin-bottom:7px">
      <div style="font-size:12px;font-weight:700;color:#0369a1;border-bottom:1px solid #bae6fd;padding-bottom:2px;margin-bottom:2px">${t.no_tanque} — ${t.nombre_tanque}</div>
      <table style="width:100%;border-collapse:collapse">${filas}</table>
    </div>`;
  }

  // Grid de proceso: 3 cols si hay muchos tanques, 2 si pocos
  const procesoCards = proceso.map(renderTanqueCard).filter(Boolean);
  const cols = procesoCards.length > 4 ? 3 : 2;
  let procesoHtml = '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:8px">';
  procesoCards.forEach(c => { procesoHtml += c; });
  procesoHtml += '</div>';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte Titulación — ${linea} — ${fecha}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 13px; background: #f8fafc; padding: 12px; }
    #reporte-body { background:#fff; width: 1080px; padding: 14px 16px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .btn-action { padding: 7px 18px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
    @media print {
      .no-print { display: none !important; }
      body { background: #fff; padding: 0; }
      #reporte-body { box-shadow: none; border-radius: 0; }
      @page { size: A4 landscape; margin: 5mm; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="display:flex;gap:10px;margin-bottom:12px;align-items:center;background:#1e3a5f;padding:10px 16px;border-radius:8px;width:1080px">
    <button class="btn-action" style="background:#fff;color:#1e3a5f" onclick="imprimirReporte()">🖨️ Imprimir</button>
    <button class="btn-action" style="background:#0369a1;color:#fff" onclick="copiarComoImagen()">📋 Copiar imagen</button>
    <button class="btn-action" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3)" onclick="window.close()">✕ Cerrar</button>
    <span style="margin-left:auto;color:#93c5fd;font-size:12px">Generado: ${new Date().toLocaleString('es-MX')}</span>
  </div>

  <div id="reporte-body">
    <!-- Encabezado -->
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #1e3a5f;padding-bottom:8px;margin-bottom:10px">
      <div style="line-height:1.1">
        <div style="font-size:20px;font-weight:900;color:#1e3a5f;letter-spacing:-0.5px">CUESTO</div>
        <div style="font-size:11px;color:#64748b;letter-spacing:2px;text-transform:uppercase">CORPORATIVO</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Soluciones del proceso</div>
        <div style="font-size:18px;font-weight:800;color:#1e3a5f">Reporte Titulación — ${linea}</div>
        <div style="font-size:13px;color:#374151">Tit. ${header.numero_titulacion} &nbsp;·&nbsp; ${turnoLabel}</div>
      </div>
      <div style="text-align:right;font-size:13px;line-height:2;color:#374151;background:#f1f5f9;padding:6px 12px;border-radius:6px">
        <div><strong>Fecha:</strong> ${fecha}</div>
        <div><strong>Turno:</strong> ${header.turno} — Tit. ${header.numero_titulacion}</div>
        <div><strong>Analista:</strong> ${header.analista || '—'}</div>
      </div>
    </div>

    <!-- Cuerpo -->
    <div style="display:flex;gap:12px;align-items:flex-start">
      ${enjuagues.length ? `
      <div style="width:185px;flex-shrink:0;border:1.5px solid #bae6fd;border-radius:6px;overflow:hidden">
        <div style="background:#0369a1;color:#fff;padding:5px 10px;font-weight:700;font-size:13px">🚿 Enjuagues</div>
        <div style="padding:2px 4px;font-size:11px;color:#0369a1;background:#e0f2fe;padding:4px 8px">Validar 1× por turno</div>
        <div style="padding:8px 8px">${enjuagues.map(renderEnjuagueRow).join('')}</div>
      </div>` : ''}
      <div style="flex:1;min-width:0">${procesoHtml}</div>
    </div>

    <!-- Leyenda -->
    <div style="margin-top:10px;border-top:1px solid #e5e7eb;padding-top:8px;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:700;color:#374151">Significado:</span>
      <span style="display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:22px;height:14px;background:#bbf7d0;border-radius:3px"></span><span style="font-size:12px"><strong>Verde</strong> — Dentro de especificación → Mantener</span></span>
      <span style="display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:22px;height:14px;background:#fef08a;border-radius:3px"></span><span style="font-size:12px"><strong>Amarillo</strong> — En límite → Dosificar</span></span>
      <span style="display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:22px;height:14px;background:#fecaca;border-radius:3px"></span><span style="font-size:12px"><strong>Rojo</strong> — Fuera de especificación → Ajustar y volver a validar</span></span>
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <script>
  // ── Escala automática para ajustar a una hoja ─────────────────────────────
  // A4 landscape a 96dpi con 5mm de margen: ~1083px × 744px usables
  const PAGE_W = 1083, PAGE_H = 744;

  function calcScale() {
    const el = document.getElementById('reporte-body');
    const w = el.scrollWidth, h = el.scrollHeight;
    return Math.min(PAGE_W / w, PAGE_H / h, 1);
  }

  function applyScale(scale) {
    const el = document.getElementById('reporte-body');
    el.style.transformOrigin = 'top left';
    el.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
    // Colapsar el espacio sobrante para que el navegador no agregue página extra
    el.style.marginBottom = scale < 1 ? (el.scrollHeight * (scale - 1)) + 'px' : '';
  }

  window.onbeforeprint = () => { applyScale(calcScale()); };
  window.onafterprint  = () => { applyScale(1); };

  function imprimirReporte() {
    applyScale(calcScale());
    window.print();
  }

  async function copiarComoImagen() {
    const btn = event.target;
    btn.textContent = 'Procesando...'; btn.disabled = true;
    try {
      if (typeof html2canvas === 'undefined') {
        alert('Cargando... intenta de nuevo en un momento.'); return;
      }
      const scale = calcScale();
      const el = document.getElementById('reporte-body');
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: '#fff',
        width:  el.scrollWidth,
        height: el.scrollHeight,
        windowWidth:  el.scrollWidth,
        windowHeight: el.scrollHeight
      });

      // Si el canvas es más grande que una hoja, escalar el resultado
      let finalCanvas = canvas;
      if (scale < 1) {
        finalCanvas = document.createElement('canvas');
        finalCanvas.width  = Math.round(canvas.width * scale);
        finalCanvas.height = Math.round(canvas.height * scale);
        const ctx = finalCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, 0, finalCanvas.width, finalCanvas.height);
      }

      finalCanvas.toBlob(async blob => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          alert('✅ Imagen copiada al portapapeles');
        } catch(e) {
          // Fallback: descargar como PNG
          const a = document.createElement('a');
          a.href = finalCanvas.toDataURL('image/png');
          a.download = 'reporte-titulacion.png';
          a.click();
        }
      });
    } catch(e) { alert('Error: ' + e.message); }
    finally { btn.textContent = '📋 Copiar imagen'; btn.disabled = false; }
  }
  </script>
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

window.generarReporteTitulacion = generarReporteTitulacion;

// ══════════════════════════════════════════════════════════════════════════════
// CERTIFICADOS DE CALIDAD SKF
// ══════════════════════════════════════════════════════════════════════════════

const CERT_TIPOS = {
  micro: {
    prefix: 'MICS', label: 'Fosfato Micro',
    partNumber: 'Calcium Modified Zinc Phosphate Coating (Micro)',
    typeOfCoating: 'Micro Phosphate',
    rows: [
      { request: 'Phosphate Weight', method: '2-PR-11',
        range: 'MS312015 Rev. A (200 - 800 mg/ft\u00b2)',
        sourceKey: 'micro_fosfato', min: 200, max: 800, unit: 'mg/ft\u00b2' }
    ]
  },
  macro: {
    prefix: 'MACS', label: 'Fosfato Macro',
    partNumber: 'Zinc Phosphate Coating (Macro)',
    typeOfCoating: 'Macro Phosphate',
    rows: [
      { request: 'Phosphate Weight', method: '2-PR-11',
        range: 'MS312016 Rev. A (800 - 2500 mg/ft\u00b2)',
        sourceKey: 'macro_fosfato', min: 800, max: 2500, unit: 'mg/ft\u00b2' }
    ]
  },
  'micro-adhesivo': {
    prefix: 'MICA', label: 'Fosfato Micro con Adhesivo 1753',
    partNumber: 'Calcium Modified Zinc Phosphate Coating With Adhesive 1753 (Micro/1753)',
    typeOfCoating: 'Micro Phosphate 1753',
    rows: [
      { request: 'Phosphate Weight', method: '2-PR-11',
        range: 'MS312019 Rev B (200 - 800 mg/ft\u00b2)',
        sourceKey: 'micro_fosfato', min: 200, max: 800, unit: 'mg/ft\u00b2' },
      { request: 'Solids Percent', method: '2-PR-11',
        range: 'MS312019 Rev B (5.0% - 7.0%)',
        sourceKey: 'adh_solidos', min: 5.0, max: 7.0, unit: '%' }
    ]
  },
  'macro-adhesivo': {
    prefix: 'MACA', label: 'Fosfato Macro con Adhesivo 1753',
    partNumber: 'Zinc Phosphate Coating With Adhesive 1753 (Macro/1753)',
    typeOfCoating: 'Macro Phosphate 1753',
    rows: [
      { request: 'Phosphate Weight', method: '2-PR-11',
        range: 'MS312018 Rev B (800 - 2500 mg/ft\u00b2)',
        sourceKey: 'macro_fosfato', min: 800, max: 2500, unit: 'mg/ft\u00b2' },
      { request: 'Solids Percent', method: '2-PR-11',
        range: 'MS312018 Rev B (5.0% - 7.0%)',
        sourceKey: 'adh_solidos', min: 5.0, max: 7.0, unit: '%' }
    ]
  }
};

function _certNumero(prefix, anio, semana) {
  return `${prefix}${anio}SEM${String(semana).padStart(2, '0')}`;
}

function _certWeekRange(semana, anio) {
  const jan4 = new Date(anio, 0, 4);
  const dow  = jan4.getDay() || 7;
  const mon  = new Date(jan4);
  mon.setDate(jan4.getDate() - dow + 1 + (semana - 1) * 7);
  const sun  = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = d => d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${fmt(mon)} - ${fmt(sun)}`;
}

function _isoWeekNow() {
  const now = new Date();
  const d   = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7), year: d.getUTCFullYear() };
}

async function viewCertCalidad() {
  const { week, year } = _isoWeekNow();
  return `
<div class="table-header"><h2 style="color:#fff;margin:0">📄 Certificados de Calidad SKF</h2></div>
<div style="max-width:740px;margin:24px auto;padding:0 16px">

  <div class="card" style="padding:28px;border-radius:14px;background:#fff;box-shadow:0 2px 16px rgba(0,0,0,.09)">
    <h3 style="margin:0 0 22px;font-size:15px;color:#1e3a5f;border-bottom:2px solid #e2e8f0;padding-bottom:12px">
      Generar certificado semanal
    </h3>

    <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;margin-bottom:20px;align-items:end">
      <div>
        <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;letter-spacing:.5px">
          TIPO DE CERTIFICADO
        </label>
        <select id="cert-tipo" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;color:#1e293b">
          <option value="micro">Fosfato Micro</option>
          <option value="macro">Fosfato Macro</option>
          <option value="micro-adhesivo">Fosfato Micro con Adhesivo 1753</option>
          <option value="macro-adhesivo">Fosfato Macro con Adhesivo 1753</option>
        </select>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;letter-spacing:.5px">SEMANA</label>
        <input type="number" id="cert-semana" value="${week}" min="1" max="53"
          style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;color:#1e293b" />
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:6px;letter-spacing:.5px">AÑO</label>
        <input type="number" id="cert-anio" value="${year}" min="2024" max="2035"
          style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;color:#1e293b" />
      </div>
    </div>

    <button id="btn-cert-calcular" class="btn btn-primary" style="width:100%;padding:11px;font-size:14px;margin-bottom:22px">
      🔍 Calcular estadísticas de la semana
    </button>

    <div id="cert-resultado"></div>
  </div>

  <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:10px">
    Solo usuarios admin pueden emitir certificados en PDF · Línea Baker
  </p>
</div>`;
}

function bindCertCalidad() {
  document.getElementById('btn-cert-calcular')?.addEventListener('click', async () => {
    const tipo   = document.getElementById('cert-tipo').value;
    const semana = Number(document.getElementById('cert-semana').value);
    const anio   = Number(document.getElementById('cert-anio').value);
    const resEl  = document.getElementById('cert-resultado');

    if (!semana || semana < 1 || semana > 53) {
      resEl.innerHTML = '<div class="alert alert-warn">⚠️ Semana inválida (1–53).</div>';
      return;
    }
    if (!anio || anio < 2020) {
      resEl.innerHTML = '<div class="alert alert-warn">⚠️ Año inválido.</div>';
      return;
    }

    resEl.innerHTML = '<div style="text-align:center;padding:24px;color:#64748b;font-size:14px">⏳ Calculando estadísticas...</div>';

    const stats = await GET(`/titulaciones/cert-stats?semana=${semana}&anio=${anio}`).catch(() => null);
    if (!stats) {
      resEl.innerHTML = '<div class="alert alert-warn">⚠️ Error al obtener estadísticas del servidor.</div>';
      return;
    }

    if (stats.titulaciones_count === 0) {
      resEl.innerHTML = `
<div class="alert alert-warn" style="text-align:center">
  ⚠️ No hay titulaciones Baker registradas para la semana <b>${semana}</b> de <b>${anio}</b>.<br>
  <span style="font-size:12px;color:#78716c">Período: ${stats.fecha_inicio} — ${stats.fecha_fin}</span>
</div>`;
      return;
    }

    const tipoCfg  = CERT_TIPOS[tipo];
    const certNum  = _certNumero(tipoCfg.prefix, anio, semana);
    const weekRange = _certWeekRange(semana, anio);

    const rowResults = tipoCfg.rows.map(row => {
      const s = stats[row.sourceKey];
      if (!s || s.avg == null) return { ...row, avg: null, std: null, count: 0, ok: false, missing: true };
      const ok = s.avg >= row.min && s.avg <= row.max;
      return { ...row, avg: s.avg, std: s.std, count: s.count, ok, missing: false };
    });

    const canEmit = state.user?.vales_role === 'admin' && rowResults.every(r => !r.missing && r.ok);
    const hasErrors = rowResults.some(r => !r.ok || r.missing);

    const rowsHtml = rowResults.map(r => {
      if (r.missing) {
        return `<tr>
          <td style="padding:10px 8px;border:1px solid #e2e8f0">${r.request}</td>
          <td style="padding:10px 8px;border:1px solid #e2e8f0">${r.method}</td>
          <td style="padding:10px 8px;border:1px solid #e2e8f0;font-size:12px">${r.range}</td>
          <td style="padding:10px 8px;border:1px solid #e2e8f0;background:#fef3c7;color:#b45309;font-weight:700">Sin datos registrados</td>
        </tr>`;
      }
      const result = `${r.avg.toFixed(2)} ± ${r.std.toFixed(2)} ${r.unit}`;
      return `<tr>
        <td style="padding:10px 8px;border:1px solid #e2e8f0">${r.request}</td>
        <td style="padding:10px 8px;border:1px solid #e2e8f0">${r.method}</td>
        <td style="padding:10px 8px;border:1px solid #e2e8f0;font-size:12px">${r.range}</td>
        <td style="padding:10px 8px;border:1px solid #e2e8f0;background:${r.ok ? '#f0fdf4' : '#fef2f2'};
            color:${r.ok ? '#15803d' : '#dc2626'};font-weight:700">
          ${result} ${r.ok ? '✅' : '⛔ FUERA DE RANGO'}
        </td>
      </tr>`;
    }).join('');

    const borderColor = hasErrors ? '#fca5a5' : '#86efac';
    const bgColor     = hasErrors ? '#fff7f7' : '#f0fdf4';
    const notAdminMsg = (state.user?.vales_role !== 'admin' && !hasErrors)
      ? '<div style="margin-top:10px;padding:8px 12px;background:#fef9c3;border-radius:6px;font-size:12px;color:#854d0e">ℹ️ Solo un administrador puede descargar el PDF de este certificado.</div>'
      : '';
    const errorMsg = hasErrors
      ? '<div style="margin-top:10px;padding:10px 14px;background:#fee2e2;border-radius:8px;color:#991b1b;font-weight:700;font-size:13px">⛔ No se puede emitir: uno o más resultados están fuera del rango permitido o faltan datos.</div>'
      : '';

    resEl.innerHTML = `
<div style="border:2px solid ${borderColor};border-radius:12px;padding:18px;background:${bgColor}">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;gap:12px">
    <div>
      <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Número de certificado</div>
      <div style="font-size:20px;font-weight:800;color:#1e3a5f;letter-spacing:.5px">${certNum}</div>
      <div style="font-size:12px;color:#475569;margin-top:2px">${tipoCfg.typeOfCoating} · ${weekRange}</div>
    </div>
    <div style="text-align:right;font-size:12px;color:#64748b;line-height:1.7">
      <div><b>${stats.titulaciones_count}</b> titulaciones Baker</div>
      <div>${stats.fecha_inicio} — ${stats.fecha_fin}</div>
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
    <thead>
      <tr style="background:#1e3a5f;color:#fff">
        <th style="padding:9px 8px;text-align:left;font-size:12px">Request</th>
        <th style="padding:9px 8px;text-align:left;font-size:12px">Testing Method</th>
        <th style="padding:9px 8px;text-align:left;font-size:12px">Allowable Range</th>
        <th style="padding:9px 8px;text-align:left;font-size:12px">Test Result</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  ${errorMsg}${notAdminMsg}
</div>

${canEmit ? `
<button id="btn-cert-pdf" class="btn btn-primary"
  style="width:100%;margin-top:16px;padding:13px;font-size:15px;font-weight:700;border-radius:10px">
  📄 Descargar Certificado PDF — ${certNum}
</button>` : ''}`;

    if (canEmit) {
      document.getElementById('btn-cert-pdf')?.addEventListener('click', () => {
        generarCertificadoPDF({ tipoCfg, certNum, semana, anio, weekRange, rowResults });
      });
    }
  });
}

function generarCertificadoPDF({ tipoCfg, certNum, semana, anio, weekRange, rowResults }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  const pgW = 215.9, pgH = 279.4;
  const mL = 14, mR = 14;
  const usW = pgW - mL - mR;
  let y = 10;

  // ── ENCABEZADO ────────────────────────────────────────────────────────────
  const hdrH = 28;
  doc.setDrawColor(0); doc.setLineWidth(0.5);
  doc.rect(mL, y, usW, hdrH);

  // Área izquierda (logo/empresa)
  const logoW = 54;
  doc.setFillColor(15, 23, 42);
  doc.rect(mL, y, logoW, hdrH, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
  doc.text('SISTEMAS INTEGRADOS', mL + logoW / 2, y + 10, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  doc.text('Registros de Calidad', mL + logoW / 2, y + 16, { align: 'center' });

  // Título central
  doc.setTextColor(0, 0, 0);
  const codeBoxW = 52;
  const centerX = mL + logoW + (usW - logoW - codeBoxW) / 2;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Quality certificate', centerX, y + 12, { align: 'center' });

  // Caja código (derecha)
  const codeX = pgW - mR - codeBoxW;
  doc.setLineWidth(0.3);
  doc.rect(codeX, y, codeBoxW, hdrH);
  [7, 14, 21].forEach(dy => doc.line(codeX, y + dy, codeX + codeBoxW, y + dy));
  doc.line(codeX + 26, y, codeX + 26, y + hdrH);

  const codeLabels = ['Código:', 'Nivel de Rev.:', 'Fecha Rev.:', 'Hoja:'];
  const codeVals   = ['4-CA-86', '0', '2-Feb-21', '1 de 1'];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(30, 30, 30);
  codeLabels.forEach((lbl, i) => {
    doc.text(lbl, codeX + 2, y + 5 + i * 7);
    doc.setFont('helvetica', 'normal');
    doc.text(codeVals[i], codeX + 28, y + 5 + i * 7);
    doc.setFont('helvetica', 'bold');
  });

  y += hdrH;

  // ── NÚMERO DE CERTIFICADO ─────────────────────────────────────────────────
  const certBoxH = 20;
  doc.setLineWidth(0.4); doc.setTextColor(0, 0, 0);
  doc.rect(mL, y, usW, certBoxH);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
  doc.text('certificate number', mL + 3, y + 5);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(0, 0, 0);
  doc.text(certNum, mL + 4, y + 16);

  // Delivery date (derecha)
  const ddX = mL + usW * 0.55;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
  doc.text('delivery date:', ddX, y + 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
  doc.text(weekRange, ddX, y + 14);

  y += certBoxH;

  // ── CLIENT ────────────────────────────────────────────────────────────────
  const clientH = 11;
  doc.rect(mL, y, usW, clientH);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
  doc.text('client:', mL + 3, y + 4);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(0, 0, 0);
  doc.text('SKF Sealing Solution SA de CV', mL + 18, y + 8);

  y += clientH;

  // ── INVOICE + PART NUMBER ─────────────────────────────────────────────────
  const ipH = 16;
  const colInv = usW * 0.36, colPart = usW * 0.64;
  doc.rect(mL, y, colInv, ipH);
  doc.rect(mL + colInv, y, colPart, ipH);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
  doc.text('invoice number:', mL + 3, y + 4.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(0, 0, 0);
  doc.text(`Semana ${semana} / Week ${semana}`, mL + 3, y + 12);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
  doc.text('part number:', mL + colInv + 3, y + 4.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(0, 0, 0);
  const partLines = doc.splitTextToSize(tipoCfg.partNumber, colPart - 6);
  doc.text(partLines, mL + colInv + 3, y + 10);

  y += ipH;

  // ── WORK ORDER / QTY / TYPE ───────────────────────────────────────────────
  const wqH = 14;
  const cWO = usW * 0.28, cQty = usW * 0.22, cType = usW * 0.50;
  doc.rect(mL,              y, cWO,   wqH);
  doc.rect(mL + cWO,        y, cQty,  wqH);
  doc.rect(mL + cWO + cQty, y, cType, wqH);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
  doc.text('work order',              mL + 3,              y + 4.5);
  doc.text('Qty',                     mL + cWO + 3,        y + 4.5);
  doc.text('type of finish/coating:', mL + cWO + cQty + 3, y + 4.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(0, 0, 0);
  doc.text('All Applicable', mL + 3,              y + 11);
  doc.text('All Applicable', mL + cWO + 3,        y + 11);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text(tipoCfg.typeOfCoating, mL + cWO + cQty + 3, y + 11);

  y += wqH + 4;

  // ── TABLA REQUEST / METHOD / RANGE / RESULT ───────────────────────────────
  const tblBody = rowResults.map(r => [
    r.request,
    r.method,
    r.range,
    r.avg != null ? `${r.avg.toFixed(2)} \u00b1 ${r.std.toFixed(2)} ${r.unit}` : 'Sin datos'
  ]);

  doc.autoTable({
    startY: y,
    margin: { left: mL, right: mR },
    head: [['Request', 'Testing Method', 'Allowable Range', 'Test Result']],
    body: tblBody,
    columnStyles: {
      0: { cellWidth: 42 },
      1: { cellWidth: 26 },
      2: { cellWidth: 68 },
      3: { cellWidth: 'auto' }
    },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', fontSize: 9, cellPadding: { top: 5, bottom: 5, left: 4, right: 4 } },
    bodyStyles: { fontSize: 9.5, cellPadding: { top: 7, bottom: 7, left: 4, right: 4 }, font: 'helvetica', minCellHeight: 18 },
    styles: { lineColor: [0, 0, 0], lineWidth: 0.35 },
  });

  y = doc.lastAutoTable.finalY + 5;

  // ── OBSERVATIONS ──────────────────────────────────────────────────────────
  // Helper: texto justificado (distribuye espacios entre palabras por línea)
  function printJustified(lines, tx, ty, maxW, lineH) {
    lines.forEach((line, idx) => {
      const isLast = idx === lines.length - 1;
      const words  = line.split(' ').filter(w => w.length > 0);
      if (isLast || words.length <= 1) { doc.text(line, tx, ty + idx * lineH); return; }
      const totalWordW = words.reduce((s, w) => s + doc.getTextWidth(w), 0);
      const gap = (maxW - totalWordW) / (words.length - 1);
      let cx = tx;
      words.forEach(w => { doc.text(w, cx, ty + idx * lineH); cx += doc.getTextWidth(w) + gap; });
    });
  }

  const obsPadX = 3, obsPadY = 4;
  const obsInnerW = usW - obsPadX * 2;
  const obsFullText = `The data presented in this certificate is automatically generated from process titration records and may require additional validation by the quality department. We reserve the right to verify process information if deemed necessary. This certificate covers all materials processed through ${tipoCfg.typeOfCoating} during the period ${weekRange}. However, material conditions may be affected by the client's environment, storage conditions, or handling and manipulation by third parties beyond our control; therefore, any anomaly or claim must be reviewed individually using the official QR code on the packaging label FAL 01 02 Rev. 0.`;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
  const obsWrapped = doc.splitTextToSize(obsFullText, obsInnerW);
  const obsLineH   = 3.5;
  const obsH       = obsPadY + 5 + obsLineH + obsWrapped.length * obsLineH + obsPadY;

  doc.setLineWidth(0.4);
  doc.rect(mL, y, usW, obsH);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
  doc.text('Observations:', mL + obsPadX, y + obsPadY);

  // Número de certificado en negrita
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(0, 0, 0);
  doc.text(certNum, mL + obsPadX, y + obsPadY + 4.5);

  // Texto legal justificado, fuente 6 pt
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(55, 55, 55);
  printJustified(obsWrapped, mL + obsPadX, y + obsPadY + 4.5 + obsLineH, obsInnerW, obsLineH);

  y += obsH + 4;

  // ── FIRMAS ────────────────────────────────────────────────────────────────
  // Genera código de firma electrónica con trazabilidad
  function genESign(certN, initials) {
    const now = new Date();
    const ts  = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}` +
                `T${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const seed = certN + ts + initials;
    let h1 = 0x9A3D, h2 = 0xF27B;
    for (let i = 0; i < seed.length; i++) {
      const c = seed.charCodeAt(i);
      h1 = ((h1 << 5) ^ h2 ^ c) >>> 0;
      h2 = ((h2 << 3) ^ h1 ^ (c * 31)) >>> 0;
    }
    const hex1 = h1.toString(16).toUpperCase().padStart(8, '0');
    const hex2 = h2.toString(16).toUpperCase().padStart(8, '0');
    return `ESGN-${ts}-${certN}-${initials}-${hex1}${hex2}`;
  }

  const esignLR  = genESign(certNum, 'LR');
  const esignAER = genESign(certNum, 'AER');

  const sigH = 48;
  const sigW = usW / 2;
  doc.setLineWidth(0.4);
  doc.rect(mL, y, sigW, sigH);
  doc.rect(mL + sigW, y, sigW, sigH);

  function drawSig(x, title1, title2, name, esign) {
    const cx = x + sigW / 2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0, 0, 0);
    doc.text(title1, cx, y + 8,  { align: 'center' });
    doc.text(title2, cx, y + 14, { align: 'center' });
    doc.setDrawColor(0); doc.setLineWidth(0.3);
    doc.line(x + 6, y + 28, x + sigW - 6, y + 28);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
    doc.text(name, cx, y + 34, { align: 'center' });
    // Código de firma electrónica
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(80, 80, 80);
    doc.text(esign, cx, y + 40, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(110, 110, 110);
    doc.text('Electronic signature record / Registro de firma electrónica', cx, y + 46, { align: 'center' });
  }

  drawSig(mL,        'Elaboration and compilation of data', 'Quality Engineer', 'LUIS RAMIREZ',       esignLR);
  drawSig(mL + sigW, 'Review and approval',                 'Process Engineer', 'ADAN ELIAS RAMIREZ', esignAER);

  // ── PIE DE PÁGINA ─────────────────────────────────────────────────────────
  doc.setDrawColor(0); doc.setLineWidth(0.4);
  doc.line(mL, pgH - 16, pgW - mR, pgH - 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(30, 30, 30);
  doc.text('ISO 9001:2015  Certificado GSC9KMX475', pgW / 2, pgH - 9, { align: 'center' });

  doc.save(`${certNum}.pdf`);
}

// ── Arranque ──────────────────────────────────────────────────────────────────
if (tryRestore()) {
  render();
} else {
  render();
}
