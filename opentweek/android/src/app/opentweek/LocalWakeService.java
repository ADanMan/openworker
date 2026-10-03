package app.opentweek;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import java.lang.ref.WeakReference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** A user-started, non-restarting local microphone service; no Activity ownership. */
public final class LocalWakeService extends Service {
    private static final String CHANNEL = "local-wake", STOP = "app.opentweek.STOP_WAKE";
    private static final String PREFS = "local-wake-recovery", RESULT = "result";
    private static volatile WeakReference<LocalVoice> observer = new WeakReference<>(null);
    private static volatile WeakReference<LocalWakeService> live = new WeakReference<>(null);
    private static volatile String activeId = "", activeState = "idle";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private LocalWakeEngine engine;
    private Notification.Builder ongoingNotification;
    static void observe(LocalVoice voice) { observer = new WeakReference<>(voice); }
    static void detach(LocalVoice voice) { if (observer.get() == voice) observer = new WeakReference<>(null); }
    static String state() { return activeState; }
    static String sessionId() { return activeId; }
    static boolean active(String id) { return id != null && !id.isEmpty() && activeId.equals(id); }
    static String recovery(Context context) { return context.getSharedPreferences(PREFS, MODE_PRIVATE).getString(RESULT, ""); }
    static synchronized boolean clearRecovery(Context context, String id) {
        try {
            String json = recovery(context);
            if (json.isEmpty() || !new JSONObject(json).optString("sessionId").equals(id)) return false;
            android.content.SharedPreferences preferences = context.getSharedPreferences(PREFS, MODE_PRIVATE);
            if (!preferences.edit().remove(RESULT).commit()) {
                // commit updates memory even when disk fails: restore the pending item for retry.
                preferences.edit().putString(RESULT, json).commit();
                return false;
            }
            ((NotificationManager)context.getSystemService(NOTIFICATION_SERVICE)).cancel(73);
            return true;
        } catch (Exception ignored) { return false; }
    }
    static synchronized void start(Context context, LocalVoice voice, String id) {
        if (!recovery(context).isEmpty()) { voice.wakeEvent(id, "error", null, "pending_result"); return; }
        observer = new WeakReference<>(voice);
        activeId = id; activeState = "loading";
        Intent intent = new Intent(context, LocalWakeService.class).putExtra("sessionId", id);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException e) { activeId = ""; activeState = "idle"; throw e; }
    }
    static void cancelCurrent(Context context) { String id = activeId; if (!id.isEmpty()) cancel(context, id); }
    static void cancel(Context context, String id) {
        LocalWakeService service = live.get();
        if (service != null) service.main.post(() -> service.end(id, "cancelled", null, null));
        else if (active(id)) {
            activeId = ""; activeState = "idle";
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
    private static void deliver(String id, String state, String text, String error) {
        LocalVoice voice = observer.get(); if (voice != null) voice.wakeEvent(id, state, text, error);
    }
    @Override public void onCreate() { super.onCreate(); live = new WeakReference<>(this); }
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
            NotificationManager manager = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(
                CHANNEL, "Локальный микрофон", NotificationManager.IMPORTANCE_LOW));
            if (!manager.areNotificationsEnabled()
                || (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                || (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL).getImportance() == NotificationManager.IMPORTANCE_NONE)) {
                end(id, "error", null, "notification_permission"); return START_NOT_STICKY;
            }
            Intent stop = new Intent(this, LocalWakeService.class).setAction(STOP)
                .setData(Uri.parse("opentweek-wake:" + Uri.encode(id))).putExtra("sessionId", id);
            PendingIntent action = PendingIntent.getService(this, 0, stop,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder builder = notificationBuilder();
            ongoingNotification = builder;
            Notification notification = builder.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("OpenTweek: локальный микрофон")
                .setContentText("Загружаем локальную модель. Экспериментальный режим.")
                .setContentIntent(openRecovery()).setOngoing(true)
                .addAction(android.R.drawable.ic_media_pause, "Остановить", action).build();
            if (Build.VERSION.SDK_INT >= 29) startForeground(72, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(72, notification);
            promoted = true;
            LocalWakeEngine next = new LocalWakeEngine(getApplicationContext(), id,
                (state, text, error) -> main.post(() -> event(id, state, text, error)));
            engine = next;
            worker.execute(next::run);
        } catch (RuntimeException e) { end(id, "error", null, promoted
            ? LocalVoiceFailure.recognition(e) : LocalVoiceFailure.service(e)); }
        return START_NOT_STICKY;
    }
    private void event(String id, String state, String text, String error) {
        if (!active(id) || engine == null || !engine.id.equals(id)) return;
        if ("released".equals(state)) { end(id, "error", null, "recognition_failed"); return; }
        if ("result".equals(state) || "error".equals(state) || "cancelled".equals(state)) end(id, state, text, error);
        else {
            activeState = state;
            if (ongoingNotification != null) {
                String content = "waiting".equals(state) ? "Слушаем фразу «эй твик»."
                    : "recording".equals(state) ? "Записываем диктовку."
                    : "processing".equals(state) ? "Обрабатываем запись." : null;
                if (content != null) {
                    try {
                        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(72,
                            ongoingNotification.setContentText(content).build());
                    } catch (RuntimeException e) {
                        end(id, "error", null, LocalVoiceFailure.service(e)); return;
                    }
                }
            }
            deliver(id, state, text, error);
        }
    }
    private void end(String id, String state, String text, String error) {
        if (!active(id)) return;
        LocalWakeEngine previous = engine; engine = null;
        ongoingNotification = null;
        if (previous != null) previous.cancel();
        if ("result".equals(state)) {
            text = text == null ? "" : text.trim();
            if (text.isEmpty()) { state = "error"; text = null; error = "no_speech"; }
        }
        if ("result".equals(state)) {
            try {
                String json = new JSONObject().put("sessionId", id).put("text", text == null ? "" : text)
                    .put("createdAt", System.currentTimeMillis()).toString();
                if (!recovery(this).isEmpty() || !getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(RESULT, json).commit())
                    throw new IllegalStateException("recovery_storage_failed");
                Notification complete = notificationBuilder().setSmallIcon(android.R.drawable.ic_menu_edit)
                    .setContentTitle("OpenTweek: диктовка готова")
                    .setContentText("Откройте приложение, чтобы проверить и вставить текст.")
                    .setContentIntent(openRecovery()).setAutoCancel(true).build();
                ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(73, complete);
                state = "wake_result";
            } catch (Exception e) { state = "error"; text = null; error = "recovery_storage_failed"; }
        }
        activeId = ""; activeState = "idle";
        stopForeground(true); stopSelf();
        deliver(id, state, text, error);
    }
    private Notification.Builder notificationBuilder() {
        return Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
    }
    private PendingIntent openRecovery() {
        Intent open = new Intent(this, MainActivity.class).putExtra("wakeRecovery", true)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 73, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    @Override public void onDestroy() {
        LocalWakeEngine previous = engine; engine = null;
        ongoingNotification = null;
        if (previous != null) {
            previous.cancel();
            if (active(previous.id)) { activeId = ""; activeState = "idle"; deliver(previous.id, "cancelled", null, null); }
        }
        worker.shutdownNow();
        if (live.get() == this) live = new WeakReference<>(null);
        stopForeground(true); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
