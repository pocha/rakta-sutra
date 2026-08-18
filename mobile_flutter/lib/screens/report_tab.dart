// Port of ReportTab.svelte. Two things are simpler here than the Svelte
// version: date navigation is just a plain index + setState (no swipeable
// multi-report pager needed — Flutter's rebuild model gives the same
// "marker names stay put, only values change" result for free), and the
// Extracted/Raw sub-tabs use IndexedStack so the PDF view's scroll position
// survives switching away and back, same as the plan's §4.
import 'dart:convert';
import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_pdfview/flutter_pdfview.dart';
import '../services/db.dart';
import '../services/parser_bridge.dart';
import '../services/parser_config.dart';
import '../services/report_files.dart';
import '../theme.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../widgets/value_cell.dart';
import 'marker_detail_screen.dart';

class ReportTab extends StatefulWidget {
  final int? profileId;
  const ReportTab({super.key, required this.profileId});

  @override
  State<ReportTab> createState() => _ReportTabState();
}

class _ReportTabState extends State<ReportTab> {
  bool _loading = true;
  List<Map<String, Object?>> _reports = [];
  Map<String, Map<int, Map<String, Object?>>> _valuesByCanonical = {};
  int _reportIndex = 0;
  int _subTab = 0; // 0 = Extracted, 1 = Raw
  String? _status;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void didUpdateWidget(covariant ReportTab old) {
    super.didUpdateWidget(old);
    if (old.profileId != widget.profileId) _refresh();
  }

  Future<void> _refresh() async {
    if (widget.profileId == null) return;
    setState(() => _loading = true);
    final (reports, values) = await Db.instance.getConsolidatedReportData(widget.profileId!);
    setState(() {
      _reports = reports;
      _valuesByCanonical = values;
      if (_reportIndex >= _reports.length) _reportIndex = 0;
      _loading = false;
    });
  }

  Map<String, Object?>? get _currentReport => _reports.isEmpty ? null : _reports[_reportIndex];

  List<(String?, String?)> get _groupedRows {
    final present = _valuesByCanonical.keys.toSet();
    final rows = <(String?, String?)>[]; // (groupLabel, canonical) — one non-null
    final grouped = <String>{};
    for (final g in ParserConfig.instance.markerGroups) {
      final inGroup = g.keys.where(present.contains).toList();
      if (inGroup.isEmpty) continue;
      rows.add((g.label, null));
      for (final k in inGroup) rows.add((null, k));
      grouped.addAll(g.keys);
    }
    final ungrouped = present.difference(grouped).toList()..sort();
    if (ungrouped.isNotEmpty) {
      rows.add(('Other', null));
      for (final k in ungrouped) rows.add((null, k));
    }
    return rows;
  }

  String _relativeLabel(String dateStr) {
    final days = DateTime.now().difference(DateTime.parse(dateStr)).inDays;
    if (days <= 0) return 'Today';
    if (days < 30) return '$days day${days > 1 ? 's' : ''} ago';
    if (days < 365) return '${(days / 30).round()} month${(days / 30).round() > 1 ? 's' : ''} ago';
    return '${(days / 365).round()} year${(days / 365).round() > 1 ? 's' : ''} ago';
  }

  void _goToPage(int delta) {
    final target = (_reportIndex + delta).clamp(0, _reports.length - 1);
    setState(() => _reportIndex = target);
  }

