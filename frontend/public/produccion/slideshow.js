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
    { id:'k4', cfgId:3, scope:'turno', linea:'all'   },  // Todas las líneas
    { id:'k5', cfgId:4, scope:'dia',   linea:'L3'    },
    { id:'k6', cfgId:5, scope:'dia',   linea:'L4'    },
    { id:'k7', cfgId:8, scope:'dia',   linea:'Baker' },
    { id:'k8', cfgId:6, scope:'dia',   linea:'all'   },  // Todas las líneas día
    { id:'k9', cfgId:9, scope:'trend_semana', linea:'all' }, // Tendencia semanal
    { id:'k10', cfgId:10, scope:'reconocimientos', linea:'all' }, // Reconocimiento
    { id:'k11', cfgId:11, scope:'turno', linea:'L1' },
    { id:'k12', cfgId:12, scope:'dia', linea:'L1' },
  ];

  const LINEA_LABELS = { L3:'Línea 3', L4:'Línea 4', Baker:'Baker', L1:'Línea 1' };
  const FONT_SIZES   = { sm:'12px', md:'15px', lg:'19px', xl:'24px' };

  // ── State ─────────────────────────────────────────────────────────────────
  let token       = null;
  let slides      = [];
  let slideIdx    = 0;
  let slideTimer  = null;
  let progressInt = null;
  let kpiData     = {};
  let weeklyData  = {};
  let scrapData   = {};   // { L3: pct, L4: pct, Baker: pct }  — today
  let weeklyScrap = {};   // { L3: [{fecha, pct}], L4: [...], Baker: [...] }
  let reconocimientosData = [];
  let ssConfig    = { default_duracion_seg: 120, slides: [] };
  let slideDurSec = 120;
  let isPaused    = false;
  let darkMode    = localStorage.getItem('ss_theme') !== 'light'; // dark por defecto
  let fontSize    = localStorage.getItem('ss_font') || 'md';

  // ── Helpers ───────────────────────────────────────────────────────────────
  const MX = 'es-MX';
  const MX_TZ = 'America/Mexico_City';
  function mxNowParts() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: MX_TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'
    }).formatToParts(new Date());
    return Object.fromEntries(parts.map(p => [p.type, p.value]));
  }
  function nowTimeStr() {
    return new Date().toLocaleTimeString(MX, { timeZone: MX_TZ, hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
  function nowDateLong() {
    return new Date().toLocaleDateString(MX, { timeZone: MX_TZ, weekday:'long', year:'numeric', month:'long', day:'numeric' });
  }
  function nowDateShort() {
    return new Date().toLocaleDateString('en-CA', { timeZone: MX_TZ });
  }
  function nowMins() {
    const p = mxNowParts();
    return Number(p.hour) * 60 + Number(p.minute);
  }
  // Shift date: T3 (00:00–06:29) belongs to previous day
  function shiftDate() {
    const m = nowMins();
    if (m < 6 * 60 + 30) {
      const d = new Date(Date.now() - 86400000);
      return d.toLocaleDateString('en-CA', { timeZone: MX_TZ });
    }
    return nowDateShort();
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
  function aggregateSnapshots(items) {
    const a = { efN:0,efD:0,calN:0,calD:0,capN:0,capD:0,dispN:0,dispD:0,rendN:0,rendD:0 };
    for (const s of (items || [])) {
      const efDen = Number(s.objetivo_eficiencia || 0);
      if (efDen > 0) { a.efD += efDen; a.efN += Number(s.ciclos_eficiencia ?? s.ciclos_totales ?? 0); }
      a.calN += Number(s.ciclos_buenos_calidad ?? s.ciclos_buenos ?? 0);
      a.calD += Number(s.ciclos_no_vacios_calidad ?? s.ciclos_no_vacios ?? 0);
      a.capN += Number(s.piezas_total || 0);
      a.capD += Number(s.piezas_obj_total || 0);
      const planned = Number(s.minutos_planificados || 0);
      const available = Math.max(0, planned - Number(s.paros_min_disp || 0));
      if (planned > 0) {
        a.dispD += planned; a.dispN += available;
        a.rendD += available; a.rendN += Math.max(0, available - Number(s.paros_min_rend || 0));
      }
    }
    return {
      eficiencia: a.efD > 0 ? a.efN / a.efD : null,
      calidad: a.calD > 0 ? a.calN / a.calD : null,
      capacidad: a.capD > 0 ? a.capN / a.capD : null,
      disponibilidad: a.dispD > 0 ? a.dispN / a.dispD : null,
      rendimiento: a.rendD > 0 ? a.rendN / a.rendD : null
    };
  }
  function kpiClass(v, target = 90) {
    if (v == null || isNaN(Number(v))) return 'kpi-na';
    const p = Number(v) * 100;
    if (p >= target) return 'kpi-green';
    if (p >= Math.max(0, target - 10)) return 'kpi-amber';
    return 'kpi-red';
  }
  function kpiEmoji(v, target = 90) {
    if (v == null || isNaN(Number(v))) return '';
    const p = Number(v) * 100;
    if (p >= target) return '&#x1F60A;'; // 😊
    if (p >= Math.max(0, target - 10)) return '&#x1F610;'; // 😐
    return '&#x1F622;'; // 😢
  }
  function kpiImg(v, size, inline, target = 90) {
    if (v == null || isNaN(Number(v))) return '';
    const p = Number(v) * 100;
    const src = p >= target ? '/emojis/bien.png' : p >= Math.max(0, target - 10) ? '/emojis/regular.png' : '/emojis/mal.png';
    const s = size || 30;
    const st = inline ? `width:${s}px;height:${s}px;vertical-align:middle;margin-left:4px` : `width:${s}px;height:${s}px;display:block;margin:6px auto 0`;
    return `<img src="${src}" style="${st}" alt="">`;
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

  // ── Scrap helpers ─────────────────────────────────────────────────────────
  function scrapCardClass(pct) {
    if (pct == null) return '';
    if (pct < 1)    return 'kpi-green';
    if (pct <= 3)   return 'kpi-amber';
    return 'kpi-red';
  }
  function fmtScrap(pct) {
    return pct != null ? pct.toFixed(2) + '%' : '—';
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
    const user_id  = document.getElementById('ss-user-sel').value;
    const password = document.getElementById('ss-pass').value;
    const errEl    = document.getElementById('ss-error');
    errEl.style.display = 'none';
    if (!user_id || !password) {
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
        body: JSON.stringify({ user_id, password })
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
      const fecha = shiftDate();
      const d = await apiFetch(`/pizarron?linea=ambas&fecha=${fecha}&turno=all`);
      if (d) kpiData = d.data || {};
    } catch {}
  }

  function getWeekRange() {
    const p = mxNowParts();
    const d = new Date(`${p.year}-${p.month}-${p.day}T12:00:00`);
    const day = d.getDay(); // 0=Dom, 1=Lun...
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d);
    mon.setDate(diff);
    const desde = mon.toLocaleDateString('en-CA', { timeZone: MX_TZ });
    const hasta  = nowDateShort();
    return { desde, hasta };
  }

  async function fetchScrap() {
    try {
      const fecha = shiftDate();
      const res   = await fetch(`${API}/scrap/resumen?fecha_ini=${fecha}&fecha_fin=${fecha}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) return;
      const data = await res.json();
      const map  = {};
      for (const r of (data.resumen || [])) map[r.linea] = r.pct_scrap;
      scrapData = map;
    } catch {}
  }

  async function fetchWeeklyScrap() {
    try {
      const { desde, hasta } = getWeekRange();
      const res = await fetch(`${API}/scrap/resumen?fecha_ini=${desde}&fecha_fin=${hasta}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) return;
      const data = await res.json();
      const byLinea = { L3: {}, L4: {}, Baker: {}, L1: {} };
      for (const r of (data.resumen || [])) {
        if (byLinea[r.linea]) byLinea[r.linea][r.fecha] = r.pct_scrap;
      }
      weeklyScrap = byLinea;
    } catch {}
  }

  async function fetchWeeklyKpi() {
    try {
      const { desde, hasta } = getWeekRange();
      const [dL3, dL4, dBk, dL1] = await Promise.all([
        apiFetch(`/kpis?linea=L3&desde=${desde}&hasta=${hasta}`),
        apiFetch(`/kpis?linea=L4&desde=${desde}&hasta=${hasta}`),
        apiFetch(`/kpis?linea=Baker&desde=${desde}&hasta=${hasta}`),
        apiFetch(`/kpis?linea=L1&desde=${desde}&hasta=${hasta}`)
      ]);
      weeklyData = {
        L3:    dL3?.snapshots  || [],
        L4:    dL4?.snapshots  || [],
        Baker: dBk?.snapshots  || [],
        L1:    dL1?.snapshots  || []
      };
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
    } else if (slide.scope === 'reconocimientos') {
      stage.innerHTML = renderReconocimientosSlide();
    } else if (slide.scope === 'trend_semana') {
      stage.innerHTML = renderTrendSemanaSlide();
    } else if (slide.scope === 'dia' && slide.linea === 'all') {
      stage.innerHTML = renderAllDiaSlide();
    } else if (slide.linea === 'all') {
      stage.innerHTML = renderAllSlide(slide);
    } else if (slide.scope === 'dia') {
      stage.innerHTML = renderDiaSlide(slide);
    } else {
      stage.innerHTML = renderTurnoSlide(slide);
    }
  }

  // Helper: obtener turno key para una linea (TL4 para L4 en modo TL4)
  function getTurnoKey(linea) {
    if (linea === 'L4' && kpiData.L4?.TL4) return 'TL4';
    return currentTurno();
  }
  // Helper: etiqueta turno para mostrar
  function getTurnoLabel(turno) {
    if (turno === 'TL4') return 'Turno L4';
    return `Turno ${turno.slice(1)}`;
  }

  /* ── Diapositiva: turno de una línea ──────────────────────────────────── */
  function renderTurnoSlide(slide) {
    const l        = slide.linea;
    const turno    = getTurnoKey(l);
    const ld       = kpiData[l] || {};
    const tot      = ld[turno]?.totals || {};
    const objKpi   = ld.objetivos || {};
    const slots    = (ld[turno]?.slots || []).filter(s => s.ciclos_totales > 0 || s.paros_min > 0 || s.es_hora_en_curso);
    const label    = LINEA_LABELS[l] || l;
    const ciclosTotales = (ld[turno]?.slots || []).reduce((s, x) => s + (x.ciclos_totales || 0), 0);
    const scrapPct = scrapData[l] != null ? scrapData[l] : null;
    const overtimeLegend = l === 'L4' && Number(ld[turno]?.minutos_adicionales || tot.minutos_adicionales || 0) > 0
      ? `<div style="margin:6px 0 10px;padding:8px 12px;border:1px solid #8b5cf6;border-radius:8px;background:rgba(124,58,237,.14);color:#c4b5fd;font-weight:800;text-align:center">⏱ TIEMPO ADICIONAL TL4 · incluido en el KPI hasta descargar la línea${(ld[turno]?.tiempo_extra_activo || tot.tiempo_extra_activo) ? ` · ACTIVO (${ld[turno]?.cargas_activas ?? tot.cargas_activas ?? 0} cargas)` : ''}</div>`
      : '';

    return `
      <div class="ss-slide">
        <div class="ss-slide-title">${getTurnoLabel(turno)} · ${label}</div>
        <div class="ss-slide-subtitle">${nowDateLong()}</div>
        ${overtimeLegend}
        <div class="ss-summary-row">
          <div class="ss-stat-chip"><span class="val">${ciclosTotales}</span><span class="lbl">Ciclos</span></div>
          <div class="ss-stat-chip" style="color:#f59e0b"><span class="val">${tot.paros_min != null ? Math.round(tot.paros_min) : 0}</span><span class="lbl">Paros (min)</span></div>
        </div>
        <div class="ss-kpi-grid">
          ${kpiCard('Eficiencia · horas cerradas', tot.eficiencia, objKpi.eficiencia ?? 85)}
          ${kpiCard('Capacidad',      tot.capacidad, objKpi.capacidad ?? 90)}
          ${kpiCard('Calidad',        tot.calidad, objKpi.calidad ?? 95)}
          ${kpiCard('Disponibilidad', tot.disponibilidad, objKpi.disponibilidad ?? 90)}
          ${kpiCard('Rendimiento',    tot.rendimiento, objKpi.rendimiento ?? 90)}
          <div class="ss-kpi-card ${scrapCardClass(scrapPct)}">
            <div class="ss-kpi-label">% Scrap (día)</div>
            <div class="ss-kpi-value ${scrapCardClass(scrapPct)}">${fmtScrap(scrapPct)}</div>
          </div>
        </div>
        ${slots.length ? `
        <div style="flex:1;overflow:auto;min-height:0">
          <table class="ss-slots-table">
            <thead><tr>
              <th>Hora</th><th>Ciclos</th><th>Obj.</th><th>Eficiencia</th><th>Capacidad</th><th>Calidad</th><th>Disponibilidad</th><th>Paros</th>
            </tr></thead>
            <tbody>
              ${slots.map(s => {
                const inProgress = !!s.es_hora_en_curso;
                const obj = Number(inProgress ? s.objetivo_transcurrido : (s.ciclos_obj_adj ?? s.ciclos_obj ?? 0));
                const cycles = Number(s.ciclos_totales || 0);
                const scale = Math.max(obj, cycles, 1);
                const actualWidth = Math.min(100, cycles / scale * 100);
                const targetWidth = Math.min(100, obj / scale * 100);
                const efficiency = inProgress ? s.eficiencia_avance : s.eficiencia;
                const rowStyle = s.es_tiempo_adicional
                  ? ' style="background:rgba(124,58,237,.16)"'
                  : (inProgress ? ' style="background:rgba(59,130,246,.10)"' : '');
                return `<tr${rowStyle}>
                <td>${escHtml(s.hora_inicio)}\u2013${escHtml(s.hora_fin)}${s.es_tiempo_adicional ? '<br><small style="color:#c4b5fd;font-weight:800">⏱ TIEMPO ADICIONAL</small>' : ''}</td>
                <td style="text-align:center;font-weight:700">${cycles}<div style="height:7px;background:#334155;border-radius:4px;position:relative;overflow:hidden;margin-top:3px"><div style="width:${targetWidth}%;height:100%;background:#64748b"></div><div style="position:absolute;left:0;top:1px;height:5px;width:${actualWidth}%;background:${cycles>=obj?'#22c55e':'#3b82f6'}"></div></div></td>
                <td style="text-align:center;color:#64748b">${obj.toFixed(1)}${inProgress ? `<br><small style="color:#60a5fa">${Number(s.progreso_pct||0).toFixed(0)}% hora</small>` : ''}</td>
                <td class="kpi-cell ${kpiClass(efficiency, objKpi.eficiencia ?? 85)}">${inProgress ? 'Avance ' : ''}${fmtPct(efficiency)} ${kpiImg(efficiency, 16, true, objKpi.eficiencia ?? 85)}</td>
                <td class="kpi-cell ${kpiClass(s.capacidad, objKpi.capacidad ?? 90)}">${fmtPct(s.capacidad)} ${kpiImg(s.capacidad, 16, true, objKpi.capacidad ?? 90)}</td>
                <td class="kpi-cell ${kpiClass(s.calidad, objKpi.calidad ?? 95)}">${fmtPct(s.calidad)} ${kpiImg(s.calidad, 16, true, objKpi.calidad ?? 95)}</td>
                <td class="kpi-cell ${kpiClass(s.disponibilidad, objKpi.disponibilidad ?? 90)}">${fmtPct(s.disponibilidad)} ${kpiImg(s.disponibilidad, 16, true, objKpi.disponibilidad ?? 90)}</td>
                <td style="text-align:center;font-size:11px;color:#dc2626;font-weight:600">${s.paros_min > 0 ? Math.round(s.paros_min) + ' min' : '\u2014'}</td>
              </tr>`; }).join('')}
            </tbody>
          </table>
        </div>` : '<div class="ss-no-data">Sin ciclos registrados en este turno</div>'}
      </div>`;
  }

  /* ── Diapositiva: turno TODAS las líneas ─────────────────────────────── */
  function renderAllSlide(slide) {
    const lineas = ['L3', 'L4', 'Baker', 'L1'];

    const panels = lineas.map(l => {
      const turno   = getTurnoKey(l);
      const ld      = kpiData[l] || {};
      const tot     = ld[turno]?.totals || {};
      const objKpi  = ld.objetivos || {};
      const ciclos  = (ld[turno]?.slots || []).reduce((s, x) => s + (x.ciclos_totales || 0), 0);
      const paretoP = (ld[turno]?.pareto_paros    || []).slice(0, 3);
      const paretoD = (ld[turno]?.pareto_defectos || []).slice(0, 3);
      const sp      = scrapData[l] != null ? scrapData[l] : null;
      return `
        <div class="ss-linea-panel">
          <h3>${LINEA_LABELS[l] || l}</h3>
          <div class="ss-summary-row" style="margin-bottom:8px">
            <div class="ss-stat-chip"><span class="val" style="font-size:20px">${ciclos}</span><span class="lbl">Ciclos</span></div>
            <div class="ss-stat-chip"><span class="val" style="font-size:20px;color:#f59e0b">${tot.paros_min != null ? Math.round(tot.paros_min) : 0}</span><span class="lbl">Paros min</span></div>
          </div>
          <div class="ss-mini-kpi-grid">
            ${miniKpiCard('Eficiencia',     tot.eficiencia, objKpi.eficiencia ?? 85)}
            ${miniKpiCard('Capacidad',      tot.capacidad, objKpi.capacidad ?? 90)}
            ${miniKpiCard('Calidad',        tot.calidad, objKpi.calidad ?? 95)}
            ${miniKpiCard('Disponibilidad', tot.disponibilidad, objKpi.disponibilidad ?? 90)}
            ${miniKpiCard('Rendimiento',    tot.rendimiento, objKpi.rendimiento ?? 90)}
            <div class="ss-mini-kpi"><div class="lbl">% Scrap</div><div class="val ${scrapCardClass(sp)}">${fmtScrap(sp)}</div></div>
          </div>
          <div class="ss-pareto-col" style="margin-top:8px">
            <div class="ss-pareto-title">&#9201; Paros</div>
            ${buildParetoHtml(paretoP, 'motivo', 'duracion_min', 'ss-bar-amber')}
          </div>
          <div class="ss-pareto-col" style="margin-top:6px">
            <div class="ss-pareto-title">&#128308; Rechazos</div>
            ${buildParetoHtml(paretoD, 'defecto', 'cantidad', 'ss-bar-red')}
          </div>
        </div>`;
    }).join('');

    return `
      <div class="ss-slide">
        <div class="ss-slide-title">Turno Actual · Todas las Líneas (L3, L4, Baker y L1)</div>
        <div class="ss-tres-grid" style="flex:1;margin-top:10px">${panels}</div>
      </div>`;
  }

  /* ── Pareto bar chart helper ──────────────────────────────────────────── */
  function buildParetoHtml(items, labelKey, valueKey, colorClass) {
    if (!items || items.length === 0) {
      return '<div class="ss-pareto-empty">Sin datos</div>';
    }
    const top    = items.slice(0, 6);
    const maxVal = top[0][valueKey] || 1;
    return top.map(item => {
      const pct     = Math.round((item[valueKey] / maxVal) * 100);
      const valText = valueKey === 'duracion_min' ? `${item[valueKey]} min` : `${item[valueKey]}`;
      return `
        <div class="ss-pareto-row">
          <span class="ss-pareto-lbl" title="${escHtml(item[labelKey])}">${escHtml(item[labelKey])}</span>
          <div class="ss-pareto-bar-line">
            <div class="ss-pareto-bar-bg">
              <div class="ss-pareto-bar ${colorClass}" style="width:${pct}%"></div>
            </div>
            <span class="ss-pareto-val">${valText}</span>
          </div>
        </div>`;
    }).join('');
  }

  /* ── Diapositiva: acumulado del día de una línea ─────────────────────── */
  function renderDiaSlide(slide) {
    const l        = slide.linea;
    const ld       = kpiData[l] || {};
    const diaT     = ld.totales_dia || {};
    const objKpi   = ld.objetivos || {};
    const label    = LINEA_LABELS[l] || l;
    const fecha    = new Date().toLocaleDateString(MX, { day:'2-digit', month:'short', year:'numeric' });
    const scrapPct = scrapData[l] != null ? scrapData[l] : null;
    const overtimeLegend = l === 'L4' && Number(ld.TL4?.minutos_adicionales || diaT.minutos_adicionales || 0) > 0
      ? `<div style="margin:6px 0 10px;padding:8px 12px;border:1px solid #8b5cf6;border-radius:8px;background:rgba(124,58,237,.14);color:#c4b5fd;font-weight:800;text-align:center">⏱ TIEMPO ADICIONAL TL4 incluido en el KPI del día${(ld.TL4?.tiempo_extra_activo || diaT.tiempo_extra_activo) ? ' · ACTIVO hasta descargar la línea' : ''}</div>`
      : '';

    // Para L4 en modo TL4, mostrar solo TL4; para el resto T1/T2/T3
    const turnosToShow = (l === 'L4' && ld.TL4) ? ['TL4'] : ['T1', 'T2', 'T3'];
    const turnoRows = turnosToShow.map(t => {
      const tot    = ld[t]?.totals || {};
      const ciclos = (ld[t]?.slots || []).reduce((s, x) => s + (x.ciclos_totales || 0), 0);
      return `
        <div class="ss-dia-row">
          <span class="ss-dia-t-lbl">${getTurnoLabel(t)}</span>
          <span class="kpi-cell ${kpiClass(tot.eficiencia, objKpi.eficiencia ?? 85)}">${fmtPct(tot.eficiencia)}</span>
          <span class="kpi-cell ${kpiClass(tot.capacidad, objKpi.capacidad ?? 90)}">${fmtPct(tot.capacidad)}</span>
          <span class="kpi-cell ${kpiClass(tot.calidad, objKpi.calidad ?? 95)}">${fmtPct(tot.calidad)}</span>
          <span class="kpi-cell ${kpiClass(tot.disponibilidad, objKpi.disponibilidad ?? 90)}">${fmtPct(tot.disponibilidad)}</span>
          <span class="kpi-cell ${kpiClass(tot.rendimiento, objKpi.rendimiento ?? 90)}">${fmtPct(tot.rendimiento)}</span>
          <span class="ss-dia-ciclos">${ciclos} ciclos</span>
        </div>`;
    }).join('');

    return `
      <div class="ss-slide">
        <div class="ss-slide-title">${fecha} · ${label}</div>
        ${overtimeLegend}

        <!-- Subtotales por turno -->
        <div class="ss-dia-turnos">
          <div class="ss-dia-row ss-dia-header">
            <span class="ss-dia-t-lbl">Turno</span>
            <span>Eficiencia</span><span>Capacidad</span><span>Calidad</span><span>Disponibilidad</span>
            <span>Rendimiento</span>
            <span>Ciclos</span>
          </div>
          ${turnoRows}
        </div>

        <!-- Fila inferior: KPI totales (izq) + Pareto (der) -->
        <div class="ss-dia-two-col">
          <div class="ss-dia-kpi-col">
            <div class="ss-dia-total-sep">Total del Día</div>
            <div class="ss-kpi-grid ss-kpi-sm">
              ${kpiCard('Eficiencia',     diaT.eficiencia, objKpi.eficiencia ?? 85)}
              ${kpiCard('Capacidad',      diaT.capacidad, objKpi.capacidad ?? 90)}
              ${kpiCard('Calidad',        diaT.calidad, objKpi.calidad ?? 95)}
              ${kpiCard('Disponibilidad', diaT.disponibilidad, objKpi.disponibilidad ?? 90)}
              ${kpiCard('Rendimiento',    diaT.rendimiento, objKpi.rendimiento ?? 90)}
              <div class="ss-kpi-card ${scrapCardClass(scrapPct)}">
                <div class="ss-kpi-label">% Scrap (día)</div>
                <div class="ss-kpi-value ${scrapCardClass(scrapPct)}">${fmtScrap(scrapPct)}</div>
              </div>
            </div>
          </div>
          <div class="ss-dia-pareto-col">
            <div class="ss-pareto-col">
              <div class="ss-pareto-title">&#9201; Tiempos de Paro</div>
              ${buildParetoHtml(ld.pareto_paros, 'motivo', 'duracion_min', 'ss-bar-amber')}
            </div>
            <div class="ss-pareto-col" style="margin-top:10px">
              <div class="ss-pareto-title">&#128308; Rechazos de Calidad</div>
              ${buildParetoHtml(ld.pareto_defectos, 'defecto', 'cantidad', 'ss-bar-red')}
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ── Diapositiva: acumulado del día — TODAS las líneas ───────────────── */
  function renderAllDiaSlide() {
    const lineas = ['L3', 'L4', 'Baker', 'L1'];
    const fecha  = new Date().toLocaleDateString(MX, { day:'2-digit', month:'short', year:'numeric' });

    // Agregar pareto de todas las líneas
    const parosAgg = {}, defectosAgg = {};
    for (const l of lineas) {
      for (const p of (kpiData[l]?.pareto_paros || [])) {
        parosAgg[p.motivo] = (parosAgg[p.motivo] || 0) + p.duracion_min;
      }
      for (const d of (kpiData[l]?.pareto_defectos || [])) {
        defectosAgg[d.defecto] = (defectosAgg[d.defecto] || 0) + d.cantidad;
      }
    }
    const parosAll = Object.entries(parosAgg)
      .map(([motivo, duracion_min]) => ({ motivo, duracion_min: Math.round(duracion_min) }))
      .sort((a, b) => b.duracion_min - a.duracion_min);
    const defectosAll = Object.entries(defectosAgg)
      .map(([defecto, cantidad]) => ({ defecto, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    const panels = lineas.map(l => {
      const ld      = kpiData[l] || {};
      const diaT    = ld.totales_dia || {};
      const objKpi  = ld.objetivos || {};
      const sp      = scrapData[l] != null ? scrapData[l] : null;
      const turnosL = (l === 'L4' && ld.TL4) ? ['TL4'] : ['T1','T2','T3'];
      const ciclosDia = turnosL.reduce((s, t) => s + ((ld[t]?.slots || []).reduce((a, x) => a + (x.ciclos_totales || 0), 0)), 0);
      return `
        <div class="ss-linea-panel">
          <h3>${LINEA_LABELS[l] || l}</h3>
          <div class="ss-mini-kpi-grid">
            ${miniKpiCard('Eficiencia',     diaT.eficiencia, objKpi.eficiencia ?? 85)}
            ${miniKpiCard('Capacidad',      diaT.capacidad, objKpi.capacidad ?? 90)}
            ${miniKpiCard('Calidad',        diaT.calidad, objKpi.calidad ?? 95)}
            ${miniKpiCard('Disponibilidad', diaT.disponibilidad, objKpi.disponibilidad ?? 90)}
            ${miniKpiCard('Rendimiento',    diaT.rendimiento, objKpi.rendimiento ?? 90)}
            <div class="ss-mini-kpi"><div class="lbl">% Scrap</div><div class="val ${scrapCardClass(sp)}">${fmtScrap(sp)}</div></div>
          </div>
          <div style="text-align:center;font-size:.8em;color:#94a3b8;margin-top:4px">Ciclos día: <strong>${ciclosDia}</strong></div>
        </div>`;
    }).join('');

    return `
      <div class="ss-slide">
        <div class="ss-slide-title">${fecha} · Todas las Líneas (L3, L4, Baker y L1)</div>
        <div class="ss-slide-subtitle">${nowDateLong()}</div>
        <div class="ss-tres-grid" style="margin-bottom:10px">${panels}</div>
        <div class="ss-pareto-section">
          <div class="ss-pareto-col">
            <div class="ss-pareto-title">&#9201; Tiempos de Paro (todas las líneas)</div>
            ${buildParetoHtml(parosAll, 'motivo', 'duracion_min', 'ss-bar-amber')}
          </div>
          <div class="ss-pareto-col">
            <div class="ss-pareto-title">&#128308; Rechazos de Calidad (todas las líneas)</div>
            ${buildParetoHtml(defectosAll, 'defecto', 'cantidad', 'ss-bar-red')}
          </div>
        </div>
      </div>`;
  }

  /* ── SVG bar chart para diapositiva de tendencia ─────────────────────── */
  function buildSVGTrend(series, xLabels, opts = {}) {
    const W = 420, H = 140;
    const PAD = { top: 24, right: 40, bottom: 20, left: 36 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;
    const n = xLabels.length;
    if (n === 0) return '<div class="ss-no-data">Sin datos</div>';
    const allVals = series.flatMap(s => s.data.filter(v => v != null));
    if (allVals.length === 0) return '<div class="ss-no-data">Sin datos esta semana</div>';
    const dataMin = Math.min(...allVals);
    const dataMax = Math.max(...allVals);
    const spread  = dataMax - dataMin || 5;
    const padY    = spread * 0.2;
    let minV = opts.floorZero ? 0 : Math.max(0, Math.floor(dataMin - padY));
    let maxV = Math.min(Math.ceil(dataMax + padY * 2.2), opts.hardMax || 100);
    if (opts.target != null) {
      if (opts.target < minV) minV = Math.max(0, Math.floor(opts.target - padY));
      if (opts.target > maxV) maxV = Math.min(Math.ceil(opts.target + padY), opts.hardMax || 100);
    }
    const range = maxV - minV || 1;
    const yPos = v => PAD.top + cH - Math.max(0, (v - minV) / range) * cH;
    const gridVals = [0, 1/3, 2/3, 1].map(t => +(minV + t * range).toFixed(1));
    const grid = gridVals.map(v => {
      const y = yPos(v).toFixed(1);
      return `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + cW}" y2="${y}" stroke="#334155" stroke-width="1"/>` +
             `<text x="${PAD.left - 3}" y="${(+y + 3).toFixed(1)}" text-anchor="end" font-size="7" fill="#64748b">${Math.round(v)}%</text>`;
    }).join('');
    const barGroupW = cW / n;
    const xAxis = xLabels.map((l, i) => {
      const cx = PAD.left + (i + 0.5) * barGroupW;
      return `<text x="${cx.toFixed(1)}" y="${(PAD.top + cH + 12).toFixed(1)}" text-anchor="middle" font-size="8" fill="#64748b">${escHtml(String(l))}</text>`;
    }).join('');
    let targetLine = '';
    if (opts.target != null) {
      const clampedT = Math.max(minV, Math.min(maxV, opts.target));
      const ty = yPos(clampedT).toFixed(1);
      targetLine =
        `<line x1="${PAD.left}" y1="${ty}" x2="${PAD.left + cW}" y2="${ty}" stroke="#22c55e" stroke-width="1.5" stroke-dasharray="5,3"/>` +
        `<text x="${PAD.left + cW + 3}" y="${(+ty + 3).toFixed(1)}" font-size="6.5" fill="#22c55e" font-weight="700">${opts.target}%</text>`;
    }
    const nseries = series.length;
    const barW = Math.max(2, barGroupW / nseries - 2);
    let bars = '', valLabels = '';
    series.forEach((s, si) => {
      s.data.forEach((v, i) => {
        if (v == null) return;
        const cx = PAD.left + (i + 0.5) * barGroupW + (si - (nseries - 1) / 2) * (barW + 1);
        const y  = yPos(v);
        const bH = Math.max(1, PAD.top + cH - y);
        bars += `<rect x="${(cx - barW/2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" rx="1" fill="${s.color}" opacity="0.85"/>`;
        if (bH >= 8) {
          valLabels += `<text x="${cx.toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle" font-size="5.5" fill="${s.color}" font-weight="700">${Math.round(v)}</text>`;
        }
      });
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="flex:1;display:block;min-height:0">${grid}${targetLine}${xAxis}${bars}${valLabels}</svg>`;
  }

  /* ── Diapositiva: tendencia semanal de KPIs por línea ────────────────── */
  function renderTrendSemanaSlide() {
    const { desde, hasta } = getWeekRange();
    const LINEAS = ['L3', 'L4', 'Baker', 'L1'];
    const COLORS = { L3: '#3b82f6', L4: '#10b981', Baker: '#f59e0b', L1: '#8b5cf6' };
    const allDates = new Set();
    const dailyByLinea = {};
    LINEAS.forEach(l => {
      const snaps = weeklyData[l] || [];
      const grouped = {};
      snaps.forEach(s => {
        allDates.add(s.fecha);
        (grouped[s.fecha] ||= []).push(s);
      });
      const byDate = Object.fromEntries(Object.entries(grouped).map(([fecha, items]) => [fecha, aggregateSnapshots(items)]));
      dailyByLinea[l] = byDate;
    });

    const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    function fechaToDia(f) {
      const d = new Date(f + 'T12:00:00');
      const day = d.getDay();
      return day === 0 ? 6 : day - 1; // 0=Lun … 6=Dom
    }
    // Mapear fechas a índice de día de semana para eje X fijo
    const fechaByDia = {};
    for (const f of allDates) fechaByDia[fechaToDia(f)] = f;

    function getSeries(kpiFn) {
      return LINEAS.map(l => ({
        label: l,
        color: COLORS[l],
        data: DIAS_SEMANA.map((_, idx) => {
          const f = fechaByDia[idx];
          if (!f) return null;
          const d = dailyByLinea[l][f];
          return d ? kpiFn(d) : null;
        })
      }));
    }

    const pct = v => v == null ? null : +(v * 100).toFixed(1);
    const efSeries   = getSeries(d => pct(d.eficiencia));
    const calSeries  = getSeries(d => pct(d.calidad));
    const capSeries  = getSeries(d => pct(d.capacidad));
    const dispSeries = getSeries(d => pct(d.disponibilidad));
    const rendSeries = getSeries(d => pct(d.rendimiento));

    // Scrap series from weeklyScrap (inverted axis: lower is better)
    const scrapSeries = LINEAS.map(l => ({
      label: l,
      color: COLORS[l],
      data: DIAS_SEMANA.map((_, idx) => {
        const f = fechaByDia[idx];
        if (!f) return null;
        const pct = weeklyScrap[l]?.[f];
        return pct != null ? +Number(pct).toFixed(2) : null;
      })
    }));

    // Leyenda con emojis por linea al pie de cada tarjeta
    function trendLegend(ser, tgt, invertido) {
      const items = ser.map(s => {
        const vals = s.data.filter(v => v != null);
        const last = vals.length ? vals[vals.length - 1] : null;
        let img = '';
        if (last != null) {
          let src;
          if (invertido) {
            src = last < 1 ? '/emojis/bien.png' : last < 3 ? '/emojis/regular.png' : '/emojis/mal.png';
          } else {
            src = last >= tgt ? '/emojis/bien.png' : last >= tgt - 10 ? '/emojis/regular.png' : '/emojis/mal.png';
          }
          img = `<img src="${src}" style="width:22px;height:22px;vertical-align:middle">`;
        }
        return `<span class="ss-trend-leg-item"><span class="ss-trend-leg-dot" style="background:${s.color}"></span>${escHtml(s.label)}${img}</span>`;
      });
      return `<div class="ss-trend-legend">${items.join('')}</div>`;
    }
    function trendTitle(txt) {
      return `<div class="ss-trend-card-title">${txt}</div>`;
    }
    return `
      <div class="ss-slide">
        <div class="ss-slide-title">Tendencia Semanal de KPIs · ${escHtml(desde)} – ${escHtml(hasta)}</div>
        <div class="ss-trend-grid">
          <div class="ss-trend-card">
            ${trendTitle('Eficiencia (obj. 90%)')}
            ${buildSVGTrend(efSeries,    DIAS_SEMANA, { target:90 })}
            ${trendLegend(efSeries,   90, false)}
          </div>
          <div class="ss-trend-card">
            ${trendTitle('Calidad (obj. 99%)')}
            ${buildSVGTrend(calSeries,   DIAS_SEMANA, { target:99 })}
            ${trendLegend(calSeries,  99, false)}
          </div>
          <div class="ss-trend-card">
            ${trendTitle('Disponibilidad (obj. 90%)')}
            ${buildSVGTrend(dispSeries,  DIAS_SEMANA, { target:90 })}
            ${trendLegend(dispSeries, 90, false)}
          </div>
          <div class="ss-trend-card">
            ${trendTitle('Capacidad (obj. 85%)')}
            ${buildSVGTrend(capSeries,   DIAS_SEMANA, { target:85 })}
            ${trendLegend(capSeries,  85, false)}
          </div>
          <div class="ss-trend-card">
            ${trendTitle('Rendimiento (obj. 90%)')}
            ${buildSVGTrend(rendSeries,  DIAS_SEMANA, { target:90 })}
            ${trendLegend(rendSeries, 90, false)}
          </div>
          <div class="ss-trend-card">
            ${trendTitle('% Scrap (obj. &lt;1%)')}
            ${buildSVGTrend(scrapSeries, DIAS_SEMANA, { target:1, floorZero:true, hardMax:8 })}
            ${trendLegend(scrapSeries, 1, true)}
          </div>
        </div>
      </div>`;
  }

  /* ── Fetch reconocimientos ─────────────────────────────────────────── */
  async function fetchReconocimientos() {
    const fecha = shiftDate();
    try {
      const d = await apiFetch(`/reconocimientos?fecha=${fecha}`);
      if (d) reconocimientosData = d.operadores || {};
    } catch {}
  }

  /* ── Diapositiva: Reconocimiento de Operaciones (Eficiencia + Rendimiento) */
  function renderReconocimientosSlide() {
    const FRASES = [
      '\u00a1Turno de alto rendimiento, as\u00ed se hace!',
      '\u00a1Eficiencia y pasi\u00f3n, el equipo ganador!',
      '\u00a1Superaron el objetivo, orgullo del equipo!',
      '\u00a1KPIs en verde, gracias a ustedes!',
      '\u00a1Cada pieza cuenta, y la hicieron perfecta!'
    ];
    const LINEAS = ['L3', 'L4', 'Baker', 'L1'];
    const TURNO_LABEL = { T1:'Turno 1', T2:'Turno 2', T3:'Turno 3', TL4:'Turno L4' };
    const ganadores = [];
    for (const l of LINEAS) {
      const ld = kpiData[l] || {};
      const efTarget = Number(ld.objetivos?.eficiencia ?? 85) / 100;
      const rendTarget = Number(ld.objetivos?.rendimiento ?? 90) / 100;
      // Para L4 en modo TL4, revisar TL4; para el resto T1/T2/T3
      const turnosCheck = (l === 'L4' && ld.TL4) ? ['TL4'] : ['T1', 'T2', 'T3'];
      for (const t of turnosCheck) {
        const tot = ld[t]?.totals;
        if (!tot) continue;
        const ef   = tot.eficiencia;
        const rend = tot.rendimiento;
        if (ef != null && rend != null && ef >= efTarget && rend >= rendTarget) {
          const ops = (reconocimientosData[l] || {})[t] || [];
          ganadores.push({ linea: l, turno: t, eficiencia: ef, rendimiento: rend, calidad: tot.calidad, operadores: ops });
        }
      }
    }

    if (!ganadores.length) {
      return `<div class="ss-slide">
        <div class="ss-slide-title">&#127942; Reconocimiento del D\u00eda</div>
        <div class="ss-recono-empty">
          <img src="/emojis/regular.png" style="width:90px;height:90px;display:block;margin:0 auto 16px">
          <div class="ss-recono-empty-msg">\u00a1Sigan adelante! Cada turno es una nueva oportunidad.</div>
        </div>
      </div>`;
    }

    const cols = ganadores.length === 1 ? 1 : ganadores.length === 2 ? 2 : 3;
    const cards = ganadores.map((g, i) => {
      const frase = FRASES[i % FRASES.length];
      const lineaLabel = LINEA_LABELS[g.linea] || escHtml(g.linea);
      const opsHtml = g.operadores.length
        ? `<div class="ss-recono-ops">${g.operadores.map(n => `<span class="ss-recono-op-chip">${escHtml(n)}</span>`).join('')}</div>`
        : '';
      const calChip = g.calidad != null
        ? `<div class="ss-recono-chip ss-chip-cal">Cal. ${fmtPct(g.calidad)}</div>`
        : '';
      return `<div class="ss-recono-card">
        <div class="ss-recono-stars">&#10022; &#10022; &#10022;</div>
        <img src="/emojis/bien.png" class="ss-recono-emoji">
        <div class="ss-recono-felicita">&#161;FELICITACIONES!</div>
        ${opsHtml}
        <div class="ss-recono-badge">${escHtml(lineaLabel)} &nbsp;&middot;&nbsp; ${escHtml(TURNO_LABEL[g.turno] || g.turno)}</div>
        <div class="ss-recono-chips">
          <div class="ss-recono-chip ss-chip-ef">Efic. ${fmtPct(g.eficiencia)}</div>
          <div class="ss-recono-chip ss-chip-rend">Rend. ${fmtPct(g.rendimiento)}</div>
          ${calChip}
        </div>
        <div class="ss-recono-frase">&ldquo;${escHtml(frase)}&rdquo;</div>
      </div>`;
    }).join('');

    return `<div class="ss-slide">
      <div class="ss-slide-title">&#127942; Reconocimiento del D\u00eda</div>
      <div class="ss-recono-grid" style="grid-template-columns:repeat(${cols},1fr)">${cards}</div>
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
  function kpiCard(label, val, target = 90) {
    const cls = kpiClass(val, target);
    return `<div class="ss-kpi-card ${cls !== 'kpi-na' ? cls : ''}">
      <div class="ss-kpi-label">${label}</div>
      <div class="ss-kpi-value ${cls}" style="display:flex;align-items:center;justify-content:center;gap:10px">${fmtPct(val)}${kpiImg(val, 80, true, target)}</div>
    </div>`;
  }

  function miniKpiCard(label, val, target = 90) {
    const cls = kpiClass(val, target);
    return `<div class="ss-mini-kpi">
      <div class="lbl">${label}</div>
      <div class="val ${cls}">${fmtPct(val)}</div>
      ${kpiImg(val, 34, false, target)}
    </div>`;
  }

  // ── Navigation & Timer ────────────────────────────────────────────────────
  function clearTimers() {
    clearTimeout(slideTimer);
    clearInterval(progressInt);
  }

  function startSlideTimer() {
    clearTimers();
    if (isPaused) return;
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

  function togglePause() {
    isPaused = !isPaused;
    const btn = document.getElementById('ss-pause');
    if (isPaused) {
      clearTimers();
      updateProgress(0);
      if (btn) { btn.textContent = '▶'; btn.title = 'Reanudar'; }
    } else {
      if (btn) { btn.textContent = '⏸'; btn.title = 'Pausar'; }
      startSlideTimer();
    }
  }

  function nextSlide() {
    if (!slides.length) return;
    slideIdx = (slideIdx + 1) % slides.length;
    renderCurrentSlide();
    if (!isPaused) startSlideTimer();
  }

  function prevSlide() {
    if (!slides.length) return;
    slideIdx = (slideIdx - 1 + slides.length) % slides.length;
    renderCurrentSlide();
    if (!isPaused) startSlideTimer();
  }

  function goToSlide(i) {
    slideIdx = i;
    renderCurrentSlide();
    if (!isPaused) startSlideTimer();
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
  // ── Alerta urgente de mantenimiento ────────────────────────────────────────
  let mantAlertaTs   = new Date().toISOString();
  let mantSoundTimer = null;
  let mantAlertIds   = []; // IDs de OTs actualmente en pantalla

  function playAlertSound() {
    try {
      const ctx    = new (window.AudioContext || window.webkitAudioContext)();
      const beeps  = [880, 1100, 880, 1100, 880, 1100]; // 6 beeps fuertes
      beeps.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.28;
        g.gain.setValueAtTime(1.0, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.start(t); osc.stop(t + 0.22);
      });
    } catch(e) {}
  }

  function stopAlertSound() {
    clearInterval(mantSoundTimer);
    mantSoundTimer = null;
  }

  function startAlertSound() {
    stopAlertSound();
    playAlertSound();
    mantSoundTimer = setInterval(playAlertSound, 5000); // repite cada 5s
  }

  function formatHoraMx(iso) {
    try { return new Date(iso).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' }); }
    catch(e) { return ''; }
  }

  function showAlertaMant(urgencias) {
    const overlay = document.getElementById('ss-mant-alert');
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="ss-mant-alert-box">
        <div class="ss-mant-alert-title">🔧 Alerta de Mantenimiento</div>
        ${urgencias.map(o => `
          <div class="ss-mant-alert-item">
            <div class="ss-mant-alert-folio">${o.folio || ''}</div>
            <div class="ss-mant-alert-linea">${o.departamento_nombre || 'Línea'}</div>
            <div class="ss-mant-alert-row">
              <span class="ss-mant-alert-label">Motivo:</span>
              <span class="ss-mant-alert-desc">${o.descripcion || ''}</span>
            </div>
            <div class="ss-mant-alert-row">
              <span class="ss-mant-alert-label">Hora de inicio:</span>
              <span class="ss-mant-alert-hora">${formatHoraMx(o.created_at)}</span>
            </div>
          </div>`).join('')}
        <div class="ss-mant-alert-leyenda">⚠️ Favor contactar a técnico de mantenimiento</div>
        <button class="ss-mant-alert-close" onclick="
          document.getElementById('ss-mant-alert').style.display='none';
          stopAlertSound && stopAlertSound();
        ">✕ Cerrar</button>
      </div>`;
    overlay.querySelector('.ss-mant-alert-close').onclick = closeAlertaMant;
    mantAlertIds = urgencias.map(o => o.id);
    overlay.style.display = 'flex';
    startAlertSound();
  }

  function closeAlertaMant() {
    const overlay = document.getElementById('ss-mant-alert');
    if (overlay) overlay.style.display = 'none';
    stopAlertSound();
    mantAlertIds = [];
  }

  async function pollUrgencias() {
    try {
      const overlay = document.getElementById('ss-mant-alert');
      const alertaVisible = overlay && overlay.style.display !== 'none';

      // Si hay alerta en pantalla, verificar si las OTs siguen abiertas
      if (alertaVisible && mantAlertIds.length > 0) {
        const activas = await apiFetch(`/urgencias-mant?ids=${mantAlertIds.join(',')}`);
        if (Array.isArray(activas) && activas.length === 0) {
          closeAlertaMant(); // todas cerradas → cerrar alerta
          return;
        }
      }

      // Buscar OTs nuevas
      const data = await apiFetch(`/urgencias-mant?desde=${encodeURIComponent(mantAlertaTs)}`);
      if (Array.isArray(data) && data.length > 0) {
        mantAlertaTs = new Date().toISOString();
        showAlertaMant(data);
      }
    } catch(e) {}
  }

  async function initPollUrgencias() {
    // Carga inicial: verificar OTs urgentes actualmente abiertas (independiente de cuándo se cargó la página)
    try {
      const abiertas = await apiFetch('/urgencias-mant?activas=1');
      if (Array.isArray(abiertas) && abiertas.length > 0) {
        showAlertaMant(abiertas);
      }
    } catch(e) {}
    setInterval(pollUrgencias, 30 * 1000);
  }

  function startPollUrgencias() {
    initPollUrgencias();
  }

  function startDataRefresh() {
    setInterval(async () => {
      await fetchKpi();
      await fetchWeeklyKpi();
      await fetchScrap();
      await fetchWeeklyScrap();
      await fetchReconocimientos();
      await fetchConfig();
      buildSlides();
      renderCurrentSlide();
    }, 5 * 60 * 1000);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  async function boot() {
    document.getElementById('ss-stage').innerHTML = '<div class="ss-loading-msg">⏳ Cargando datos...</div>';
    await fetchConfig();
    await Promise.all([fetchKpi(), fetchWeeklyKpi(), fetchScrap(), fetchWeeklyScrap(), fetchReconocimientos()]);
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
    startPollUrgencias();
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
        o.value = u.id;
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
    document.getElementById('ss-pause').addEventListener('click', togglePause);

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
      if (e.key === ' ')          togglePause();
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
