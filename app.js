// ─────────────────────────────────────────────────────────────────────────────
// PDF.js worker (CDN, set on DOMContentLoaded)
// ─────────────────────────────────────────────────────────────────────────────
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ─────────────────────────────────────────────────────────────────────────────
// Marker dictionary: canonical name → aliases (sorted longest-first at startup)
// ─────────────────────────────────────────────────────────────────────────────
const MARKERS = {
  // CBC
  'Hemoglobin':             ['HEMOGLOBIN', 'HAEMOGLOBIN', 'HGB', 'HB'],
  'Hematocrit':             ['HEMATOCRIT (PCV)', 'HEMATOCRIT', 'HAEMATOCRIT', 'PACKED CELL VOLUME', 'PCV'],
  'RBC Count':              ['TOTAL RBC', 'RBC COUNT', 'RED BLOOD CELL COUNT', 'RBC'],
  'MCV':                    ['MEAN CORPUSCULAR VOLUME (MCV)', 'MEAN CORPUSCULAR VOLUME', 'MCV'],
  'MCH':                    ['MEAN CORPUSCULAR HEMOGLOBIN (MCH)', 'MEAN CORPUSCULAR HAEMOGLOBIN (MCH)', 'MEAN CORPUSCULAR HEMOGLOBIN', 'MEAN CORPUSCULAR HAEMOGLOBIN', 'MCH'],
  'MCHC':                   ['MEAN CORP.HEMO. CONC (MCHC)', 'MEAN CORPUSCULAR HEMOGLOBIN CONCENTRATION', 'MEAN CORPUSCULAR HAEMOGLOBIN CONCENTRATION', 'MCHC'],
  'RDW-CV':                 ['RED CELL DISTRIBUTION WIDTH (RDW - CV)', 'RED CELL DISTRIBUTION WIDTH - CV', 'RDW-CV', 'RDW CV'],
  'RDW-SD':                 ['RED CELL DISTRIBUTION WIDTH - SD (RDW-SD)', 'RED CELL DISTRIBUTION WIDTH - SD', 'RDW-SD', 'RDW SD'],
  'WBC':                    ['TOTAL LEUCOCYTE COUNT (WBC)', 'TOTAL LEUCOCYTE COUNT', 'TOTAL LEUKOCYTE COUNT', 'WHITE BLOOD CELL COUNT', 'TLC', 'WBC'],
  'Neutrophils %':          ['NEUTROPHILS PERCENTAGE', 'NEUTROPHILS %', 'NEUTROPHIL PERCENTAGE', 'NEUTROPHILS'],
  'Neutrophils Absolute':   ['NEUTROPHILS - ABSOLUTE COUNT', 'NEUTROPHILS ABSOLUTE COUNT', 'NEUTROPHIL ABSOLUTE', 'ANC'],
  'Lymphocytes %':          ['LYMPHOCYTES PERCENTAGE', 'LYMPHOCYTES %', 'LYMPHOCYTE PERCENTAGE', 'LYMPHOCYTES'],
  'Lymphocytes Absolute':   ['LYMPHOCYTES - ABSOLUTE COUNT', 'LYMPHOCYTES ABSOLUTE COUNT', 'LYMPHOCYTE ABSOLUTE'],
  'Monocytes %':            ['MONOCYTES PERCENTAGE', 'MONOCYTES %', 'MONOCYTE PERCENTAGE', 'MONOCYTES'],
  'Monocytes Absolute':     ['MONOCYTES - ABSOLUTE COUNT', 'MONOCYTES ABSOLUTE COUNT', 'MONOCYTE ABSOLUTE'],
  'Eosinophils %':          ['EOSINOPHILS PERCENTAGE', 'EOSINOPHILS %', 'EOSINOPHIL PERCENTAGE', 'EOSINOPHILS'],
  'Eosinophils Absolute':   ['EOSINOPHILS - ABSOLUTE COUNT', 'EOSINOPHILS ABSOLUTE COUNT', 'EOSINOPHIL ABSOLUTE'],
  'Basophils %':            ['BASOPHILS PERCENTAGE', 'BASOPHILS %', 'BASOPHIL PERCENTAGE', 'BASOPHILS'],
  'Basophils Absolute':     ['BASOPHILS - ABSOLUTE COUNT', 'BASOPHILS ABSOLUTE COUNT', 'BASOPHIL ABSOLUTE'],
  'Platelet Count':         ['PLATELET COUNT', 'PLATELETS', 'PLT'],
  'MPV':                    ['MEAN PLATELET VOLUME (MPV)', 'MEAN PLATELET VOLUME', 'MPV'],
  'PDW':                    ['PLATELET DISTRIBUTION WIDTH (PDW)', 'PLATELET DISTRIBUTION WIDTH', 'PDW'],
  'PCT':                    ['PLATELETCRIT (PCT)', 'PLATELETCRIT', 'PCT'],
  'PLCR':                   ['PLATELET TO LARGE CELL RATIO (PLCR)', 'PLATELET TO LARGE CELL RATIO', 'PLCR'],

  // Lipid
  'Total Cholesterol':      ['TOTAL CHOLESTEROL', 'CHOLESTEROL TOTAL', 'CHOLESTEROL'],
  'HDL Cholesterol':        ['HDL CHOLESTEROL - DIRECT', 'HDL CHOLESTEROL', 'HIGH DENSITY LIPOPROTEIN', 'HDL'],
  'LDL Cholesterol':        ['LDL CHOLESTEROL - DIRECT', 'LDL CHOLESTEROL', 'LOW DENSITY LIPOPROTEIN', 'LDL'],
  'VLDL Cholesterol':       ['VLDL CHOLESTEROL', 'VERY LOW DENSITY LIPOPROTEIN', 'VLDL'],
  'Triglycerides':          ['TRIGLYCERIDES', 'TRIGLYCERIDE', 'TG'],
  'TC/HDL Ratio':           ['TC/ HDL CHOLESTEROL RATIO', 'TC/HDL CHOLESTEROL RATIO', 'TC/HDL RATIO', 'TC/HDL'],
  'LDL/HDL Ratio':          ['LDL / HDL RATIO', 'LDL/HDL RATIO', 'LDL/HDL'],
  'HDL/LDL Ratio':          ['HDL / LDL RATIO', 'HDL/LDL RATIO', 'HDL/LDL'],
  'TG/HDL Ratio':           ['TRIG / HDL RATIO', 'TG/HDL RATIO', 'TG/HDL'],
  'Non-HDL Cholesterol':    ['NON-HDL CHOLESTEROL', 'NON HDL CHOLESTEROL', 'NON-HDL'],

  // LFT
  'SGOT':                   ['ASPARTATE AMINOTRANSFERASE (SGOT)', 'ASPARTATE AMINOTRANSFERASE(AST/SGOT)', 'ASPARTATE AMINOTRANSFERASE', 'AST/SGOT', 'SGOT', 'AST'],
  'SGPT':                   ['ALANINE TRANSAMINASE (SGPT)', 'ALANINE AMINOTRANSFERASE (ALT/SGPT)', 'ALANINE TRANSAMINASE', 'ALANINE AMINOTRANSFERASE', 'ALT/SGPT', 'SGPT', 'ALT'],
  'SGOT/SGPT Ratio':        ['SGOT / SGPT RATIO', 'SGOT/SGPT RATIO', 'AST/ALT RATIO', 'AST/ALT'],
  'Alkaline Phosphatase':   ['ALKALINE PHOSPHATASE', 'ALP'],
  'GGT':                    ['GAMMA GLUTAMYL TRANSFERASE (GGT)', 'GAMMA GLUTAMYL TRANSFERASE', 'GAMMA GT', 'GGT'],
  'Bilirubin Total':        ['BILIRUBIN - TOTAL', 'BILIRUBIN TOTAL', 'TOTAL BILIRUBIN', 'BILIRUBIN'],
  'Bilirubin Direct':       ['BILIRUBIN -DIRECT', 'BILIRUBIN DIRECT', 'DIRECT BILIRUBIN'],
  'Bilirubin Indirect':     ['BILIRUBIN (INDIRECT)', 'BILIRUBIN INDIRECT', 'INDIRECT BILIRUBIN'],
  'Total Protein':          ['PROTEIN - TOTAL', 'TOTAL PROTEIN', 'PROTEIN'],
  'Albumin':                ['ALBUMIN - SERUM', 'SERUM ALBUMIN', 'ALBUMIN'],
  'Globulin':               ['SERUM GLOBULIN', 'GLOBULIN'],
  'A/G Ratio':              ['SERUM ALB/GLOBULIN RATIO', 'ALBUMIN GLOBULIN RATIO', 'A/G RATIO'],

  // KFT
  'Creatinine':             ['CREATININE - SERUM', 'SERUM CREATININE', 'CREATININE'],
  'BUN':                    ['BLOOD UREA NITROGEN (BUN)', 'BLOOD UREA NITROGEN', 'BUN'],
  'Urea':                   ['UREA (CALCULATED)', 'UREA'],
  'Uric Acid':              ['URIC ACID'],
  'Calcium':                ['CALCIUM'],
  'eGFR':                   ['EST. GLOMERULAR FILTRATION RATE (EGFR)', 'EST. GLOMERULAR FILTRATION RATE', 'ESTIMATED GLOMERULAR FILTRATION RATE', 'EGFR'],
  'BUN/Creatinine Ratio':   ['BUN / SR.CREATININE RATIO', 'BUN/SR.CREATININE RATIO', 'BUN/CREATININE RATIO'],
  'Urea/Creatinine Ratio':  ['UREA / SR.CREATININE RATIO', 'UREA/CREATININE RATIO'],

  // Thyroid
  'TSH':                    ['TSH - ULTRASENSITIVE', 'TSH ULTRASENSITIVE', 'THYROID STIMULATING HORMONE', 'TSH'],
  'T3 Total':               ['T3 - TOTAL', 'T3 TOTAL', 'TOTAL T3', 'TRIIODOTHYRONINE', 'T3'],
  'T4 Total':               ['T4 - TOTAL', 'T4 TOTAL', 'TOTAL T4', 'THYROXINE', 'T4'],
  'Free T3':                ['FREE TRIIODOTHYRONINE', 'FREE T3', 'FT3'],
  'Free T4':                ['FREE THYROXINE', 'FREE T4', 'FT4'],

  // Vitamins
  'Vitamin D':              ['25-OH VITAMIN D (TOTAL)', '25-OH VITAMIN D', 'VITAMIN D TOTAL', '25 HYDROXY VITAMIN D', '25-HYDROXYVITAMIN D', 'VITAMIN D', '25(OH)D'],
  'Vitamin B12':            ['VITAMIN B-12', 'VITAMIN B12', 'CYANOCOBALAMIN', 'B12'],

  // Blood Sugar
  'Fasting Glucose':        ['FASTING BLOOD SUGAR(GLUCOSE)', 'FASTING BLOOD SUGAR', 'FASTING BLOOD GLUCOSE', 'FASTING GLUCOSE', 'FBS', 'FBG'],
  'HbA1c':                  ['GLYCATED HEMOGLOBIN', 'GLYCOSYLATED HEMOGLOBIN', 'HEMOGLOBIN A1C', 'HBA1C', 'HB A1C'],
  'Average Blood Glucose':  ['AVERAGE BLOOD GLUCOSE (ABG)', 'AVERAGE BLOOD GLUCOSE', 'MEAN BLOOD GLUCOSE', 'ABG'],

  // Iron Studies
  'Serum Iron':             ['IRON', 'SERUM IRON'],
  'TIBC':                   ['TOTAL IRON BINDING CAPACITY (TIBC)', 'TOTAL IRON BINDING CAPACITY', 'TIBC'],
  'UIBC':                   ['UNSAT.IRON-BINDING CAPACITY(UIBC)', 'UNSAT.IRON-BINDING CAPACITY', 'UNSATURATED IRON BINDING CAPACITY', 'UIBC'],
  'Transferrin Saturation': ['% TRANSFERRIN SATURATION', 'TRANSFERRIN SATURATION', '% SATURATION'],
  'Ferritin':               ['SERUM FERRITIN', 'FERRITIN'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Hardcoded reference ranges (fallback when PDF doesn't supply one)
// ─────────────────────────────────────────────────────────────────────────────
const REF_RANGES = {
  'Hemoglobin': '13.0-17.0 g/dL', 'Hematocrit': '40-50 %', 'RBC Count': '4.5-5.5 x10^6/uL',
  'MCV': '83-101 fL', 'MCH': '27-32 pg', 'MCHC': '31.5-34.5 g/dL',
  'RDW-CV': '11.6-14 %', 'RDW-SD': '39-46 fL',
  'WBC': '4.0-10.0 x10^3/uL', 'Neutrophils %': '40-80 %', 'Neutrophils Absolute': '2.0-7.0 x10^3/uL',
  'Lymphocytes %': '20-40 %', 'Lymphocytes Absolute': '1.0-3.0 x10^3/uL',
  'Monocytes %': '2-10 %', 'Monocytes Absolute': '0.2-1.0 x10^3/uL',
  'Eosinophils %': '1-6 %', 'Eosinophils Absolute': '0.02-0.5 x10^3/uL',
  'Basophils %': '0-2 %', 'Basophils Absolute': '0.02-0.1 x10^3/uL',
  'Platelet Count': '150-410 x10^3/uL', 'MPV': '6.5-12 fL', 'PDW': '9.6-15.2 fL',
  'PCT': '0.19-0.39 %', 'PLCR': '19.7-42.4 %',
  'Total Cholesterol': '< 200 mg/dL', 'HDL Cholesterol': '40-60 mg/dL',
  'LDL Cholesterol': '< 100 mg/dL', 'VLDL Cholesterol': '5-40 mg/dL',
  'Triglycerides': '< 150 mg/dL', 'TC/HDL Ratio': '3-5',
  'LDL/HDL Ratio': '1.5-3.5', 'HDL/LDL Ratio': '> 0.40',
  'TG/HDL Ratio': '< 3.12', 'Non-HDL Cholesterol': '< 160 mg/dL',
  'SGOT': '< 35 U/L', 'SGPT': '< 45 U/L', 'SGOT/SGPT Ratio': '< 2',
  'Alkaline Phosphatase': '45-129 U/L', 'GGT': '< 55 U/L',
  'Bilirubin Total': '0.3-1.2 mg/dL', 'Bilirubin Direct': '< 0.20 mg/dL',
  'Bilirubin Indirect': '0-0.9 mg/dL', 'Total Protein': '5.7-8.2 g/dL',
  'Albumin': '3.2-4.8 g/dL', 'Globulin': '2.5-3.4 g/dL', 'A/G Ratio': '0.9-2',
  'Creatinine': '0.72-1.18 mg/dL', 'BUN': '7.94-20.07 mg/dL', 'Urea': '17-43 mg/dL',
  'Uric Acid': '4.2-7.3 mg/dL', 'Calcium': '8.8-10.6 mg/dL',
  'eGFR': '>= 90 mL/min/1.73m2', 'BUN/Creatinine Ratio': '9-23', 'Urea/Creatinine Ratio': '< 52',
  'TSH': '0.35-4.94 uIU/mL', 'T3 Total': '0.6-1.81 ng/mL', 'T4 Total': '4.5-12.5 ug/dL',
  'Free T3': '1.4-4.2 pg/mL', 'Free T4': '0.8-1.8 ng/dL',
  'Vitamin D': '30-100 ng/mL', 'Vitamin B12': '211-911 pg/mL',
  'Fasting Glucose': '70-100 mg/dL', 'HbA1c': '< 5.7 %', 'Average Blood Glucose': '90-120 mg/dL',
  'Serum Iron': '65-175 ug/dL', 'TIBC': '225-535 ug/dL', 'UIBC': '162-368 ug/dL',
  'Transferrin Saturation': '13-45 %', 'Ferritin': '12-300 ng/mL',
};

// ─────────────────────────────────────────────────────────────────────────────
// Build alias index once at startup — sorted longest alias first
// ─────────────────────────────────────────────────────────────────────────────
const ALIAS_INDEX = [];
for (const [canonical, aliases] of Object.entries(MARKERS)) {
  for (const alias of aliases) {
    ALIAS_INDEX.push({ alias: alias.toUpperCase(), canonical });
  }
}
ALIAS_INDEX.sort((a, b) => b.alias.length - a.alias.length);

// ─────────────────────────────────────────────────────────────────────────────
// Date extraction
// ─────────────────────────────────────────────────────────────────────────────
const MONTH_MAP = {
  jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
};

function parseDate(text) {
  let m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,\s]+(\d{4})\b/i);
  if (m) return `${m[3]}-${MONTH_MAP[m[2].toLowerCase().slice(0,3)]}-${m[1].padStart(2,'0')}`;
  return null;
}

function extractDate(lines) {
  // Prefer lines that mention collection context over report-release lines
  const priority = lines.filter(l =>
    /coll|collection|sct|date\s*:/i.test(l.text) && !/released|received|report date/i.test(l.text)
  );
  for (const line of [...priority, ...lines]) {
    const d = parseDate(line.text);
    if (d) return d;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group PDF text items into lines by Y coordinate
// ─────────────────────────────────────────────────────────────────────────────
function groupIntoLines(items) {
  const BUCKET = 4;
  const map = new Map();
  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = Math.round(item.transform[5] / BUCKET) * BUCKET;
    if (!map.has(y)) map.set(y, []);
    map.get(y).push({ x: item.transform[4], w: item.width ?? 0, text: item.str.trim() });
  }
  return [...map.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, items]) => {
      const sorted = items.sort((a, b) => a.x - b.x);
      return { items: sorted, text: sorted.map(i => i.text).join('  ') };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Column map detection — finds header row and records X positions of columns
// ─────────────────────────────────────────────────────────────────────────────
const COL_PATTERNS = {
  value:     /\b(result|value|observed\s*value)\b/i,
  units:     /\bunits?\b/i,
  reference: /\b(ref(?:erence)?\.?\s*(?:interval)?|bio\.?\s*ref|biological\s*ref|normal\s*range|b\.r\.i\.?)\b/i,
  tech:      /\b(technology|method(?:ology)?)\b/i,
};

function detectColMap(line) {
  const colMap = {};
  let hits = 0;
  for (const item of line.items) {
    for (const [col, re] of Object.entries(COL_PATTERNS)) {
      if (!colMap[col] && re.test(item.text)) {
        colMap[col] = item.x;
        hits++;
        break;
      }
    }
  }
  return hits >= 2 ? colMap : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Marker matching — longest alias wins, word-boundary enforced
// ─────────────────────────────────────────────────────────────────────────────
function matchMarker(lineText) {
  const upper = lineText.toUpperCase();
  for (const { alias, canonical } of ALIAS_INDEX) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`, 'i');
    if (re.test(upper)) return { alias, canonical };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Value and reference extraction from a matched line
// ─────────────────────────────────────────────────────────────────────────────
const NUM_RE   = /^-?\d+\.?\d*$/;
const RANGE_RE = /^\d+\.?\d*\s*[-–]\s*\d+\.?\d*$|^[<>≤≥]=?\s*\d+\.?\d*$|^\d+:\d+\s*[-–]\s*\d+:\d+$/;

function extractValueAndRef(lineItems, alias, colMap) {
  // Find the rightmost edge of the marker text within the items
  let markerEndX = 0;
  let accumulated = '';
  for (const item of lineItems) {
    accumulated += (accumulated ? '  ' : '') + item.text;
    if (accumulated.replace(/\s+/g, ' ').toUpperCase().includes(alias)) {
      markerEndX = item.x + item.w;
      break;
    }
  }

  const after = lineItems.filter(i => i.x >= markerEndX - 5);
  let value = null;
  let ref   = null;

  if (colMap && (colMap.value !== undefined || colMap.reference !== undefined)) {
    for (const item of after) {
      const t = item.text.trim();
      if (value === null && colMap.value !== undefined && Math.abs(item.x - colMap.value) < 70) {
        const n = parseFloat(t.replace(/,/g, ''));
        if (!isNaN(n) && NUM_RE.test(t.replace(/,/g, ''))) value = n;
      }
      if (ref === null && colMap.reference !== undefined && Math.abs(item.x - colMap.reference) < 90) {
        if (RANGE_RE.test(t) || /^[<>≤≥]/.test(t)) ref = t;
      }
    }
  }

  // Positional fallback: first plain number = value, first range pattern = ref
  if (value === null) {
    for (const item of after) {
      const t = item.text.trim().replace(/,/g, '');
      if (NUM_RE.test(t)) { value = parseFloat(t); break; }
    }
  }
  if (ref === null) {
    for (const item of after) {
      const t = item.text.trim();
      if (RANGE_RE.test(t) || /^[<>≤≥]/.test(t)) { ref = t; break; }
    }
  }

  return { value, ref };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lines to skip (page headers, admin, disclaimers)
// ─────────────────────────────────────────────────────────────────────────────
const SKIP_RE = [
  /^\(\s*method\s*:/i, /^\(\s*specimen\s*:/i, /^page\s*:\s*\d/i,
  /^processed\s*at/i, /^patient\s*(name)?[\s:]/i, /^referred\s*by/i,
  /^sample\s*(collected|received|type|barcode)/i, /^report\s*(released|status|date)/i,
  /^home\s*collection/i, /^tests?\s*done/i, /^disclaimer/i,
  /^please\s*correlate/i, /^method\s*:/i, /^address/i,
  /^branch/i, /^sid\s*no/i, /^reg\s*(date|no)/i, /^dr\./i,
  /^scan\s*qr/i, /^alert\s*!/i, /^\*?note\s*[-–:]/i,
  /^clinical\s*significance/i, /^specifications?:/i,
  /^conditions\s*of\s*reporting/i, /^test\s*name\s*$/i,
  /^investigation\s*\/?\s*method/i,
];

const shouldSkip = t => SKIP_RE.some(re => re.test(t.trim()));

// ─────────────────────────────────────────────────────────────────────────────
// Parse a single PDF — returns { date, extracted }
// ─────────────────────────────────────────────────────────────────────────────
async function parsePDF(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const allLines = [];
  let scanned = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    if (content.items.length < 8) { scanned++; continue; }
    allLines.push(...groupIntoLines(content.items));
  }

  if (scanned === pdf.numPages) {
    throw new Error(`"${file.name}" appears to be a scanned image PDF — text extraction is not possible.`);
  }

  const date = extractDate(allLines.slice(0, 50))
    ?? (window.prompt(`Could not detect date in "${file.name}".\nEnter test date (YYYY-MM-DD):`, '') || 'Unknown');

  const extracted = {};
  let colMap = null;

  for (const line of allLines) {
    if (shouldSkip(line.text)) continue;
    const newMap = detectColMap(line);
    if (newMap) { colMap = newMap; continue; }

    const match = matchMarker(line.text);
    if (!match || extracted[match.canonical]) continue;

    const { value, ref } = extractValueAndRef(line.items, match.alias, colMap);
    if (value === null) continue;

    extracted[match.canonical] = { value, ref: ref ?? REF_RANGES[match.canonical] ?? '' };
  }

  return { date, extracted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Result matrix
// ─────────────────────────────────────────────────────────────────────────────
const matrix = {};   // matrix[canonical][date] = numeric value
const refMap  = {};  // refMap[canonical] = range string
let   dates   = [];  // sorted unique dates

function mergeResult({ date, extracted }) {
  if (!dates.includes(date)) dates.push(date);
  for (const [canonical, { value, ref }] of Object.entries(extracted)) {
    if (!matrix[canonical]) matrix[canonical] = {};
    matrix[canonical][date] = value;
    if (!refMap[canonical]) refMap[canonical] = ref || REF_RANGES[canonical] || '';
  }
  dates.sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV generation
// ─────────────────────────────────────────────────────────────────────────────
function generateCSV() {
  const q   = s => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['Marker', 'Reference Range', ...dates].map(q).join(',')];
  for (const key of Object.keys(matrix).sort()) {
    rows.push([key, refMap[key] ?? REF_RANGES[key] ?? '', ...dates.map(d => matrix[key][d] ?? '')].map(q).join(','));
  }
  return rows.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────
function setStatus(msg, type = 'info') {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = `status-msg status-${type}`;
}

function renderResults() {
  const section   = document.getElementById('resultsSection');
  const tableWrap = document.getElementById('tableWrap');
  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const markers = Object.keys(matrix).sort();
  if (!markers.length) {
    tableWrap.innerHTML = '<p class="no-results">No known markers found in the uploaded reports.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'results-table';

  const thead = table.createTHead();
  const hrow  = thead.insertRow();
  ['Marker', 'Reference Range', ...dates].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    hrow.appendChild(th);
  });

  const tbody = table.createTBody();
  for (const canonical of markers) {
    const tr = tbody.insertRow();
    tr.insertCell().textContent = canonical;
    tr.insertCell().textContent = refMap[canonical] ?? REF_RANGES[canonical] ?? '';
    for (const d of dates) {
      const td = tr.insertCell();
      const v  = matrix[canonical][d];
      td.textContent    = v !== undefined ? v : '—';
      td.contentEditable = 'true';
      td.className      = 'editable';
      if (v === undefined) td.classList.add('missing');
    }
  }

  tableWrap.innerHTML = '';
  tableWrap.appendChild(table);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main file handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleFiles(files) {
  if (!files.length) return;
  setStatus(`Processing ${files.length} file${files.length > 1 ? 's' : ''}…`);

  const errors = [];
  for (const file of files) {
    try {
      setStatus(`Reading "${file.name}"…`);
      mergeResult(await parsePDF(file));
    } catch (err) {
      errors.push(`${file.name}: ${err.message}`);
      console.error(err);
    }
  }

  const markerCount = Object.keys(matrix).length;
  if (errors.length) {
    setStatus(errors.join('\n'), 'error');
  } else {
    setStatus(`${markerCount} markers extracted across ${dates.length} report${dates.length > 1 ? 's' : ''}.`, 'success');
  }
  renderResults();
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap on load
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }

  const dropzone  = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');

  document.getElementById('browseBtn').addEventListener('click', e => {
    e.stopPropagation();
    fileInput.click();
  });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', e => { if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('dragover'); });
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
    if (files.length) handleFiles(files);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles([...fileInput.files]);
  });

  document.getElementById('downloadBtn').addEventListener('click', () => {
    const blob = new Blob([generateCSV()], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url, download: `track-blood-${new Date().toISOString().slice(0,10)}.csv`,
    });
    a.click();
    URL.revokeObjectURL(url);
  });
});
