/* ============================================================
   pdf.js — offline PDF import + viewing, powered by Mozilla pdf.js
   All files stay on this device. No network calls.
   Exposes window.Pdf
   ============================================================ */
(function (global) {
  'use strict';

  const PDF_BASE = new URL('pdf/', document.baseURI).href.replace(/\/$/, '');
  const MAX_PDF_BYTES = 60 * 1024 * 1024; // 60MB guard

  let _libP = null;
  function ensureLib() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    if (_libP) return _libP;
    _libP = new Promise((resolve, reject) => {
      if (!document.querySelector('script[data-pdfjs]')) {
        const s = document.createElement('script');
        s.src = PDF_BASE + '/pdf.min.js';
        s.setAttribute('data-pdfjs', '1');
        s.onload = () => {
          if (!global.pdfjsLib) { reject(new Error('pdf.js 加载失败')); return; }
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_BASE + '/pdf.worker.min.js';
          resolve(global.pdfjsLib);
        };
        s.onerror = () => reject(new Error('无法加载 PDF 渲染引擎'));
        document.head.appendChild(s);
      } else {
        const wait = setInterval(() => {
          if (global.pdfjsLib) {
            clearInterval(wait);
            global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_BASE + '/pdf.worker.min.js';
            resolve(global.pdfjsLib);
          }
        }, 80);
        setTimeout(() => { clearInterval(wait); reject(new Error('PDF 引擎加载超时')); }, 15000);
      }
    });
    return _libP;
  }

  function slug(name) {
    return String(name || 'document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  }

  /* Import a File/Blob into IndexedDB. Returns the stored pdf record. */
  async function importFile(file) {
    if (!file) throw new Error('未选择文件');
    if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') {
      throw new Error('请选择 PDF 文件');
    }
    if (file.size > MAX_PDF_BYTES) throw new Error('PDF 太大（上限 60MB）');
    const buf = await file.arrayBuffer();
    // verify it is really a PDF (magic header %PDF-)
    const head = new Uint8Array(buf.slice(0, 5));
    const isPdf = head.length === 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
    if (!isPdf) throw new Error('文件不是有效的 PDF');
    const rec = {
      id: (global.U && U.uid('pdf')) || ('pdf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      name: slug(file.name || '未命名.pdf'),
      data: buf,
      size: file.size,
      createdAt: Date.now()
    };
    await DB.putPdf(rec);
    return rec;
  }

  /* Load a stored record into a pdf.js doc. Accepts a record or its id. */
  async function loadDoc(recOrId) {
    const rec = typeof recOrId === 'string' ? await DB.getPdf(recOrId) : recOrId;
    if (!rec) throw new Error('PDF 不存在');
    const lib = await ensureLib();
    const data = rec.data instanceof ArrayBuffer ? rec.data.slice(0) : new Uint8Array(rec.data).buffer;
    const task = lib.getDocument({
      data: data,
      cMapUrl: PDF_BASE + '/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: PDF_BASE + '/standard_fonts/',
      useSystemFonts: false,
      disableFontFace: false
    });
    return await task.promise;
  }

  /* Render one page to a canvas at a given scale. Returns {viewport, numPages}. */
  async function renderPage(doc, pageNo, canvas, scale) {
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: scale || 1.4 });
    const ctx = canvas.getContext('2d', { alpha: false });
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    return { width: base.width, height: base.height, numPages: doc.numPages };
  }

  /* Return the intrinsic page size at scale 1 (used for fit-to-container). */
  async function getPageSize(doc, pageNo) {
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale: 1 });
    return { width: vp.width, height: vp.height };
  }

  /* Flatten a pdf.js outline into [{title, page}] (1-based). Nested items are
     flattened in order; any destination that cannot be resolved falls back to page 1. */
  async function getOutline(doc) {
    if (!doc || typeof doc.getOutline !== 'function') return [];
    let outline;
    try { outline = await doc.getOutline(); } catch (e) { return []; }
    if (!Array.isArray(outline)) return [];
    const out = [];
    async function walk(items) {
      for (const item of items) {
        if (!item || !item.title) continue;
        let page = 1;
        try {
          const dest = item.dest;
          if (dest) {
            const ref = Array.isArray(dest) ? dest[0] : dest;
            const idx = await doc.getPageIndex(ref);
            if (typeof idx === 'number' && idx >= 0) page = idx + 1;
          }
        } catch (e) { page = 1; }
        out.push({ title: String(item.title), page: page });
        if (Array.isArray(item.items) && item.items.length) await walk(item.items);
      }
    }
    await walk(outline);
    return out;
  }

  /* Case-insensitive text search on a single page. Returns {page, hits:[{snippet}]},
     at most 20 snippets with ~30 chars of context on each side. */
  async function searchPage(doc, pageNo, query) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    const pageNoOut = Math.max(1, Math.floor(Number(pageNo) || 1));
    const result = { page: pageNoOut, hits: [] };
    if (!q || !doc || typeof doc.getPage !== 'function') return result;
    let page;
    try { page = await doc.getPage(pageNoOut); } catch (e) { return result; }
    let content;
    try { content = await page.getTextContent(); } catch (e) { return result; }
    const items = content && Array.isArray(content.items) ? content.items : [];
    let joined = '';
    for (const it of items) joined += (it && typeof it.str === 'string') ? it.str : '';
    const lower = joined.toLowerCase();
    let from = 0;
    while (result.hits.length < 20) {
      const idx = lower.indexOf(q, from);
      if (idx < 0) break;
      const s = Math.max(0, idx - 30);
      const e = Math.min(joined.length, idx + q.length + 30);
      let snippet = joined.slice(s, e).replace(/\s+/g, ' ').trim();
      if (s > 0) snippet = '…' + snippet;
      if (e < joined.length) snippet = snippet + '…';
      result.hits.push({ snippet: snippet });
      from = idx + Math.max(1, q.length);
    }
    return result;
  }

  /* Import a local HTML file as an offline document. Stored in the same
     object store as PDFs, tagged with kind:'html' and a text payload. */
  async function importHtml(file) {
    if (!file) throw new Error('未选择文件');
    const name = String(file.name || '');
    if (!/\.html?$/i.test(name) && !/text\/html/i.test(file.type || '')) {
      throw new Error('请选择 HTML 文件');
    }
    const MAX_HTML = 12 * 1024 * 1024;
    if (file.size > MAX_HTML) throw new Error('HTML 太大（上限 12MB）');
    let text;
    if (typeof file.text === 'function') text = await file.text();
    else text = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error);
      fr.readAsText(file, 'utf-8');
    });
    const rec = {
      id: (global.U && U.uid('doc')) || ('doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      name: slug(name || '未命名.html'),
      kind: 'html',
      data: text,
      size: file.size,
      createdAt: Date.now()
    };
    await DB.putPdf(rec);
    return rec;
  }

  function checkResources() {
    const files = ['pdf.min.js', 'pdf.worker.min.js'];
    return Promise.all(files.map(async f => {
      try {
        const r = await fetch(PDF_BASE + '/' + f, { method: 'HEAD' });
        return { f, ok: r.ok };
      } catch (e) { return { f, ok: false }; }
    }));
  }

  global.Pdf = { ensureLib, importFile, importHtml, loadDoc, renderPage, getPageSize, getOutline, searchPage, checkResources, PDF_BASE, MAX_PDF_BYTES };
})(window);
