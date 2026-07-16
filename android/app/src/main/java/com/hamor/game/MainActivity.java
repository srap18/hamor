package com.hamor.game;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.util.ArrayList;
import java.util.List;

/**
 * MainActivity — يمنح أذونات المايك والكاميرا والصور تلقائياً داخل WebView
 * ويطلب أذونات النظام عند الحاجة.
 */
public class MainActivity extends BridgeActivity {

    private static final int REQ_RUNTIME_PERMS = 4711;
    private PermissionRequest pendingWebRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // اطلب الأذونات المطلوبة للعبة عند فتح التطبيق أول مرة.
        requestGamePermissions();

        // تجاوز WebChromeClient لمنح الأذونات (مايك/كاميرا) لصفحات الويب.
        bridge.getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }
        });

        // عند انقطاع الاتصال، اعرض صفحة أوفلاين مخصصة بدل صفحة المتصفح الافتراضية.
        bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
            private boolean showingOffline = false;

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (url != null && !url.startsWith("file:///android_asset/offline.html")) {
                    showingOffline = false;
                }
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request != null && request.isForMainFrame() && !showingOffline) {
                    showingOffline = true;
                    view.loadUrl("file:///android_asset/offline.html");
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request != null ? request.getUrl() : null;
                if (url != null && "file".equals(url.getScheme())) {
                    return false;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });
    }

    private void requestGamePermissions() {
        List<String> needed = new ArrayList<>();
        addIfMissing(needed, Manifest.permission.RECORD_AUDIO);
        addIfMissing(needed, Manifest.permission.CAMERA);
        addIfMissing(needed, Manifest.permission.MODIFY_AUDIO_SETTINGS);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            addIfMissing(needed, Manifest.permission.READ_MEDIA_IMAGES);
            addIfMissing(needed, Manifest.permission.READ_MEDIA_VIDEO);
            addIfMissing(needed, Manifest.permission.POST_NOTIFICATIONS);
        } else {
            addIfMissing(needed, Manifest.permission.READ_EXTERNAL_STORAGE);
        }

        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                needed.toArray(new String[0]),
                REQ_RUNTIME_PERMS
            );
        }
    }

    private void addIfMissing(List<String> list, String perm) {
        if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
            list.add(perm);
        }
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        String[] resources = request.getResources();
        List<String> osPermsNeeded = new ArrayList<>();
        List<String> grantedWeb = new ArrayList<>();

        for (String res : resources) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                        != PackageManager.PERMISSION_GRANTED) {
                    osPermsNeeded.add(Manifest.permission.RECORD_AUDIO);
                } else {
                    grantedWeb.add(res);
                }
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                        != PackageManager.PERMISSION_GRANTED) {
                    osPermsNeeded.add(Manifest.permission.CAMERA);
                } else {
                    grantedWeb.add(res);
                }
            } else {
                // أذونات أخرى (مثل MIDI): امنحها مباشرة.
                grantedWeb.add(res);
            }
        }

        if (!osPermsNeeded.isEmpty()) {
            // نحتاج طلب أذونات النظام أولاً، ثم نمنح WebView بعد الرد.
            pendingWebRequest = request;
            ActivityCompat.requestPermissions(
                this,
                osPermsNeeded.toArray(new String[0]),
                REQ_RUNTIME_PERMS
            );
        } else {
            request.grant(grantedWeb.toArray(new String[0]));
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_RUNTIME_PERMS && pendingWebRequest != null) {
            PermissionRequest req = pendingWebRequest;
            pendingWebRequest = null;
            List<String> toGrant = new ArrayList<>();
            for (String res : req.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                        && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                    toGrant.add(res);
                } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                        && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                            == PackageManager.PERMISSION_GRANTED) {
                    toGrant.add(res);
                }
            }
            if (toGrant.isEmpty()) {
                req.deny();
            } else {
                req.grant(toGrant.toArray(new String[0]));
            }
        }
    }
}
