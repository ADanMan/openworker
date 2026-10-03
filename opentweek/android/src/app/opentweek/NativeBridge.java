package app.opentweek;

import android.content.Intent;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** The `window.OpenTweekNative` object. Every method is called on a WebView background thread. */
public class NativeBridge {
    private final MainActivity activity;

    NativeBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String platform() {
        return "android";
    }

    @JavascriptInterface
    public boolean notificationsAllowed() {
        return Reminders.notificationsAllowed(activity);
    }

    /** Asks for POST_NOTIFICATIONS; the answer arrives via window.__otNotifResult(boolean). */
    @JavascriptInterface
    public void requestNotifications() {
        activity.requestNotificationPermission();
    }

    /** Replace all scheduled reminders. JSON: [{id, at (epoch ms), title, body, taskId, date}] */
    @JavascriptInterface
    public void setReminders(String json) {
        Reminders.replace(activity, json);
    }

    @JavascriptInterface
    public void share(String title, String text) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.putExtra(Intent.EXTRA_TEXT, text);
        Intent chooser = Intent.createChooser(send, activity.getString(R.string.share));
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(chooser);
    }

    /** Opens the system "Save as" picker and writes the base64 payload there. */
    @JavascriptInterface
    public void saveFile(String name, String mime, String base64) {
        activity.startSave(name, mime, base64);
    }

    /**
     * The external intent that opened or re-focused the app, as JSON, consumed once; "" if none.
     * {"kind":"task","taskId","date"} | {"kind":"voice"} | {"kind":"new"} | {"kind":"text","text"}
     */
    @JavascriptInterface
    public String takeIntent() {
        String t = activity.pendingIntent;
        activity.pendingIntent = "";
        return t;
    }

    @JavascriptInterface
    public boolean voiceAvailable() {
        return activity.voiceAvailable();
    }

    /** Disabled legacy entry point. Use explicit local dictation session methods. */
    @JavascriptInterface
    public void startVoice(String lang, String prompt) {
        activity.startVoice(lang, prompt);
    }

    @JavascriptInterface public String localVoiceStatus() { return activity.localVoice.status(); }
    @JavascriptInterface public void downloadLocalVoiceModel() { activity.localVoice.download(); }
    @JavascriptInterface public void cancelLocalVoiceDownload() { activity.localVoice.cancelDownload(); }
    @JavascriptInterface public void startLocalVoice(String sessionId) { activity.localVoice.start(sessionId); }
    @JavascriptInterface public void startLocalWake(String sessionId) { activity.localVoice.startWake(sessionId); }
    @JavascriptInterface public void startLocalOverlay(String sessionId) { activity.localVoice.startOverlay(sessionId); }
    @JavascriptInterface public void stopLocalOverlay(String sessionId) {
        // Queue after start's UI-thread work, including when the permission dialog has not opened yet.
        activity.runOnUiThread(() -> activity.localVoice.cancel(sessionId));
    }
    @JavascriptInterface public void requestLocalOverlayPermission() {
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:" + activity.getPackageName())));
            } catch (RuntimeException e) { LocalWakeService.reportOverlayError("overlay_settings_unavailable"); }
        });
    }
    @JavascriptInterface public String localWakeRecovery() { return LocalWakeService.recovery(activity.getApplicationContext()); }
    @JavascriptInterface public boolean clearLocalWakeRecovery(String sessionId) { return LocalWakeService.clearRecovery(activity.getApplicationContext(), sessionId); }
    @JavascriptInterface public void stopLocalVoice(String sessionId) { activity.localVoice.stop(sessionId); }
    @JavascriptInterface public void cancelLocalVoice(String sessionId) { activity.localVoice.cancel(sessionId); }

    @JavascriptInterface
    public void minimize() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.moveTaskToBack(true);
            }
        });
    }

    private static final int MAX_FETCH_BYTES = 8 * 1024 * 1024;

    /**
     * GET a calendar feed outside the WebView, so ICS links work without CORS.
     * Result: window.__otFetch(id, ok, textOrError). Only http(s) URLs are allowed.
     */
    @JavascriptInterface
    public void fetchText(final int id, final String url) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean ok = false;
                String result;
                try {
                    if (!url.startsWith("https://") && !url.startsWith("http://")) throw new Exception("unsupported URL");
                    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setInstanceFollowRedirects(true);
                    conn.setRequestProperty("Accept", "text/calendar, */*");
                    int code = conn.getResponseCode();
                    if (code / 100 != 2) throw new Exception("HTTP " + code);
                    InputStream in = conn.getInputStream();
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] chunk = new byte[16384];
                    int n;
                    while ((n = in.read(chunk)) > 0) {
                        buf.write(chunk, 0, n);
                        if (buf.size() > MAX_FETCH_BYTES) throw new Exception("feed is larger than 8 MB");
                    }
                    in.close();
                    conn.disconnect();
                    result = buf.toString("UTF-8");
                    ok = true;
                } catch (Exception e) {
                    result = String.valueOf(e.getMessage());
                }
                activity.js("window.__otFetch && window.__otFetch(" + id + "," + ok + "," + JSONObject.quote(result) + ")");
            }
        }).start();
    }
}
