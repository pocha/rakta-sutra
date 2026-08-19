# Track Blood (native)

Native Flutter rewrite of the mobile app — see `/mobile` for the previous
Capacitor+Svelte version, kept as a working reference during the
transition, and the repo root's plan file for the phased rewrite plan.

`parser-core.mjs` (the shared PDF-extraction engine) stays JS, run inside a
hidden WebView bridged from Dart — see `lib/services/parser_bridge.dart`
and `../bridge/`.

## One-time / after changing `../bridge/src` or `../parser-core.mjs`

```
../bridge/build.sh
```

This builds the bridge JS bundle and copies it into `assets/bridge/` (a
build artifact, gitignored — regenerate it after a fresh clone before
running the app).

## Run

```
flutter pub get
flutter run
```
