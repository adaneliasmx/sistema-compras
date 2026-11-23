/* ===================================================================
   Inventario con App - Cuesto/SKF
   v2.0.0 - Material Procesado + Material Virgen + Sesiones Compartidas
   =================================================================== */

const APP_VERSION = '2.0.0';
const LS_UBIS = 'invapp_ubicaciones';
const LS_HISTORY = 'invapp_historial';
const SS_TOKEN = 'invapp_token';
const SS_USER = 'invapp_user';

// ── Auth State ──────────────────────────────────────────────────
let authToken = sessionStorage.getItem(SS_TOKEN) || '';
let authUser = sessionStorage.getItem(SS_USER) || '';

// ── App State ───────────────────────────────────────────────────
let ubicaciones = JSON.parse(localStorage.getItem(LS_UBIS) || '[]');
let historial = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]');
let currentTipo = null;          // 'procesado' | 'virgen'
let currentSessionId = null;     // server session id
let currentSessionName = '';
let ubicacionActual = null;
let escaneos = [];
let codigosRegistrados = new Set();
let connectedUsers = 0;
let connectedUserNames = [];
let scanning = false;
let paused = false;
let html5QrCode = null;
let lastScanTime = 0;
let pollTimer = null;
const SCAN_COOLDOWN = 1500;
const POLL_INTERVAL = 2500;

// ── Audio ───────────────────────────────────────────────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function beepSuccess() {
  try {
    const ctx = getAudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 1200;
    g.gain.value = 0.3;
    o.start(); o.stop(ctx.currentTime + 0.12);
  } catch (e) {}
}

function beepError() {
  try {
    const ctx = getAudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'square'; o.frequency.value = 400;
    g.gain.value = 0.3;
    o.start(); o.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

function vibrate(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

// ── API Helper ──────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'x-invapp-token': authToken }
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const resp = await fetch('/api/invapp' + path, opts);
    return await resp.json();
  } catch (e) {
    return { ok: false, error: 'Error de conexion' };
  }
}

// ── QR Parsers ──────────────────────────────────────────────────

// Procesado: 12 campos, separador auto-detectado
const SEPARADORES = ['\x1d', '\x1e', '"', '\t', '|', '@', '~', '\u00f1', ';', ',', '/', '-'];

function detectarSeparador(raw, camposEsperados) {
  for (const sep of SEPARADORES) {
    if (!raw.includes(sep)) continue;
    let rc = raw;
    while (rc.startsWith(sep)) rc = rc.slice(sep.length);
    while (rc.endsWith(sep)) rc = rc.slice(0, -sep.length);
    rc = rc.trim();
    const partes = rc.split(sep);
    const limpio = partes.map(p => p.trim());
    let n = limpio.length;
    let nNV = limpio.filter(p => p).length;
    const pref = limpio.length > 0 && limpio[0].toUpperCase() === 'CUESTO';
    if (pref) { n -= 1; nNV = limpio.slice(1).filter(p => p).length; }
    if (n >= camposEsperados || nNV === camposEsperados) return sep;
  }
  throw new Error('No se pudo detectar el separador del QR');
}

function parsearQRProcesado(raw) {
  const sep = detectarSeparador(raw, 12);
  let rc = raw;
  while (rc.startsWith(sep)) rc = rc.slice(sep.length);
  while (rc.endsWith(sep)) rc = rc.slice(0, -sep.length);
  rc = rc.trim();
  let partes = rc.split(sep).map(p => p.trim());
  if (partes.length > 0 && partes[0].toUpperCase() === 'CUESTO') partes = partes.slice(1);
  if (partes.length < 12) throw new Error('Se esperaban 12 campos, se obtuvieron ' + partes.length);
  if (partes[5] === '') partes[5] = '0';
  return partes.slice(0, 12);
}
// campos[]: 0=codigo, 1=lote, 2=skf, 3=componente, 4=peso, 5=p_u,
//           6=cantidad, 7=op_empaque, 8=proceso, 9=acabado, 10=fecha, 11=hora

// Virgen: campos separados por @
// Format: SKF@DISPATCH@LOTE@COMPONENTE@CANTIDAD@extra@FECHA_HORA
function parsearQRVirgen(raw) {
  let parts = raw.split('@').map(p => p.trim());
  if (parts.length < 6) throw new Error('Se esperaban al menos 6 campos, se obtuvieron ' + parts.length);
  if (parts.length === 6) {
    // [SKF, DISPATCH, LOTE, COMPONENTE, CANTIDAD, FECHA_HORA]
    return [parts[0], parts[1], parts[2], parts[3], parts[4], '', parts[5]];
  }
  // 7+ fields: join index 6+ as fecha/hora
  const fechaHora = parts.slice(6).join('@').trim();
  return [parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], fechaHora];
}
// virgen[]: 0=skf, 1=dispatch, 2=lote, 3=componente, 4=cantidad, 5=extra, 6=fecha_hora

function claveEscaneo(campos, tipo) {
  if (tipo === 'virgen') return 'V:' + campos[1]; // dispatch unico
  return 'P:' + campos[0] + '|' + campos[6] + '|' + campos[4]; // codigo|cantidad|peso
}

function getCantidad(campos, tipo) {
  if (tipo === 'virgen') return parseInt(campos[4]) || 0;
  return parseInt(campos[6]) || 0;
}

// ── Persistence ─────────────────────────────────────────────────
function saveUbicaciones() {
  localStorage.setItem(LS_UBIS, JSON.stringify(ubicaciones));
  if (authToken) {
    fetch('/api/invapp/ubicaciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-invapp-token': authToken },
      body: JSON.stringify({ ubicaciones })
    }).catch(() => {});
  }
}

async function loadUbicacionesFromServer() {
  if (!authToken) return;
  try {
    const resp = await fetch('/api/invapp/ubicaciones', { headers: { 'x-invapp-token': authToken } });
    const data = await resp.json();
    if (data.ok && Array.isArray(data.ubicaciones)) {
      const serverSet = new Set(data.ubicaciones);
      const localOnly = ubicaciones.filter(u => !serverSet.has(u));
      ubicaciones = [...data.ubicaciones, ...localOnly];
      localStorage.setItem(LS_UBIS, JSON.stringify(ubicaciones));
      if (localOnly.length > 0) saveUbicaciones();
    }
  } catch (e) {}
}

function saveHistorial() { localStorage.setItem(LS_HISTORY, JSON.stringify(historial)); }

