# OpenTweek Preview packaging

`./build-local.sh` (also `./build.sh`) builds **OpenTweek Preview**, application ID
`app.opentweek.preview`. It installs alongside the existing `app.opentweek` app.
Never uninstall the existing app, overwrite its APK, or reuse its release key.
This script does not install or launch anything and does not use the microphone.

Set `JAVA_HOME`, `ANDROID_HOME` and optionally `OPENTWEEK_BUILD_CACHE` as described
in the script. Run `npm ci` in `opentweek` before building. Signing uses only
`/tmp/opentweek-preview-signing/preview-debug.keystore`, generated as needed;
the repository release keystore and its passwords are never read. If that
disposable key is lost, a new key cannot update an already installed Preview.
Preserve/export Preview data before deciding how to handle a signature mismatch.

Each successful build creates a new read-only directory under `artifacts/`, named
with the package version, UTC timestamp and APK hash prefix. It contains the APK,
SHA-256 sidecar and `manifest.json` recording version/code, application ID, signing
type, Git commit, dirty state and time. No artifact or old `build-local` directory
is deleted. The SHA-256 identifies exact bytes even for uncommitted source builds.
These read-only filesystem permissions guard accidental edits, not administrator
modification. No artifact is described as release-signed.

Java classes and generated R remain in `app.opentweek`; the manifest uses explicit
class names while the install package is `app.opentweek.preview`. Dynamic shortcuts,
reminders and notification PendingIntents use an explicit class with the current
Context, so their component package is Preview. Share / AUTO_SEND handlers are
registered only within this APK; Android's chooser can offer both installations.
No custom URI authority or shared user ID is declared. WebView storage, private
preferences and the model under `getNoBackupFilesDir()/local-voice` belong to the
Preview sandbox. Backup is disabled to avoid importing unrelated app data.

Run `python3 verify-preview.py` for source boundary checks. A build also validates
APK badging, signature and ZIP alignment before publishing. Device behavior has to
be checked separately with explicit permission; source/APK checks do not establish
runtime microphone or shortcut behavior.
