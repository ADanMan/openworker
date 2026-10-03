package app.opentweek;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;
import java.io.File;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;

/** Service-owned local capture. Never references an Activity or WebView. */
final class LocalWakeEngine {
    interface Events { void event(String state, String text, String error); }
    final String id;
    private final File modelDirectory;
    private final Events events;
    private volatile boolean cancelled, stopped;
    private volatile AudioRecord audio;
    private volatile WakePhrase gate;
    LocalWakeEngine(Context context, String id, Events events) {
        this.id = id; this.events = events;
        modelDirectory = new File(new File(context.getNoBackupFilesDir(), "local-voice"), LocalVoiceModel.NAME);
    }
    void cancel() { cancelled = true; stopAudio(); }
    void finish() {
        WakePhrase g = gate;
        if (g == null || g.state() != WakePhrase.State.RECORDING) { cancel(); events.event("cancelled", null, null); }
        else { stopped = true; stopAudio(); }
    }
    private void stopAudio() { AudioRecord a = audio; if (a != null) try { a.stop(); } catch (Exception ignored) { } }
    void run() {
        AudioRecord capture = null;
        Recognizer recognizer = null;
        WakeAudioBuffer candidate = new WakeAudioBuffer();
        try (Model model = new Model(modelDirectory.getAbsolutePath())) {
            try {
            if (cancelled) return;
            recognizer = new Recognizer(model, 16000, "[\"эй твик\",\"[unk]\"]");
            int minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minimum <= 0) throw new LocalVoiceFailure("microphone_unavailable");
            capture = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, 8192));
            audio = capture;
            if (capture.getState() != AudioRecord.STATE_INITIALIZED) throw new LocalVoiceFailure("microphone_unavailable");
            if (cancelled) return;
            capture.startRecording();
            if (capture.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new LocalVoiceFailure("microphone_unavailable");
            gate = new WakePhrase(SystemClock.elapsedRealtime());
            events.event("waiting", null, null);
            byte[] buffer = new byte[4096];
            while (!cancelled) {
                if (gate.expired(SystemClock.elapsedRealtime())) { events.event("error", null, "wake_timeout"); return; }
                int n = capture.read(buffer, 0, buffer.length);
                if (cancelled) return;
                if (n < 0) throw new LocalVoiceFailure(LocalVoiceFailure.readError(n));
                LocalAudioCapture.checkSilenced(capture);
                if (n > 0) {
                    candidate.append(buffer, n);
                    if (recognizer.acceptWaveForm(buffer, n)) {
                        String heard = new JSONObject(recognizer.getResult()).optString("text");
                        String verified = "";
                        if (WakePhrase.matches(heard)) {
                            byte[] pcm = candidate.snapshot();
                            try (Recognizer verifier = new Recognizer(model, 16000)) {
                                verifier.acceptWaveForm(pcm, pcm.length);
                                verified = new JSONObject(verifier.getFinalResult()).optString("text");
                            } finally { java.util.Arrays.fill(pcm, (byte)0); }
                        }
                        candidate.reset();
                        if (!cancelled && gate.recognized(heard, verified, true, SystemClock.elapsedRealtime())) break;
                    }
                }
            }
            if (cancelled) return;
            recognizer.close(); recognizer = null;
            recognizer = new Recognizer(model, 16000);
            events.event("recording", null, null);
            StringBuilder text = new StringBuilder();
            long started = SystemClock.elapsedRealtime(), endpointAt = 0;
            while (!cancelled && !stopped && SystemClock.elapsedRealtime() - started < 120000) {
                int n = capture.read(buffer, 0, buffer.length);
                if (cancelled || stopped) break;
                if (n < 0) throw new LocalVoiceFailure(LocalVoiceFailure.readError(n));
                LocalAudioCapture.checkSilenced(capture);
                if (n > 0 && recognizer.acceptWaveForm(buffer, n)) {
                    String segment = new JSONObject(recognizer.getResult()).optString("text").trim();
                    if (!segment.isEmpty()) { append(text, segment); endpointAt = SystemClock.elapsedRealtime(); }
                }
                String partial = new JSONObject(recognizer.getPartialResult()).optString("partial");
                if (!partial.isEmpty()) endpointAt = 0;
                if (endpointAt > 0 && SystemClock.elapsedRealtime() - endpointAt >= 3000) break;
                if (SystemClock.elapsedRealtime() - started > 15000 && text.length() == 0 && partial.isEmpty()) break;
            }
            if (!cancelled) LocalAudioCapture.checkSilenced(capture);
            stopAudio(); audio = null; capture.release(); capture = null;
            if (cancelled) return;
            events.event("processing", null, null);
            append(text, new JSONObject(recognizer.getFinalResult()).optString("text").trim());
            if (gate.finish()) events.event("result", text.toString(), null);
            } finally { if (recognizer != null) recognizer.close(); }
        } catch (Exception | LinkageError e) {
            if (!cancelled) events.event("error", null, LocalVoiceFailure.recognition(e));
        } finally {
            candidate.reset();
            audio = null;
            if (capture != null) { try { capture.stop(); } catch (Exception ignored) { } capture.release(); }
            events.event("released", null, null);
        }
    }
    private static void append(StringBuilder target, String segment) {
        if (segment.isEmpty()) return;
        if (target.length() > 0) target.append(' ');
        target.append(segment);
    }
}
