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

// A committed search term: canonical non-null means it was picked from the
// marker suggestion dropdown, null means it was just typed and committed on
// a word boundary (space or keyboard submit) — see _TimelineTabState's
// _commitMarkerChip/_commitTypedWord.
class _SearchChip {
  final String label;
  final String? canonical;
  const _SearchChip(this.label, {this.canonical});
}

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
  final List<_SearchChip> _chips = [];
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

  void _commitMarkerChip(String canonical) {
    setState(() {
      _chips.add(_SearchChip(canonical, canonical: canonical));
      _searchCtrl.clear();
    });
  }

  // Called on every keystroke, so the suggestion dropdown (computed straight
  // off _searchCtrl.text in build()) stays live either way. If the field now
  // ends with a space (a word boundary just typed), the word before it also
  // becomes its own free-text chip and the field resets for the next word.
  // Also called from onSubmitted (keyboard search/done key) with a synthetic
  // trailing space so the last word isn't stranded if the user never
  // actually types one.
  void _onSearchChanged(String text) {
    final word = text.endsWith(' ') ? text.trim() : null;
    setState(() {
      if (word != null && word.isNotEmpty) {
        _chips.add(_SearchChip(word));
        _searchCtrl.clear();
      }
    });
  }

  void _removeChip(_SearchChip chip) => setState(() => _chips.remove(chip));

  void _clearSearch() => setState(() {
    _chips.clear();
    _searchCtrl.clear();
  });

  List<_SearchChip> get _matchedMarkerChips => _chips.where((c) => c.canonical != null).toList();

  bool _matches(Map<String, Object?> item) {
    if (_chips.isEmpty) return true;
    if (item['kind'] == 'report') {
      if (_chips.any((c) => c.canonical == null)) return false; // reports have no free text to match
      final canonicals = item['canonicals'] as Set<String>;
      return _chips.every((c) => canonicals.contains(c.canonical));
    }
    // Notes: every chip (marker or free-text) just needs to appear in the
    // note's own text — see getTimelineFeed's comment on why marker chips
    // don't use journal_marker_index here.
    final text = (item['text'] as String).toLowerCase();
    return _chips.every((c) => text.contains(c.label.toLowerCase()));
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
      );
    } else {
      await Db.instance.updateJournalEntry(
        note['id'] as int,
        parsed.dateIso,
        ctrl.text.trim(),
      );
    }
    await _load();
  }

  Future<void> _deleteNote(int id) async {
    if (!await _confirm('Delete this note?')) return;
    await Db.instance.deleteJournalEntry(id);
    await _load();
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
    final suggestions = _searchCtrl.text.trim().isNotEmpty
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
                child: Container(
                  decoration: BoxDecoration(color: kBg, borderRadius: BorderRadius.circular(10), border: Border.all(color: kBorder)),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  child: Row(
                    children: [
                      const Icon(Icons.search, size: 20, color: kMuted),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Wrap(
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: 6,
                          runSpacing: 6,
                          children: [
                            for (final chip in _chips)
                              Chip(
                                label: Text(chip.label),
                                labelStyle: const TextStyle(color: kAccentDim, fontWeight: FontWeight.w600, fontSize: 13),
                                avatar: chip.canonical != null ? const Icon(Icons.science_outlined, size: 15, color: kAccentDim) : null,
                                backgroundColor: kAccentSoft,
                                side: BorderSide.none,
                                deleteIcon: const Icon(Icons.close, size: 15, color: kAccentDim),
                                onDeleted: () => _removeChip(chip),
                                visualDensity: VisualDensity.compact,
                                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                padding: const EdgeInsets.symmetric(horizontal: 6),
                              ),
                            IntrinsicWidth(
                              child: TextField(
                                controller: _searchCtrl,
                                onChanged: _onSearchChanged,
                                onSubmitted: (text) => _onSearchChanged('$text '),
                                decoration: InputDecoration(
                                  isCollapsed: true,
                                  border: InputBorder.none,
                                  filled: false,
                                  hintText: _chips.isEmpty ? 'Search markers or notes…' : null,
                                  contentPadding: EdgeInsets.zero,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (_chips.isNotEmpty || _searchCtrl.text.isNotEmpty)
                        InkWell(
                          onTap: _clearSearch,
                          child: const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.close, size: 18, color: kMuted)),
                        ),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
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
                        onTap: () => _commitMarkerChip(s),
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

  Widget _defaultFeed() {
    final items = _chips.isEmpty ? _feed : _feed.where(_matches).toList();
    if (items.isEmpty) {
      return Center(
        child: Text(
          _chips.isEmpty ? 'Nothing yet — upload a report or add a journal note.' : 'No matches for the current search.',
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
      itemCount: items.length,
      itemBuilder: (context, i) {
        final item = items[i];
        if (item['kind'] == 'report') return _reportCard(item);
        return _noteCard(item);
      },
    );
  }

  // One line per active marker chip, used as this report card's title in
  // place of the generic "Report — N markers" summary — showing the actual
  // value (falling back to "no value" if the marker was matched-but-unvalued
  // in this particular report — still possible since chip matching only
  // requires the canonical to be present, not valued).
  Widget _matchedMarkerTitle(Map<String, Object?> item, String canonical) {
    final markerValues = item['markerValues'] as Map<String, Object?>;
    final cell = markerValues[canonical] as Map<String, Object?>?;
    final value = cell?['value'] as double?;
    final unit = cell?['unit'] as String?;
    final config = ParserConfig.instance;
    final outOfRange = value != null && config.isOutOfRange(canonical, value, unit);
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Text.rich(
        TextSpan(children: [
          TextSpan(text: '$canonical — ', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: kText)),
          TextSpan(
            text: value != null ? '$value ${unit ?? ''}' : 'no value',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: outOfRange ? kAccentDim : kText),
          ),
        ]),
      ),
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
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        const Icon(Icons.description_outlined, size: 20, color: kMuted),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (_matchedMarkerChips.isEmpty)
                                Text.rich(
                                  TextSpan(children: [
                                    TextSpan(
                                      text: 'Report — ${item['marker_count']} markers',
                                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: kText),
                                    ),
                                    if (refCount > 0)
                                      TextSpan(
                                        text: ', $refCount out of range',
                                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: kAccentDim),
                                      ),
                                  ]),
                                )
                              else
                                // A marker chip is active — show its actual
                                // value for this report (what search was
                                // for) as the title, in place of the generic
                                // "N markers" summary.
                                for (final chip in _matchedMarkerChips) _matchedMarkerTitle(item, chip.canonical!),
                              const SizedBox(height: 3),
                              Text(
                                formatDateIso(item['date'] as String),
                                style: const TextStyle(fontSize: 12.5, color: kMutedLt),
                              ),
                            ],
                          ),
                        ),
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
        trailing: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 20, color: kAccentDim),
              visualDensity: VisualDensity.compact,
              onPressed: () => _deleteNote(item['id'] as int),
            ),
            IconButton(
              icon: const Icon(Icons.edit_outlined, size: 20, color: kMuted),
              visualDensity: VisualDensity.compact,
              onPressed: () => _openNoteSheet(note: item),
            ),
          ],
        ),
      ),
    );
  }
}
