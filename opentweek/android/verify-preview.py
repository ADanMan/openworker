"""Fail closed if the APK or source would cross the Preview package boundary."""
import pathlib
import sys
import xml.etree.ElementTree as ET

root = pathlib.Path(__file__).resolve().parent
ns = '{http://schemas.android.com/apk/res/android}'
manifest = ET.parse(root / 'AndroidManifest.xml').getroot()
assert manifest.get('package') == 'app.opentweek.preview'
assert not manifest.get(ns + 'sharedUserId')
app = manifest.find('application')
assert app.get(ns + 'allowBackup') == 'false'
assert app.find('activity').get(ns + 'name') == 'app.opentweek.MainActivity'
for component in list(app):
    if component.tag in ('activity', 'receiver', 'service', 'provider'):
        assert component.get(ns + 'name').startswith('app.opentweek.')
    if component.tag == 'provider':
        assert component.get(ns + 'authorities').startswith('app.opentweek.preview.')
strings = ET.parse(root / 'res/values/strings.xml').getroot()
assert strings.find("string[@name='app_name']").text == 'OpenTweek Preview'
java = root / 'src/app/opentweek'
assert 'intent.setClass(c, MainActivity.class)' in (java / 'Shortcuts.java').read_text()
assert 'new Intent(c, MainActivity.class)' in (java / 'ReminderReceiver.java').read_text()
assert 'new Intent(c, ReminderReceiver.class)' in (java / 'Reminders.java').read_text()
assert 'activity.getNoBackupFilesDir()' in (java / 'LocalVoice.java').read_text()
for source in java.glob('*.java'):
    text = source.read_text()
    assert 'setPackage("app.opentweek")' not in text
    assert 'setClassName("app.opentweek"' not in text
if len(sys.argv) > 1:
    assert pathlib.Path(sys.argv[1]).is_file()
    badging = pathlib.Path(sys.argv[2]).read_text()
    assert "package: name='app.opentweek.preview'" in badging
    assert "application-label:'OpenTweek Preview'" in badging
    assert "launchable-activity: name='app.opentweek.MainActivity'" in badging
print('Preview package, explicit components, app-private model and intent boundaries verified.')
