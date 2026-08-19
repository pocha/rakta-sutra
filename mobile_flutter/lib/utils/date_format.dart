// Shared "25 Aug, 2026" date formatting + relative-age labels, used
// everywhere a report_date/entry_date/remind_at ISO string is shown to
// the user (Report tab, Marker detail, Timeline, Reminder).
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

String formatDate(DateTime d) => '${d.day} ${_months[d.month - 1]}, ${d.year}';

String formatDateIso(String isoDate) => formatDate(DateTime.parse(isoDate));

String formatTime(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final ampm = d.hour < 12 ? 'AM' : 'PM';
  final min = d.minute.toString().padLeft(2, '0');
  return '$h:$min $ampm';
}

String formatDateTime(DateTime d) => '${formatDate(d)} · ${formatTime(d)}';

// "3 days ago" / "5 months ago" / "1 year, 2 months ago" — once a span
// reaches a year, months are shown alongside so "1 year ago" doesn't hide
// up to 11 months of drift.
String relativeLabel(DateTime from) {
  final days = DateTime.now().difference(from).inDays;
  if (days <= 0) return 'Today';
  if (days < 30) return '$days day${days > 1 ? 's' : ''} ago';
  if (days < 365) {
    final months = (days / 30).round();
    return '$months month${months > 1 ? 's' : ''} ago';
  }
  final years = days ~/ 365;
  final months = ((days % 365) / 30).round();
  final yearsPart = '$years year${years > 1 ? 's' : ''}';
  if (months == 0) return '$yearsPart ago';
  return '$yearsPart, $months month${months > 1 ? 's' : ''} ago';
}
