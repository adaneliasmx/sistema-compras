'use strict';
// ── Estado global ─────────────────────────────────────────────────────────────
const state = { user: null, token: null, view: 'urgencias', alertaPolling: null, ultimaUrgencia: null };

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch('/api/mant' + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(s) { return s ? String(s).slice(0, 10) : '—'; }
function fmtDateTime(s) { if (!s) return '—'; const d = s.slice(0,10), t = s.slice(11,16); return `${d} ${t}`; }
function timeSince(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${m}m`;
}

// ── Badges ────────────────────────────────────────────────────────────────────
function urgenciaBadge(u) {
  const map = { alta: 'urgencia-alta 🔴', media: 'urgencia-media 🟡', baja: 'urgencia-baja 🟢' };
  const [cls, emoji] = (map[u] || 'urgencia-baja 🟢').split(' ');
  return `<span class="urgencia-badge ${cls}">${emoji} ${u || 'baja'}</span>`;
}
function statusBadge(s) {
  const map = { abierta:'status-abierta 🔴 Abierta', asignada:'status-asignada 🔵 Asignada', en_proceso:'status-proceso 🟣 En proceso', en_validacion:'status-validacion 🟠 En validación', cerrada:'status-cerrada ✅ Cerrada', cancelada:'status-cerrada ✖ Cancelada' };
  const txt = map[s] || s;
  const parts = txt.split(' ');
  const cls = parts[0]; const label = parts.slice(1).join(' ');
  return `<span class="urgencia-badge ${cls}" style="font-size:10px">${label}</span>`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function saveSession(token, user) {
  state.token = token; state.user = user;
  sessionStorage.setItem('mant_token', token);
  sessionStorage.setItem('mant_user', JSON.stringify(user));
}
function loadSession() {
  const t = sessionStorage.getItem('mant_token');
  const u = sessionStorage.getItem('mant_user');
  if (t && u) { state.token = t; state.user = JSON.parse(u); return true; }
  return false;
}
function logout() {
  state.token = null; state.user = null;
  sessionStorage.removeItem('mant_token');
  sessionStorage.removeItem('mant_user');
  if (state.alertaPolling) clearInterval(state.alertaPolling);
  render();
}

// ── Render raíz ───────────────────────────────────────────────────────────────
function render() {
  if (!state.user) { renderLogin(); return; }
  renderApp();
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="mant-login-wrap">
      <div class="mant-login-box">
        <h2>🔧 Mantenimiento</h2>
        <p>Inicia sesión para continuar</p>
        <div id="login-err" style="color:#dc2626;font-size:13px;margin-bottom:10px;display:none"></div>
        <div class="mant-form-group"><label>Usuario</label>
          <select id="l-email" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;background:#fff;color:#1e293b">
            <option value="">— Cargando usuarios... —</option>
          </select>
        </div>
        <div class="mant-form-group"><label>Contraseña</label>
          <input id="l-pass" type="password" placeholder="••••••••" autocomplete="current-password"/>
        </div>
        <button id="l-btn" class="btn-primary" style="width:100%;padding:10px;font-size:15px">Ingresar</button>
      </div>
    </div>`;

  const sel = document.getElementById('l-email');
  const err = document.getElementById('login-err');

  fetch('/api/mant/auth/usuarios')
    .then(r => r.json())
    .then(usuarios => {
      if (!Array.isArray(usuarios) || usuarios.length === 0) {
        sel.innerHTML = '<option value="">— Sin usuarios registrados —</option>';
        return;
      }
      sel.innerHTML = '<option value="">— Seleccionar usuario —</option>' +
        usuarios.map(u => `<option value="${escHtml(u.email)}">${escHtml(u.nombre)}</option>`).join('');
    })
    .catch(() => { sel.innerHTML = '<option value="">— Error al cargar usuarios —</option>'; });

  const doLogin = async () => {
    const email = sel.value.trim();
    const pass  = document.getElementById('l-pass').value;
    err.style.display = 'none';
    if (!email) { err.textContent = 'Selecciona un usuario'; err.style.display = 'block'; return; }
    if (!pass)  { err.textContent = 'Ingresa la contraseña'; err.style.display = 'block'; return; }
    const btn = document.getElementById('l-btn');
    btn.disabled = true; btn.textContent = 'Verificando...';
    try {
      const res = await fetch('/api/mant/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        err.textContent = d.error || 'Error al iniciar sesión';
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Ingresar';
        return;
      }
      saveSession(d.token, d.user);
      render();
    } catch (e) {
      err.textContent = 'Error de conexión';
      err.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Ingresar';
    }
  };
  document.getElementById('l-btn').onclick = doLogin;
  document.getElementById('l-pass').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
}

// ── APP PRINCIPAL ─────────────────────────────────────────────────────────────
function renderApp() {
  const role = state.user.mant_role;
  const navItems = buildNavItems(role);

  document.getElementById('app').innerHTML = `
    <nav class="mant-nav">
      <div class="mant-nav-brand">🔧 Mantenimiento</div>
      <div class="mant-nav-links">
        ${navItems.map(n => `<button class="mant-nav-btn${state.view===n.id?' active':''}" data-view="${n.id}">${n.label}</button>`).join('')}
      </div>
      <div class="mant-nav-user">
        ${escHtml(state.user.full_name)}
        <span style="font-size:10px;background:rgba(255,255,255,.15);padding:2px 6px;border-radius:4px;margin:0 6px">${role}</span>
        · <button onclick="logout()" style="background:none;border:none;color:rgba(255,255,255,.5);cursor:pointer;font-size:12px">Salir</button>
      </div>
    </nav>
    <div class="mant-main" id="mant-content">
      <div style="text-align:center;padding:40px;color:#9ca3af">Cargando...</div>
    </div>
    <div id="mant-alerts"></div>`;

  document.querySelectorAll('.mant-nav-btn').forEach(btn => {
    btn.onclick = () => { state.view = btn.dataset.view; renderApp(); };
  });

  // Polling de urgencias (técnico y admin)
  if (['tecnico_mant','admin','superadmin_mant'].includes(role)) startUrgenciasPolling();

  loadView(state.view);
}

function buildNavItems(role) {
  const isAdmin = role === 'admin' || role === 'superadmin_mant';
  const items = [];
  if (isAdmin || role === 'tecnico_mant') items.push({ id: 'urgencias', label: '🚨 Urgencias' });
  if (isAdmin || role === 'supervisor_mant') items.push({ id: 'nueva', label: '➕ Nueva solicitud' });
  if (role === 'supervisor_mant') items.push({ id: 'mis-ordenes', label: '📋 Mis solicitudes' });
  if (role === 'supervisor_mant' || isAdmin) items.push({ id: 'validacion', label: '🔍 En validación' });
  if (role === 'tecnico_mant') items.push({ id: 'mis-ordenes', label: '📋 Mis órdenes' });
  if (isAdmin || role === 'tecnico_mant') items.push({ id: 'ordenes', label: '📋 Todas las órdenes' });
  if (isAdmin || role === 'supervisor_mant') items.push({ id: 'semana', label: '📅 Plan semanal' });
  if (isAdmin) items.push({ id: 'programados', label: '🗓 Programados' });
  if (isAdmin) items.push({ id: 'kpis', label: '📊 KPIs' });
  if (isAdmin) items.push({ id: 'catalogos', label: '⚙️ Catálogos' });
  return items;
}

async function loadView(view) {
  const el = document.getElementById('mant-content');
  if (!el) return;
  try {
    switch (view) {
      case 'urgencias':   await viewUrgencias(el); break;
      case 'nueva':       viewNuevaOrden(el); break;
      case 'mis-ordenes': await viewOrdenes(el, true); break;
      case 'validacion':  await viewValidacion(el); break;
      case 'ordenes':     await viewOrdenes(el, false); break;
      case 'semana':      await viewSemana(el); break;
      case 'programados': await viewProgramados(el); break;
      case 'kpis':        await viewKpis(el); break;
      case 'catalogos':   await viewCatalogos(el); break;
      default:            el.innerHTML = '<p>Vista no encontrada</p>';
    }
  } catch (e) {
    el.innerHTML = `<div style="color:#dc2626;padding:20px">Error: ${escHtml(e.message)}</div>`;
  }
}

// ── VISTA: URGENCIAS ──────────────────────────────────────────────────────────
async function viewUrgencias(el) {
  const [abiertas, asignadas, en_proceso] = await Promise.all([
    apiFetch('/ordenes?tipo=correctivo_urgente&status=abierta'),
    apiFetch('/ordenes?tipo=correctivo_urgente&status=asignada'),
    apiFetch('/ordenes?tipo=correctivo_urgente&status=en_proceso'),
  ]);

  function getTurnoNum(hora) {
    if (!hora) return 99;
    const parts = hora.split(':');
    const mins = Number(parts[0]) * 60 + Number(parts[1] || 0);
    if (mins >= 390 && mins < 870) return 1;   // 6:30–14:30
    if (mins >= 870 && mins < 1290) return 2;  // 14:30–21:30
    return 3;                                   // 21:30–6:30
  }

  const all = [...abiertas, ...asignadas, ...en_proceso].sort((a, b) => {
    const aPrio = a.produccion_paro_cerrado === false ? 0 : 1;
    const bPrio = b.produccion_paro_cerrado === false ? 0 : 1;
    if (aPrio !== bPrio) return aPrio - bPrio;
    const tA = getTurnoNum(a.hora_solicitud), tB = getTurnoNum(b.hora_solicitud);
    if (tA !== tB) return tA - tB;
    return b.created_at.localeCompare(a.created_at);
  });

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="margin:0;font-size:18px">🚨 Urgencias activas</h2>
      <span style="font-size:12px;color:#6b7280">Actualiza cada 30s</span>
    </div>
    ${all.length === 0 ? `
      <div style="text-align:center;padding:48px;color:#6b7280;background:white;border-radius:10px;border:1px solid #e2e8f0">
        <div style="font-size:32px;margin-bottom:8px">✅</div>
        <div style="font-weight:600">Sin urgencias activas</div>
        <div style="font-size:13px;margin-top:4px">Todas las líneas operando normalmente</div>
      </div>` :
      all.map(o => ordenCard(o)).join('')
    }`;

  const isAdmin = ['admin','superadmin_mant'].includes(state.user.mant_role);
  if (isAdmin) {
    el.querySelectorAll('.btn-asignar').forEach(btn => {
      btn.onclick = () => modalAsignar(Number(btn.dataset.id));
    });
  }
  el.querySelectorAll('.btn-iniciar-proceso').forEach(btn => {
    btn.onclick = () => modalIniciarProceso(Number(btn.dataset.id));
  });
  el.querySelectorAll('.btn-cerrar-informe').forEach(btn => {
    btn.onclick = () => modalCerrarOrden(Number(btn.dataset.id));
  });
}

function getTurnoBadge(hora) {
  if (!hora) return '';
  const parts = hora.split(':');
  const mins = Number(parts[0]) * 60 + Number(parts[1] || 0);
  const turno = (mins >= 390 && mins < 870) ? 'T1' : (mins >= 870 && mins < 1290) ? 'T2' : 'T3';
  return `<span style="font-size:11px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;padding:1px 6px;color:#374151">${turno}</span>`;
}

function ordenCard(o) {
  const tiempoTranscurrido = o.created_at ? timeSince(o.created_at) : '—';
  const isAdmin = ['admin','superadmin_mant'].includes(state.user.mant_role);
  const role = state.user.mant_role;
  const descFalla = o.descripcion_falla || o.descripcion || '—';
  const row = (label, val) => val ? `<div style="display:flex;gap:6px;font-size:12px;margin-bottom:3px"><span style="color:#6b7280;min-width:110px">${label}:</span><span style="color:#111;font-weight:500">${val}</span></div>` : '';

  let subStatusBadge = '';
  let paroInfoHtml = '';
  if (o.produccion_paro_cerrado === false) {
    subStatusBadge = '<span class="urgencia-badge urgencia-alta" style="font-size:11px">⛔ Máquina parada</span>';
  } else if (o.produccion_paro_cerrado === true) {
    subStatusBadge = '<span class="urgencia-badge" style="background:#ede9fe;color:#5b21b6;font-size:11px">🔄 Reanudación de máquina</span>';
    if (o.produccion_paro_fecha_inicio) {
      const durMin = o.produccion_paro_fecha_fin
        ? Math.round((new Date(o.produccion_paro_fecha_fin) - new Date(o.produccion_paro_fecha_inicio)) / 60000)
        : null;
      const durStr = durMin !== null ? (durMin >= 60 ? `${Math.floor(durMin/60)}h ${durMin%60}m` : `${durMin}m`) : null;
      paroInfoHtml = `
        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;padding:8px;margin-top:8px;font-size:12px">
          ${row('Apertura paro', fmtDateTime(o.produccion_paro_fecha_inicio))}
          ${o.produccion_paro_fecha_fin ? row('Cierre paro', fmtDateTime(o.produccion_paro_fecha_fin)) : ''}
          ${durStr ? row('Duración paro', durStr) : ''}
        </div>`;
    }
  }

  // Reanudación = paro ya cerrado desde producción → técnico solo cierra el informe
  const esReanudacion = o.produccion_paro_cerrado === true;

  let actionBtns = '';
  if (isAdmin) {
    actionBtns += `<button class="btn-asignar btn-secondary" data-id="${o.id}" style="font-size:12px;padding:5px 10px">👤 Asignar técnico</button>`;
  }
  if (role !== 'supervisor_mant') {
    if (esReanudacion) {
      // Máquina ya reanudada desde producción → solo cerrar el informe
      actionBtns += `<button class="btn-cerrar-informe btn-primary" data-id="${o.id}" style="font-size:12px;padding:5px 10px;background:#16a34a;border-color:#16a34a">✅ Cerrar informe</button>`;
    } else if (['abierta','asignada'].includes(o.status)) {
      // Paro activo o sin vínculo → flujo normal: iniciar proceso
      actionBtns += `<button class="btn-iniciar-proceso btn-primary" data-id="${o.id}" style="font-size:12px;padding:5px 10px;background:#7c3aed;border-color:#7c3aed">▶ En proceso</button>`;
    } else if (o.status === 'en_proceso') {
      actionBtns += `<button class="btn-cerrar-informe btn-primary" data-id="${o.id}" style="font-size:12px;padding:5px 10px;background:#16a34a;border-color:#16a34a">✅ Cerrar informe</button>`;
    }
  }

  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:12px;border-left:4px solid ${esReanudacion?'#7c3aed':o.produccion_paro_cerrado===false?'#dc2626':o.nivel_urgencia==='alta'?'#dc2626':o.nivel_urgencia==='media'?'#f59e0b':'#22c55e'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:15px;margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${escHtml(o.folio)} — ${escHtml(o.equipo_nombre)}
            ${o.parte_nombre && o.parte_nombre!=='-' ? `<span style="color:#6b7280;font-size:12px"> / ${escHtml(o.parte_nombre)}</span>` : ''}
            ${getTurnoBadge(o.hora_solicitud)}
          </div>
          ${row('Línea', escHtml(o.departamento_nombre))}
          ${row('Solicitante', escHtml(o.solicitante_nombre || '—'))}
          ${row('Motivo del paro', escHtml(o.motivo_paro))}
          ${row('Descripción falla', escHtml(descFalla))}
          ${row('Apertura', `${fmtDate(o.fecha_solicitud)}${o.hora_solicitud ? ' ' + o.hora_solicitud : ''} · ⏱ ${tiempoTranscurrido}`)}
          ${o.diagnostico ? row('Diagnóstico', escHtml(o.diagnostico)) : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
            ${urgenciaBadge(o.nivel_urgencia)}
            ${statusBadge(o.status)}
            ${subStatusBadge}
            ${o.tecnico_nombre ? `<span style="font-size:12px;color:#2563eb">👤 ${escHtml(o.tecnico_nombre)}</span>` : '<span style="font-size:12px;color:#9ca3af">Sin asignar</span>'}
          </div>
          ${paroInfoHtml}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:130px">
          ${actionBtns}
        </div>
      </div>
    </div>`;
}

// ── VISTA: ÓRDENES (tabs para soloMias, tabla plana para todas) ───────────────
async function viewOrdenes(el, soloMias) {
  const role = state.user.mant_role;
  const isAdminRole = ['admin','superadmin_mant'].includes(role);
  const ordenes = await apiFetch('/ordenes');
  const tecnicos = isAdminRole ? await apiFetch('/tecnicos') : [];

  if (soloMias) {
    const title = role === 'supervisor_mant' ? '📋 Mis solicitudes' : '📋 Mis órdenes';
    const tabs = [
      { id: 'sin_atender', label: '⏳ Sin atender', statuses: ['abierta','asignada'] },
      { id: 'en_proceso',  label: '🟣 En proceso',  statuses: ['en_proceso'] },
      { id: 'cerradas',    label: '✅ Cerradas',     statuses: ['cerrada','en_validacion'] },
    ];
    if (!state._ordenesTab || !tabs.find(t => t.id === state._ordenesTab)) state._ordenesTab = 'sin_atender';

    const renderTabs = () => {
      const active = tabs.find(t => t.id === state._ordenesTab) || tabs[0];
      const filtered = ordenes.filter(o => active.statuses.includes(o.status));
      el.innerHTML = `
        <div style="margin-bottom:16px">
          <h2 style="margin:0 0 12px;font-size:18px">${title}</h2>
          <div style="display:flex;gap:0;border-bottom:2px solid #e2e8f0">
            ${tabs.map(t => {
              const count = ordenes.filter(o => t.statuses.includes(o.status)).length;
              const isAct = t.id === state._ordenesTab;
              return `<button class="tab-ord-btn" data-tab="${t.id}" style="background:none;border:none;border-bottom:2px solid ${isAct?'#2563eb':'transparent'};padding:8px 16px;font-size:13px;cursor:pointer;color:${isAct?'#2563eb':'#6b7280'};margin-bottom:-2px;font-weight:${isAct?'700':'400'}">${t.label} <span style="background:#f1f5f9;border-radius:10px;padding:1px 7px;font-size:11px">${count}</span></button>`;
            }).join('')}
          </div>
        </div>
        <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;overflow:hidden">
          <div id="ordenes-table-wrap">${renderOrdenesTable(filtered, tecnicos)}</div>
        </div>`;
      el.querySelectorAll('.tab-ord-btn').forEach(btn => {
        btn.onclick = () => { state._ordenesTab = btn.dataset.tab; renderTabs(); };
      });
      bindOrdenesTable(tecnicos);
    };
    renderTabs();
    return;
  }

  // Vista plana (todas las órdenes — admin / técnico)
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h2 style="margin:0;font-size:18px">📋 Todas las órdenes</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input id="f-text" placeholder="🔍 Buscar folio, equipo..." style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;width:220px"/>
        <select id="f-status" style="padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:13px">
          <option value="">Todos los estatus</option>
          <option value="abierta">Abierta</option><option value="asignada">Asignada</option>
          <option value="en_proceso">En proceso</option><option value="en_validacion">En validación</option><option value="cerrada">Cerrada</option>
        </select>
        <select id="f-tipo" style="padding:6px;border:1px solid #d1d5db;border-radius:6px;font-size:13px">
          <option value="">Todos los tipos</option>
          <option value="correctivo_urgente">Urgente (Producción)</option>
          <option value="correctivo_solicitud">Solicitud</option>
          <option value="programado">Programado</option>
        </select>
      </div>
    </div>
    <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;overflow:hidden">
      <div id="ordenes-table-wrap">${renderOrdenesTable(ordenes, tecnicos)}</div>
    </div>`;

  const reFilter = () => {
    const txt = (document.getElementById('f-text')?.value || '').toLowerCase();
    const st  = document.getElementById('f-status')?.value || '';
    const tp  = document.getElementById('f-tipo')?.value || '';
    const filtered = ordenes.filter(o =>
      (!st || o.status === st) &&
      (!tp || o.tipo === tp) &&
      (!txt || o.folio.toLowerCase().includes(txt) ||
        o.equipo_nombre.toLowerCase().includes(txt) ||
        (o.solicitante_nombre||'').toLowerCase().includes(txt) ||
        (o.descripcion_falla||'').toLowerCase().includes(txt))
    );
    document.getElementById('ordenes-table-wrap').innerHTML = renderOrdenesTable(filtered, tecnicos);
    bindOrdenesTable(tecnicos);
  };
  document.getElementById('f-text').oninput = reFilter;
  document.getElementById('f-status').onchange = reFilter;
  document.getElementById('f-tipo').onchange = reFilter;
  bindOrdenesTable(tecnicos);
}

function renderOrdenesTable(ordenes, tecnicos) {
  if (!ordenes.length) return '<div style="text-align:center;padding:32px;color:#9ca3af">Sin órdenes</div>';
  const isAdmin = ['admin','superadmin_mant'].includes(state.user.mant_role);
  const isSupervisor = state.user.mant_role === 'supervisor_mant';
  return `
    <table class="mant-table">
      <thead><tr>
        <th>Folio</th><th>Tipo</th><th>Equipo / Parte</th><th>Falla</th>
        <th>Solicitante</th><th>Fecha</th><th>Urgencia</th>
        <th>Técnico</th><th>Estatus</th><th>Acciones</th>
      </tr></thead>
      <tbody>
        ${ordenes.map(o => `
          <tr>
            <td style="font-family:monospace;font-size:11px;color:#2563eb">${escHtml(o.folio)}</td>
            <td style="font-size:11px">${o.tipo === 'correctivo_urgente' ? '🚨 Urgente' : o.tipo === 'programado' ? '🗓 Prog.' : '📝 Solicitud'}${o.origen_produccion ? `<br><span style="display:inline-block;margin-top:3px;font-size:10px;background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:1px 5px" title="Generada automáticamente desde producción">⚙ Auto</span>` : ''}</td>
            <td style="font-size:12px"><b>${escHtml(o.equipo_nombre)}</b>${o.parte_nombre&&o.parte_nombre!=='-'?`<br><span style="color:#6b7280">${escHtml(o.parte_nombre)}</span>`:''}</td>
            <td style="font-size:12px;max-width:200px">${(() => { const d = o.descripcion_falla || o.descripcion || ''; return escHtml(d.slice(0,90)) + (d.length>90?'…':''); })()}</td>
            <td style="font-size:12px">${escHtml(o.solicitante_nombre || '—')}</td>
            <td style="font-size:11px;white-space:nowrap">${fmtDate(o.fecha_solicitud)}${o.hora_solicitud ? `<br><span style="color:#6b7280">${escHtml(o.hora_solicitud)}</span>` : ''}</td>
            <td>${urgenciaBadge(o.nivel_urgencia)}</td>
            <td style="font-size:12px">${o.tecnico_nombre ? escHtml(o.tecnico_nombre) : '<span style="color:#9ca3af">—</span>'}</td>
            <td>${statusBadge(o.status)}</td>
            <td style="white-space:nowrap">
              <button class="btn-secondary btn-ver-orden" data-id="${o.id}" style="font-size:11px;padding:3px 8px" title="Ver detalle">🔍</button>
              ${isAdmin && !['cerrada','en_validacion','cancelada'].includes(o.status) ? `<button class="btn-secondary btn-asignar" data-id="${o.id}" style="font-size:11px;padding:3px 8px" title="Asignar técnico">👤</button>` : ''}
              ${!isSupervisor && ['abierta','asignada'].includes(o.status) ? `<button class="btn-primary btn-iniciar-proceso" data-id="${o.id}" style="font-size:11px;padding:3px 8px;background:#7c3aed;border-color:#7c3aed" title="Iniciar proceso">▶</button>` : ''}
              ${!isSupervisor && o.status==='en_proceso' ? `<button class="btn-primary btn-cerrar-informe" data-id="${o.id}" style="font-size:11px;padding:3px 8px;background:#16a34a;border-color:#16a34a" title="Cerrar informe">✅</button>` : ''}
              ${isSupervisor && o.status==='en_validacion' ? `<button class="btn-primary btn-validar-orden" data-id="${o.id}" style="font-size:11px;padding:3px 8px;background:#f59e0b;border-color:#f59e0b" title="Validar cierre">🔍 Val.</button>` : ''}
              <button class="btn-secondary btn-pdf-orden" data-id="${o.id}" style="font-size:11px;padding:3px 8px" title="Imprimir PDF">🖨</button>
              ${state.user.mant_role==='superadmin_mant' ? `<button class="btn-secondary btn-borrar-orden" data-id="${o.id}" data-folio="${escHtml(o.folio)}" style="font-size:11px;padding:3px 8px;color:#dc2626" title="Borrar orden">🗑</button>` : ''}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function bindOrdenesTable(tecnicos) {
  document.querySelectorAll('.btn-ver-orden').forEach(btn => {
    btn.onclick = () => modalDetalleOrden(Number(btn.dataset.id));
  });
  document.querySelectorAll('.btn-asignar').forEach(btn => {
    btn.onclick = () => modalAsignar(Number(btn.dataset.id));
  });
  document.querySelectorAll('.btn-iniciar-proceso').forEach(btn => {
    btn.onclick = () => modalIniciarProceso(Number(btn.dataset.id));
  });
  document.querySelectorAll('.btn-cerrar-informe').forEach(btn => {
    btn.onclick = () => modalCerrarOrden(Number(btn.dataset.id));
  });
  document.querySelectorAll('.btn-validar-orden').forEach(btn => {
    btn.onclick = () => modalValidarOrden(Number(btn.dataset.id));
  });
  document.querySelectorAll('.btn-pdf-orden').forEach(btn => {
    btn.onclick = () => generarPDFOrden(Number(btn.dataset.id));
  });
  document.querySelectorAll('.btn-borrar-orden').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(`¿Borrar orden ${btn.dataset.folio}? Esta acción no se puede deshacer.`)) return;
      await apiFetch(`/ordenes/${btn.dataset.id}`, { method: 'DELETE' });
      loadView(state.view);
    };
  });
}

// ── VISTA: NUEVA ORDEN (SUPERVISOR) ──────────────────────────────────────────
function viewNuevaOrden(el) {
  el.innerHTML = `
    <div style="max-width:600px">
      <h2 style="margin:0 0 20px;font-size:18px">➕ Nueva solicitud de mantenimiento</h2>
      <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;padding:24px">
        <div id="nueva-msg" style="display:none;padding:10px;border-radius:6px;margin-bottom:12px;font-size:13px"></div>
        <div class="mant-form-group"><label>Departamento solicitante *</label>
          <select id="n-dpto"><option value="">Cargando...</option></select>
        </div>
        <div class="mant-form-group"><label>Equipo *</label>
          <select id="n-equipo"><option value="">Cargando...</option></select>
        </div>
        <div class="mant-form-group" id="n-equipo-otro-wrap" style="display:none"><label>Nombre del equipo *</label>
          <input id="n-equipo-otro" type="text" placeholder="Especifica el nombre del equipo"/>
        </div>
        <div class="mant-form-group"><label>Parte del equipo</label>
          <select id="n-parte"><option value="">— Selecciona primero el equipo —</option></select>
        </div>
        <div class="mant-form-group" id="n-parte-otro-wrap" style="display:none"><label>Nombre de la parte</label>
          <input id="n-parte-otro" type="text" placeholder="Especifica el nombre de la parte"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="mant-form-group"><label>Fecha</label>
            <input id="n-fecha" type="date" value="${new Date().toISOString().slice(0,10)}"/>
          </div>
          <div class="mant-form-group"><label>Hora</label>
            <input id="n-hora" type="time" value="${new Date().toTimeString().slice(0,5)}"/>
          </div>
        </div>
        <div class="mant-form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input id="n-parada" type="checkbox" style="width:auto"/>
            ¿La máquina está parada?
          </label>
        </div>
        <div class="mant-form-group"><label>Descripción de la falla *</label>
          <textarea id="n-falla" placeholder="Describe el problema observado..."></textarea>
        </div>
        <div class="mant-form-group"><label>Nivel de urgencia</label>
          <select id="n-urgencia">
            <option value="alta">🔴 Alta</option>
            <option value="media" selected>🟡 Media</option>
            <option value="baja">🟢 Baja</option>
          </select>
        </div>
        <button id="n-submit" class="btn-primary" style="width:100%;padding:10px;font-size:14px">Enviar solicitud</button>
      </div>
    </div>`;

  apiFetch('/departamentos').then(dptos => {
    document.getElementById('n-dpto').innerHTML =
      '<option value="">— Selecciona departamento —</option>' +
      dptos.map(d => `<option value="${d.id}">${escHtml(d.nombre)}</option>`).join('');
  });

  apiFetch('/equipos').then(equipos => {
    const sel = document.getElementById('n-equipo');
    sel.innerHTML = '<option value="">— Selecciona equipo —</option>' +
      equipos.map(e => `<option value="${e.id}">${escHtml(e.nombre)}</option>`).join('') +
      '<option value="otro">Otro (especificar)...</option>';
    sel.onchange = () => {
      const id = sel.value;
      const otroWrap = document.getElementById('n-equipo-otro-wrap');
      const pSel = document.getElementById('n-parte');
      const pOtroWrap = document.getElementById('n-parte-otro-wrap');
      otroWrap.style.display = id === 'otro' ? '' : 'none';
      pOtroWrap.style.display = 'none';
      if (id === 'otro') {
        pSel.innerHTML = '<option value="">— Sin parte específica —</option><option value="otro">Otro (especificar)...</option>';
        pSel.onchange = () => { pOtroWrap.style.display = pSel.value === 'otro' ? '' : 'none'; };
        return;
      }
      pSel.innerHTML = '<option value="">Cargando...</option>';
      if (!id) { pSel.innerHTML = '<option value="">— Selecciona equipo primero —</option>'; return; }
      apiFetch(`/equipos/${id}/partes`).then(partes => {
        pSel.innerHTML = '<option value="">— Sin parte específica —</option>' +
          partes.map(p => `<option value="${p.id}">${escHtml(p.nombre)}</option>`).join('') +
          '<option value="otro">Otro (especificar)...</option>';
        pSel.onchange = () => { pOtroWrap.style.display = pSel.value === 'otro' ? '' : 'none'; };
      });
    };
  });

  document.getElementById('n-submit').onclick = async () => {
    const msg = document.getElementById('nueva-msg');
    const equipoVal = document.getElementById('n-equipo').value;
    const parteVal  = document.getElementById('n-parte').value;
    const body = {
      departamento_id:  document.getElementById('n-dpto').value || null,
      equipo_id:        equipoVal,
      equipo_custom:    equipoVal === 'otro' ? (document.getElementById('n-equipo-otro').value.trim() || null) : null,
      parte_equipo_id:  (parteVal && parteVal !== 'otro') ? parteVal : null,
      parte_custom:     parteVal === 'otro' ? (document.getElementById('n-parte-otro').value.trim() || null) : null,
      fecha_solicitud:  document.getElementById('n-fecha').value,
      hora_solicitud:   document.getElementById('n-hora').value,
      maquina_parada:   document.getElementById('n-parada').checked,
      descripcion_falla: document.getElementById('n-falla').value.trim(),
      nivel_urgencia:   document.getElementById('n-urgencia').value,
    };
    if (!body.departamento_id || !body.equipo_id || !body.descripcion_falla) {
      msg.style.cssText = 'display:block;background:#fef2f2;color:#dc2626;border:1px solid #fca5a5';
      msg.textContent = 'Departamento, equipo y descripción son requeridos'; return;
    }
    if (body.equipo_id === 'otro' && !body.equipo_custom) {
      msg.style.cssText = 'display:block;background:#fef2f2;color:#dc2626;border:1px solid #fca5a5';
      msg.textContent = 'Especifica el nombre del equipo'; return;
    }
    // Capturar nombres de display antes de que el form desaparezca
    const equipoNombre = equipoVal === 'otro'
      ? (body.equipo_custom || 'Otro')
      : (document.getElementById('n-equipo').options[document.getElementById('n-equipo').selectedIndex]?.text || '—');
    const dptoNombre = document.getElementById('n-dpto').options[document.getElementById('n-dpto').selectedIndex]?.text || '—';
    const parteNombre = (() => {
      const pv = document.getElementById('n-parte').value;
      if (!pv || pv === '') return '—';
      if (pv === 'otro') return body.parte_custom || 'Otra';
      return document.getElementById('n-parte').options[document.getElementById('n-parte').selectedIndex]?.text || '—';
    })();
    try {
      const orden = await apiFetch('/ordenes', { method: 'POST', body: JSON.stringify(body) });
      _mostrarPanelEnvioOT(el, orden, { equipo_nombre: equipoNombre, dpto_nombre: dptoNombre, parte_nombre: parteNombre });
    } catch (e) {
      msg.style.cssText = 'display:block;background:#fef2f2;color:#dc2626;border:1px solid #fca5a5';
      msg.textContent = e.message;
    }
  };
}

// ── PANEL DE ENVÍO POST-CREACIÓN ──────────────────────────────────────────────
function _mostrarPanelEnvioOT(el, orden, info) {
  const urgLabel = { alta: '🔴 ALTA', media: '🟡 MEDIA', baja: '🟢 BAJA' }[orden.nivel_urgencia] || (orden.nivel_urgencia || '').toUpperCase();
  el.innerHTML = `
    <div style="max-width:600px">
      <h2 style="margin:0 0 20px;font-size:18px">➕ Nueva solicitud de mantenimiento</h2>
      <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;padding:24px">
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin-bottom:20px;text-align:center">
          <div style="font-size:28px;margin-bottom:6px">✅</div>
          <div style="font-weight:700;color:#15803d;font-size:15px">¡Solicitud creada exitosamente!</div>
          <div style="font-size:13px;color:#166534;margin-top:4px">Folio: <strong>${escHtml(orden.folio)}</strong></div>
        </div>
        <p style="font-size:13px;color:#374151;margin:0 0 16px">Notifica al área de mantenimiento por correo o WhatsApp:</p>

        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:10px">
          <div style="font-weight:600;font-size:13px;margin-bottom:8px">📧 Enviar por correo electrónico</div>
          <div style="display:flex;gap:8px">
            <input id="env-correo-dest" type="email" placeholder="mantenimiento@empresa.com"
              style="flex:1;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px"/>
            <button id="btn-env-correo" class="btn-secondary" style="white-space:nowrap;padding:6px 14px;font-size:13px">Enviar 📧</button>
          </div>
        </div>

        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:20px">
          <div style="font-weight:600;font-size:13px;margin-bottom:8px">📱 Enviar por WhatsApp</div>
          <div style="display:flex;gap:8px;margin-bottom:6px">
            <input id="env-wa-num" type="tel" placeholder="521XXXXXXXXXX (con código de país)"
              style="flex:1;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px"/>
            <button id="btn-env-wa" class="btn-secondary" style="white-space:nowrap;padding:6px 14px;font-size:13px">Enviar 📱</button>
          </div>
          <div style="font-size:11px;color:#6b7280">El PDF se descargará automáticamente para que lo adjuntes en WhatsApp</div>
        </div>

        <div style="display:flex;gap:8px">
          <button id="btn-env-pdf" class="btn-secondary" style="flex:1;padding:9px;font-size:13px">🖨 Descargar PDF</button>
          <button id="btn-ver-sols" class="btn-primary" style="flex:1;padding:9px;font-size:13px">Ver mis solicitudes →</button>
        </div>
      </div>
    </div>`;

  const emailSubject = `Solicitud de Mantenimiento ${orden.folio}`;
  const emailBody = [
    `Se generó la solicitud de mantenimiento ${orden.folio}.`,
    ``,
    `── Datos de la solicitud ───────────────────────`,
    `Folio:            ${orden.folio}`,
    `Fecha / Hora:     ${orden.fecha_solicitud || '—'}  ${orden.hora_solicitud || ''}`,
    `Departamento:     ${info.dpto_nombre || '—'}`,
    `Solicitante:      ${orden.solicitante_nombre || '—'}`,
    `Equipo:           ${info.equipo_nombre || '—'}`,
    `Parte del equipo: ${info.parte_nombre && info.parte_nombre !== '—' ? info.parte_nombre : '—'}`,
    `Urgencia:         ${urgLabel}`,
    `Máquina parada:   ${orden.maquina_parada ? 'SÍ' : 'NO'}`,
    `────────────────────────────────────────────────`,
    `Descripción de la falla:`,
    orden.descripcion_falla || '—',
    ``,
    `Por favor atender a la brevedad posible.`,
  ].join('\n');

  const waMsg = [
    `*SOLICITUD DE MANTENIMIENTO*`,
    `Folio: *${orden.folio}*`,
    ``,
    `📅 ${orden.fecha_solicitud || '—'} ${orden.hora_solicitud || ''}`,
    `🏭 Departamento: ${info.dpto_nombre || '—'}`,
    `👤 Solicitante: ${orden.solicitante_nombre || '—'}`,
    `⚙️ Equipo: ${info.equipo_nombre || '—'}`,
    ...(info.parte_nombre && info.parte_nombre !== '—' ? [`🔩 Parte: ${info.parte_nombre}`] : []),
    `⚠️ Urgencia: ${urgLabel}`,
    `🔴 Máquina parada: ${orden.maquina_parada ? 'SÍ' : 'NO'}`,
    ``,
    `📋 *Descripción:*`,
    orden.descripcion_falla || '—',
    ``,
    `Por favor atender a la brevedad posible.`,
  ].join('\n');

  document.getElementById('btn-env-correo').onclick = () => {
    const dest = document.getElementById('env-correo-dest').value.trim();
    if (!dest) { alert('Ingresa el correo destino'); return; }
    const url = `mailto:${encodeURIComponent(dest)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.open(url, '_blank');
  };

  document.getElementById('btn-env-wa').onclick = async () => {
    let num = document.getElementById('env-wa-num').value.trim().replace(/\D/g, '');
    if (!num) { alert('Ingresa el número de WhatsApp'); return; }
    if (!num.startsWith('52')) num = '52' + num;
    await generarPDFOrden(orden.id, true);
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(waMsg)}`, '_blank');
  };

  document.getElementById('btn-env-pdf').onclick = () => generarPDFOrden(orden.id, true);
  document.getElementById('btn-ver-sols').onclick = () => { state.view = 'mis-ordenes'; renderApp(); };
}

// ── VISTA: PLAN SEMANAL (ADMIN) ───────────────────────────────────────────────
async function viewSemana(el) {
  const [ordenes, tecnicos] = await Promise.all([
    apiFetch('/ordenes?status=abierta'),
    apiFetch('/tecnicos'),
  ]);
  const asignadas = await apiFetch('/ordenes?status=asignada');
  const todas = [...ordenes, ...asignadas];

  // Agrupar por técnico
  const sinAsignar = todas.filter(o => !o.tecnico_asignado_id);
  const porTecnico = {};
  tecnicos.forEach(t => { porTecnico[t.id] = { tecnico: t, ordenes: [] }; });
  todas.filter(o => o.tecnico_asignado_id).forEach(o => {
    if (porTecnico[o.tecnico_asignado_id]) porTecnico[o.tecnico_asignado_id].ordenes.push(o);
  });

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="margin:0;font-size:18px">📅 Plan semanal de trabajo</h2>
      <span style="font-size:12px;color:#6b7280">Órdenes activas · asigna técnico desde aquí</span>
    </div>

    ${sinAsignar.length ? `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-bottom:16px">
      <div style="font-weight:700;color:#92400e;margin-bottom:8px">⏳ Sin asignar (${sinAsignar.length})</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${sinAsignar.map(o => `
          <div style="background:white;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;font-size:12px;min-width:200px;cursor:pointer" class="btn-orden-sin-asignar" data-id="${o.id}">
            <b>${escHtml(o.folio)}</b> · ${escHtml(o.equipo_nombre)}<br>
            ${urgenciaBadge(o.nivel_urgencia)}&nbsp;
            <button class="btn-secondary btn-asignar" data-id="${o.id}" style="font-size:11px;padding:2px 8px;margin-top:4px">👤 Asignar</button>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">
      ${tecnicos.map(t => {
        const ords = (porTecnico[t.id]?.ordenes || []);
        const pct = ords.length ? Math.round(ords.filter(o=>o.status==='cerrada').length / ords.length * 100) : 0;
        return `
          <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <div style="font-weight:700;font-size:14px">👤 ${escHtml(t.full_name)}</div>
              <span style="font-size:11px;background:#f1f5f9;padding:2px 8px;border-radius:10px">${ords.length} órdenes</span>
            </div>
            ${ords.length === 0 ?
              '<div style="text-align:center;padding:16px;color:#9ca3af;font-size:12px">Sin órdenes asignadas</div>' :
              ords.map(o => `
                <div style="border:1px solid #f1f5f9;border-radius:6px;padding:8px;margin-bottom:6px;font-size:12px;border-left:3px solid ${o.nivel_urgencia==='alta'?'#dc2626':o.nivel_urgencia==='media'?'#f59e0b':'#22c55e'}">
                  <div style="font-weight:600">${escHtml(o.folio)} · ${escHtml(o.equipo_nombre)}</div>
                  <div style="color:#6b7280;margin-top:2px">${escHtml((o.descripcion_falla||'').slice(0,60))}</div>
                  <div style="margin-top:4px;display:flex;gap:4px">${urgenciaBadge(o.nivel_urgencia)} ${statusBadge(o.status)}</div>
                </div>`).join('')
            }
          </div>`;
      }).join('')}
    </div>`;

  document.querySelectorAll('.btn-orden-sin-asignar').forEach(card => {
    card.onclick = (e) => {
      if (e.target.classList.contains('btn-asignar')) return; // deja que el botón maneje
      modalDetalleOrden(Number(card.dataset.id));
    };
  });
  document.querySelectorAll('.btn-asignar').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); modalAsignar(Number(btn.dataset.id)); };
  });
}

// ── VISTA: PROGRAMADOS + GANTT ────────────────────────────────────────────────
async function viewProgramados(el) {
  const now = new Date();
  const vp = { anio: now.getFullYear(), mes: now.getMonth() + 1, tab: 'ordenes', ordenes: [], programados: [], tecnicos: [] };

  const [progs, tecs] = await Promise.all([apiFetch('/programados?all=1'), apiFetch('/tecnicos')]);
  vp.programados = progs;
  vp.tecnicos = tecs;

  async function reloadOrdenes() {
    try { vp.ordenes = await apiFetch(`/ordenes/mes?anio=${vp.anio}&mes=${vp.mes}`); }
    catch { vp.ordenes = []; }
  }

  function getMesLabel() {
    return new Date(vp.anio, vp.mes - 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  }

  const freqLabel = { diario:'Diario', semanal:'Semanal', quincenal:'Quincenal', mensual:'Mensual', trimestral:'Trimestral', semestral:'Semestral', anual:'Anual', personalizado:'Personalizado' };
  const stBg  = { abierta:'#fef3c7', asignada:'#dbeafe', cerrada:'#dcfce7', cancelada:'#f1f5f9', en_proceso:'#ede9fe' };
  const stTxt = { abierta:'#92400e', asignada:'#1e40af', cerrada:'#15803d', cancelada:'#6b7280', en_proceso:'#5b21b6' };
  const stLbl = { abierta:'⏳ Pendiente', asignada:'🔵 Asignada', cerrada:'✅ Cerrada', cancelada:'✖ Cancelada', en_proceso:'🟣 En proceso' };

  function renderVP() {
    const { tab, ordenes, programados } = vp;
    const nm = getMesLabel();
    const total = ordenes.length;
    const pendientes = ordenes.filter(o => o.status === 'abierta').length;
    const asignadas  = ordenes.filter(o => o.status === 'asignada').length;
    const cerradas   = ordenes.filter(o => o.status === 'cerrada').length;

    const rowsOrdenes = ordenes.map(o => `
      <tr style="border-top:1px solid #f1f5f9">
        <td style="padding:8px 10px;font-size:13px;white-space:nowrap;color:${o.aplazado?'#d97706':'#374151'}" title="${o.aplazado?'Aplazada. Original: '+(o.fecha_programada_original||''):''}">
          ${fmtDate(o.fecha_programada)}${o.aplazado?' 📅':''}
        </td>
        <td style="padding:8px 10px;font-size:13px;font-weight:600">${escHtml(o.equipo_nombre)}</td>
        <td style="padding:8px 10px;font-size:13px">${escHtml(o.descripcion_falla||'—')}</td>
        <td style="padding:8px 10px;font-size:12px;color:#9ca3af">${escHtml(o.prog_frecuencia?freqLabel[o.prog_frecuencia]||o.prog_frecuencia:'—')}</td>
        <td style="padding:8px 10px;font-size:13px;color:${o.tecnico_nombre?'#374151':'#9ca3af'}">${escHtml(o.tecnico_nombre||'Sin asignar')}</td>
        <td style="padding:8px 10px">
          <span style="background:${stBg[o.status]||'#f1f5f9'};color:${stTxt[o.status]||'#6b7280'};padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600">
            ${stLbl[o.status]||o.status}
          </span>
        </td>
        <td style="padding:8px 10px;white-space:nowrap;display:flex;gap:4px">
          ${['abierta','asignada'].includes(o.status) ? `
            <button class="btn-secondary vp-asignar" data-id="${o.id}" style="font-size:11px;padding:3px 8px" title="${o.tecnico_nombre?'Reasignar':'Asignar'}">👤</button>
            <button class="btn-secondary vp-aplazar" data-id="${o.id}" style="font-size:11px;padding:3px 8px" title="Aplazar">📅</button>
            <button class="btn-secondary vp-cancelar" data-id="${o.id}" data-prog-id="${o.programado_id||''}" style="font-size:11px;padding:3px 8px;color:#dc2626" title="Cancelar">✖</button>
          ` : ''}
        </td>
      </tr>`).join('');

    const rowsCatalogo = programados.map(p => `
      <tr style="border-top:1px solid #f1f5f9;opacity:${p.status==='activo'?1:.55}">
        <td style="padding:8px 10px;font-size:13px;font-weight:600">${escHtml(p.equipo_nombre)}</td>
        <td style="padding:8px 10px;font-size:13px">${escHtml(p.tarea)}</td>
        <td style="padding:8px 10px;font-size:12px">${freqLabel[p.frecuencia]||p.frecuencia}${p.frecuencia==='personalizado'?` (${p.dias_intervalo}d)`:''}</td>
        <td style="padding:8px 10px;font-size:13px;color:${p.vencido?'#dc2626':p.proximo?'#d97706':'#374151'}">${fmtDate(p.proxima_fecha)}</td>
        <td style="padding:8px 10px;font-size:13px;color:${p.tecnico_nombre?'#374151':'#9ca3af'}">${escHtml(p.tecnico_nombre||'—')}</td>
        <td style="padding:8px 10px">
          <span style="background:${p.status==='activo'?'#dcfce7':'#f1f5f9'};color:${p.status==='activo'?'#15803d':'#6b7280'};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">
            ${p.status==='activo'?'Activo':'Inactivo'}
          </span>
        </td>
        <td style="padding:8px 10px;white-space:nowrap">
          <button class="btn-secondary vp-toggle-prog" data-id="${p.id}" data-status="${p.status}" style="font-size:11px;padding:3px 8px">${p.status==='activo'?'Pausar':'Activar'}</button>
        </td>
      </tr>`).join('');

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0;font-size:18px">🗓 Programados</h2>
        <div style="display:flex;gap:6px">
          <button id="vp-tab-ord" class="${tab==='ordenes'?'btn-primary':'btn-secondary'}" style="font-size:12px;padding:5px 12px">📋 Órdenes del mes</button>
          <button id="vp-tab-cat" class="${tab==='catalogo'?'btn-primary':'btn-secondary'}" style="font-size:12px;padding:5px 12px">📂 Catálogo de actividades</button>
        </div>
      </div>

      ${tab === 'ordenes' ? `
      <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;overflow:hidden">
        <div style="padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <button id="vp-prev" class="btn-secondary" style="padding:4px 12px;font-size:16px;line-height:1">‹</button>
            <span style="font-size:15px;font-weight:700;text-transform:capitalize;min-width:160px;text-align:center">${nm}</span>
            <button id="vp-next" class="btn-secondary" style="padding:4px 12px;font-size:16px;line-height:1">›</button>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:12px;color:#6b7280">${total} total · <span style="color:#92400e">${pendientes} pend.</span> · <span style="color:#1e40af">${asignadas} asig.</span> · <span style="color:#15803d">${cerradas} cerr.</span></span>
            <button id="vp-generar" class="btn-primary" style="font-size:12px;padding:5px 12px">⚙️ Generar órdenes del mes</button>
          </div>
        </div>
        ${rowsOrdenes ? `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead style="background:#f8fafc">
              <tr style="font-size:11px;color:#6b7280;text-transform:uppercase">
                <th style="padding:8px 10px;text-align:left">Fecha</th>
                <th style="padding:8px 10px;text-align:left">Equipo</th>
                <th style="padding:8px 10px;text-align:left">Tarea</th>
                <th style="padding:8px 10px;text-align:left">Frecuencia</th>
                <th style="padding:8px 10px;text-align:left">Técnico</th>
                <th style="padding:8px 10px;text-align:left">Estado</th>
                <th style="padding:8px 10px;text-align:left">Acciones</th>
              </tr>
            </thead>
            <tbody>${rowsOrdenes}</tbody>
          </table>
        </div>` : `
        <div style="text-align:center;padding:36px;color:#9ca3af">
          <div style="font-size:36px;margin-bottom:10px">🗓</div>
          <p style="font-size:14px;margin:0 0 6px">No hay órdenes generadas para ${nm}.</p>
          <p style="font-size:12px;color:#9ca3af">Presiona <strong>Generar órdenes del mes</strong> para crear las OTs basadas en las actividades del catálogo.</p>
        </div>`}
      </div>` : `
      <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;overflow:hidden">
        <div style="padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:14px;font-weight:700">Actividades periódicas — ${programados.filter(p=>p.status==='activo').length} activas</span>
          <button id="vp-nuevo" class="btn-primary" style="font-size:12px;padding:5px 12px">➕ Nueva actividad</button>
        </div>
        ${rowsCatalogo ? `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead style="background:#f8fafc">
              <tr style="font-size:11px;color:#6b7280;text-transform:uppercase">
                <th style="padding:8px 10px;text-align:left">Equipo</th>
                <th style="padding:8px 10px;text-align:left">Tarea</th>
                <th style="padding:8px 10px;text-align:left">Frecuencia</th>
                <th style="padding:8px 10px;text-align:left">Próxima fecha</th>
                <th style="padding:8px 10px;text-align:left">Técnico resp.</th>
                <th style="padding:8px 10px;text-align:left">Estado</th>
                <th style="padding:8px 10px"></th>
              </tr>
            </thead>
            <tbody>${rowsCatalogo}</tbody>
          </table>
        </div>` : `
        <div style="text-align:center;padding:36px;color:#9ca3af">
          <p>Sin actividades programadas. Agrega una nueva actividad.</p>
        </div>`}
      </div>`}
    `;

    // Tabs
    document.getElementById('vp-tab-ord').onclick = async () => { vp.tab='ordenes'; await reloadOrdenes(); renderVP(); bindVP(); };
    document.getElementById('vp-tab-cat').onclick = async () => { vp.tab='catalogo'; vp.programados = await apiFetch('/programados?all=1'); renderVP(); bindVP(); };
    bindVP();
  }

  function bindVP() {
    const onDone = async () => { await reloadOrdenes(); renderVP(); bindVP(); };

    if (vp.tab === 'ordenes') {
      document.getElementById('vp-prev').onclick = async () => {
        vp.mes--; if (vp.mes < 1) { vp.mes = 12; vp.anio--; }
        await onDone();
      };
      document.getElementById('vp-next').onclick = async () => {
        vp.mes++; if (vp.mes > 12) { vp.mes = 1; vp.anio++; }
        await onDone();
      };
      document.getElementById('vp-generar').onclick = async () => {
        const btn = document.getElementById('vp-generar');
        btn.disabled = true; btn.textContent = 'Generando...';
        try {
          const r = await apiFetch('/programados/generar-mes', { method:'POST', body: JSON.stringify({ anio: vp.anio, mes: vp.mes }) });
          vp.ordenes = r.ordenes;
          if (r.created > 0) alert(`✅ ${r.created} nueva(s) orden(es) generada(s).`);
          else alert(`ℹ️ Sin cambios. Todas las órdenes del mes ya existían.`);
          renderVP(); bindVP();
        } catch(e) { alert('Error: ' + e.message); btn.disabled = false; btn.textContent = '⚙️ Generar órdenes del mes'; }
      };
      el.querySelectorAll('.vp-asignar').forEach(btn => btn.onclick = () => modalAsignarProgramada(Number(btn.dataset.id), vp, onDone));
      el.querySelectorAll('.vp-aplazar').forEach(btn => btn.onclick = () => modalAplazarProgramada(Number(btn.dataset.id), vp, onDone));
      el.querySelectorAll('.vp-cancelar').forEach(btn => btn.onclick = () => modalCancelarProgramada(Number(btn.dataset.id), Number(btn.dataset.progId)||null, vp, onDone));
    } else {
      document.getElementById('vp-nuevo').onclick = () => modalNuevoProgramado();
      el.querySelectorAll('.vp-toggle-prog').forEach(btn => {
        btn.onclick = async () => {
          const newStatus = btn.dataset.status === 'activo' ? 'inactivo' : 'activo';
          try {
            await apiFetch(`/programados/${btn.dataset.id}`, { method:'PATCH', body: JSON.stringify({ status: newStatus }) });
            vp.programados = await apiFetch('/programados?all=1');
            renderVP(); bindVP();
          } catch(e) { alert('Error: ' + e.message); }
        };
      });
    }
  }

  await reloadOrdenes();
  renderVP();
  bindVP();
}

function renderGantt(items, dias, anio, mes) {
  if (!items.length) return '<div style="text-align:center;padding:32px;color:#9ca3af">Sin mantenimientos programados</div>';
  const hoy = new Date().toISOString().slice(0, 10);
  const pad = n => String(n).padStart(2,'0');

  return `
    <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;overflow:hidden">
      <div style="padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:12px;color:#6b7280">
        <span style="margin-right:16px"><span style="background:#22c55e;display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle"></span> Ejecutado</span>
        <span style="margin-right:16px"><span style="background:#3b82f6;display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle"></span> Próximo (≤3 días)</span>
        <span style="margin-right:16px"><span style="background:#dc2626;display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle"></span> Vencido</span>
        <span><span style="background:#e2e8f0;display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle"></span> Programado</span>
      </div>
      <div style="overflow-x:auto">
        <table style="border-collapse:collapse;font-size:11px;min-width:800px;width:100%">
          <thead>
            <tr style="background:#f8fafc">
              <th style="padding:8px 12px;text-align:left;border-right:1px solid #e2e8f0;white-space:nowrap;min-width:200px">Equipo / Tarea</th>
              ${dias.map(d => {
                const fecha = `${anio}-${pad(mes+1)}-${pad(d)}`;
                const esHoy = fecha === hoy;
                return `<th style="padding:4px;text-align:center;width:28px;border-right:1px solid #f1f5f9;${esHoy?'background:#dbeafe;':''}font-weight:${esHoy?'700':'400'}">${d}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${items.map(p => {
              const ult = p.fecha_ultimo_mant;
              const prox = p.proxima_fecha;
              return `
                <tr>
                  <td style="padding:8px 12px;border-right:1px solid #e2e8f0;border-top:1px solid #f1f5f9;white-space:nowrap">
                    <div style="font-weight:600">${escHtml(p.equipo_nombre)}</div>
                    <div style="color:#6b7280;font-size:10px">${escHtml(p.tarea)}</div>
                    <div style="color:#9ca3af;font-size:10px">${p.frecuencia}</div>
                  </td>
                  ${dias.map(d => {
                    const fecha = `${anio}-${pad(mes+1)}-${pad(d)}`;
                    let cls = '', title = '';
                    if (ult && ult.slice(0,10) === fecha) { cls = 'gantt-bar-ok'; title = 'Último mantenimiento'; }
                    else if (prox && prox === fecha && p.vencido) { cls = 'gantt-bar-vencido'; title = 'Vencido!'; }
                    else if (prox && prox === fecha && p.proximo) { cls = 'gantt-bar-prox'; title = 'Próximo'; }
                    else if (prox && prox === fecha) { cls = 'gantt-bar-futuro'; title = 'Programado'; }
                    return `<td style="border-right:1px solid #f1f5f9;border-top:1px solid #f1f5f9;text-align:center;padding:4px">
                      ${cls ? `<div class="gantt-bar ${cls}" title="${title}" style="cursor:pointer" onclick="alert('${escHtml(p.tarea)} · ${escHtml(p.equipo_nombre)} · ${fecha}')"></div>` : ''}
                    </td>`;
                  }).join('')}
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderCalendario(items, anio, mes) {
  const pad = n => String(n).padStart(2,'0');
  const primerDia = new Date(anio, mes, 1).getDay();
  const diasMes = new Date(anio, mes + 1, 0).getDate();
  const hoy = new Date().toISOString().slice(0, 10);
  const nombreMes = new Date(anio, mes).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

  // Indexar programados por fecha
  const porFecha = {};
  items.forEach(p => {
    if (p.proxima_fecha) {
      const f = p.proxima_fecha;
      if (!porFecha[f]) porFecha[f] = [];
      porFecha[f].push(p);
    }
    if (p.fecha_ultimo_mant) {
      const f = p.fecha_ultimo_mant.slice(0,10);
      if (!porFecha[f]) porFecha[f] = [];
      if (!porFecha[f].find(x => x.id === p.id)) porFecha[f].push({ ...p, _ejecutado: true });
    }
  });

  const dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  let celdas = '<td colspan="' + primerDia + '"></td>';
  for (let d = 1; d <= diasMes; d++) {
    const fecha = `${anio}-${pad(mes+1)}-${pad(d)}`;
    const esHoy = fecha === hoy;
    const eventos = porFecha[fecha] || [];
    celdas += `
      <td style="border:1px solid #e2e8f0;padding:4px 6px;vertical-align:top;min-width:100px;${esHoy?'background:#eff6ff':''};height:80px">
        <div style="font-weight:${esHoy?'700':'400'};font-size:12px;margin-bottom:4px;color:${esHoy?'#2563eb':'#374151'}">${d}</div>
        ${eventos.map(e => `
          <div style="background:${e._ejecutado?'#dcfce7':e.vencido?'#fee2e2':e.proximo?'#dbeafe':'#f1f5f9'};
               color:${e._ejecutado?'#15803d':e.vencido?'#dc2626':e.proximo?'#1d4ed8':'#374151'};
               font-size:10px;border-radius:3px;padding:2px 4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
               title="${escHtml(e.tarea)} · ${escHtml(e.equipo_nombre)}">
            ${e._ejecutado?'✅':'🔧'} ${escHtml(e.tarea.slice(0,20))}
          </div>`).join('')}
      </td>`;
    if (new Date(anio, mes, d).getDay() === 6) celdas += '</tr><tr>';
  }

  return `
    <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;overflow:hidden">
      <div style="padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:14px;text-transform:capitalize">${nombreMes}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>${dias.map(d=>`<th style="padding:8px;text-align:center;background:#f8fafc;border:1px solid #e2e8f0;font-size:11px">${d}</th>`).join('')}</tr></thead>
        <tbody><tr>${celdas}</tr></tbody>
      </table>
    </div>`;
}

// ── VISTA: KPIs ───────────────────────────────────────────────────────────────
async function viewKpis(el) {
  const desde = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  const hasta = new Date().toISOString().slice(0,10);
  const kpi = await apiFetch(`/kpis?desde=${desde}&hasta=${hasta}`);
  const { totales, tiempos, por_equipo, por_tecnico } = kpi;

  el.innerHTML = `
    <h2 style="margin:0 0 16px;font-size:18px">📊 KPIs — últimos 30 días</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px">
      ${kpiCard('Total órdenes', totales.total, '#6366f1')}
      ${kpiCard('Abiertas', totales.abiertas, '#dc2626')}
      ${kpiCard('Cerradas', totales.cerradas, '#16a34a')}
      ${kpiCard('Urgentes', totales.urgentes, '#f59e0b')}
      ${kpiCard('Programados', totales.programados, '#3b82f6')}
      ${kpiCard('T. prom. cierre', tiempos.promedio_cierre_min + ' min', '#8b5cf6')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;flex-wrap:wrap">
      <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;padding:16px">
        <div style="font-weight:700;margin-bottom:12px;font-size:14px">🏭 Top equipos con fallas</div>
        ${por_equipo.slice(0,8).map(e => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f1f5f9">
            <span style="font-size:13px">${escHtml(e.nombre)}</span>
            <span style="background:#f1f5f9;border-radius:10px;padding:2px 10px;font-size:12px;font-weight:700">${e.total}</span>
          </div>`).join('')}
      </div>

      <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;padding:16px">
        <div style="font-weight:700;margin-bottom:12px;font-size:14px">👤 Desempeño por técnico</div>
        ${por_tecnico.map(t => `
          <div style="padding:8px 0;border-bottom:1px solid #f1f5f9">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
              <span>${escHtml(t.nombre)}</span>
              <span>${t.cerradas}/${t.asignadas} · <b>${t.pct}%</b></span>
            </div>
            <div style="background:#e2e8f0;border-radius:3px;height:6px">
              <div style="background:${t.pct>=80?'#22c55e':t.pct>=50?'#f59e0b':'#dc2626'};height:6px;border-radius:3px;width:${t.pct}%"></div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

function kpiCard(label, value, color) {
  return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:16px;border-top:3px solid ${color}">
      <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">${label}</div>
      <div style="font-size:24px;font-weight:800;color:${color}">${value}</div>
    </div>`;
}

// ── VISTA: CATÁLOGOS ──────────────────────────────────────────────────────────
async function viewCatalogos(el) {
  const [equipos, settings] = await Promise.all([
    apiFetch('/equipos?all=1'),
    apiFetch('/settings'),
  ]);
  const cfg = settings || {};
  el.innerHTML = `
    <h2 style="margin:0 0 16px;font-size:18px">⚙️ Catálogos y Configuración</h2>

    <!-- Configuración de integración -->
    <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;padding:16px;margin-bottom:16px">
      <b style="font-size:14px;display:block;margin-bottom:12px">🔗 Integración con Producción</b>
      <div style="display:flex;flex-direction:column;gap:12px">
        <label style="display:flex;align-items:center;gap:12px;cursor:pointer;font-size:13px">
          <input type="checkbox" id="cfg-integ-prod" ${cfg.integracion_produccion_activa ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
          <span><strong>Integración producción activa</strong><br><span style="color:#6b7280;font-size:11px">Cuando un paro tenga motivo "afecta eficiencia", se generará automáticamente una OT de mantenimiento desde el formulario de producción.</span></span>
        </label>
        <label style="display:flex;align-items:center;gap:12px;cursor:pointer;font-size:13px">
          <input type="checkbox" id="cfg-alerta-piz" ${cfg.alerta_pizarron_activa ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
          <span><strong>Alerta en pizarrón</strong><br><span style="color:#6b7280;font-size:11px">Muestra alerta con sonido en /pizarron/vista cuando hay una línea parada por mantenimiento.</span></span>
        </label>
        <button id="btn-guardar-cfg" class="btn-primary" style="align-self:flex-start;font-size:13px;padding:7px 16px">Guardar configuración</button>
        <span id="cfg-msg" style="font-size:12px;color:#059669;display:none">✅ Configuración guardada</span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <!-- Equipos -->
      <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <b style="font-size:14px">🏭 Equipos</b>
          <button class="btn-primary" id="btn-nuevo-equipo" style="font-size:12px;padding:4px 10px">+ Agregar</button>
        </div>
        <div id="equipos-list">
          ${equipos.map(e => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #f1f5f9;opacity:${e.activo?1:.5}">
              <div>
                <span style="font-size:13px;font-weight:600">${escHtml(e.nombre)}</span>
                <span style="font-size:11px;color:#6b7280;margin-left:6px">${e.codigo||''} · ${e.tipo}</span>
                ${e.linea_produccion?`<span style="font-size:11px;background:#eff6ff;color:#2563eb;padding:1px 6px;border-radius:4px;margin-left:4px">${e.linea_produccion}</span>`:''}
              </div>
              <div style="display:flex;gap:4px;align-items:center">
                <button class="btn-secondary btn-partes-equipo" data-id="${e.id}" data-nombre="${escHtml(e.nombre)}" style="font-size:11px;padding:3px 8px">Partes</button>
                <button class="btn-edit-equipo" data-id="${e.id}" style="background:none;border:1px solid #d1d5db;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:13px" title="Editar equipo">✏️</button>
                <button class="btn-del-equipo" data-id="${e.id}" data-nombre="${escHtml(e.nombre)}" style="background:none;border:1px solid #fca5a5;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:13px;color:#dc2626" title="Eliminar equipo">✕</button>
              </div>
            </div>`).join('')}
        </div>
      </div>
      <!-- Partes -->
      <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <b id="partes-titulo" style="font-size:14px">⚙ Partes del equipo</b>
          <button class="btn-primary" id="btn-nueva-parte" style="font-size:12px;padding:4px 10px;display:none">+ Agregar</button>
        </div>
        <div id="partes-list"><p style="color:#9ca3af;font-size:13px;text-align:center">Selecciona un equipo</p></div>
      </div>
    </div>`;

  // Guardar configuración
  document.getElementById('btn-guardar-cfg').onclick = async () => {
    const integProd = document.getElementById('cfg-integ-prod').checked;
    const alertaPiz = document.getElementById('cfg-alerta-piz').checked;
    try {
      await apiFetch('/settings', { method: 'PATCH', body: JSON.stringify({ integracion_produccion_activa: integProd, alerta_pizarron_activa: alertaPiz }) });
      const msg = document.getElementById('cfg-msg');
      msg.style.display = '';
      setTimeout(() => msg.style.display = 'none', 3000);
    } catch (e) {
      alert('Error guardando configuración: ' + e.message);
    }
  };

  document.getElementById('btn-nuevo-equipo').onclick = () => modalNuevoEquipo();

  document.querySelectorAll('.btn-edit-equipo').forEach(btn => {
    btn.onclick = () => {
      const e = equipos.find(eq => eq.id === Number(btn.dataset.id));
      if (e) modalEditarEquipo(e);
    };
  });

  document.querySelectorAll('.btn-del-equipo').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(`¿Eliminar equipo "${btn.dataset.nombre}"? Esta acción no se puede deshacer.`)) return;
      try {
        await apiFetch(`/equipos/${btn.dataset.id}`, { method: 'DELETE' });
        loadView('catalogos');
      } catch(e) { alert('Error: ' + e.message); }
    };
  });

  document.querySelectorAll('.btn-partes-equipo').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id);
      const nombre = btn.dataset.nombre;
      document.getElementById('partes-titulo').textContent = `⚙ Partes — ${nombre}`;
      const btnNueva = document.getElementById('btn-nueva-parte');
      btnNueva.style.display = '';
      btnNueva.onclick = () => modalNuevaParte(id);
      await renderPartesList(id);
    };
  });
}

async function renderPartesList(equipoId) {
  const partes = await apiFetch(`/equipos/${equipoId}/partes?all=1`);
  const listEl = document.getElementById('partes-list');
  listEl.innerHTML = partes.length ?
    partes.map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #f1f5f9;opacity:${p.activo?1:.5}">
        <div>
          <span style="font-size:13px">${escHtml(p.nombre)}</span>
          <span style="font-size:11px;color:#6b7280;margin-left:6px">${p.codigo||''}</span>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn-edit-parte" data-id="${p.id}" style="background:none;border:1px solid #d1d5db;border-radius:6px;padding:2px 6px;cursor:pointer;font-size:13px" title="Editar parte">✏️</button>
          <button class="btn-del-parte" data-id="${p.id}" data-nombre="${escHtml(p.nombre)}" data-equipo="${equipoId}" style="background:none;border:1px solid #fca5a5;border-radius:6px;padding:2px 6px;cursor:pointer;font-size:13px;color:#dc2626" title="Eliminar parte">✕</button>
        </div>
      </div>`).join('') :
    '<p style="color:#9ca3af;font-size:13px;text-align:center">Sin partes registradas</p>';

  listEl.querySelectorAll('.btn-edit-parte').forEach(btn => {
    btn.onclick = () => {
      const p = partes.find(x => x.id === Number(btn.dataset.id));
      if (p) modalEditarParte(p, equipoId);
    };
  });

  listEl.querySelectorAll('.btn-del-parte').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(`¿Eliminar parte "${btn.dataset.nombre}"? Esta acción no se puede deshacer.`)) return;
      try {
        await apiFetch(`/partes/${btn.dataset.id}`, { method: 'DELETE' });
        await renderPartesList(Number(btn.dataset.equipo));
      } catch(e) { alert('Error: ' + e.message); }
    };
  });
}

