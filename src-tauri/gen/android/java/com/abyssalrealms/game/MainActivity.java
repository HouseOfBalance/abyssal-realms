package com.abyssalrealms.game;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Fullscreen Immersive Android Activity hosting the Rust-powered Abyssal Realms 3D game
 * with Cross-Play WebRTC P2P, WebSocket Relay, and 3D Spatial Voice Chat support.
 */
public final class MainActivity extends Activity {
    private static final int REQ_RECORD_AUDIO = 2001;

    private WebView webView;
    private LocalAssetServer assetServer;
    private PermissionRequest pendingWebPermission;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        applyImmersiveFullscreen();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#07060A"));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // Attach JNI Rust Native Core bridge as `window.AbyssalRust`
        webView.addJavascriptInterface(new RustBridge(this), "AbyssalRust");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebRtcPermission(request));
            }
        });

        try {
            assetServer = new LocalAssetServer(getAssets());
            int port = assetServer.start();
            String query = extractRoomQueryFromIntent(getIntent());
            webView.loadUrl("http://127.0.0.1:" + port + "/index.html" + query);
        } catch (Throwable t) {
            webView.loadUrl("file:///android_asset/www/index.html");
        }
    }

    private String extractRoomQueryFromIntent(Intent intent) {
        if (intent == null) return "";
        Uri data = intent.getData();
        if (data != null && data.getQueryParameter("room") != null) {
            return "?room=" + data.getQueryParameter("room");
        }
        return "";
    }

    private void handleWebRtcPermission(PermissionRequest request) {
        boolean needsAudio = false;
        for (String res : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                needsAudio = true;
                break;
            }
        }
        if (needsAudio && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                pendingWebPermission = request;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
                return;
            }
        }
        request.grant(request.getResources());
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_RECORD_AUDIO && pendingWebPermission != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingWebPermission.grant(pendingWebPermission.getResources());
            } else {
                pendingWebPermission.deny();
            }
            pendingWebPermission = null;
        }
    }

    private void applyImmersiveFullscreen() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveFullscreen();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            // Route Android physical/gesture Back button to in-game Escape key (Pause / Close Modal)
            webView.evaluateJavascript(
                    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));",
                    null
            );
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
        applyImmersiveFullscreen();
    }

    @Override
    protected void onDestroy() {
        if (assetServer != null) {
            assetServer.stop();
            assetServer = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
