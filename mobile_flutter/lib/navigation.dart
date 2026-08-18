// A global navigator key so services outside the widget tree (push.dart,
// reacting to a notification tap) can push a screen without needing a
// BuildContext threaded all the way through.
import 'package:flutter/material.dart';

final navigatorKey = GlobalKey<NavigatorState>();
