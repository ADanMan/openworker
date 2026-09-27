package app.opentweek;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;

import org.json.JSONObject;

/**
 * Hosts the web app in a WebView. Assets are served from the APK under a
 * private https origin, so IndexedDB, crypto.randomUUID and other
 * secure-context APIs work exactly as in the browser.
 */
public class MainActivity extends Activity {
    static final String HOST = "app.opentweek.local";
    static final String START_URL = "https://" + HOST + "/index.html";
    static final int REQ_FILE = 1;
    static final int REQ_SAVE = 2;
    static final int REQ_NOTIFICATIONS = 3;
    static final int REQ_VOICE = 4;
    static final String ACTION_VOICE = "app.opentweek.action.VOICE";
    static final String ACTION_NEW = "app.opentweek.action.NEW";

    WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingSave;
    /** Pending external intent as JSON for the page (see NativeBridge.takeIntent); "" if none. */
    String pendingIntent = "";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Reminders.createChannel(this);

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new NativeBridge(this), "OpenTweekNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!HOST.equals(url.getHost())) return null;
                return serveAsset(url.getPath());
            }

            // The String overload is the one available in API 23; on 24+ the default
            // WebResourceRequest overload delegates to it.
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String link) {
                Uri url = Uri.parse(link);
                if (HOST.equals(url.getHost())) return false;
                // Links to the outside world open in the user's browser.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });

        Shortcuts.install(this);
        readIntent(getIntent());
        if (state != null) web.restoreState(state);
        else web.loadUrl(START_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (readIntent(intent)) js("window.dispatchEvent(new Event('ot-intent'))");
    }

    /**
     * Translate an incoming Intent into JSON for the page:
     * reminder tap, launcher shortcut, or text shared from another app.
     */
    private boolean readIntent(Intent intent) {
        if (intent == null) return false;
        try {
            JSONObject o = new JSONObject();
            String action = intent.getAction();
            if (intent.getStringExtra("taskId") != null) {
                o.put("kind", "task");
                o.put("taskId", intent.getStringExtra("taskId"));
                o.put("date", intent.getStringExtra("date") == null ? "" : intent.getStringExtra("date"));
            } else if (ACTION_VOICE.equals(action)) {
                o.put("kind", "voice");
            } else if (ACTION_NEW.equals(action)) {
                o.put("kind", "new");
            } else if (Intent.ACTION_SEND.equals(action) || "com.google.android.gm.action.AUTO_SEND".equals(action)) {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if (text == null || text.toString().trim().isEmpty()) return false;
                String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                String body = text.toString();
                // Links shared from a browser come as "Title https://…": keep both.
                if (subject != null && !body.contains(subject)) body = subject + " " + body;
                o.put("kind", "text");
                o.put("text", body.length() > 2000 ? body.substring(0, 2000) : body);
            } else {
                return false;
            }
            pendingIntent = o.toString();
            // Consume it so a configuration change does not replay it.
            setIntent(new Intent(this, MainActivity.class));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    void startVoice(final String lang, final String prompt) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                if (lang != null && !lang.isEmpty()) i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                if (prompt != null && !prompt.isEmpty()) i.putExtra(RecognizerIntent.EXTRA_PROMPT, prompt);
                i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                try {
                    startActivityForResult(i, REQ_VOICE);
                } catch (Exception e) {
                    js("window.__otVoice && window.__otVoice(false," + JSONObject.quote("unavailable") + ")");
                }
            }
        });
    }

    boolean voiceAvailable() {
        return !getPackageManager()
                .queryIntentActivities(new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), 0)
                .isEmpty();
    }

    private static final HashMap<String, String> MIME = new HashMap<String, String>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff2", "font/woff2");
        MIME.put("txt", "text/plain");
    }

    WebResourceResponse serveAsset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        String file = path.substring(1);
        int dot = file.lastIndexOf('.');
        String ext = dot < 0 ? "" : file.substring(dot + 1);
        String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
        try {
            InputStream in = getAssets().open("www/" + file);
            WebResourceResponse res = new WebResourceResponse(mime, "UTF-8", in);
            HashMap<String, String> headers = new HashMap<String, String>();
            headers.put("Cache-Control", "no-cache");
            res.setResponseHeaders(headers);
            return res;
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }
    }

    /** Run JavaScript on the UI thread. */
    void js(final String code) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(code, null);
            }
        });
    }

    @Override
    public void onBackPressed() {
        // Let the page close a dialog first; leave the app only if nothing was open.
        web.evaluateJavascript("(window.__otBack ? window.__otBack() : false)", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) moveTaskToBack(true);
            }
        });
    }

    void startSave(final String name, final String mime, final String base64) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                pendingSave = Base64.decode(base64, Base64.DEFAULT);
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                i.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(i, REQ_SAVE);
                } catch (Exception e) {
                    pendingSave = null;
                    Toast.makeText(MainActivity.this, R.string.save_failed, Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIFICATIONS);
                }
            });
        } else {
            js("window.__otNotifResult && window.__otNotifResult(" + Reminders.notificationsAllowed(this) + ")");
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code == REQ_NOTIFICATIONS) {
            js("window.__otNotifResult && window.__otNotifResult(" + Reminders.notificationsAllowed(this) + ")");
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_VOICE) {
            String heard = "";
            if (result == RESULT_OK && data != null) {
                ArrayList<String> matches = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (matches != null && !matches.isEmpty()) heard = matches.get(0);
            }
            // Cancelled or silent: resolve with "" so the page simply does nothing.
            js("window.__otVoice && window.__otVoice(true," + JSONObject.quote(heard) + ")");
        } else if (code == REQ_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
                fileCallback = null;
            }
        } else if (code == REQ_SAVE) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (result != RESULT_OK || data == null || data.getData() == null || bytes == null) return;
            try {
                OutputStream out = getContentResolver().openOutputStream(data.getData());
                out.write(bytes);
                out.close();
                Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, R.string.save_failed, Toast.LENGTH_SHORT).show();
            }
        }
    }
}
