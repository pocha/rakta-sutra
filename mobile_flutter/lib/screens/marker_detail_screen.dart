// Port of MarkerDetail.svelte — pushed via Navigator.push instead of a
// hand-rolled `screen` flag, so back-button handling and (once we're past
// this screen) the Report tab's own state survive automatically for free.
import 'package:flutter/material.dart';
import '../services/db.dart';
import '../services/parser_config.dart';
import '../theme.dart';
import '../utils/date_format.dart';
import '../widgets/marker_chart.dart';

class MarkerDetailScreen extends StatelessWidget {
  final int profileId;
  final String canonical;
  const MarkerDetailScreen({super.key, required this.profileId, required this.canonical});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(canonical)),
      body: FutureBuilder(
        future: Future.wait([Db.instance.getLatestMarkerValue(profileId, canonical), Db.instance.getMajorityUnitByCanonical(profileId)]),
        builder: (context, snap) {
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final latest = snap.data![0] as Map<String, Object?>?;
          final majorityByCanonical = snap.data![1] as Map<String, String>;
          if (latest == null) return const Center(child: Text('No recorded values for this marker yet.'));
          final value = latest['value'] as double;
          final unit = latest['unit'] as String? ?? '';
          final majorityUnit = majorityByCanonical[canonical] ?? unit;
          final refRange = ParserConfig.instance.refRangeForUnit(canonical, unit);
          final outOfRange = ParserConfig.instance.isOutOfRange(canonical, value, unit);

          return ListView(padding: const EdgeInsets.all(16), children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
                    Text('$value', style: TextStyle(fontSize: 36, fontWeight: FontWeight.w800, color: outOfRange ? kAccentDim : kText)),
                    const SizedBox(width: 8),
                    Text(unit, style: const TextStyle(fontSize: 16, color: kMuted)),
                  ]),
                  const SizedBox(height: 4),
                  Text('as of ${formatDateIso(latest['date'] as String)}', style: const TextStyle(color: kMuted, fontSize: 13)),
                  if (refRange != null) ...[
                    const Divider(height: 24),
                    Row(children: [
                      const Text('Reference range', style: TextStyle(color: kMuted, fontSize: 13)),
                      const Spacer(),
                      Text(refRange, style: const TextStyle(fontWeight: FontWeight.w600)),
                    ]),
                  ],
                ]),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 16, 16, 8),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Padding(
                    padding: EdgeInsets.only(left: 4, bottom: 8),
                    child: Text('TREND', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.6, color: kMuted)),
                  ),
                  MarkerChart(profileId: profileId, canonical: canonical, currentReportId: latest['report_id'] as int, majorityUnit: majorityUnit),
                ]),
              ),
            ),
          ]);
        },
      ),
    );
  }
}
