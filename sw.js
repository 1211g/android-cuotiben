/* Offline service worker — network-first so updates are picked up immediately,
   with a cache fallback so the app still works fully offline.
   All data stays on device; there are no network features. */
const CACHE = 'cuotiben-v25';
const OCR_ASSETS = [
  'ocr/tesseract.min.js', 'ocr/worker.min.js',
  'ocr/tesseract-core-simd-lstm.wasm.js', 'ocr/tesseract-core-simd-lstm.wasm',
  'ocr/tesseract-core-lstm.wasm.js', 'ocr/tesseract-core-lstm.wasm',
  'ocr/lang/chi_sim.traineddata.gz', 'ocr/lang/eng.traineddata.gz'
];
const KATEX_ASSETS = [
  'ocr/katex/katex.min.css', 'ocr/katex/katex.min.js',
  'ocr/katex/fonts/KaTeX_AMS-Regular.woff2',
  'ocr/katex/fonts/KaTeX_Caligraphic-Bold.woff2',
  'ocr/katex/fonts/KaTeX_Caligraphic-Regular.woff2',
  'ocr/katex/fonts/KaTeX_Fraktur-Bold.woff2',
  'ocr/katex/fonts/KaTeX_Fraktur-Regular.woff2',
  'ocr/katex/fonts/KaTeX_Main-Bold.woff2',
  'ocr/katex/fonts/KaTeX_Main-BoldItalic.woff2',
  'ocr/katex/fonts/KaTeX_Main-Italic.woff2',
  'ocr/katex/fonts/KaTeX_Main-Regular.woff2',
  'ocr/katex/fonts/KaTeX_Math-BoldItalic.woff2',
  'ocr/katex/fonts/KaTeX_Math-Italic.woff2',
  'ocr/katex/fonts/KaTeX_SansSerif-Bold.woff2',
  'ocr/katex/fonts/KaTeX_SansSerif-Italic.woff2',
  'ocr/katex/fonts/KaTeX_SansSerif-Regular.woff2',
  'ocr/katex/fonts/KaTeX_Script-Regular.woff2',
  'ocr/katex/fonts/KaTeX_Size1-Regular.woff2',
  'ocr/katex/fonts/KaTeX_Size2-Regular.woff2',
  'ocr/katex/fonts/KaTeX_Size3-Regular.woff2',
  'ocr/katex/fonts/KaTeX_Size4-Regular.woff2',
  'ocr/katex/fonts/KaTeX_Typewriter-Regular.woff2'
];
/* pdf.js engine. cmaps/ and standard_fonts/ are fetched on demand by the
   worker and cached by the fetch handler below; in the native WebView shell
   they are always served straight from APK assets, so offline viewing works. */
const PDF_ASSETS = [
  'pdf/pdf.min.js', 'pdf/pdf.worker.min.js'
];
const ASSETS = [
  './', 'index.html', 'manifest.json', 'css/glass.css', 'css/novel.css',
  'js/utils.js', 'js/zip.js', 'js/db.js', 'js/vision.js', 'js/batch.js', 'js/pdf.js', 'js/novel.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png',
  ...OCR_ASSETS, ...KATEX_ASSETS, ...PDF_ASSETS
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if ((req.method !== 'GET' && req.method !== 'HEAD') || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.status === 200 && req.method === 'GET') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreMethod: true }).then(hit => hit || caches.match('index.html')))
  );
});
