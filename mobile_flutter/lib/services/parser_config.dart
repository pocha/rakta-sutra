// Direct Dart port of parser-core.mjs's unit-conversion/ref-range helpers
// (lines ~130-215) — kept native rather than bridged through the hidden
// WebView because these run on every keystroke/dropdown change (see plan §1).
// Only parsePDF() and the free-text parsers stay JS (parser_bridge.dart).

class UnitOption {
  final String unit;
  final double scale;
  final bool isDefault;
  UnitOption(this.unit, this.scale, this.isDefault);
  factory UnitOption.fromJson(Map<String, dynamic> j) =>
      UnitOption(j['unit'] as String, (j['scale'] as num).toDouble(), j['default'] as bool? ?? false);
}

class MarkerGroup {
  final String label;
  final List<String> keys;
  MarkerGroup(this.label, this.keys);
  factory MarkerGroup.fromJson(Map<String, dynamic> j) =>
      MarkerGroup(j['label'] as String, (j['keys'] as List).cast<String>());
}

class RefBounds {
  final double? low;
  final double? high;
  RefBounds(this.low, this.high);
}

class ParserConfig {
  ParserConfig._(this.valueLimits, this.refRanges, this.markerGroups, this.units, this.wordMap);

  final Map<String, List<double>> valueLimits;
  final Map<String, String> refRanges;
  final List<MarkerGroup> markerGroups;
  final Map<String, List<UnitOption>> units;
  // KEYWORD -> [canonical, ...], keys pre-normalized (uppercase, no spaces)
  // — same shape parser-core.mjs matches PDF text tokens against. Reused
  // here for marker search: a query normalized the same way and checked as
  // a substring of each key finds markers by any keyword the parser would
  // recognize, not just by their canonical display name.
  final Map<String, List<String>> wordMap;

  static ParserConfig? _instance;
  static ParserConfig get instance {
    final i = _instance;
    if (i == null) throw StateError('ParserConfig.reconfigure() not called yet');
    return i;
  }

  // Re-points the singleton at freshly-synced config+wordmap data (see
  // ParserConfigSync) — always overwrites, since this is called specifically
  // when newer data than whatever's currently loaded has shown up.
  static void reconfigure(Map<String, dynamic> raw, Map<String, dynamic> wordMapRaw) {
    _instance = ParserConfig._(
      (raw['valueLimits'] as Map<String, dynamic>).map((k, v) => MapEntry(k, (v as List).map((n) => (n as num).toDouble()).toList())),
      (raw['refRanges'] as Map<String, dynamic>).map((k, v) => MapEntry(k, v as String)),
      (raw['markerGroups'] as List).map((g) => MarkerGroup.fromJson(g as Map<String, dynamic>)).toList(),
      (raw['units'] as Map<String, dynamic>).map((k, v) => MapEntry(k, (v as List).map((u) => UnitOption.fromJson(u as Map<String, dynamic>)).toList())),
      wordMapRaw.map((k, v) => MapEntry(k, (v as List).cast<String>())),
    );
  }

  List<UnitOption> unitsFor(String canonical) => units[canonical] ?? const [];

  // Known canonicals whose name a normalized [query] appears in as a
  // keyword — e.g. "baso" matches "ABSOLUTEBASOPHIL" -> Basophils Absolute.
  Set<String> markersMatchingKeyword(String query) {
    final norm = query.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
    if (norm.isEmpty) return const {};
    final result = <String>{};
    for (final entry in wordMap.entries) {
      if (entry.key.contains(norm)) result.addAll(entry.value);
    }
    return result;
  }

  double? markerUnitScale(String canonical, String? unitsText) {
    if (unitsText == null || unitsText.isEmpty) return null;
    final list = units[canonical];
    if (list == null) return null;
    final u = unitsText.toLowerCase();
    for (final opt in list) {
      if (u.contains(opt.unit.toLowerCase())) return opt.scale;
    }
    return null;
  }

  double convertUnit(String canonical, double value, String fromUnit, String toUnit) {
    if (fromUnit == toUnit) return value;
    final fromScale = markerUnitScale(canonical, fromUnit) ?? 1;
    final toScale = markerUnitScale(canonical, toUnit) ?? 1;
    return value * fromScale / toScale;
  }

  bool inValueRange(String canonical, double v) {
    final lim = valueLimits[canonical];
    if (lim == null) return true;
    return v >= lim[0] && v <= lim[1];
  }

  bool inValueRangeForUnit(String canonical, double value, String unit) {
    final scale = markerUnitScale(canonical, unit) ?? 1;
    return inValueRange(canonical, value * scale);
  }

  (double, double)? valueLimitsForUnit(String canonical, String unit) {
    final lim = valueLimits[canonical];
    if (lim == null) return null;
    final scale = markerUnitScale(canonical, unit) ?? 1;
    return (lim[0] / scale, lim[1] / scale);
  }

  static final _numberRe = RegExp(r'(\d+\.?\d*)');

  String _scaleRef(String ref, double scale) {
    if (scale == 1) return ref;
    return ref.replaceAllMapped(_numberRe, (m) => _formatNum(double.parse(m[1]!) * scale));
  }

  static String _formatNum(double n) => n == n.roundToDouble() ? n.toInt().toString() : n.toString();

  String? refRangeForUnit(String canonical, String unit) {
    final ref = refRanges[canonical];
    if (ref == null) return null;
    final scale = markerUnitScale(canonical, unit) ?? 1;
    if (scale == 1) return ref;
    return _scaleRef(ref, 1 / scale);
  }

  static final _rangeRe = RegExp(r'^([\d.]+)\s*[-–]\s*([\d.]+)');
  static final _ltRe = RegExp(r'^[<≤]=?\s*([\d.]+)');
  static final _gtRe = RegExp(r'^[>≥]=?\s*([\d.]+)');

  static RefBounds? parseRefRange(String? refStr) {
    if (refStr == null || refStr.isEmpty) return null;
    final s = refStr.trim();
    var m = _rangeRe.firstMatch(s);
    if (m != null) return RefBounds(double.parse(m[1]!), double.parse(m[2]!));
    m = _ltRe.firstMatch(s);
    if (m != null) return RefBounds(null, double.parse(m[1]!));
    m = _gtRe.firstMatch(s);
    if (m != null) return RefBounds(double.parse(m[1]!), null);
    return null;
  }

  bool isOutOfRange(String canonical, double? value, String? unit) {
    if (value == null) return false;
    final bounds = parseRefRange(refRangeForUnit(canonical, unit ?? ''));
    if (bounds == null) return false;
    return (bounds.low != null && value < bounds.low!) || (bounds.high != null && value > bounds.high!);
  }
}