// Migrate old 'invapp_sesiones' to 'invapp_historial'
function migrateOldSessions() {
  const old = localStorage.getItem('invapp_sesiones');
  if (old) {
    try {
      const arr = JSON.parse(old);
      if (Array.isArray(arr) && arr.length > 0) {
        for (const s of arr) { if (!s.tipo) s.tipo = 'procesado'; }
        historial = [...arr, ...historial];
        saveHistorial();
      }
    } catch (e) {}
    localStorage.removeItem('invapp_sesiones');
  }
}

// ── Render helpers ──────────────────────────────────────────────
const $ = sel => document.querySelector(sel);
function render(html) { document.getElementById('app').innerHTML = html; }

// ================================================================
//  AUTH
// ================================================================

async function verifyToken() {
  if (!authToken) return false;
  try {
    const resp = await fetch('/api/invapp/verify', { headers: { 'x-invapp-token': authToken } });
    const data = await resp.json();
    if (data.ok) { authUser = data.user; return true; }
  } catch (e) {}
  authToken = ''; authUser = '';
  sessionStorage.removeItem(SS_TOKEN);
  sessionStorage.removeItem(SS_USER);
  return false;
}

function showLogin(errorMsg) {
  stopCamera(); stopPolling();
  render(`
    <div class="screen" style="justify-content:center;align-items:center;min-height:100vh">
      <div style="width:100%;max-width:340px">
        <div class="home-logo">
          <h1>Inventario con App</h1>
          <p>Cuesto / SKF - Escaneo QR</p>
        </div>
        <div class="card" style="margin-top:24px">
          <h3 style="text-align:center;margin-bottom:16px">Iniciar Sesion</h3>
          ${errorMsg ? '<div class="scan-feedback error" style="margin-bottom:12px">' + errorMsg + '</div>' : ''}
          <input type="text" id="login-user" placeholder="Usuario"
                 class="login-input" autocomplete="username" autocapitalize="off" />
          <input type="password" id="login-pass" placeholder="Contrasena"
                 class="login-input" autocomplete="current-password"
                 onkeydown="if(event.key==='Enter')doLogin()" />
          <button class="btn btn-green mt-16" id="btn-login" onclick="doLogin()">Entrar</button>
        </div>
        <div class="version-footer">v${APP_VERSION}</div>
      </div>
    </div>
  `);
  document.getElementById('login-user').focus();
}

async function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!user || !pass) { showLogin('Ingresa usuario y contrasena'); return; }
  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.textContent = 'Verificando...';
  try {
    const resp = await fetch('/api/invapp/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, pass })
    });
    const data = await resp.json();
    if (data.ok) {
      authToken = data.token; authUser = data.user;
      sessionStorage.setItem(SS_TOKEN, authToken);
      sessionStorage.setItem(SS_USER, authUser);
      await loadUbicacionesFromServer();
      showHome();
    } else {
      showLogin(data.error || 'Credenciales incorrectas');
    }
  } catch (e) {
    showLogin('Error de conexion. Intenta de nuevo.');
  }
}

function logout() {
  authToken = ''; authUser = '';
  sessionStorage.removeItem(SS_TOKEN);
  sessionStorage.removeItem(SS_USER);
  showLogin();
}

// ================================================================
//  PWA INSTALL
// ================================================================
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredInstallPrompt = e;
});

function installApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(() => { deferredInstallPrompt = null; });
  } else {
    alert('Para instalar: abre el menu del navegador (3 puntos) y selecciona "Agregar a pantalla de inicio".');
  }
}

// ================================================================
//  HOME SCREEN
// ================================================================

function showHome() {
  stopCamera(); stopPolling();
  currentSessionId = null;
  const totalHist = historial.length;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  render(`
    <div class="screen">
      <div class="home-logo">
        <h1>Inventario con App</h1>
        <p>Cuesto / SKF - Escaneo QR</p>
        <p style="color:var(--green);font-size:12px;margin-top:4px">${esc(authUser)}</p>
      </div>
      <div class="home-menu">
        <div class="menu-btn" onclick="showInventarioMenu('procesado')">
          <div class="icon green">&#128230;</div>
          <div class="info">Material Procesado<small>Escaneo QR 12 campos Cuesto</small></div>
          <div class="arrow">&#8250;</div>
        </div>
        <div class="menu-btn" onclick="showInventarioMenu('virgen')">
          <div class="icon blue">&#129513;</div>
          <div class="info">Material Virgen<small>Escaneo QR dispatch SKF</small></div>
          <div class="arrow">&#8250;</div>
        </div>
        <div class="menu-btn" onclick="showHistorial()">
          <div class="icon orange">&#128203;</div>
          <div class="info">Historial<small>${totalHist} ${totalHist === 1 ? 'sesion' : 'sesiones'} guardadas</small></div>
          <div class="arrow">&#8250;</div>
        </div>
        <div class="menu-btn" onclick="showUbicaciones()">
          <div class="icon orange">&#128205;</div>
          <div class="info">Ubicaciones<small>${ubicaciones.length} configuradas</small></div>
          <div class="arrow">&#8250;</div>
        </div>
        ${!isStandalone ? `
        <div class="menu-btn" onclick="installApp()">
          <div class="icon purple">&#128241;</div>
          <div class="info">Instalar App<small>Agregar a pantalla de inicio</small></div>
          <div class="arrow">&#8250;</div>
        </div>` : ''}
      </div>
      <button class="btn btn-outline btn-sm" style="margin-top:auto;opacity:0.6" onclick="logout()">Cerrar sesion</button>
      <div class="version-footer">v${APP_VERSION}</div>
    </div>
  `);
}

// ================================================================
//  INVENTARIO MENU (per tipo)
// ================================================================

