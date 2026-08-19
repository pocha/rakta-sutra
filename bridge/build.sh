#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

npm run build

DEST="../mobile_flutter/assets/bridge"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R dist/. "$DEST/"

# parser-config.json is also read directly by Dart (unit conversion/ref
# ranges — see lib/services/parser_config.dart), and the wordmap by
# ParserConfigSync's initial/fallback load — both as well as by the bridge.
cp ../parser-config.json ../mobile_flutter/assets/parser-config.json
cp ../parser-config-wordmap.json ../mobile_flutter/assets/parser-config-wordmap.json

echo "Bridge bundle + parser-config.json + parser-config-wordmap.json copied to mobile_flutter/assets/"