// ── MODALES ───────────────────────────────────────────────────────────────────
function openModal(html) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `<div style="background:white;border-radius:12px;padding:28px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.25)">${html}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}

async function modalAsignar(ordenId) {
  const [orden, tecnicos] = await Promise.all([
    apiFetch(`/ordenes/${ordenId}`),
    apiFetch('/tecnicos'),
  ]);
  const overlay = openModal(`
    <h3 style="margin:0 0 16px">👤 Asignar técnico — ${escHtml(orden.folio)}</h3>
    <div class="mant-form-group"><label>Técnico</label>
      <select id="m-tecnico">
        <option value="">— Sin asignar —</option>
        ${tecnicos.map(t => `<option value="${t.id}" ${t.id===orden.tecnico_asignado_id?'selected':''}>${escHtml(t.full_name)}</option>`).join('')}
      </select>
    </div>
    <div id="m-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cancelar</button>
      <button id="m-ok" class="btn-primary">Asignar</button>
    </div>`);
  overlay.querySelector('#m-ok').onclick = async () => {
    const tecnico_asignado_id = overlay.querySelector('#m-tecnico').value;
    try {
      await apiFetch(`/ordenes/${ordenId}`, { method: 'PATCH', body: JSON.stringify({ tecnico_asignado_id: tecnico_asignado_id || null }) });
      overlay.remove();
      loadView(state.view);
    } catch(e) {
      overlay.querySelector('#m-err').textContent = e.message;
      overlay.querySelector('#m-err').style.display = 'block';
    }
  };
}

async function modalCerrarOrden(ordenId) {
  const orden = await apiFetch(`/ordenes/${ordenId}`);
  const overlay = openModal(`
    <h3 style="margin:0 0 4px">✅ Cerrar informe — ${escHtml(orden.folio)}</h3>
    <p style="font-size:12px;color:#6b7280;margin:0 0 4px">${escHtml(orden.equipo_nombre)} · ${escHtml(orden.descripcion_falla||'')}</p>
    <p style="font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:6px 10px;margin:0 0 14px">La orden pasará a "En validación" hasta que el supervisor confirme el cierre.</p>
    <div class="mant-form-group"><label>Descripción del trabajo realizado *</label>
      <textarea id="m-trabajo" placeholder="Describe el trabajo ejecutado..."></textarea>
    </div>
    <div class="mant-form-group"><label>Refacción utilizada</label>
      <input id="m-refaccion" type="text" placeholder="Nombre o código de la refacción (opcional)"/>
    </div>
    <div class="mant-form-group"><label>Parte dañada</label>
      <input id="m-parte-danada" type="text" placeholder="Parte que presentó la falla (opcional)"/>
    </div>
    <div id="m-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cancelar</button>
      <button id="m-ok" class="btn-primary" style="background:#16a34a;border-color:#16a34a">✅ Enviar a validación</button>
    </div>`);
  overlay.querySelector('#m-ok').onclick = async () => {
    const body = {
      descripcion_trabajo: overlay.querySelector('#m-trabajo').value.trim(),
      refaccion_utilizada: overlay.querySelector('#m-refaccion').value.trim() || null,
      parte_danada:        overlay.querySelector('#m-parte-danada').value.trim() || null,
    };
    if (!body.descripcion_trabajo) {
      overlay.querySelector('#m-err').textContent = 'La descripción del trabajo es requerida';
      overlay.querySelector('#m-err').style.display = 'block'; return;
    }
    try {
      const result = await apiFetch(`/ordenes/${ordenId}/cerrar`, { method: 'POST', body: JSON.stringify(body) });
      overlay.remove();
      if (result.paro_cerrado) {
        const { linea, paro_id } = result.paro_cerrado;
        alert(`✅ Informe enviado a validación. El paro de producción en ${linea.toUpperCase()} (ID ${paro_id}) fue cerrado automáticamente.`);
      }
      loadView(state.view);
    } catch(e) {
      overlay.querySelector('#m-err').textContent = e.message;
      overlay.querySelector('#m-err').style.display = 'block';
    }
  };
}

// ── Modal: Iniciar proceso (técnico) ──────────────────────────────────────────
async function modalIniciarProceso(ordenId) {
  const orden = await apiFetch(`/ordenes/${ordenId}`);
  const overlay = openModal(`
    <h3 style="margin:0 0 4px">▶ Iniciar proceso — ${escHtml(orden.folio)}</h3>
    <p style="font-size:12px;color:#6b7280;margin:0 0 12px">${escHtml(orden.equipo_nombre)} · ${escHtml(orden.descripcion_falla||'')}</p>
    ${orden.tecnico_asignado_id && orden.tecnico_asignado_id !== state.user.id ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px;margin-bottom:12px;font-size:12px;color:#92400e">
        ⚠️ Esta orden está asignada a <b>${escHtml(orden.tecnico_nombre||'otro técnico')}</b>. Al continuar, quedarás registrado como quien la atiende.
      </div>` : ''}
    <div class="mant-form-group">
      <label>Diagnóstico *</label>
      <textarea id="ip-diagnostico" placeholder="Describe el diagnóstico de la falla..." rows="3" style="resize:vertical"></textarea>
    </div>
    <div class="mant-form-group">
      <label>Tiempo estimado de cierre *</label>
      <input id="ip-tiempo-estimado" type="datetime-local"/>
    </div>
    <div class="mant-form-group">
      <label>Status del equipo *</label>
      <select id="ip-status-equipo">
        <option value="">— Selecciona —</option>
        <option value="trabajando_normal">✅ Trabajando normalmente</option>
        <option value="trabajando_ajuste">⚠️ Trabajando con ajuste</option>
        <option value="maquina_parada">⛔ Máquina parada</option>
      </select>
    </div>
    <div id="ip-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cancelar</button>
      <button id="ip-ok" class="btn-primary" style="background:#7c3aed;border-color:#7c3aed">▶ Iniciar proceso</button>
    </div>`);
  overlay.querySelector('#ip-ok').onclick = async () => {
    const diagnostico = overlay.querySelector('#ip-diagnostico').value.trim();
    const tiempo_estimado_cierre = overlay.querySelector('#ip-tiempo-estimado').value;
    const status_equipo = overlay.querySelector('#ip-status-equipo').value;
    const errEl = overlay.querySelector('#ip-err');
    if (!diagnostico || !tiempo_estimado_cierre || !status_equipo) {
      errEl.textContent = 'Todos los campos son requeridos'; errEl.style.display = 'block'; return;
    }
    try {
      await apiFetch(`/ordenes/${ordenId}/iniciar-proceso`, {
        method: 'PATCH',
        body: JSON.stringify({ diagnostico, tiempo_estimado_cierre, status_equipo }),
      });
      overlay.remove();
      loadView(state.view);
    } catch(e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
  };
}