async function showInventarioMenu(tipo) {
  currentTipo = tipo;
  const label = tipo === 'procesado' ? 'Material Procesado' : 'Material Virgen';
  const icon = tipo === 'procesado' ? '&#128230;' : '&#129513;';

  // Fetch active sessions
  const data = await api('GET', '/sessions?tipo=' + tipo);
  const sessions = (data.ok && data.sessions) ? data.sessions.filter(s => s.totalEscaneos >= 0) : [];

  const sessionCards = sessions.map(s => `
    <div class="session-card" onclick="joinSession('${s.id}')">
      <div class="session-info">
        <div class="session-name">${esc(s.nombre)}</div>
        <div class="session-stats">${s.totalEscaneos} escaneos - ${s.totalPiezas} pzas</div>
        <div class="session-meta">por ${esc(s.createdBy)} - ${esc(s.ubicacion)}</div>
      </div>
      <div class="session-users">
        <span class="live-dot"></span>
        <span>${s.users}</span>
      </div>
    </div>
  `).join('');

  render(`
    <div class="screen">
      <div class="header">
        <button class="back-btn" onclick="showHome()">&#8249;</button>
        <h1>${label}</h1>
      </div>

      <div class="home-menu">
        <div class="menu-btn" onclick="showCrearInventario('${tipo}')">
          <div class="icon green">&#10010;</div>
          <div class="info">Crear Inventario<small>Nueva sesion de escaneo</small></div>
          <div class="arrow">&#8250;</div>
        </div>
      </div>

      ${sessions.length > 0 ? `
        <h3 class="section-title mt-16">Inventarios activos</h3>
        <div class="session-list">${sessionCards}</div>
      ` : `
        <div class="empty-state" style="padding:30px 20px">
          <p style="font-size:13px">No hay inventarios activos.<br>Crea uno nuevo para comenzar.</p>
        </div>
      `}
    </div>
  `);
}

// ================================================================
//  CREAR INVENTARIO
// ================================================================

function showCrearInventario(tipo) {
  currentTipo = tipo;
  const label = tipo === 'procesado' ? 'Material Procesado' : 'Material Virgen';
  const ahora = new Date();
  const defName = 'Inv ' + ahora.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) + ' ' +
    ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  if (ubicaciones.length === 0) {
    render(`
      <div class="screen">
        <div class="header">
          <button class="back-btn" onclick="showInventarioMenu('${tipo}')">&#8249;</button>
          <h1>Crear Inventario</h1>
        </div>
        <div class="empty-state">
          <div class="icon">&#128205;</div>
          <p>No hay ubicaciones configuradas.<br>Agrega al menos una primero.</p>
          <button class="btn btn-green mt-16" onclick="showUbicaciones()">Ir a Ubicaciones</button>
        </div>
      </div>
    `);
    return;
  }

  const sel = ubicacionActual || ubicaciones[0];
  const ubiItems = ubicaciones.map(u => `
    <div class="ubi-radio ${u === sel ? 'selected' : ''}" onclick="selectUbi(this, '${esc(u)}')">
      <div class="dot"></div>
      <span>${esc(u)}</span>
    </div>
  `).join('');

  render(`
    <div class="screen">
      <div class="header">
        <button class="back-btn" onclick="showInventarioMenu('${tipo}')">&#8249;</button>
        <h1>Crear - ${label}</h1>
      </div>

      <div class="card">
        <h3>Nombre del inventario</h3>
        <input type="text" id="inv-name" class="login-input" value="${esc(defName)}"
               style="margin-bottom:0" />
      </div>

      <p style="color:var(--text2);font-size:13px;margin-bottom:8px">
        Ubicacion principal (puedes cambiarla durante el escaneo):
      </p>
      <div class="ubi-select-list">${ubiItems}</div>

      <div class="add-row mb-16">
        <input type="text" id="quick-ubi" placeholder="O crea una nueva..."
               onkeydown="if(event.key==='Enter')quickAddUbiCrear()" />
        <button onclick="quickAddUbiCrear()">+ Crear</button>
      </div>

      <button class="btn btn-green" id="btn-crear" onclick="crearInventario()">Crear e Iniciar Escaneo</button>
    </div>
  `);
  ubicacionActual = sel;
}

function selectUbi(el, name) {
  document.querySelectorAll('.ubi-radio').forEach(r => r.classList.remove('selected'));
  el.classList.add('selected');
  ubicacionActual = name;
}

function quickAddUbiCrear() {
  const inp = document.getElementById('quick-ubi');
  const val = inp.value.trim();
  if (!val) return;
  if (ubicaciones.some(u => u.toLowerCase() === val.toLowerCase())) { alert('Ya existe.'); return; }
  ubicaciones.push(val);
  saveUbicaciones();
  ubicacionActual = val;
  showCrearInventario(currentTipo);
}

async function crearInventario() {
  if (!ubicacionActual) { alert('Selecciona una ubicacion.'); return; }
  const nombre = (document.getElementById('inv-name').value || '').trim() || 'Inventario';
  const btn = document.getElementById('btn-crear');
  btn.disabled = true; btn.textContent = 'Creando...';

  const data = await api('POST', '/sessions', { tipo: currentTipo, nombre, ubicacion: ubicacionActual });
  if (!data.ok) { alert(data.error || 'Error al crear sesion'); btn.disabled = false; btn.textContent = 'Crear e Iniciar Escaneo'; return; }

  currentSessionId = data.id;
  currentSessionName = data.nombre || nombre;
  escaneos = [];
  codigosRegistrados = new Set();
  connectedUsers = 1;
  showEscaneo();
}

// ================================================================
//  JOIN SESSION
// ================================================================

async function joinSession(id) {
  const data = await api('POST', '/sessions/' + id + '/join');
  if (!data.ok) { alert(data.error || 'No se pudo unir'); return; }
  currentTipo = data.tipo;
  currentSessionId = data.id;
  currentSessionName = data.nombre;
  ubicacionActual = data.ubicacion || (ubicaciones[0] || '');
  escaneos = [];
  codigosRegistrados = new Set();
  connectedUsers = 1;
  // Load current state
  const state = await api('GET', '/sessions/' + id + '/state?after=0');
  if (state.ok && state.newEscaneos) {
    for (const e of state.newEscaneos) {
      escaneos.push(e);
      if (e.clave) codigosRegistrados.add(e.clave);
    }
    connectedUsers = state.users || 1;
    connectedUserNames = state.userNames || [];
  }
  showEscaneo();
}

// ================================================================
//  UBICACIONES CRUD
// ================================================================

