(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────
  const API     = '/api/produccion';
  const TK_KEY  = 'prod_token';
  const USR_KEY = 'prod_user';
  const MX_TZ   = 'America/Mexico_City';

  // KPI slide definitions (fixed, always present if active)
  const KPI_SLIDES_DEF = [
    {id:'k1', type:'kpi', scope:'turno', linea:'L3'},
    {id:'k2', type:'kpi', scope:'turno', linea:'L4'},
    {id:'k3', type:'kpi', scope:'turno', linea:'ambas'},
    {id:'k4', type:'kpi', scope:'dia',   linea:'L3'},
    {id:'k5', type:'kpi', scope:'dia',   linea:'L4'},
    {id:'k6', type:'kpi', scope:'dia',   linea:'ambas'},
  ];

  // ── State ─────────────────────────────────────────────────────────────────
  let token       = null;
  let slides      = [];       // active slides to show
  let slideIdx    = 0;
  let slideTimer  = null;
  let progressInt = null;
  let kpiData     = null;     // last fetched pizarron data
  let ssConfig    = { default_duracion_seg: 120, slides: [] };
  let progressPct = 0;
  let slideDurSec = 120;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function nowMxStr() {
    return new Date().toLocaleTimeString('es-MX', { timeZone: MX_TZ, hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
  function nowMxDateStr() {
    return new Date().toLocaleDateString('es-MX', { timeZone: MX_TZ, weekday:'long', year:'numeric', month:'long', day:'numeric' });
  }
  function nowMxMins() {
    const t = new Date().toLocaleTimeString('en-GB', { timeZone: MX_TZ, hour:'2-digit', minute:'2-digit', hour12:false }).slice(0,5);
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }
  function currentTurno() {
    const m = nowMxMins();
    if (m >= 6*60+30 && m < 14*60+30) return 'T1';
    if (m >= 14*60+30 && m < 21*60+30) return 'T2';
    return 'T3';
  }
  function nowMxDate() {
    return new Date().toLocaleDateString('en-CA', { timeZone: MX_TZ });
  }
  function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v * 100).toFixed(1) + '%';
  }
  function kpiClass(v) {
    if (v == null || isNaN(v)) return 'kpi-na';
    const p = v * 100;
    if (p >= 90) return 'kpi-green';
    if (p >= 70) return 'kpi-amber';
    return 'kpi-red';
  }
  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── API calls ─────────────────────────────────────────────────────────────
  async function apiFetch(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) }
    });
    if (res.status === 401) { doLogout(); return null; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  function doLogout() {
    token = null;
    localStorage.removeItem(TK_KEY);
    localStorage.removeItem(USR_KEY);
    document.getElementById('ss-app').style.display = 'none';
    document.getElementById('ss-login').style.display = 'flex';
    clearTimers();
  }

  async function tryAutoLogin() {
    const t = localStorage.getItem(TK_KEY);
    if (!t) return false;
    token = t;
    // Verify token by calling a protected endpoint
    try {
      await apiFetch('/config');
      return true;
    } catch {
      token = null;
      return false;
    }
  }

  async function doLogin() {
    const email    = document.getElementById('ss-user-sel').value;
    const password = document.getElementById('ss-pass').value;
    const errEl    = document.getElementById('ss-error');
    errEl.style.display = 'none';
    if (!email || !password) {
      errEl.textContent = 'Selecciona usuario e ingresa contraseña.';
      errEl.style.display = 'block';
      return;
    }
    const btn = document.getElementById('ss-login-btn');
    btn.disabled = true; btn.textContent = 'Entrando...';
    try {
      const res = await fetch(API + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error de autenticación');
      token = data.token;
      localStorage.setItem(TK_KEY, token);
      localStorage.setItem(USR_KEY, JSON.stringify(data.user));
      document.getElementById('ss-login').style.display = 'none';
      document.getElementById('ss-app').style.display = 'block';
      await boot();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar al Pizarrón';
    }
  }

  // ── Data fetching ─────────────────────────────────────────────────────────
  async function fetchConfig() {
    try {
      const d = await apiFetch('/slideshow-config');
      if (d) ssConfig = d.slideshow || ssConfig;
    } catch {}
  }

  async function fetchKpi() {
    try {
      const fecha = nowMxDate();
      const d = await apiFetch(`/pizarron?linea=ambas&fecha=${fecha}&turno=all`);
      if (d) kpiData = d.data || {};
    } catch {}
  }

  // ── Build slides list ─────────────────────────────────────────────────────
  function buildSlides() {
    const configSlides = ssConfig.slides || [];
    const result = [];

    for (const def of KPI_SLIDES_DEF) {
      const numId = parseInt(def.id.slice(1)); // 'k1' -> 1
      const cfg = configSlides.find(s => s.id === numId && s.type === 'kpi') || {};
      if (cfg.activo === false) continue; // skip inactive
      result.push({
        ...def,
        duracion_seg: cfg.duracion_seg || ssConfig.default_duracion_seg || 120
      });
    }

    // Image slides from config
    for (const s of configSlides) {
      if (s.type === 'imagen' && s.activo !== false && s.imagen_b64) {
        result.push({
          id: 'img_' + s.id,
          type: 'imagen',
          imagen_b64: s.imagen_b64,
          titulo: s.titulo || '',
          duracion_seg: s.duracion_seg || ssConfig.default_duracion_seg || 120
        });
      }
    }

    slides = result;
    if (slideIdx >= slides.length) slideIdx = 0;
  }

  // ── Slide rendering ───────────────────────────────────────────────────────
  function renderCurrentSlide() {
    if (!slides.length) {
      document.getElementById('ss-stage').innerHTML = '<div class="ss-loading-msg">Sin diapositivas configuradas.</div>';
      return;
    }

    const slide = slides[slideIdx];
    slideDurSec = slide.duracion_seg || ssConfig.default_duracion_seg || 120;

    updateDots();
    updateCounter();

    const stage = document.getElementById('ss-stage');

    if (slide.type === 'imagen') {
      stage.innerHTML = renderImageSlide(slide);
    } else if (slide.linea === 'ambas') {
      stage.innerHTML = renderAmbasSlide(slide);
    } else {
      stage.innerHTML = renderKpiSlide(slide);
    }
  }

  function renderKpiSlide(slide) {
    const turno   = currentTurno();
    const l       = slide.linea; // 'L3' or 'L4'
    const lineaData = kpiData?.[l] || {};

    let totals, slots, titlePrefix;
    if (slide.scope === 'turno') {
      totals = lineaData[turno]?.totals || {};
      slots  = (lineaData[turno]?.slots || []).filter(s => s.ciclos_totales > 0 || s.paros_min > 0);
      titlePrefix = `Turno ${turno.slice(1)}`;
    } else {
      totals = lineaData.totales_dia || {};
      slots  = [];
      titlePrefix = new Date().toLocaleDateString('es-MX', { timeZone: MX_TZ, day:'2-digit', month:'short', year:'numeric' });
    }

    const lineaLabel = l === 'L3' ? 'Línea 3' : 'Línea 4';

    return `
      <div class="ss-slide">
        <div class="ss-slide-title">${escHtml(titlePrefix)} · ${lineaLabel}</div>
        <div class="ss-slide-subtitle">${nowMxDateStr()}</div>
        <div class="ss-summary-row">
          <div class="ss-stat-chip"><span class="val">${totals.ciclos_totales ?? 0}</span><span class="lbl">Ciclos</span></div>
          <div class="ss-stat-chip"><span class="val">${totals.ciclos_buenos ?? 0}</span><span class="lbl">Buenos</span></div>
          <div class="ss-stat-chip" style="color:#f59e0b"><span class="val">${totals.paros_min != null ? Math.round(totals.paros_min) : 0}</span><span class="lbl">Paros (min)</span></div>
        </div>
        <div class="ss-kpi-grid">
          ${kpiCard('Eficiencia',    totals.eficiencia)}
          ${kpiCard('Calidad',       totals.calidad)}
          ${kpiCard('Capacidad',     totals.capacidad)}
          ${kpiCard('Disponibilidad',totals.disponibilidad)}
        </div>
        ${slots.length ? `
        <div style="flex:1;overflow:auto">
          <table class="ss-slots-table">
            <thead><tr>
              <th>Hora</th><th>Ciclos</th><th>Eficiencia</th><th>Calidad</th><th>Capacidad</th><th>Disponibilidad</th>
            </tr></thead>
            <tbody>
              ${slots.map(s => `<tr>
                <td>${escHtml(s.hora_inicio)}–${escHtml(s.hora_fin)}</td>
                <td style="text-align:center;font-weight:700">${s.ciclos_totales}</td>
                <td class="kpi-cell ${kpiClass(s.eficiencia)}">${fmtPct(s.eficiencia)}</td>
                <td class="kpi-cell ${kpiClass(s.calidad)}">${fmtPct(s.calidad)}</td>
                <td class="kpi-cell ${kpiClass(s.capacidad)}">${fmtPct(s.capacidad)}</td>
                <td class="kpi-cell ${kpiClass(s.disponibilidad)}">${fmtPct(s.disponibilidad)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#475569;font-size:18px">Sin ciclos registrados en este período</div>'}
      </div>`;
  }

  function renderAmbasSlide(slide) {
    const turno = currentTurno();

    let title, getLineaTotals;
    if (slide.scope === 'turno') {
      title = `Turno ${turno.slice(1)} · Todas las Líneas`;
      getLineaTotals = l => (kpiData?.[l]?.[turno]?.totals || {});
    } else {
      title = `${new Date().toLocaleDateString('es-MX', {timeZone:MX_TZ, day:'2-digit', month:'short', year:'numeric'})} · Todas las Líneas`;
      getLineaTotals = l => (kpiData?.[l]?.totales_dia || {});
    }

    return `
      <div class="ss-slide">
        <div class="ss-slide-title">${escHtml(title)}</div>
        <div class="ss-slide-subtitle">${nowMxDateStr()}</div>
        <div class="ss-ambas-grid" style="flex:1;margin-top:8px">
          ${['L3','L4'].map(l => {
            const tot = getLineaTotals(l);
            const label = l === 'L3' ? 'Línea 3' : 'Línea 4';
            return `
              <div class="ss-linea-panel">
                <h3>${label}</h3>
                <div class="ss-summary-row" style="margin-bottom:12px">
                  <div class="ss-stat-chip"><span class="val" style="font-size:22px">${tot.ciclos_totales ?? 0}</span><span class="lbl">Ciclos</span></div>
                  <div class="ss-stat-chip"><span class="val" style="font-size:22px;color:#f59e0b">${tot.paros_min != null ? Math.round(tot.paros_min) : 0}</span><span class="lbl">Paros min</span></div>
                </div>
                <div class="ss-mini-kpi-grid">
                  ${miniKpiCard('Eficiencia', tot.eficiencia)}
                  ${miniKpiCard('Calidad', tot.calidad)}
                  ${miniKpiCard('Capacidad', tot.capacidad)}
                  ${miniKpiCard('Disponibilidad', tot.disponibilidad)}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function renderImageSlide(slide) {
    return `
      <div class="ss-img-slide">
        <img src="${escHtml(slide.imagen_b64)}" alt="${escHtml(slide.titulo)}" />
        ${slide.titulo ? `<div class="ss-img-title">${escHtml(slide.titulo)}</div>` : ''}
      </div>`;
  }

  function kpiCard(label, val) {
    const cls = kpiClass(val);
    const txt = val != null ? (val * 100).toFixed(1) + '%' : '—';
    return `<div class="ss-kpi-card ${cls !== 'kpi-na' ? cls : ''}">
      <div class="ss-kpi-label">${label}</div>
      <div class="ss-kpi-value ${cls}">${txt}</div>
    </div>`;
  }

  function miniKpiCard(label, val) {
    const cls = kpiClass(val);
    const txt = val != null ? (val * 100).toFixed(1) + '%' : '—';
    return `<div class="ss-mini-kpi">
      <div class="lbl">${label}</div>
      <div class="val ${cls}">${txt}</div>
    </div>`;
  }

  // ── Navigation & Timer ───────────────────────────────────────────────────
  function clearTimers() {
    clearTimeout(slideTimer);
    clearInterval(progressInt);
  }

  function startSlideTimer() {
    clearTimers();
    progressPct = 0;
    updateProgress(0);

    const durMs  = slideDurSec * 1000;
    const tickMs = 500;
    let elapsed  = 0;

    progressInt = setInterval(() => {
      elapsed += tickMs;
      progressPct = Math.min(100, (elapsed / durMs) * 100);
      updateProgress(progressPct);
      if (elapsed >= durMs) {
        clearInterval(progressInt);
        nextSlide();
      }
    }, tickMs);
  }

  function nextSlide() {
    if (!slides.length) return;
    slideIdx = (slideIdx + 1) % slides.length;
    renderCurrentSlide();
    startSlideTimer();
  }

  function prevSlide() {
    if (!slides.length) return;
    slideIdx = (slideIdx - 1 + slides.length) % slides.length;
    renderCurrentSlide();
    startSlideTimer();
  }

  function goToSlide(i) {
    slideIdx = i;
    renderCurrentSlide();
    startSlideTimer();
  }

  function updateProgress(pct) {
    const el = document.getElementById('ss-progress');
    if (el) el.style.width = pct + '%';
  }

  function updateDots() {
    const dotsEl = document.getElementById('ss-dots');
    if (!dotsEl) return;
    dotsEl.innerHTML = slides.map((_, i) =>
      `<div class="ss-dot${i === slideIdx ? ' active' : ''}" data-idx="${i}"></div>`
    ).join('');
    dotsEl.querySelectorAll('.ss-dot').forEach(d => {
      d.addEventListener('click', () => goToSlide(Number(d.dataset.idx)));
    });
  }

  function updateCounter() {
    const el = document.getElementById('ss-counter');
    if (el) el.textContent = `${slideIdx + 1} / ${slides.length}`;
  }

  function updateTurnoBadge() {
    const el = document.getElementById('ss-turno-badge');
    if (el) el.textContent = `Turno ${currentTurno().slice(1)}`;
  }

  // ── Clock ─────────────────────────────────────────────────────────────────
  function startClock() {
    setInterval(() => {
      const el = document.getElementById('ss-clock');
      if (el) el.textContent = nowMxStr();
      updateTurnoBadge();
    }, 1000);
  }

  // ── Data refresh (every 5 min) ────────────────────────────────────────────
  function startDataRefresh() {
    setInterval(async () => {
      await fetchKpi();
      await fetchConfig();
      buildSlides();
      renderCurrentSlide(); // refresh current slide content
    }, 5 * 60 * 1000);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  async function boot() {
    document.getElementById('ss-stage').innerHTML = '<div class="ss-loading-msg">⏳ Cargando datos...</div>';
    await fetchConfig();
    await fetchKpi();
    buildSlides();
    if (!slides.length) {
      document.getElementById('ss-stage').innerHTML = '<div class="ss-loading-msg">Sin diapositivas activas.</div>';
      return;
    }
    slideIdx = 0;
    renderCurrentSlide();
    startSlideTimer();
    startClock();
    startDataRefresh();
    updateTurnoBadge();
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    // Load user list for login dropdown
    try {
      const res = await fetch(API + '/auth/usuarios');
      const users = await res.json();
      const sel = document.getElementById('ss-user-sel');
      users.forEach(u => {
        const o = document.createElement('option');
        o.value = u.email;
        o.textContent = u.nombre;
        sel.appendChild(o);
      });
    } catch {}

    // Bind login events
    document.getElementById('ss-login-btn').addEventListener('click', doLogin);
    document.getElementById('ss-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('ss-exit').addEventListener('click', doLogout);
    document.getElementById('ss-prev').addEventListener('click', prevSlide);
    document.getElementById('ss-next').addEventListener('click', nextSlide);
    document.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') nextSlide();
      if (e.key === 'ArrowLeft')  prevSlide();
      if (e.key === 'Escape')     doLogout();
    });

    // Try auto-login with existing token
    const loggedIn = await tryAutoLogin();
    if (loggedIn) {
      document.getElementById('ss-login').style.display = 'none';
      document.getElementById('ss-app').style.display = 'block';
      await boot();
    } else {
      document.getElementById('ss-login').style.display = 'flex';
      document.getElementById('ss-app').style.display = 'none';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
