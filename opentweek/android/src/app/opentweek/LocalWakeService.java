package app.opentweek;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import java.lang.ref.WeakReference;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** User-started local microphone. The optional repeat mode never restarts itself after service death. */
public final class LocalWakeService extends Service {
    private static final String CHANNEL = "local-wake", STOP = "app.opentweek.STOP_WAKE";
    private static final String PREFS = "local-wake-recovery", RESULT = "result";
    private static volatile WeakReference<LocalVoice> observer = new WeakReference<>(null);
    private static volatile WeakReference<LocalWakeService> live = new WeakReference<>(null);
    private static volatile String activeId = "", activeState = "idle", overlayError = "";
    private static volatile boolean overlayMode, overlaySaving;
    private static volatile WakeOverlaySession repeat;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private LocalWakeEngine engine;
    private Notification.Builder ongoingNotification;
    private WakeOverlayWindow window;
    private int generation;
    private boolean cancellingCapture;
    private final BroadcastReceiver screenOff = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (overlayActive()) end(activeId, "error", null, "screen_locked");
        }
    };
    private final Runnable guard = new Runnable() {
        @Override public void run() {
            if (!overlayActive()) return;
            if (overlayRemaining() == 0) { end(activeId, "error", null, "overlay_timeout"); return; }
            if (!Settings.canDrawOverlays(LocalWakeService.this)) { end(activeId, "error", null, "overlay_permission"); return; }
            if (((KeyguardManager)getSystemService(KEYGUARD_SERVICE)).isKeyguardLocked()
                || !((PowerManager)getSystemService(POWER_SERVICE)).isInteractive()) { end(activeId, "error", null, "screen_locked"); return; }
            if (!notificationsVisible()) {
                end(activeId, "error", null, "notification_permission"); return;
            }
            main.postDelayed(this, 1000);
        }
    };
    static void observe(LocalVoice voice) { observer = new WeakReference<>(voice); }
    static void detach(LocalVoice voice) { if (observer.get() == voice) observer = new WeakReference<>(null); }
    static String state() { return activeState; }
    static String sessionId() { return activeId; }
    static boolean active(String id) { return id != null && !id.isEmpty() && activeId.equals(id); }
    static boolean overlayActive() { return overlayMode && !activeId.isEmpty(); }
    static long overlayRemaining() { WakeOverlaySession s = repeat; return s == null ? 0 : s.remaining(SystemClock.elapsedRealtime()); }
    static String overlayError() { return overlayError; }
    static void reportOverlayError(String error) { overlayError = error == null ? "" : error; }
    static String recovery(Context context) { return context.getSharedPreferences(PREFS, MODE_PRIVATE).getString(RESULT, ""); }
    static synchronized boolean clearRecovery(Context context, String id) {
        try {
            String json = recovery(context);
            if (json.isEmpty() || !new JSONObject(json).optString("sessionId").equals(id)) return false;
            android.content.SharedPreferences preferences = context.getSharedPreferences(PREFS, MODE_PRIVATE);
            if (!preferences.edit().remove(RESULT).commit()) {
                preferences.edit().putString(RESULT, json).commit();
                return false;
            }
            ((NotificationManager)context.getSystemService(NOTIFICATION_SERVICE)).cancel(73);
            LocalWakeService service = live.get();
            if (service != null && overlayActive()) { String owner = activeId; service.main.post(() -> service.resumeAfterReview(owner)); }
            return true;
        } catch (Exception ignored) { return false; }
    }
    static synchronized boolean beginOverlaySave(Context context, String owner, String resultId) {
        if (!active(owner) || !overlayActive() || !"review".equals(activeState) || overlaySaving) return false;
        try {
            if (!new JSONObject(recovery(context)).optString("sessionId").equals(resultId)) return false;
            overlaySaving = true; return true;
        } catch (Exception e) { return false; }
    }
    static void releaseOverlaySave(String owner) { if (active(owner)) overlaySaving = false; }
    static synchronized void start(Context context, LocalVoice voice, String id) { start(context, voice, id, false); }
    static synchronized void start(Context context, LocalVoice voice, String id, boolean overlay) {
        if (!recovery(context).isEmpty()) {
            if (overlay) reportOverlayError("pending_result");
            voice.wakeEvent(id, "error", null, "pending_result"); return;
        }
        observer = new WeakReference<>(voice);
        activeId = id; activeState = "loading"; overlayMode = overlay; overlaySaving = false;
        repeat = overlay ? new WakeOverlaySession(SystemClock.elapsedRealtime()) : null;
        if (overlay) reportOverlayError("");
        Intent intent = new Intent(context, LocalWakeService.class).putExtra("sessionId", id);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException e) { activeId = ""; activeState = "idle"; overlayMode = false; repeat = null; throw e; }
    }
    static void cancelCurrent(Context context) { String id = activeId; if (!id.isEmpty()) cancel(context, id); }
    static void cancel(Context context, String id) {
        LocalWakeService service = live.get();
        if (service != null) service.main.post(() -> service.end(id, "cancelled", null, null));
        else if (active(id)) {
            activeId = ""; activeState = "idle"; overlayMode = false;
            WakeOverlaySession s = repeat; if (s != null) s.stop(); repeat = null;
            deliver(id, "cancelled", null, null);
            context.stopService(new Intent(context, LocalWakeService.class));
        }
    }
    static void finish(Context context, String id) {
        LocalWakeService service = live.get();
        if (service == null) { cancel(context, id); return; }
        service.main.post(() -> {
            if (!active(id) || service.engine == null || !service.engine.id.equals(id)) return;
            service.engine.finish();
        });
    }
    void cancelOverlayCapture(String owner) {
        main.post(() -> {
            if (!active(owner) || !overlayActive() || overlaySaving) return;
            String pending = recovery(this);
            if (!pending.isEmpty()) {
                try {
                    if (!clearRecovery(this, new JSONObject(pending).getString("sessionId"))) return;
                } catch (Exception e) { return; }
            }
            dismissWindow();
            repeat.requestResume(); cancellingCapture = true; activeState = "loading";
            if (engine != null) engine.cancel();
            else { repeat.released(); cancellingCapture = false; maybeResume(); }
        });
    }
    String overlayStatus(String owner) {
        try {
            JSONObject status = new JSONObject().put("sessionId", owner)
                .put("state", active(owner) && overlayActive() ? activeState : "stopped");
            String pending = recovery(this);
            if (!pending.isEmpty()) {
                JSONObject result = new JSONObject(pending);
                if (owner.equals(result.optString("ownerSessionId"))) status.put("result", result);
            }
            return status.toString();
        } catch (Exception e) { return "{}"; }
    }
    private static void deliver(String id, String state, String text, String error) {
        LocalVoice voice = observer.get(); if (voice != null) voice.wakeEvent(id, state, text, error);
    }
    @Override public void onCreate() {
        super.onCreate(); live = new WeakReference<>(this);
        IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenOff, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(screenOff, filter);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String id = intent == null ? null : intent.getStringExtra("sessionId");
        if (intent != null && STOP.equals(intent.getAction())) {
            end(id, "cancelled", null, null);
            if (activeId.isEmpty()) { stopForeground(true); stopSelf(startId); }
            return START_NOT_STICKY;
        }
        if (!active(id)) { if (activeId.isEmpty()) stopSelf(startId); return START_NOT_STICKY; }
        if (engine != null && engine.id.equals(id)) return START_NOT_STICKY;
        if (engine != null) engine.cancel();
        boolean promoted = false;
        try {
            if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                end(id, "error", null, "permission_denied"); return START_NOT_STICKY;
            }
            if (overlayActive() && (Build.VERSION.SDK_INT < 26 || !Settings.canDrawOverlays(this))) {
                end(id, "error", null, "overlay_permission"); return START_NOT_STICKY;
            }
            NotificationManager manager = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Локальный микрофон", NotificationManager.IMPORTANCE_LOW));
            if (!notificationsVisible()) {
                end(id, "error", null, "notification_permission"); return START_NOT_STICKY;
            }
            Intent stop = new Intent(this, LocalWakeService.class).setAction(STOP)
                .setData(Uri.parse("opentweek-wake:" + Uri.encode(id))).putExtra("sessionId", id);
            PendingIntent action = PendingIntent.getService(this, 0, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            ongoingNotification = notificationBuilder().setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(overlayActive() ? "OpenTweek: вызов из приложений" : "OpenTweek: локальный микрофон")
                .setContentText("Загружаем локальную модель. Экспериментальный режим.")
                .setContentIntent(openRecovery()).setOngoing(true)
                .addAction(android.R.drawable.ic_media_pause, "Остановить", action);
            if (Build.VERSION.SDK_INT >= 29) startForeground(72, ongoingNotification.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(72, ongoingNotification.build());
            promoted = true;
            startCapture();
            if (overlayActive()) { main.removeCallbacks(guard); main.post(guard); }
        } catch (RuntimeException e) { end(id, "error", null, promoted ? LocalVoiceFailure.recognition(e) : LocalVoiceFailure.service(e)); }
        return START_NOT_STICKY;
    }
    private void startCapture() {
        String id = activeId;
        if (id.isEmpty()) return;
        if (overlayActive()) { if (overlayRemaining() == 0) { end(id, "error", null, "overlay_timeout"); return; } repeat.captured(); }
        int token = ++generation;
        LocalWakeEngine next = new LocalWakeEngine(getApplicationContext(), id,
            (state, text, error) -> main.post(() -> event(id, token, state, text, error)),
            overlayActive() ? overlayRemaining() : WakePhrase.WAIT_LIMIT_MS);
        engine = next; activeState = "loading"; cancellingCapture = false;
        worker.execute(next::run);
    }
    private void event(String id, int token, String state, String text, String error) {
        if (!active(id) || engine == null || token != generation || !engine.id.equals(id)) return;
        if (overlayActive() && "released".equals(state)) {
            engine = null; repeat.released();
            cancellingCapture = false; maybeResume();
            return;
        }
        if (cancellingCapture) return;
        if ("released".equals(state)) { end(id, "error", null, "recognition_failed"); return; }
        if (overlayActive() && "result".equals(state)) {
            if (text == null || text.trim().isEmpty()) { end(id, "error", null, "no_speech"); return; }
            try {
                JSONObject result = new JSONObject().put("sessionId", UUID.randomUUID().toString()).put("ownerSessionId", id)
                    .put("text", text.trim()).put("date", new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date()))
                    .put("createdAt", System.currentTimeMillis()).put("overlay", true);
                if (!recovery(this).isEmpty() || !getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(RESULT, result.toString()).commit())
                    throw new IllegalStateException();
                activeState = "review";
                updateNotification("Микрофон выключен · проверьте текст в окне.");
                showWindow();
                deliver(id, "wake_result", null, null);
            } catch (Exception e) { end(id, "error", null, "recovery_storage_failed"); }
            return;
        }
        if ("result".equals(state) || "error".equals(state) || "cancelled".equals(state)) end(id, state, text, error);
        else {
            activeState = state;
            String content = "waiting".equals(state) ? "Слушаем «эй твик» · микрофон включён." : "recording".equals(state)
                ? "Записываем диктовку." : "processing".equals(state) ? "Обрабатываем запись." : null;
            if (content != null && !updateNotification(content)) return;
            if (overlayActive() && "recording".equals(state) && !showWindow()) return;
            deliver(id, state, text, error);
        }
    }
    private boolean showWindow() {
        try {
            if (!Settings.canDrawOverlays(this)) throw new IllegalStateException();
            if (((KeyguardManager)getSystemService(KEYGUARD_SERVICE)).isKeyguardLocked()) { end(activeId, "error", null, "screen_locked"); return false; }
            if (window == null) { window = new WakeOverlayWindow(this, activeId); window.show(); }
            return true;
        } catch (RuntimeException e) { end(activeId, "error", null, "overlay_unavailable"); return false; }
    }
    private void dismissWindow() { if (window != null) { window.close(); window = null; } }
    private boolean updateNotification(String content) {
        if (ongoingNotification == null) return false;
        try { ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(72, ongoingNotification.setContentText(content).build()); return true; }
        catch (RuntimeException e) { end(activeId, "error", null, LocalVoiceFailure.service(e)); return false; }
    }
    private void resumeAfterReview(String owner) {
        if (!active(owner) || !overlayActive()) return;
        overlaySaving = false; dismissWindow(); repeat.requestResume(); maybeResume();
    }
    private void maybeResume() {
        if (overlayActive() && repeat.takeResume(SystemClock.elapsedRealtime(), !recovery(this).isEmpty())) {
            updateNotification("Слушаем «эй твик» · микрофон включён.");
            if (overlayActive()) startCapture();
        }
    }
    private void end(String id, String state, String text, String error) {
        if (!active(id)) return;
        if (overlayActive() && "error".equals(state)) reportOverlayError(error);
        WakeOverlaySession s = repeat; if (s != null) s.stop();
        repeat = null; overlayMode = false; overlaySaving = false; main.removeCallbacks(guard); dismissWindow();
        LocalWakeEngine previous = engine; engine = null; ongoingNotification = null;
        if (previous != null) previous.cancel();
        if ("result".equals(state)) {
            text = text == null ? "" : text.trim();
            if (text.isEmpty()) { state = "error"; text = null; error = "no_speech"; }
        }
        if ("result".equals(state)) {
            try {
                String json = new JSONObject().put("sessionId", id).put("text", text == null ? "" : text).put("createdAt", System.currentTimeMillis()).toString();
                if (!recovery(this).isEmpty() || !getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(RESULT, json).commit()) throw new IllegalStateException();
                Notification complete = notificationBuilder().setSmallIcon(android.R.drawable.ic_menu_edit).setContentTitle("OpenTweek: диктовка готова")
                    .setContentText("Откройте приложение, чтобы проверить и вставить текст.").setContentIntent(openRecovery()).setAutoCancel(true).build();
                ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(73, complete); state = "wake_result";
            } catch (Exception e) { state = "error"; text = null; error = "recovery_storage_failed"; }
        }
        activeId = ""; activeState = "idle"; stopForeground(true); stopSelf(); deliver(id, state, text, error);
    }
    private Notification.Builder notificationBuilder() { return Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this); }
    private boolean notificationsVisible() {
        NotificationManager manager = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel = Build.VERSION.SDK_INT >= 26 ? manager.getNotificationChannel(CHANNEL) : null;
        return manager.areNotificationsEnabled()
            && (Build.VERSION.SDK_INT < 33 || checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            && (Build.VERSION.SDK_INT < 26 || (channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE));
    }
    private PendingIntent openRecovery() {
        Intent open = new Intent(this, MainActivity.class).putExtra("wakeRecovery", true).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 73, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    @Override public void onDestroy() {
        main.removeCallbacks(guard); unregisterReceiver(screenOff); dismissWindow();
        LocalWakeEngine previous = engine; engine = null; ongoingNotification = null;
        if (previous != null) previous.cancel();
        if (live.get() == this) {
            String id = activeId; activeId = ""; activeState = "idle"; overlayMode = false; overlaySaving = false;
            WakeOverlaySession s = repeat; if (s != null) s.stop(); repeat = null;
            live = new WeakReference<>(null); if (!id.isEmpty()) deliver(id, "cancelled", null, null);
        }
        worker.shutdownNow(); stopForeground(true); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
