// ─────────────────────────────────────────────────────────────────────────────
// On every app init, try to fetch the latest parser-config.json and
// parser-config-wordmap.json straight from GitHub. Each file independently
// goes through the same three-tier fallback:
//   1. Fetch succeeds → cache it and use it.
//   2. Fetch fails (offline, GitHub down, malformed response) → use the last
//      successfully cached version, if one exists from a previous launch.
//   3. No cache either (e.g. first-ever launch with no network) → use the
//      version bundled at build time.
// They're synced independently (not as one atomic pair) so a hiccup fetching
// one doesn't hold back a fresh copy of the other.
// This is what lets report-format fixes (new keyword/reference-range/column-
// pattern data) reach users without an app store release — parser-core.mjs's
// logic itself never changes here, only the data it's configured with.
// ─────────────────────────────────────────────────────────────────────────────
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { configureParser } from '../../../parser-core.mjs';
import bundledConfig from '../../../parser-config.json';
import bundledWordMap from '../../../parser-config-wordmap.json';

const GITHUB_BASE = 'https://raw.githubusercontent.com/pocha/rakta-sutra/refs/heads/main';
const FETCH_TIMEOUT_MS = 5000;

function isValidConfig(c) {
  return !!(c && c.keywordMap && c.markerGroups && c.valueLimits && c.refRanges && c.layout);
}

// The word-map has no fixed shape to validate beyond "an object of arrays" —
// unlike the main config it's just KEYWORD -> [marker, ...] pairs throughout.
function isValidWordMap(w) {
  return !!(w && typeof w === 'object' && !Array.isArray(w)
    && Object.values(w).every(v => Array.isArray(v)));
}

// AbortSignal.timeout() is a newer API that may not exist on the older end
// of our iOS 15.0 deployment target — build the timeout by hand with
// AbortController instead, which has much wider WebKit support.
function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${ms}ms`)), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Runs the fetch → cache → bundled fallback chain for one file. Returns
// { data, source } rather than throwing — sync failures for one file should
// never prevent the other from loading.
async function syncOne({ label, remoteUrl, cachePath, bundled, isValid }) {
  try {
    const res = await fetchWithTimeout(remoteUrl, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const remote = await res.json();
    if (!isValid(remote)) throw new Error('fetched data failed shape validation');

    await Filesystem.writeFile({
      path: cachePath,
      directory: Directory.Data,
      data: JSON.stringify(remote),
      encoding: Encoding.UTF8,
    });
    return { data: remote, source: 'remote' };
  } catch (err) {
    console.error(`[parserConfig] ${label}: fetch failed, falling back to cache:`, err);
  }

  try {
    const { data } = await Filesystem.readFile({ path: cachePath, directory: Directory.Data, encoding: Encoding.UTF8 });
    const cached = JSON.parse(data);
    if (!isValid(cached)) throw new Error('cached data failed shape validation');
    return { data: cached, source: 'cache' };
  } catch (err) {
    console.error(`[parserConfig] ${label}: no usable cache, falling back to bundled:`, err);
    return { data: bundled, source: 'bundled' };
  }
}

export async function initParserConfig() {
  const [config, wordMap] = await Promise.all([
    syncOne({
      label: 'config',
      remoteUrl: `${GITHUB_BASE}/parser-config.json`,
      cachePath: 'parser-config.json',
      bundled: bundledConfig,
      isValid: isValidConfig,
    }),
    syncOne({
      label: 'wordmap',
      remoteUrl: `${GITHUB_BASE}/parser-config-wordmap.json`,
      cachePath: 'parser-config-wordmap.json',
      bundled: bundledWordMap,
      isValid: isValidWordMap,
    }),
  ]);

  configureParser(config.data, wordMap.data);
  console.log(`[parserConfig] using config (${config.source}) + wordmap (${wordMap.source})`);
}
