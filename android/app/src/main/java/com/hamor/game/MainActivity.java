package com.hamor.game;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
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
 * MainActivity — يعالج مطالب أذونات WebView (مايك/كاميرا) عند الطلب فقط،
 * ويعرض صفحة أوفلاين مخصصة، ويوفر سلوك زر الرجوع الطبيعي للتنقّل داخل WebView.
 *
 * لا نطلب أي إذن عند بدء التطبيق — كل الأذونات in-context لتفادي رفض
 * Google Play بسبب "Requesting permissions without a valid use case".
 */
public class MainActivity extends BridgeActivity {

    private static final int REQ_RUNTIME_PERMS = 4711;
    private PermissionRequest pendingWebRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // منح WebView أذونات المايك/الكاميرا عند الطلب فقط.
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

    /**
     * سلوك زر الرجوع الطبيعي — يعود إلى الصفحة السابقة داخل WebView بدل
     * الخروج المفاجئ من التطبيق. متطلب أساسي في Google Play لتجربة تطبيق
     * حقيقية (Minimum Functionality).
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            WebView web = bridge != null ? bridge.getWebView() : null;
            if (web != null && web.canGoBack()) {
                web.goBack();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
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
                grantedWeb.add(res);
            }
        }

        if (!osPermsNeeded.isEmpty()) {
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
