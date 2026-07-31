// ─────────────────────────────────────────────────────────────────────────────
// Shared app state (Svelte 5 runes) — active profile & active tab.
// Everything else (reports/markers/journal/reminders) is read fresh from
// SQLite by each tab component; this file only holds cross-tab UI state.
// ─────────────────────────────────────────────────────────────────────────────
import * as db from './db.js';

export const appState = $state({
  profiles: [],
  activeProfileId: null,
  activeTab: 'report', // 'report' | 'timeline' | 'reminder'
  jumpToReportId: null, // set by Timeline's "View full report" link
  drawerOpen: false,
  screen: null, // null (normal tabs) | 'backup' | 'notifications' (pushed full screen)
});

export function openScreen(name) {
  appState.screen = name;
  appState.drawerOpen = false;
}

export function closeScreen() {
  appState.screen = null;
}

export function jumpToReport(reportId) {
  appState.jumpToReportId = reportId;
  appState.activeTab = 'report';
}

export async function loadProfiles() {
  appState.profiles = await db.listProfiles();
  if (!appState.activeProfileId && appState.profiles.length) {
    appState.activeProfileId = appState.profiles[0].id;
  }
}

export async function createProfile(name) {
  const id = await db.addProfile(name);
  await loadProfiles();
  appState.activeProfileId = id;
}

export function switchProfile(id) {
  appState.activeProfileId = id;
}
