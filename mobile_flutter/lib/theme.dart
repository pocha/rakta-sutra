// Port of mobile/src/theme.css's palette into a Flutter ThemeData.
import 'package:flutter/material.dart';

const kBg = Color(0xFFF7F7F9);
const kSurface = Color(0xFFFFFFFF);
const kBorder = Color(0xFFE8E8EC);
const kText = Color(0xFF1C1C1E);
const kMuted = Color(0xFF8A8A90);
const kMutedLt = Color(0xFF6E6E75);
const kAccent = Color(0xFFE63946);
const kAccentDim = Color(0xFFC62839);
const kAccentSoft = Color(0x14E63946);
const kOk = Color(0xFF1C9A5B);

ThemeData buildAppTheme() {
  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: kBg,
    colorScheme: ColorScheme.fromSeed(seedColor: kAccent, primary: kAccent, surface: kSurface),
    appBarTheme: const AppBarTheme(backgroundColor: kSurface, foregroundColor: kAccentDim, elevation: 0),
    cardTheme: CardThemeData(
      color: kSurface,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: kBorder)),
    ),
    navigationBarTheme: const NavigationBarThemeData(backgroundColor: kSurface, indicatorColor: kAccentSoft),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(backgroundColor: kAccent, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: kBg,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: kBorder)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    ),
    fontFamily: '.SF UI Text',
  );
}
