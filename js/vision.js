/* ============================================================
   vision.js — 离线图片智能处理（不联网、不上传、不依赖服务）
   1) recognize()   : Tesseract.js + 本地 wasm + chi_sim/eng 词库，图片转文字
   2) cleanFigure() : Canvas 背景估计 / 墨迹提取，把照片变成纯白背景干净图形
   3) classify()    : 依据 OCR 结果判断「文字题」还是「图形题」
   所有资源都来自 App 自带的 ocr/ 目录，浏览器 PWA 与 Android WebView 壳通用。
   ============================================================ */
(function (global) {
  'use strict';

  const U = global.U;
  /* 绝对同源 URL：worker 内部的相对路径是相对 worker.min.js 的，必须用绝对地址。 */
  const OCR_BASE = new URL('ocr/', document.baseURI).href.replace(/\/$/, '');

  /* ---------------------------------------------------------
     文本清洗 / 分类
     --------------------------------------------------------- */
  /* Tesseract 的中文模式常在相邻汉字之间插入空格，先挤掉；
     英文与公式里的空格必须保留，否则 f(x) = x - 2 会被粘成一团。 */
  function squashCjkSpaces(s) {
    let prev;
    do {
      prev = s;
      s = s.replace(/([\u4e00-\u9fff\u3040-\u30ff])[ \t]+(?=[\u4e00-\u9fff\u3040-\u30ff])/g, '$1');
      s = s.replace(/([\u4e00-\u9fff])[ \t]+(?=[，。、；：？！）》」』])/g, '$1');
      s = s.replace(/([《「『（])[ \t]+(?=[\u4e00-\u9fff])/g, '$1');
    } while (s !== prev);
    return s;
  }

  function normalizeText(raw) {
    const lines = String(raw || '').replace(/\r/g, '').split('\n')
      .map(l => squashCjkSpaces(l.replace(/[ \t]+/g, ' ').trim()));
    const out = [];
    for (const l of lines) {
      if (!l && (!out.length || !out[out.length - 1])) continue;
      out.push(l);
    }
    while (out.length && !out[out.length - 1]) out.pop();
    return out.join('\n');
  }

  function meaningfulChars(text) {
    const m = String(text || '').match(/[\u4e00-\u9fa5A-Za-z0-9]/g);
    return m ? m.length : 0;
  }

  function longestRun(text) {
    const runs = String(text || '').match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) || [];
    return runs.reduce((a, b) => Math.max(a, b.length), 0);
  }

  /* 几何图形上常散落 A/B/C/1/2 标注，纸面噪点还会被 OCR 读成一串 "1"。
     因此「文字题」必须同时满足：有连续文字串、有足够汉字/字母、且数字占比不高。
     只堆字数不算文字——否则带噪点的几何图会被误判成文字题。 */
  function classify(result) {
    const text = normalizeText(result && result.text);
    const chars = meaningfulChars(text);
    const run = longestRun(text);
    const letters = (text.match(/[\u4e00-\u9fa5A-Za-z]/g) || []).length;
    const digits = (text.match(/[0-9]/g) || []).length;
    const digitRatio = chars ? digits / chars : 1;
    const confidence = (result && result.confidence) || 0;
    const isText = confidence >= 38 && run >= 5 && chars >= 5 &&
                   letters >= 5 && digitRatio < 0.62;
    return {
      kind: isText ? 'text' : 'figure',
      text: text, chars: chars, run: run, letters: letters,
      confidence: Math.round(confidence)
    };
  }

  /* ---------------------------------------------------------
     OCR（按需懒加载，worker 全局复用）
     --------------------------------------------------------- */
  let _workerP = null;

  function report(fn, label, p) {
    if (fn) { try { fn(label, Math.max(0, Math.min(1, p || 0))); } catch (e) { } }
  }

  function loadScript() {
    if (global.Tesseract) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = OCR_BASE + '/tesseract.min.js';
      s.onload = () => global.Tesseract ? res() : rej(new Error('OCR 引擎加载失败'));
      s.onerror = () => rej(new Error('未找到本地 OCR 引擎（ocr/tesseract.min.js）'));
      document.head.appendChild(s);
    });
  }

  /* 词库文件名探测：浏览器 PWA 与手工打包的 APK 里是 *.traineddata.gz；
     Android Studio / AGP 打包时资源预处理会把 .gz 解压并去掉后缀，变成
     *.traineddata。两种包都用同一份前端，因此在启动时 HEAD 探测一次，
     tesseract.js 的 gzip 选项按实际文件是否存在来定（结果缓存）。 */
  let _langGzip = null;
  async function langGzip() {
    if (_langGzip !== null) return _langGzip;
    // 浏览器 / PWA 与本地 http 预览里词库永远打包成 *.gz（离线时 SW 只缓存 GET，
    // HEAD 探测会假阴性），直接返回 true；只有原生 WebView 壳需要按包探测。
    if (!global.CuotiBridge) { _langGzip = true; return _langGzip; }
    try {
      const r = await fetch(OCR_BASE + '/lang/chi_sim.traineddata.gz', { method: 'HEAD' });
      _langGzip = !!r.ok;
    } catch (e) { _langGzip = false; }
    return _langGzip;
  }

  function ensureWorker(onProgress) {
    if (_workerP) return _workerP;
    _workerP = (async () => {
      await loadScript();
      report(onProgress, '正在启动识别引擎', 0.02);
      const gz = await langGzip();
      const worker = await global.Tesseract.createWorker('chi_sim+eng', 1, {
        workerPath: OCR_BASE + '/worker.min.js',
        corePath: OCR_BASE,              // 目录 → 自动挑选 simd / 非 simd 的 lstm 内核
        langPath: OCR_BASE + '/lang',    // 本地 chi_sim / eng 词库
        workerBlobURL: false,            // blob: worker 会让 wasm 相对路径失效
        gzip: gz,                        // 依实际打包形式自适应
        cacheMethod: 'write',
        logger: m => {
          const map = {
            'loading tesseract core': '加载识别内核',
            'initializing tesseract': '初始化识别引擎',
            'loading language traineddata': '加载中英文词库',
            'initializing api': '准备识别',
            'recognizing text': '正在识别文字'
          };
          report(onProgress, map[m.status] || m.status, m.progress);
        }
      });
      return worker;
    })().catch(e => { _workerP = null; throw e; });
    return _workerP;
  }

  /* 把超大原图缩到 1800px，减少 postMessage 拷贝，同时保证识别精度。 */
  async function ocrSource(src) {
    const im = await U.loadImage(src);
    const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    const s = Math.min(1, 1800 / Math.max(w, h));
    if (s >= 1) return src;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.92);
  }

  async function recognize(src, onProgress) {
    const worker = await ensureWorker(onProgress);
    report(onProgress, '正在识别文字', 0.12);
    const image = await ocrSource(src);
    /* 显式声明只要 text + blocks：blocks 里带 line/word/symbol 的 bbox 与 baseline，
       是恢复上下标的依据；同时避免生成 hocr/tsv/pdf 等无用输出浪费时间。 */
    const res = await worker.recognize(image, {}, { text: true, blocks: true });
    const d = (res && res.data) || {};
    return {
      text: normalizeText(d.text), confidence: d.confidence || 0,
      raw: d, image: image, worker: worker
    };
  }

  /* ============================================================
     数学公式识别
     Tesseract 的 chi_sim+eng 并不「懂」数学，但它会给出每个 symbol 的
     bbox 与 baseline。据此可以恢复三类结构：
       1) 上下标：字符更小且明显偏上 / 偏下 → ^{...} / _{...}
       2) 分式：扫描图片里的水平分数线，分别 OCR 分子 / 分母 → \frac{}{}
       3) 根号与运算符：√(x+1) → \sqrt{x+1}，×÷≤≥∑∫√ → LaTeX
     输出是可直接填入题干的「正文 + $...$ 行内公式」混合文本，
     formulas 数组则交给 KaTeX 离线渲染出可视化预览。
     ============================================================ */
  const MATH_SYMBOLS = [
    ['×', '\\times '], ['·', '\\cdot '], ['÷', '\\div '],
    ['≤', '\\le '], ['≥', '\\ge '], ['≠', '\\ne '],
    ['±', '\\pm '], ['∓', '\\mp '], ['∞', '\\infty '],
    ['∑', '\\sum '], ['∫', '\\int '], ['∂', '\\partial '],
    ['∇', '\\nabla '], ['∈', '\\in '], ['∉', '\\notin '],
    ['→', '\\to '], ['↔', '\\leftrightarrow '],
    ['π', '\\pi '], ['θ', '\\theta '], ['α', '\\alpha '],
    ['β', '\\beta '], ['γ', '\\gamma '], ['Δ', '\\Delta '],
    ['°', '^{\\circ}'], ['′', "'"]
  ];

  function mapMath(s) {
    let out = s;
    for (const [a, b] of MATH_SYMBOLS) out = out.split(a).join(b);
    return out;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  }

  /* 用 symbol 的 bbox / baseline 恢复一行里的上下标。 */
  function lineToMath(line) {
    const syms = [];
    for (const w of (line.words || [])) {
      for (const s of (w.symbols || [])) if (s && s.bbox) syms.push(s);
    }
    if (!syms.length) return normalizeText(line.text || '');
    syms.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const base = line.baseline;
    const baseY = base && (base.y0 || base.y1) ? (base.y0 || base.y1) : median(syms.map(s => s.bbox.y1));
    const normals = syms.filter(s => s.bbox.y1 >= baseY - 4)
                        .map(s => Math.max(1, s.bbox.y1 - s.bbox.y0));
    const hRef = median(normals) || 20;
    let out = '', sup = '', sub = '';
    const flush = () => {
      if (sup.trim()) out += '^{' + mapMath(sup.trim()) + '}';
      if (sub.trim()) out += '_{' + mapMath(sub.trim()) + '}';
      sup = ''; sub = '';
    };
    for (const s of syms) {
      const b = s.bbox, h = Math.max(1, b.y1 - b.y0);
      const t = String(s.text || '').trim();
      if (!t) continue;
      /* 上下标的字高约为正文的 0.4~0.9 倍；等号、减号、逗号只有 0.1~0.3 倍，
         用「字高区间」把它们排除，再看垂直位置。运算符本身一律不参与上下标，
         否则 Android 上字体回退、symbol 切得碎时会出现 `^{ + }` 这类假上标。 */
      const isOp = /^[+\-−–=×÷<>≤≥≠∑∫,.;:'"`|/\\]+$/.test(t);
      const small = !isOp && h > hRef * 0.4 && h < hRef * 0.9;
      if (small && b.y1 < baseY - hRef * 0.15 && b.y0 < baseY - hRef * 0.55) { sup += t; continue; }
      if (small && b.y0 > baseY - hRef * 0.05 && b.y1 > baseY + hRef * 0.2) { sub += t; continue; }
      flush(); out += t;
    }
    flush();
    return out.replace(/[ \t]+/g, ' ').trim();
  }

  /* Tesseract 常把「贴得很近的上标」并进相邻字符，bbox 里就看不到独立 symbol。
     对已确定是公式的片段补一条保守规则：小写变量 / 右括号后紧跟的 2~9 且
     后面是运算符或结尾 → 视为上标。A2/B3 这类选项列表与多位数字会被排除。 */
  function implicitExponents(s) {
    if (/^[A-D]\s*\d(\s+[A-D]\s*\d)+\s*$/.test(s)) return s;
    if (!/[=+\-*/√✓^\\]/.test(s)) return s;
    const supMap = { '²': '2', '³': '3', '⁰': '0', '¹': '1', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
    return s
      .replace(/([A-Za-z)\]])[ \t]*([²³⁰¹⁴⁵⁶⁷⁸⁹])/g, (m, a, b) => a + '^{' + (supMap[b] || b) + '}')
      .replace(/([A-Za-z)\]])([2-9])(?=\s*[+\-*/=,);\]}]|$)/g, '$1^{$2}');
  }

  function polishMath(s) {
    let out = s;
    /* 1/2、a/b、a÷b → \frac{}{} */
    out = out.replace(/([0-9A-Za-z][0-9A-Za-z\\}]*)\s*\/\s*([0-9A-Za-z]+)/g, '\\frac{$1}{$2}');
    out = out.replace(/([0-9A-Za-z][0-9A-Za-z\\}]*)\s*÷\s*([0-9A-Za-z]+)/g, '\\frac{$1}{$2}');
    /* √(...) / √x → \sqrt{...}（OCR 常把根号读成 V / ✓ 的情况见下方兜底） */
    out = out.replace(/[√✓]\s*\(([^()]*)\)/g, '\\sqrt{$1}');
    out = out.replace(/[√✓]\s*\{([^}]*)\}/g, '\\sqrt{$1}');
    out = out.replace(/[√✓]\s*([0-9A-Za-z]+)/g, '\\sqrt{$1}');
    /* x^2 / x 2（无上下标标记时）→ x^{2} */
    out = out.replace(/([A-Za-z)\]])\s*\^\s*([0-9A-Za-z]+)/g, '$1^{$2}');
    out = implicitExponents(out);
    out = mapMath(out);
    /* 运算符两侧留白，避免 x^{2}+y^{2} 挤在一起 */
    out = out.replace(/\s*([+\-=<>])\s*/g, ' $1 ');
    return out.replace(/[ \t]{2,}/g, ' ').trim();
  }

  function isMathy(s) {
    return /[=+\-×÷≤≥≠<>∑∫√✓^_{}\\]/.test(s) && /[0-9A-Za-z]/.test(s);
  }

  /* 把一行拆成「中文叙述」与「公式」：公式用 $...$ 包起来，方便直接贴进题干。 */
  function hybridLine(s) {
    const parts = String(s).split(/([\u4e00-\u9fff]+[，。、；：？！）》」』]?)/);
    return parts.map(seg => {
      if (!seg) return '';
      if (/[\u4e00-\u9fff]/.test(seg)) return seg;
      return isMathy(seg) ? '$' + seg.trim() + '$' : seg;
    }).join('').replace(/\$([^$]*?)\s+\$/g, '$$$1$$').trim();
  }

  /* 在图片里找「水平分数线」：又细又长、上方与下方都有墨迹。
     找到后分别裁剪上下两块做二次 OCR，拼成 \frac{分子}{分母}。 */
  async function detectFractions(image, worker, onProgress) {
    const im = await U.loadImage(image);
    const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(im, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const dark = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      dark[i] = ((px[p] * 77 + px[p + 1] * 150 + px[p + 2] * 29) >> 8) < 120 ? 1 : 0;
    }
    const minRun = Math.max(12, Math.round(w * 0.015));
    const bars = [];
    for (let y = 0; y < h; y++) {
      let x = 0;
      const runs = [];
      while (x < w) {
        if (!dark[y * w + x]) { x++; continue; }
        const s = x;
        while (x < w && dark[y * w + x]) x++;
        if (x - s >= minRun) runs.push([s, x - 1]);
      }
      for (const [x0, x1] of runs) {
        const p = bars.find(b => b.y1 >= y - 2 && b.y1 < y &&
          Math.min(b.x1, x1) - Math.max(b.x0, x0) > (x1 - x0) * 0.7);
        if (p) { p.y1 = y; p.x0 = Math.min(p.x0, x0); p.x1 = Math.max(p.x1, x1); }
        else bars.push({ x0: x0, x1: x1, y0: y, y1: y });
      }
    }
    const inkStats = (b, y0, y1) => {
      let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, count = 0;
      const xa = Math.max(0, b.x0 - Math.round(wide(b) * 0.15));
      const xb = Math.min(w, b.x1 + Math.round(wide(b) * 0.15));
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
        for (let x = xa; x < xb; x++) {
          if (dark[y * w + x]) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            count++;
          }
        }
      }
      return { w: maxX - minX + 1, cx: (minX + maxX) / 2, count: count,
               minX: minX, maxX: maxX, minY: minY, maxY: maxY };
    };
    const wide = b => b.x1 - b.x0 + 1;
    const cropUrl = (x0, y0, x1, y1) => {
      const pad = 10;
      const a = Math.max(0, x0 - pad), b = Math.max(0, y0 - pad);
      const cc = document.createElement('canvas');
      cc.width = Math.max(1, Math.min(w, x1 + pad) - a);
      cc.height = Math.max(1, Math.min(h, y1 + pad) - b);
      const cx = cc.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, cc.width, cc.height);
      cx.drawImage(c, a, b, cc.width, cc.height, 0, 0, cc.width, cc.height);
      return cc.toDataURL('image/png');
    };
    const found = [];
    const asciiMath = /^[0-9A-Za-z+\-().^_{}\\]{1,10}$/;
    for (const b of bars) {
      if (found.length >= 3) break;
      const bw = wide(b), thick = b.y1 - b.y0 + 1;
      /* 分数线：又长又薄，且不能是等号的一横 / 段落里的下划线 */
      if (thick > 3 || bw < 24 || bw > w * 0.5 || bw / thick < 8) continue;
      const band = Math.round(Math.max(18, bw * 0.75));
      const numInk = inkStats(b, b.y0 - band, b.y0 - 1);
      const denInk = inkStats(b, b.y1 + 2, b.y1 + 1 + band);
      const bc = (b.x0 + b.x1) / 2;
      /* 分子 / 分母必须是「居中的一小块文字」，而不是一整行正文 */
      if (numInk.count < 4 || denInk.count < 4) continue;
      if (numInk.w > bw * 1.1 || denInk.w > bw * 1.1) continue;
      if (Math.abs(numInk.cx - bc) > bw * 0.35 || Math.abs(denInk.cx - bc) > bw * 0.35) continue;
      try {
        report(onProgress, '正在识别分式结构', 0.8);
        const ny0 = Math.max(0, numInk.minY - 8), ny1 = Math.min(h, numInk.maxY + 8);
        const dy0 = Math.max(0, denInk.minY - 8), dy1 = Math.min(h, denInk.maxY + 8);
        const rn = await worker.recognize(cropUrl(b.x0, ny0, b.x1, ny1), {}, { text: true });
        const rd = await worker.recognize(cropUrl(b.x0, dy0, b.x1, dy1), {}, { text: true });
        const num = normalizeText((rn.data && rn.data.text) || '').replace(/\s+/g, '');
        const den = normalizeText((rd.data && rd.data.text) || '').replace(/\s+/g, '');
        /* 二次 OCR 结果必须是纯 ASCII 数学片段：中文 / 标点说明这不是分式 */
        if (!asciiMath.test(num) || !asciiMath.test(den)) continue;
        if (!/[0-9A-Za-z]/.test(num) || !/[0-9A-Za-z]/.test(den)) continue;
        found.push({ y: (b.y0 + b.y1) / 2, band: band,
                     latex: '\\frac{' + mapMath(num) + '}{' + mapMath(den) + '}' });
      } catch (e) { /* 单个分式识别失败不影响整题 */ }
    }
    return found;
  }

  async function recognizeMath(src, onProgress) {
    const r = await recognize(src, onProgress);
    const worker = r.worker;
    const lines = (r.raw && r.raw.lines) || [];
    let fractions = [];
    try { fractions = await detectFractions(r.image, worker, onProgress); }
    catch (e) { /* 分式检测失败时退化为文本模式 */ }
    report(onProgress, '正在整理公式结构', 0.92);

    /* 堆叠分式（分数线 + 上下两行数字）会被 Tesseract 拆成两行，
       分数线本身落在两行之间。把这两行合并成一个 \frac，并保留其余正文。 */
    const skip = new Set(), insert = new Map();
    for (const f of fractions) {
      const reach = (f.band || 60) * 2;
      let above = -1, below = -1;
      for (let j = 0; j < lines.length; j++) {
        const bb = lines[j].bbox || { y0: -1, y1: -1 };
        if (bb.y1 <= f.y && bb.y1 > f.y - reach && !skip.has(j)) above = j;
      }
      for (let j = 0; j < lines.length; j++) {
        const bb = lines[j].bbox || { y0: -1, y1: -1 };
        if (bb.y0 >= f.y && bb.y0 < f.y + reach && !skip.has(j)) { below = j; break; }
      }
      const key = (above >= 0 && below > above) ? above : -1;
      if (key >= 0) { skip.add(above); skip.add(below); }
      if (!insert.has(key)) insert.set(key, []);
      insert.get(key).push(f.latex);
    }

    const formulas = [], outLines = [];
    for (let j = 0; j < lines.length; j++) {
      for (const lx of (insert.get(j) || [])) {
        formulas.push(lx); outLines.push('$' + lx + '$');
      }
      if (skip.has(j)) continue;
      const m = polishMath(lineToMath(lines[j]));
      if (!m) continue;
      const hybrid = hybridLine(m);
      outLines.push(hybrid);
      const segs = hybrid.match(/\$([^$]+)\$/g) || [];
      for (const s of segs) formulas.push(s.slice(1, -1));
      if (!segs.length && isMathy(m)) formulas.push(m);
    }
    /* 没能与任何文字行配对的分数线，作为独立公式追加在末尾 */
    for (const lx of (insert.get(-1) || [])) {
      formulas.push(lx); outLines.push('$' + lx + '$');
    }
    const text = outLines.join('\n') || r.text;
    return {
      text: text, plain: r.text, latex: formulas.join('\\\\[4pt]\n'),
      formulas: formulas, confidence: r.confidence, fractions: fractions.length
    };
  }

  /* KaTeX 离线渲染：CSS/JS/字体都在 ocr/katex/ 下，失败时静默降级。 */
  let _katexP = null;
  function ensureKatex() {
    if (global.katex) return Promise.resolve(global.katex);
    if (_katexP) return _katexP;
    _katexP = new Promise((res, rej) => {
      const base = OCR_BASE + '/katex/';
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = base + 'katex.min.css';
      document.head.appendChild(link);
      const s = document.createElement('script');
      s.src = base + 'katex.min.js';
      s.onload = () => global.katex ? res(global.katex) : rej(new Error('KaTeX 加载失败'));
      s.onerror = () => rej(new Error('未找到 KaTeX 资源'));
      document.head.appendChild(s);
    }).catch(e => { _katexP = null; throw e; });
    return _katexP;
  }

  async function renderMath(el, latex) {
    if (!el || !latex) return false;
    try {
      const katex = await ensureKatex();
      katex.render(latex, el, { displayMode: true, throwOnError: false, strict: false, trust: false });
      return true;
    } catch (e) { return false; }
  }

  /* 把一段「普通文字 + $行内公式$ + $$块公式$$」渲染进容器。
     普通文字原样保留（含换行），只把 $…$ 片段交给 KaTeX；加载期间/失败时保留原始 $…$，
     所以永远有可读内容，不会因离线资源缺失而空白。返回 Promise<boolean>。 */
  function renderMathText(el, text) {
    if (!el) return Promise.resolve(false);
    const src = String(text == null ? '' : text);
    const parts = [];
    const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g;
    let last = 0, m;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) parts.push({ type: 'text', value: src.slice(last, m.index) });
      if (m[1] != null) parts.push({ type: 'math', value: m[1], display: true });
      else parts.push({ type: 'math', value: m[2], display: false });
      last = re.lastIndex;
    }
    if (last < src.length) parts.push({ type: 'text', value: src.slice(last) });
    if (!parts.length) parts.push({ type: 'text', value: src });

    const slots = [];
    el.textContent = '';
    parts.forEach(p => {
      if (p.type === 'text') {
        el.appendChild(document.createTextNode(p.value));
      } else {
        const span = document.createElement(p.display ? 'div' : 'span');
        span.className = p.display ? 'math-display' : 'math-inline';
        span.textContent = (p.display ? '$$' : '$') + p.value + (p.display ? '$$' : '$');
        el.appendChild(span);
        slots.push({ el: span, value: p.value, display: p.display });
      }
    });
    if (!slots.length) return Promise.resolve(false);
    return ensureKatex().then(katex => {
      slots.forEach(s => {
        try {
          katex.render(s.value, s.el, {
            displayMode: s.display, throwOnError: false, strict: false, trust: false
          });
        } catch (e) { /* 保留原始 $…$ 文本 */ }
      });
      return true;
    }).catch(() => false);
  }

  async function checkResources() {
    const gz = await langGzip();
    const need = [
      'tesseract.min.js', 'worker.min.js',
      'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm',
      'tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm',
      'lang/chi_sim.traineddata' + (gz ? '.gz' : ''),
      'lang/eng.traineddata' + (gz ? '.gz' : '')
    ];
    const missing = [];
    for (const f of need) {
      try {
        const r = await fetch(OCR_BASE + '/' + f, { method: 'HEAD' });
        if (!r.ok) missing.push(f);
      } catch (e) { missing.push(f); }
    }
    return { ok: !missing.length, missing: missing };
  }

  /* ---------------------------------------------------------
     图形净化：照片 → 纯白背景干净图形
     步骤：分块背景估计 → 相对亮度判定墨迹 → 去孤立噪点 → 白平衡输出 PNG
     --------------------------------------------------------- */
  function despeckle(ink, w, h, minNeighbors) {
    const out = ink.slice();
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        if (!ink[i]) continue;
        let n = 0;
        n += ink[i - w - 1] + ink[i - w] + ink[i - w + 1];
        n += ink[i - 1] + ink[i + 1];
        n += ink[i + w - 1] + ink[i + w] + ink[i + w + 1];
        if (n < minNeighbors) out[i] = 0;
      }
    }
    ink.set(out);
  }

  async function cleanFigure(src, opts) {
    opts = opts || {};
    let mode = opts.mode === 'mono' ? 'mono' : 'white';
    const strength = Math.max(0.08, Math.min(0.45, opts.strength == null ? 0.20 : opts.strength));
    const im = await U.loadImage(src);
    const maxSide = opts.maxSide || 1600;
    let w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    const sc = Math.min(1, maxSide / Math.max(w, h));
    w = Math.max(1, Math.round(w * sc)); h = Math.max(1, Math.round(h * sc));

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(im, 0, 0, w, h);
    const srcData = ctx.getImageData(0, 0, w, h);
    const px = srcData.data;
    const n = w * h;
    const gray = new Uint8Array(n), sat = new Uint8Array(n);
    let sum = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = px[p], g = px[p + 1], b = px[p + 2];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const v = (r * 77 + g * 150 + b * 29) >> 8;
      gray[i] = v; sat[i] = mx - mn; sum += v;
    }
    /* 深底浅字（黑板照片）自动反转成白底黑线 */
    const dark = (sum / n) < 105;
    if (dark) mode = 'mono';

    /* 1. 分块背景亮度：取每块高分位（深底取低分位），再双线性插值成背景图 */
    const block = 32;
    const bw = Math.ceil(w / block), bh = Math.ceil(h / block);
    const grid = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const hist = new Uint16Array(256);
        let cnt = 0;
        const x0 = bx * block, y0 = by * block;
        const x1 = Math.min(w, x0 + block), y1 = Math.min(h, y0 + block);
        for (let y = y0; y < y1; y++) {
          const row = y * w;
          for (let x = x0; x < x1; x++) { hist[gray[row + x]]++; cnt++; }
        }
        const target = cnt * (dark ? 0.15 : 0.85);
        let acc = 0, level = 255;
        for (let k = 0; k < 256; k++) { acc += hist[k]; if (acc >= target) { level = k; break; } }
        grid[by * bw + bx] = dark ? Math.max(20, Math.min(level, 120)) : Math.max(140, level);
      }
    }
    /* 3x3 平滑背景网格：阴影 / 纸张渐变跨块时不会在块边界产生假墨迹 */
    const gridS = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let s = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = by + dy, xx = bx + dx;
            if (yy < 0 || yy >= bh || xx < 0 || xx >= bw) continue;
            s += grid[yy * bw + xx]; cnt++;
          }
        }
        gridS[by * bw + bx] = s / cnt;
      }
    }
    const bgPix = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      const gy = y / block, by0 = Math.floor(gy), ty = gy - by0;
      const by1 = Math.min(bh - 1, by0 + 1);
      for (let x = 0; x < w; x++) {
        const gx = x / block, bx0 = Math.floor(gx), tx = gx - bx0;
        const bx1 = Math.min(bw - 1, bx0 + 1);
        const a = gridS[by0 * bw + bx0], b = gridS[by0 * bw + bx1];
        const c2 = gridS[by1 * bw + bx0], d = gridS[by1 * bw + bx1];
        bgPix[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c2 * (1 - tx) + d * tx) * ty;
      }
    }

    /* 2. 相对亮度判定墨迹（对阴影、纸张泛黄不敏感）；彩色笔迹单独保留 */
    const ink = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const B = bgPix[i] || 255, g = gray[i], norm = g / B;
      let hit;
      if (dark) hit = norm > 1 + strength * 0.8;
      else hit = norm < 1 - strength;
      /* 彩色笔迹要同时「够饱和」且「明显偏暗」才算墨迹，否则泛黄纸面会被留成色块 */
      if (!dark && sat[i] > 55 && norm < 0.88) hit = true;
      ink[i] = hit ? 1 : 0;
    }

    /* 3. 去掉孤立噪点（两轮），保留连续线条 */
    despeckle(ink, w, h, 2);
    despeckle(ink, w, h, 2);

    /* 4. 输出：非墨迹一律纯白；墨迹按白平衡校正保留原色，或转成黑色线稿 */
    const out = ctx.createImageData(w, h);
    const op = out.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (!ink[i]) { op[p] = op[p + 1] = op[p + 2] = 255; op[p + 3] = 255; continue; }
      const B = bgPix[i] || 255;
      if (mode === 'mono') {
        const t = dark ? Math.min(1, B / Math.max(1, gray[i])) : Math.min(1, gray[i] / B);
        const v = Math.max(24, Math.min(96, 30 + (1 - t) * 36));
        op[p] = op[p + 1] = op[p + 2] = v;
      } else {
        const k = 255 / Math.max(1, B);
        const adj = v => { const z = (v * k - 128) * 1.10 + 128; return z < 0 ? 0 : z > 255 ? 255 : z; };
        op[p] = adj(px[p]); op[p + 1] = adj(px[p + 1]); op[p + 2] = adj(px[p + 2]);
      }
      op[p + 3] = 255;
    }
    const oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    oc.getContext('2d').putImageData(out, 0, 0);
    /* PNG 无损：纯白背景不会被有损压缩染成灰底 */
    return { dataUrl: oc.toDataURL('image/png'), width: w, height: h, mode: mode, dark: dark };
  }

  global.Vision = {
    OCR_BASE: OCR_BASE,
    normalizeText: normalizeText,
    meaningfulChars: meaningfulChars,
    classify: classify,
    recognize: recognize,
    recognizeMath: recognizeMath,
    renderMath: renderMath,
    renderMathText: renderMathText,
    cleanFigure: cleanFigure,
    checkResources: checkResources,
    warmup: onProgress => ensureWorker(onProgress)
  };
})(window);
