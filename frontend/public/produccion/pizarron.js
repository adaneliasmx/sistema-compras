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
    return new Date().toISOString().slice(0, 10);
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
      const res = await fetch(`/api/produccion/pizarron?linea=ambas&fecha=${state.fecha}&turno=all`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.json();
      const pct = v => (v != null ? v * 100 : null);

      const transformed = {};
      for (const [l, ld] of Object.entries(raw?.data || {})) {
        const horas = {}, totales = {};
        for (const t of ['T1', 'T2', 'T3']) {
          const td    = ld[t] || {};
          const slots = td.slots || [];
          horas[t] = slots.map(s => ({
            hora:           `${s.hora_inicio}–${s.hora_fin}`,
            ciclos:         s.ciclos_totales ?? 0,
            eficiencia:     pct(s.eficiencia),
            capacidad:      pct(s.capacidad),
            calidad:        pct(s.calidad),
            disponibilidad: pct(s.disponibilidad)
          }));
          const tot = td.totals || {};
          totales[t] = {
            ciclos:         slots.reduce((acc, x) => acc + (x.ciclos_totales ?? 0), 0),
            eficiencia:     pct(tot.eficiencia),
            capacidad:      pct(tot.capacidad),
            calidad:        pct(tot.calidad),
            disponibilidad: pct(tot.disponibilidad)
          };
        }
        const tdia = ld.totales_dia || {};
        totales.dia = {
          eficiencia:     pct(tdia.eficiencia),
          capacidad:      pct(tdia.capacidad),
          calidad:        pct(tdia.calidad),
          disponibilidad: pct(tdia.disponibilidad)
        };
        transformed[l] = {
          horas,
          totales,
          pareto_paros:    raw?.data?.[l]?.pareto_paros    || [],
          pareto_defectos: raw?.data?.[l]?.pareto_defectos || []
        };
      }

      state.data        = transformed;
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
        <div class="pzs-kpi-value">${fmtPct(val)}</div>
      </div>`;
  }

  /* ── Diapositiva turno de una línea ───────────────────────────────────── */
  function buildTurnoSlide(linea, turno) {
    const tot   = state.data?.[linea]?.totales?.[turno] || {};
    const horas = state.data?.[linea]?.horas?.[turno]   || [];

    const hrRows = horas.map(h => `
      <tr>
        <td class="mono">${escHtml(h.hora)}</td>
        <td style="text-align:center;font-weight:700">${h.ciclos ?? '—'}</td>
        <td class="${kpiColor(h.eficiencia)}">${fmtPct(h.eficiencia)}</td>
        <td class="${kpiColor(h.capacidad)}">${fmtPct(h.capacidad)}</td>
        <td class="${kpiColor(h.calidad)}">${fmtPct(h.calidad)}</td>
        <td class="${kpiColor(h.disponibilidad)}">${fmtPct(h.disponibilidad)}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="pzs-no-data">Sin registros en este turno</td></tr>';

    return `
      <div class="pzs-turno-slide">
        <!-- KPI cards grandes -->
        <div class="pzs-kpi-grid">
          ${kpiCard('Eficiencia',     tot.eficiencia,     true)}
          ${kpiCard('Capacidad',      tot.capacidad,      true)}
          ${kpiCard('Calidad',        tot.calidad,        true)}
          ${kpiCard('Disponibilidad', tot.disponibilidad, true)}
        </div>
        <div class="pzs-ciclos-badge">
          Ciclos completados: <strong>${tot.ciclos ?? horas.reduce((s, h) => s + (h.ciclos || 0), 0)}</strong>
        </div>
        <!-- Tabla hora×hora -->
        <div class="pzs-hr-table-wrap">
          <table class="pzs-hr-table">
            <thead>
              <tr><th>Hora</th><th>Ciclos</th><th>Eficiencia</th><th>Capacidad</th><th>Calidad</th><th>Disponibilidad</th></tr>
            </thead>
            <tbody>${hrRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  /* ── Diapositiva turno — TODAS las líneas ─────────────────────────────── */
  function buildAllTurnoSlide(turno) {
    const lineas = ['L3', 'L4', 'Baker'];

    const blocks = lineas.map(l => {
      const tot   = state.data?.[l]?.totales?.[turno] || {};
      const horas = state.data?.[l]?.horas?.[turno]   || [];
      const ciclos = tot.ciclos ?? horas.reduce((s, h) => s + (h.ciclos || 0), 0);
      return `
        <div class="pzs-all-linea-block">
          <div class="pzs-all-linea-label">${escHtml(LINEA_LABELS[l] || l)}</div>
          <div class="pzs-kpi-grid pzs-kpi-grid-compact">
            ${kpiCard('Eficiencia',     tot.eficiencia)}
            ${kpiCard('Capacidad',      tot.capacidad)}
            ${kpiCard('Calidad',        tot.calidad)}
            ${kpiCard('Disponibilidad', tot.disponibilidad)}
          </div>
          <div class="pzs-ciclos-badge-sm">Ciclos: <strong>${ciclos}</strong></div>
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
          <div class="pzs-pareto-bar-bg">
            <div class="pzs-pareto-bar ${colorClass}" style="width:${pct}%"></div>
          </div>
          <span class="pzs-pareto-val">${valText}</span>
        </div>`;
    }).join('');
  }

  /* ── Diapositiva acumulado del día ────────────────────────────────────── */
  function buildDiaSlide(linea) {
    const ld  = state.data?.[linea];
    const dia = ld?.totales?.dia || {};

    const turnoRows = ['T1', 'T2', 'T3'].map(t => {
      const tot    = ld?.totales?.[t] || {};
      const horas  = ld?.horas?.[t]   || [];
      const ciclos = tot.ciclos ?? horas.reduce((s, h) => s + (h.ciclos || 0), 0);
      return `
        <div class="pzs-dia-row">
          <span class="pzs-dia-turno-lbl">${t}</span>
          <span class="pzs-dia-kpi-cell ${kpiColor(tot.eficiencia)}">${fmtPct(tot.eficiencia)}</span>
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
            <span>Eficiencia</span><span>Capacidad</span><span>Calidad</span><span>Disponibilidad</span>
            <span>Ciclos</span>
          </div>
          ${turnoRows}
        </div>

        <!-- Total del día (grande) -->
        <div class="pzs-dia-total-label">Total del Día</div>
        <div class="pzs-kpi-grid">
          ${kpiCard('Eficiencia',     dia.eficiencia,     true)}
          ${kpiCard('Capacidad',      dia.capacidad,      true)}
          ${kpiCard('Calidad',        dia.calidad,        true)}
          ${kpiCard('Disponibilidad', dia.disponibilidad, true)}
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
      const ciclosDia = ['T1', 'T2', 'T3'].reduce((s, t) => {
        const tot = ld?.totales?.[t] || {};
        return s + (tot.ciclos ?? (ld?.horas?.[t] || []).reduce((a, h) => a + (h.ciclos || 0), 0));
      }, 0);
      return `
        <div class="pzs-all-linea-block">
          <div class="pzs-all-linea-label">${escHtml(LINEA_LABELS[l] || l)}</div>
          <div class="pzs-kpi-grid pzs-kpi-grid-compact">
            ${kpiCard('Eficiencia',     dia.eficiencia)}
            ${kpiCard('Capacidad',      dia.capacidad)}
            ${kpiCard('Calidad',        dia.calidad)}
            ${kpiCard('Disponibilidad', dia.disponibilidad)}
          </div>
          <div class="pzs-ciclos-badge-sm">Ciclos día: <strong>${ciclosDia}</strong></div>
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
