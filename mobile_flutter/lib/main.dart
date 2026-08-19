import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'navigation.dart';
import 'services/db.dart';
import 'services/parser_bridge.dart';
import 'services/parser_config_sync.dart';
import 'services/push.dart';
import 'services/reparse_all.dart';
import 'state/app_state.dart';
import 'theme.dart';
import 'screens/app_shell.dart';
import 'package:package_info_plus/package_info_plus.dart';

const _appVersionKey = 'lastAppVersion';

// Mirrors parser_config_sync.dart's config-hash check, just keyed off the
// app build itself — a new app version can ship parser-core.mjs logic
// changes (not just config data) that only take effect once stored reports
// are re-parsed. Fire-and-forget: never blocks the first frame on this.
//
// Reparses whenever the recorded version differs, including the very first
// time this check ever runs on a device — an install can already have
// reports sitting in its DB from an older build, so "no version recorded
// yet" doesn't mean "nothing's stale".
Future<void> _reparseIfAppUpdated() async {
  final info = await PackageInfo.fromPlatform();
  final currentVersion = '${info.version}+${info.buildNumber}';
  final previous = await Db.instance.getDeviceSetting(_appVersionKey);
  if (previous != currentVersion) {
    debugPrint('[main] app version $previous -> $currentVersion — reparsing all stored reports');
    await reparseAllReports();
    await Db.instance.setDeviceSetting(_appVersionKey, currentVersion);
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // ParserConfig.load() (bundled asset only) is no longer called directly —
  // initParserConfig() below both loads it (via the fetch/cache/bundled
  // fallback chain) and configures the JS bridge with the same data. Both
  // still need Db.instance.init() to be at least underway before their own
  // fire-and-forget reparse-on-change checks touch device_settings — same
  // concurrent structure the Svelte app's main.js used, since in practice
  // the local DB opens well before any network round trip in
  // initParserConfig() resolves.
  await Future.wait([
    Db.instance.init(),
    ParserBridge.instance.init(),
    Firebase.initializeApp(),
    initParserConfig(),
  ]);

  final appState = AppState();
  await appState.loadProfiles();

  runApp(
    ChangeNotifierProvider.value(
      value: appState,
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: 'Track Blood',
        theme: buildAppTheme(),
        home: Stack(
          children: [
            const AppShell(),
            ParserBridge.instance.hiddenHost(),
          ],
        ),
      ),
    ),
  );

  // Fire-and-forget, same as the Capacitor app — push registration/foreground
  // handling shouldn't block first paint.
  initPush(appState).catchError((err) => debugPrint('[main] initPush failed: $err'));
  _reparseIfAppUpdated().catchError((err) => debugPrint('[main] reparse-on-app-update check failed: $err'));

  // db.dart just dropped and recreated `markers` (a schema change that
  // can't be expressed as an in-place ALTER) — every report's markers need
  // re-deriving from its stored PDF. reparseAllReports() coalesces
  // concurrent callers, so this running alongside the checks above (e.g. a
  // migration shipping in the same release as another reparse-worthy
  // change) is safe, not duplicated work.
  if (Db.instance.migrated) {
    debugPrint('[main] markers schema migrated — reparsing all stored reports');
    reparseAllReports().catchError((err) {
      debugPrint('[main] reparse-on-migration failed: $err');
      return <String, int>{};
    });
  }
}
