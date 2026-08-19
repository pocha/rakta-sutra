// Cross-tab app state — port of mobile/src/lib/state.svelte.js. Pushed
// screens (marker detail, Backup, Notifications, Drawer) use Navigator
// directly instead of a `screen` field — that's the whole point of the
// native rewrite (state preservation + back-button handling for free).
import 'package:flutter/foundation.dart';
import '../services/db.dart' as db_lib;

class AppState extends ChangeNotifier {
  List<Map<String, Object?>> profiles = [];
  int? activeProfileId;
  int activeTabIndex = 0; // 0=Report, 1=Timeline, 2=Reminder
  int? jumpToReportId; // set by Timeline's "View full report" action

  Future<void> loadProfiles() async {
    profiles = await db_lib.Db.instance.listProfiles();
    if (activeProfileId == null && profiles.isNotEmpty) {
      activeProfileId = profiles.first['id'] as int;
    }
    notifyListeners();
  }

  Future<void> createProfile(String name) async {
    final id = await db_lib.Db.instance.addProfile(name);
    await loadProfiles();
    activeProfileId = id;
    notifyListeners();
  }

  void switchProfile(int id) {
    activeProfileId = id;
    notifyListeners();
  }

  void jumpToReport(int reportId) {
    jumpToReportId = reportId;
    activeTabIndex = 0;
    notifyListeners();
  }

  void setActiveTab(int index) {
    activeTabIndex = index;
    notifyListeners();
  }
}