  Future<void> _pickAndUpload() async {
    setState(() => _status = 'Opening file picker…');
    try {
      final files = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: ['pdf']);
      if (files.isEmpty) { setState(() => _status = null); return; }

      int? lastUploadedId;
      final failed = <String>[];
      final seenDates = _reports.map((r) => r['date'] as String).toSet();

      for (final file in files) {
        try {
          setState(() => _status = 'Reading "${file.name}"…');
          final bytes = await file.readAsBytes();
          final parsed = await _parseWithPasswordRetry(bytes, file.name);
          if (parsed == null) continue; // user cancelled the password prompt

          var reportDate = parsed.date;
          if (parsed.dateAmbiguous && mounted) {
            reportDate = await _promptDate(
              'The date in "${file.name}" could be ${parsed.date} or ${parsed.dateAlternate} — which is correct?',
              parsed.date ?? '',
            );
          } else if (reportDate == null && mounted) {
            reportDate = await _promptDate('Could not detect a date in "${file.name}".\nEnter the report date (YYYY-MM-DD):', '');
          }
          if (reportDate == null || reportDate.isEmpty) continue;

          if (seenDates.contains(reportDate) && mounted) {
            final proceed = await _confirm('You already have a report dated $reportDate.\n\nAdd "${file.name}" as a separate report for the same date anyway?');
            if (!proceed) continue;
          }
          seenDates.add(reportDate);

          final path = await ReportFiles.save(widget.profileId!, file.name, bytes);
          lastUploadedId = await Db.instance.addReport(widget.profileId!, reportDate, file.name, path, parsed.extracted, parsed.unvaluedCanonicals);
        } catch (err) {
          failed.add('${file.name}: $err');
        }
      }

      setState(() => _status = null);
      await _refresh();
      if (lastUploadedId != null) {
        final idx = _reports.indexWhere((r) => r['id'] == lastUploadedId);
        setState(() => _reportIndex = idx >= 0 ? idx : 0);
      }
      if (failed.isNotEmpty && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(failed.join('\n'))));
      }
    } catch (err) {
      setState(() => _status = null);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Upload failed: $err')));
    }
  }

  // Retries with a freshly-prompted password on PasswordRequiredException,
  // as many times as the user is willing — mirrors ReportTab.svelte's
  // parseWithPasswordRetry. Returns null if the user cancels the prompt.
  Future<ParsePdfResult?> _parseWithPasswordRetry(List<int> bytes, String fileName) async {
    String? password;
    final base64 = _bytesToBase64(bytes);
    for (;;) {
      try {
        return await ParserBridge.instance.parsePdf(base64, password: password);
      } on PasswordRequiredException {
        if (!mounted) return null;
        password = await _promptPassword(fileName);
        if (password == null) return null;
      }
    }
  }

  Future<String?> _promptDate(String message, String initial) async {
    final ctrl = TextEditingController(text: initial);
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(message),
          TextField(controller: ctrl, decoration: const InputDecoration(hintText: 'YYYY-MM-DD')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, ctrl.text.trim()), child: const Text('OK')),
        ],
      ),
    );
  }

  Future<String?> _promptPassword(String fileName) async {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('"$fileName" is password protected'),
        content: TextField(controller: ctrl, obscureText: true, decoration: const InputDecoration(hintText: 'Password')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, ctrl.text), child: const Text('OK')),
        ],
      ),
    );
  }

  Future<bool> _confirm(String message) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(content: Text(message), actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Continue')),
      ]),
    );
    return result ?? false;
  }

  // Timeline's "jump to this report" sets AppState.jumpToReportId — consumed
  // here rather than there, since only ReportTab knows how its own report
  // index maps to a report id. Deferred to a post-frame callback since it's
  // triggered by a Provider rebuild mid-build, not safe to setState from directly.
  void _consumeJump(AppState appState) {
    final target = appState.jumpToReportId;
    if (target == null) return;
    final idx = _reports.indexWhere((r) => r['id'] == target);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      appState.jumpToReportId = null;
      if (idx >= 0) setState(() => _reportIndex = idx);
    });
  }

  @override
  Widget build(BuildContext context) {
    _consumeJump(context.watch<AppState>());
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_reports.isEmpty) {
      return Stack(children: [
        const Center(child: Text('No reports yet. Tap + to upload a blood report PDF.')),
        _fab(),
      ]);
    }

    final report = _currentReport!;
    return Stack(children: [
      Column(children: [
        if (_status != null) Padding(padding: const EdgeInsets.all(8), child: Text(_status!)),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            IconButton(icon: const Icon(Icons.chevron_left), onPressed: _reportIndex == 0 ? null : () => _goToPage(-1)),
            Column(children: [
              Text(report['date'] as String, style: const TextStyle(fontWeight: FontWeight.bold)),
              Text(_relativeLabel(report['date'] as String), style: const TextStyle(fontSize: 12, color: Colors.grey)),
            ]),
            IconButton(icon: const Icon(Icons.chevron_right), onPressed: _reportIndex == _reports.length - 1 ? null : () => _goToPage(1)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SegmentedButton<int>(
            segments: const [ButtonSegment(value: 0, label: Text('Extracted')), ButtonSegment(value: 1, label: Text('Raw'))],
            selected: {_subTab},
            onSelectionChanged: (s) => setState(() => _subTab = s.first),
          ),
        ),
        Expanded(
          child: IndexedStack(index: _subTab, children: [
            _extractedTable(report),
            _RawPdfPane(filePath: report['file_path'] as String),
          ]),
        ),
      ]),
      _fab(),
    ]);
  }

  Widget _extractedTable(Map<String, Object?> report) {
    final reportId = report['id'] as int;
    return ListView(padding: const EdgeInsets.only(bottom: 96), children: [
      for (final row in _groupedRows)
        if (row.$1 != null)
          Container(
            width: double.infinity,
            color: kBg,
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 6),
            child: Text(row.$1!, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, letterSpacing: 0.5, color: kMuted)),
          )
        else
          Column(children: [
            _MarkerRow(
              canonical: row.$2!,
              cell: _valuesByCanonical[row.$2]?[reportId],
              reportId: reportId,
              profileId: widget.profileId!,
              onSaved: _refresh,
            ),
            const Divider(height: 1, indent: 16),
          ]),
    ]);
  }

  Widget _fab() {
    return Positioned(
      right: 16,
      bottom: 16,
      child: FloatingActionButton(
        onPressed: () => showModalBottomSheet(
          context: context,
          builder: (context) => SafeArea(
            child: Wrap(children: [
              ListTile(leading: const Icon(Icons.upload_file), title: const Text('Upload report'), onTap: () { Navigator.pop(context); _pickAndUpload(); }),
              ListTile(leading: const Icon(Icons.visibility), title: const Text('View raw PDF'), onTap: () { Navigator.pop(context); setState(() => _subTab = 1); }),
            ]),
          ),
        ),
        child: const Icon(Icons.add),
      ),
    );
  }

  String _bytesToBase64(List<int> bytes) => base64Encode(bytes);
}

