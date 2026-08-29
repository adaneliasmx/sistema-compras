/* ═══════════════════════════════════════════════════════════════════
   Inventario con App - Cuesto/SKF
   Modulo web para escaneo QR con camara, reporte y exportacion Excel
   ═══════════════════════════════════════════════════════════════════ */

const APP_VERSION = '1.0.1';
const LS_UBIS = 'invapp_ubicaciones';
const LS_SESSIONS = 'invapp_sesiones';
const SS_TOKEN = 'invapp_token';
const SS_USER = 'invapp_user';

// ── Auth State ───────────────────────────────────────────────────────
let authToken = sessionStorage.getItem(SS_TOKEN) || '';
let authUser = sessionStorage.getItem(SS_USER) || '';

// ── State ────────────────────────────────────────────────────────────
let ubicaciones = JSON.parse(localStorage.getItem(LS_UBIS) || '[]');
let sesiones = JSON.parse(localStorage.getItem(LS_SESSIONS) || '[]');
let ubicacionActual = null;
let escaneos = [];          // {campos:[], ubicacion:string, fechaEscaneo, horaEscaneo}
let codigosRegistrados = new Set();
let scanning = false;
let paused = false;
let html5QrCode = null;
let lastScanTime = 0;
const SCAN_COOLDOWN = 1500; // ms entre escaneos

// ── Audio context for beeps ──────────────────────────────────────────
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

function vibrate(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// ── QR Parser (port from Python qr_parser.py) ───────────────────────
const SEPARADORES = ['\x1d', '\x1e', '"', '\t', '|', '@', '~', '\u00f1', ';', ',', '/', '-'];

function detectarSeparador(raw, camposEsperados) {
  for (const sep of SEPARADORES) {
    if (!raw.includes(sep)) continue;

    let rawClean = raw;
    while (rawClean.startsWith(sep)) rawClean = rawClean.slice(sep.length);
    while (rawClean.endsWith(sep)) rawClean = rawClean.slice(0, -sep.length);
    rawClean = rawClean.trim();

    const partes = rawClean.split(sep);
    const limpio = partes.map(p => p.trim());

    let n = limpio.length;
    let nNoVacios = limpio.filter(p => p).length;

    const tienePrefijo = limpio.length > 0 && limpio[0].toUpperCase() === 'CUESTO';
    if (tienePrefijo) {
      n -= 1;
      nNoVacios = limpio.slice(1).filter(p => p).length;
    }

    if (n >= camposEsperados || nNoVacios === camposEsperados) {
      return sep;
    }
  }
  throw new Error('No se pudo detectar el separador del QR');
}

function parsearQRCuesto(raw) {
  const sep = detectarSeparador(raw, 12);
  let rawClean = raw;
  while (rawClean.startsWith(sep)) rawClean = rawClean.slice(sep.length);
  while (rawClean.endsWith(sep)) rawClean = rawClean.slice(0, -sep.length);
  rawClean = rawClean.trim();

  let partes = rawClean.split(sep).map(p => p.trim());
  if (partes.length > 0 && partes[0].toUpperCase() === 'CUESTO') {
    partes = partes.slice(1);
  }
  if (partes.length < 12) {
    throw new Error(`Se esperaban 12 campos, se obtuvieron ${partes.length}`);
  }
  if (partes[5] === '') partes[5] = '0';
  return partes.slice(0, 12);
}

// campos[]: 0=codigo, 1=lote, 2=skf, 3=componente, 4=peso, 5=p_u,
//           6=cantidad, 7=op_empaque, 8=proceso, 9=acabado, 10=fecha, 11=hora

function claveEscaneo(campos) {
  return `${campos[0]}|${campos[6]}|${campos[4]}`;
}

// ── Persistence ──────────────────────────────────────────────────────
function saveUbicaciones() {
  localStorage.setItem(LS_UBIS, JSON.stringify(ubicaciones));
  // Sync to server
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
    const resp = await fetch('/api/invapp/ubicaciones', {
      headers: { 'x-invapp-token': authToken }
    });
    const data = await resp.json();
    if (data.ok && Array.isArray(data.ubicaciones)) {
      // Merge: server is source of truth, but keep any local-only items
      const serverSet = new Set(data.ubicaciones);
      const localOnly = ubicaciones.filter(u => !serverSet.has(u));
      ubicaciones = [...data.ubicaciones, ...localOnly];
      localStorage.setItem(LS_UBIS, JSON.stringify(ubicaciones));
      if (localOnly.length > 0) saveUbicaciones(); // push merged list back
    }
  } catch (e) {}
}
function saveSesiones() { localStorage.setItem(LS_SESSIONS, JSON.stringify(sesiones)); }

