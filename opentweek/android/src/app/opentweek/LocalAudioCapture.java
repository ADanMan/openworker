package app.opentweek;

import android.media.AudioRecord;
import android.media.AudioRecordingConfiguration;
import android.os.Build;

/** Checks only this recorder's platform status; no audio or other-client metadata. */
final class LocalAudioCapture {
    static void checkSilenced(AudioRecord audio) throws LocalVoiceFailure {
        if (Build.VERSION.SDK_INT >= 29) {
            AudioRecordingConfiguration configuration = audio.getActiveRecordingConfiguration();
            // A null configuration is unknown, not evidence that capture is blocked.
            if (configuration != null && configuration.isClientSilenced())
                throw new LocalVoiceFailure("microphone_silenced");
        }
    }
}