function showUbicaciones() {
  stopCamera(); stopPolling();
  const items = ubicaciones.map((u, i) => `
    <div class="ubi-item" id="ubi-${i}">
      <div class="name" id="ubi-name-${i}">${esc(u)}</div>
      <div class="actions">
        <button onclick="editarUbi(${i})" title="Editar">&#9998;</button>
        <button class="del" onclick="borrarUbi(${i})" title="Borrar">&#10005;</button>
      </div>
    </div>
  `).join('');

  render(`
    <div class="screen">
      <div class="header">
        <button class="back-btn" onclick="showHome()">&#8249;</button>
        <h1>Ubicaciones</h1>
        <span class="badge">${ubicaciones.length}</span>
      </div>
      <div class="card">
        ${ubicaciones.length === 0
          ? '<p style="color:var(--text2);text-align:center;padding:20px">No hay ubicaciones. Agrega una abajo.</p>'
          : '<div class="ubi-list">' + items + '</div>'}
      </div>
      <div class="add-row">
        <input type="text" id="new-ubi" placeholder="Nueva ubicacion..."
               onkeydown="if(event.key==='Enter')agregarUbi()" />
        <button onclick="agregarUbi()">+ Agregar</button>
      </div>
    </div>
  `);
}

function agregarUbi() {
  const inp = document.getElementById('new-ubi');
  const val = inp.value.trim();
  if (!val) return;
  if (ubicaciones.some(u => u.toLowerCase() === val.toLowerCase())) { alert('Ya existe.'); return; }
  ubicaciones.push(val);
  saveUbicaciones();
  showUbicaciones();
}

function editarUbi(i) {
  const nameEl = document.getElementById('ubi-name-' + i);
  const current = ubicaciones[i];
  nameEl.innerHTML = '<input class="edit-input" id="edit-inp-' + i + '" value="' + esc(current) + '" ' +
    'onkeydown="if(event.key===\'Enter\')guardarEditUbi(' + i + ');if(event.key===\'Escape\')showUbicaciones()" />';
  document.getElementById('edit-inp-' + i).focus();
  document.getElementById('edit-inp-' + i).select();
}

function guardarEditUbi(i) {
  const inp = document.getElementById('edit-inp-' + i);
  const val = inp.value.trim();
  if (!val) return;
  if (ubicaciones.some((u, j) => j !== i && u.toLowerCase() === val.toLowerCase())) { alert('Ya existe.'); return; }
  ubicaciones[i] = val;
  saveUbicaciones();
  showUbicaciones();
}

function borrarUbi(i) {
  if (!confirm('Borrar ubicacion "' + ubicaciones[i] + '"?')) return;
  ubicaciones.splice(i, 1);
  saveUbicaciones();
  showUbicaciones();
}

// ================================================================
//  SCAN SCREEN
// ================================================================

function showEscaneo() {
  paused = false;
  scanning = false;

  const tipoLabel = currentTipo === 'procesado' ? 'Procesado' : 'Virgen';
  const cantLabel = currentTipo === 'procesado' ? 'Contenedores' : 'Dispatches';
  const recentHtml = buildRecentList();
  const totalPiezas = escaneos.reduce((s, e) => s + (e.cantidad || getCantidad(e.campos, currentTipo)), 0);

  render(`
    <div class="screen" style="padding-bottom:0">
      <div class="scan-header">
        <button class="back-btn" onclick="confirmarSalirEscaneo()">&#8249;</button>
        <div class="scan-title-wrap">
          <span class="scan-session-name">${esc(currentSessionName)}</span>
          <span class="tipo-badge ${currentTipo}">${tipoLabel}</span>
        </div>
        <div class="users-badge" id="users-badge" title="Usuarios conectados">
          <span class="live-dot"></span>
          <span id="users-count">${connectedUsers}</span>
        </div>
      </div>

      <div class="scan-location loc-wrap" style="margin-bottom:4px">
        <span>&#128205;</span>
        <span class="loc-name" onclick="toggleLocDropdown()">${esc(ubicacionActual)}</span>
        <div class="loc-dropdown" id="loc-dd" style="display:none"></div>
      </div>

      <div class="scan-counters">
        <div class="counter-box">
          <div class="num green" id="cnt-cont">${escaneos.length}</div>
          <div class="lbl">${cantLabel}</div>
        </div>
        <div class="counter-box">
          <div class="num blue" id="cnt-pzas">${totalPiezas}</div>
          <div class="lbl">Piezas</div>
        </div>
      </div>

      <div id="reader-wrapper">
        <div id="reader"></div>
      </div>

      <div class="scan-feedback idle" id="feedback">Presiona Iniciar para comenzar</div>

      <div class="recent-scans" id="recent-list">${recentHtml}</div>

      <div class="scan-bottom">
        <button class="btn btn-green" id="btn-start" onclick="startScan()">Iniciar</button>
        <button class="btn btn-orange" id="btn-pause" onclick="pauseScan()" style="display:none">Pausar</button>
        <button class="btn btn-red" id="btn-finish" onclick="finalizarEscaneo()">Finalizar</button>
      </div>
    </div>
  `);

  startPolling();
}

function updateCounters() {
  const cntEl = document.getElementById('cnt-cont');
  const pzaEl = document.getElementById('cnt-pzas');
  const usersEl = document.getElementById('users-count');
  if (cntEl) cntEl.textContent = escaneos.length;
  if (pzaEl) pzaEl.textContent = escaneos.reduce((s, e) => s + (e.cantidad || getCantidad(e.campos, currentTipo)), 0);
  if (usersEl) usersEl.textContent = connectedUsers;
}

function buildRecentList() {
  if (escaneos.length === 0) return '<p style="color:var(--text2);text-align:center;font-size:13px;padding:16px">Sin escaneos aun</p>';
  const reversed = [...escaneos].reverse().slice(0, 50);
  const items = reversed.map((e, i) => {
    const num = escaneos.length - i;
    let comp, qty;
    if (currentTipo === 'virgen') {
      comp = e.campos[3]; // componente
      qty = e.campos[4]; // cantidad
    } else {
      comp = e.campos[3]; // componente
      qty = e.campos[6]; // cantidad
    }
    const userTag = e.user && e.user !== authUser ? ' <span class="user-tag">' + esc(e.user) + '</span>' : '';
    return '<div class="scan-item">' +
      '<span class="num">' + num + '</span>' +
      '<span class="comp">' + esc(comp) + userTag + '</span>' +
      '<span class="qty">' + qty + ' pz</span>' +
      '<span class="loc-tag">' + esc(e.ubicacion) + '</span>' +
      '</div>';
  }).join('');
  return '<h4>Escaneos (' + escaneos.length + ')</h4>' + items;
}

function updateRecentList() {
  const el = document.getElementById('recent-list');
  if (el) el.innerHTML = buildRecentList();
}

