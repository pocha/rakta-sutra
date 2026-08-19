// Port of mobile/src/lib/parserConfigSync.js. On every app init, tries to
// fetch the latest parser-config.json and parser-config-wordmap.json
// straight from GitHub. Each file independently goes through the same
// three-tier fallback:
//   1. Fetch succeeds → cache it and use it.
//   2. Fetch fails (offline, GitHub down, malformed response) → use the
//      last successfully cached version, if one exists from a previous launch.
//   3. No cache either (e.g. first-ever launch with no network) → use the
//      version bundled at build time.
// They're synced independently (not as one atomic pair) so a hiccup fetching
// one doesn't hold back a fresh copy of the other. This is what lets
// report-format fixes (new keyword/reference-range/column-pattern data)
// reach users without an app store release — parser-core.mjs's logic
// itself never changes here, only the data it's configured with.
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'db.dart';
import 'parser_bridge.dart';
import 'parser_config.dart';
import 'reparse_all.dart';

const _configHashKey = 'lastConfigHash';
const _githubBase = 'https://raw.githubusercontent.com/pocha/rakta-sutra/refs/heads/main';
const _fetchTimeout = Duration(seconds: 5);

bool _isValidConfig(Map<String, dynamic> c) =>
    c['keywordMap'] != null && c['markerGroups'] != null && c['valueLimits'] != null && c['refRanges'] != null && c['units'] != null && c['layout'] != null;

// The word-map has no fixed shape to validate beyond "an object of arrays" —
// unlike the main config it's just KEYWORD -> [marker, ...] pairs throughout.
bool _isValidWordMap(Map<String, dynamic> w) => w.values.every((v) => v is List);

class _SyncResult {
  final Map<String, dynamic> data;
  final String source; // 'remote' | 'cache' | 'bundled'
  _SyncResult(this.data, this.source);
}

Future<_SyncResult> _syncOne({
  required String label,
  required String remoteUrl,
  required String cacheFileName,
  required String bundledAssetPath,
  required bool Function(Map<String, dynamic>) isValid,
}) async {
  final dir = await getApplicationSupportDirectory();
  final cacheFile = File(p.join(dir.path, cacheFileName));

  try {
    final res = await http.get(Uri.parse(remoteUrl)).timeout(_fetchTimeout);
    if (res.statusCode != 200) throw Exception('fetch failed: ${res.statusCode}');
    final remote = jsonDecode(res.body) as Map<String, dynamic>;
    if (!isValid(remote)) throw Exception('fetched data failed shape validation');
    await cacheFile.writeAsString(res.body);
    return _SyncResult(remote, 'remote');
  } catch (err) {
    // ignore: avoid_print
    print('[parserConfig] $label: fetch failed, falling back to cache: $err');
  }

  try {
    final cached = jsonDecode(await cacheFile.readAsString()) as Map<String, dynamic>;
    if (!isValid(cached)) throw Exception('cached data failed shape validation');
    return _SyncResult(cached, 'cache');
  } catch (err) {
    // ignore: avoid_print
    print('[parserConfig] $label: no usable cache, falling back to bundled: $err');
    final bundled = jsonDecode(await rootBundle.loadString(bundledAssetPath)) as Map<String, dynamic>;
    return _SyncResult(bundled, 'bundled');
  }
}

String _hashConfig(Map<String, dynamic> config, Map<String, dynamic> wordMap) =>
    sha256.convert(utf8.encode(jsonEncode(config) + jsonEncode(wordMap))).toString();

// Fire-and-forget from initParserConfig() — must never block app startup on
// hashing (cheap) or a potentially-slow reparse of every stored report.
//
// Reparses whenever the recorded hash differs, including the very first
// time this check ever runs on a device — an install can already have
// reports sitting in its DB from before this tracking existed, so "no hash
// recorded yet" doesn't mean "nothing's stale".
Future<void> _reparseIfConfigChanged(Map<String, dynamic> config, Map<String, dynamic> wordMap) async {
  final hash = _hashConfig(config, wordMap);
  final previous = await Db.instance.getDeviceSetting(_configHashKey);
  if (previous != hash) {
    // ignore: avoid_print
    print('[parserConfig] config hash $previous -> $hash — reparsing all stored reports');
    await reparseAllReports();
    await Db.instance.setDeviceSetting(_configHashKey, hash);
  }
}

Future<void> initParserConfig() async {
  final results = await Future.wait([
    _syncOne(
      label: 'config',
      remoteUrl: '$_githubBase/parser-config.json',
      cacheFileName: 'parser-config.json',
      bundledAssetPath: 'assets/parser-config.json',
      isValid: _isValidConfig,
    ),
    _syncOne(
      label: 'wordmap',
      remoteUrl: '$_githubBase/parser-config-wordmap.json',
      cacheFileName: 'parser-config-wordmap.json',
      bundledAssetPath: 'assets/parser-config-wordmap.json',
      isValid: _isValidWordMap,
    ),
  ]);
  final config = results[0];
  final wordMap = results[1];

  ParserConfig.reconfigure(config.data, wordMap.data);
  await ParserBridge.instance.configureParser(config.data, wordMap.data);
  // ignore: avoid_print
  print('[parserConfig] using config (${config.source}) + wordmap (${wordMap.source})');

  _reparseIfConfigChanged(config.data, wordMap.data).catchError((err) {
    // ignore: avoid_print
    print('[parserConfig] reparse-on-config-change check failed: $err');
  });
}
