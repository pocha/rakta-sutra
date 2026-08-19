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
import { parsePDF, configureParser } from '../../parser-core.mjs';
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

// Journal entries used to also be indexed by marker keyword (extracted via
// the same fuzzy matching the PDF parser uses) into a journal_marker_index
// table, so Timeline search could find a note by marker name. Removed —
// bare/ambiguous keywords (e.g. "VITAMIN" mapped to all 8 vitamin markers)
// made that index too imprecise for search (a note mentioning only
// "Vitamin D" also matched "Vitamin B12"). Timeline search now just matches
// directly against the note's own text (mobile_flutter/lib/screens/
// timeline_tab.dart), so only date extraction is needed here.
function parseJournalText(text, refDateIso) {
  const refDate = new Date(refDateIso);
  const results = chrono.parse(text, refDate, { forwardDate: false });
  const when = results.length ? results[0].start.date() : refDate;
  return { date: when.toISOString() };
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
  // re-runs configureParser() with the new data so parsePdf() picks it up
  // without restarting the app.
  configureParser(requestId, configJson, wordMapJson) {
    try {
      configureParser(JSON.parse(configJson), JSON.parse(wordMapJson));
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
