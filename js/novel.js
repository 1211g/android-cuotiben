/* ============================================================
   novel.js — TXT 小说阅读器
   复用 DB 的 pdfs store 保存 {kind:'txt'} 记录；不依赖 app.js。
   ============================================================ */
(function (global) {
  'use strict';

  const MAX_TXT_BYTES = 20 * 1024 * 1024;

  const FONT_KEY = 'noteee_novel_font';
  const THEME_KEY = 'noteee_novel_theme';
  const FONT_DEFAULT = 20, FONT_MIN = 14, FONT_MAX = 32, FONT_STEP = 2;
  const THEMES = ['paper', 'eye', 'night'];
  const THEME_LABEL = { paper: '纸张', eye: '护眼', night: '夜间' };

  // 章节标题行：整行（允许首尾空白）匹配以下任一前缀即视为标题
  const HEAD_RE = /^(?:第[零一二三四五六七八九十百千壹贰叁肆伍陆柒捌玖拾两0-9]+[章节回卷部篇集折]|Chapter\s+\d+|[0-9]+[、.．](?!\d))/i;

  /* 把全文切成 [{title,start,end}]。end = 下一章 start；最后一章 end = text.length。 */
  function parseChapters(text) {
    text = text == null ? '' : String(text);
    const len = text.length;
    const marks = []; // {title, start}
    let i = 0;
    while (i <= len) {
      let j = text.indexOf('\n', i);
      if (j < 0) j = len;
      const line = text.slice(i, j);
      const trimmed = line.replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, '');
      if (trimmed && HEAD_RE.test(trimmed)) {
        const leading = line.length - line.replace(/^[\s\uFEFF]+/, '').length;
        marks.push({ title: trimmed, start: i + leading });
      }
      if (j === len) break;
      i = j + 1;
    }
    if (!marks.length) return [{ title: '正文', start: 0, end: len }];
    return marks.map(function (m, k) {
      return {
        title: m.title,
        start: m.start,
        end: k + 1 < marks.length ? marks[k + 1].start : len
      };
    });
  }

  /* 读取并入库一个 TXT 文件，返回新建的记录。 */
  async function importTxt(file) {
    if (!file) throw new Error('没有选择文件');
    const name = file.name || '';
    const type = file.type || '';
    const extOk = /\.txt$/i.test(name);
    const typeOk = /text\/plain/i.test(type);
    if (!extOk && !typeOk) throw new Error('仅支持 TXT 文本文件');
    if (typeof file.size === 'number' && file.size > MAX_TXT_BYTES) {
      throw new Error('文件超过 20 MB 上限，无法导入');
    }

    let text;
    try {
      if (typeof file.text !== 'function') throw new Error('no text()');
      text = await file.text();
    } catch (e) {
      text = await new Promise(function (resolve, reject) {
        const r = new FileReader();
        r.onload = function () { resolve(String(r.result || '')); };
        r.onerror = function () { reject(r.error || new Error('读取文件失败')); };
        r.readAsText(file, 'UTF-8');
      });
    }

    const chapters = parseChapters(text);
    const rec = {
      id: U.uid('txt'),
      name: name.replace(/\.txt$/i, '') || '未命名小说',
      kind: 'txt',
      data: text,
      chapters: chapters,
      size: (typeof file.size === 'number' ? file.size : text.length),
      createdAt: Date.now(),
      progress: { chapter: 0, scroll: 0 }
    };
    await DB.putPdf(rec);
    return rec;
  }

  /* 列出全部小说，按导入时间倒序。 */
  async function listNovels() {
    const all = await DB.getAllPdfs();
    return all.filter(function (p) { return p && p.kind === 'txt'; })
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  function loadFont() {
    let f = FONT_DEFAULT;
    try { f = parseInt(global.localStorage.getItem(FONT_KEY), 10); } catch (e) { /* noop */ }
    if (!isFinite(f)) f = FONT_DEFAULT;
    f = Math.min(FONT_MAX, Math.max(FONT_MIN, f));
    return FONT_MIN + Math.round((f - FONT_MIN) / FONT_STEP) * FONT_STEP;
  }
  function saveFont(f) {
    try { global.localStorage.setItem(FONT_KEY, String(f)); } catch (e) { /* noop */ }
  }
  function loadTheme() {
    let t = '';
    try { t = global.localStorage.getItem(THEME_KEY) || ''; } catch (e) { /* noop */ }
    if (THEMES.indexOf(t) >= 0) return t;
    return document.body && document.body.classList.contains('theme-dark') ? 'night' : 'paper';
  }
  function saveTheme(t) {
    try { global.localStorage.setItem(THEME_KEY, t); } catch (e) { /* noop */ }
  }

  /* 打开全屏阅读器。返回一个控制器 { close }。 */
  async function openReader(id) {
    const host = document.getElementById('overlayRoot');
    if (!host) { U.toast('界面尚未就绪，请稍后再试', 'err'); return null; }

    let rec;
    try { rec = await DB.getPdf(id); } catch (e) { rec = null; }
    if (!rec || rec.kind !== 'txt') { U.toast('未找到这本小说', 'err'); return null; }

    const data = typeof rec.data === 'string' ? rec.data : '';
    if (!Array.isArray(rec.chapters) || !rec.chapters.length) rec.chapters = parseChapters(data);
    const chapters = rec.chapters;
    const total = chapters.length;

    // 同名阅读器单例：移除可能残留的旧实例
    Array.prototype.forEach.call(host.querySelectorAll('.novel-overlay'), function (el) { el.remove(); });

    let cur = Math.floor(Number(rec.progress && rec.progress.chapter) || 0);
    cur = Math.min(total - 1, Math.max(0, cur));
    let restoreScroll = Number(rec.progress && rec.progress.scroll) || 0;
    if (restoreScroll < 0) restoreScroll = 0;

    let font = loadFont();
    let theme = loadTheme();
    let closed = false;
    let scrollTimer = null;
    const cleanups = [];

    const root = document.createElement('div');
    root.className = 'overlay novel-overlay';
    root.innerHTML =
      '<div class="overlay-mask"></div>' +
      '<div class="sheet-full novel-reader">' +
        '<div class="novel-top">' +
          '<button class="icon-btn" data-x="cancel" aria-label="返回">' + U.icon('arrow-left') + '</button>' +
          '<h2 id="nvTitle">' + U.esc(rec.name || '未命名小说') + '</h2>' +
          '<button class="icon-btn" id="nvCatalogBtn" aria-label="目录">' + U.icon('list') + '</button>' +
        '</div>' +
        '<div class="novel-content" id="nvContent"></div>' +
        '<div class="novel-bottom">' +
          '<div class="novel-nav">' +
            '<button id="nvPrev">上一章</button>' +
            '<span id="nvProgress"></span>' +
            '<button id="nvNext">下一章</button>' +
          '</div>' +
          '<div class="novel-tools" id="nvTools">' +
            '<button id="nvFontDown">A-</button>' +
            '<button id="nvFontUp">A+</button>' +
            '<button id="nvTheme">主题</button>' +
            '<button id="nvSetting">设置</button>' +
          '</div>' +
        '</div>' +
        '<div class="nv-cat-scrim" id="nvCatScrim" hidden></div>' +
        '<div class="novel-catalog" id="nvCatalog" hidden></div>' +
      '</div>';

    const reader = root.querySelector('.novel-reader');
    const content = root.querySelector('#nvContent');
    const progressEl = root.querySelector('#nvProgress');
    const prevBtn = root.querySelector('#nvPrev');
    const nextBtn = root.querySelector('#nvNext');
    const catalogBtn = root.querySelector('#nvCatalogBtn');
    const catalog = root.querySelector('#nvCatalog');
    const scrim = root.querySelector('#nvCatScrim');
    const tools = root.querySelector('#nvTools');
    const fontDown = root.querySelector('#nvFontDown');
    const fontUp = root.querySelector('#nvFontUp');
    const themeBtn = root.querySelector('#nvTheme');
    const settingBtn = root.querySelector('#nvSetting');

    function applyFont() { reader.style.setProperty('--nv-font', font + 'px'); }
    function applyTheme() {
      reader.classList.remove('theme-paper', 'theme-eye', 'theme-night');
      reader.classList.add('theme-' + theme);
    }
    function setFont(v) {
      font = Math.min(FONT_MAX, Math.max(FONT_MIN, v));
      font = FONT_MIN + Math.round((font - FONT_MIN) / FONT_STEP) * FONT_STEP;
      applyFont(); saveFont(font); U.haptic(8);
    }
    function cycleTheme() {
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      applyTheme(); saveTheme(theme); U.haptic(8);
      U.toast('已切换到' + THEME_LABEL[theme] + '主题', 'info');
    }

    function persist() {
      if (!rec.progress || typeof rec.progress !== 'object') rec.progress = {};
      rec.progress.chapter = cur;
      rec.progress.scroll = content.scrollTop || 0;
      try { Promise.resolve(DB.putPdf(rec)).catch(function () {}); } catch (e) { /* noop */ }
    }
    function onScroll() {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(persist, 250);
    }

    function renderChapter() {
      const ch = chapters[cur] || { start: 0, end: data.length, title: '正文' };
      const start = Math.max(0, ch.start | 0);
      const end = Math.min(data.length, ch.end | 0);
      const raw = data.slice(start, end > start ? end : start);
      const paras = raw.split(/\r\n|\r|\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      content.innerHTML = paras.length
        ? paras.map(function (p) { return '<p>' + U.esc(p) + '</p>'; }).join('')
        : '<p>（本章暂无内容）</p>';
      progressEl.textContent = '第 ' + (cur + 1) + ' / ' + total + ' 章';
      prevBtn.disabled = cur <= 0;
      nextBtn.disabled = cur >= total - 1;
      updateCatalogHighlight();
    }
    function goChapter(idx) {
      const next = Math.min(total - 1, Math.max(0, Math.floor(Number(idx) || 0)));
      if (next === cur) return;
      cur = next;
      content.scrollTop = 0;
      renderChapter();
      persist();
      U.haptic(8);
    }

    function buildCatalog() {
      catalog.innerHTML = '<div class="nv-cat-head">目录 · 共 ' + total + ' 章</div>' +
        chapters.map(function (c, i) {
          return '<button class="nv-cat-item' + (i === cur ? ' active' : '') + '" data-idx="' + i + '">' +
            '<span class="nv-cat-idx">' + (i + 1) + '</span>' +
            '<span class="nv-cat-title">' + U.esc(c.title || ('第 ' + (i + 1) + ' 章')) + '</span>' +
            '</button>';
        }).join('');
    }
    function updateCatalogHighlight() {
      const items = catalog.querySelectorAll('.nv-cat-item');
      for (let i = 0; i < items.length; i++) items[i].classList.toggle('active', i === cur);
    }
    function toggleCatalog(force) {
      const show = typeof force === 'boolean' ? force : catalog.hidden;
      catalog.hidden = !show;
      scrim.hidden = !show;
    }
    function toggleImmersive(force) {
      const on = typeof force === 'boolean' ? force : !reader.classList.contains('immersive');
      reader.classList.toggle('immersive', on);
      if (on) toggleCatalog(false);
    }

    function close() {
      if (closed) return;
      if (scrollTimer) clearTimeout(scrollTimer);
      persist();
      closed = true;
      cleanups.forEach(function (fn) { try { fn(); } catch (e) { /* noop */ } });
      root.style.transition = 'opacity .2s';
      root.style.opacity = '0';
      setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, 200);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goChapter(cur - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goChapter(cur + 1); }
    }

    // 渲染初始状态
    applyFont();
    applyTheme();
    buildCatalog();
    renderChapter();
    host.appendChild(root);
    // Smooth entrance: skip the full-screen blur while the reader slides in,
    // restore it afterwards (same helper the app sheets use) — no frame drops.
    if (U.enterSheet) U.enterSheet(root.querySelector('.novel-reader'));
    content.scrollTop = restoreScroll;

    // 事件绑定
    root.querySelector('[data-x="cancel"]').addEventListener('click', close);
    root.querySelector('.overlay-mask').addEventListener('click', close);
    prevBtn.addEventListener('click', function () { goChapter(cur - 1); });
    nextBtn.addEventListener('click', function () { goChapter(cur + 1); });
    catalogBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleCatalog(); U.haptic(8); });
    scrim.addEventListener('click', function () { toggleCatalog(false); });
    catalog.addEventListener('click', function (e) {
      const btn = e.target.closest ? e.target.closest('.nv-cat-item') : null;
      if (btn) { goChapter(parseInt(btn.getAttribute('data-idx'), 10)); toggleCatalog(false); }
    });
    fontDown.addEventListener('click', function () { setFont(font - FONT_STEP); });
    fontUp.addEventListener('click', function () { setFont(font + FONT_STEP); });
    themeBtn.addEventListener('click', cycleTheme);
    settingBtn.addEventListener('click', function () {
      const collapsed = tools.classList.toggle('tools-collapsed');
      settingBtn.textContent = collapsed ? '更多' : '设置';
      U.haptic(8);
    });
    content.addEventListener('scroll', onScroll, { passive: true });

    // --- swipe to turn chapters (horizontal gesture on the reading area) ---
    // Tap-to-turn (click) stays for desktop; on touch, touchend handles both the
    // swipe and suppresses the synthesised click via lastTouchEnd.
    function flip(dir) {
      content.classList.remove('nv-flip-next', 'nv-flip-prev');
      void content.offsetWidth; // force reflow so the animation restarts
      content.classList.add(dir === 'next' ? 'nv-flip-next' : 'nv-flip-prev');
    }
    let lastTouchEnd = 0;
    let tsX = 0, tsY = 0, tsT = 0, swiping = false;
    content.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { swiping = false; return; }
      tsX = e.touches[0].clientX; tsY = e.touches[0].clientY; tsT = Date.now(); swiping = true;
    }, { passive: true });
    content.addEventListener('touchcancel', function () { swiping = false; }, { passive: true });
    content.addEventListener('touchend', function (e) {
      lastTouchEnd = Date.now();
      if (!swiping || !e.changedTouches || !e.changedTouches.length) return;
      swiping = false;
      const dx = e.changedTouches[0].clientX - tsX;
      const dy = e.changedTouches[0].clientY - tsY;
      const dt = Date.now() - tsT;
      // horizontal-dominant, meaningful distance, not a slow drag → page turn
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 900) {
        const target = Math.min(total - 1, Math.max(0, cur + (dx < 0 ? 1 : -1)));
        if (target !== cur) { flip(dx < 0 ? 'next' : 'prev'); goChapter(target); }
      }
    }, { passive: true });
    content.addEventListener('click', function (e) {
      if (Date.now() - lastTouchEnd < 400) return; // 移动端 touchend 后抑制重复 click
      const r = content.getBoundingClientRect();
      if (!r.height) return;
      const y = (e.clientY - r.top) / r.height;
      if (y < 0.22 || y > 0.78) return; // 仅响应正文中部
      const x = (e.clientX - r.left) / r.width;
      if (x < 0.28) goChapter(cur - 1);
      else if (x > 0.72) goChapter(cur + 1);
      else toggleImmersive();
    });

    document.addEventListener('keydown', onKey);
    cleanups.push(function () { document.removeEventListener('keydown', onKey); });

    return { close: close, id: id };
  }

  global.Novel = {
    MAX_TXT_BYTES: MAX_TXT_BYTES,
    parseChapters: parseChapters,
    importTxt: importTxt,
    listNovels: listNovels,
    openReader: openReader
  };
})(window);