function setFeedback(msg, type) {
  const el = document.getElementById('feedback');
  if (!el) return;
  el.className = 'scan-feedback ' + type;
  el.textContent = msg;
}

// ── Camera control ──────────────────────────────────────────────

async function startScan() {
  if (scanning && !paused) return;

  if (paused) {
    paused = false;
    try { await html5QrCode.resume(); } catch (e) {}
    const overlay = document.querySelector('.paused-overlay');
    if (overlay) overlay.remove();
    document.getElementById('btn-pause').textContent = 'Pausar';
    document.getElementById('btn-pause').className = 'btn btn-orange';
    setFeedback('Escaneando...', 'idle');
    return;
  }

  scanning = true;
  document.getElementById('btn-start').style.display = 'none';
  document.getElementById('btn-pause').style.display = '';
  setFeedback('Iniciando camara...', 'idle');

  if (typeof Html5Qrcode === 'undefined') {
    setFeedback('Error: libreria QR no cargada. Recarga la pagina.', 'error');
    scanning = false;
    document.getElementById('btn-start').style.display = '';
    document.getElementById('btn-pause').style.display = 'none';
    return;
  }

  try {
    html5QrCode = new Html5Qrcode('reader');
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
      onScanSuccess,
      () => {}
    );
    setFeedback('Escaneando... apunta al codigo QR', 'idle');
  } catch (err) {
    setFeedback('Error al acceder a la camara: ' + err, 'error');
    scanning = false;
    document.getElementById('btn-start').style.display = '';
    document.getElementById('btn-pause').style.display = 'none';
  }
}

async function pauseScan() {
  if (!scanning) return;
  if (!paused) {
    paused = true;
    try { await html5QrCode.pause(true); } catch (e) {}
    const wrapper = document.getElementById('reader-wrapper');
    if (wrapper && !wrapper.querySelector('.paused-overlay')) {
      const ov = document.createElement('div');
      ov.className = 'paused-overlay';
      ov.innerHTML = '<span>EN PAUSA</span>';
      wrapper.appendChild(ov);
    }
    document.getElementById('btn-pause').textContent = 'Reanudar';
    document.getElementById('btn-pause').className = 'btn btn-green';
    setFeedback('Escaneo en pausa', 'warn');
  } else {
    startScan();
  }
}

async function stopCamera() {
  if (html5QrCode) {
    try {
      const state = html5QrCode.getState();
      if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
        await html5QrCode.stop();
      }
    } catch (e) {}
    try { html5QrCode.clear(); } catch (e) {}
    html5QrCode = null;
  }
  scanning = false;
  paused = false;
}

// ── On QR scanned ───────────────────────────────────────────────

async function onScanSuccess(decodedText) {
  const now = Date.now();
  if (now - lastScanTime < SCAN_COOLDOWN) return;
  lastScanTime = now;

  try {
    let campos;
    if (currentTipo === 'virgen') {
      campos = parsearQRVirgen(decodedText);
    } else {
      campos = parsearQRProcesado(decodedText);
    }

    const clave = claveEscaneo(campos, currentTipo);
    const cantidad = getCantidad(campos, currentTipo);

    // Quick local duplicate check
    if (codigosRegistrados.has(clave)) {
      beepError();
      vibrate([100, 50, 100]);
      const dupName = currentTipo === 'virgen' ? campos[1] : campos[0];
      setFeedback('DUPLICADO: ' + dupName + ' - ' + campos[3], 'error');
      flashReader('flash-red');
      return;
    }

    // Send to server for authoritative duplicate check
    const result = await api('POST', '/sessions/' + currentSessionId + '/scan', {
      clave, campos, ubicacion: ubicacionActual, cantidad
    });

    if (!result.ok) {
      if (result.duplicate) {
        codigosRegistrados.add(clave); // sync local
        beepError();
        vibrate([100, 50, 100]);
        const dupName = currentTipo === 'virgen' ? campos[1] : campos[0];
        setFeedback('DUPLICADO (otro dispositivo): ' + dupName, 'error');
        flashReader('flash-red');
      } else {
        beepError();
        setFeedback('Error servidor: ' + (result.error || 'desconocido'), 'error');
      }
      return;
    }

    // Success
    codigosRegistrados.add(clave);
    escaneos.push({
      campos, clave, ubicacion: ubicacionActual, user: authUser,
      cantidad,
      fechaEscaneo: new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      horaEscaneo: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });

    beepSuccess();
    vibrate(80);
    const compName = campos[3];
    const idName = currentTipo === 'virgen' ? campos[1] : campos[0];
    setFeedback('OK: ' + compName + ' - ' + cantidad + ' pz (' + idName + ')', 'success');
    flashReader('flash-green');
    updateCounters();
    updateRecentList();

  } catch (err) {
    beepError();
    vibrate([100, 50, 100]);
    setFeedback('Codigo invalido: ' + err.message, 'error');
    flashReader('flash-red');
  }
}

function flashReader(cls) {
  const el = document.getElementById('reader-wrapper');
  if (!el) return;
  el.classList.remove('flash-green', 'flash-red');
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 600);
}

// ── Polling ─────────────────────────────────────────────────────

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollState, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollState() {
  if (!currentSessionId) return;
  const data = await api('GET', '/sessions/' + currentSessionId + '/state?after=' + escaneos.length);
  if (!data.ok) return;

  connectedUsers = data.users || 0;
  connectedUserNames = data.userNames || [];

  // Add new scans from other users
  if (data.newEscaneos && data.newEscaneos.length > 0) {
    for (const e of data.newEscaneos) {
      escaneos.push(e);
      if (e.clave) codigosRegistrados.add(e.clave);
    }
    updateRecentList();
  }

  updateCounters();

  // Session finished by another user
  if (!data.active) {
    stopPolling();
    await stopCamera();
    showModal('Inventario finalizado', 'Otro usuario finalizo este inventario.', [
      { text: 'Ver Reporte', cls: 'btn-green', action: () => { hideModal(); guardarYMostrarReporte(); } }
    ]);
  }
}

// ── Location change during scan ─────────────────────────────────

function toggleLocDropdown() {
  const dd = document.getElementById('loc-dd');
  if (!dd) return;
  if (dd.style.display === 'none') {
    dd.style.display = 'block';
    dd.innerHTML = ubicaciones.map(u =>
      '<div class="loc-opt ' + (u === ubicacionActual ? 'active' : '') + '" ' +
      'onclick="cambiarUbiEscaneo(\'' + esc(u) + '\')">' + esc(u) + '</div>'
    ).join('');
  } else {
    dd.style.display = 'none';
  }
}

