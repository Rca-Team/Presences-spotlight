package dev.presences.app;

import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Enable modern Android 15 Edge-to-Edge System Bar Layout
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // 2. Hardware acceleration and WebView optimization for WebGL Face Recognition
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();

                // Enable DOM and Local Database storage for offline sync
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);

                // Allow WebAudio announcements to play without requiring user tap
                settings.setMediaPlaybackRequiresUserGesture(false);

                // Allow mixed content for local LAN camera endpoints if needed
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

                // Enable GPU hardware acceleration
                webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);

                // Auto-grant camera permissions in WebChromeClient for smooth Face Scanner
                webView.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onPermissionRequest(PermissionRequest request) {
                        runOnUiThread(() -> request.grant(request.getResources()));
                    }
                });
            }
        } catch (Exception e) {
            // Log fallback
            e.printStackTrace();
        }
    }
}
