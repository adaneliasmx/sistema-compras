(function () {
  'use strict';

  const API    = '/api/produccion';
  const TK_KEY = 'prod_token';

  // ── 7 diapositivas fijas ──────────────────────────────────────────────────
  // cfgId = ID en la config de slideshow del backend (para activar/desactivar y duración)
  const KPI_SLIDES_DEF = [
    { id:'k1', cfgId:1, scope:'turno', linea:'L3'    },
    { id:'k2', cfgId:2, scope:'turno', linea:'L4'    },
    { id:'k3', cfgId:7, scope:'turno', linea:'Baker' },
    { id:'k4', cfgId:3, scope:'turno', linea:'all'   },  // L3 + L4 + Baker
    { id:'k5', cfgId:4, scope:'dia',   linea:'L3'    },
    { id:'k6', cfgId:5, scope:'dia',   linea:'L4'    },
    { id:'k7', cfgId:8, scope:'dia',   linea:'Baker' },
  ];

  const LINEA_LABELS = { L3:'Línea 3', L4:'Línea 4', Baker:'Baker' };
  const FONT_SIZES   = { sm:'12px', md:'15px', lg:'19px', xl:'24px' };

  // ── State ─────────────────────────────────────────────────────────────────
  let token       = null;
  let slides      = [];
  let slideIdx    = 0;
  let slideTimer  = null;
  let progressInt = null;
  let kpiData     = {};
  let ssConfig    = { default_duracion_seg: 120, slides: [] };
  let slideDurSec = 120;
  let darkMode    = localStorage.getItem('ss_theme') !== 'light'; // dark por defecto
  let fontSize    = localStorage.getItem('ss_font') || 'md';

  // ── Helpers ───────────────────────────────────────────────────────────────
  const MX = 'es-MX';
  function nowTimeStr() {
    return new Date().toLocaleTimeString(MX, { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
  function nowDateLong() {
    return new Date().toLocaleDateString(MX, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  }
  function nowDateShort() {
    return new Date().toLocaleDateString('en-CA');
  }
  function nowMins() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
  function currentTurno() {
    const m = nowMins();
    if (m >= 6*60+30 && m < 14*60+30) return 'T1';
    if (m >= 14*60+30 && m < 21*60+30) return 'T2';
    return 'T3';
  }
  function fmtPct(v) {
    if (v == null || isNaN(Number(v))) return '—';
    return (Number(v) * 100).toFixed(1) + '%';
  }
  function kpiClass(v) {
    if (v == null || isNaN(Number(v))) return 'kpi-na';
    const p = Number(v) * 100;
    if (p >= 90) return 'kpi-green';
    if (p >= 70) return 'kpi-amber';
    return 'kpi-red';
  }
  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function applyTheme() {
    document.body.classList.toggle('ss-light', !darkMode);
    document.documentElement.style.setProperty('--ss-font', FONT_SIZES[fontSize] || '15px');
    const btn = document.getElementById('ss-theme-btn');
    if (btn) btn.textContent = darkMode ? '☀️ Claro' : '🌙 Oscuro';
    document.querySelectorAll('.ss-font-btn').forEach(b => {
      b.classList.toggle('ss-btn-active', b.dataset.font === fontSize);
    });
  }

  // ── API ───────────────────────────────────────────────────────────────────
  async function apiFetch(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {})
      }
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
    clearTimers();
    document.getElementById('ss-app').style.display = 'none';
    document.getElementById('ss-login').style.display = 'flex';
  }

  async function tryAutoLogin() {
    const t = localStorage.getItem(TK_KEY);
    if (!t) return false;
    token = t;
    try { await apiFetch('/config'); return true; }
    catch { token = null; return false; }
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

  // ── Data ──────────────────────────────────────────────────────────────────
  async function fetchConfig() {
    try {
      const d = await apiFetch('/slideshow-config');
      if (d) ssConfig = d.slideshow || ssConfig;
    } catch {}
  }

  async function fetchKpi() {
    try {
      const fecha = nowDateShort();
      const d = await apiFetch(`/pizarron?linea=ambas&fecha=${fecha}&turno=all`);
      if (d) kpiData = d.data || {};
    } catch {}
  }

  // ── Build slides list ─────────────────────────────────────────────────────
  function buildSlides() {
    const cfgSlides = ssConfig.slides || [];
    const result = [];

    for (const def of KPI_SLIDES_DEF) {
      const cfg = cfgSlides.find(s => s.id === def.cfgId && s.type === 'kpi') || {};
      if (cfg.activo === false) continue;
      result.push({
        ...def,
        duracion_seg: cfg.duracion_seg || ssConfig.default_duracion_seg || 120
      });
    }
    // Image slides
    for (const s of cfgSlides) {
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
    updateDots();
    updateCounter();
    if (!slides.length) {
      document.getElementById('ss-stage').innerHTML =
        '<div class="ss-loading-msg">Sin diapositivas configuradas.</div>';
      return;
    }
    const slide = slides[slideIdx];
    slideDurSec = slide.duracion_seg || ssConfig.default_duracion_seg || 120;

    const stage = document.getElementById('ss-stage');
    if (slide.type === 'imagen') {
      stage.innerHTML = renderImageSlide(slide);
    } else if (slide.linea === 'all') {
      stage.innerHTML = renderAllSlide(slide);
    } else if (slide.scope === 'dia') {
      stage.innerHTML = renderDiaSlide(slide);
    } else {
      stage.innerHTML = renderTurnoSlide(slide);
    }
  }

  /* ── Diapositiva: turno de una línea ──────────────────────────────────── */
  function renderTurnoSlide(slide) {
    const turno = currentTurno();
    const l     = slide.linea;
    const ld    = kpiData[l] || {};
    const tot   = ld[turno]?.totals || {};
    const slots = (ld[turno]?.slots || []).filter(s => s.ciclos_totales > 0 || s.paros_min > 0);
    const label = LINEA_LABELS[l] || l;
    const ciclosTotales = (ld[turno]?.slots || []).reduce((s, x) => s + (x.ciclos_totales || 0), 0);

    return `
      <div class="ss-slide">
        <div class="ss-slide-title">Turno ${turno.slice(1)} · ${label}</div>
        <div class="ss-slide-subtitle">${nowDateLong()}</div>
        <div class="ss-summary-row">
          <div class="ss-stat-chip"><span class="val">${ciclosTotales}</span><span class="lbl">Ciclos</span></div>
          <div class="ss-stat-chip" style="color:#f59e0b"><span class="val">${tot.paros_min != null ? Math.round(tot.paros_min) : 0}</span><span class="lbl">Paros (min)</span></div>
        </div>
        <div class="ss-kpi-grid">
          ${kpiCard('Eficiencia',     tot.eficiencia)}
          ${kpiCard('Capacidad',      tot.capacidad)}
          ${kpiCard('Calidad',        tot.calidad)}
          ${kpiCard('Disponibilidad', tot.disponibilidad)}
        </div>
        ${slots.length ? `
        <div style="flex:1;overflow:auto">
          <table class="ss-slots-table">
            <thead><tr>
              <th>Hora</th><th>Ciclos</th><th>Eficiencia</th><th>Capacidad</th><th>Calidad</th><th>Disponibilidad</th>
            </tr></thead>
            <tbody>
              ${slots.map(s => `<tr>
                <td>${escHtml(s.hora_inicio)}–${escHtml(s.hora_fin)}</td>
                <td style="text-align:center;font-weight:700">${s.ciclos_totales}</td>
                <td class="kpi-cell ${kpiClass(s.eficiencia)}">${fmtPct(s.eficiencia)}</td>
                <td class="kpi-cell ${kpiClass(s.capacidad)}">${fmtPct(s.capacidad)}</td>
                <td class="kpi-cell ${kpiClass(s.calidad)}">${fmtPct(s.calidad)}</td>
                <td class="kpi-cell ${kpiClass(s.disponibilidad)}">${fmtPct(s.disponibilidad)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<div class="ss-no-data">Sin ciclos registrados en este turno</div>'}
      </div>`;
  }

  /* ── Diapositiva: turno TODAS las líneas ─────────────────────────────── */
  function renderAllSlide(slide) {
    const turno  = currentTurno();
    const lineas = ['L3', 'L4', 'Baker'];

    const panels = lineas.map(l => {
      const ld  = kpiData[l] || {};
      const tot = ld[turno]?.totals || {};
      const ciclos = (ld[turno]?.slots || []).reduce((s, x) => s + (x.ciclos_totales || 0), 0);
      return `
        <div class="ss-linea-panel">
          <h3>${LINEA_LABELS[l] || l}</h3>
          <div class="ss-summary-row" style="margin-bottom:12px">
            <div class="ss-stat-chip"><span class="val" style="font-size:22px">${ciclos}</span><span class="lbl">Ciclos</span></div>
            <div class="ss-stat-chip"><span class="val" style="font-size:22px;color:#f59e0b">${tot.paros_min != null ? Math.round(tot.paros_min) : 0}</span><span class="lbl">Paros min</span></div>
          </div>
          <div class="ss-mini-kpi-grid">
            ${miniKpiCard('Eficiencia',     tot.eficiencia)}
            ${miniKpiCard('Capacidad',      tot.capacidad)}
            ${miniKpiCard('Calidad',        tot.calidad)}
            ${miniKpiCard('Disponibilidad', tot.disponibilidad)}
          </div>
        </div>`;
    }).join('');

    return `
      <div class="ss-slide">
        <div class="ss-slide-title">Turno ${turno.slice(1)} · Todas las Líneas (L3, L4 y Baker)</div>
        <div class="ss-slide-subtitle">${nowDateLong()}</div>
        <div class="ss-tres-grid" style="flex:1;margin-top:8px">${panels}</div>
      </div>`;
  }

  /* ── Diapositiva: acumulado del día de una línea ─────────────────────── */
  function renderDiaSlide(slide) {
    const l      = slide.linea;
    const ld     = kpiData[l] || {};
    const diaT   = ld.totales_dia || {};
    const label  = LINEA_LABELS[l] || l;
    const fecha  = new Date().toLocaleDateString(MX, { day:'2-digit', month:'short', year:'numeric' });

    const turnoRows = ['T1', 'T2', 'T3'].map(t => {
      const tot    = ld[t]?.totals || {};
      const ciclos = (ld[t]?.slots || []).reduce((s, x) => s + (x.ciclos_totales || 0), 0);
      return `
        <div class="ss-dia-row">
          <span class="ss-dia-t-lbl">Turno ${t.slice(1)}</span>
          <span class="kpi-cell ${kpiClass(tot.eficiencia)}">${fmtPct(tot.eficiencia)}</span>
          <span class="kpi-cell ${kpiClass(tot.capacidad)}">${fmtPct(tot.capacidad)}</span>
          <span class="kpi-cell ${kpiClass(tot.calidad)}">${fmtPct(tot.calidad)}</span>
          <span class="kpi-cell ${kpiClass(tot.disponibilidad)}">${fmtPct(tot.disponibilidad)}</span>
          <span class="ss-dia-ciclos">${ciclos} ciclos</span>
        </div>`;
    }).join('');

    return `
      <div class="ss-slide">
        <div class="ss-slide-title">${fecha} · ${label}</div>
        <div class="ss-slide-subtitle">${nowDateLong()}</div>

        <!-- Subtotales por turno -->
        <div class="ss-dia-turnos">
          <div class="ss-dia-row ss-dia-header">
            <span class="ss-dia-t-lbl">Turno</span>
            <span>Eficiencia</span><span>Capacidad</span><span>Calidad</span><span>Disponibilidad</span>
            <span>Ciclos</span>
          </div>
          ${turnoRows}
        </div>

        <!-- Total del día grande -->
        <div class="ss-dia-total-sep">Total del Día</div>
        <div class="ss-kpi-grid">
          ${kpiCard('Eficiencia',     diaT.eficiencia)}
          ${kpiCard('Capacidad',      diaT.capacidad)}
          ${kpiCard('Calidad',        diaT.calidad)}
          ${kpiCard('Disponibilidad', diaT.disponibilidad)}
        </div>
      </div>`;
  }

  /* ── Slide de imagen ──────────────────────────────────────────────────── */
  function renderImageSlide(slide) {
    return `
      <div class="ss-img-slide">
        <img src="${escHtml(slide.imagen_b64)}" alt="${escHtml(slide.titulo)}" />
        ${slide.titulo ? `<div class="ss-img-title">${escHtml(slide.titulo)}</div>` : ''}
      </div>`;
  }

  // ── KPI card builders ─────────────────────────────────────────────────────
  function kpiCard(label, val) {
    const cls = kpiClass(val);
    return `<div class="ss-kpi-card ${cls !== 'kpi-na' ? cls : ''}">
      <div class="ss-kpi-label">${label}</div>
      <div class="ss-kpi-value ${cls}">${fmtPct(val)}</div>
    </div>`;
  }

  function miniKpiCard(label, val) {
    const cls = kpiClass(val);
    return `<div class="ss-mini-kpi">
      <div class="lbl">${label}</div>
      <div class="val ${cls}">${fmtPct(val)}</div>
    </div>`;
  }

  // ── Navigation & Timer ────────────────────────────────────────────────────
  function clearTimers() {
    clearTimeout(slideTimer);
    clearInterval(progressInt);
  }

  function startSlideTimer() {
    clearTimers();
    const durMs  = slideDurSec * 1000;
    const tickMs = 300;
    let elapsed  = 0;
    updateProgress(0);

    progressInt = setInterval(() => {
      elapsed += tickMs;
      const pct = Math.min(100, (elapsed / durMs) * 100);
      updateProgress(pct);
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
      if (el) el.textContent = nowTimeStr();
      updateTurnoBadge();
    }, 1000);
  }

  // ── Data refresh (each 5 min) ─────────────────────────────────────────────
  function startDataRefresh() {
    setInterval(async () => {
      await fetchKpi();
      await fetchConfig();
      buildSlides();
      renderCurrentSlide();
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
    applyTheme();
    renderCurrentSlide();
    startSlideTimer();
    startClock();
    startDataRefresh();
    updateTurnoBadge();
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    applyTheme();

    // Load user list
    try {
      const res  = await fetch(API + '/auth/usuarios');
      const users = await res.json();
      const sel  = document.getElementById('ss-user-sel');
      users.forEach(u => {
        const o = document.createElement('option');
        o.value = u.email;
        o.textContent = u.nombre;
        sel.appendChild(o);
      });
    } catch {}

    // Bind events
    document.getElementById('ss-login-btn').addEventListener('click', doLogin);
    document.getElementById('ss-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('ss-exit').addEventListener('click', doLogout);
    document.getElementById('ss-prev').addEventListener('click', prevSlide);
    document.getElementById('ss-next').addEventListener('click', nextSlide);

    // Theme toggle
    document.getElementById('ss-theme-btn')?.addEventListener('click', () => {
      darkMode = !darkMode;
      localStorage.setItem('ss_theme', darkMode ? 'dark' : 'light');
      applyTheme();
    });

    // Font size
    document.querySelectorAll('.ss-font-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        fontSize = btn.dataset.font;
        localStorage.setItem('ss_font', fontSize);
        applyTheme();
      });
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') nextSlide();
      if (e.key === 'ArrowLeft')  prevSlide();
      if (e.key === 'Escape')     doLogout();
    });

    // Auto-login
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
