// Port of TimelineTab.svelte (Phase 2).
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/db.dart';
import '../services/parser_bridge.dart';
import '../services/parser_config.dart';
import '../services/report_files.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../utils/date_format.dart';

class TimelineTab extends StatefulWidget {
  final int? profileId;
  const TimelineTab({super.key, required this.profileId});

  @override
  State<TimelineTab> createState() => _TimelineTabState();
}

class _TimelineTabState extends State<TimelineTab> {
  bool _loading = true;
  List<Map<String, Object?>> _feed = [];
  List<String> _knownMarkers = [];
  String? _activeMarker;
  List<Map<String, Object?>> _markerTimeline = [];
  final _searchCtrl = TextEditingController();
  final _expandedReportIds = <int>{};
  final _reportDetailCache = <int, List<Map<String, Object?>>>{};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant TimelineTab old) {
    super.didUpdateWidget(old);
    if (old.profileId != widget.profileId) _load();
  }

  Future<void> _load() async {
    if (widget.profileId == null) return;
    setState(() => _loading = true);
    final feed = await Db.instance.getTimelineFeed(widget.profileId!);
    final known = await Db.instance.listKnownMarkers(widget.profileId!);
    setState(() {
      _feed = feed;
      _knownMarkers = known;
      _loading = false;
    });
  }

  Future<void> _pickMarker(String marker) async {
    final timeline = await Db.instance.getMarkerTimeline(
      widget.profileId!,
      marker,
    );
    setState(() {
      _activeMarker = marker;
      _searchCtrl.text = marker;
      _markerTimeline = timeline;
    });
  }

  void _clearSearch() {
    setState(() {
      _activeMarker = null;
      _searchCtrl.clear();
      _markerTimeline = [];
    });
  }

  Future<void> _toggleExpand(int reportId) async {
    if (_expandedReportIds.contains(reportId)) {
      setState(() => _expandedReportIds.remove(reportId));
      return;
    }
    if (!_reportDetailCache.containsKey(reportId)) {
      final markers = await Db.instance.getReportMarkers(reportId);
      final config = ParserConfig.instance;
      _reportDetailCache[reportId] = markers
          .where(
            (m) => config.isOutOfRange(
              m['canonical'] as String,
              m['value'] as double?,
              m['unit'] as String?,
            ),
          )
          .toList();
    }
    setState(() => _expandedReportIds.add(reportId));
  }

  Future<void> _openNoteSheet({Map<String, Object?>? note}) async {
    final ctrl = TextEditingController(text: note?['text'] as String? ?? '');
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
          left: 16,
          right: 16,
          top: 16,
        ),
        child: SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                note == null ? 'Add note' : 'Edit note',
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: ctrl,
                maxLines: 4,
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: 'e.g. Took a Vitamin D shot today',
                ),
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('Cancel'),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('Save'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
    if (saved != true || ctrl.text.trim().isEmpty) return;

    final parsed = await ParserBridge.instance.parseJournalText(
      ctrl.text.trim(),
      DateTime.now(),
    );
    if (note == null) {
      await Db.instance.addJournalEntry(
        widget.profileId!,
        parsed.dateIso,
        ctrl.text.trim(),
        parsed.canonicals,
      );
    } else {
      await Db.instance.updateJournalEntry(
        note['id'] as int,
        parsed.dateIso,
        ctrl.text.trim(),
        parsed.canonicals,
      );
    }
    await _load();
    if (_activeMarker != null) await _pickMarker(_activeMarker!);
  }

  Future<void> _deleteNote(int id) async {
    if (!await _confirm('Delete this note?')) return;
    await Db.instance.deleteJournalEntry(id);
    await _load();
    if (_activeMarker != null) await _pickMarker(_activeMarker!);
  }

  Future<void> _deleteReport(Map<String, Object?> item) async {
    if (!await _confirm(
      'Delete report (${item['date']})? This removes it and all its values.',
    ))
      return;
    await Db.instance.deleteReport(item['id'] as int);
    await ReportFiles.delete(item['file_path'] as String);
    await _load();
  }

  Future<bool> _confirm(String message) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final suggestions =
        _searchCtrl.text.trim().isNotEmpty && _activeMarker == null
        ? _knownMarkers
              .where(
                (m) => m.toLowerCase().contains(
                  _searchCtrl.text.trim().toLowerCase(),
                ),
              )
              .take(8)
              .toList()
        : <String>[];

    return Scaffold(
      // The suggestion dropdown is a Stack sibling of the whole body, not
      // nested inside the search field's own Stack — Column children paint
      // in order, so a dropdown confined to the search row's Stack would
      // paint *before* (i.e. behind) the feed list below it wherever the
      // two visually overlap. Being the last child of this outer Stack
      // guarantees it paints on top regardless of where it's positioned.
      body: Stack(
        children: [
          Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: TextField(
                  controller: _searchCtrl,
                  onChanged: (text) => setState(() {
                    // Editing the box after a marker is picked drops back to
                    // suggestion mode, same as the Svelte build — otherwise the
                    // marker-timeline view stays frozen with mismatched text.
                    if (_activeMarker != null && text != _activeMarker) {
                      _activeMarker = null;
                      _markerTimeline = [];
                    }
                  }),
                  decoration: InputDecoration(
                    hintText: 'Search a marker (e.g. Vitamin D)…',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _activeMarker != null
                        ? IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: _clearSearch,
                          )
                        : null,
                  ),
                ),
              ),
              Expanded(
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : _activeMarker != null
                    ? _markerTimelineView()
                    : _defaultFeed(),
              ),
            ],
          ),
          if (suggestions.isNotEmpty)
            Positioned(
              top: 68,
              left: 16,
              right: 16,
              child: Material(
                elevation: 4,
                borderRadius: BorderRadius.circular(12),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final s in suggestions)
                      ListTile(
                        dense: true,
                        title: Text(s),
                        onTap: () => _pickMarker(s),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _openNoteSheet(),
        child: const Icon(Icons.edit_note),
      ),
    );
  }

  Widget _markerTimelineView() {
    if (_markerTimeline.isEmpty) {
      return const Center(
        child: Text('No test results or notes for this marker yet.'),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
      itemCount: _markerTimeline.length,
      itemBuilder: (context, i) {
        final entry = _markerTimeline[i];
        final isValue = entry['kind'] == 'value';
        final config = ParserConfig.instance;
        final outOfRange =
            isValue &&
            config.isOutOfRange(
              _activeMarker!,
              entry['value'] as double?,
              entry['unit'] as String?,
            );
        final refRange = isValue
            ? config.refRangeForUnit(
                _activeMarker!,
                entry['unit'] as String? ?? '',
              )
            : null;
        return Card(
          child: ListTile(
            leading: Icon(
              isValue ? Icons.science_outlined : Icons.edit_note,
              size: 20,
              color: kMuted,
            ),
            title: isValue
                ? Text(
                    '${entry['value']} ${entry['unit'] ?? ''}',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: outOfRange ? kAccentDim : kText,
                    ),
                  )
                : Text(
                    entry['text'] as String,
                    style: const TextStyle(fontSize: 14.5),
                  ),
            subtitle: Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Text(
                refRange != null
                    ? '${formatDateIso(entry['date'] as String)} · ref $refRange'
                    : formatDateIso(entry['date'] as String),
                style: const TextStyle(fontSize: 12, color: kMutedLt),
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _defaultFeed() {
    if (_feed.isEmpty)
      return const Center(
        child: Text('Nothing yet — upload a report or add a journal note.'),
      );
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
      itemCount: _feed.length,
      itemBuilder: (context, i) {
        final item = _feed[i];
        if (item['kind'] == 'report') return _reportCard(item);
        return _noteCard(item);
      },
    );
  }

  Widget _reportCard(Map<String, Object?> item) {
    final id = item['id'] as int;
    final expanded = _expandedReportIds.contains(id);
    final refCount = item['ref_count'] as int;
    final details = _reportDetailCache[id] ?? [];
    return Card(
      child: InkWell(
        onTap: () => _toggleExpand(id),
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          formatDateIso(item['date'] as String),
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          'Report uploaded — ${item['marker_count']} markers',
                          style: const TextStyle(
                            fontSize: 12.5,
                            color: kMutedLt,
                          ),
                        ),
                        if (refCount > 0) ...[
                          const SizedBox(height: 2),
                          Text(
                            '$refCount out of range',
                            style: const TextStyle(
                              fontSize: 12.5,
                              color: kAccentDim,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(
                          Icons.delete_outline,
                          size: 20,
                          color: kAccentDim,
                        ),
                        visualDensity: VisualDensity.compact,
                        onPressed: () => _deleteReport(item),
                      ),
                      IconButton(
                        icon: Icon(
                          expanded ? Icons.expand_less : Icons.expand_more,
                          size: 20,
                          color: kMuted,
                        ),
                        visualDensity: VisualDensity.compact,
                        onPressed: () => _toggleExpand(id),
                      ),
                    ],
                  ),
                ],
              ),
              if (expanded) ...[
                const Divider(height: 20),
                details.isEmpty
                    ? const Text(
                        'All markers within range.',
                        style: TextStyle(color: kOk, fontSize: 13),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final m in details)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 2),
                              child: Text.rich(
                                TextSpan(
                                  children: [
                                    TextSpan(
                                      text: '${m['canonical']}  ',
                                      style: const TextStyle(
                                        fontSize: 13,
                                        color: kText,
                                      ),
                                    ),
                                    TextSpan(
                                      text: '${m['value']} ${m['unit'] ?? ''}',
                                      style: const TextStyle(
                                        fontSize: 13,
                                        color: kAccentDim,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                        ],
                      ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: () => context.read<AppState>().jumpToReport(id),
                    icon: const Icon(Icons.arrow_forward, size: 16),
                    label: const Text('View full report'),
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _noteCard(Map<String, Object?> item) {
    final dt = DateTime.parse(item['date'] as String).toLocal();
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
        leading: const Padding(
          padding: EdgeInsets.only(top: 2),
          child: Icon(Icons.edit_note, size: 20, color: kMuted),
        ),
        title: Text(
          item['text'] as String,
          style: const TextStyle(fontSize: 14.5),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Text(
            formatDateTime(dt),
            style: const TextStyle(fontSize: 12, color: kMutedLt),
          ),
        ),
        onTap: () => _openNoteSheet(note: item),
        trailing: IconButton(
          icon: const Icon(Icons.delete_outline, size: 20, color: kAccentDim),
          onPressed: () => _deleteNote(item['id'] as int),
        ),
      ),
    );
  }
}
