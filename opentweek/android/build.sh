#!/usr/bin/env bash
# Build a signed opentweek APK without Gradle or Google Maven.
#
# Toolchain (Ubuntu 24.04 / Debian):
#   apt-get install aapt dalvik-exchange zipalign apksigner android-sdk-platform-23 openjdk-21-jdk-headless
# Output: ../releases/opentweek-<version>.apk
set -euo pipefail
cd "$(dirname "$0")"

ANDROID_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
KEYSTORE=${KEYSTORE_FILE:-opentweek.keystore}
KS_PASS=${KEYSTORE_PASSWORD:-opentweek}
KEY_ALIAS=${KEY_ALIAS:-opentweek}
KEY_PASS=${KEY_PASSWORD:-opentweek}
MIN_SDK=24
TARGET_SDK=34

for tool in aapt dalvik-exchange zipalign apksigner javac node; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done
[ -f "$ANDROID_JAR" ] || { echo "missing $ANDROID_JAR (apt-get install android-sdk-platform-23)" >&2; exit 1; }

VERSION_NAME=$(node -p "require('../package.json').version")
# 1.2.3 -> 10203; monotonically increasing, so every release installs over the previous one.
VERSION_CODE=$(node -p "const [a,b,c]=require('../package.json').version.split('-')[0].split('.').map(Number); a*10000+b*100+c")
OUT=build
APK=../releases/opentweek-$VERSION_NAME.apk

echo "==> opentweek $VERSION_NAME (versionCode $VERSION_CODE)"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/assets" ../releases

echo "==> web bundle"
(cd .. && VITE_TARGET=android npx vite build --outDir android/$OUT/assets/www --emptyOutDir --logLevel warn)

echo "==> resources"
aapt package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -I "$ANDROID_JAR" \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK

echo "==> java"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" -d "$OUT/classes" \
  $(find src "$OUT/gen" -name '*.java')

echo "==> dex"
dalvik-exchange --dex --min-sdk-version=$MIN_SDK --output="$OUT/classes.dex" "$OUT/classes"

echo "==> package"
aapt package -f -M AndroidManifest.xml -S res -A "$OUT/assets" -I "$ANDROID_JAR" \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -F "$OUT/unsigned.apk"
(cd "$OUT" && aapt add unsigned.apk classes.dex)

echo "==> align + sign"
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KEY_ALIAS" --key-pass "pass:$KEY_PASS" \
  --min-sdk-version $MIN_SDK --out "$APK" "$OUT/aligned.apk"
apksigner verify --min-sdk-version $MIN_SDK "$APK"
rm -f "$APK.idsig"

(cd ../releases && sha256sum "$(basename "$APK")" > "$(basename "$APK").sha256")
echo "==> $APK ($(du -h "$APK" | cut -f1))"
