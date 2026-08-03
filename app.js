// ─────────────────────────────────────────────────────────────────────────────
// Parsing engine — shared with the mobile app; see parser-core.mjs.
// pdfjsLib is the CDN global (loaded via <script> before this file); the core
// module takes it as a parameter rather than assuming how it's loaded.
// ─────────────────────────────────────────────────────────────────────────────
import { parsePDF as extractFromPdf, configureParser, MARKER_GROUPS, REF_RANGES, parseRefRange } from './parser-core.mjs';

// Bundled default config, fetched rather than statically imported since this
// file has no build step — see parser-core.mjs's header comment for why the
// data/logic split exists (lets report-format fixes ship without touching
// this file, eventually via a fetched config instead of this local copy).
// Top-level await here is safe: DOMContentLoaded is held back until a module
// script (including any pending top-level await) finishes evaluating.
const [parserConfig, wordMap] = await Promise.all([
  fetch('./parser-config.json').then(r => r.json()),
  fetch('./parser-config-wordmap.json').then(r => r.json()),
]);
configureParser(parserConfig, wordMap);

// Thin wrapper: converts the browser File → ArrayBuffer, injects pdfjsLib,
// and falls back to prompting for a date when the core couldn't detect one
// (the core itself never touches window/document). Also retries with a
// password if the PDF needs one — pdf.js rejects with a PasswordException
// (err.name === 'PasswordException') rather than returning empty results.
async function parsePDF(file) {
  let password;
  let date, extracted;
  for (;;) {
    try {
      // file.arrayBuffer() can be called again for each retry — unlike a
      // reused ArrayBuffer, a File/Blob isn't consumed by reading it, so
      // this always hands pdf.js a fresh, undetached buffer.
      const arrayBuffer = await file.arrayBuffer();
      ({ date, extracted } = await extractFromPdf(arrayBuffer, pdfjsLib, password));
      break;
    } catch (err) {
      if (err.name !== 'PasswordException') throw err;
      password = window.prompt(`"${file.name}" is password protected.\nEnter the password:`, '');
      if (!password) throw new Error('Password required — skipped');
    }
  }
  const reportDate = date ?? (window.prompt(`Could not detect date in "${file.name}".\nEnter test date (YYYY-MM-DD):`, '') || 'Unknown');
  return { date: reportDate, extracted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Result matrix
// ─────────────────────────────────────────────────────────────────────────────
const matrix = {};
const refMap  = {};
let   dates   = [];

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
// CSV generation (with group rows)
// ─────────────────────────────────────────────────────────────────────────────
function generateCSV() {
  const q    = s => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['Marker', 'Reference Range', ...dates].map(q).join(',')];
  const all  = new Set(Object.keys(matrix));
  const done = new Set();

  const addRow = canonical => {
    rows.push([canonical, refMap[canonical] ?? REF_RANGES[canonical] ?? '', ...dates.map(d => matrix[canonical]?.[d] ?? '')].map(q).join(','));
    done.add(canonical);
  };

  for (const group of MARKER_GROUPS) {
    const present = group.keys.filter(k => all.has(k));
    if (!present.length) continue;
    rows.push([q(group.label), ...Array(1 + dates.length).fill(q(''))].join(','));
    group.keys.forEach(addRow);
  }

  const ungrouped = [...all].filter(k => !done.has(k)).sort();
  if (ungrouped.length) {
    rows.push([q('Other'), ...Array(1 + dates.length).fill(q(''))].join(','));
    ungrouped.forEach(addRow);
  }

  return rows.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Render a single marker row into tbody
// ─────────────────────────────────────────────────────────────────────────────
function renderMarkerRow(tbody, canonical) {
  const ref    = refMap[canonical] ?? REF_RANGES[canonical] ?? '';
  const bounds = parseRefRange(ref);
  const tr     = tbody.insertRow();
  tr.insertCell().textContent = canonical;
  tr.insertCell().textContent = ref;
  for (const d of dates) {
    const td = tr.insertCell();
    const v  = matrix[canonical]?.[d];
    td.textContent     = v !== undefined ? v : '—';
    td.contentEditable = 'true';
    td.className       = 'editable';
    if (v === undefined) {
      td.classList.add('missing');
    } else if (bounds) {
      const outLow  = bounds.low  !== null && v < bounds.low;
      const outHigh = bounds.high !== null && v > bounds.high;
      if (outLow || outHigh) td.classList.add('out-of-range');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Render results table with group headers
// ─────────────────────────────────────────────────────────────────────────────
function renderResults() {
  const section   = document.getElementById('resultsSection');
  const tableWrap = document.getElementById('tableWrap');
  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const all = new Set(Object.keys(matrix));
  if (!all.size) {
    tableWrap.innerHTML = '<p class="no-results">No known markers found in the uploaded reports.</p>';
    return;
  }

  const colCount = 2 + dates.length;
  const table    = document.createElement('table');
  table.className = 'results-table';

  const thead = table.createTHead();
  const hrow  = thead.insertRow();
  ['Marker', 'Reference Range', ...dates].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    hrow.appendChild(th);
  });

  const tbody  = table.createTBody();
  const done   = new Set();

  for (const group of MARKER_GROUPS) {
    const present = group.keys.filter(k => all.has(k));
    if (!present.length) continue;

    const gr  = tbody.insertRow();
    gr.className = 'group-header';
    const gtd = gr.insertCell();
    gtd.colSpan    = colCount;
    gtd.textContent = group.label;

    group.keys.forEach(k => { renderMarkerRow(tbody, k); done.add(k); });
  }

  const ungrouped = [...all].filter(k => !done.has(k)).sort();
  if (ungrouped.length) {
    const gr  = tbody.insertRow();
    gr.className = 'group-header';
    const gtd = gr.insertCell();
    gtd.colSpan     = colCount;
    gtd.textContent = 'Other';
    ungrouped.forEach(k => renderMarkerRow(tbody, k));
  }

  tableWrap.innerHTML = '';
  tableWrap.appendChild(table);
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────
function setStatus(msg, type = 'info') {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className   = `status-msg status-${type}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main file handler
// ─────────────────────────────────────────────────────────────────────────────
function showFileChips(files) {
  const area = document.getElementById('labsArea');
  if (!area) return;
  area.innerHTML = files.map(f =>
    `<span class="file-chip" title="${f.name}">${f.name}</span>`
  ).join('');
}

async function handleFiles(files) {
  if (!files.length) return;
  showFileChips(files);
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
  setStatus(
    errors.length ? errors.join('\n') : `${markerCount} markers extracted across ${dates.length} report${dates.length > 1 ? 's' : ''}.`,
    errors.length ? 'error' : 'success'
  );
  renderResults();
}

// ─────────────────────────────────────────────────────────────────────────────
// Share as PDF
// ─────────────────────────────────────────────────────────────────────────────
async function shareAsPDF() {
  setStatus('Generating PDF snapshot…');
  try {
    document.body.classList.add('capturing');
    const canvas = await html2canvas(document.body, {
      scale: 2, useCORS: true,
      scrollX: 0, scrollY: 0,
      width: document.body.scrollWidth,
      height: document.body.scrollHeight,
    });
    document.body.classList.remove('capturing');
    const { jsPDF } = window.jspdf;
    const imgData = canvas.toDataURL('image/jpeg', 0.85);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW  = pdf.internal.pageSize.getWidth();   // 210 mm
    const pageH  = pdf.internal.pageSize.getHeight();  // 297 mm
    const imgW   = pageW;
    const imgH   = canvas.height * (pageW / canvas.width);
    let remaining = imgH;
    let offset    = 0;
    while (remaining > 0) {
      pdf.addImage(imgData, 'JPEG', 0, offset, imgW, imgH);
      remaining -= pageH;
      if (remaining > 0) { pdf.addPage(); offset -= pageH; }
    }
    const blob = pdf.output('blob');
    const file = new File([blob], 'track-blood-report.pdf', { type: 'application/pdf' });

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'My Blood Report — Track Blood' });
    } else {
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
      URL.revokeObjectURL(url);
    }
    setStatus('');
  } catch (err) {
    document.body.classList.remove('capturing');
    setStatus('PDF generation failed: ' + err.message, 'error');
    console.error(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// This module's top-level `await fetch(...)` above means the document can
// finish parsing — and DOMContentLoaded can fire — before this script gets
// around to registering the listener below, which would silently drop all
// of this init code. Run immediately if the document is already past
// "loading" instead of blindly waiting for an event that may never come.
function onDomReady(fn) {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', fn);
  } else {
    fn();
  }
}

onDomReady(() => {
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

  const dropzone  = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');

  document.getElementById('browseBtn').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', e => { if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('dragover'); });
  dropzone.addEventListener('drop', e => {
    e.preventDefault(); dropzone.classList.remove('dragover');
    const files = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
    if (files.length) handleFiles(files);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFiles([...fileInput.files]); });

  document.getElementById('downloadBtn').addEventListener('click', () => {
    const blob = new Blob([generateCSV()], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `track-blood-${new Date().toISOString().slice(0,10)}.csv` }).click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('shareBtn')?.addEventListener('click', shareAsPDF);

  initDownloadButtons();
});

// ─────────────────────────────────────────────────────────────────────────────
// Download button: show only the relevant platform's button (based on the
// visiting device), and walk the user through that platform's install steps
// in a small modal rather than linking straight out — TestFlight and a
// sideloaded APK both need an extra step or two most people don't expect.
// ─────────────────────────────────────────────────────────────────────────────
function detectMobileOS() {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports its UA as a Mac, but exposes multi-touch — the one
  // reliable way to tell it apart from a real Mac.
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return null; // desktop or unrecognized — show both options
}

// Each modal's steps are one-at-a-time (tab-like), navigated via a single
// prev/next pair per modal rather than showing the whole list at once.
function showStep(overlay, index) {
  const steps = overlay.querySelectorAll('.dl-step');
  steps.forEach((step, i) => step.classList.toggle('active', i === index));
  overlay.dataset.currentStep = index;
  overlay.querySelector('[data-indicator]').textContent = `Step ${index + 1} of ${steps.length}`;
  overlay.querySelector('[data-prev]').disabled = index === 0;
  overlay.querySelector('[data-next]').disabled = index === steps.length - 1;
}

function initStepNav(overlay) {
  overlay.querySelector('[data-prev]').addEventListener('click', () => {
    const i = Number(overlay.dataset.currentStep);
    if (i > 0) showStep(overlay, i - 1);
  });
  overlay.querySelector('[data-next]').addEventListener('click', () => {
    const steps = overlay.querySelectorAll('.dl-step');
    const i = Number(overlay.dataset.currentStep);
    if (i < steps.length - 1) showStep(overlay, i + 1);
  });
}

function openModal(overlay) {
  showStep(overlay, 0);
  overlay.classList.add('open');
}
function closeModal(overlay) { overlay.classList.remove('open'); }

function initDownloadButtons() {
  const iosBtn = document.getElementById('ios-download-btn');
  const androidBtn = document.getElementById('android-download-btn');
  const iosOverlay = document.getElementById('ios-modal-overlay');
  const androidOverlay = document.getElementById('android-modal-overlay');

  const os = detectMobileOS();
  if (os === 'ios') {
    iosBtn.style.display = '';
  } else if (os === 'android') {
    androidBtn.style.display = '';
  } else {
    iosBtn.style.display = '';
    androidBtn.style.display = '';
  }

  iosBtn.addEventListener('click', () => openModal(iosOverlay));
  androidBtn.addEventListener('click', () => openModal(androidOverlay));

  for (const overlay of [iosOverlay, androidOverlay]) {
    initStepNav(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay); });
  }
  document.getElementById('ios-modal-close').addEventListener('click', () => closeModal(iosOverlay));
  document.getElementById('android-modal-close').addEventListener('click', () => closeModal(androidOverlay));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(iosOverlay); closeModal(androidOverlay); }
  });
}
