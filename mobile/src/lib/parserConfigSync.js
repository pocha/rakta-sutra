// ─────────────────────────────────────────────────────────────────────────────
// On every app init, try to fetch the latest parser-config.json straight from
// GitHub. Three-tier fallback:
//   1. Fetch succeeds → cache it and use it.
//   2. Fetch fails (offline, GitHub down, malformed response) → use the last
//      successfully cached version, if one exists from a previous launch.
//   3. No cache either (e.g. first-ever launch with no network) → use the
//      config bundled at build time.
// This is what lets report-format fixes (new keyword/reference-range/column-
// pattern data) reach users without an app store release — parser-core.mjs's
// logic itself never changes here, only the data it's configured with.
// ─────────────────────────────────────────────────────────────────────────────
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { configureParser } from '../../../parser-core.mjs';
import bundledConfig from '../../../parser-config.json';

const CACHE_PATH = 'parser-config.json';
const REMOTE_URL = 'https://raw.githubusercontent.com/pocha/rakta-sutra/refs/heads/main/parser-config.json';
const FETCH_TIMEOUT_MS = 5000;

function isValidConfig(c) {
  return !!(c && c.keywordMap && c.markerGroups && c.valueLimits && c.refRanges && c.layout);
}

async function readCachedConfig() {
  const { data } = await Filesystem.readFile({ path: CACHE_PATH, directory: Directory.Data, encoding: Encoding.UTF8 });
  const cached = JSON.parse(data);
  if (!isValidConfig(cached)) throw new Error('cached config failed shape validation');
  return cached;
}

// AbortSignal.timeout() is a newer API that may not exist on the older end
// of our iOS 15.0 deployment target — build the timeout by hand with
// AbortController instead, which has much wider WebKit support.
function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${ms}ms`)), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function initParserConfig() {
  try {
    // A hung request here (flaky network, a captive portal, DNS weirdness)
    // must never block app startup indefinitely — bound it and fall through
    // to cache/bundled on timeout same as any other fetch failure.
    const res = await fetchWithTimeout(REMOTE_URL, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const remote = await res.json();
    if (!isValidConfig(remote)) throw new Error('fetched config failed shape validation');

    await Filesystem.writeFile({
      path: CACHE_PATH,
      directory: Directory.Data,
      data: JSON.stringify(remote),
      encoding: Encoding.UTF8,
    });
    configureParser(remote);
    console.log('[parserConfig] using freshly fetched config');
    return;
  } catch (err) {
    console.error('[parserConfig] fetch failed, falling back to cache:', err);
  }

  try {
    configureParser(await readCachedConfig());
    console.log('[parserConfig] using last cached config');
  } catch (err) {
    console.error('[parserConfig] no usable cache, falling back to bundled config:', err);
    configureParser(bundledConfig);
  }
}
