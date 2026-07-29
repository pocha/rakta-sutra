#!/usr/bin/env bash
set -euo pipefail

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Colour

info()    { echo -e "${BLUE}[deploy]${NC} $*"; }
success() { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()    { echo -e "${YELLOW}[deploy]${NC} $*"; }
error()   { echo -e "${RED}[deploy]${NC} $*"; exit 1; }

# ─── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # mobile/
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"                    # raktra-sutra/
RELEASES_DIR="$REPO_ROOT/releases"                            # served by GitHub Pages
DIST_DIR="$SCRIPT_DIR/dist-releases"
VERSION_FILE="$DIST_DIR/.last_version"   # local-only guard, same as agoriya's
KEYSTORE_PROPS="$SCRIPT_DIR/android/keystore.properties"
EXPORT_PLIST="$SCRIPT_DIR/ios/App/ExportOptions.plist"
APP_NAME="track-blood"

cd "$SCRIPT_DIR"

# ─── Read version from package.json — the single source of truth ────────────
# package.json's semver (e.g. "1.2.3") becomes both Android's versionName and
# iOS's MARKETING_VERSION directly. Android's versionCode and iOS's build
# number both need a plain increasing integer instead, so it's derived from
# the same semver (1.2.3 → 1002003) rather than tracked as separate state —
# monotonic as long as the version is bumped each release, which the guard
# below enforces.
APP_VERSION=$(node -p "require('./package.json').version")

if [[ -z "$APP_VERSION" ]]; then
  error "Could not read \"version\" from package.json"
fi

IFS='.' read -r VER_MAJOR VER_MINOR VER_PATCH <<< "$APP_VERSION"
if [[ -z "${VER_MAJOR:-}" || -z "${VER_MINOR:-}" || -z "${VER_PATCH:-}" ]]; then
  error "package.json version \"$APP_VERSION\" must be plain semver (X.Y.Z) for the build-number formula to work."
fi
BUILD_NUMBER=$((VER_MAJOR * 1000000 + VER_MINOR * 1000 + VER_PATCH))

info "Current version: $APP_VERSION (build $BUILD_NUMBER)"

mkdir -p "$DIST_DIR" "$RELEASES_DIR"

# ─── Parse build args ─────────────────────────────────────────────────────────
BUILD_IOS=true
BUILD_ANDROID=true
UPLOAD_IOS=false
COMMIT_RELEASE=true
FORCE=false

for arg in "$@"; do
  case $arg in
    --ios-only)     BUILD_ANDROID=false ;;
    --android-only) BUILD_IOS=false ;;
    --upload)       UPLOAD_IOS=true ;;
    --no-commit)    COMMIT_RELEASE=false ;;
    --force)        FORCE=true ;;
  esac
done

# ─── Compare with last built version ──────────────────────────────────────────
if [[ -f "$VERSION_FILE" && "$FORCE" == false ]]; then
  LAST_VERSION=$(cat "$VERSION_FILE")
  if [[ "$LAST_VERSION" == "$APP_VERSION" ]]; then
    warn "Version $APP_VERSION was already built. Bump \"version\" in mobile/package.json first."
    warn "Or pass --force to rebuild the same version anyway."
    exit 1
  fi
fi

# ─── Validate upload credentials early ───────────────────────────────────────
# Set these via mobile/.env (copy from .env.example) and `source .env` first,
# or export them in your shell profile — same convention as agoriya/.env:
#   export ASC_KEY_ID="XXXXXXXXXX"
#   export ASC_ISSUER_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
#   export ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8"
if [[ "$UPLOAD_IOS" == true ]]; then
  if [[ "$(uname)" != "Darwin" ]]; then
    error "--upload is only supported on macOS."
  fi
  if [[ -z "${ASC_KEY_ID:-}" ]]; then
    error "ASC_KEY_ID is not set. Copy mobile/.env.example to .env, fill it in, then 'source .env'."
  fi
  if [[ -z "${ASC_ISSUER_ID:-}" ]]; then
    error "ASC_ISSUER_ID is not set. See mobile/.env.example."
  fi
  if [[ -z "${ASC_KEY_PATH:-}" ]]; then
    error "ASC_KEY_PATH is not set. See mobile/.env.example."
  fi
  if [[ ! -f "$ASC_KEY_PATH" ]]; then
    error "ASC_KEY_PATH file not found: $ASC_KEY_PATH"
  fi
  info "Upload credentials verified."