class _MarkerRow extends StatelessWidget {
  final String canonical;
  final Map<String, Object?>? cell;
  final int reportId;
  final int profileId;
  final VoidCallback onSaved;
  const _MarkerRow({required this.canonical, required this.cell, required this.reportId, required this.profileId, required this.onSaved});

  @override
  Widget build(BuildContext context) {
    // A classic ListTile — built-in tap ripple + a trailing chevron — reads
    // as clickable far more clearly than a plain Row with an icon tacked on.
    return ListTile(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => MarkerDetailScreen(profileId: profileId, canonical: canonical))),
      title: Text(canonical, overflow: TextOverflow.ellipsis),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        ValueCell(canonical: canonical, reportId: reportId, value: cell?['value'] as double?, unit: cell?['unit'] as String?, onSaved: onSaved),
        const SizedBox(width: 4),
        const Icon(Icons.chevron_right, size: 18, color: kMuted),
      ]),
    );
  }
}

class _RawPdfPane extends StatefulWidget {
  final String filePath;
  const _RawPdfPane({required this.filePath});

  @override
  State<_RawPdfPane> createState() => _RawPdfPaneState();
}

class _RawPdfPaneState extends State<_RawPdfPane> {
  // Computed once (not inline in build()) so its identity stays stable
  // across ReportTab rebuilds — FutureBuilder treats a new Future instance
  // as "the future changed" and resets to loading, which was tearing down
  // and rebuilding PDFView (losing scroll/zoom) on every unrelated setState
  // in the parent, not just on an actual report switch.
  late Future<String> _pathFuture = _resolve(widget.filePath);

  Future<String> _resolve(String filePath) => ReportFiles.absolutePath(filePath).then((p) async => File(p).existsSync() ? p : throw 'missing');

  @override
  void didUpdateWidget(covariant _RawPdfPane old) {
    super.didUpdateWidget(old);
    if (old.filePath != widget.filePath) _pathFuture = _resolve(widget.filePath);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<String>(
      future: _pathFuture,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        if (snap.hasError) return const Center(child: Text("Couldn't load this report's original PDF."));
        return PDFView(filePath: snap.data!, enableSwipe: true, swipeHorizontal: false, autoSpacing: true, pageFling: true);
      },
    );
  }
}