function cambiarUbiEscaneo(name) {
  ubicacionActual = name;
  const dd = document.getElementById('loc-dd');
  if (dd) dd.style.display = 'none';
  const locEl = document.querySelector('.loc-name');
  if (locEl) locEl.textContent = name;
}

// ── Exit / Finalize scan ────────────────────────────────────────

function confirmarSalirEscaneo() {
  if (escaneos.length === 0) {
    stopCamera(); stopPolling();
    if (currentSessionId) api('POST', '/sessions/' + currentSessionId + '/leave');
    showHome();
    return;
  }
  showModal('Salir del escaneo',
    'Tienes ' + escaneos.length + ' escaneos. Si sales sin finalizar, otros usuarios podran continuar.',
    [
      { text: 'Cancelar', cls: 'btn-outline', action: hideModal },
      { text: 'Salir', cls: 'btn-red', action: () => {
        hideModal(); stopCamera(); stopPolling();
        api('POST', '/sessions/' + currentSessionId + '/leave');
        showHome();
      }}
    ]
  );
}

function finalizarEscaneo() {
  if (escaneos.length === 0) { alert('No hay escaneos para guardar.'); return; }
  showModal('Finalizar escaneo',
    'Se guardaran ' + escaneos.length + ' escaneos y se cerrara la sesion para todos. Continuar?',
    [
      { text: 'Cancelar', cls: 'btn-outline', action: hideModal },
      { text: 'Finalizar', cls: 'btn-green', action: () => { hideModal(); doFinalizarEscaneo(); } }
    ]
  );
}

async function doFinalizarEscaneo() {
  await stopCamera();
  stopPolling();

  // Finish on server and get final data
  const result = await api('POST', '/sessions/' + currentSessionId + '/finish');
  if (result.ok && result.escaneos) {
    escaneos = result.escaneos; // use server's authoritative list
  }

  guardarYMostrarReporte();
}

function guardarYMostrarReporte() {
  const ahora = new Date();
  const totalPiezas = escaneos.reduce((s, e) => s + (e.cantidad || getCantidad(e.campos, currentTipo)), 0);
  const sesion = {
    id: Date.now(),
    tipo: currentTipo,
    nombre: currentSessionName,
    fecha: ahora.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    hora: ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    totalContenedores: escaneos.length,
    totalPiezas,
    ubicaciones: [...new Set(escaneos.map(e => e.ubicacion))],
    escaneos: escaneos.map(e => ({ ...e }))
  };

  historial.unshift(sesion);
  if (historial.length > 50) historial.length = 50; // keep last 50
  saveHistorial();
  showReporte(sesion);
}

// ================================================================
//  REPORT SCREEN
// ================================================================

function showReporte(sesion) {
  stopCamera(); stopPolling();
  const tipo = sesion.tipo || 'procesado';
  const tipoLabel = tipo === 'procesado' ? 'Material Procesado' : 'Material Virgen';

  // Summary by component
  const porComp = {};
  for (const e of sesion.escaneos) {
    const comp = e.campos[3] || 'Sin componente';
    const cant = e.cantidad || getCantidad(e.campos, tipo);
    if (!porComp[comp]) porComp[comp] = { count: 0, piezas: 0 };
    porComp[comp].count += 1;
    porComp[comp].piezas += cant;
  }

  // Summary by location
  const porUbi = {};
  for (const e of sesion.escaneos) {
    const ubi = e.ubicacion || '-';
    const cant = e.cantidad || getCantidad(e.campos, tipo);
    if (!porUbi[ubi]) porUbi[ubi] = { count: 0, piezas: 0 };
    porUbi[ubi].count += 1;
    porUbi[ubi].piezas += cant;
  }

  const compRows = Object.keys(porComp).sort().map(k =>
    '<tr><td>' + esc(k) + '</td><td style="text-align:center">' + porComp[k].count +
    '</td><td style="text-align:right">' + porComp[k].piezas + '</td></tr>'
  ).join('');

  const ubiRows = Object.keys(porUbi).sort().map(k =>
    '<tr><td>' + esc(k) + '</td><td style="text-align:center">' + porUbi[k].count +
    '</td><td style="text-align:right">' + porUbi[k].piezas + '</td></tr>'
  ).join('');

  // Detail rows
  let detailHeaders, detailRows;
  if (tipo === 'virgen') {
    detailHeaders = '<th>#</th><th>Ubicacion</th><th>SKF</th><th>Dispatch</th><th>Lote</th>' +
      '<th>Componente</th><th>Cantidad</th><th>Fecha Recibo</th><th>Escaneado por</th><th>Fecha Esc.</th><th>Hora Esc.</th>';
    detailRows = sesion.escaneos.map((e, i) => {
      const fh = splitFechaHora(e.campos[6] || '');
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(e.ubicacion) + '</td><td>' + esc(e.campos[0]) +
        '</td><td>' + esc(e.campos[1]) + '</td><td>' + esc(e.campos[2]) + '</td><td>' + esc(e.campos[3]) +
        '</td><td>' + e.campos[4] + '</td><td>' + esc(fh.fecha + ' ' + fh.hora) +
        '</td><td>' + esc(e.user || '') + '</td><td>' + esc(e.fechaEscaneo || '') +
        '</td><td>' + esc(e.horaEscaneo || '') + '</td></tr>';
    }).join('');
  } else {
    detailHeaders = '<th>#</th><th>Ubicacion</th><th>Codigo</th><th>Lote</th><th>SKF</th>' +
      '<th>Componente</th><th>Peso</th><th>P/U</th><th>Cant.</th><th>Op.Empaque</th><th>Proceso</th>' +
      '<th>Acabado</th><th>Fecha QR</th><th>Hora QR</th><th>Escaneado por</th><th>Fecha Esc.</th><th>Hora Esc.</th>';
    detailRows = sesion.escaneos.map((e, i) =>
      '<tr><td>' + (i + 1) + '</td><td>' + esc(e.ubicacion) + '</td><td>' + esc(e.campos[0]) +
      '</td><td>' + esc(e.campos[1]) + '</td><td>' + esc(e.campos[2]) + '</td><td>' + esc(e.campos[3]) +
      '</td><td>' + e.campos[4] + '</td><td>' + e.campos[5] + '</td><td>' + e.campos[6] +
      '</td><td>' + esc(e.campos[7]) + '</td><td>' + esc(e.campos[8]) + '</td><td>' + esc(e.campos[9]) +
      '</td><td>' + esc(e.campos[10]) + '</td><td>' + esc(e.campos[11]) +
      '</td><td>' + esc(e.user || '') + '</td><td>' + esc(e.fechaEscaneo || '') +
      '</td><td>' + esc(e.horaEscaneo || '') + '</td></tr>'
    ).join('');
  }

  const countLabel = tipo === 'procesado' ? 'contenedores' : 'dispatches';

  render(`
    <div class="screen">
      <div class="header">
        <button class="back-btn" onclick="showHome()">&#8249;</button>
        <h1>Reporte de Inventario</h1>
      </div>

      <div class="report-header-info">
        <div class="tag"><span class="tipo-badge ${tipo}" style="font-size:11px">${tipoLabel}</span></div>
        <div class="tag"><strong>${sesion.fecha}</strong> ${sesion.hora}</div>
        <div class="tag"><strong>${sesion.totalContenedores}</strong> ${countLabel}</div>
        <div class="tag"><strong>${sesion.totalPiezas}</strong> piezas</div>
      </div>
      ${sesion.nombre ? '<p style="color:var(--text2);font-size:13px;margin-bottom:8px">' + esc(sesion.nombre) + '</p>' : ''}

      <div class="card">
        <h3>Resumen por Componente</h3>
        <table class="report-table">
          <thead><tr><th>Componente</th><th style="text-align:center">Cant.</th><th style="text-align:right">Piezas</th></tr></thead>
          <tbody>
            ${compRows}
            <tr class="total-row">
              <td>TOTAL</td>
              <td style="text-align:center">${sesion.totalContenedores}</td>
              <td style="text-align:right">${sesion.totalPiezas}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3>Resumen por Ubicacion</h3>
        <table class="report-table">
          <thead><tr><th>Ubicacion</th><th style="text-align:center">Cant.</th><th style="text-align:right">Piezas</th></tr></thead>
          <tbody>
            ${ubiRows}
            <tr class="total-row">
              <td>TOTAL</td>
              <td style="text-align:center">${sesion.totalContenedores}</td>
              <td style="text-align:right">${sesion.totalPiezas}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3>Detalle de Escaneos</h3>
        <div class="detail-table-wrap">
          <table class="detail-table">
            <thead><tr>${detailHeaders}</tr></thead>
            <tbody>${detailRows}</tbody>
          </table>
        </div>
      </div>

      <div class="btn-row mt-16 mb-16">
        <button class="btn btn-blue" onclick="descargarExcel(${sesion.id})">Descargar Excel</button>
        <button class="btn btn-green" onclick="compartirExcel(${sesion.id})">Compartir</button>
      </div>
      <button class="btn btn-outline mb-16" onclick="showHome()">Volver al inicio</button>
    </div>
  `);
}

