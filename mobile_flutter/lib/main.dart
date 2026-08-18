import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/db.dart';
import 'services/parser_bridge.dart';
import 'services/parser_config.dart';
import 'state/app_state.dart';
import 'theme.dart';
import 'screens/app_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Future.wait([
    ParserConfig.load(),
    Db.instance.init(),
    ParserBridge.instance.init(),
  ]);

  final appState = AppState();
  await appState.loadProfiles();

  runApp(
    ChangeNotifierProvider.value(
      value: appState,
      child: MaterialApp(
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
}
