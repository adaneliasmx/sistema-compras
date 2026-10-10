'use strict';

// Caché derivada del proceso: no persiste datos ni sustituye a db-produccion.
const { createHash } = require('node:crypto');
const ROOT = Symbol('productionMetricsRoot');
const LOADS = { cargas: null, cargas_baker: 'Baker', cargas_l1: 'L1' };
const STOPS = { paros: null, paros_baker: 'Baker', paros_l1: 'L1' };
const digest = value => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');

class ProductionMetricsCache {
  constructor({ maxEntries = 512, maxBytes = 32 * 1024 * 1024 } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.source = null;
    this.epoch = 0;
    this.revisions = new Map();
    this.observed = new Map();
    this.indexes = new Map();
    this.entries = new Map();
    this.bytes = 0;
    this.stats = { hits: 0, builds: 0, evictions: 0 };
  }

  root(data) { return data[ROOT] || data; }

  attach(data) {
    data = this.root(data);
    if (data !== this.source) {
      this.source = data;
      this.epoch++;
      this.revisions.clear();
      this.observed.clear();
      this.indexes.clear();
      this.entries.clear();
      this.bytes = 0;
      this.sync(data);
    }
    return data;
  }

  bump(key) { this.revisions.set(key, (this.revisions.get(key) || 0) + 1); }

