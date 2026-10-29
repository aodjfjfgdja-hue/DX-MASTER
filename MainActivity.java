package com.dxmaster.vpnmic;

import android.Manifest;
import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

public class MainActivity extends Activity {

    private static final String FB_URL = "https://www.facebook.com/";
    private static final String MSG_URL = "https://www.facebook.com/messages/";
    private static final String UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    private WebView web;
    private FrameLayout rootLayout;
    private final ArrayList<WebView> popups = new ArrayList<>();
    private String boosterJs = "";
    private boolean redirected = false;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.parseColor("#0A0A1A"));
        getWindow().setNavigationBarColor(Color.parseColor("#0A0A1A"));
        boosterJs = readAsset("dx_booster.js");

        FrameLayout root = new FrameLayout(this);
        rootLayout = root;
        root.setBackgroundColor(Color.parseColor("#0A0A1A"));

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.addView(buildBar(), new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        web = new WebView(this);
        col.addView(web, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(col, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        final View splash = buildSplash();
        root.addView(splash, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        splash.postDelayed(() -> splash.animate().alpha(0f).setDuration(500)
                .withEndAction(() -> splash.setVisibility(View.GONE)).start(), 1800);

        configure(web, false);
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO,
                Manifest.permission.CAMERA}, 1);
        web.loadUrl(FB_URL);
    }

    private void configure(final WebView w, final boolean isPopup) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(UA);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(w, true);

        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog,
                                          boolean isUserGesture, Message resultMsg) {
                WebView popup = new WebView(MainActivity.this);
                configure(popup, true);
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
                lp.topMargin = dp(52);
                rootLayout.addView(popup, lp);
                popups.add(popup);
                WebView.WebViewTransport t = (WebView.WebViewTransport) resultMsg.obj;
                t.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }

            @Override
            public void onCloseWindow(WebView window) {
                closePopup(window);
            }
        });

        w.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap f) {
                v.evaluateJavascript(boosterJs, null);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript(boosterJs, null);
                CookieManager.getInstance().flush();
                if (isPopup) return;
                String c = CookieManager.getInstance().getCookie("https://www.facebook.com");
                if (!redirected && url != null && url.contains("facebook.com")
                        && !url.contains("/messages") && c != null && c.contains("c_user=")) {
                    redirected = true;
                    v.loadUrl(MSG_URL);
                }
            }
        });
    }

    private void closePopup(WebView p) {
        popups.remove(p);
        rootLayout.removeView(p);
        p.destroy();
    }

    private View buildBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), 0, dp(8), 0);
        GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{Color.parseColor("#B71C1C"), Color.parseColor("#0A0A1A"),
                        Color.parseColor("#1565C0")});
        bar.setBackground(g);

        TextView title = new TextView(this);
        title.setText("DX MASTER");
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setLetterSpacing(0.15f);
        title.setShadowLayer(12, 0, 0, Color.parseColor("#2979FF"));
        bar.addView(title, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        bar.addView(barBtn("Facebook", v -> { redirected = false; web.loadUrl(FB_URL); }));
        bar.addView(barBtn("Messenger", v -> web.loadUrl(MSG_URL)));
        bar.addView(barBtn("⟳", v -> {
            if (!popups.isEmpty()) popups.get(popups.size() - 1).reload(); else web.reload();
        }));
        return bar;
    }

    private TextView barBtn(String t, View.OnClickListener l) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextColor(Color.WHITE);
        v.setTextSize(12);
        v.setTypeface(Typeface.DEFAULT_BOLD);
        v.setPadding(dp(10), dp(6), dp(10), dp(6));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(14));
        bg.setColor(Color.parseColor("#33FFFFFF"));
        bg.setStroke(dp(1), Color.parseColor("#2979FF"));
        v.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(4), 0, 0, 0);
        v.setLayoutParams(lp);
        v.setOnClickListener(l);
        return v;
    }

    private View buildSplash() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setBackgroundColor(Color.parseColor("#0A0A1A"));
        l.setClickable(true);

        TextView t = new TextView(this);
        t.setText("DX MASTER");
        t.setTextColor(Color.parseColor("#FF1744"));
        t.setTextSize(38);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setLetterSpacing(0.2f);
        t.setShadowLayer(30, 0, 0, Color.parseColor("#2979FF"));
        l.addView(t);

        TextView s = new TextView(this);
        s.setText("VPN MIC  •  VOLUME BOOSTER");
        s.setTextColor(Color.parseColor("#82B1FF"));
        s.setTextSize(13);
        s.setLetterSpacing(0.2f);
        s.setPadding(0, dp(10), 0, 0);
        l.addView(s);
        return l;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    @Override
    public void onBackPressed() {
        if (!popups.isEmpty()) {
            closePopup(popups.get(popups.size() - 1));
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
