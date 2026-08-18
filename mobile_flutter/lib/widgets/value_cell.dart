// Port of ValueCell.svelte — one report's value+unit for one marker, with
// the same commit/unit-switch-validate flow as db.js's upsertMarker/updateMarkerUnit.
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
  const ValueCell({super.key, required this.canonical, required this.reportId, required this.value, required this.unit, required this.onSaved});

  @override
  State<ValueCell> createState() => _ValueCellState();
}

class _ValueCellState extends State<ValueCell> {
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
      return;
    }
    final (saved, lo, hi) = await Db.instance.updateMarkerUnit(widget.reportId, widget.canonical, newUnit);
    if (saved) {
      setState(() => _unit = newUnit);
      widget.onSaved();
    } else if (mounted) {
      final msg = lo != null && hi != null
          ? 'Value must be between $lo and $hi $newUnit to switch units — not saved.'
          : "Couldn't convert to $newUnit — not saved.";
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  bool get _outOfRange {
    final v = double.tryParse(_ctrl.text);
    if (v == null) return false;
    return ParserConfig.instance.isOutOfRange(widget.canonical, v, _unit);
  }

  @override
  Widget build(BuildContext context) {
    final options = ParserConfig.instance.unitsFor(widget.canonical);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      SizedBox(
        width: 64,
        child: TextField(
          controller: _ctrl,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 13, color: _outOfRange ? kAccentDim : kText),
          decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(vertical: 8, horizontal: 4)),
          onSubmitted: _commit,
          onTapOutside: (_) => _commit(_ctrl.text),
        ),
      ),
      const SizedBox(width: 4),
      if (options.length > 1)
        DropdownButton<String>(
          value: _unit.isEmpty ? options.first.unit : _unit,
          underline: const SizedBox(),
          style: const TextStyle(fontSize: 11, color: kMutedLt),
          items: [for (final o in options) DropdownMenuItem(value: o.unit, child: Text(o.unit))],
          onChanged: (v) => v == null ? null : _onUnitChange(v),
        )
      else if (_unit.isNotEmpty)
        Text(_unit, style: const TextStyle(fontSize: 11, color: kMutedLt), overflow: TextOverflow.ellipsis),
    ]);
  }
}
