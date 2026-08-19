// Hidden-WebView bridge to the shared parser-core.mjs engine (bridge/src/bridge.js).
// Only PDF extraction and journal/reminder free-text parsing cross this
// boundary — see the plan's §1 for why unit conversion stays native Dart
// (parser_config.dart).
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart' show AssetManifest, rootBundle;
import 'package:flutter/widgets.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';
import 'package:webview_flutter/webview_flutter.dart';

class ParsedMarker {
  final double value;
  final String unit;
  final String ref;
  ParsedMarker(this.value, this.unit, this.ref);
  factory ParsedMarker.fromJson(Map<String, dynamic> j) =>
      ParsedMarker((j['value'] as num).toDouble(), j['unit'] as String? ?? '', j['ref'] as String? ?? '');
}

class ParsePdfResult {
  final String? date;
  final bool dateAmbiguous;
  final String? dateAlternate;
  final Map<String, ParsedMarker> extracted;
  final List<String> unvaluedCanonicals;
  ParsePdfResult(this.date, this.dateAmbiguous, this.dateAlternate, this.extracted, this.unvaluedCanonicals);

  factory ParsePdfResult.fromJson(Map<String, dynamic> j) => ParsePdfResult(
        j['date'] as String?,
        j['dateAmbiguous'] as bool? ?? false,
        j['dateAlternate'] as String?,
        (j['extracted'] as Map<String, dynamic>).map((k, v) => MapEntry(k, ParsedMarker.fromJson(v as Map<String, dynamic>))),
        (j['unvaluedCanonicals'] as List).cast<String>(),
      );
}

class JournalParseResult {
  final String dateIso;
  JournalParseResult(this.dateIso);
  factory JournalParseResult.fromJson(Map<String, dynamic> j) => JournalParseResult(j['date'] as String);
}

class ReminderParseResult {
  final String? remindAtIso;
  final String? recurrence;
  final bool needsClarification;
  final String? question;
  ReminderParseResult(this.remindAtIso, this.recurrence, this.needsClarification, this.question);
  factory ReminderParseResult.fromJson(Map<String, dynamic> j) => ReminderParseResult(
        j['remindAt'] as String?,
        j['recurrence'] as String?,
        j['needsClarification'] as bool? ?? false,
        j['question'] as String?,
      );
}

class PasswordRequiredException implements Exception {
  const PasswordRequiredException();
}

class ParserBridgeException implements Exception {
  final String message;
  ParserBridgeException(this.message);
  @override
  String toString() => 'ParserBridgeException: $message';
}

class ParserBridge {
  ParserBridge._();
  static final ParserBridge instance = ParserBridge._();

  final _uuid = const Uuid();
  final _pending = <String, Completer<Map<String, dynamic>?>>{};
  late final WebViewController _controller;
  Completer<void>? _ready;

  Future<void> init() async {
    if (_ready != null) return _ready!.future;
    _ready = Completer<void>();

    // A WebView loading assets/bridge/index.html via file:// gets a "null"
    // origin, and Chromium refuses to run <script type="module"> (and the
    // pdf.js worker, itself a module) from a null origin — CORS applies even
    // to purely local files. Fix: extract the bundled bridge files to disk
    // once and serve them over a loopback HTTP server instead, so the page
    // gets a real origin. No network/internet involved — everything served
    // is already inside the app.
    final serverRoot = await _extractBridgeAssets();
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((req) => _serveFile(req, serverRoot));

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel('FlutterChannel', onMessageReceived: _onMessage)
      ..loadRequest(Uri.parse('http://127.0.0.1:${server.port}/index.html'));
    return _ready!.future;
  }

