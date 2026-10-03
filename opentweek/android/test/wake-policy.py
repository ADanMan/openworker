from pathlib import Path
import xml.etree.ElementTree as ET
root = ET.parse('AndroidManifest.xml').getroot()
a = '{http://schemas.android.com/apk/res/android}'
permissions = {p.attrib[a+'name'] for p in root.findall('uses-permission')}
assert {'android.permission.RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS', 'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MICROPHONE'} <= permissions
service = next(s for s in root.find('application').findall('service') if s.attrib[a+'name'] == 'app.opentweek.LocalWakeService')
assert service.attrib[a+'exported'] == 'false' and service.attrib[a+'foregroundServiceType'] == 'microphone'
code = Path('src/app/opentweek/LocalWakeService.java').read_text()
assert 'START_NOT_STICKY' in code and 'START_STICKY;' not in code
assert 'WeakReference<LocalVoice>' in code and 'end(id, "cancelled", null, null)' in code
assert 'if (!active(id)) return;' in code and 'FOREGROUND_SERVICE_TYPE_MICROPHONE' in code
activity = Path('src/app/opentweek/MainActivity.java').read_text()
assert 'localVoice.foreground(false)' in activity
assert 'wakeRecovery' in activity
boot = Path('src/app/opentweek/BootReceiver.java').read_text()
assert 'LocalWakeService' not in boot
voice = Path('src/app/opentweek/LocalVoice.java').read_text()
assert 'notification_permission' in voice and 'LocalWakeService.active(current.id)' in voice
engine = Path('src/app/opentweek/LocalWakeEngine.java').read_text()
assert 'Activity' not in engine.replace('Never references an Activity or WebView.', '')
assert 'candidate.snapshot()' in engine and 'new Recognizer(model, 16000)' in engine
assert 'wake_result' in code and 'commit()' in code
assert 'pending_result' in code and 'localWakeRecovery' in Path('src/app/opentweek/NativeBridge.java').read_text()
assert 'new Recognizer(model, 16000, "[\\"эй твик\\",\\"[unk]\\"]")' in engine
print('Wake foreground service policy checks passed')

# Empty captures do not persist a hidden pending item; clearing needs durable acknowledgment.
assert 'if (text.isEmpty()) { state = "error"; text = null; error = "no_speech"; }' in code
clear = code.split('static synchronized boolean clearRecovery', 1)[1].split('static synchronized void start', 1)[0]
assert 'json.isEmpty()' in clear and '.equals(id)) return false;' in clear
assert 'if (!preferences.edit().remove(RESULT).commit())' in clear
assert 'preferences.edit().putString(RESULT, json).commit();' in clear
assert clear.index('return false;', clear.index('remove(RESULT)')) < clear.index('.cancel(73)') < clear.index('return true;')
assert 'public boolean clearLocalWakeRecovery' in Path('src/app/opentweek/NativeBridge.java').read_text()