// ================================================================
//  HISTORY
// ================================================================

function showHistorial() {
  stopCamera(); stopPolling();
  if (historial.length === 0) {
    render(`
      <div class="screen">
        <div class="header">
          <button class="back-btn" onclick="showHome()">&#8249;</button>
          <h1>Historial</h1>
        </div>
        <div class="empty-state">
          <div class="icon">&#128203;</div>
          <p>No hay sesiones guardadas aun.<br>Realiza tu primer inventario.</p>
        </div>
      </div>
    `);
    return;
  }

  const items = historial.map(s => {
    const tipo = s.tipo || 'procesado';
    const tipoLabel = tipo === 'procesado' ? 'Procesado' : 'Virgen';
    return '<div class="history-item" onclick="verSesion(' + s.id + ')">' +
      '<div class="date">' + s.fecha + ' - ' + s.hora +
      ' <span class="tipo-badge ' + tipo + '" style="font-size:10px;vertical-align:middle">' + tipoLabel + '</span></div>' +
      '<div class="stats">' + s.totalContenedores + ' escaneos - ' + s.totalPiezas + ' piezas</div>' +
      '<div class="ubis">Ubicaciones: ' + (s.ubicaciones || []).join(', ') + '</div>' +
      (s.nombre ? '<div class="ubis" style="color:var(--text2)">' + esc(s.nombre) + '</div>' : '') +
      '</div>';
  }).join('');

  render(`
    <div class="screen">
      <div class="header">
        <button class="back-btn" onclick="showHome()">&#8249;</button>
        <h1>Historial</h1>
        <span class="badge">${historial.length}</span>
      </div>
      ${items}
      <button class="btn btn-outline btn-sm mt-16" onclick="confirmarBorrarHistorial()">Borrar todo el historial</button>
    </div>
  `);
}

function verSesion(id) {
  const sesion = historial.find(s => s.id === id);
  if (sesion) showReporte(sesion);
}

function confirmarBorrarHistorial() {
  showModal('Borrar historial', 'Se eliminaran todas las sesiones guardadas. No se puede deshacer.', [
    { text: 'Cancelar', cls: 'btn-outline', action: hideModal },
    { text: 'Borrar todo', cls: 'btn-red', action: () => { historial = []; saveHistorial(); hideModal(); showHistorial(); } }
  ]);
}

// ================================================================
//  EXCEL GENERATION
// ================================================================

function buildWorkbook(sesion) {
  const tipo = sesion.tipo || 'procesado';
  if (tipo === 'virgen') return buildWorkbookVirgen(sesion);
  return buildWorkbookProcesado(sesion);
}

function buildWorkbookProcesado(sesion) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Detalle
  const detData = [
    ['#', 'Ubicacion', 'Codigo', 'Lote', 'SKF', 'Componente', 'Peso', 'P/U', 'Cantidad',
     'Op.Empaque', 'Proceso', 'Acabado', 'Fecha QR', 'Hora QR', 'Escaneado por', 'Fecha Escaneo', 'Hora Escaneo']
  ];
  sesion.escaneos.forEach((e, i) => {
    detData.push([
      i + 1, e.ubicacion, e.campos[0], e.campos[1], e.campos[2], e.campos[3],
      parseFloat(e.campos[4]) || 0, parseFloat(e.campos[5]) || 0, parseInt(e.campos[6]) || 0,
      e.campos[7], e.campos[8], e.campos[9], e.campos[10], e.campos[11],
      e.user || '', e.fechaEscaneo || '', e.horaEscaneo || ''
    ]);
  });
  const wsD = XLSX.utils.aoa_to_sheet(detData);
  wsD['!cols'] = [
    {wch:4},{wch:15},{wch:14},{wch:10},{wch:12},{wch:25},{wch:8},{wch:6},{wch:8},
    {wch:15},{wch:12},{wch:12},{wch:12},{wch:10},{wch:12},{wch:12},{wch:10}
  ];
  XLSX.utils.book_append_sheet(wb, wsD, 'Detalle');

  // Sheet 2: Resumen por Componente
  addResumenSheets(wb, sesion, 'procesado');

  return wb;
}

