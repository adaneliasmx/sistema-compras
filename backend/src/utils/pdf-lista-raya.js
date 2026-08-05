/**
 * Extractor de Lista de Raya CONTPAQ i — port JS del extractor_lista_raya.py
 * Usa pdfjs-dist para coordenadas X/Y (split columna perc/ded por mitad de página).
 *
 * Retorna: { header, employees, perc_cols, ded_cols }
 */

// pdfjs-dist está en node_modules raíz del monorepo
const pdfjsLib = (() => {
  try {
    return require('pdfjs-dist/legacy/build/pdf.js');
  } catch (_) {
    return require('pdfjs-dist');
  }
})();

// Deshabilitar worker en Node.js (false = no worker, no URL)
if (pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = false;
}
// Silenciar logs de pdfjs
try { pdfjsLib.verbosity = 0; } catch (_) {}

// ── Conceptos informativos (no cuentan en totales) ──
const PERC_INFO = new Set(['32', '133']);
const DED_INFO  = new Set(['32', '41', '104', '105', '181']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function parseConcept(text) {
  text = text.trim();
  if (!text) return null;
  const m = text.match(/^(\d+)\s+(.+)$/);
  if (!m) return null;
  const code = m[1];
  const rest = m[2];
  const nums = rest.match(/-?[\d,]+\.\d+/g);
  if (!nums) return null;
  const importe = cleanNum(nums[nums.length - 1]);
  if (importe === null) return null;
  let desc;
  if (nums.length >= 2) {
    const lastPos = rest.lastIndexOf(nums[nums.length - 1]);
    const secondLastPos = rest.lastIndexOf(nums[nums.length - 2], lastPos - 1);
    desc = secondLastPos >= 0 ? rest.slice(0, secondLastPos).trim() : rest.slice(0, lastPos).trim();
  } else {
    desc = rest.slice(0, rest.lastIndexOf(nums[0])).trim();
  }
  desc = desc.replace(/\.$/, '').trim();
  return [`${code} ${desc}`, importe];
}

function isPageHeader(text) {
  return (
    /^C{1,4}O{1,4}N{1,4}T{1,4}P{1,4}A{1,4}Q{1,4}/.test(text) ||
    /^N{1,4}[ÚU]{1,4}M{1,4}I{1,4}N{1,4}A{1,4}S{1,4}/.test(text) ||
    /RFC:.*Hoja:/.test(text) ||
    /Lista de Raya del/.test(text) ||
    /Per[íi]odo Semanal/.test(text) ||
    /Calle\s+28/.test(text) ||
    /^Reg\.?\s*Pat\.?\s*IMSS:\s*R/.test(text) ||
    /Percepci[oó]n\s+Valor\s+Importe/.test(text)
  );
}

function isSeparator(text) {
  return /^[-\.]{5,}\s*$/.test(text.trim()) || text.trim() === '';
}

function isDeptHeader(text) {
  return /^\d+\s+\w.*Reg\s*Pat\s*IMSS/.test(text);
}

function isEmployeeName(text) {
  const m = text.match(/^(\d{3})\s+(.+)$/);
  if (!m) return false;
  return /^[A-ZÁÉÍÓÚÜÑ]+(?:\s+[A-ZÁÉÍÓÚÜÑ]+){1,}$/.test(m[2]);
}

function isTotalLine(text) {
  return text.includes('Total Percepciones') && text.includes('Total Deducciones');
}

function isNeto(text) {
  return text.trim().startsWith('Neto a pagar');
}

function isDeptTotal(text) {
  return /Total\s+Departamento/.test(text);
}

function isTotalGeneral(text) {
  return /Total\s+General/.test(text);
}

function isNotesLine(text) {
  return /^(Vacaciones|Ausencias|Incapacidades)\s+\d/i.test(text);
}

// ── Extracción de filas con coordenadas ──────────────────────────────────────

async function getRowsFromPage(page) {
  const viewport = page.getViewport({ scale: 1.0 });
  const pageWidth = viewport.width;
  const midX = pageWidth / 2;

  const content = await page.getTextContent();
  const items = content.items;

  // Agrupar por Y redondeado a 3 puntos (igual que Python: round(top/3)*3)
  const rowMap = new Map();
  for (const item of items) {
    const tx = item.transform;
    if (!tx) continue;
    const x = tx[4];
    // En PDF.js el eje Y está invertido respecto a pdfplumber.
    // tx[5] es la coordenada Y desde abajo; usamos (height - y) para "top"
    const y = viewport.height - tx[5];
    const yKey = Math.round(y / 3) * 3;
    if (!rowMap.has(yKey)) rowMap.set(yKey, []);
    rowMap.get(yKey).push({ x, text: item.str });
  }

  const result = [];
  const sortedY = Array.from(rowMap.keys()).sort((a, b) => a - b);
  for (const yKey of sortedY) {
    const rowItems = rowMap.get(yKey).sort((a, b) => a.x - b.x);
    const leftWords  = rowItems.filter(w => w.x < midX).map(w => w.text);
    const rightWords = rowItems.filter(w => w.x >= midX).map(w => w.text);
    const fullWords  = rowItems.map(w => w.text);
    result.push({
      left:  leftWords.join(' ').trim(),
      right: rightWords.join(' ').trim(),
      full:  fullWords.join(' ').trim(),
      y: yKey,
    });
  }
  return result;
}

// ── Parser principal ──────────────────────────────────────────────────────────

async function extractListaRaya(buffer) {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), verbosity: 0 });
  const pdf = await loadingTask.promise;

  const header = { fecha_inicio: '', fecha_fin: '', no_periodo: '' };

  // Encabezado del período desde primera página (texto plano)
  const firstPage = await pdf.getPage(1);
  const firstContent = await firstPage.getTextContent();
  const firstText = firstContent.items.map(i => i.str).join(' ');
  const mFechas = firstText.match(/Lista de Raya del\s+(\S+)\s+al\s+(\S+)/);
  if (mFechas) { header.fecha_inicio = mFechas[1]; header.fecha_fin = mFechas[2]; }
  const mPeriodo = firstText.match(/Per[íi]odo Semanal No\.\s*(\d+)/);
  if (mPeriodo) header.no_periodo = mPeriodo[1];

  // Acumular todas las filas de todas las páginas
  const allRows = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const rows = await getRowsFromPage(page);
    for (const row of rows) {
      if (!row.full || isPageHeader(row.full) || isSeparator(row.full)) continue;
      allRows.push(row);
    }
  }

  // ── Máquina de estados ──
  const S_INIT      = 'init';
  const S_EMP_L2    = 'emp_l2';
  const S_EMP_L3    = 'emp_l3';
  const S_EMP_L4    = 'emp_l4';
  const S_CONCEPTS  = 'concepts';
  const S_SKIP_DEPT = 'skip_dept';

  let state = S_INIT;
  let currentDeptId = '';
  let currentDeptNm = '';
  let currentEmp = null;
  const employees = [];
  const percCols = new Map(); // preserva orden de aparición
  const dedCols  = new Map();

  function newEmp() {
    return {
      no: '', nombre: '', dept_id: currentDeptId, dept_nm: currentDeptNm,
      puesto: '', rfc: '', curp: '', afil_imss: '', fecha_ingr: '',
      sal_diario: null, sdi: null, sbc: null, sal_var: null,
      dias_pag: null, hrs_trab: null, hrs_extra: null,
      notas: '', percepciones: {}, deducciones: {},
      total_perc_pdf: null, total_ded_pdf: null, neto_pdf: null,
    };
  }

  function saveEmp(emp) {
    if (emp && emp.no) employees.push(emp);
  }

  for (let i = 0; i < allRows.length; i++) {
    const { full, left, right } = allRows[i];

    // Encabezado de departamento
    if (isDeptHeader(full)) {
      saveEmp(currentEmp);
      currentEmp = null;
      const m = full.match(/^(\d+)\s+(.+?)\s+Reg\s*Pat/);
      if (m) { currentDeptId = m[1].trim(); currentDeptNm = m[2].trim(); }
      state = S_EMP_L2;
      continue;
    }

    if (isDeptTotal(full) || isTotalGeneral(full)) {
      saveEmp(currentEmp);
      currentEmp = null;
      state = S_SKIP_DEPT;
      continue;
    }

    if (state === S_SKIP_DEPT || state === S_INIT) continue;

    // Nombre de empleado nuevo (válido en emp_l2 o concepts)
    if (isEmployeeName(full) && (state === S_EMP_L2 || state === S_CONCEPTS)) {
      saveEmp(currentEmp);
      currentEmp = newEmp();
      const m = full.match(/^(\d{3})\s+(.+)$/);
      if (m) { currentEmp.no = m[1]; currentEmp.nombre = m[2].trim(); }
      state = S_EMP_L2;
      continue;
    }

    if (state === S_EMP_L2) {
      if (isEmployeeName(full)) {
        saveEmp(currentEmp);
        currentEmp = newEmp();
        const m = full.match(/^(\d{3})\s+(.+)$/);
        if (m) { currentEmp.no = m[1]; currentEmp.nombre = m[2].trim(); }
      } else if (currentEmp) {
        const mRfc  = full.match(/RFC:\s*(\S+)/);
        const mImss = full.match(/Afiliaci[oó]n IMSS:\s*(\S+)/);
        const mPues = full.match(/^(.+?)\s+RFC:/);
        if (mPues) currentEmp.puesto    = mPues[1].trim();
        if (mRfc)  currentEmp.rfc       = mRfc[1];
        if (mImss) currentEmp.afil_imss = mImss[1];
        state = S_EMP_L3;
      }
      continue;
    }

    if (state === S_EMP_L3) {
      if (currentEmp) {
        const mFi  = full.match(/Fecha\s+(?:Ingr|Reing):\s*(\S+)/);
        const mSd  = full.match(/Sal\.\s*diario:\s*([\d,.]+)/);
        const mSdi = full.match(/S\.D\.I:\s*([\d,.]+)/);
        const mSbc = full.match(/S\.B\.C:\s*([\d,.]+)/);
        const mSv  = full.match(/Sal\.\s*Var:\s*([\d,.]+)/);
        if (mFi)  currentEmp.fecha_ingr = mFi[1];
        if (mSd)  currentEmp.sal_diario = cleanNum(mSd[1]);
        if (mSdi) currentEmp.sdi        = cleanNum(mSdi[1]);
        if (mSbc) currentEmp.sbc        = cleanNum(mSbc[1]);
        if (mSv)  currentEmp.sal_var    = cleanNum(mSv[1]);
      }
      state = S_EMP_L4;
      continue;
    }

    if (state === S_EMP_L4) {
      if (currentEmp) {
        const mDp   = full.match(/D[íi]as\s+pagados:\s*([\d.]+)/);
        const mHt   = full.match(/Tot\s+Hrs\s+trab:\s*([\d.]+)/);
        const mHe   = full.match(/Hrs\s+extras:\s*([\d.]+)/);
        const mCurp = full.match(/CURP:\s*(\S+)/);
        if (mDp)   currentEmp.dias_pag  = cleanNum(mDp[1]);
        if (mHt)   currentEmp.hrs_trab  = cleanNum(mHt[1]);
        if (mHe)   currentEmp.hrs_extra = cleanNum(mHe[1]);
        if (mCurp) currentEmp.curp      = mCurp[1];
      }
      state = S_CONCEPTS;
      continue;
    }

    if (state === S_CONCEPTS) {
      if (isNotesLine(full)) {
        if (currentEmp) currentEmp.notas = (currentEmp.notas + ' ' + full).trim();
        continue;
      }
      if (isTotalLine(full)) {
        if (currentEmp) {
          const mTp = full.match(/Total\s+Percepciones\s+([\d,]+\.\d+)/);
          const mTd = full.match(/Total\s+Deducciones\s+([\d,]+\.\d+)/);
          if (mTp) currentEmp.total_perc_pdf = cleanNum(mTp[1]);
          if (mTd) currentEmp.total_ded_pdf  = cleanNum(mTd[1]);
        }
        continue;
      }
      if (isNeto(full)) {
        if (currentEmp) {
          const mN = full.match(/Neto a pagar\s+([\d,]+\.\d+)/);
          if (mN) currentEmp.neto_pdf = cleanNum(mN[1]);
        }
        continue;
      }
      // Parsear conceptos de ambas columnas
      if (currentEmp) {
        if (left) {
          const res = parseConcept(left);
          if (res) {
            const [col, imp] = res;
            currentEmp.percepciones[col] = imp;
            if (!percCols.has(col)) percCols.set(col, true);
          }
        }
        if (right) {
          const res = parseConcept(right);
          if (res) {
            const [col, imp] = res;
            currentEmp.deducciones[col] = imp;
            if (!dedCols.has(col)) dedCols.set(col, true);
          }
        }
      }
    }
  }

  saveEmp(currentEmp);

  return {
    header,
    employees,
    perc_cols: Array.from(percCols.keys()),
    ded_cols:  Array.from(dedCols.keys()),
  };
}

module.exports = { extractListaRaya, PERC_INFO, DED_INFO, cleanNum };
