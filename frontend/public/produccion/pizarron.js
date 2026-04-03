// Pizarron de Produccion - standalone, no auth required
(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let state = {
    data: null,
    loading: false,
    error: null,
    fecha: todayStr(),
    turnoFilter: 'all',
    lastRefresh: null
  };

  let refreshTimer = null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function todayStr() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function nowStr() {
    return new Date().toLocaleString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function currentTurno() {
    const h = new Date().getHours();
    if (h >= 6 && h < 14) return 'T1';
    if (h >= 14 && h < 22) return 'T2';
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

  // ── Fetch ─────────────────────────────────────────────────────────────────
  async function fetchData() {
    state.loading = true;
    render();
    try {
      const url = `/api/produccion/pizarron?linea=ambas&fecha=${state.fecha}&turno=all`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Error ' + res.status + ': ' + res.statusText);
      const raw = await res.json();

      // El backend devuelve { fecha, linea, turno, data: { L3: { T1: { slots, totals }, ... }, L4: {...} } }
      // Transformar al formato que espera buildLineaBoard: { horas: { T1: [...], T2, T3 }, totales: { T1: {...}, dia: {...} } }
      const backendData = raw?.data || {};
      const transformed = {};

      for (const [l, lineaData] of Object.entries(backendData)) {
        const horas   = {};
        const totales = {};

        for (const t of ['T1', 'T2', 'T3']) {
          const td    = lineaData[t] || {};
          const slots = td.slots || [];

          horas[t] = slots.map(s => ({
            hora:           `${s.hora_inicio}–${s.hora_fin}`,
            ciclos:         s.ciclos_totales,
            eficiencia:     (s.eficiencia    || 0) * 100,
            capacidad:      (s.capacidad      || 0) * 100,
            calidad:        (s.calidad        || 0) * 100,
            disponibilidad: (s.disponibilidad || 0) * 100
          }));

          const avg = key => slots.length
            ? slots.reduce((a, s) => a + (s[key] || 0), 0) / slots.length * 100
            : null;

          totales[t] = {
            eficiencia:     avg('eficiencia'),
            capacidad:      avg('capacidad'),
            calidad:        avg('calidad'),
            disponibilidad: avg('disponibilidad')
          };
        }

        // Total del día: promedio de todos los slots de todos los turnos
        const allSlots = ['T1','T2','T3'].flatMap(t => (lineaData[t]?.slots || []));
        const avgDay   = key => allSlots.length
          ? allSlots.reduce((a, s) => a + (s[key] || 0), 0) / allSlots.length * 100
          : null;

        totales.dia = {
          eficiencia:     avgDay('eficiencia'),
          capacidad:      avgDay('capacidad'),
          calidad:        avgDay('calidad'),
          disponibilidad: avgDay('disponibilidad')
        };

        transformed[l] = { horas, totales };
      }

      state.data = transformed;
      state.error = null;
      state.lastRefresh = new Date();
    } catch (err) {
      state.error = err.message;
      state.data = null;
    }
    state.loading = false;
    render();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    const app = document.getElementById('pizarron-app');
    if (!app) return;
    app.innerHTML = buildHtml();
    bindEvents();
  }

  function buildHtml() {
    const turno = currentTurno();
    return `
      <div class="pizarron-root">
        ${buildHeader(turno)}
        ${buildControls()}
        ${state.loading ? '<div class="pizarron-loading">Cargando datos...</div>' : ''}
        ${state.error ? `<div class="pizarron-error">Error al cargar datos: ${escHtml(state.error)}</div>` : ''}
        ${!state.loading && !state.error && state.data ? buildBoards(turno) : ''}
        ${!state.loading && !state.error && !state.data ? '<div class="pizarron-empty">Sin datos disponibles para esta fecha.</div>' : ''}
      </div>
    `;
  }

  function buildHeader(turno) {
    const refreshTime = state.lastRefresh
      ? state.lastRefresh.toLocaleTimeString('es-MX')
      : '—';
    return `
      <div class="pizarron-header">
        <div class="pizarron-title-block">
          <div class="pizarron-title">🏭 Pizarrón de Producción</div>
          <div class="pizarron-subtitle">Líneas 3 y 4 · KPIs en tiempo real</div>
        </div>
        <div class="pizarron-header-right">
          <div class="pizarron-datetime" id="pizarron-clock">${nowStr()}</div>
          <div class="pizarron-turno-badge">Turno actual: <strong>${turno}</strong></div>
          <div class="pizarron-refresh-info">Última actualización: ${refreshTime} · Auto-refresh 30s</div>
        </div>
      </div>
    `;
  }

  function buildControls() {
    const turnos = ['all', 'T1', 'T2', 'T3'];
    const labels = { all: 'Todos', T1: 'T1', T2: 'T2', T3: 'T3' };
    const btnHtml = turnos.map(t => {
      const active = state.turnoFilter === t ? ' active' : '';
      return `<button class="pizarron-btn-turno${active}" data-turno="${t}">${labels[t]}</button>`;
    }).join('');

    return `
      <div class="pizarron-controls">
        <div class="pizarron-control-group">
          <label class="pizarron-label">Turno:</label>
          <div class="pizarron-turno-btns">${btnHtml}</div>
        </div>
        <div class="pizarron-control-group">
          <label class="pizarron-label" for="pizarron-fecha">Fecha:</label>
          <input type="date" id="pizarron-fecha" class="pizarron-date-input" value="${state.fecha}"/>
        </div>
        <button class="pizarron-btn-refresh" id="btn-refresh-now">↻ Actualizar</button>
      </div>
    `;
  }

  function buildBoards(turno) {
    const lineas = ['L3', 'L4'];
    const labels = { L3: 'Línea 3', L4: 'Línea 4' };
    return lineas.map(linea => {
      const linData = (state.data || {})[linea] || {};
      return buildLineaBoard(linea, labels[linea], linData, turno);
    }).join('');
  }

  function buildLineaBoard(linea, label, linData, currentTurnoStr) {
    const turnos = ['T1', 'T2', 'T3'];
    const visibleTurnos = state.turnoFilter === 'all' ? turnos : [state.turnoFilter];
    const horas   = linData.horas   || {};
    const totales = linData.totales || {};

    let rows = '';

    for (const t of visibleTurnos) {
      const horasT = (horas[t] || []);
      const isCurrentTurno = t === currentTurnoStr && state.fecha === todayStr();

      // Turno header row
      const turnoHighlight = isCurrentTurno ? ' turno-actual' : '';
      rows += `<tr class="turno-header-row${turnoHighlight}">
        <td colspan="6"><strong>${t}${isCurrentTurno ? ' ← Turno actual' : ''}</strong></td>
      </tr>`;

      if (horasT.length === 0) {
        rows += `<tr class="no-data-row"><td colspan="6">Sin registros</td></tr>`;
      } else {
        for (const hr of horasT) {
          rows += buildKpiRow(hr.hora || hr.label, hr);
        }
      }

      // Turno subtotal
      const subT = totales[t] || {};
      rows += `<tr class="subtotal-row">
        <td colspan="2"><em>Subtotal ${t}</em></td>
        <td class="${kpiColor(subT.eficiencia)}">${fmtPct(subT.eficiencia)}</td>
        <td class="${kpiColor(subT.capacidad)}">${fmtPct(subT.capacidad)}</td>
        <td class="${kpiColor(subT.calidad)}">${fmtPct(subT.calidad)}</td>
        <td class="${kpiColor(subT.disponibilidad)}">${fmtPct(subT.disponibilidad)}</td>
      </tr>`;
    }

    // Day total (only when showing all or single)
    const dayTotal = totales.dia || totales.day || {};
    const hasDayTotal = Object.keys(dayTotal).length > 0;
    const dayTotalRow = hasDayTotal ? `
      <tr class="day-total-row">
        <td colspan="2"><strong>Total día</strong></td>
        <td class="${kpiColor(dayTotal.eficiencia)}"><strong>${fmtPct(dayTotal.eficiencia)}</strong></td>
        <td class="${kpiColor(dayTotal.capacidad)}"><strong>${fmtPct(dayTotal.capacidad)}</strong></td>
        <td class="${kpiColor(dayTotal.calidad)}"><strong>${fmtPct(dayTotal.calidad)}</strong></td>
        <td class="${kpiColor(dayTotal.disponibilidad)}"><strong>${fmtPct(dayTotal.disponibilidad)}</strong></td>
      </tr>` : '';

    return `
      <div class="pizarron-linea-board">
        <div class="pizarron-linea-title">${label}</div>
        <div class="pizarron-table-wrap">
          <table class="pizarron-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Ciclos</th>
                <th>Eficiencia</th>
                <th>Capacidad</th>
                <th>Calidad</th>
                <th>Disponibilidad</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="5">Sin datos</td></tr>'}
              ${dayTotalRow}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function buildKpiRow(label, kpi) {
    return `<tr class="kpi-row">
      <td class="hr-cell">${escHtml(String(label))}</td>
      <td style="text-align:center;font-weight:700">${kpi.ciclos != null ? kpi.ciclos : '—'}</td>
      <td class="${kpiColor(kpi.eficiencia)}">${fmtPct(kpi.eficiencia)}</td>
      <td class="${kpiColor(kpi.capacidad)}">${fmtPct(kpi.capacidad)}</td>
      <td class="${kpiColor(kpi.calidad)}">${fmtPct(kpi.calidad)}</td>
      <td class="${kpiColor(kpi.disponibilidad)}">${fmtPct(kpi.disponibilidad)}</td>
    </tr>`;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function bindEvents() {
    // Turno filter buttons
    document.querySelectorAll('.pizarron-btn-turno').forEach(btn => {
      btn.addEventListener('click', () => {
        state.turnoFilter = btn.dataset.turno;
        render();
      });
    });

    // Date picker
    const dateInput = document.getElementById('pizarron-fecha');
    if (dateInput) {
      dateInput.addEventListener('change', () => {
        state.fecha = dateInput.value;
        fetchData();
      });
    }

    // Manual refresh
    const btnRefresh = document.getElementById('btn-refresh-now');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', fetchData);
    }
  }

  // ── Clock tick ────────────────────────────────────────────────────────────
  function startClock() {
    setInterval(() => {
      const el = document.getElementById('pizarron-clock');
      if (el) el.textContent = nowStr();
    }, 1000);
  }

  // ── Auto-refresh ──────────────────────────────────────────────────────────
  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(fetchData, 30000);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    fetchData();
    startClock();
    startAutoRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