// ── Render helper ────────────────────────────────────────────────────
const $ = sel => document.querySelector(sel);
function render(html) { document.getElementById('app').innerHTML = html; }

// ════════════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════════════

async function verifyToken() {
  if (!authToken) return false;
  try {
    const resp = await fetch('/api/invapp/verify', {
      headers: { 'x-invapp-token': authToken }
    });
    const data = await resp.json();
    if (data.ok) { authUser = data.user; return true; }
  } catch (e) {}
  authToken = '';
  authUser = '';
  sessionStorage.removeItem(SS_TOKEN);
  sessionStorage.removeItem(SS_USER);
  return false;
}

function showLogin(errorMsg) {
  stopCamera();
  render(`
    <div class="screen" style="justify-content:center;align-items:center;min-height:100vh">
      <div style="width:100%;max-width:340px">
        <div class="home-logo">
          <h1>Inventario con App</h1>
          <p>Cuesto / SKF - Escaneo QR</p>
        </div>
        <div class="card" style="margin-top:24px">
          <h3 style="text-align:center;margin-bottom:16px">Iniciar Sesion</h3>
          ${errorMsg ? `<div class="scan-feedback error" style="margin-bottom:12px">${errorMsg}</div>` : ''}
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
  btn.disabled = true;
  btn.textContent = 'Verificando...';

  try {
    const resp = await fetch('/api/invapp/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, pass })
    });
    const data = await resp.json();
    if (data.ok) {
      authToken = data.token;
      authUser = data.user;
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
  authToken = '';
  authUser = '';
  sessionStorage.removeItem(SS_TOKEN);
  sessionStorage.removeItem(SS_USER);
  showLogin();
}

// ════════════════════════════════════════════════════════════════════
//  SCREENS
// ════════════════════════════════════════════════════════════════════

// ── PWA Install ──────────────────────────────────────────────────────
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

function installApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(() => { deferredInstallPrompt = null; });
  } else {
    alert('Para instalar: abre el menu del navegador (3 puntos) y selecciona "Agregar a pantalla de inicio" o "Instalar aplicacion".');
  }
}

// ── HOME ─────────────────────────────────────────────────────────────
function showHome() {
  stopCamera();
  const totalSesiones = sesiones.length;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  render(`
    <div class="screen">
      <div class="home-logo">
        <h1>Inventario con App</h1>
        <p>Cuesto / SKF - Escaneo QR</p>
        <p style="color:var(--green);font-size:12px;margin-top:4px">${esc(authUser)}</p>
      </div>
      <div class="home-menu">
        <div class="menu-btn" onclick="showSeleccionUbicacion()">
          <div class="icon green">&#128247;</div>
          <div class="info">Nuevo Inventario<small>Escanear codigos QR</small></div>
          <div class="arrow">&#8250;</div>
        </div>
        <div class="menu-btn" onclick="showHistorial()">
          <div class="icon blue">&#128203;</div>
          <div class="info">Historial<small>${totalSesiones} ${totalSesiones === 1 ? 'sesion' : 'sesiones'} guardadas</small></div>
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
        </div>
        ` : ''}
      </div>
      <button class="btn btn-outline btn-sm" style="margin-top:auto;opacity:0.6" onclick="logout()">Cerrar sesion</button>
      <div class="version-footer">v${APP_VERSION} - Inventario con App</div>
    </div>
  `);
}

// ── UBICACIONES (CRUD) ───────────────────────────────────────────────
function showUbicaciones() {
  stopCamera();
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
          : `<div class="ubi-list">${items}</div>`
        }
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
  if (ubicaciones.some(u => u.toLowerCase() === val.toLowerCase())) {
    alert('Esa ubicacion ya existe.');
    return;
  }
  ubicaciones.push(val);
  saveUbicaciones();
  showUbicaciones();
}

