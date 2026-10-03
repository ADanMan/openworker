#!/usr/bin/env bash
# Local speech APK, without Gradle or the repository's release keystore.
# Requires JDK 17+, Android SDK platform 35 / build-tools 35.0.0, Node and npm.
# Provision SDK: sdkmanager --sdk_root="$ANDROID_HOME" 'platforms;android-35' 'build-tools;35.0.0'
# Run npm ci in .. first. Set JAVA_HOME and ANDROID_HOME to isolated toolchain paths.
# Output is debug-signed: it cannot update a release signed with another key.
set -euo pipefail
cd "$(dirname "$0")"
: "${JAVA_HOME:?Set JAVA_HOME to JDK 17 or newer}"
: "${ANDROID_HOME:?Set ANDROID_HOME to Android SDK root}"
export PATH="$JAVA_HOME/bin:$PATH"
BT="$ANDROID_HOME/build-tools/35.0.0"
ANDROID_JAR="$ANDROID_HOME/platforms/android-35/android.jar"
CACHE="${OPENTWEEK_BUILD_CACHE:-$PWD/.cache}"
OUT="$PWD/build-local"
for tool in javac jar keytool node curl unzip zip python3; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done
for tool in aapt2 d8 zipalign apksigner; do
  test -x "$BT/$tool" || { echo "Missing $BT/$tool" >&2; exit 1; }
done
test -f "$ANDROID_JAR"
mkdir -p "$CACHE"
fetch() {
  local name="$1" sha="$2" url="$3"
  if ! test -f "$CACHE/$name"; then
    curl --fail --location --retry 2 "$url" -o "$CACHE/$name.part"
    mv "$CACHE/$name.part" "$CACHE/$name"
  fi
  python3 - "$CACHE/$name" "$sha" <<'PY'
import hashlib, sys
with open(sys.argv[1], 'rb') as f:
    actual = hashlib.sha256(f.read()).hexdigest()
if actual != sys.argv[2]:
    raise SystemExit('Dependency checksum mismatch: ' + sys.argv[1])
PY
}
fetch vosk-android-0.3.75.aar ab2f8b91ac8051561aa325546b35fed9a68b36b8121bac5c6fb927525c4adfad \
  https://repo.maven.apache.org/maven2/com/alphacephei/vosk-android/0.3.75/vosk-android-0.3.75.aar
fetch jna-5.18.1.aar 7f053e3ec99e14dd71259c82c1c8a02738d64a13c31226b2acc170f3060951e0 \
  https://repo.maven.apache.org/maven2/net/java/dev/jna/jna/5.18.1/jna-5.18.1.aar
rm -rf "$OUT"
mkdir -p "$OUT"/{gen,classes,assets,www,dex,lib,vosk,jna}
unzip -q "$CACHE/vosk-android-0.3.75.aar" -d "$OUT/vosk"
unzip -q "$CACHE/jna-5.18.1.aar" -d "$OUT/jna"
# Only ABIs for which both JNI libraries exist are included.
for abi in arm64-v8a armeabi-v7a x86 x86_64; do
  mkdir -p "$OUT/lib/$abi"
  cp "$OUT/vosk/jni/$abi/libvosk.so" "$OUT/jna/jni/$abi/libjnidispatch.so" "$OUT/lib/$abi/"
done
VERSION_NAME=$(node -p "require('../package.json').version")
VERSION_CODE=$(node -p "const [a,b,c]=require('../package.json').version.split('-')[0].split('.').map(Number); a*10000+b*100+c")
(cd .. && VITE_TARGET=android ./node_modules/.bin/vite build --outDir android/build-local/assets/www --emptyOutDir)
"$BT/aapt2" compile --dir res -o "$OUT/resources.zip"
"$BT/aapt2" link -o "$OUT/unsigned.apk" -I "$ANDROID_JAR" --manifest AndroidManifest.xml \
  --java "$OUT/gen" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -A "$OUT/assets" "$OUT/resources.zip"
find src "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac --release 8 -encoding UTF-8 \
  -classpath "$ANDROID_JAR:$OUT/vosk/classes.jar:$OUT/jna/classes.jar" \
  -d "$OUT/classes" @"$OUT/sources.txt"
jar cf "$OUT/app.jar" -C "$OUT/classes" .
"$BT/d8" --min-api 24 --lib "$ANDROID_JAR" --output "$OUT/dex" \
  "$OUT/app.jar" "$OUT/vosk/classes.jar" "$OUT/jna/classes.jar"
(cd "$OUT/dex" && zip -q ../unsigned.apk classes*.dex)
(cd "$OUT" && zip -qr unsigned.apk lib)
"$BT/zipalign" -f -P 16 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
# Generate a separate disposable development identity, never open opentweek.keystore.
if ! test -f "$CACHE/local-debug.keystore"; then
  keytool -genkeypair -keystore "$CACHE/local-debug.keystore" -storepass android -keypass android \
    -alias androiddebugkey -dname 'CN=OpenTweek Local Debug,O=Development,C=US' \
    -keyalg RSA -keysize 2048 -validity 10000
fi
APK="$OUT/opentweek-$VERSION_NAME-local-debug.apk"
"$BT/apksigner" sign --ks "$CACHE/local-debug.keystore" --ks-pass pass:android \
  --ks-key-alias androiddebugkey --key-pass pass:android --out "$APK" "$OUT/aligned.apk"
"$BT/apksigner" verify --verbose "$APK"
"$BT/zipalign" -c -P 16 4 "$APK"
python3 - "$APK" <<'PY'
import hashlib, pathlib, sys
p = pathlib.Path(sys.argv[1])
digest = hashlib.sha256(p.read_bytes()).hexdigest()
p.with_suffix(p.suffix + '.sha256').write_text(digest + '  ' + p.name + '\n')
print(str(p) + '\nSHA256 ' + digest)
PY
echo 'Debug identity only: cannot update an existing differently signed installation. Do not uninstall it to bypass this.'
