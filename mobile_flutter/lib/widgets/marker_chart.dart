// Port of MarkerChart.svelte — trend line for one marker, all points
// converted into the profile's majority unit for comparability.
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import '../services/db.dart';
import '../services/parser_config.dart';
import '../theme.dart';

class MarkerChart extends StatelessWidget {
  final int profileId;
  final String canonical;
  final int currentReportId;
  final String majorityUnit;
  const MarkerChart({super.key, required this.profileId, required this.canonical, required this.currentReportId, required this.majorityUnit});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Map<String, Object?>>>(
      future: Db.instance.getMarkerChartSeries(profileId, canonical),
      builder: (context, snap) {
        if (!snap.hasData) return const SizedBox(height: 180, child: Center(child: CircularProgressIndicator()));
        final series = snap.data!; // newest-first
        if (series.isEmpty) {
          return const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Text('Not enough history for a chart yet.'));
        }
        final config = ParserConfig.instance;
        final unit = majorityUnit.isNotEmpty ? majorityUnit : (series.first['unit'] as String? ?? '');
        // Plot oldest→newest left-to-right (chart convention), even though
        // the query returns newest-first.
        final points = series.reversed.toList();
        final spots = <FlSpot>[];
        for (var i = 0; i < points.length; i++) {
          final raw = points[i]['value'] as double;
          final fromUnit = points[i]['unit'] as String? ?? unit;
          spots.add(FlSpot(i.toDouble(), config.convertUnit(canonical, raw, fromUnit, unit)));
        }
        final currentIndex = points.indexWhere((p) => p['report_id'] == currentReportId);

        // fl_chart auto-picks a Y interval with no regard for label height,
        // which overlapped badly on a narrow value range (e.g. 14.4-14.9) —
        // pick one explicitly, sized off the actual data range, and pad
        // min/max so the line never touches the chart edges.
        final values = spots.map((s) => s.y);
        final rawMin = values.reduce((a, b) => a < b ? a : b);
        final rawMax = values.reduce((a, b) => a > b ? a : b);
        final span = (rawMax - rawMin).abs();
        final pad = span == 0 ? (rawMax.abs() * 0.1).clamp(0.5, double.infinity) : span * 0.2;
        final minY = rawMin - pad;
        final maxY = rawMax + pad;
        final yInterval = (maxY - minY) / 4;

        // Sparse date labels — one every ceil(n/4) points — so they don't
        // collide on a long history, matching the Y-axis fix's approach.
        final xLabelStep = (points.length / 4).ceil().clamp(1, points.length);

        return SizedBox(
          height: 220,
          child: LineChart(LineChartData(
            minY: minY,
            maxY: maxY,
            titlesData: FlTitlesData(
              topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 28,
                  interval: xLabelStep.toDouble(),
                  getTitlesWidget: (value, meta) {
                    final i = value.round();
                    if (i < 0 || i >= points.length || i % xLabelStep != 0) return const SizedBox();
                    final date = points[i]['date'] as String;
                    return Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(date.length >= 10 ? date.substring(5) : date, style: const TextStyle(fontSize: 10, color: kMuted)),
                    );
                  },
                ),
              ),
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 46,
                  interval: yInterval,
                  getTitlesWidget: (value, meta) => Text(value.toStringAsFixed(1), style: const TextStyle(fontSize: 11, color: kMuted)),
                ),
              ),
            ),
            gridData: FlGridData(drawVerticalLine: false, horizontalInterval: yInterval),
            borderData: FlBorderData(show: false),
            lineTouchData: LineTouchData(touchTooltipData: LineTouchTooltipData(getTooltipColor: (_) => kSurface)),
            lineBarsData: [
              LineChartBarData(
                spots: spots,
                isCurved: true,
                color: kAccent,
                barWidth: 2,
                dotData: FlDotData(
                  getDotPainter: (spot, pct, bar, idx) => FlDotCirclePainter(
                    radius: idx == currentIndex ? 5 : 3,
                    color: idx == currentIndex ? kAccent : kMuted,
                    strokeWidth: 0,
                  ),
                ),
              ),
            ],
          )),
        );
      },
    );
  }
}