  Future<Directory> _extractBridgeAssets() async {
    final manifest = await AssetManifest.loadFromAssetBundle(rootBundle);
    final tempDir = await getTemporaryDirectory();
    final dest = Directory(p.join(tempDir.path, 'bridge'));
    await dest.create(recursive: true);
    for (final key in manifest.listAssets()) {
      if (!key.startsWith('assets/bridge/')) continue;
      final relPath = key.substring('assets/bridge/'.length);
      final bytes = await rootBundle.load(key);
      final file = File(p.join(dest.path, relPath));
      await file.parent.create(recursive: true);
      await file.writeAsBytes(bytes.buffer.asUint8List(bytes.offsetInBytes, bytes.lengthInBytes));
    }
    return dest;
  }

  static const _mimeTypes = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript'};

  Future<void> _serveFile(HttpRequest req, Directory root) async {
    final relPath = Uri.decodeFull(req.uri.path).replaceFirst(RegExp(r'^/'), '');
    final file = File(p.join(root.path, relPath));
    if (!await file.exists()) {
      req.response.statusCode = HttpStatus.notFound;
      await req.response.close();
      return;
    }
    req.response.headers.contentType = ContentType.parse(_mimeTypes[p.extension(file.path)] ?? 'application/octet-stream');
    await req.response.addStream(file.openRead());
    await req.response.close();
  }

  // Android requires a WebView to actually be attached to the widget tree to
  // run — a controller alone, never rendered, won't execute JS reliably.
  // Mount this once, zero-sized, near the app root (see main.dart).
  Widget hiddenHost() => SizedBox(width: 0, height: 0, child: WebViewWidget(controller: _controller));

  void _onMessage(JavaScriptMessage message) {
    final data = jsonDecode(message.message) as Map<String, dynamic>;
    if (data['ready'] == true) {
      _ready?.complete();
      return;
    }
    final completer = _pending.remove(data['requestId'] as String);
    if (completer == null) return;
    final error = data['error'] as Map<String, dynamic>?;
    if (error != null) {
      final name = error['name'] as String?;
      if (name == 'PasswordException') {
        completer.completeError(const PasswordRequiredException());
      } else {
        completer.completeError(ParserBridgeException(error['message'] as String? ?? 'unknown error'));
      }
    } else {
      completer.complete(data['result'] as Map<String, dynamic>?);
    }
  }

  // JSON-encodes the whole args array then strips the outer brackets — every
  // element (already valid JSON: strings, null) becomes a safe, correctly
  // escaped JS argument literal without hand-rolled quoting.
  String _argsLiteral(List<Object?> args) {
    final json = jsonEncode(args);
    return json.substring(1, json.length - 1);
  }

  Future<Map<String, dynamic>?> _call(String method, List<Object?> args) async {
    await init();
    final requestId = _uuid.v4();
    final completer = Completer<Map<String, dynamic>?>();
    _pending[requestId] = completer;
    await _controller.runJavaScript(
      'window.trackbloodBridge.$method(${_argsLiteral([requestId, ...args])});',
    );
    return completer.future;
  }

  // Re-runs the JS engine's configureParser() with freshly-synced data
  // (see ParserConfigSync) — config/wordMap are passed as JSON text (not
  // raw maps) since _argsLiteral just needs valid JSON-encodable values,
  // and the bridge re-parses each with JSON.parse on the other side.
  Future<void> configureParser(Map<String, dynamic> config, Map<String, dynamic> wordMap) =>
      _call('configureParser', [jsonEncode(config), jsonEncode(wordMap)]);

  Future<ParsePdfResult> parsePdf(String base64Pdf, {String? password}) async {
    final result = await _call('parsePdf', [base64Pdf, password]);
    return ParsePdfResult.fromJson(result!);
  }

  Future<JournalParseResult> parseJournalText(String text, DateTime refDate) async {
    final result = await _call('parseJournalText', [text, refDate.toIso8601String()]);
    return JournalParseResult.fromJson(result!);
  }

  Future<ReminderParseResult> parseReminderText(String text, DateTime refDate) async {
    final result = await _call('parseReminderText', [text, refDate.toIso8601String()]);
    return ReminderParseResult.fromJson(result!);
  }
}