function editarUbi(i) {
  const nameEl = document.getElementById(`ubi-name-${i}`);
  const current = ubicaciones[i];
  nameEl.innerHTML = `<input class="edit-input" id="edit-inp-${i}" value="${esc(current)}"
    onkeydown="if(event.key==='Enter')guardarEditUbi(${i});if(event.key==='Escape')showUbicaciones()" />`;
  document.getElementById(`edit-inp-${i}`).focus();
  document.getElementById(`edit-inp-${i}`).select();
}

function guardarEditUbi(i) {
  const inp = document.getElementById(`edit-inp-${i}`);
  const val = inp.value.trim();
  if (!val) return;
  if (ubicaciones.some((u, j) => j !== i && u.toLowerCase() === val.toLowerCase())) {
    alert('Esa ubicacion ya existe.');
    return;
  }
  ubicaciones[i] = val;
  saveUbicaciones();
  showUbicaciones();
}

function borrarUbi(i) {
  if (!confirm(`Borrar ubicacion "${ubicaciones[i]}"?`)) return;
  ubicaciones.splice(i, 1);
  saveUbicaciones();
  showUbicaciones();
}

// ── SELECT LOCATION (before scan) ────────────────────────────────────
function showSeleccionUbicacion() {
  stopCamera();
  if (ubicaciones.length === 0) {
    render(`
      <div class="screen">
        <div class="header">
          <button class="back-btn" onclick="showHome()">&#8249;</button>
          <h1>Seleccionar Ubicacion</h1>
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
  const items = ubicaciones.map(u => `
    <div class="ubi-radio ${u === sel ? 'selected' : ''}" onclick="selectUbi(this, '${esc(u)}')">
      <div class="dot"></div>
      <span>${esc(u)}</span>
    </div>
  `).join('');

  render(`
    <div class="screen">
      <div class="header">
        <button class="back-btn" onclick="showHome()">&#8249;</button>
        <h1>Seleccionar Ubicacion</h1>
      </div>
      <p style="color:var(--text2);font-size:13px;margin-bottom:12px">
        Elige donde vas a escanear. Puedes cambiar la ubicacion durante el escaneo.
      </p>
      <div class="ubi-select-list">
        ${items}
      </div>
      <div class="add-row mb-16">
        <input type="text" id="quick-ubi" placeholder="O crea una nueva..."
               onkeydown="if(event.key==='Enter')quickAddUbi()" />
        <button onclick="quickAddUbi()">+ Crear</button>
      </div>
      <button class="btn btn-green" onclick="iniciarInventario()">Iniciar Escaneo</button>
    </div>
  `);
  ubicacionActual = sel;
}

function selectUbi(el, name) {
  document.querySelectorAll('.ubi-radio').forEach(r => r.classList.remove('selected'));
  el.classList.add('selected');
  ubicacionActual = name;
}

function quickAddUbi() {
  const inp = document.getElementById('quick-ubi');
  const val = inp.value.trim();
  if (!val) return;
  if (ubicaciones.some(u => u.toLowerCase() === val.toLowerCase())) {
    alert('Esa ubicacion ya existe.');
    return;
  }
  ubicaciones.push(val);
  saveUbicaciones();
  ubicacionActual = val;
  showSeleccionUbicacion();
}

function iniciarInventario() {
  if (!ubicacionActual) {
    alert('Selecciona una ubicacion primero.');
    return;
  }
  escaneos = [];
  codigosRegistrados = new Set();
  showEscaneo();
}

// ── SCAN SCREEN ──────────────────────────────────────────────────────
function showEscaneo() {
  paused = false;
  scanning = false;

  const recentHtml = buildRecentList();

  render(`
    <div class="screen" style="padding-bottom:0">
      <div class="scan-header">
        <button class="back-btn" onclick="confirmarSalirEscaneo()">&#8249;</button>
        <div class="scan-location loc-wrap">
          <span>&#128205;</span>
          <span class="loc-name" onclick="toggleLocDropdown()">${esc(ubicacionActual)}</span>
          <div class="loc-dropdown" id="loc-dd" style="display:none"></div>
        </div>
      </div>

      <div class="scan-counters">
        <div class="counter-box">
          <div class="num green" id="cnt-cont">0</div>
          <div class="lbl">Contenedores</div>
        </div>
        <div class="counter-box">
          <div class="num blue" id="cnt-pzas">0</div>
          <div class="lbl">Piezas</div>
        </div>
      </div>

      <div id="reader-wrapper">
        <div id="reader"></div>
      </div>

      <div class="scan-feedback idle" id="feedback">Presiona Iniciar para comenzar</div>

      <div class="recent-scans" id="recent-list">
        ${recentHtml}
      </div>

      <div class="scan-bottom">
        <button class="btn btn-green" id="btn-start" onclick="startScan()">Iniciar</button>
        <button class="btn btn-orange" id="btn-pause" onclick="pauseScan()" style="display:none">Pausar</button>
        <button class="btn btn-red" id="btn-finish" onclick="finalizarEscaneo()">Finalizar</button>
      </div>
    </div>
  `);
  updateCounters();
}

function updateCounters() {
  const cntEl = document.getElementById('cnt-cont');
  const pzaEl = document.getElementById('cnt-pzas');
  if (cntEl) cntEl.textContent = escaneos.length;
  if (pzaEl) pzaEl.textContent = escaneos.reduce((s, e) => s + (parseInt(e.campos[6]) || 0), 0);
}

function buildRecentList() {
  if (escaneos.length === 0) return '<p style="color:var(--text2);text-align:center;font-size:13px;padding:16px">Sin escaneos aun</p>';
  const reversed = [...escaneos].reverse().slice(0, 50);
  const items = reversed.map((e, i) => {
    const num = escaneos.length - i;
    return `<div class="scan-item">
      <span class="num">${num}</span>
      <span class="comp">${esc(e.campos[3])}</span>
      <span class="qty">${e.campos[6]} pz</span>
      <span class="loc-tag">${esc(e.ubicacion)}</span>
    </div>`;
  }).join('');
  return `<h4>Escaneos (${escaneos.length})</h4>${items}`;
}

function updateRecentList() {
  const el = document.getElementById('recent-list');
  if (el) el.innerHTML = buildRecentList();
}

function setFeedback(msg, type) {
  const el = document.getElementById('feedback');
  if (!el) return;
  el.className = `scan-feedback ${type}`;
  el.textContent = msg;
}

// ── Camera control ───────────────────────────────────────────────────
async function startScan() {
  if (scanning && !paused) return;

  if (paused) {
    // Resume
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

  try {
    html5QrCode = new Html5Qrcode('reader');
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
      onScanSuccess,
      () => {} // ignore scan errors
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
    // Add overlay
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
    startScan(); // resume
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

// ── On QR scanned ────────────────────────────────────────────────────
function onScanSuccess(decodedText) {
  const now = Date.now();
  if (now - lastScanTime < SCAN_COOLDOWN) return;
  lastScanTime = now;

  try {
    const campos = parsearQRCuesto(decodedText);
    const clave = claveEscaneo(campos);

    if (codigosRegistrados.has(clave)) {
      beepError();
      vibrate([100, 50, 100]);
      setFeedback(`DUPLICADO: ${campos[0]} - ${campos[3]}`, 'error');
      flashReader('flash-red');
      return;
    }

    // Valid new scan
    codigosRegistrados.add(clave);
    const ahora = new Date();
    escaneos.push({
      campos,
      ubicacion: ubicacionActual,
      fechaEscaneo: ahora.toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric' }),
      horaEscaneo: ahora.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    });

    beepSuccess();
    vibrate(80);
    setFeedback(`OK: ${campos[3]} - ${campos[6]} pz (${campos[0]})`, 'success');
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
  void el.offsetWidth; // force reflow
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 600);
}

// ── Location change during scan ──────────────────────────────────────
function toggleLocDropdown() {
  const dd = document.getElementById('loc-dd');
  if (!dd) return;
  if (dd.style.display === 'none') {
    dd.style.display = 'block';
    dd.innerHTML = ubicaciones.map(u => `
      <div class="loc-opt ${u === ubicacionActual ? 'active' : ''}"
           onclick="cambiarUbiEscaneo('${esc(u)}')">${esc(u)}</div>
    `).join('');
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

// ── Exit scan ────────────────────────────────────────────────────────
function confirmarSalirEscaneo() {
  if (escaneos.length === 0) {
    stopCamera();
    showHome();
    return;
  }
  showModal(
    'Salir del escaneo',
    `Tienes ${escaneos.length} escaneos. Si sales sin finalizar se perderan.`,
    [
      { text: 'Cancelar', cls: 'btn-outline', action: hideModal },
      { text: 'Salir', cls: 'btn-red', action: () => { hideModal(); stopCamera(); showHome(); } }
    ]
  );
}

function finalizarEscaneo() {
  if (escaneos.length === 0) {
    alert('No hay escaneos para guardar.');
    return;
  }
  showModal(
    'Finalizar escaneo',
    `Se guardaran ${escaneos.length} escaneos. ¿Continuar?`,
    [
      { text: 'Cancelar', cls: 'btn-outline', action: hideModal },
      { text: 'Finalizar', cls: 'btn-green', action: () => { hideModal(); guardarYMostrarReporte(); } }
    ]
  );
}

async function guardarYMostrarReporte() {
  await stopCamera();

  const ahora = new Date();
  const sesion = {
    id: Date.now(),
    fecha: ahora.toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric' }),
    hora: ahora.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' }),
    fechaISO: ahora.toISOString(),
    totalContenedores: escaneos.length,
    totalPiezas: escaneos.reduce((s, e) => s + (parseInt(e.campos[6]) || 0), 0),
    ubicaciones: [...new Set(escaneos.map(e => e.ubicacion))],
    escaneos: escaneos.map(e => ({ ...e }))
  };

  sesiones.unshift(sesion);
  saveSesiones();
  showReporte(sesion);
}

// ── REPORT SCREEN ────────────────────────────────────────────────────
function showReporte(sesion) {
  stopCamera();

  // Summary by component
  const porComp = {};
  for (const e of sesion.escaneos) {
    const comp = e.campos[3] || 'Sin componente';
    if (!porComp[comp]) porComp[comp] = { contenedores: 0, piezas: 0 };
    porComp[comp].contenedores += 1;
    porComp[comp].piezas += parseInt(e.campos[6]) || 0;
  }
  const compKeys = Object.keys(porComp).sort();

  // Summary by location
  const porUbi = {};
  for (const e of sesion.escaneos) {
    const ubi = e.ubicacion;
    if (!porUbi[ubi]) porUbi[ubi] = { contenedores: 0, piezas: 0 };
    porUbi[ubi].contenedores += 1;
    porUbi[ubi].piezas += parseInt(e.campos[6]) || 0;
  }
  const ubiKeys = Object.keys(porUbi).sort();

  const compRows = compKeys.map(k => `
    <tr><td>${esc(k)}</td><td style="text-align:center">${porComp[k].contenedores}</td><td style="text-align:right">${porComp[k].piezas}</td></tr>
  `).join('');

  const ubiRows = ubiKeys.map(k => `
    <tr><td>${esc(k)}</td><td style="text-align:center">${porUbi[k].contenedores}</td><td style="text-align:right">${porUbi[k].piezas}</td></tr>
  `).join('');

  // Detail rows
  const detailRows = sesion.escaneos.map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(e.ubicacion)}</td>
      <td>${esc(e.campos[0])}</td>
      <td>${esc(e.campos[1])}</td>
      <td>${esc(e.campos[2])}</td>
      <td>${esc(e.campos[3])}</td>
      <td>${e.campos[4]}</td>
      <td>${e.campos[5]}</td>
      <td>${e.campos[6]}</td>
      <td>${esc(e.campos[7])}</td>
      <td>${esc(e.campos[8])}</td>
      <td>${esc(e.campos[9])}</td>
      <td>${esc(e.campos[10])}</td>
      <td>${esc(e.campos[11])}</td>
      <td>${e.fechaEscaneo}</td>
      <td>${e.horaEscaneo}</td>
    </tr>
  `).join('');

  render(`
    <div class="screen">
      <div class="header">
        <button class="back-btn" onclick="showHome()">&#8249;</button>
        <h1>Reporte de Inventario</h1>
      </div>

      <div class="report-header-info">
        <div class="tag"><strong>${sesion.fecha}</strong> ${sesion.hora}</div>
        <div class="tag"><strong>${sesion.totalContenedores}</strong> contenedores</div>
        <div class="tag"><strong>${sesion.totalPiezas}</strong> piezas</div>
      </div>

      <div class="card">
        <h3>Resumen por Componente</h3>
        <table class="report-table">
          <thead><tr><th>Componente</th><th style="text-align:center">Cont.</th><th style="text-align:right">Piezas</th></tr></thead>
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
          <thead><tr><th>Ubicacion</th><th style="text-align:center">Cont.</th><th style="text-align:right">Piezas</th></tr></thead>
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
            <thead>
              <tr>
                <th>#</th><th>Ubicacion</th><th>Codigo</th><th>Lote</th><th>SKF</th>
                <th>Componente</th><th>Peso</th><th>P/U</th><th>Cant.</th>
                <th>Op.Empaque</th><th>Proceso</th><th>Acabado</th>
                <th>Fecha QR</th><th>Hora QR</th><th>Fecha Esc.</th><th>Hora Esc.</th>
              </tr>
            </thead>
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

// ── HISTORY SCREEN ───────────────────────────────────────────────────
function showHistorial() {
  stopCamera();
  if (sesiones.length === 0) {
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

  const items = sesiones.map(s => `
    <div class="history-item" onclick="verSesion(${s.id})">
      <div class="date">${s.fecha} - ${s.hora}</div>
      <div class="stats">${s.totalContenedores} contenedores - ${s.totalPiezas} piezas</div>
      <div class="ubis">Ubicaciones: ${s.ubicaciones.join(', ')}</div>
    </div>
  `).join('');

  render(`
    <div class="screen">
      <div class="header">
        <button class="back-btn" onclick="showHome()">&#8249;</button>
        <h1>Historial</h1>
        <span class="badge">${sesiones.length}</span>
      </div>
      ${items}
      <button class="btn btn-outline btn-sm mt-16" onclick="confirmarBorrarHistorial()">Borrar todo el historial</button>
    </div>
  `);
}

function verSesion(id) {
  const sesion = sesiones.find(s => s.id === id);
  if (sesion) showReporte(sesion);
}

function confirmarBorrarHistorial() {
  showModal('Borrar historial', 'Se eliminaran todas las sesiones guardadas. Esta accion no se puede deshacer.', [
    { text: 'Cancelar', cls: 'btn-outline', action: hideModal },
    { text: 'Borrar todo', cls: 'btn-red', action: () => { sesiones = []; saveSesiones(); hideModal(); showHistorial(); } }
  ]);
}

// ════════════════════════════════════════════════════════════════════
//  EXCEL GENERATION
// ════════════════════════════════════════════════════════════════════
function buildWorkbook(sesion) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Detalle
  const detData = [
    ['#', 'Ubicacion', 'Codigo', 'Lote', 'SKF', 'Componente', 'Peso', 'P/U', 'Cantidad',
     'Op.Empaque', 'Proceso', 'Acabado', 'Fecha QR', 'Hora QR', 'Fecha Escaneo', 'Hora Escaneo']
  ];
  sesion.escaneos.forEach((e, i) => {
    detData.push([
      i + 1, e.ubicacion, e.campos[0], e.campos[1], e.campos[2], e.campos[3],
      parseFloat(e.campos[4]) || 0, parseFloat(e.campos[5]) || 0, parseInt(e.campos[6]) || 0,
      e.campos[7], e.campos[8], e.campos[9], e.campos[10], e.campos[11],
      e.fechaEscaneo, e.horaEscaneo
    ]);
  });
  const wsDetail = XLSX.utils.aoa_to_sheet(detData);
  wsDetail['!cols'] = [
    {wch:4},{wch:15},{wch:14},{wch:10},{wch:12},{wch:25},{wch:8},{wch:6},{wch:8},
    {wch:15},{wch:12},{wch:12},{wch:12},{wch:10},{wch:12},{wch:10}
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detalle');

  // Sheet 2: Resumen por Componente
  const porComp = {};
  for (const e of sesion.escaneos) {
    const comp = e.campos[3] || 'Sin componente';
    if (!porComp[comp]) porComp[comp] = { contenedores: 0, piezas: 0 };
    porComp[comp].contenedores += 1;
    porComp[comp].piezas += parseInt(e.campos[6]) || 0;
  }
  const compData = [['Componente', 'Contenedores', 'Piezas']];
  Object.keys(porComp).sort().forEach(k => {
    compData.push([k, porComp[k].contenedores, porComp[k].piezas]);
  });
  compData.push(['TOTAL', sesion.totalContenedores, sesion.totalPiezas]);
  const wsComp = XLSX.utils.aoa_to_sheet(compData);
  wsComp['!cols'] = [{wch:30},{wch:14},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsComp, 'Resumen Componente');

  // Sheet 3: Resumen por Ubicacion
  const porUbi = {};
  for (const e of sesion.escaneos) {
    const ubi = e.ubicacion;
    if (!porUbi[ubi]) porUbi[ubi] = { contenedores: 0, piezas: 0 };
    porUbi[ubi].contenedores += 1;
    porUbi[ubi].piezas += parseInt(e.campos[6]) || 0;
  }
  const ubiData = [['Ubicacion', 'Contenedores', 'Piezas']];
  Object.keys(porUbi).sort().forEach(k => {
    ubiData.push([k, porUbi[k].contenedores, porUbi[k].piezas]);
  });
  ubiData.push(['TOTAL', sesion.totalContenedores, sesion.totalPiezas]);
  const wsUbi = XLSX.utils.aoa_to_sheet(ubiData);
  wsUbi['!cols'] = [{wch:25},{wch:14},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsUbi, 'Resumen Ubicacion');

  return wb;
}

function nombreExcel(sesion) {
  const f = sesion.fecha.replace(/\//g, '-');
  const h = sesion.hora.replace(/:/g, '-');
  return `Inventario_${f}_${h}.xlsx`;
}

function descargarExcel(id) {
  const sesion = sesiones.find(s => s.id === id);
  if (!sesion) return;
  const wb = buildWorkbook(sesion);
  XLSX.writeFile(wb, nombreExcel(sesion));
}

function compartirExcel(id) {
  const sesion = sesiones.find(s => s.id === id);
  if (!sesion) return;
  const wb = buildWorkbook(sesion);
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const file = new File([blob], nombreExcel(sesion), { type: blob.type });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({
      title: 'Inventario Cuesto/SKF',
      text: `Inventario del ${sesion.fecha} ${sesion.hora} - ${sesion.totalContenedores} contenedores, ${sesion.totalPiezas} piezas`,
      files: [file]
    }).catch(() => {
      // Fallback to download
      descargarExcel(id);
    });
  } else {
    // Fallback: download
    descargarExcel(id);
  }
}

// ════════════════════════════════════════════════════════════════════
//  MODAL
// ════════════════════════════════════════════════════════════════════
function showModal(title, msg, buttons) {
  hideModal();
  const btns = buttons.map(b =>
    `<button class="btn ${b.cls}" onclick="modalAction_${b.text.replace(/\s/g,'_')}">${b.text}</button>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h3>${title}</h3>
      <p>${msg}</p>
      <div class="btn-row">${btns}</div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Wire buttons
  const btnEls = overlay.querySelectorAll('.btn');
  buttons.forEach((b, i) => {
    btnEls[i].onclick = b.action;
  });
}

function hideModal() {
  const m = document.getElementById('modal-overlay');
  if (m) m.remove();
}

// ════════════════════════════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════════════════════════════
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ════════════════════════════════════════════════════════════════════
//  API CLIENT (prepared for future server sync)
// ════════════════════════════════════════════════════════════════════
const API_URL = '/api/val';

async function syncInventario(sesion) {
  // TODO: Implement when server endpoint is ready
  // POST /api/val/inventario/registrar
  // Body: { fecha, hora, ubicaciones, escaneos, totalContenedores, totalPiezas }
  try {
    const resp = await fetch(`${API_URL}/inventario/registrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha: sesion.fecha,
        hora: sesion.hora,
        ubicaciones: sesion.ubicaciones,
        totalContenedores: sesion.totalContenedores,
        totalPiezas: sesion.totalPiezas,
        escaneos: sesion.escaneos.map(e => ({
          ubicacion: e.ubicacion,
          codigo: e.campos[0],
          lote: e.campos[1],
          skf: e.campos[2],
          componente: e.campos[3],
          peso: e.campos[4],
          p_u: e.campos[5],
          cantidad: e.campos[6],
          operador_empaque: e.campos[7],
          proceso: e.campos[8],
          acabado: e.campos[9],
          fecha_qr: e.campos[10],
          hora_qr: e.campos[11],
          fecha_escaneo: e.fechaEscaneo,
          hora_escaneo: e.horaEscaneo
        }))
      })
    });
    return await resp.json();
  } catch (e) {
    console.warn('Sync failed:', e);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
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