function buildWorkbookVirgen(sesion) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Detalle
  const detData = [
    ['#', 'Ubicacion', 'SKF', 'Dispatch', 'Lote', 'Componente', 'Cantidad',
     'Fecha Recibo', 'Hora Recibo', 'Escaneado por', 'Fecha Escaneo', 'Hora Escaneo']
  ];
  sesion.escaneos.forEach((e, i) => {
    const fh = splitFechaHora(e.campos[6] || '');
    detData.push([
      i + 1, e.ubicacion, e.campos[0], e.campos[1], e.campos[2], e.campos[3],
      parseInt(e.campos[4]) || 0, fh.fecha, fh.hora,
      e.user || '', e.fechaEscaneo || '', e.horaEscaneo || ''
    ]);
  });
  const wsD = XLSX.utils.aoa_to_sheet(detData);
  wsD['!cols'] = [
    {wch:4},{wch:15},{wch:14},{wch:12},{wch:10},{wch:12},{wch:10},
    {wch:14},{wch:14},{wch:12},{wch:12},{wch:10}
  ];
  XLSX.utils.book_append_sheet(wb, wsD, 'Detalle');

  // Sheet 2+3: Resumen
  addResumenSheets(wb, sesion, 'virgen');

  return wb;
}

function addResumenSheets(wb, sesion, tipo) {
  const porComp = {};
  for (const e of sesion.escaneos) {
    const comp = e.campos[3] || 'Sin componente';
    const cant = e.cantidad || getCantidad(e.campos, tipo);
    if (!porComp[comp]) porComp[comp] = { count: 0, piezas: 0 };
    porComp[comp].count += 1;
    porComp[comp].piezas += cant;
  }
  const countLabel = tipo === 'procesado' ? 'Contenedores' : 'Dispatches';
  const compData = [['Componente', countLabel, 'Piezas']];
  Object.keys(porComp).sort().forEach(k => { compData.push([k, porComp[k].count, porComp[k].piezas]); });
  compData.push(['TOTAL', sesion.totalContenedores, sesion.totalPiezas]);
  const wsC = XLSX.utils.aoa_to_sheet(compData);
  wsC['!cols'] = [{wch:30},{wch:14},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsC, 'Resumen Componente');

  const porUbi = {};
  for (const e of sesion.escaneos) {
    const ubi = e.ubicacion || '-';
    const cant = e.cantidad || getCantidad(e.campos, tipo);
    if (!porUbi[ubi]) porUbi[ubi] = { count: 0, piezas: 0 };
    porUbi[ubi].count += 1;
    porUbi[ubi].piezas += cant;
  }
  const ubiData = [['Ubicacion', countLabel, 'Piezas']];
  Object.keys(porUbi).sort().forEach(k => { ubiData.push([k, porUbi[k].count, porUbi[k].piezas]); });
  ubiData.push(['TOTAL', sesion.totalContenedores, sesion.totalPiezas]);
  const wsU = XLSX.utils.aoa_to_sheet(ubiData);
  wsU['!cols'] = [{wch:25},{wch:14},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsU, 'Resumen Ubicacion');
}

function nombreExcel(sesion) {
  const tipo = (sesion.tipo || 'procesado') === 'virgen' ? 'Virgen' : 'Procesado';
  const f = (sesion.fecha || '').replace(/\//g, '-');
  const h = (sesion.hora || '').replace(/:/g, '-');
  return 'Inventario_' + tipo + '_' + f + '_' + h + '.xlsx';
}

function descargarExcel(id) {
  const sesion = historial.find(s => s.id === id);
  if (!sesion) return;
  const wb = buildWorkbook(sesion);
  XLSX.writeFile(wb, nombreExcel(sesion));
}

function compartirExcel(id) {
  const sesion = historial.find(s => s.id === id);
  if (!sesion) return;
  const wb = buildWorkbook(sesion);
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const file = new File([blob], nombreExcel(sesion), { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({
      title: 'Inventario Cuesto/SKF',
      text: 'Inventario del ' + sesion.fecha + ' ' + sesion.hora + ' - ' + sesion.totalContenedores + ' escaneos',
      files: [file]
    }).catch(() => descargarExcel(id));
  } else {
    descargarExcel(id);
  }
}

// ================================================================
//  MODAL
// ================================================================

function showModal(title, msg, buttons) {
  hideModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  const btnsHtml = buttons.map(b =>
    '<button class="btn ' + b.cls + '">' + b.text + '</button>'
  ).join('');
  overlay.innerHTML = '<div class="modal-box"><h3>' + title + '</h3><p>' + msg + '</p>' +
    '<div class="btn-row">' + btnsHtml + '</div></div>';
  document.body.appendChild(overlay);
  const btnEls = overlay.querySelectorAll('.btn');
  buttons.forEach((b, i) => { btnEls[i].onclick = b.action; });
}

function hideModal() {
  const m = document.getElementById('modal-overlay');
  if (m) m.remove();
}

// ================================================================
//  UTILS
// ================================================================

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function splitFechaHora(str) {
  // "12/11/2026, 06:49:26 p.m." → { fecha: "12/11/2026", hora: "06:49:26 p.m." }
  if (!str) return { fecha: '', hora: '' };
  const idx = str.indexOf(',');
  if (idx === -1) return { fecha: str, hora: '' };
  return { fecha: str.slice(0, idx).trim(), hora: str.slice(idx + 1).trim() };
}

// ================================================================
//  INIT
// ================================================================

document.addEventListener('DOMContentLoaded', async () => {
  migrateOldSessions();
  if (authToken) {
    const valid = await verifyToken();
    if (valid) {
      await loadUbicacionesFromServer();
      showHome();
      return;
    }
  }
  showLogin();
});
