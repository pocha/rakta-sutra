// ─────────────────────────────────────────────────────────────────────────────
// Consolidated report PDF — a clean tabular document (marker groups × dates),
// suitable for handing to a doctor. Built directly with jsPDF rather than
// screenshotting the app UI (a dark-mode phone screenshot isn't something you
// want to print or send to a clinician).
// ─────────────────────────────────────────────────────────────────────────────
import { jsPDF } from 'jspdf';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { getConsolidatedMatrix } from './db.js';
import { MARKER_GROUPS } from './parser.js';

const MARGIN = 36;
const ROW_H = 16;
const PAGE_H = 792; // Letter, points
const PAGE_W = 612;

function groupedRows(markers) {
  const present = new Set(Object.keys(markers));
  const rows = [];
  for (const group of MARKER_GROUPS) {
    const inGroup = group.keys.filter(k => present.has(k));
    if (!inGroup.length) continue;
    rows.push({ header: group.label });
    for (const k of inGroup) rows.push({ canonical: k });
  }
  const ungrouped = [...present].filter(k => !MARKER_GROUPS.some(g => g.keys.includes(k)));
  if (ungrouped.length) {
    rows.push({ header: 'Other' });
    for (const k of ungrouped) rows.push({ canonical: k });
  }
  return rows;
}

export async function generateConsolidatedReportPdf(profileId, profileName) {
  const { dates, markers, refRanges } = await getConsolidatedMatrix(profileId);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const nameColW = 150;
  const refColW = 90;
  const dateColW = Math.max(60, (PAGE_W - MARGIN * 2 - nameColW - refColW) / Math.max(dates.length, 1));

  let y = MARGIN;
  function header() {
    doc.setFontSize(14);
    doc.text('Track Blood — Consolidated Report', MARGIN, y);
    y += 18;
    doc.setFontSize(9);
    doc.text(profileName ?? '', MARGIN, y);
    y += 16;
    doc.setFontSize(8);
    let x = MARGIN;
    doc.text('Marker', x, y); x += nameColW;
    doc.text('Ref Range', x, y); x += refColW;
    for (const d of dates) { doc.text(d, x, y); x += dateColW; }
    y += 10;
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 10;
  }

  function ensureSpace() {
    if (y > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN; header(); }
  }

  header();
  doc.setFontSize(8);
  for (const row of groupedRows(markers)) {
    ensureSpace();
    if (row.header) {
      y += 6;
      ensureSpace();
      doc.setFont(undefined, 'bold');
      doc.text(row.header, MARGIN, y);
      doc.setFont(undefined, 'normal');
      y += ROW_H;
      continue;
    }
    let x = MARGIN;
    doc.text(row.canonical, x, y); x += nameColW;
    doc.text(refRanges[row.canonical] ?? '', x, y); x += refColW;
    for (const d of dates) {
      const v = markers[row.canonical]?.[d];
      doc.text(v !== undefined ? String(v) : '—', x, y);
      x += dateColW;
    }
    y += ROW_H;
  }

  const arrayBuffer = doc.output('arraybuffer');
  const base64 = arrayBufferToBase64(arrayBuffer);
  const fileName = `track-blood-report-${new Date().toISOString().slice(0, 10)}.pdf`;
  const path = `shared/${fileName}`;
  await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });

  await Share.share({ title: 'My Blood Report — Track Blood', url: uri });
  return uri;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
