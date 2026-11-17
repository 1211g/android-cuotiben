/* ============================================================
   utils.js — shared helpers
   ============================================================ */
(function (global) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  const pad = n => String(n).padStart(2, '0');

  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }
  function fmtDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return fmtDate(ts) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function relDate(ts) {
    if (!ts) return '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff < 7) return diff + ' 天前';
    return fmtDate(ts);
  }

  function startOfWeek(ts) {
    const d = new Date(ts);
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d.getTime();
  }
  function weekShort(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function formatBytes(n) {
    if (!n || n < 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(n >= 10 ? 1 : 2)) + ' ' + u[i];
  }

  function icon(name, cls) {
    return '<svg class="icon ' + (cls || '') + '"><use href="#i-' + name + '"/></svg>';
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, a), ms || 200);
    };
  }

  function readFileAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result || ''));
      r.onerror = () => rej(r.error);
      r.readAsText(file, 'UTF-8');
    });
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('图片加载失败'));
      im.src = src;
    });
  }

  function canvasToDataURL(canvas, q, lossless) {
    if (lossless) return canvas.toDataURL('image/png');
    let url = canvas.toDataURL('image/webp', q);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', q);
    return url;
  }

  function drawScaled(im, maxSide, q, brightness) {
    let w = im.naturalWidth, h = im.naturalHeight;
    const s = Math.min(1, maxSide / Math.max(w, h));
    w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (brightness != null && brightness !== 1) ctx.filter = 'brightness(' + brightness + ')';
    ctx.drawImage(im, 0, 0, w, h);
    return canvasToDataURL(c, q);
  }

  /* Produce full + thumbnail data URLs from a source image, with optional
     crop rect expressed in natural-image coordinates. */
  async function makeVariants(src, opts) {
    opts = opts || {};
    const im = await loadImage(src);
    let source = im;
    let cropCanvas = null;
    if (opts.crop) {
      const cr = opts.crop;
      const cw = Math.max(1, Math.round(cr.w)), ch = Math.max(1, Math.round(cr.h));
      cropCanvas = document.createElement('canvas');
      cropCanvas.width = cw; cropCanvas.height = ch;
      const cx = cropCanvas.getContext('2d');
      if (opts.brightness && opts.brightness !== 1) cx.filter = 'brightness(' + opts.brightness + ')';
      cx.drawImage(im, Math.round(cr.x), Math.round(cr.y), cw, ch, 0, 0, cw, ch);
      source = cropCanvas;
    } else if (opts.brightness && opts.brightness !== 1) {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const cx = c.getContext('2d');
      cx.filter = 'brightness(' + opts.brightness + ')';
      cx.drawImage(im, 0, 0);
      source = c;
    }
    const pick = (maxSide, q) => {
      const w = source.naturalWidth || source.width;
      const h = source.naturalHeight || source.height;
      const s = Math.min(1, maxSide / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
      return canvasToDataURL(c, q, opts.lossless);
    };
    return {
      full: pick(1600, 0.82),
      thumb: pick(320, 0.72),
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
      lossless: !!opts.lossless
    };
  }

  function dataURLToBytes(dataURL) {
    const comma = dataURL.indexOf(',');
    const meta = dataURL.slice(5, comma);
    const b64 = dataURL.slice(comma + 1);
    const mime = meta.split(';')[0] || 'image/webp';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime, ext: (mime.split('/')[1] || 'webp').replace('jpeg', 'jpg') };
  }

  function bytesToDataURL(bytes, mime) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return 'data:' + (mime || 'image/webp') + ';base64,' + btoa(s);
  }

  function downloadBlob(blob, filename) {
    // Native WebView shell: hand the bytes to Android, which writes into Downloads.
    if (window.CuotiBridge && window.CuotiBridge.saveBase64) {
      const fr = new FileReader();
      fr.onload = () => {
        const dataUrl = String(fr.result);
        const comma = dataUrl.indexOf(',');
        window.CuotiBridge.saveBase64(comma >= 0 ? dataUrl.slice(comma + 1) : '', filename);
      };
      fr.onerror = () => toast('导出失败：无法读取备份数据', 'err');
      fr.readAsDataURL(blob);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /* ---------- toast ---------- */
  let toastSeq = 0;
  function toast(msg, type, actionLabel, onAction) {
    const root = $('#toastRoot');
    if (!root) return;
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'ok');
    const ic = type === 'err' ? 'info' : (type === 'info' ? 'sparkles' : 'check-circle');
    t.innerHTML = icon(ic) + '<span>' + esc(msg) + '</span>';
    if (actionLabel) {
      const b = document.createElement('button');
      b.textContent = actionLabel;
      b.onclick = () => { if (onAction) onAction(); t.remove(); };
      t.appendChild(b);
    }
    root.appendChild(t);
    const id = ++toastSeq;
    t.dataset.id = id;
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, actionLabel ? 9000 : 2600);
    return t;
  }

  function haptic(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { /* noop */ }
  }

  global.U = {
    $, $$, esc, uid, pad, fmtDate, fmtDateTime, fmtTime, relDate,
    startOfWeek, weekShort, formatBytes, icon, debounce,
    readFileAsDataURL, readFileAsText, loadImage, makeVariants, dataURLToBytes, bytesToDataURL,
    downloadBlob, toast, haptic
  };
})(window);
