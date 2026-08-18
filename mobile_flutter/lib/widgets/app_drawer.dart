// Port of mobile/src/components/Drawer.svelte. Backup screen is wired up in
// Phase 4 (screens/backup_screen.dart).
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../screens/notifications_screen.dart';
import '../state/app_state.dart';

class AppDrawer extends StatefulWidget {
  const AppDrawer({super.key});
  @override
  State<AppDrawer> createState() => _AppDrawerState();
}

class _AppDrawerState extends State<AppDrawer> {
  bool _addingProfile = false;
  final _nameCtrl = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();
    return Drawer(
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(vertical: 12),
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 8, 20, 16),
              child: Text('Track Blood', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 20),
              child: Text('PROFILES', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 0.6)),
            ),
            for (final p in appState.profiles)
              ListTile(
                leading: CircleAvatar(child: Text((p['name'] as String).substring(0, 1).toUpperCase())),
                title: Text(p['name'] as String),
                selected: p['id'] == appState.activeProfileId,
                onTap: () {
                  appState.switchProfile(p['id'] as int);
                  Navigator.pop(context);
                },
              ),
            if (_addingProfile)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(children: [
                  Expanded(child: TextField(controller: _nameCtrl, decoration: const InputDecoration(hintText: 'e.g. Mom, Dad'))),
                  IconButton(
                    icon: const Icon(Icons.check),
                    onPressed: () async {
                      if (_nameCtrl.text.trim().isEmpty) return;
                      await appState.createProfile(_nameCtrl.text.trim());
                      if (context.mounted) Navigator.pop(context);
                    },
                  ),
                ]),
              )
            else
              ListTile(leading: const Icon(Icons.add), title: const Text('Add Profile'), onTap: () => setState(() => _addingProfile = true)),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.notifications_outlined),
              title: const Text('Notifications'),
              onTap: () {
                Navigator.pop(context);
                Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen()));
              },
            ),
            ListTile(leading: const Icon(Icons.archive_outlined), title: const Text('Backup'), onTap: () => Navigator.pop(context)),
          ],
        ),
      ),
    );
  }
}