fi

# ─── Build web assets + sync into native projects ────────────────────────────
info "Building web assets..."
npm run build
npx cap sync

# ─── Android — release APK ───────────────────────────────────────────────────
APK_DEST=""
if [[ "$BUILD_ANDROID" == true ]]; then
  if [[ ! -f "$KEYSTORE_PROPS" ]]; then
    error "$(cat <<EOF
android/keystore.properties not found — release APKs need a signing key. One-time setup:

  keytool -genkeypair -v -keystore ~/track-blood-release.keystore \\
    -alias track-blood -keyalg RSA -keysize 2048 -validity 10000

Then create mobile/android/keystore.properties (gitignored) containing:

  storeFile=/absolute/path/to/track-blood-release.keystore
  storePassword=your-store-password
  keyAlias=track-blood
  keyPassword=your-key-password
EOF
)"
  fi

  # Capacitor's Android build needs Gradle itself (not just a toolchain) running
  # on JDK 21 — pin JAVA_HOME rather than relying on whatever's linked on PATH.
  GRADLE_JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
  if [[ -z "$GRADLE_JAVA_HOME" ]]; then
    error "JDK 21 not found (checked via 'java_home -v 21'). Install it, e.g.: brew install openjdk@21"
  fi

  info "Building Android release APK (versionName=$APP_VERSION, versionCode=$BUILD_NUMBER)..."
  (cd android && JAVA_HOME="$GRADLE_JAVA_HOME" ANDROID_VERSION_NAME="$APP_VERSION" ANDROID_VERSION_CODE="$BUILD_NUMBER" ./gradlew assembleRelease)

  APK_SRC="$SCRIPT_DIR/android/app/build/outputs/apk/release/app-release.apk"
  if [[ ! -f "$APK_SRC" ]]; then
    error "APK not found at $APK_SRC"
  fi

  APK_DEST="$DIST_DIR/$APP_NAME-$APP_VERSION.apk"
  cp "$APK_SRC" "$APK_DEST"
  success "APK → $APK_DEST"

  # ── Publish into the repo's releases/ folder (served by GitHub Pages) ──────
  cp "$APK_DEST" "$RELEASES_DIR/$APP_NAME-$APP_VERSION.apk"
  cp "$APK_DEST" "$RELEASES_DIR/latest.apk"
  success "Copied into releases/ — index.html's Android button always points at releases/latest.apk"

  # GitHub Pages doesn't let us set Cache-Control on individual files, so bust
  # the browser cache the same way agoriya does: a ?v= query param on the
  # download link that changes every release (same pattern, no cloud storage
  # needed — the APK itself just lives in releases/ in this repo).
  info "Updating index.html's Android download link to v$APP_VERSION..."
  perl -i -pe "s|(releases/latest\.apk)(?:\?v=[^\"']*)?|\${1}?v=$APP_VERSION|g" \
    "$REPO_ROOT/index.html"
fi

# ─── iOS — release IPA ────────────────────────────────────────────────────────
IPA_DEST=""
if [[ "$BUILD_IOS" == true ]]; then
  if [[ "$(uname)" != "Darwin" ]]; then
    warn "iOS build skipped — not running on macOS."
  else
    info "Building iOS archive (MARKETING_VERSION=$APP_VERSION, CURRENT_PROJECT_VERSION=$BUILD_NUMBER)..."
    ARCHIVE_PATH="$SCRIPT_DIR/ios/build/App.xcarchive"
    mkdir -p "$(dirname "$ARCHIVE_PATH")"

    xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release \
      -archivePath "$ARCHIVE_PATH" -destination 'generic/platform=iOS' \
      -allowProvisioningUpdates archive \
      MARKETING_VERSION="$APP_VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
      2>&1 | grep -E "(error:|warning:|Archive)" || true

    if [[ ! -d "$ARCHIVE_PATH" ]]; then
      error "Archive not found. Open ios/App/App.xcworkspace once in Xcode to set your signing Team, then retry."
    fi

    if [[ ! -f "$EXPORT_PLIST" ]]; then
      warn "ios/App/ExportOptions.plist not found — creating a default app-store plist."
      cat > "$EXPORT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>
    <key>uploadSymbols</key>
    <true/>
    <key>compileBitcode</key>
    <false/>
