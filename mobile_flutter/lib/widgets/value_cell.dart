// Port of ValueCell.svelte — one report's value+unit for one marker, with
// the same commit/unit-switch-validate flow as db.js's upsertMarker/updateMarkerUnit.
// Unit is surfaced by the caller (as a subtitle next to the marker name) —
// this widget only renders the numeric field, but keeps owning the unit
// state/validation since it's what talks to the DB.
import 'package:flutter/material.dart';
import '../services/db.dart';
import '../services/parser_config.dart';
import '../theme.dart';

class ValueCell extends StatefulWidget {
  final String canonical;
  final int reportId;
  final double? value;
  final String? unit;
  final VoidCallback onSaved;
  final ValueChanged<String>? onUnitChanged;
  const ValueCell({super.key, required this.canonical, required this.reportId, required this.value, required this.unit, required this.onSaved, this.onUnitChanged});

  @override
  State<ValueCell> createState() => ValueCellState();
}

class ValueCellState extends State<ValueCell> {
  late final _ctrl = TextEditingController(text: widget.value?.toString() ?? '');
  late String _unit = widget.unit ?? '';

  @override
  void didUpdateWidget(covariant ValueCell old) {
    super.didUpdateWidget(old);
    if (old.reportId != widget.reportId) {
      _ctrl.text = widget.value?.toString() ?? '';
      _unit = widget.unit ?? '';
    }
  }

  Future<void> _commit(String text) async {
    final v = double.tryParse(text);
    if (v == null) return;
    await Db.instance.upsertMarker(widget.reportId, widget.canonical, v, _unit.isEmpty ? null : _unit);
    widget.onSaved();
  }

  Future<void> _onUnitChange(String newUnit) async {
    final v = double.tryParse(_ctrl.text);
    if (v == null) {
      setState(() => _unit = newUnit);
      widget.onUnitChanged?.call(_unit);
      return;
    }
    final (saved, lo, hi) = await Db.instance.updateMarkerUnit(widget.reportId, widget.canonical, newUnit);
    if (saved) {
      setState(() => _unit = newUnit);
      widget.onUnitChanged?.call(_unit);
      widget.onSaved();
    } else if (mounted) {
      final msg = lo != null && hi != null
          ? 'Value must be between $lo and $hi $newUnit to switch units — not saved.'
          : "Couldn't convert to $newUnit — not saved.";
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  // DropdownButton (confirmed via bisection — see git history) freezes the
  // whole Report tab's list mid-scroll on this device: its own overlay/route
  // machinery doesn't play well with dozens of instances being created and
  // disposed as ListView.builder recycles rows. A bottom sheet gives the
  // same "tap to pick a unit" UX without that widget at all.
  Future<void> pickUnit() async {
    final options = ParserConfig.instance.unitsFor(widget.canonical);
    if (options.length <= 1) return;
    final chosen = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Wrap(children: [
          for (final o in options) ListTile(title: Text(o.unit), selected: o.unit == _unit, onTap: () => Navigator.pop(context, o.unit)),
        ]),
      ),
    );
    if (chosen != null && chosen != _unit) await _onUnitChange(chosen);
  }

  bool get _outOfRange {
    final v = double.tryParse(_ctrl.text);
    if (v == null) return false;
    return ParserConfig.instance.isOutOfRange(widget.canonical, v, _unit);
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 70,
      child: TextField(
        controller: _ctrl,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        textAlign: TextAlign.right,
        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: _outOfRange ? kAccentDim : kText),
        decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(vertical: 8, horizontal: 6)),
        onSubmitted: _commit,
        onTapOutside: (_) => _commit(_ctrl.text),
      ),
    );
  }
}
