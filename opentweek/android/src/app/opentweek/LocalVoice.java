package app.opentweek;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Local Russian dictation. Audio exists only in bounded memory buffers. */
final class LocalVoice {
    static final int PERMISSION = 41;
    private final MainActivity activity;
    private final File root, modelDirectory;
    private final ExecutorService recognition = Executors.newSingleThreadExecutor();
    private boolean foreground, destroyed, downloading;
    private volatile boolean downloadCancelled;
    private volatile HttpURLConnection connection;
    private int progress;
    private Session current;
    private Session permissionPending;
    private static final class Session {
        final String id;
        volatile boolean cancelled, stopped;
        AudioRecord audio;
        Session(String id) { this.id = id; }
    }
    LocalVoice(MainActivity activity) {
        this.activity = activity;
        root = new File(activity.getNoBackupFilesDir(), "local-voice");
        modelDirectory = new File(root, LocalVoiceModel.NAME);
    }
    synchronized String status() {
        try { return new JSONObject().put("supported", true).put("modelReady", LocalVoiceModel.valid(modelDirectory))
            .put("downloading", downloading).put("progress", progress / 100.0).put("modelName", LocalVoiceModel.NAME)
            .put("modelBytes", LocalVoiceModel.BYTES).put("wakeSupported", false).toString(); }
        catch (Exception e) { return "{}"; }
    }
    private void emit(String id, String state, String text, String error, int percent) {
        try {
            JSONObject event = new JSONObject().put("sessionId", id).put("state", state);
            if (text != null) event.put("text", text);
            if (error != null) event.put("error", error);
            if (percent >= 0) event.put("progress", percent / 100.0);
            final String json = event.toString();
            activity.runOnUiThread(() -> { synchronized (LocalVoice.this) {
                if (!destroyed) activity.web.evaluateJavascript("window.__otLocalVoice && window.__otLocalVoice(" + json + ")", null);
            }});
        } catch (Exception ignored) { }
    }
    private void sessionEvent(Session s, String state, String text, String error) {
        activity.runOnUiThread(() -> { synchronized (LocalVoice.this) {
            if (current == s && !s.cancelled && !destroyed) emit(s.id, state, text, error, -1);
        }});
    }
    synchronized void foreground(boolean value) {
        foreground = value;
        if (!value && current != null) cancel(current.id);
    }
    synchronized void close() {
        foreground(false); destroyed = true; cancelDownload(); recognition.shutdownNow();
    }
    void start(String id) {
        activity.runOnUiThread(() -> { synchronized (LocalVoice.this) {
            if (destroyed || !foreground || id == null || id.isEmpty() || id.length() > 128) return;
            if (current != null) cancel(current.id);
            Session s = new Session(id); current = s;
            if (!LocalVoiceModel.valid(modelDirectory)) { sessionEvent(s, "error", null, "model_missing"); return; }
            sessionEvent(s, "loading", null, null);
            if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                if (permissionPending != null) { sessionEvent(s, "error", null, "permission_pending"); return; }
                permissionPending = s;
                activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, PERMISSION);
            } else recognition.execute(() -> record(s));
        }});
    }
    synchronized void permissionResult(boolean granted) {
        Session s = permissionPending; permissionPending = null;
        if (s == null || s != current || s.cancelled || !foreground || destroyed) return;
        if (granted) recognition.execute(() -> record(s));
        else sessionEvent(s, "error", null, "permission_denied");
    }
    synchronized void stop(String id) {
        if (current == null || !current.id.equals(id)) return;
        current.stopped = true;
        if (current.audio != null) try { current.audio.stop(); } catch (Exception ignored) { }
    }
    synchronized void cancel(String id) {
        if (current == null || !current.id.equals(id)) return;
        Session s = current; s.cancelled = true; stop(id); current = null;
        emit(id, "cancelled", null, null, -1);
    }
    private void record(Session s) {
        AudioRecord audio = null;
        try (Model model = new Model(modelDirectory.getAbsolutePath()); Recognizer recognizer = new Recognizer(model, 16000)) {
            synchronized (this) {
                if (s != current || s.cancelled || !foreground || destroyed) return;
                if (s.stopped) { sessionEvent(s, "result", "", null); return; }
                int minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (minimum <= 0) throw new IOException("microphone_unavailable");
                audio = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, 8192));
                s.audio = audio;
                if (audio.getState() != AudioRecord.STATE_INITIALIZED) throw new IOException("microphone_unavailable");
                audio.startRecording();
                if (audio.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IOException("microphone_unavailable");
            }
            sessionEvent(s, "recording", null, null);
            byte[] buffer = new byte[4096];
            StringBuilder text = new StringBuilder();
            long started = SystemClock.elapsedRealtime();
            long endpointAt = 0;
            while (!s.cancelled && !s.stopped && SystemClock.elapsedRealtime() - started < 120000) {
                int n = audio.read(buffer, 0, buffer.length);
                if (s.cancelled || s.stopped) break;
                if (n < 0) throw new IOException("microphone_read_failed");
                if (n > 0 && recognizer.acceptWaveForm(buffer, n)) {
                    String segment = new JSONObject(recognizer.getResult()).optString("text").trim();
                    if (!segment.isEmpty()) {
                        if (text.length() > 0) text.append(' ');
                        text.append(segment); endpointAt = SystemClock.elapsedRealtime();
                    }
                }
                String partial = new JSONObject(recognizer.getPartialResult()).optString("partial");
                if (!partial.isEmpty()) endpointAt = 0;
                if (endpointAt > 0 && SystemClock.elapsedRealtime() - endpointAt >= 3000) break;
                // Empty room timeout: recognizer partial output, never an external service.
                if (SystemClock.elapsedRealtime() - started > 15000 && text.length() == 0
                        && partial.isEmpty()) break;
            }
            synchronized (this) { if (s.audio != null) { try { s.audio.stop(); } catch (Exception ignored) { } s.audio = null; } }
            audio.release(); audio = null;
            if (s.cancelled) return;
            sessionEvent(s, "processing", null, null);
            String tail = new JSONObject(recognizer.getFinalResult()).optString("text").trim();
            if (!tail.isEmpty()) { if (text.length() > 0) text.append(' '); text.append(tail); }
            sessionEvent(s, "result", text.toString(), null);
        } catch (Exception | LinkageError e) {
            if (!s.cancelled) sessionEvent(s, "error", null, "recognition_failed");
        } finally {
            synchronized (this) {
                s.audio = null;
                if (audio != null) { try { audio.stop(); } catch (Exception ignored) { } audio.release(); }
            }
        }
    }
    synchronized void download() {
        if (destroyed || downloading) return;
        if (LocalVoiceModel.valid(modelDirectory)) { emit("", "ready", null, null, 100); return; }
        downloading = true; downloadCancelled = false; progress = 0;
        new Thread(this::install, "local-voice-model").start();
    }
    synchronized void cancelDownload() {
        downloadCancelled = true;
        HttpURLConnection c = connection; if (c != null) c.disconnect();
    }
    private void checkDownload() throws IOException { if (downloadCancelled) throw new IOException("cancelled"); }
    private void install() {
        File stage = null, archive = null;
        boolean installed = false;
        try {
            if (LocalVoiceModel.BYTES <= 0 || LocalVoiceModel.SHA256.length() != 64) throw new IOException("model_pin_missing");
            if (!root.mkdirs() && !root.isDirectory()) throw new IOException("storage_unavailable");
            stage = new File(root, "stage-" + java.util.UUID.randomUUID());
            if (!stage.mkdir()) throw new IOException("storage_unavailable");
            archive = new File(stage, "model.zip");
            emit("", "downloading", null, null, 0);
            HttpURLConnection c = (HttpURLConnection) new URL(LocalVoiceModel.URL).openConnection();
            connection = c; c.setConnectTimeout(15000); c.setReadTimeout(15000); c.setInstanceFollowRedirects(false);
            checkDownload();
            if (c.getResponseCode() != 200) throw new IOException("download_failed");
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(archive)) {
                byte[] chunk = new byte[32768]; int n;
                while ((n = in.read(chunk)) != -1) {
                    checkDownload(); total += n;
                    if (total > LocalVoiceModel.BYTES) throw new IOException("model_size_mismatch");
                    out.write(chunk, 0, n); hash.update(chunk, 0, n);
                    int next = (int)(total * 100 / LocalVoiceModel.BYTES);
                    synchronized (this) { if (next != progress) { progress = next; emit("", "downloading", null, null, next); } }
                }
            }
            if (total != LocalVoiceModel.BYTES || !LocalVoiceModel.SHA256.equals(LocalVoiceModel.hex(hash.digest()))) throw new IOException("model_verification_failed");
            LocalVoiceModel.unpack(archive, stage, this::checkDownload);
            synchronized (this) {
                checkDownload();
                if (destroyed) throw new IOException("cancelled");
                if (modelDirectory.exists()) throw new IOException("model_already_exists");
                if (!new File(stage, LocalVoiceModel.NAME).renameTo(modelDirectory)) throw new IOException("model_install_failed");
                progress = 100;
            }
            installed = true;
        } catch (Exception e) {
            // Report after cleanup so status accurately reflects terminal events.
        } finally {
            HttpURLConnection c = connection; connection = null; if (c != null) c.disconnect();
            if (stage != null) LocalVoiceModel.delete(stage);
            synchronized (this) {
                downloading = false;
                emit("", installed ? "ready" : downloadCancelled ? "cancelled" : "error", null,
                    installed || downloadCancelled ? null : "download_failed", installed ? 100 : -1);
            }
        }
    }
}
