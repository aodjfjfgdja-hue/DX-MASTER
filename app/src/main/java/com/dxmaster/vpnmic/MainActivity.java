package com.dxmaster.vpnmic;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
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

public class MainActivity extends Activity {

    private static final String FB_URL = "https://www.facebook.com/";
    private static final String MSG_URL = "https://www.facebook.com/messages/";
    // Desktop user agent: Messenger calls work on the desktop web version
    private static final String UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    private WebView web;
    private String boosterJs = "";
    private boolean redirected = false;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.parseColor("#0A0A1A"));
        getWindow().setNavigationBarColor(Color.parseColor("#0A0A1A"));
        boosterJs = readAsset("dx_booster.js");

        FrameLayout root = new FrameLayout(this);
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

        setupWeb();
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO,
                Manifest.permission.CAMERA}, 1);
        web.loadUrl(FB_URL);
    }

    private void setupWeb() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(UA);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap f) {
                v.evaluateJavascript(boosterJs, null);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript(boosterJs, null);
                CookieManager.getInstance().flush();
                // Facebook logged in -> go to Messenger automatically
                String c = CookieManager.getInstance().getCookie("https://www.facebook.com");
                if (!redirected && url != null && url.contains("facebook.com")
                        && !url.contains("/messages") && c != null && c.contains("c_user=")) {
                    redirected = true;
                    v.loadUrl(MSG_URL);
                }
            }
        });
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
        bar.addView(barBtn("⟳", v -> web.reload()));
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
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
