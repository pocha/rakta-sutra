import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'navigation.dart';
import 'services/db.dart';
import 'services/parser_bridge.dart';
import 'services/parser_config.dart';
import 'services/push.dart';
import 'state/app_state.dart';
import 'theme.dart';
import 'screens/app_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Future.wait([
    ParserConfig.load(),
    Db.instance.init(),
    ParserBridge.instance.init(),
    Firebase.initializeApp(),
  ]);

  final appState = AppState();
  await appState.loadProfiles();

  runApp(
    ChangeNotifierProvider.value(
      value: appState,
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: 'Track Blood',
        theme: buildAppTheme(),
        home: Stack(
          children: [
            const AppShell(),
            ParserBridge.instance.hiddenHost(),
          ],
        ),
      ),
    ),
  );

  // Fire-and-forget, same as the Capacitor app — push registration/foreground
  // handling shouldn't block first paint.
  initPush(appState).catchError((err) => debugPrint('[main] initPush failed: $err'));
}
