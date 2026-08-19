// ─────────────────────────────────────────────────────────────────────────────
// Hidden-WebView bridge: loaded once into an invisible WebViewController from
// Dart (see mobile_flutter/lib/services/parser_bridge.dart) and driven via
// window.trackbloodBridge.*. Only the genuinely complex, fixture-verified
// parts of parser-core.mjs cross this boundary (PDF extraction, journal/
// reminder free-text understanding) — unit conversion/ref-range lookups are
// ported directly to Dart since they're called on every keystroke/dropdown
// change and a round-trip here would be janky. See the plan's §1.
//
// Protocol: Dart calls `window.trackbloodBridge.<method>(requestId, ...args)`
// via runJavaScript(); this posts `{requestId, result}` or `{requestId,
// error}` back through the 'FlutterChannel' JavaScriptChannel once done.
// ─────────────────────────────────────────────────────────────────────────────
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import * as chrono from 'chrono-node';
import { parsePDF, configureParser, KEYWORD_MAP, REF_RANGES } from '../../parser-core.mjs';
import config from '../../parser-config.json';
import wordMap from '../../parser-config-wordmap.json';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
configureParser(config, wordMap);

function post(requestId, payload) {
  window.FlutterChannel.postMessage(JSON.stringify({ requestId, ...payload }));
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ── Free-text marker recognition — ported from mobile/src/lib/textParse.js,
// same logic, just re-homed here since it shares KEYWORD_MAP/REF_RANGES with
// the PDF parser and both need to live behind the same bridge (see plan §1).
function compactNorm(text) {
  return text.replace(/\x00/g, '').toUpperCase().replace(/AE/g, 'E').replace(/[^A-Z0-9]/g, '');
}

let keywordEntries = null;
let canonicalCompact = null;
function ensureIndexes() {
  if (keywordEntries) return;
  keywordEntries = Object.entries(KEYWORD_MAP).sort(([a], [b]) => b.length - a.length);
  canonicalCompact = Object.keys(REF_RANGES).map(c => [c, compactNorm(c)]);
}

function extractMarkersFromText(text) {
  ensureIndexes();
  const compact = compactNorm(text);
  if (!compact) return [];
  const found = new Set();
  for (const [canonical, compactName] of canonicalCompact) {
    if (compact.includes(compactName)) found.add(canonical);
  }
  for (const [kw, canonicals] of keywordEntries) {
    if (compact.includes(kw)) for (const c of canonicals) found.add(c);
  }
  return [...found];
}

function parseJournalText(text, refDateIso) {
  const refDate = new Date(refDateIso);
  const results = chrono.parse(text, refDate, { forwardDate: false });
  const when = results.length ? results[0].start.date() : refDate;
  return { date: when.toISOString(), canonicals: extractMarkersFromText(text) };
}

const RECURRENCE_PATTERNS = [
  { re: /\bevery\s*day\b|\bdaily\b/i, recurrence: 'daily' },
  { re: /\bevery\s+week\b|\bweekly\b/i, recurrence: 'weekly' },
  { re: /\bevery\s+month\b|\bmonthly\b/i, recurrence: 'monthly' },
  { re: /\bevery\s+(mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)[a-z]*day?\b/i,
    fn: m => `weekly:${m[1].slice(0, 3).toUpperCase()}` },
];

function detectRecurrence(text) {
  for (const p of RECURRENCE_PATTERNS) {
    const m = text.match(p.re);
    if (m) return p.fn ? p.fn(m) : p.recurrence;
  }
  return null;
}

function parseReminderText(text, refDateIso) {
  const refDate = new Date(refDateIso);
  const recurrence = detectRecurrence(text);
  const results = chrono.casual.parse(text, refDate, { forwardDate: true });

  if (!results.length) {
    return {
      remindAt: null,
      recurrence,
      needsClarification: true,
      question: "When should I remind you? (e.g. \"tomorrow at 9am\" or \"every Monday at 8pm\")",
    };
  }

  const parsed = results[0];
  const remindAt = parsed.start.date();
  if (recurrence && !parsed.start.isCertain('hour')) remindAt.setHours(9, 0, 0, 0);
  return { remindAt: remindAt.toISOString(), recurrence, needsClarification: false };
}

window.trackbloodBridge = {
  // Called by ParserConfigSync after fetching a fresher parser-config.json/
  // wordmap from GitHub than the ones baked into this bundle at build time —
  // re-runs configureParser() with the new data so parsePdf() (and the
  // free-text parsers below, which share KEYWORD_MAP/REF_RANGES) pick it up
  // without restarting the app. Clears the lazily-built keyword/canonical
  // indexes too, since they're derived from the old config and would
  // otherwise keep matching against stale data.
  configureParser(requestId, configJson, wordMapJson) {
    try {
      configureParser(JSON.parse(configJson), JSON.parse(wordMapJson));
      keywordEntries = null;
      canonicalCompact = null;
      post(requestId, { result: {} });
    } catch (err) {
      post(requestId, { error: { name: err.name, message: err.message } });
    }
  },
  async parsePdf(requestId, base64, password) {
    try {
      const result = await parsePDF(base64ToArrayBuffer(base64), pdfjsLib, password || undefined);
      post(requestId, { result });
    } catch (err) {
      post(requestId, { error: { name: err.name, message: err.message } });
    }
  },
  parseJournalText(requestId, text, refDateIso) {
    try {
      post(requestId, { result: parseJournalText(text, refDateIso) });
    } catch (err) {
      post(requestId, { error: { name: err.name, message: err.message } });
    }
  },
  parseReminderText(requestId, text, refDateIso) {
    try {
      post(requestId, { result: parseReminderText(text, refDateIso) });
    } catch (err) {
      post(requestId, { error: { name: err.name, message: err.message } });
    }
  },
};

window.FlutterChannel?.postMessage(JSON.stringify({ ready: true }));
