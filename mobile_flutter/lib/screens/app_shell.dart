import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../widgets/app_drawer.dart';
import 'report_tab.dart';
import 'timeline_tab.dart';
import 'reminder_tab.dart';

class AppShell extends StatelessWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Track Blood')),
      drawer: const AppDrawer(),
      body: IndexedStack(
        index: appState.activeTabIndex,
        children: [
          ReportTab(profileId: appState.activeProfileId),
          TimelineTab(profileId: appState.activeProfileId),
          ReminderTab(profileId: appState.activeProfileId),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: appState.activeTabIndex,
        onDestinationSelected: appState.setActiveTab,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.description_outlined), selectedIcon: Icon(Icons.description), label: 'Report'),
          NavigationDestination(icon: Icon(Icons.history), label: 'Timeline'),
          NavigationDestination(icon: Icon(Icons.notifications_outlined), selectedIcon: Icon(Icons.notifications), label: 'Reminder'),
        ],
      ),
    );
  }
}
