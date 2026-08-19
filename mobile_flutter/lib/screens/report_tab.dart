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
import '../utils/date_format.dart';
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
  // flutter_pdfview's PDFView is a native platform view — IndexedStack
  // mounts every child immediately, so without this it was created (and
  // kept alive, hidden) the moment the Report tab first loaded, before Raw
  // was ever visited. A hidden-but-mounted PlatformView is a known-bad
  // pattern that can corrupt the whole FlutterView's compositing; lazy-
  // mounting on first visit (same as the Svelte build's pdfPaneVisited)
  // avoids ever creating it until it's actually needed.
  bool _rawPaneVisited = false;
  String? _status;

  // Search bar lives inside the Extracted sub-tab's own widget, not in a
  // modal — IndexedStack already keeps that whole subtree mounted (just
  // hidden) while Raw is showing, so the query survives switching to Raw
  // and back for free, no special persistence plumbing needed.
  final _searchCtrl = TextEditingController();

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

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
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

  // Every marker the parser knows about, plus any custom (unrecognized)
  // marker this profile has already registered — shown as a row
  // regardless of whether it has a value for the currently-viewed report,
  // so "the marker exists but wasn't extracted from this PDF" is just a
  // blank, tappable row rather than a separate add-flow.
  List<(String?, String?)> get _groupedRows {
    final present = ParserConfig.instance.refRanges.keys.toSet().union(_valuesByCanonical.keys.toSet());
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
          final result = await _parseWithPasswordRetry(bytes, file.name);
          if (result == null) continue; // user cancelled the password prompt
          final (parsed, password) = result;

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
          lastUploadedId = await Db.instance.addReport(
            widget.profileId!, reportDate, file.name, path, parsed.extracted, parsed.unvaluedCanonicals,
            password: password,
          );
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
  // The resolved password (null for an unprotected PDF) is returned
  // alongside the parse result so the caller can store it — needed to
  // reopen the Raw PDF view (and, later, reparseAll) without re-prompting.
  Future<(ParsePdfResult, String?)?> _parseWithPasswordRetry(List<int> bytes, String fileName) async {
    String? password;
    final base64 = _bytesToBase64(bytes);
    for (;;) {
      try {
        final result = await ParserBridge.instance.parsePdf(base64, password: password);
        return (result, password);
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

  // Markers never seen in ANY report for this profile — the ones actually
  // worth offering an "add new" flow for. A canonical that already appears
  // in some other report (but not this one) already shows up as a blank,
  // fillable row in the filtered list below, same as a regular unvalued
  // marker; no separate add-flow needed for that case.
  // Only reachable when the search query matched nothing in _groupedRows
  // (every known marker, so this really is unrecognized). Registers the
  // typed name verbatim — it can't be renamed afterward, and future PDF
  // imports still won't extract it automatically, since parser-core.mjs's
  // keyword table has no entry for it — but it becomes a normal row with
  // full value/unit-edit and chart support from here on.
  Future<void> _confirmAddCustomMarker(String name) async {
    final reportId = _currentReport?['id'] as int?;
    if (reportId == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add unrecognized marker?'),
        content: Text(
          '"$name" isn\'t a marker Track Blood knows how to extract automatically. '
          "It'll be added to your list so you can enter its value by hand and see it "
          "on a chart, but future report imports won't fill it in for you, and its "
          'name can\'t be changed later.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Add')),
        ],
      ),
    );
    if (confirmed != true) return;
    await Db.instance.registerCustomMarker(reportId, name);
    setState(() => _searchCtrl.clear());
    await _refresh();
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
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (_reports.isEmpty) {
      return Scaffold(
        body: const Center(child: Text('No reports yet. Tap + to upload a blood report PDF.')),
        floatingActionButton: _fabButton(),
      );
    }

    final report = _currentReport!;
    // A proper Scaffold, not a bare Stack — TimelineTab/ReminderTab (which
    // scroll fine) both use one; this was the one structural difference
    // between them and this tab, and matches what actually fixed the
    // scroll-freeze bug (see the git history for the full investigation).
    return Scaffold(
      floatingActionButton: _fabButton(),
      body: Column(children: [
        if (_status != null) Padding(padding: const EdgeInsets.all(8), child: Text(_status!)),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            IconButton(icon: const Icon(Icons.chevron_left), onPressed: _reportIndex == 0 ? null : () => _goToPage(-1)),
            Column(children: [
              Text(formatDateIso(report['date'] as String), style: const TextStyle(fontWeight: FontWeight.bold)),
              Text(relativeLabel(DateTime.parse(report['date'] as String)), style: const TextStyle(fontSize: 12, color: Colors.grey)),
            ]),
            IconButton(icon: const Icon(Icons.chevron_right), onPressed: _reportIndex == _reports.length - 1 ? null : () => _goToPage(1)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SegmentedButton<int>(
            segments: const [ButtonSegment(value: 0, label: Text('Extracted')), ButtonSegment(value: 1, label: Text('Raw'))],
            selected: {_subTab},
            onSelectionChanged: (s) => setState(() {
              _subTab = s.first;
              if (_subTab == 1) _rawPaneVisited = true;
            }),
          ),
        ),
        Expanded(
          child: IndexedStack(index: _subTab, children: [
            _extractedTable(report),
            if (_rawPaneVisited)
              _RawPdfPane(filePath: report['file_path'] as String, password: report['password'] as String?)
            else
              const SizedBox.shrink(),
          ]),
        ),
      ]),
    );
  }

  // Search filters the profile-wide marker union shown below — starts
  // matching from the first character (unlike Timeline's 3-char minimum),
  // since this list (every known marker, now that _groupedRows is
  // profile-union ∪ ParserConfig's full canonical set) is at most a couple
  // hundred entries, not a free-text corpus. If a query matches nothing at
  // all, that's the signal the marker isn't one Track Blood recognizes —
  // the only remaining option is registering it as a custom marker.
  // ListView.builder, not a plain ListView(children: [...]) for the
  // unfiltered (no search query) case — the full marker list can run into
  // the hundreds, and building that many ValueCells (each owning a
  // TextEditingController) eagerly blocked the main thread badly enough to
  // freeze the frame pipeline on scroll. A filtered result set is small
  // enough to build eagerly without that risk.
  Widget _extractedTable(Map<String, Object?> report) {
    final reportId = report['id'] as int;
    final query = _searchCtrl.text.trim();
    final rows = query.isEmpty
        ? _groupedRows
        : _groupedRows.where((r) => r.$2 != null && r.$2!.toLowerCase().contains(query.toLowerCase())).toList();

    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
        child: TextField(
          controller: _searchCtrl,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            hintText: 'Search a marker…',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: query.isNotEmpty ? IconButton(icon: const Icon(Icons.close), onPressed: () => setState(_searchCtrl.clear)) : null,
          ),
        ),
      ),
      Expanded(
        child: rows.isEmpty
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 32),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text('No marker matches "$query".', style: const TextStyle(color: kMuted), textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      icon: const Icon(Icons.add),
                      label: const Text('Add missing marker'),
                      onPressed: () => _confirmAddCustomMarker(query),
                    ),
                  ]),
                ),
              )
            : ListView.builder(
                padding: const EdgeInsets.only(bottom: 96),
                itemCount: rows.length,
                itemBuilder: (context, i) {
                  final row = rows[i];
                  if (row.$1 != null) {
                    return Container(
                      width: double.infinity,
                      color: kBg,
                      padding: const EdgeInsets.fromLTRB(16, 18, 16, 6),
                      child: Text(row.$1!, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, letterSpacing: 0.5, color: kAccent)),
                    );
                  }
                  return Column(children: [
                    _MarkerRow(
                      canonical: row.$2!,
                      cell: _valuesByCanonical[row.$2]?[reportId],
                      reportId: reportId,
                      profileId: widget.profileId!,
                      onSaved: _refresh,
                    ),
                    const Divider(height: 1, indent: 16),
                  ]);
                },
              ),
      ),
    ]);
  }

  Widget _fabButton() {
    return FloatingActionButton(onPressed: _pickAndUpload, child: const Icon(Icons.add));
  }

  String _bytesToBase64(List<int> bytes) => base64Encode(bytes);
}

