// Pizarrón Digital — Slideshow KPI
(function () {
  'use strict';

  // ── Definición de diapositivas ────────────────────────────────────────────
  const SLIDES = [
    { id: 1, scope: 'turno', linea: 'L3'    },
    { id: 2, scope: 'turno', linea: 'L4'    },
    { id: 3, scope: 'turno', linea: 'Baker' },
    { id: 4, scope: 'turno', linea: 'all'   },
    { id: 5, scope: 'dia',   linea: 'L3'    },
    { id: 6, scope: 'dia',   linea: 'L4'    },
    { id: 7, scope: 'dia',   linea: 'Baker' },
    { id: 8, scope: 'dia',   linea: 'all'   },
  ];

  const LINEA_LABELS = { L3: 'Línea 3', L4: 'Línea 4', Baker: 'Baker' };
  const FONT_SIZES   = { sm: '11px', md: '14px', lg: '18px', xl: '24px' };

  // ── State ─────────────────────────────────────────────────────────────────
  let state = {
    data:         null,
    scrapData:    {},
    error:        null,
    fecha:        todayStr(),
    slideIdx:     0,
    playing:      true,
    slideDurSec:  30,
    lastRefresh:  null,
    darkMode:     localStorage.getItem('pizarron_theme') === 'dark',
    fontSize:     localStorage.getItem('pizarron_font') || 'md'
  };

  let slideTimer    = null;
  let progressTimer = null;
  let dataTimer     = null;
  let clockTimer    = null;
  let progressStart = null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function todayStr() {
    // Usa zona horaria Mexico City (no UTC) y aplica shift date:
    // T3 nocturno (00:00-06:29 local) pertenece al día anterior
    const now   = new Date();
    const mxNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const mins  = mxNow.getHours() * 60 + mxNow.getMinutes();
    if (mins < 6 * 60 + 30) {
      const d = new Date(now.getTime() - 86400000);
      return d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    }
    return now.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  }

  function nowStr() {
    return new Date().toLocaleString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function currentTurno() {
    const t = new Date().getHours() * 60 + new Date().getMinutes();
    if (t >= 6*60+30 && t < 14*60+30) return 'T1';
    if (t >= 14*60+30 && t < 21*60+30) return 'T2';
    return 'T3';
  }

  function kpiColor(val) {
    if (val === null || val === undefined) return '';
    const n = Number(val);
    if (isNaN(n)) return '';
    if (n >= 90) return 'kpi-green';
    if (n >= 70) return 'kpi-amber';
    return 'kpi-red';
  }

  function scrapColor(pct) {
    if (pct === null || pct === undefined) return '';
    const n = Number(pct);
    if (isNaN(n)) return '';
    if (n < 1)  return 'kpi-green';
    if (n <= 3) return 'kpi-amber';
    return 'kpi-red';
  }

  function kpiEmoji(val) {
    if (val === null || val === undefined) return '';
    const n = Number(val);
    if (isNaN(n)) return '';
    if (n >= 90) return '😊';
    if (n >= 70) return '😐';
    return '😢';
  }

  // Calcula eficiencia usando solo horas completadas del turno activo.
  // Retorna: { value: number|null, na: boolean }
  // na=true  → primera hora en curso → mostrar "N/A"
  // value=null → turno no activo o histórico → usar valor del backend
  function calcEficienciaCompletada(linea, turno) {
    const turnoActual = currentTurno();
    if (turnoActual !== turno) return { value: null, na: false };

    const now      = new Date();
    const nowMins  = now.getHours() * 60 + now.getMinutes();
    const TURNO_START = { T1: 6*60+30, T2: 14*60+30, T3: 21*60+30 };
    const start = TURNO_START[turno];

    let elapsedMins;
    if (turno === 'T3') {
      elapsedMins = nowMins >= start ? nowMins - start : 1440 - start + nowMins;
    } else {
      elapsedMins = nowMins - start;
      if (elapsedMins < 0) return { value: null, na: false };
    }

    const currentSlotIdx = Math.floor(elapsedMins / 60);
    if (currentSlotIdx <= 0) return { value: null, na: true }; // primera hora en curso

    const horas = state.data?.[linea]?.horas?.[turno] || [];
    const completed = horas.slice(0, currentSlotIdx);
    if (completed.length === 0) return { value: null, na: true };

    const sumCiclos = completed.reduce((s, h) => s + (h.ciclos     || 0), 0);
    const sumObj    = completed.reduce((s, h) => s + (h.ciclos_obj || 0), 0);

    if (sumObj === 0) return { value: sumCiclos === 0 ? 100 : null, na: false };
    return { value: (sumCiclos / sumObj) * 100, na: false };
  }

  function fmtPct(val) {
    if (val === null || val === undefined) return '—';
    const n = Number(val);
    if (isNaN(n)) return '—';
    return n.toFixed(1) + '%';
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Fetch & Transform ─────────────────────────────────────────────────────
  async function fetchData() {
    try {
      const token = localStorage.getItem('prod_token') || '';
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const [res, scrapRes] = await Promise.all([
        fetch(`/api/produccion/pizarron?linea=ambas&fecha=${state.fecha}&turno=all`, { headers }),
        fetch(`/api/produccion/scrap/resumen?fecha_ini=${state.fecha}&fecha_fin=${state.fecha}`, { headers })
      ]);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.json();
      const pct = v => (v != null ? v * 100 : null);

      // Scrap por linea
      const scrapMap = {};
      if (scrapRes.ok) {
        const scrapJson = await scrapRes.json();
        for (const r of (scrapJson.resumen || [])) {
          scrapMap[r.linea] = r.pct_scrap;
        }
      }

      const transformed = {};
      for (const [l, ld] of Object.entries(raw?.data || {})) {
        const horas = {}, totales = {}, paros_turno = {}, no_trabajado = {};
        for (const t of ['T1', 'T2', 'T3']) {
          const td    = ld[t] || {};
          const slots = td.slots || [];
          horas[t] = slots.map(s => ({
            hora:           `${s.hora_inicio}–${s.hora_fin}`,
            hora_inicio:    s.hora_inicio,
            hora_fin:       s.hora_fin,
            ciclos:         s.ciclos_totales ?? 0,
            ciclos_obj:     s.ciclos_obj ?? 0,
            eficiencia:     pct(s.eficiencia),
            capacidad:      pct(s.capacidad),
            calidad:        pct(s.calidad),
            disponibilidad: pct(s.disponibilidad),
            rendimiento:    pct(s.rendimiento),
            paros_min:      s.paros_min ?? 0
          }));
          const tot = td.totals || {};
          totales[t] = {
            ciclos:         slots.reduce((acc, x) => acc + (x.ciclos_totales ?? 0), 0),
            eficiencia:     pct(tot.eficiencia),
            capacidad:      pct(tot.capacidad),
            calidad:        pct(tot.calidad),
            disponibilidad: pct(tot.disponibilidad),
            rendimiento:    pct(tot.rendimiento)
          };
          paros_turno[t]  = td.pareto_paros || [];
          no_trabajado[t] = td.turno_no_trabajado || false;
        }
        const tdia = ld.totales_dia || {};
        totales.dia = {
          eficiencia:     pct(tdia.eficiencia),
          capacidad:      pct(tdia.capacidad),
          calidad:        pct(tdia.calidad),
          disponibilidad: pct(tdia.disponibilidad),
          rendimiento:    pct(tdia.rendimiento)
        };
        transformed[l] = {
          horas,
          totales,
          paros_turno,
          no_trabajado,
          pareto_paros:    raw?.data?.[l]?.pareto_paros    || [],
          pareto_defectos: raw?.data?.[l]?.pareto_defectos || []
        };
      }

      state.data        = transformed;
      state.scrapData   = scrapMap;
      state.error       = null;
      state.lastRefresh = new Date();
    } catch (e) {
      state.error = e.message;
    }
    renderSlide();
  }

  // ── Slideshow timer ───────────────────────────────────────────────────────
  function startSlideTimer() {
    clearTimeout(slideTimer);
    clearInterval(progressTimer);
    progressStart = Date.now();

    // Animate progress bar
    progressTimer = setInterval(() => {
      const bar = document.getElementById('pzs-progress-bar');
      if (!bar) return;
      const pct = Math.min(100, ((Date.now() - progressStart) / (state.slideDurSec * 1000)) * 100);
      bar.style.width = pct + '%';
    }, 120);

    slideTimer = setTimeout(() => {
      if (state.playing) {
        state.slideIdx = (state.slideIdx + 1) % SLIDES.length;
        renderSlide();
        startSlideTimer();
      }
    }, state.slideDurSec * 1000);
  }

  function stopSlideTimer() {
    clearTimeout(slideTimer);
    clearInterval(progressTimer);
  }

  function goToSlide(idx) {
    state.slideIdx = ((idx % SLIDES.length) + SLIDES.length) % SLIDES.length;
    renderSlide();
    if (state.playing) startSlideTimer();
  }

  // ── Clock ─────────────────────────────────────────────────────────────────
  function startClock() {
    if (clockTimer) return;
    clockTimer = setInterval(() => {
      const el = document.getElementById('pzs-clock');
      if (el) el.textContent = nowStr();
    }, 1000);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderSlide() {
    const app = document.getElementById('pizarron-app');
    if (!app) return;
    document.body.classList.toggle('pizarron-dark', state.darkMode);
    document.documentElement.style.setProperty('--pz-font', FONT_SIZES[state.fontSize] || '14px');
    app.innerHTML = buildHtml();
    bindEvents();
    startClock();
  }

  function slideTitle(slide, turno) {
    if (slide.scope === 'turno') {
      const label = slide.linea === 'all'
        ? 'Todas las Líneas (L3, L4 y Baker)'
        : LINEA_LABELS[slide.linea] || slide.linea;
      return `${turno} · ${label}`;
    } else {
      const label = slide.linea === 'all'
        ? 'Todas las Líneas (L3, L4 y Baker)'
        : LINEA_LABELS[slide.linea] || slide.linea;
      return `${state.fecha} · Día acumulado · ${label}`;
    }
  }

  function buildHtml() {
    const slide = SLIDES[state.slideIdx];
    const turno = currentTurno();
    const n     = state.slideIdx;
    const total = SLIDES.length;
    const refreshTxt = state.lastRefresh
      ? state.lastRefresh.toLocaleTimeString('es-MX')
      : '—';

    const dots = SLIDES.map((_, i) =>
      `<span class="pzs-dot${i === n ? ' pzs-dot-active' : ''}" data-idx="${i}"></span>`
    ).join('');

    const fontBtns = ['sm', 'md', 'lg', 'xl'].map(f => {
      const lbl = { sm: 'A−', md: 'A', lg: 'A+', xl: 'A⁺⁺' }[f];
      return `<button class="pzs-btn${state.fontSize === f ? ' pzs-btn-active' : ''}" data-font="${f}">${lbl}</button>`;
    }).join('');

    return `
      <div class="pzs-root">

        <!-- Progress bar -->
        <div class="pzs-progress-track">
          <div id="pzs-progress-bar" class="pzs-progress-bar" style="width:0%"></div>
        </div>

        <!-- Header -->
        <div class="pzs-header">
          <div class="pzs-header-left">
            <div class="pzs-slide-title">${escHtml(slideTitle(slide, turno))}</div>
            <div class="pzs-clock" id="pzs-clock">${nowStr()}</div>
          </div>
          <div class="pzs-header-right">
            <div class="pzs-slide-counter">${n + 1} / ${total}</div>
            <div class="pzs-refresh-lbl">Actualizado: ${refreshTxt} · Auto 60s</div>
          </div>
        </div>

        <!-- Content -->
        <div class="pzs-content">
          ${state.error
            ? `<div class="pzs-error">⚠️ Error al cargar datos: ${escHtml(state.error)}</div>`
            : (!state.data
              ? '<div class="pzs-loading">Cargando datos...</div>'
              : buildSlideContent(slide, turno)
            )
          }
        </div>

        <!-- Controls bar -->
        <div class="pzs-controls">
          <div class="pzs-nav-group">
            <button class="pzs-btn" id="pzs-prev">◀</button>
            <button class="pzs-btn" id="pzs-play">${state.playing ? '⏸' : '▶'}</button>
            <button class="pzs-btn" id="pzs-next">▶▶</button>
          </div>
          <div class="pzs-dots">${dots}</div>
          <div class="pzs-settings-group">
            ${fontBtns}
            <button class="pzs-btn" id="pzs-theme" title="Cambiar tema">
              ${state.darkMode ? '☀️ Claro' : '🌙 Oscuro'}
            </button>
            <button class="pzs-btn" id="pzs-refresh" title="Actualizar datos">↻</button>
          </div>
        </div>
      </div>`;
  }

  // ── Slide content builders ────────────────────────────────────────────────
  function buildSlideContent(slide, turno) {
    if (slide.scope === 'turno') {
      if (slide.linea === 'all') return buildAllTurnoSlide(turno);
      return buildTurnoSlide(slide.linea, turno);
    }
    if (slide.linea === 'all') return buildAllDiaSlide();
    return buildDiaSlide(slide.linea);
  }

  function kpiCard(label, val, big) {
    const cls = big ? 'pzs-kpi-card pzs-kpi-big' : 'pzs-kpi-card';
    return `
      <div class="${cls} ${kpiColor(val)}">
        <div class="pzs-kpi-label">${label}</div>
        <div class="pzs-kpi-value">${fmtPct(val)}<span style="font-size:.6em;margin-left:5px">${kpiEmoji(val)}</span></div>
      </div>`;
  }

  /* ── Diapositiva turno de una línea ───────────────────────────────────── */
  function buildTurnoSlide(linea, turno) {
    // Si el turno completo fue "no trabajado", mostrar banner especial
    if (state.data?.[linea]?.no_trabajado?.[turno]) {
      return `
        <div class="pzs-turno-slide">
          <div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:200px">
            <div class="pzs-paro-prog-banner">
              <div style="font-size:2.5em">⛔</div>
              <div style="font-size:1.8em;font-weight:900;letter-spacing:.05em">PARO PROGRAMADO</div>
              <div style="font-size:.9em;opacity:.8">Turno no trabajado — sin producción registrada</div>
            </div>
          </div>
        </div>`;
    }

    const tot   = state.data?.[linea]?.totales?.[turno] || {};
    const horas = state.data?.[linea]?.horas?.[turno]   || [];

    // Eficiencia global: solo horas completadas (excluye hora en curso)
    const efComp = calcEficienciaCompletada(linea, turno);
    let efDisplay, efColorClass;
    if (efComp.na) {
      efDisplay   = 'N/A';
      efColorClass = '';
    } else if (efComp.value !== null) {
      efDisplay    = fmtPct(efComp.value);
      efColorClass = kpiColor(efComp.value);
    } else {
      efDisplay    = fmtPct(tot.eficiencia);
      efColorClass = kpiColor(tot.eficiencia);
    }

    // Detectar índice del slot en curso para mostrarlo como "en proceso"
    let currentSlotIdx = -1;
    if (currentTurno() === turno) {
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const TURNO_START = { T1: 6*60+30, T2: 14*60+30, T3: 21*60+30 };
      const start = TURNO_START[turno];
      const elap = turno === 'T3'
        ? (nowMins >= start ? nowMins - start : 1440 - start + nowMins)
        : nowMins - start;
      if (elap >= 0) currentSlotIdx = Math.floor(elap / 60);
    }

    const EP = '<span style="font-size:10px;color:#94a3b8;font-style:italic">⏳ en proceso</span>';
    const hrRows = horas.map((h, idx) => {
      const ip = idx === currentSlotIdx;
      const em = v => ip ? '' : `<span style="font-size:.75em;margin-left:3px">${kpiEmoji(v)}</span>`;
      return `
      <tr${ip ? ' style="background:rgba(59,130,246,.08)"' : ''}>
        <td class="mono">${escHtml(h.hora)}</td>
        <td style="text-align:center;font-weight:700">${h.ciclos ?? '—'}</td>
        <td class="${ip ? '' : kpiColor(h.eficiencia)}">${ip ? EP : fmtPct(h.eficiencia)}${em(h.eficiencia)}</td>
        <td class="${ip ? '' : kpiColor(h.rendimiento)}">${ip ? EP : fmtPct(h.rendimiento)}${em(h.rendimiento)}</td>
        <td class="${ip ? '' : kpiColor(h.capacidad)}">${ip ? EP : fmtPct(h.capacidad)}${em(h.capacidad)}</td>
        <td class="${ip ? '' : kpiColor(h.calidad)}">${ip ? EP : fmtPct(h.calidad)}${em(h.calidad)}</td>
        <td class="${ip ? '' : kpiColor(h.disponibilidad)}">${ip ? EP : fmtPct(h.disponibilidad)}${em(h.disponibilidad)}</td>
        <td style="text-align:center;font-size:11px;color:#dc2626;font-weight:600">${ip ? EP : (h.paros_min > 0 ? h.paros_min + ' min' : '—')}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="pzs-no-data">Sin registros en este turno</td></tr>';

    const scrapPct  = state.scrapData?.[linea] ?? null;
    const parosList = state.data?.[linea]?.paros_turno?.[turno] || [];
    const parosTotalMin = parosList.reduce((s, p) => s + (p.duracion_min || 0), 0);

    const parosHtml = parosList.length > 0
      ? parosList.slice(0, 5).map(p =>
          `<div class="pzs-paro-row"><span class="pzs-paro-lbl">${escHtml(p.motivo)}</span><span class="pzs-paro-min">${p.duracion_min} min</span></div>`
        ).join('')
      : '<div style="font-size:11px;color:#94a3b8;font-style:italic">Sin paros registrados</div>';

    return `
      <div class="pzs-turno-slide">
        <!-- KPI cards grandes -->
        <div class="pzs-kpi-grid">
          <div class="pzs-kpi-card pzs-kpi-big ${efColorClass}">
            <div class="pzs-kpi-label">Eficiencia</div>
            <div class="pzs-kpi-value">${efDisplay}<span style="font-size:.6em;margin-left:5px">${efComp.na ? '' : kpiEmoji(efComp.value !== null ? efComp.value : tot.eficiencia)}</span></div>
          </div>
          ${kpiCard('Rendimiento',    tot.rendimiento,    true)}
          ${kpiCard('Capacidad',      tot.capacidad,      true)}
          ${kpiCard('Calidad',        tot.calidad,        true)}
          ${kpiCard('Disponibilidad', tot.disponibilidad, true)}
          <div class="pzs-kpi-card pzs-kpi-big ${scrapColor(scrapPct)}">
            <div class="pzs-kpi-label">% Scrap (día)</div>
            <div class="pzs-kpi-value">${scrapPct !== null ? scrapPct.toFixed(2) + '%' : '—'}</div>
          </div>
        </div>
        <div class="pzs-ciclos-badge">
          Ciclos completados: <strong>${tot.ciclos ?? horas.reduce((s, h) => s + (h.ciclos || 0), 0)}</strong>
          &nbsp;·&nbsp; Paros acumulados turno: <strong>${parosTotalMin} min</strong>
        </div>
        <!-- Tabla hora×hora + paros lado a lado -->
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div class="pzs-hr-table-wrap" style="flex:1">
            <table class="pzs-hr-table">
              <thead>
                <tr><th>Hora</th><th>Ciclos</th><th>Eficiencia</th><th>Rendimiento</th><th>Capacidad</th><th>Calidad</th><th>Disponibilidad</th><th>Paros (min)</th></tr>
              </thead>
              <tbody>${hrRows}</tbody>
            </table>
          </div>
          <div class="pzs-paros-panel">
            <div class="pzs-pareto-title">&#9201; Paros del turno</div>
            ${parosHtml}
          </div>
        </div>
      </div>`;
  }

  /* ── Diapositiva turno — TODAS las líneas ─────────────────────────────── */
  function buildAllTurnoSlide(turno) {
    const lineas = ['L3', 'L4', 'Baker'];

    const blocks = lineas.map(l => {
      const tot    = state.data?.[l]?.totales?.[turno] || {};
      const horas  = state.data?.[l]?.horas?.[turno]   || [];
      const ciclos = tot.ciclos ?? horas.reduce((s, h) => s + (h.ciclos || 0), 0);

      const efComp = calcEficienciaCompletada(l, turno);
      let efVal, efColor;
      if (efComp.na) {
        efVal = null; efColor = '';
      } else if (efComp.value !== null) {
        efVal = efComp.value; efColor = kpiColor(efVal);
      } else {
        efVal = tot.eficiencia; efColor = kpiColor(efVal);
      }
      const efCard = `<div class="pzs-kpi-card ${efColor}">
        <div class="pzs-kpi-label">Eficiencia</div>
        <div class="pzs-kpi-value">${efComp.na ? 'N/A' : fmtPct(efVal)}</div>
      </div>`;

      const scrapPct  = state.scrapData?.[l] ?? null;
      const parosList = state.data?.[l]?.paros_turno?.[turno] || [];
      const parosTot  = parosList.reduce((s, p) => s + (p.duracion_min || 0), 0);
      const noTrabajado = state.data?.[l]?.no_trabajado?.[turno] || false;

      return `
        <div class="pzs-all-linea-block">
          <div class="pzs-all-linea-label">${escHtml(LINEA_LABELS[l] || l)}</div>
          ${noTrabajado
            ? `<div class="pzs-paro-prog-sm">⛔ PARO PROGRAMADO</div>`
            : `<div class="pzs-kpi-grid pzs-kpi-grid-compact">
                ${efCard}
                ${kpiCard('Rendimiento',    tot.rendimiento)}
                ${kpiCard('Capacidad',      tot.capacidad)}
                ${kpiCard('Calidad',        tot.calidad)}
                ${kpiCard('Disponibilidad', tot.disponibilidad)}
                <div class="pzs-kpi-card ${scrapColor(scrapPct)}">
                  <div class="pzs-kpi-label">% Scrap</div>
                  <div class="pzs-kpi-value">${scrapPct !== null ? scrapPct.toFixed(2) + '%' : '—'}</div>
                </div>
              </div>
              <div class="pzs-ciclos-badge-sm">Ciclos: <strong>${ciclos}</strong> · Paros: <strong>${parosTot} min</strong></div>`
          }
        </div>`;
    }).join('');

    return `<div class="pzs-all-slide">${blocks}</div>`;
  }

  /* ── Pareto bar chart helper ──────────────────────────────────────────── */
  function buildParetoHtml(items, labelKey, valueKey, colorClass) {
    if (!items || items.length === 0) {
      return '<div class="pzs-pareto-empty">Sin datos</div>';
    }
    const top    = items.slice(0, 6);
    const maxVal = top[0][valueKey] || 1;
    return top.map(item => {
      const pct     = Math.round((item[valueKey] / maxVal) * 100);
      const valText = valueKey === 'duracion_min' ? `${item[valueKey]} min` : `${item[valueKey]}`;
      return `
        <div class="pzs-pareto-row">
          <span class="pzs-pareto-lbl" title="${escHtml(item[labelKey])}">${escHtml(item[labelKey])}</span>
          <div class="pzs-pareto-bar-line">
            <div class="pzs-pareto-bar-bg">
              <div class="pzs-pareto-bar ${colorClass}" style="width:${pct}%"></div>
            </div>
            <span class="pzs-pareto-val">${valText}</span>
          </div>
        </div>`;
    }).join('');
  }

  /* ── Diapositiva acumulado del día ────────────────────────────────────── */
  function buildDiaSlide(linea) {
    const ld       = state.data?.[linea];
    const dia      = ld?.totales?.dia || {};
    const scrapPct = state.scrapData?.[linea] ?? null;

    const turnoRows = ['T1', 'T2', 'T3'].map(t => {
      const tot    = ld?.totales?.[t] || {};
      const horas  = ld?.horas?.[t]   || [];
      const ciclos = tot.ciclos ?? horas.reduce((s, h) => s + (h.ciclos || 0), 0);
      if (ld?.no_trabajado?.[t]) {
        return `
          <div class="pzs-dia-row">
            <span class="pzs-dia-turno-lbl">${t}</span>
            <span style="grid-column:2/8;color:#b45309;font-weight:700;font-size:.82em;letter-spacing:.04em">⛔ PARO PROGRAMADO</span>
          </div>`;
      }
      return `
        <div class="pzs-dia-row">
          <span class="pzs-dia-turno-lbl">${t}</span>
          <span class="pzs-dia-kpi-cell ${kpiColor(tot.eficiencia)}">${fmtPct(tot.eficiencia)}</span>
          <span class="pzs-dia-kpi-cell ${kpiColor(tot.rendimiento)}">${fmtPct(tot.rendimiento)}</span>
          <span class="pzs-dia-kpi-cell ${kpiColor(tot.capacidad)}">${fmtPct(tot.capacidad)}</span>
          <span class="pzs-dia-kpi-cell ${kpiColor(tot.calidad)}">${fmtPct(tot.calidad)}</span>
          <span class="pzs-dia-kpi-cell ${kpiColor(tot.disponibilidad)}">${fmtPct(tot.disponibilidad)}</span>
          <span class="pzs-dia-ciclos-cell">${ciclos} ciclos</span>
        </div>`;
    }).join('');

    return `
      <div class="pzs-dia-slide">
        <!-- Subtotales por turno -->
        <div class="pzs-dia-turnos">
          <div class="pzs-dia-row pzs-dia-header">
            <span class="pzs-dia-turno-lbl">Turno</span>
            <span>Eficiencia</span><span>Rendimiento</span><span>Capacidad</span><span>Calidad</span><span>Disponibilidad</span>
            <span>Ciclos</span>
          </div>
          ${turnoRows}
        </div>

        <!-- Total del día (grande) -->
        <div class="pzs-dia-total-label">Total del Día</div>
        <div class="pzs-kpi-grid">
          ${kpiCard('Eficiencia',     dia.eficiencia,     true)}
          ${kpiCard('Rendimiento',    dia.rendimiento,    true)}
          ${kpiCard('Capacidad',      dia.capacidad,      true)}
          ${kpiCard('Calidad',        dia.calidad,        true)}
          ${kpiCard('Disponibilidad', dia.disponibilidad, true)}
          <div class="pzs-kpi-card pzs-kpi-big ${scrapColor(scrapPct)}">
            <div class="pzs-kpi-label">% Scrap</div>
            <div class="pzs-kpi-value">${scrapPct !== null ? scrapPct.toFixed(2) + '%' : '—'}</div>
          </div>
        </div>

        <!-- Pareto acumulado del día -->
        <div class="pzs-pareto-section">
          <div class="pzs-pareto-col">
            <div class="pzs-pareto-title">&#9201; Tiempos de Paro</div>
            ${buildParetoHtml(ld?.pareto_paros, 'motivo', 'duracion_min', 'pzs-bar-amber')}
          </div>
          <div class="pzs-pareto-col">
            <div class="pzs-pareto-title">&#128308; Rechazos de Calidad</div>
            ${buildParetoHtml(ld?.pareto_defectos, 'defecto', 'cantidad', 'pzs-bar-red')}
          </div>
        </div>
      </div>`;
  }

  /* ── Diapositiva acumulado del día — TODAS las líneas ─────────────────── */
  function buildAllDiaSlide() {
    const lineas = ['L3', 'L4', 'Baker'];

    // Agregar pareto de todas las líneas
    const parosAgg = {}, defectosAgg = {};
    for (const l of lineas) {
      for (const p of (state.data?.[l]?.pareto_paros || [])) {
        parosAgg[p.motivo] = (parosAgg[p.motivo] || 0) + p.duracion_min;
      }
      for (const d of (state.data?.[l]?.pareto_defectos || [])) {
        defectosAgg[d.defecto] = (defectosAgg[d.defecto] || 0) + d.cantidad;
      }
    }
    const parosAll = Object.entries(parosAgg)
      .map(([motivo, duracion_min]) => ({ motivo, duracion_min: Math.round(duracion_min) }))
      .sort((a, b) => b.duracion_min - a.duracion_min);
    const defectosAll = Object.entries(defectosAgg)
      .map(([defecto, cantidad]) => ({ defecto, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    const blocks = lineas.map(l => {
      const ld        = state.data?.[l];
      const dia       = ld?.totales?.dia || {};
      const scrapPct  = state.scrapData?.[l] ?? null;
      const ciclosDia = ['T1', 'T2', 'T3'].reduce((s, t) => {
        const tot = ld?.totales?.[t] || {};
        return s + (tot.ciclos ?? (ld?.horas?.[t] || []).reduce((a, h) => a + (h.ciclos || 0), 0));
      }, 0);
      const parosDia  = (ld?.pareto_paros || []).reduce((s, p) => s + (p.duracion_min || 0), 0);
      return `
        <div class="pzs-all-linea-block">
          <div class="pzs-all-linea-label">${escHtml(LINEA_LABELS[l] || l)}</div>
          <div class="pzs-kpi-grid pzs-kpi-grid-compact">
            ${kpiCard('Eficiencia',     dia.eficiencia)}
            ${kpiCard('Rendimiento',    dia.rendimiento)}
            ${kpiCard('Capacidad',      dia.capacidad)}
            ${kpiCard('Calidad',        dia.calidad)}
            ${kpiCard('Disponibilidad', dia.disponibilidad)}
            <div class="pzs-kpi-card ${scrapColor(scrapPct)}">
              <div class="pzs-kpi-label">% Scrap</div>
              <div class="pzs-kpi-value">${scrapPct !== null ? scrapPct.toFixed(2) + '%' : '—'}</div>
            </div>
          </div>
          <div class="pzs-ciclos-badge-sm">Ciclos día: <strong>${ciclosDia}</strong> · Paros: <strong>${parosDia} min</strong></div>
        </div>`;
    }).join('');

    return `
      <div class="pzs-all-dia-slide">
        <div class="pzs-all-slide">${blocks}</div>
        <div class="pzs-pareto-section">
          <div class="pzs-pareto-col">
            <div class="pzs-pareto-title">&#9201; Tiempos de Paro (todas las líneas)</div>
            ${buildParetoHtml(parosAll, 'motivo', 'duracion_min', 'pzs-bar-amber')}
          </div>
          <div class="pzs-pareto-col">
            <div class="pzs-pareto-title">&#128308; Rechazos de Calidad (todas las líneas)</div>
            ${buildParetoHtml(defectosAll, 'defecto', 'cantidad', 'pzs-bar-red')}
          </div>
        </div>
      </div>`;
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function bindEvents() {
    document.getElementById('pzs-prev')?.addEventListener('click', () => goToSlide(state.slideIdx - 1));
    document.getElementById('pzs-next')?.addEventListener('click', () => goToSlide(state.slideIdx + 1));

    document.getElementById('pzs-play')?.addEventListener('click', () => {
      state.playing = !state.playing;
      if (state.playing) startSlideTimer();
      else stopSlideTimer();
      renderSlide();
    });

    document.getElementById('pzs-theme')?.addEventListener('click', () => {
      state.darkMode = !state.darkMode;
      localStorage.setItem('pizarron_theme', state.darkMode ? 'dark' : 'light');
      renderSlide();
    });

    document.getElementById('pzs-refresh')?.addEventListener('click', fetchData);

    document.querySelectorAll('[data-font]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.fontSize = btn.dataset.font;
        localStorage.setItem('pizarron_font', state.fontSize);
        renderSlide();
      });
    });

    document.querySelectorAll('.pzs-dot').forEach(dot => {
      dot.addEventListener('click', () => goToSlide(Number(dot.dataset.idx)));
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    fetchData();
    if (state.playing) startSlideTimer();
    dataTimer = setInterval(fetchData, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
