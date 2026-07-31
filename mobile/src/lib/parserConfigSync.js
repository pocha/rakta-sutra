// ─────────────────────────────────────────────────────────────────────────────
// On every app init, try to fetch the latest parser-config.json straight from
// GitHub — if that succeeds, cache it and use it; if it fails (offline, GitHub
// down, whatever), fall back to the config bundled at build time. This is what
// lets report-format fixes (new keyword/reference-range/column-pattern data)
// reach users without an app store release — parser-core.mjs's logic itself
// never changes here, only the data it's configured with.
// ─────────────────────────────────────────────────────────────────────────────
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { configureParser } from '../../../parser-core.mjs';
import bundledConfig from '../../../parser-config.json';

const CACHE_PATH = 'parser-config.json';
const REMOTE_URL = 'https://raw.githubusercontent.com/pocha/rakta-sutra/refs/heads/main/parser-config.json';

function isValidConfig(c) {
  return !!(c && c.keywordMap && c.markerGroups && c.valueLimits && c.refRanges && c.layout);
}

export async function initParserConfig() {
  try {
    const res = await fetch(REMOTE_URL);
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
  } catch (err) {
    console.error('[parserConfig] fetch failed, using bundled config:', err);
    configureParser(bundledConfig);
  }
}