function calcDiff(isoA, isoB) {
  const mins = Math.round((new Date(isoB) - new Date(isoA)) / 60000);
  if (isNaN(mins) || mins < 0) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Modal: Validar cierre (supervisor) ────────────────────────────────────────
async function modalValidarOrden(ordenId) {
  const o = await apiFetch(`/ordenes/${ordenId}`);
  const tRespuesta = (o.fecha_solicitud && o.hora_solicitud && o.fecha_en_proceso && o.hora_en_proceso)
    ? calcDiff(`${o.fecha_solicitud}T${o.hora_solicitud}`, `${o.fecha_en_proceso}T${o.hora_en_proceso}`) : '—';
  const tTrabajo = (o.fecha_en_proceso && o.hora_en_proceso && o.fecha_cierre && o.hora_cierre)
    ? calcDiff(`${o.fecha_en_proceso}T${o.hora_en_proceso}`, `${o.fecha_cierre}T${o.hora_cierre}`) : '—';
  const infoRow = (label, val) => `<div style="display:flex;gap:6px;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:12px"><span style="color:#6b7280;min-width:130px">${label}</span><span style="font-weight:500">${val}</span></div>`;
  const overlay = openModal(`
    <h3 style="margin:0 0 4px;font-size:16px">🔍 Validar cierre — ${escHtml(o.folio)}</h3>
    <p style="font-size:12px;color:#6b7280;margin:0 0 14px">${escHtml(o.equipo_nombre)}${o.parte_nombre&&o.parte_nombre!=='-'?' / '+escHtml(o.parte_nombre):''}</p>
    <div style="background:#f8fafc;border-radius:8px;padding:12px;margin-bottom:14px">
      ${infoRow('Apertura', `${fmtDate(o.fecha_solicitud)} ${o.hora_solicitud||''}`)}
      ${infoRow('Inicio atención', o.fecha_en_proceso ? `${fmtDate(o.fecha_en_proceso)} ${o.hora_en_proceso||''}` : '—')}
      ${infoRow('Tiempo de respuesta', tRespuesta)}
      ${infoRow('Cierre', o.fecha_cierre ? `${fmtDate(o.fecha_cierre)} ${o.hora_cierre||''}` : '—')}
      ${infoRow('Tiempo de trabajo', tTrabajo)}
      ${infoRow('Atendido por', escHtml(o.atendida_por_nombre || o.tecnico_nombre || '—'))}
    </div>
    ${o.diagnostico ? `<div style="margin-bottom:12px"><div style="font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:600;margin-bottom:4px">Diagnóstico</div><div style="background:#f8fafc;border-radius:6px;padding:8px;font-size:12px">${escHtml(o.diagnostico)}</div></div>` : ''}
    ${o.descripcion_trabajo ? `<div style="margin-bottom:14px"><div style="font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:600;margin-bottom:4px">Trabajo realizado</div><div style="background:#f8fafc;border-radius:6px;padding:8px;font-size:12px">${escHtml(o.descripcion_trabajo)}${o.refaccion_utilizada?`<br><span style="color:#6b7280">Refacción: ${escHtml(o.refaccion_utilizada)}</span>`:''}${o.parte_danada?`<br><span style="color:#6b7280">Parte dañada: ${escHtml(o.parte_danada)}</span>`:''}</div></div>` : ''}
    <div id="rechazo-wrap" style="display:none;margin-bottom:12px">
      <div class="mant-form-group">
        <label>Motivo de rechazo *</label>
        <textarea id="motivo-rechazo" placeholder="Describe el motivo por el que se rechaza el cierre..." rows="3"></textarea>
      </div>
    </div>
    <div id="val-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cancelar</button>
      <button id="btn-rechazar" class="btn-secondary" style="color:#dc2626;border-color:#fca5a5">✖ Rechazar</button>
      <button id="btn-confirmar" class="btn-primary" style="background:#16a34a;border-color:#16a34a">✅ Confirmar cierre</button>
    </div>`);

  let rechazando = false;
  overlay.querySelector('#btn-rechazar').onclick = async () => {
    if (!rechazando) {
      rechazando = true;
      overlay.querySelector('#rechazo-wrap').style.display = '';
      const rBtn = overlay.querySelector('#btn-rechazar');
      rBtn.textContent = '✖ Confirmar rechazo';
      rBtn.style.cssText += ';background:#dc2626;color:white;border-color:#dc2626';
    } else {
      const motivo = overlay.querySelector('#motivo-rechazo').value.trim();
      const errEl = overlay.querySelector('#val-err');
      if (!motivo) { errEl.textContent = 'El motivo de rechazo es requerido'; errEl.style.display = 'block'; return; }
      try {
        await apiFetch(`/ordenes/${ordenId}/rechazar`, { method: 'PATCH', body: JSON.stringify({ motivo_rechazo: motivo }) });
        overlay.remove();
        const subject = encodeURIComponent(`Rechazo OT ${o.folio} — ${o.equipo_nombre}`);
        const body = encodeURIComponent(`Estimado equipo de mantenimiento,\n\nLa orden ${o.folio} (${o.equipo_nombre}) fue rechazada por el supervisor.\n\nMotivo: ${motivo}\n\nPor favor revisa y corrige el informe.\n\nSaludos`);
        window.open(`mailto:ecoronado@cuesto.com.mx?subject=${subject}&body=${body}`, '_blank');
        loadView(state.view);
      } catch(e) { overlay.querySelector('#val-err').textContent = e.message; overlay.querySelector('#val-err').style.display = 'block'; }
    }
  };
  overlay.querySelector('#btn-confirmar').onclick = async () => {
    try {
      await apiFetch(`/ordenes/${ordenId}/validar`, { method: 'PATCH' });
      overlay.remove();
      loadView(state.view);
    } catch(e) { overlay.querySelector('#val-err').textContent = e.message; overlay.querySelector('#val-err').style.display = 'block'; }
  };
}

// ── VISTA: EN VALIDACIÓN (supervisor / admin) ─────────────────────────────────
async function viewValidacion(el) {
  const ordenes = await apiFetch('/ordenes?status=en_validacion');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="margin:0;font-size:18px">🔍 En validación</h2>
      <span style="font-size:12px;color:#6b7280">${ordenes.length} orden(es) pendiente(s) de confirmación</span>
    </div>
    ${ordenes.length === 0 ? `
      <div style="text-align:center;padding:48px;color:#6b7280;background:white;border-radius:10px;border:1px solid #e2e8f0">
        <div style="font-size:32px;margin-bottom:8px">✅</div>
        <div style="font-weight:600">Sin órdenes pendientes de validación</div>
        <div style="font-size:13px;margin-top:4px">Todas las órdenes cerradas han sido confirmadas</div>
      </div>` :
      ordenes.map(o => `
        <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:12px;border-left:4px solid #f59e0b">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:15px;margin-bottom:6px">${escHtml(o.folio)} — ${escHtml(o.equipo_nombre)}${o.parte_nombre&&o.parte_nombre!=='-'?` <span style="color:#6b7280;font-size:12px">/ ${escHtml(o.parte_nombre)}</span>`:''}</div>
              <div style="font-size:12px;color:#6b7280;margin-bottom:8px">${escHtml((o.descripcion_falla||'').slice(0,100))}</div>
              <div style="font-size:12px;margin-bottom:3px"><span style="color:#6b7280">Atendido por:</span> <b>${escHtml(o.atendida_por_nombre || o.tecnico_nombre || '—')}</b></div>
              <div style="font-size:12px;margin-bottom:3px"><span style="color:#6b7280">Cierre:</span> ${fmtDate(o.fecha_cierre)} ${o.hora_cierre||''}</div>
              <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">${urgenciaBadge(o.nivel_urgencia)} ${statusBadge(o.status)}</div>
            </div>
            <div style="flex-shrink:0">
              <button class="btn-primary btn-validar-orden" data-id="${o.id}" style="padding:8px 16px;font-size:13px">🔍 Ver informe y validar</button>
            </div>
          </div>
        </div>`).join('')
    }`;
  el.querySelectorAll('.btn-validar-orden').forEach(btn => {
    btn.onclick = () => modalValidarOrden(Number(btn.dataset.id));
  });
}

async function modalDetalleOrden(ordenId) {
  const o = await apiFetch(`/ordenes/${ordenId}`);
  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div>
        <h3 style="margin:0 0 4px;font-size:16px">${escHtml(o.folio)}</h3>
        <div style="font-size:12px;color:#6b7280">${o.tipo === 'correctivo_urgente' ? '🚨 Urgente (Producción)' : o.tipo === 'programado' ? '🗓 Programado' : '📝 Solicitud'}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${urgenciaBadge(o.nivel_urgencia)}
        ${statusBadge(o.status)}
        <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af">×</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#f8fafc;border-radius:8px;padding:12px;font-size:12px;margin-bottom:14px">
      <div><div style="color:#9ca3af;font-size:10px;font-weight:600;text-transform:uppercase">Departamento</div><b>${escHtml(o.departamento_nombre||'—')}</b></div>
      <div><div style="color:#9ca3af;font-size:10px;font-weight:600;text-transform:uppercase">Solicitante</div>${escHtml(o.solicitante_nombre || '—')}</div>
      <div><div style="color:#9ca3af;font-size:10px;font-weight:600;text-transform:uppercase">Equipo</div><b>${escHtml(o.equipo_nombre)}</b></div>
      <div><div style="color:#9ca3af;font-size:10px;font-weight:600;text-transform:uppercase">Parte</div>${escHtml(o.parte_nombre||'—')}</div>
      <div><div style="color:#9ca3af;font-size:10px;font-weight:600;text-transform:uppercase">Fecha solicitud</div>${fmtDate(o.fecha_solicitud)} ${o.hora_solicitud||''}</div>
      <div><div style="color:#9ca3af;font-size:10px;font-weight:600;text-transform:uppercase">Técnico asignado</div>${escHtml(o.tecnico_nombre||'Sin asignar')}</div>
      <div><div style="color:#9ca3af;font-size:10px;font-weight:600;text-transform:uppercase">Máquina parada</div>${o.maquina_parada?'⛔ Sí':'✅ No'}</div>
    </div>
    <div style="font-size:12px;margin-bottom:12px">
      <div style="color:#9ca3af;font-size:10px;font-weight:600;text-transform:uppercase;margin-bottom:4px">Descripción de la falla</div>
      <div style="background:#f8fafc;border-radius:6px;padding:10px">${escHtml(o.descripcion_falla)}</div>
    </div>
    ${o.origen_produccion ? `
      <div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:10px;font-size:12px;margin-bottom:12px">
        <div style="font-weight:700;color:#713f12;margin-bottom:4px">🏭 Generada desde Producción</div>
        <div>Línea: <b>${escHtml(String(o.origen_produccion.linea||'').toUpperCase())}</b> · Paro: <b>${escHtml(String(o.origen_produccion.folio_paro||o.origen_produccion.paro_id||''))}</b></div>
      </div>` : ''}
    ${o.diagnostico ? `
      <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:10px;font-size:12px;margin-bottom:12px">
        <div style="font-weight:700;color:#5b21b6;margin-bottom:4px">🔬 Diagnóstico</div>
        <div>${escHtml(o.diagnostico)}</div>
        ${o.tiempo_estimado_cierre?`<div style="margin-top:4px;color:#6b7280">Cierre estimado: ${fmtDateTime(o.tiempo_estimado_cierre)}</div>`:''}
      </div>` : ''}
    ${['cerrada','en_validacion'].includes(o.status) && o.descripcion_trabajo ? `
      <div style="background:${o.status==='cerrada'?'#f0fdf4':'#fffbeb'};border:1px solid ${o.status==='cerrada'?'#bbf7d0':'#fde68a'};border-radius:8px;padding:12px;font-size:12px">
        <div style="font-weight:700;color:${o.status==='cerrada'?'#15803d':'#92400e'};margin-bottom:8px">${o.status==='cerrada'?'✅ Cerrada':'🟠 En validación'} — ${fmtDate(o.fecha_cierre)} ${o.hora_cierre||''} · ${escHtml(o.atendida_por_nombre||o.cerrada_por_nombre||'')}</div>
        <div><b>Trabajo:</b> ${escHtml(o.descripcion_trabajo)}</div>
        ${o.refaccion_utilizada?`<div><b>Refacción:</b> ${escHtml(o.refaccion_utilizada)}</div>`:''}
        ${o.parte_danada?`<div><b>Parte dañada:</b> ${escHtml(o.parte_danada)}</div>`:''}
        ${o.validado_por_nombre?`<div style="margin-top:4px;color:#15803d">✅ Validado por: ${escHtml(o.validado_por_nombre)}</div>`:''}
      </div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px">
      ${state.user?.mant_role === 'superadmin_mant' ? `<button id="btn-borrar-orden" style="background:#fee2e2;border:1px solid #fca5a5;color:#dc2626;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer">🗑 Borrar orden</button>` : '<span></span>'}
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cerrar</button>
    </div>`);
  const btnBorrar = document.getElementById('btn-borrar-orden');
  if (btnBorrar) {
    btnBorrar.onclick = async () => {
      if (!confirm(`¿Borrar orden ${o.folio}? Esta acción no se puede deshacer.`)) return;
      await apiFetch(`/ordenes/${o.id}`, { method: 'DELETE' });
      document.querySelector('[style*=fixed]')?.remove();
      loadView(state.view);
    };
  }
}

async function modalNuevoEquipo() {
  const overlay = openModal(`
    <h3 style="margin:0 0 16px">🏭 Nuevo equipo</h3>
    <div class="mant-form-group"><label>Nombre *</label><input id="e-nombre" type="text" placeholder="Nombre del equipo"/></div>
    <div class="mant-form-group"><label>Código</label><input id="e-codigo" type="text" placeholder="EQ-001"/></div>
    <div class="mant-form-group"><label>Tipo</label>
      <select id="e-tipo">
        <option value="linea">Línea de producción</option>
        <option value="auxiliar">Auxiliar</option>
        <option value="electrico">Eléctrico</option>
        <option value="otro">Otro</option>
      </select>
    </div>
    <div class="mant-form-group"><label>Línea de producción asociada</label>
      <select id="e-linea">
        <option value="">— Ninguna —</option>
        <option value="Baker">Baker</option><option value="L1">Línea 1</option>
        <option value="L3">Línea 3</option><option value="L4">Línea 4</option>
      </select>
    </div>
    <div id="e-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cancelar</button>
      <button id="e-ok" class="btn-primary">Guardar</button>
    </div>`);
  overlay.querySelector('#e-ok').onclick = async () => {
    try {
      await apiFetch('/equipos', { method: 'POST', body: JSON.stringify({
        nombre: overlay.querySelector('#e-nombre').value.trim(),
        codigo: overlay.querySelector('#e-codigo').value.trim(),
        tipo:   overlay.querySelector('#e-tipo').value,
        linea_produccion: overlay.querySelector('#e-linea').value || null,
      }) });
      overlay.remove();
      loadView('catalogos');
    } catch(e) {
      overlay.querySelector('#e-err').textContent = e.message;
      overlay.querySelector('#e-err').style.display = 'block';
    }
  };
}

async function modalEditarEquipo(equipo) {
  const overlay = openModal(`
    <h3 style="margin:0 0 16px">✏️ Editar equipo</h3>
    <div class="mant-form-group"><label>Nombre *</label><input id="e-nombre" type="text" value="${escHtml(equipo.nombre)}"/></div>
    <div class="mant-form-group"><label>Código</label><input id="e-codigo" type="text" value="${escHtml(equipo.codigo||'')}"/></div>
    <div class="mant-form-group"><label>Tipo</label>
      <select id="e-tipo">
        <option value="linea" ${equipo.tipo==='linea'?'selected':''}>Línea de producción</option>
        <option value="auxiliar" ${equipo.tipo==='auxiliar'?'selected':''}>Auxiliar</option>
        <option value="electrico" ${equipo.tipo==='electrico'?'selected':''}>Eléctrico</option>
        <option value="otro" ${equipo.tipo==='otro'?'selected':''}>Otro</option>
      </select>
    </div>
    <div class="mant-form-group"><label>Línea de producción asociada</label>
      <select id="e-linea">
        <option value="" ${!equipo.linea_produccion?'selected':''}>— Ninguna —</option>
        <option value="Baker" ${equipo.linea_produccion==='Baker'?'selected':''}>Baker</option>
        <option value="L1" ${equipo.linea_produccion==='L1'?'selected':''}>Línea 1</option>
        <option value="L3" ${equipo.linea_produccion==='L3'?'selected':''}>Línea 3</option>
        <option value="L4" ${equipo.linea_produccion==='L4'?'selected':''}>Línea 4</option>
      </select>
    </div>
    <div id="e-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cancelar</button>
      <button id="e-ok" class="btn-primary">Guardar cambios</button>
    </div>`);
  overlay.querySelector('#e-ok').onclick = async () => {
    try {
      await apiFetch(`/equipos/${equipo.id}`, { method: 'PATCH', body: JSON.stringify({
        nombre: overlay.querySelector('#e-nombre').value.trim(),
        codigo: overlay.querySelector('#e-codigo').value.trim(),
        tipo:   overlay.querySelector('#e-tipo').value,
        linea_produccion: overlay.querySelector('#e-linea').value || null,
      }) });
      overlay.remove();
      loadView('catalogos');
    } catch(e) {
      overlay.querySelector('#e-err').textContent = e.message;
      overlay.querySelector('#e-err').style.display = 'block';
    }
  };
}

async function modalNuevaParte(equipoId) {
  const overlay = openModal(`
    <h3 style="margin:0 0 16px">⚙ Nueva parte</h3>
    <div class="mant-form-group"><label>Nombre *</label><input id="p-nombre" type="text" placeholder="Nombre de la parte"/></div>
    <div class="mant-form-group"><label>Código</label><input id="p-codigo" type="text" placeholder="P-001"/></div>
    <div id="p-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cancelar</button>
      <button id="p-ok" class="btn-primary">Guardar</button>
    </div>`);
  overlay.querySelector('#p-ok').onclick = async () => {
    try {
      await apiFetch('/partes', { method: 'POST', body: JSON.stringify({
        equipo_id: equipoId,
        nombre: overlay.querySelector('#p-nombre').value.trim(),
        codigo: overlay.querySelector('#p-codigo').value.trim(),
      }) });
      overlay.remove();
      // Recargar la lista de partes
      const btn = document.querySelector(`.btn-partes-equipo[data-id="${equipoId}"]`);
      if (btn) btn.click();
    } catch(e) {
      overlay.querySelector('#p-err').textContent = e.message;
      overlay.querySelector('#p-err').style.display = 'block';
    }
  };
}

async function modalEditarParte(parte, equipoId) {
  const overlay = openModal(`
    <h3 style="margin:0 0 16px">✏️ Editar parte</h3>
    <div class="mant-form-group"><label>Nombre *</label><input id="p-nombre" type="text" value="${escHtml(parte.nombre)}"/></div>
    <div class="mant-form-group"><label>Código</label><input id="p-codigo" type="text" value="${escHtml(parte.codigo||'')}"/></div>
    <div id="p-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cancelar</button>
      <button id="p-ok" class="btn-primary">Guardar cambios</button>
    </div>`);
  overlay.querySelector('#p-ok').onclick = async () => {
    try {
      await apiFetch(`/partes/${parte.id}`, { method: 'PATCH', body: JSON.stringify({
        nombre: overlay.querySelector('#p-nombre').value.trim(),
        codigo: overlay.querySelector('#p-codigo').value.trim(),
      }) });
      overlay.remove();
      await renderPartesList(equipoId);
    } catch(e) {
      overlay.querySelector('#p-err').textContent = e.message;
      overlay.querySelector('#p-err').style.display = 'block';
    }
  };
}

// ── Modal: Asignar técnico a OT programada (con validación de carga) ──────────
async function modalAsignarProgramada(ordenId, vp, onDone) {
  const orden = vp.ordenes.find(o => o.id === ordenId);
  if (!orden) return;
  const fecha = orden.fecha_programada;

  // Fetch load for each technician concurrently
  const tecnicosConCarga = await Promise.all(
    vp.tecnicos.map(t =>
      apiFetch(`/tecnicos/${t.id}/carga?anio=${vp.anio}&mes=${vp.mes}`)
        .then(carga => ({ ...t, carga }))
        .catch(() => ({ ...t, carga: {} }))
    )
  );

  const optsTec = tecnicosConCarga.map(t => {
    const mes = Object.values(t.carga).reduce((a,b)=>a+b,0);
    return `<option value="${t.id}" data-dia="${t.carga[fecha]||0}" data-mes="${mes}" ${orden.tecnico_asignado_id===t.id?'selected':''}>${escHtml(t.full_name)} — ${mes} órdenes este mes</option>`;
  }).join('');

  const overlay = openModal(`
    <h3 style="margin:0 0 4px">👤 Asignar técnico</h3>
    <p style="font-size:12px;color:#6b7280;margin:0 0 14px">${escHtml(orden.equipo_nombre)} · ${escHtml(orden.descripcion_falla||'')} · <strong>${fmtDate(fecha)}</strong></p>
    <div class="mant-form-group">
      <label>Técnico</label>
      <select id="as-tec">
        <option value="">— Sin asignar —</option>
        ${optsTec}
      </select>
    </div>
    <div id="as-carga" style="min-height:22px;font-size:12px;padding:4px 0;margin-bottom:8px"></div>
    <div id="as-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cancelar</button>
      <button id="as-ok" class="btn-primary">Asignar</button>
    </div>`);

  function updateCargaInfo() {
    const sel = overlay.querySelector('#as-tec');
    const opt = sel.options[sel.selectedIndex];
    const cargaDiv = overlay.querySelector('#as-carga');
    if (!sel.value) { cargaDiv.textContent = ''; return; }
    const dia = Number(opt.dataset.dia || 0);
    const mes = Number(opt.dataset.mes || 0);
    const warn = dia === 0 ? `✅ Libre el ${fmtDate(fecha)}` : dia === 1 ? `⚠️ Ya tiene 1 orden el ${fmtDate(fecha)}` : `🔴 Tiene ${dia} órdenes el ${fmtDate(fecha)}`;
    cargaDiv.innerHTML = `<span style="color:${dia===0?'#15803d':dia===1?'#d97706':'#dc2626'}">${warn} · ${mes} órdenes en el mes</span>`;
  }

  overlay.querySelector('#as-tec').onchange = updateCargaInfo;
  updateCargaInfo();

  overlay.querySelector('#as-ok').onclick = async () => {
    const tecId = overlay.querySelector('#as-tec').value;
    try {
      await apiFetch(`/ordenes/${ordenId}`, { method:'PATCH', body: JSON.stringify({ tecnico_asignado_id: tecId ? Number(tecId) : null }) });
      overlay.remove();
      if (onDone) await onDone();
    } catch(e) {
      overlay.querySelector('#as-err').textContent = e.message;
      overlay.querySelector('#as-err').style.display = 'block';
    }
  };
}

// ── Modal: Aplazar OT programada ─────────────────────────────────────────────
async function modalAplazarProgramada(ordenId, vp, onDone) {
  const orden = vp.ordenes.find(o => o.id === ordenId);
  if (!orden) return;
  const overlay = openModal(`
    <h3 style="margin:0 0 4px">📅 Aplazar orden</h3>
    <p style="font-size:12px;color:#6b7280;margin:0 0 14px">${escHtml(orden.equipo_nombre)} · ${escHtml(orden.descripcion_falla||'')}</p>
    <p style="font-size:13px;margin:0 0 12px">Fecha programada actual: <strong>${fmtDate(orden.fecha_programada)}</strong>${orden.fecha_programada_original?` (original: ${fmtDate(orden.fecha_programada_original)})`:''}</p>
    <div class="mant-form-group">
      <label>Nueva fecha *</label>
      <input id="apl-fecha" type="date" value="${orden.fecha_programada||''}"/>
    </div>
    <div class="mant-form-group">
      <label>Motivo del aplazamiento</label>
      <input id="apl-motivo" type="text" placeholder="Ej: Sin refacciones, técnico no disponible..."/>
    </div>
    <div id="apl-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cancelar</button>
      <button id="apl-ok" class="btn-primary">📅 Aplazar</button>
    </div>`);

  overlay.querySelector('#apl-ok').onclick = async () => {
    const nuevaFecha = overlay.querySelector('#apl-fecha').value;
    const motivo     = overlay.querySelector('#apl-motivo').value.trim();
    if (!nuevaFecha || nuevaFecha === orden.fecha_programada) {
      overlay.querySelector('#apl-err').textContent = 'Selecciona una fecha diferente a la actual';
      overlay.querySelector('#apl-err').style.display = 'block'; return;
    }
    try {
      await apiFetch(`/ordenes/${ordenId}/aplazar`, { method:'PATCH', body: JSON.stringify({ nueva_fecha: nuevaFecha, motivo }) });
      overlay.remove();
      if (onDone) await onDone();
    } catch(e) {
      overlay.querySelector('#apl-err').textContent = e.message;
      overlay.querySelector('#apl-err').style.display = 'block';
    }
  };
}

// ── Modal: Cancelar OT programada (solo esta / todo el programa) ──────────────
async function modalCancelarProgramada(ordenId, programadoId, vp, onDone) {
  const orden = vp.ordenes.find(o => o.id === ordenId);
  const prog  = vp.programados.find(p => p.id === programadoId);
  if (!orden) return;
  const overlay = openModal(`
    <h3 style="margin:0 0 4px">❌ Cancelar orden</h3>
    <p style="font-size:12px;color:#6b7280;margin:0 0 14px">${escHtml(orden.equipo_nombre)} · ${escHtml(orden.descripcion_falla||'')} · ${fmtDate(orden.fecha_programada)}</p>
    <div style="margin-bottom:16px">
      <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin-bottom:10px;font-size:13px">
        <input type="radio" name="cn-tipo" value="ocurrencia" checked style="margin-top:3px;flex-shrink:0"/>
        <span>
          <strong>Solo esta ocurrencia</strong><br>
          <span style="color:#6b7280;font-size:12px">Cancela únicamente el ${fmtDate(orden.fecha_programada)}. Las demás órdenes del programa continúan normalmente.</span>
        </span>
      </label>
      ${prog ? `
      <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:13px">
        <input type="radio" name="cn-tipo" value="programa" style="margin-top:3px;flex-shrink:0"/>
        <span>
          <strong>Desactivar programa completo</strong><br>
          <span style="color:#6b7280;font-size:12px">Cancela esta orden y pausa la actividad <em>"${escHtml(prog.tarea)}"</em>. No se generarán futuras órdenes hasta reactivarla.</span>
        </span>
      </label>` : ''}
    </div>
    <div id="cn-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Volver</button>
      <button id="cn-ok" class="btn-primary" style="background:#dc2626;border-color:#dc2626">Confirmar cancelación</button>
    </div>`);

  overlay.querySelector('#cn-ok').onclick = async () => {
    const tipo = overlay.querySelector('[name=cn-tipo]:checked')?.value || 'ocurrencia';
    try {
      await apiFetch(`/ordenes/${ordenId}`, { method:'PATCH', body: JSON.stringify({ status: 'cancelada' }) });
      if (tipo === 'programa' && programadoId) {
        await apiFetch(`/programados/${programadoId}`, { method:'PATCH', body: JSON.stringify({ status: 'inactivo' }) });
        alert('✅ Orden cancelada y programa desactivado.');
      }
      overlay.remove();
      if (onDone) await onDone();
    } catch(e) {
      overlay.querySelector('#cn-err').textContent = e.message;
      overlay.querySelector('#cn-err').style.display = 'block';
    }
  };
}

async function modalNuevoProgramado() {
  const [equipos, tecnicos] = await Promise.all([apiFetch('/equipos'), apiFetch('/tecnicos')]);
  const overlay = openModal(`
    <h3 style="margin:0 0 16px">🗓 Nuevo mantenimiento programado</h3>
    <div class="mant-form-group"><label>Equipo *</label>
      <select id="mp-equipo">
        <option value="">— Selecciona —</option>
        ${equipos.map(e=>`<option value="${e.id}">${escHtml(e.nombre)}</option>`).join('')}
      </select>
    </div>
    <div class="mant-form-group"><label>Parte del equipo</label>
      <select id="mp-parte"><option value="">— Sin especificar —</option></select>
    </div>
    <div class="mant-form-group"><label>Tarea *</label>
      <input id="mp-tarea" type="text" placeholder="Ej: Revisión de rodamientos"/>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="mant-form-group"><label>Frecuencia *</label>
        <select id="mp-frec">
          <option value="diario">Diario</option>
          <option value="semanal">Semanal</option>
          <option value="quincenal">Quincenal (cada 14 días)</option>
          <option value="mensual" selected>Mensual</option>
          <option value="trimestral">Trimestral (cada 3 meses)</option>
          <option value="semestral">Semestral (cada 6 meses)</option>
          <option value="anual">Anual</option>
          <option value="personalizado">Personalizado</option>
        </select>
      </div>
      <div class="mant-form-group" id="mp-dias-wrap" style="display:none"><label>Cada X días *</label>
        <input id="mp-dias" type="number" min="1" value="30"/>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="mant-form-group"><label>Fecha inicio *</label>
        <input id="mp-ini" type="date" value="${new Date().toISOString().slice(0,10)}"/>
      </div>
      <div class="mant-form-group"><label>Último mantenimiento</label>
        <input id="mp-ult" type="date"/>
      </div>
    </div>
    <div class="mant-form-group"><label>Técnico responsable</label>
      <select id="mp-tec">
        <option value="">— Sin asignar —</option>
        ${tecnicos.map(t=>`<option value="${t.id}">${escHtml(t.full_name)}</option>`).join('')}
      </select>
    </div>
    <div id="mp-err" style="color:#dc2626;font-size:13px;display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="this.closest('[style*=fixed]').remove()" class="btn-secondary">Cancelar</button>
      <button id="mp-ok" class="btn-primary">Guardar</button>
    </div>`);

  overlay.querySelector('#mp-equipo').onchange = async () => {
    const id = overlay.querySelector('#mp-equipo').value;
    const pSel = overlay.querySelector('#mp-parte');
    if (!id) { pSel.innerHTML = '<option value="">— Sin especificar —</option>'; return; }
    const partes = await apiFetch(`/equipos/${id}/partes`);
    pSel.innerHTML = '<option value="">— Sin especificar —</option>' +
      partes.map(p=>`<option value="${p.id}">${escHtml(p.nombre)}</option>`).join('');
  };
  overlay.querySelector('#mp-frec').onchange = () => {
    const v = overlay.querySelector('#mp-frec').value;
    overlay.querySelector('#mp-dias-wrap').style.display = v === 'personalizado' ? '' : 'none';
  };
  overlay.querySelector('#mp-ok').onclick = async () => {
    try {
      await apiFetch('/programados', { method: 'POST', body: JSON.stringify({
        equipo_id:             overlay.querySelector('#mp-equipo').value,
        parte_equipo_id:       overlay.querySelector('#mp-parte').value || null,
        tarea:                 overlay.querySelector('#mp-tarea').value.trim(),
        frecuencia:            overlay.querySelector('#mp-frec').value,
        dias_intervalo:        overlay.querySelector('#mp-dias')?.value || null,
        fecha_inicio:          overlay.querySelector('#mp-ini').value,
        fecha_ultimo_mant:     overlay.querySelector('#mp-ult').value || null,
        tecnico_responsable_id: overlay.querySelector('#mp-tec').value || null,
      }) });
      overlay.remove();
      loadView('programados');
    } catch(e) {
      overlay.querySelector('#mp-err').textContent = e.message;
      overlay.querySelector('#mp-err').style.display = 'block';
    }
  };
}

// ── PDF de orden — 2 copias (original + copia) en hoja carta ─────────────────
async function generarPDFOrden(ordenId, descarga = false) {
  const o = await apiFetch(`/ordenes/${ordenId}`);
  const { jsPDF } = window.jspdf;

  // Hoja carta (216 × 279 mm). Cada copia ocupa la mitad vertical (~135 mm de contenido)
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const PW = 216, PH = 279;
  const COPY_H = PH / 2;       // 139.5 mm por copia
  const M = 10;                 // margen lateral
  const W = PW - M * 2;        // ancho útil
  const FOOTER_CODE = '4-MA-42  Rev. 1  04MY15';

  const drawCopy = (yBase, etiqueta) => {
    let y = yBase + M;

    // ── Encabezado ──────────────────────────────────────────────────────────
    // Barra naranja superior
    doc.setFillColor(249, 115, 22);
    doc.rect(M, y, W, 1.5, 'F');
    y += 3;

    // Título + folio en la misma línea
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15, 23, 42);
    doc.text('SOLICITUD DE ORDEN DE MANTENIMIENTO', M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
    doc.text(o.folio, PW - M, y, { align: 'right' });
    y += 4;

    // Etiqueta ORIGINAL / COPIA
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    doc.setTextColor(etiqueta === 'ORIGINAL' ? 21 : 37, etiqueta === 'ORIGINAL' ? 128 : 99, etiqueta === 'ORIGINAL' ? 61 : 235);
    doc.text(`[ ${etiqueta} ]`, PW - M, y, { align: 'right' });
    doc.setTextColor(55, 65, 81);

    // Línea divisoria bajo encabezado
    doc.setDrawColor(249, 115, 22); doc.setLineWidth(0.3);
    doc.line(M, y + 1, PW - M, y + 1);
    y += 4;

    // ── Grid de datos (2 columnas) ──────────────────────────────────────────
    doc.setLineWidth(0.1); doc.setDrawColor(220, 220, 220);
    const col1 = M, col2 = M + W / 2 + 2;
    const cellH = 7;
    const campos = [
      ['Departamento solicitante', o.departamento_nombre || '—'],
      ['Solicitante',              o.solicitante_nombre || '—'],
      ['Fecha / Hora',             `${o.fecha_solicitud || '—'}  ${o.hora_solicitud || ''}`],
      ['Equipo',                   o.equipo_nombre || '—'],
      ['Parte del equipo',         (o.parte_nombre && o.parte_nombre !== '-') ? o.parte_nombre : '—'],
      ['Urgencia',                 (o.nivel_urgencia || '').toUpperCase()],
      ['Máquina parada',           o.maquina_parada ? 'SÍ' : 'NO'],
      ['Técnico asignado',         o.tecnico_nombre || 'Por asignar'],
    ];

    // Distribuir en 2 columnas (4 filas × 2 columnas)
    const colW = W / 2 - 2;
    for (let i = 0; i < campos.length; i++) {
      const cx = i % 2 === 0 ? col1 : col2;
      const cy = y + Math.floor(i / 2) * cellH;
      doc.setFillColor(248, 250, 252);
      doc.rect(cx, cy, colW, cellH, 'F');
      doc.rect(cx, cy, colW, cellH);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(120, 120, 120);
      doc.text(campos[i][0].toUpperCase(), cx + 2, cy + 3);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(30, 30, 30);
      doc.text(String(campos[i][1] || '—'), cx + 2, cy + 6.2);
    }
    y += Math.ceil(campos.length / 2) * cellH + 3;

    // ── Descripción de la falla ─────────────────────────────────────────────
    doc.setFillColor(255, 247, 237); doc.setDrawColor(249, 115, 22); doc.setLineWidth(0.2);
    doc.rect(M, y, W, 18, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(154, 52, 18);
    doc.text('DESCRIPCIÓN DE LA FALLA / TRABAJO SOLICITADO', M + 2, y + 3.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(30, 30, 30);
    const linFalla = doc.splitTextToSize(o.descripcion_falla || '', W - 4);
    doc.text(linFalla.slice(0, 3), M + 2, y + 7.5);
    y += 21;

    // ── Sección cierre (si aplica) o firmas ────────────────────────────────
    if (o.status === 'cerrada') {
      doc.setFillColor(240, 253, 244); doc.setDrawColor(134, 239, 172); doc.setLineWidth(0.2);
      doc.rect(M, y, W, 18, 'FD');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(21, 128, 61);
      doc.text(`CIERRE  ${o.fecha_cierre || ''} ${o.hora_cierre || ''}  ·  ${o.cerrada_por_nombre || ''}`, M + 2, y + 3.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(30, 30, 30);
      const linWork = doc.splitTextToSize(o.descripcion_trabajo || '', W - 4);
      doc.text(linWork.slice(0, 2), M + 2, y + 7.5);
      if (o.refaccion_utilizada) {
        doc.setFont('helvetica', 'bold'); doc.text('Refacción: ', M + 2, y + 14);
        doc.setFont('helvetica', 'normal'); doc.text(o.refaccion_utilizada, M + 22, y + 14);
      }
      y += 21;
    } else {
      // Líneas de firma
      doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.3);
      const fY = y + 10;
      doc.line(M,         fY, M + 55,     fY);
      doc.line(M + 65,    fY, M + 120,    fY);
      doc.line(M + 130,   fY, M + W,      fY);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(100, 100, 100);
      doc.text('Solicitante',    M + 20,       fY + 3.5, { align: 'center' });
      doc.text('Técnico',        M + 92,       fY + 3.5, { align: 'center' });
      doc.text('Vo.Bo. Supervisor', M + W - 15, fY + 3.5, { align: 'center' });
      y += 16;
    }

    // ── Pie de página con código ────────────────────────────────────────────
    const footerY = yBase + COPY_H - 4;
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
    doc.line(M, footerY - 1, PW - M, footerY - 1);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5); doc.setTextColor(150, 150, 150);
    doc.text(FOOTER_CODE, PW - M, footerY + 1, { align: 'right' });
    doc.text(`Folio: ${o.folio}`, M, footerY + 1);
  };

  // Línea divisoria entre las dos copias
  doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.5);
  // Dibujar línea punteada al centro
  for (let x = M; x < PW - M; x += 5) {
    doc.line(x, COPY_H, x + 3, COPY_H);
  }
  // Tijeras en el centro
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150, 150, 150);
  doc.text('✂', PW / 2, COPY_H + 0.5, { align: 'center' });

  // Dibujar original (mitad superior) y copia (mitad inferior)
  drawCopy(0, 'ORIGINAL');
  drawCopy(COPY_H, 'COPIA');

  if (descarga) {
    doc.save(`OT-${o.folio}.pdf`);
  } else {
    const url = doc.output('bloburl');
    window.open(url, '_blank');
  }
}

// ── POLLING URGENCIAS ─────────────────────────────────────────────────────────
function startUrgenciasPolling() {
  if (state.alertaPolling) clearInterval(state.alertaPolling);
  state.ultimaUrgencia = new Date(Date.now() - 60000).toISOString();
  state.alertaPolling = setInterval(async () => {
    try {
      const nuevas = await apiFetch(`/ordenes/urgencias-nuevas?desde=${state.ultimaUrgencia}`);
      if (nuevas.length) {
        state.ultimaUrgencia = new Date().toISOString();
        nuevas.forEach(o => mostrarAlertaUrgencia(o));
      }
    } catch { /* silencioso */ }
  }, 30000);
}

function mostrarAlertaUrgencia(o) {
  // Sonido
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [440, 550, 440].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; gain.gain.value = 0.3;
      osc.start(ctx.currentTime + i * 0.25);
      osc.stop(ctx.currentTime + i * 0.25 + 0.2);
    });
  } catch {}

  const alertEl = document.createElement('div');
  alertEl.className = 'mant-alert-urgente';
  alertEl.innerHTML = `
    <div style="font-weight:700;font-size:14px;margin-bottom:4px">🚨 NUEVA URGENCIA</div>
    <div style="font-size:13px;margin-bottom:2px">${escHtml(o.equipo_nombre)}</div>
    <div style="font-size:12px;opacity:.9">${escHtml((o.descripcion_falla||'').slice(0,80))}</div>
    <button onclick="this.parentElement.remove()" style="margin-top:8px;background:rgba(255,255,255,.2);border:none;color:white;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px">Entendido</button>`;
  document.getElementById('mant-alerts').appendChild(alertEl);
  setTimeout(() => alertEl.remove(), 15000);
}

// ── Init ──────────────────────────────────────────────────────────────────────
if (loadSession()) {
  // Refrescar rol desde servidor (por si cambió desde el panel de admin)
  apiFetch('/auth/me').then(me => {
    if (me && me.mant_role) {
      state.user = { ...state.user, ...me };
      sessionStorage.setItem('mant_user', JSON.stringify(state.user));
    }
    render();
  }).catch(() => render());
} else {
  renderLogin();
}