</dict>
</plist>
PLIST
    fi

    EXPORT_DIR="$SCRIPT_DIR/ios/build/ipa"
    xcodebuild -exportArchive \
      -archivePath "$ARCHIVE_PATH" \
      -exportPath "$EXPORT_DIR" \
      -exportOptionsPlist "$EXPORT_PLIST" \
      -allowProvisioningUpdates \
      2>&1 | grep -E "(error:|warning:|IPA|Export)" || true

    IPA_FILE=$(find "$EXPORT_DIR" -name "*.ipa" | head -1)

    if [[ -z "$IPA_FILE" ]]; then
      error "IPA export failed. Check Xcode signing and ios/App/ExportOptions.plist."
    fi

    IPA_DEST="$DIST_DIR/$APP_NAME-$APP_VERSION.ipa"
    cp "$IPA_FILE" "$IPA_DEST"
    success "IPA → $IPA_DEST"
  fi
fi

# ─── Upload to App Store Connect (TestFlight) ────────────────────────────────
if [[ "$UPLOAD_IOS" == true ]]; then
  if [[ -z "$IPA_DEST" || ! -f "$IPA_DEST" ]]; then
    error "No IPA to upload. Run with --upload alongside an iOS build (not --android-only)."
  fi

  info "Validating IPA before upload..."
  xcrun altool --validate-app \
    -f "$IPA_DEST" \
    -t ios \
    --apiKey "$ASC_KEY_ID" \
    --apiIssuer "$ASC_ISSUER_ID" \
    --private-key "$ASC_KEY_PATH" \
    2>&1 | grep -v "^$" || true

  info "Uploading IPA to App Store Connect..."
  xcrun altool --upload-app \
    -f "$IPA_DEST" \
    -t ios \
    --apiKey "$ASC_KEY_ID" \
    --apiIssuer "$ASC_ISSUER_ID" \
    --private-key "$ASC_KEY_PATH" \
    2>&1 | grep -v "^$"

  success "Upload complete — check TestFlight in App Store Connect for processing status."
fi

# ─── Commit + push releases/ + index.html so GitHub Pages serves the new APK ─
if [[ "$COMMIT_RELEASE" == true && -n "$APK_DEST" ]]; then
  if [[ -z "$(git -C "$REPO_ROOT" status --porcelain -- releases index.html)" ]]; then
    warn "releases/ and index.html already up to date — skipping commit."
  else
    git -C "$REPO_ROOT" add releases/ index.html
    git -C "$REPO_ROOT" commit -m "chore: publish track-blood v$APP_VERSION APK"
    if ! git -C "$REPO_ROOT" push; then
      CURRENT_BRANCH="$(git -C "$REPO_ROOT" branch --show-current)"
      warn "git push failed — if this branch has no upstream yet, run:"
      warn "  git push --set-upstream origin $CURRENT_BRANCH"
    else
      success "Pushed — GitHub Pages will serve v$APP_VERSION at releases/latest.apk"
    fi
  fi
fi

# ─── Record built version ─────────────────────────────────────────────────────
echo "$APP_VERSION" > "$VERSION_FILE"

success "────────────────────────────────────────"
success "Build complete — version $APP_VERSION"
[[ -n "$APK_DEST" ]] && success "  APK: $APK_DEST"
[[ -n "$APK_DEST" ]] && success "  Hosted: $RELEASES_DIR/latest.apk"
[[ -n "$IPA_DEST" ]] && success "  IPA: $IPA_DEST"
[[ "$UPLOAD_IOS" == true ]] && success "  Uploaded to TestFlight ✓"
success "────────────────────────────────────────"
