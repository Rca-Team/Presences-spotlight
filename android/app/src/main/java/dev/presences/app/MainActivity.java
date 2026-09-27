package dev.presences.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "PresencesShare";
    public static String sPendingSharedMediaJson = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Enable modern Android 15 Edge-to-Edge System Bar Layout
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // 2. Hardware acceleration and WebView optimization for WebGL Face Recognition
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                WebSettings settings = webView.getSettings();

                // Enable DOM and Local Database storage
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

                // JavaScript bridge to access pending shared media synchronously on app startup
                webView.addJavascriptInterface(new Object() {
                    @android.webkit.JavascriptInterface
                    public String getPendingSharedMedia() {
                        String data = sPendingSharedMediaJson;
                        sPendingSharedMediaJson = null;
                        return data;
                    }
                }, "AndroidShareBridge");
            }
        } catch (Exception e) {
            Log.e(TAG, "WebView configuration error", e);
        }

        // Process any launch intent containing shared media
        processSendIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        processSendIntent(intent);
    }

    private void processSendIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        if (action == null) return;

        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            new Thread(() -> {
                try {
                    List<Uri> uris = new ArrayList<>();
                    if (Intent.ACTION_SEND.equals(action)) {
                        Uri streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                        if (streamUri != null) {
                            uris.add(streamUri);
                        } else if (intent.getData() != null) {
                            uris.add(intent.getData());
                        }
                    } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                        ArrayList<Uri> streamUris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                        if (streamUris != null) {
                            uris.addAll(streamUris);
                        }
                    }

                    if (uris.isEmpty()) return;

                    JSONArray filesArray = new JSONArray();
                    for (Uri uri : uris) {
                        JSONObject fileObj = convertUriToJson(this, uri, type);
                        if (fileObj != null) {
                            filesArray.put(fileObj);
                        }
                    }

                    if (filesArray.length() == 0) return;

                    JSONObject result = new JSONObject();
                    result.put("files", filesArray);
                    result.put("action", action);
                    result.put("mimeType", type);
                    result.put("timestamp", System.currentTimeMillis());

                    final String jsonStr = result.toString();
                    sPendingSharedMediaJson = jsonStr;

                    // Dispatch to web if webview is active
                    runOnUiThread(() -> dispatchSharedMediaToWeb(jsonStr));
                } catch (Exception e) {
                    Log.e(TAG, "Error processing share intent", e);
                }
            }).start();
        }
    }

    private void dispatchSharedMediaToWeb(final String jsonPayload) {
        if (jsonPayload == null) return;
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                String escapedPayload = JSONObject.quote(jsonPayload);
                String js = "(function() { " +
                        "try { " +
                        "  var data = JSON.parse(" + escapedPayload + "); " +
                        "  window.dispatchEvent(new CustomEvent('presences_shared_media', { detail: data })); " +
                        "  if (typeof window.__onPresencesSharedMedia === 'function') { window.__onPresencesSharedMedia(data); } " +
                        "} catch(e) { console.error('Presences dispatch error', e); }" +
                        "})();";
                webView.evaluateJavascript(js, null);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to dispatch share payload to web", e);
        }
    }

    private static JSONObject convertUriToJson(Context context, Uri uri, String defaultType) {
        try {
            ContentResolver cr = context.getContentResolver();
            String mime = cr.getType(uri);
            if (mime == null || mime.isEmpty()) {
                mime = defaultType != null ? defaultType : "image/jpeg";
            }

            String fileName = "shared_file_" + System.currentTimeMillis();
            try {
                Cursor cursor = cr.query(uri, null, null, null, null);
                if (cursor != null) {
                    try {
                        if (cursor.moveToFirst()) {
                            int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                            if (nameIndex >= 0) {
                                String name = cursor.getString(nameIndex);
                                if (name != null && !name.trim().isEmpty()) {
                                    fileName = name;
                                }
                            }
                        }
                    } finally {
                        cursor.close();
                    }
                }
            } catch (Exception ignored) {}

            String dataUrl = null;
            if (mime.startsWith("image/")) {
                InputStream isCheck = cr.openInputStream(uri);
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inJustDecodeBounds = true;
                BitmapFactory.decodeStream(isCheck, null, opts);
                if (isCheck != null) isCheck.close();

                int maxDim = Math.max(opts.outWidth, opts.outHeight);
                int inSampleSize = 1;
                while (maxDim / inSampleSize > 1920) {
                    inSampleSize *= 2;
                }

                opts.inJustDecodeBounds = false;
                opts.inSampleSize = inSampleSize;

                InputStream isDecode = cr.openInputStream(uri);
                Bitmap bitmap = BitmapFactory.decodeStream(isDecode, null, opts);
                if (isDecode != null) isDecode.close();

                if (bitmap != null) {
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 90, baos);
                    byte[] bytes = baos.toByteArray();
                    String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                    dataUrl = "data:image/jpeg;base64," + base64;
                    bitmap.recycle();
                }
            } else {
                InputStream is = cr.openInputStream(uri);
                if (is != null) {
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = is.read(buf)) != -1) {
                        baos.write(buf, 0, n);
                    }
                    is.close();
                    String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                    dataUrl = "data:" + mime + ";base64," + base64;
                }
            }

            if (dataUrl != null) {
                JSONObject obj = new JSONObject();
                obj.put("name", fileName);
                obj.put("type", mime);
                obj.put("dataUrl", dataUrl);
                return obj;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error reading shared Uri: " + uri, e);
        }
        return null;
    }
}
