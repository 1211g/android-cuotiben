package com.cuotiben.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Offline WebView shell for Noteee.
 *
 * All web assets are served from assets/www through a stable, secure origin
 * (https://cuotiben.local/) so IndexedDB, DOM storage and relative URLs work
 * exactly as they do in the browser. No INTERNET permission is declared and
 * every non-local navigation is refused: this app never talks to the network.
 */
public class MainActivity extends Activity {

    private static final String ORIGIN = "https://cuotiben.local/";
    private static final String HOST = "cuotiben.local";
    private static final int REQ_PERMS = 1001;
    private static final int REQ_FILE = 1002;
    private static final String BACKUP_SUBDIR = "Noteee备份";

    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri captureUri;
    private Uri lastPickedUri = null;
    private boolean lightStatusBar = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window win = getWindow();
        win.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        win.setStatusBarColor(Color.TRANSPARENT);
        win.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = win.getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            win.setAttributes(lp);
        }
        applyBars();

        // Only debuggable builds (e.g. `assembleDebug` from Android Studio) expose the
        // WebView to DevTools. The signed release APK keeps it closed.
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0B1020"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " Noteee/1.1.5 (offline)");

        web.addJavascriptInterface(new Bridge(), "CuotiBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                // Keep everything inside the local app; refuse any external link.
                return !HOST.equals(u.getHost());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                return serveLocal(req.getUrl());
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                applyBars();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                return openFileChooser(cb, params);
            }
        });

        // Anonymous class instead of a lambda: javac with android.jar as the
        // boot classpath cannot resolve java.lang.invoke.LambdaMetafactory.
        web.setDownloadListener(new android.webkit.DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimetype, long contentLength) {
                // Backup ZIPs are handed to the bridge as base64 (blob: URLs cannot
                // be resolved by DownloadListener). Any other download is ignored.
                if (!url.startsWith("blob:")) {
                    toast("请通过设置页的「导出备份」保存文件");
                }
            }
        });

        askPermissions();
        web.loadUrl(ORIGIN);
    }

    /* ------------------------------------------------------------------
       Local asset serving
       ------------------------------------------------------------------ */

    private WebResourceResponse serveLocal(Uri u) {
        if (!HOST.equals(u.getHost())) return null;
        String path = u.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) path = "index.html";
        while (path.startsWith("/")) path = path.substring(1);
        // No path traversal out of assets/www.
        if (path.contains("..")) return notFound();

        String asset = "www/" + path;
        try {
            InputStream is = getAssets().open(asset);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(mimeOf(path), "UTF-8", 200, "OK", headers, is);
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<>();
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                headers, new ByteArrayInputStream("Not Found".getBytes()));
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.US);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".zip")) return "application/zip";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".gz")) return "application/gzip";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    /** Map a file extension from <input accept> to a MIME type for EXTRA_MIME_TYPES. */
    private static String mimeForExtension(String ext) {
        if (".pdf".equals(ext)) return "application/pdf";
        if (".zip".equals(ext)) return "application/zip";
        if (".json".equals(ext)) return "application/json";
        if (".csv".equals(ext)) return "text/csv";
        if (".txt".equals(ext)) return "text/plain";
        if (".html".equals(ext) || ".htm".equals(ext)) return "text/html";
        return null;
    }

    /* ------------------------------------------------------------------
       Camera / album file chooser
       ------------------------------------------------------------------ */

    private boolean openFileChooser(ValueCallback<Uri[]> cb, WebChromeClient.FileChooserParams params) {
        if (filePathCallback != null) filePathCallback.onReceiveValue(null);
        filePathCallback = cb;

        boolean capture = params.isCaptureEnabled();
        boolean multiple = params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
        Intent intent;

        if (capture) {
            String name = "photo_" + System.currentTimeMillis() + ".jpg";
            captureUri = Uri.parse("content://com.cuotiben.app.capture/" + name);
            intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, captureUri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            List<ResolveInfo> targets = getPackageManager()
                    .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
            for (ResolveInfo ri : targets) {
                grantUriPermission(ri.activityInfo.packageName, captureUri,
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
        } else {
            intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            /* v1.0.7: filter the picker to exactly the types this <input> accepts.
               PDF import -> only PDFs, TXT import -> only TXT, batch import ->
               only ZIP/JSON, backup restore -> only ZIP. The previous version
               used an unfiltered wildcard type for every document because OEM
               file managers hid local .html files; that special case is kept
               below for HTML inputs only. */
            String[] accepts = params.getAcceptTypes();
            boolean wantsImages = false;
            boolean wantsHtml = false;
            List<String> mimes = new ArrayList<String>();
            if (accepts != null) {
                for (String a : accepts) {
                    if (a == null) continue;
                    String t = a.trim().toLowerCase(Locale.US);
                    if (t.isEmpty() || "*/*".equals(t)) continue;
                    if (t.contains("html") || t.contains(".htm")) { wantsHtml = true; continue; }
                    if (t.contains("image")) { wantsImages = true; continue; }
                    if (t.startsWith(".")) {
                        String mime = mimeForExtension(t);
                        if (mime != null && !mimes.contains(mime)) mimes.add(mime);
                    } else if (t.contains("/") && !t.endsWith("/*")
                            && !mimes.contains(t)) {
                        mimes.add(t);
                    }
                }
            }
            String title;
            if (wantsImages && mimes.isEmpty()) {
                intent.setType("image/*");
                title = "选择图片";
            } else if (wantsHtml) {
                /* Local .html/.htm files are frequently NOT indexed as
                   text/html by OEM file managers — keep HTML chooser
                   unfiltered so the user's offline manuals always appear. */
                intent.setType("*/*");
                title = "选择文件";
            } else if (mimes.size() == 1) {
                intent.setType(mimes.get(0));
                title = "选择文件";
            } else if (mimes.size() > 1) {
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
                title = "选择文件";
            } else {
                intent.setType("*/*");
                title = "选择文件";
            }
            if (multiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            intent = Intent.createChooser(intent, title);
        }

        try {
            startActivityForResult(intent, REQ_FILE);
            return true;
        } catch (Exception e) {
            filePathCallback = null;
            cb.onReceiveValue(null);
            toast("无法打开图片选择器");
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_FILE) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (filePathCallback == null) return;

        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            if (captureUri != null && (data == null || data.getData() == null)) {
                results = new Uri[]{captureUri};
            } else if (data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    List<Uri> list = new ArrayList<>();
                    for (int i = 0; i < n; i++) {
                        Uri item = data.getClipData().getItemAt(i).getUri();
                        if (item != null) list.add(item);
                    }
                    results = list.toArray(new Uri[0]);
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                } else if (data.getDataString() != null) {
                    results = new Uri[]{Uri.parse(data.getDataString())};
                }
            }
        }
        lastPickedUri = (results != null && results.length > 0) ? results[0] : null;
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
        captureUri = null;
    }

    /* ------------------------------------------------------------------
       Permissions / system bars / back
       ------------------------------------------------------------------ */

    private void askPermissions() {
        List<String> need = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.CAMERA);
        }
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES)
                    != PackageManager.PERMISSION_GRANTED) {
                need.add(Manifest.permission.READ_MEDIA_IMAGES);
            }
        } else {
            if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                need.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            }
        }
        if (Build.VERSION.SDK_INT <= 28
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
        if (!need.isEmpty()) {
            requestPermissions(need.toArray(new String[0]), REQ_PERMS);
        }
    }

    private void applyBars() {
        View decor = getWindow().getDecorView();
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        if (lightStatusBar && Build.VERSION.SDK_INT >= 23) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        }
        if (lightStatusBar && Build.VERSION.SDK_INT >= 26) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        decor.setSystemUiVisibility(flags);
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(function(){try{return !!(window.CuotiBack && window.CuotiBack());}catch(e){return false;}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        boolean handled = "true".equals(value);
                        if (!handled) {
                            if (web.canGoBack()) web.goBack();
                            else finish();
                        }
                    }
                });
    }

    /* ------------------------------------------------------------------
       Javascript bridge
       ------------------------------------------------------------------ */

    private class Bridge {
        /** Write a backup ZIP (base64 payload) into the public Downloads folder. */
        @JavascriptInterface
        public void saveBase64(String base64, String name) {
            try {
                byte[] bytes = Base64.decode(base64 == null ? "" : base64, Base64.DEFAULT);
                String where = writeBackup(bytes, name);
                toast("备份已保存：下载/" + BACKUP_SUBDIR + "/" + safeName(name));
            } catch (Exception e) {
                toast("备份保存失败：" + e.getMessage());
            }
        }

        @JavascriptInterface
        public void setLightStatusBar(boolean light) {
            lightStatusBar = light;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyBars();
                }
            });
        }

        @JavascriptInterface
        public String backupDir() {
            return "Download/" + BACKUP_SUBDIR;
        }

        /** Delete the most recently picked ZIP file. Used by the "auto-delete ZIP after batch import" setting. */
        @JavascriptInterface
        public boolean deleteLastPickedZip() {
            if (lastPickedUri == null) return false;
            boolean isZip = false;
            try {
                String type = getContentResolver().getType(lastPickedUri);
                if (type != null) {
                    String t = type.toLowerCase(Locale.US);
                    isZip = t.contains("zip") || "application/octet-stream".equals(t);
                }
            } catch (Exception ignored) { }
            if (!isZip) {
                Cursor c = null;
                try {
                    c = getContentResolver().query(lastPickedUri, null, null, null, null);
                    if (c != null && c.moveToFirst()) {
                        int idx = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
                        if (idx >= 0) {
                            String n = c.getString(idx);
                            isZip = n != null && n.toLowerCase(Locale.US).endsWith(".zip");
                        }
                    }
                } catch (Exception ignored) { }
                finally { if (c != null) c.close(); }
            }
            if (!isZip) return false;
            try {
                int n = getContentResolver().delete(lastPickedUri, null, null);
                lastPickedUri = null;
                return n > 0;
            } catch (Exception e) {
                return false;
            }
        }
    }

    private static String safeName(String name) {
        if (name == null || name.isEmpty()) return "Noteee备份.zip";
        return name.replace('/', '_').replace('\\', '_');
    }

    private String writeBackup(byte[] bytes, String name) throws IOException {
        String display = safeName(name);
        if (Build.VERSION.SDK_INT >= 29) {
            // Scoped storage: no permission needed, MediaStore writes into Downloads.
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, display);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, "application/zip");
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/" + BACKUP_SUBDIR);
            cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri collection = MediaStore.Files.getContentUri("external");
            Uri uri = getContentResolver().insert(collection, cv);
            if (uri == null) throw new IOException("MediaStore 插入失败");
            OutputStream os = getContentResolver().openOutputStream(uri);
            if (os == null) throw new IOException("无法打开输出流");
            try {
                os.write(bytes);
                os.flush();
            } finally {
                try { os.close(); } catch (IOException ignored) { }
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(uri, done, null, null);
            return uri.toString();
        }
        File dir = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                BACKUP_SUBDIR);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建备份目录");
        File f = new File(dir, display);
        FileOutputStream fos = new FileOutputStream(f);
        try {
            fos.write(bytes);
            fos.flush();
        } finally {
            fos.close();
        }
        return f.getAbsolutePath();
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