  // La huella anterior es independiente del objeto mutable que devuelve read().
  // Así una corrección sin cambiar la longitud también invalida sus dos fechas.
  sync(data, changedKeys) {
    if (this.root(data) !== this.source) return this.attach(data);
    const keys = changedKeys?.length
      ? [...new Set(changedKeys)]
      : [...new Set([...Object.keys(data), ...this.observed.keys()])];
    let changed = false;
    for (const key of keys) {
      const value = data[key];
      if (Object.hasOwn(LOADS, key)) {
        const previous = this.observed.get(key) || [];
        const rows = Array.isArray(value) ? value : [];
        const next = [];
        const index = new Map();
        let collectionChanged = previous.length !== rows.length;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const line = LOADS[key] || row.linea || '';
          const dates = [...new Set([row.fecha_descarga, row.fecha_turno, row.fecha_carga, row.fecha].filter(Boolean))];
          const partitions = dates.map(date => key + ':' + line + ':' + date);
          const hash = digest(row);
          const old = previous[i];
          if (!old || old.hash !== hash) {
            collectionChanged = true;
            for (const dep of new Set([...(old?.partitions || []), ...partitions])) this.bump(dep);
          }
          next.push({ hash, partitions });
          for (const dep of partitions) {
            if (!index.has(dep)) index.set(dep, []);
            index.get(dep).push(i);
          }
        }
        for (let i = rows.length; i < previous.length; i++) {
          for (const dep of previous[i].partitions) this.bump(dep);
        }
        this.observed.set(key, next);
        this.indexes.set(key, index);
        if (collectionChanged) { this.bump(key); changed = true; }
      } else if (Object.hasOwn(STOPS, key)) {
        const rows = Array.isArray(value) ? value : [];
        const previous = this.observed.get(key) || [];
        const next = [];
        let collectionChanged = previous.length !== rows.length;
        const dateDependencies = new Set();
        for (const entry of this.entries.values()) {
          for (const dep of entry.dependencies) if (dep.startsWith(key + ":")) dateDependencies.add(dep);
        }
        const invalidate = stop => {
          if (!stop) return;
          const prefix = key + ":" + stop.line;
          if (!stop.start) return this.bump(prefix);
          for (const dep of dateDependencies) {
            if (!dep.startsWith(prefix + ":")) continue;
            const date = dep.slice(prefix.length + 1);
            if (date >= stop.start && (!stop.end || date <= stop.end)) this.bump(dep);
          }
        };
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const observed = { hash: digest(row), line: STOPS[key] || row.linea || "",
            start: row.fecha_inicio, end: row.fecha_fin };
          next.push(observed);
          if (previous[i]?.hash !== observed.hash) {
            collectionChanged = true;
            invalidate(previous[i]);
            invalidate(observed);
          }
        }
        for (let i = rows.length; i < previous.length; i++) invalidate(previous[i]);
        this.observed.set(key, next);
        if (collectionChanged) { this.bump(key); changed = true; }
      } else {
        const hash = digest(value);
        if (this.observed.get(key) !== hash) {
          this.observed.set(key, hash);
          this.bump(key);
          changed = true;
        }
        if (key === 'config') {
          const { slideshow, ...metrics } = value || {};
          const metricsHash = digest(metrics);
          if (this.metricsConfigHash !== metricsHash) {
            this.metricsConfigHash = metricsHash;
            this.bump('metrics-config');
          }
        }
      }
    }
    if (changed) this.bump('all');
  }

  dependencies(line, date, nextDate) {
    const suffix = line.toLowerCase();
    const loads = line === 'Baker' || line === 'L1' ? 'cargas_' + suffix : 'cargas';
    const stops = line === 'Baker' || line === 'L1' ? 'paros_' + suffix : 'paros';
    return [
      'metrics-config', 'turno_schedules', 'turno_l4_config',
      loads + ':' + line + ':' + date,
      loads + ':' + line + ':' + nextDate,
      stops + ':' + line,
      stops + ':' + line + ':' + date,
      stops + ':' + line + ':' + nextDate,
      'componentes_' + suffix, 'herramentales_' + suffix, 'motivos_paro_' + suffix
    ];
  }

  stopsFor(data, line, date, nextDate, today) {
    const key = line === 'Baker' || line === 'L1' ? 'paros_' + line.toLowerCase() : 'paros';
    return (this.root(data)[key] || []).filter(row => {
      if (key === 'paros' && row.linea !== line) return false;
      // Conservar registros incompletos/anómalos para no cambiar las fórmulas.
      if (!row.fecha_inicio || (!row.fecha_fin && !today)) return true;
      return row.fecha_inicio <= nextDate && (row.fecha_fin || today) >= date;
    });
  }

  // Vista sin copias del historial: cargas y paros que pueden afectar al turno.
  view(data, line, date, nextDate, today) {
    const root = this.attach(data);
    const view = Object.create(root);
    view[ROOT] = root;
    const key = line === 'Baker' || line === 'L1' ? 'cargas_' + line.toLowerCase() : 'cargas';
    const index = this.indexes.get(key);
    const positions = new Set();
    for (const day of new Set([date, nextDate])) {
      for (const i of index?.get(key + ':' + line + ':' + day) || []) positions.add(i);
    }
    view[key] = [...positions].sort((a, b) => a - b).map(i => root[key][i]);
    const stops = line === 'Baker' || line === 'L1' ? 'paros_' + line.toLowerCase() : 'paros';
    view[stops] = this.stopsFor(root, line, date, nextDate, today);
    return view;
  }

  signature(dependencies, clock) {
    return JSON.stringify([this.epoch, clock, dependencies.map(key => [key, this.revisions.get(key) || 0])]);
  }

  peek(key, dependencies, clock) {
    const entry = this.entries.get(key);
    if (!entry || entry.signature !== this.signature(dependencies, clock)) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.stats.hits++;
    return entry;
  }

  put(key, dependencies, clock, value) {
    const json = JSON.stringify(value);
    if (json === undefined) return null;
    const size = json.length * 2;
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.size; this.entries.delete(key); }
    const entry = {
      json, size, dependencies: [...dependencies], signature: this.signature(dependencies, clock),
      etag: '"' + createHash('sha256').update(json).digest('hex') + '"'
    };
    if (size > this.maxBytes) return entry;
    while (this.entries.size >= this.maxEntries || this.bytes + size > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      this.bytes -= this.entries.get(oldest).size;
      this.entries.delete(oldest);
      this.stats.evictions++;
    }
    this.entries.set(key, entry);
    this.bytes += size;
    return entry;
  }

  get(key, dependencies, clock, build) {
    let entry = this.peek(key, dependencies, clock);
    if (!entry) {
      const value = build();
      entry = this.put(key, dependencies, clock, value);
      this.stats.builds++;
    }
    // Los callers anotan/mutan slots: nunca entregar el objeto de la caché.
    return entry ? JSON.parse(entry.json) : undefined;
  }
}

module.exports = { ProductionMetricsCache, shared: new ProductionMetricsCache() };