class _MarkerRow extends StatefulWidget {
  final String canonical;
  final Map<String, Object?>? cell;
  final int reportId;
  final int profileId;
  final VoidCallback onSaved;
  const _MarkerRow({required this.canonical, required this.cell, required this.reportId, required this.profileId, required this.onSaved});

  @override
  State<_MarkerRow> createState() => _MarkerRowState();
}

class _MarkerRowState extends State<_MarkerRow> {
  final _valueKey = GlobalKey<ValueCellState>();
  late String _unit = widget.cell?['unit'] as String? ?? '';

  @override
  void didUpdateWidget(covariant _MarkerRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.reportId != widget.reportId) _unit = widget.cell?['unit'] as String? ?? '';
  }

  @override
  Widget build(BuildContext context) {
    final options = ParserConfig.instance.unitsFor(widget.canonical);
    final multiUnit = options.length > 1;
    // A classic ListTile — built-in tap ripple + a trailing chevron — reads
    // as clickable far more clearly than a plain Row with an icon tacked on.
    // Unit lives as a subtitle under the marker name (not next to the value)
    // so the value column stays purely numeric and tight.
    return ListTile(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => MarkerDetailScreen(profileId: widget.profileId, canonical: widget.canonical))),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      minVerticalPadding: 12,
      title: Text(widget.canonical, overflow: TextOverflow.ellipsis),
      subtitle: _unit.isEmpty && !multiUnit
          ? null
          : Padding(
              padding: const EdgeInsets.only(top: 2),
              child: multiUnit
                  ? InkWell(
                      onTap: () => _valueKey.currentState?.pickUnit(),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        Text(_unit.isEmpty ? options.first.unit : _unit, style: const TextStyle(fontSize: 12, color: kMutedLt)),
                        const Icon(Icons.arrow_drop_down, size: 16, color: kMutedLt),
                      ]),
                    )
                  : Text(_unit, style: const TextStyle(fontSize: 12, color: kMutedLt)),
            ),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        ValueCell(
          key: _valueKey,
          canonical: widget.canonical,
          reportId: widget.reportId,
          value: widget.cell?['value'] as double?,
          unit: widget.cell?['unit'] as String?,
          onSaved: widget.onSaved,
          onUnitChanged: (u) => setState(() => _unit = u),
        ),
        const SizedBox(width: 4),
        const Icon(Icons.chevron_right, size: 18, color: kMuted),
      ]),
    );
  }
}

class _RawPdfPane extends StatefulWidget {
  final String filePath;
  final String? password;
  const _RawPdfPane({required this.filePath, this.password});

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
        return PDFView(
          filePath: snap.data!,
          password: widget.password,
          enableSwipe: true,
          swipeHorizontal: false,
          autoSpacing: true,
          pageFling: true,
        );
      },
    );
  }
}
