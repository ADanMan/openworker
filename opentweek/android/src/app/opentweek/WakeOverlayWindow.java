package app.opentweek;

import android.graphics.Color;
import android.net.Uri;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.HashMap;

/** Small, branded, secure window. Only packaged overlay code sees its narrow bridge. */
final class WakeOverlayWindow {
    private final LocalWakeService service;
    private final String owner;
    private final WindowManager manager;
    private LinearLayout root;
    private WebView web;
    WakeOverlayWindow(LocalWakeService service, String owner) {
        this.service = service; this.owner = owner; manager = (WindowManager)service.getSystemService(android.content.Context.WINDOW_SERVICE);
    }
    void show() {
        float density = service.getResources().getDisplayMetrics().density;
        int screenWidth = service.getResources().getDisplayMetrics().widthPixels;
        int screenHeight = service.getResources().getDisplayMetrics().heightPixels;
        root = new LinearLayout(service); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.WHITE);
        LinearLayout header = new LinearLayout(service);
        TextView title = new TextView(service); title.setText("OpenTweek · дневник"); title.setTextColor(Color.BLACK);
        title.setPadding((int)(12*density), 0, 0, 0); header.addView(title, new LinearLayout.LayoutParams(0, -1, 1));
        Button cancel = new Button(service); cancel.setText("Отмена"); cancel.setOnClickListener(v -> service.cancelOverlayCapture(owner)); header.addView(cancel);
        Button stop = new Button(service); stop.setText("Выключить"); stop.setOnClickListener(v -> LocalWakeService.cancel(service, owner)); header.addView(stop);
        root.addView(header, new LinearLayout.LayoutParams(-1, (int)(52*density)));
        web = new WebView(service); WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new Bridge(), "OpenTweekOverlay");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl(); String path = url.getPath();
                if (!"https".equals(url.getScheme()) || !MainActivity.HOST.equals(url.getHost()) || path == null
                    || path.contains("..") || !(path.equals("/overlay.html") || path.startsWith("/assets/"))) return blocked();
                try {
                    String type = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream";
                    return new WebResourceResponse(type, "UTF-8", service.getAssets().open("www" + path));
                } catch (IOException e) { return blocked(); }
            }
            private WebResourceResponse blocked() { return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", new HashMap<String,String>(), new ByteArrayInputStream(new byte[0])); }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        int height = Math.min((int)(420*density), (int)(screenHeight * .65));
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(Math.min((int)(400*density), screenWidth-(int)(24*density)), height,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_SECURE,
            android.graphics.PixelFormat.OPAQUE);
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL; params.y = (int)(64*density);
        params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        manager.addView(root, params); web.loadUrl("https://" + MainActivity.HOST + "/overlay.html");
    }
    void close() {
        if (root != null) { try { manager.removeViewImmediate(root); } catch (RuntimeException ignored) { } root = null; }
        if (web != null) { web.removeJavascriptInterface("OpenTweekOverlay"); web.destroy(); web = null; }
    }
    private final class Bridge {
        @JavascriptInterface public String status() { return service.overlayStatus(owner); }
        @JavascriptInterface public void finish() { LocalWakeService.finish(service, owner); }
        @JavascriptInterface public void cancel() { service.cancelOverlayCapture(owner); }
        @JavascriptInterface public void stop() { LocalWakeService.cancel(service, owner); }
        @JavascriptInterface public boolean beginSave(String resultId) { return LocalWakeService.beginOverlaySave(service, owner, resultId); }
        @JavascriptInterface public void releaseSave() { LocalWakeService.releaseOverlaySave(owner); }
        @JavascriptInterface public boolean acknowledge(String resultId) { return LocalWakeService.clearRecovery(service, resultId); }
    }
}
