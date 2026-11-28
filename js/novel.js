/* ============================================================
   novel.js — TXT 小说阅读器（番茄小说式：按屏分页 + 左右滑动翻页 + 沉浸式）
   复用 DB 的 pdfs store 保存 {kind:'txt'} 记录；不依赖 app.js。
   ============================================================ */
(function (global) {
  'use strict';

  const MAX_TXT_BYTES = 20 * 1024 * 1024;

  const FONT_KEY = 'noteee_novel_font';
  const THEME_KEY = 'noteee_novel_theme';
  const IMMERSIVE_KEY = 'noteee_novel_immersive';
  const BOOKMARK_KEY = 'noteee_novel_bookmarks';
  const CHARS_PER_PAGE = 600;
  const FONT_DEFAULT = 20, FONT_MIN = 14, FONT_MAX = 32, FONT_STEP = 2;
  const THEMES = ['paper', 'eye', 'night'];
  const THEME_LABEL = { paper: '纸张', eye: '护眼', night: '夜间' };

  // 章节标题行：整行（允许首尾空白）匹配以下任一前缀即视为标题
  const HEAD_RE = /^(?:第\s*[零一二三四五六七八九十百千壹贰叁肆伍陆柒捌玖拾两0-9]+\s*[章节回卷部篇集折]|Chapter\s+\d+|[0-9]+[、.．](?!\d))/i;

  /* 把全文切成 [{title,start,end}]。end = 下一章 start；最后一章 end = text.length。 */
  function parseChapters(text) {
    text = text == null ? '' : String(text);
    const len = text.length;
    const marks = [];
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
      progress: { chapter: 0, page: 0 }
    };
    await DB.putPdf(rec);
    return rec;
  }

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
  function loadImmersive() {
    let v = '';
    try { v = global.localStorage.getItem(IMMERSIVE_KEY) || ''; } catch (e) { /* noop */ }
    return v === '1';
  }
  function saveImmersive(v) {
    try { global.localStorage.setItem(IMMERSIVE_KEY, v ? '1' : '0'); } catch (e) { /* noop */ }
  }

  /* ---------- 书签（localStorage：noteee_novel_bookmarks） ---------- */
  function readBookmarks() {
    try {
      const raw = global.localStorage.getItem(BOOKMARK_KEY);
      const obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch (e) { return {}; }
  }
  function writeBookmarks(obj) {
    try { global.localStorage.setItem(BOOKMARK_KEY, JSON.stringify(obj)); } catch (e) { /* noop */ }
  }
  /* 返回该书的书签数组副本。 */
  function listBookmarks(id) {
    const all = readBookmarks();
    const arr = all[String(id == null ? '' : id)];
    return Array.isArray(arr) ? arr.slice() : [];
  }
  /* 在同一 chapter+page 上切换书签；返回 { added, bookmarks }。 */
  function toggleBookmark(id, chapter, page, label) {
    const key = String(id == null ? '' : id);
    const all = readBookmarks();
    const arr = Array.isArray(all[key]) ? all[key].slice() : [];
    const c = Math.max(0, Math.floor(Number(chapter) || 0));
    const p = Math.max(0, Math.floor(Number(page) || 0));
    let pos = -1;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] && (arr[i].chapter | 0) === c && (arr[i].page | 0) === p) { pos = i; break; }
    }
    let added;
    if (pos >= 0) { arr.splice(pos, 1); added = false; }
    else {
      arr.push({
        chapter: c, page: p,
        label: label || ('第 ' + (c + 1) + ' 章 · 第 ' + (p + 1) + ' 页'),
        at: Date.now()
      });
      added = true;
    }
    if (arr.length) all[key] = arr; else delete all[key];
    writeBookmarks(all);
    return { added: added, bookmarks: arr };
  }

  /* ---------- 全文搜索：返回 [{chapter, page, snippet}]，最多 50 条 ---------- */
  async function search(id, query) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return [];
    let rec;
    try { rec = await DB.getPdf(id); } catch (e) { rec = null; }
    if (!rec || rec.kind !== 'txt') return [];
    const data = typeof rec.data === 'string' ? rec.data : '';
    const chapters = (Array.isArray(rec.chapters) && rec.chapters.length) ? rec.chapters : parseChapters(data);
    const lower = data.toLowerCase();
    const out = [];
    let from = 0;
    while (out.length < 50) {
      const idx = lower.indexOf(q, from);
      if (idx < 0) break;
      let ci = 0;
      for (let k = 0; k < chapters.length; k++) {
        const st = chapters[k].start | 0;
        const en = chapters[k].end | 0;
        if (idx >= st && idx < (en > st ? en : data.length)) { ci = k; break; }
      }
      const ch = chapters[ci];
      const startOff = Math.max(0, ch ? (ch.start | 0) : 0);
      const page = Math.max(0, Math.floor((idx - startOff) / CHARS_PER_PAGE));
      const s = Math.max(0, idx - 30);
      const e = Math.min(data.length, idx + q.length + 30);
      let snippet = data.slice(s, e).replace(/\s+/g, ' ').trim();
      if (s > 0) snippet = '…' + snippet;
      if (e < data.length) snippet = snippet + '…';
      out.push({ chapter: ci, page: page, snippet: snippet });
      from = idx + Math.max(1, q.length);
    }
    return out;
  }

  /* 打开全屏阅读器。返回控制器 { close }。 */
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

    Array.prototype.forEach.call(host.querySelectorAll('.novel-overlay'), function (el) { el.remove(); });

    let cur = Math.floor(Number(rec.progress && rec.progress.chapter) || 0);
    cur = Math.min(total - 1, Math.max(0, cur));
    let curPage = Math.max(0, Math.floor(Number(rec.progress && rec.progress.page) || 0));

    let font = loadFont();
    let theme = loadTheme();
    let immersive = loadImmersive();
    let closed = false;
    const cleanups = [];
    let pages = [];        // pages[chapterIdx] = [htmlPage0, htmlPage1, ...]
    const paginated = new Set();   // 已分页的章节索引集合（懒分页：只在需要时分页当前章）
    let resizeTimer = null;
    let toastTimer = null;
    let searchInput = null;
    let catTab = 'chapters';

    const root = document.createElement('div');
    root.className = 'overlay novel-overlay';
    root.innerHTML =
      '<div class="overlay-mask"></div>' +
      '<div class="sheet-full novel-reader">' +
        '<div class="novel-top">' +
          '<button class="icon-btn" data-x="cancel" aria-label="返回">' + U.icon('arrow-left') + '</button>' +
          '<h2 id="nvTitle">' + U.esc(rec.name || '未命名小说') + '</h2>' +
          '<button class="icon-btn nv-bookmark-btn" id="nvBookmark" aria-label="书签">☆</button>' +
          '<button class="icon-btn" id="nvCatalogBtn" aria-label="目录">' + U.icon('list') + '</button>' +
        '</div>' +
        '<div class="novel-content" id="nvContent"></div>' +
        '<div class="novel-content nv-measure" id="nvMeasure" aria-hidden="true"></div>' +
        '<div class="novel-bottom">' +
          '<div class="novel-nav">' +
            '<button id="nvPrev">上一页</button>' +
            '<span id="nvProgress"></span>' +
            '<button id="nvNext">下一页</button>' +
          '</div>' +
          '<div class="novel-tools" id="nvTools">' +
            '<button id="nvFontDown">A-</button>' +
            '<button id="nvFontUp">A+</button>' +
            '<button id="nvTheme">主题</button>' +
            '<button id="nvImmersive">沉浸</button>' +
            '<button id="nvSetting">更多</button>' +
          '</div>' +
        '</div>' +
        '<div class="nv-cat-scrim" id="nvCatScrim" hidden></div>' +
        '<div class="novel-catalog" id="nvCatalog" hidden></div>' +
        '<div class="nv-toast" id="nvToast"></div>' +
      '</div>';

    const reader = root.querySelector('.novel-reader');
    const content = root.querySelector('#nvContent');
    const measure = root.querySelector('#nvMeasure');
    const progressEl = root.querySelector('#nvProgress');
    const prevBtn = root.querySelector('#nvPrev');
    const nextBtn = root.querySelector('#nvNext');
    const catalogBtn = root.querySelector('#nvCatalogBtn');
    const bookmarkBtn = root.querySelector('#nvBookmark');
    const catalog = root.querySelector('#nvCatalog');
    const scrim = root.querySelector('#nvCatScrim');
    const tools = root.querySelector('#nvTools');
    const fontDown = root.querySelector('#nvFontDown');
    const fontUp = root.querySelector('#nvFontUp');
    const themeBtn = root.querySelector('#nvTheme');
    const immersiveBtn = root.querySelector('#nvImmersive');
    const settingBtn = root.querySelector('#nvSetting');

    function applyFont() { reader.style.setProperty('--nv-font', font + 'px'); }
    function applyTheme() {
      reader.classList.remove('theme-paper', 'theme-eye', 'theme-night');
      reader.classList.add('theme-' + theme);
    }
    function applyImmersive() {
      reader.classList.toggle('immersive', !!immersive);
      immersiveBtn.textContent = immersive ? '退出沉浸' : '沉浸';
      immersiveBtn.classList.toggle('on', !!immersive);
      if (immersive) toggleCatalog(false);
    }
    function setFont(v) {
      font = Math.min(FONT_MAX, Math.max(FONT_MIN, v));
      font = FONT_MIN + Math.round((font - FONT_MIN) / FONT_STEP) * FONT_STEP;
      applyFont(); saveFont(font);
      // 字号变化会影响分页：清空全部缓存，只重分页当前章，其他章切到时自然重排
      pages.length = 0; paginated.clear();
      ensureChapter(cur); renderPage(null); U.haptic(8);
    }
    function cycleTheme() {
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      applyTheme(); saveTheme(theme);
      U.toast('已切换到' + THEME_LABEL[theme] + '主题', 'info');
      U.haptic(8);
    }

    /* 阅读器内轻量提示（位于 reader 覆盖层内）。 */
    function nvToast(msg) {
      const el = root.querySelector('#nvToast');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1500);
    }
    function formatTime(ts) {
      const d = new Date(Number(ts) || Date.now());
      function p(n) { return n < 10 ? '0' + n : String(n); }
      return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    /* 跳到指定章/页：复用 goChapter，再定页。 */
    function jumpTo(chapter, page) {
      goChapter(chapter);
      const cp = ensureChapter(cur);
      const p = Math.min(Math.max(0, Math.floor(Number(page) || 0)), Math.max(0, cp.length - 1));
      if (p !== curPage) { curPage = p; renderPage(null); persist(); }
      updateBookmarkState();
    }
    /* 搜索结果页号是估算值；点击时用已分页 HTML 精确校正到实际页。 */
    function refinePage(chapter, page, query) {
      const cp = ensureChapter(chapter);
      const q = String(query || '').toLowerCase();
      if (!q || !cp || !cp.length) return page;
      for (let i = 0; i < cp.length; i++) {
        let text = '';
        try {
          const tmp = document.createElement('div');
          tmp.innerHTML = cp[i];
          text = (tmp.textContent || '').toLowerCase();
        } catch (e) { /* noop */ }
        if (text.indexOf(q) >= 0) return i;
      }
      return page;
    }
    function updateBookmarkState() {
      if (!bookmarkBtn) return;
      const list = listBookmarks(id);
      let marked = false;
      for (let i = 0; i < list.length; i++) {
        if (list[i] && (list[i].chapter | 0) === cur && (list[i].page | 0) === curPage) { marked = true; break; }
      }
      bookmarkBtn.classList.toggle('on', marked);
      bookmarkBtn.textContent = marked ? '★' : '☆';
      bookmarkBtn.setAttribute('aria-label', marked ? '取消书签' : '添加书签');
    }

    /* 只分页第 ci 章：把该章正文按内容区高度切成多页（隐藏测量容器逐段量高），懒分页。 */
    function paginateChapter(ci) {
      const ch = chapters[ci];
      if (!ch) { pages[ci] = []; paginated.add(ci); return; }
      const cs = getComputedStyle(content);
      const padT = parseFloat(cs.paddingTop) || 0;
      const padB = parseFloat(cs.paddingBottom) || 0;
      const avail = Math.max(120, content.clientHeight - padT - padB);

      const start = Math.max(0, ch.start | 0);
      const end = Math.min(data.length, ch.end | 0);
      const raw = data.slice(start, end > start ? end : start);
      const paras = raw.split(/\r\n|\r|\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      const titleHtml = '<p class="nv-chapter-title">' + U.esc(ch.title || ('第 ' + (ci + 1) + ' 章')) + '</p>';
      const bodyHtml = paras.map(function (p) { return '<p class="nv-para">' + U.esc(p) + '</p>'; }).join('');
      measure.innerHTML = titleHtml + (bodyHtml || '<p class="nv-para">（本章暂无内容）</p>');
      const nodes = Array.prototype.slice.call(measure.children);
      const out = [];
      let curHtml = [];
      let baseTop = nodes.length ? nodes[0].offsetTop : 0;
      nodes.forEach(function (el) {
        const bottom = el.offsetTop + el.offsetHeight;
        if (curHtml.length && (bottom - baseTop) > avail) {
          out.push(curHtml.join(''));
          curHtml = [];
          baseTop = el.offsetTop;
        }
        curHtml.push(el.outerHTML);
      });
      if (curHtml.length) out.push(curHtml.join(''));
      if (!out.length) out.push(titleHtml);
      pages[ci] = out;
      paginated.add(ci);
    }

    /* 确保第 ci 章已分页并返回其页数组（未分页则先分页），懒分页入口。 */
    function ensureChapter(ci) {
      if (!paginated.has(ci)) paginateChapter(ci);
      return pages[ci] || [];
    }

    function persist() {
      if (!rec.progress || typeof rec.progress !== 'object') rec.progress = {};
      rec.progress.chapter = cur;
      rec.progress.page = curPage;
      try { Promise.resolve(DB.putPdf(rec)).catch(function () {}); } catch (e) { /* noop */ }
    }

    function flip(dir) {
      content.classList.remove('nv-flip-next', 'nv-flip-prev');
      void content.offsetWidth;
      content.classList.add(dir === 'next' ? 'nv-flip-next' : 'nv-flip-prev');
    }
    function renderPage(animDir) {
      const cp = ensureChapter(cur);
      if (curPage < 0) curPage = 0;
      if (curPage >= cp.length) curPage = Math.max(0, cp.length - 1);
      content.innerHTML = cp[curPage] || '<p class="nv-para">（本章暂无内容）</p>';
      if (animDir) flip(animDir);
      progressEl.textContent = '第 ' + (cur + 1) + '/' + total + ' 章 · ' + (curPage + 1) + '/' + (cp.length || 1) + ' 页';
      prevBtn.disabled = (cur === 0 && curPage === 0);
      nextBtn.disabled = (cur === total - 1 && curPage >= cp.length - 1);
      updateCatalogHighlight();
      updateBookmarkState();
      persist();
    }
    /* dir: 1 下一页 / -1 上一页。章内翻页，跨章到该章首页/末页。 */
    function turnPage(dir) {
      const cp = ensureChapter(cur);
      const last = Math.max(0, cp.length - 1);
      let nc = cur, np = curPage;
      if (dir > 0) {
        if (curPage < last) np = curPage + 1;
        else if (cur < total - 1) { nc = cur + 1; np = 0; }
        else { U.toast('已经是最后一页', 'info'); return; }
      } else {
        if (curPage > 0) np = curPage - 1;
        else if (cur > 0) { nc = cur - 1; np = 0; }
        else { U.toast('已经是第一页', 'info'); return; }
      }
      if (nc !== cur) {
        const ncp = ensureChapter(nc);   // 切章前先分页目标章，用它的页数定边界
        if (dir < 0) np = Math.max(0, ncp.length - 1);   // 往上一章则跳到末页
      }
      cur = nc; curPage = np;
      renderPage(dir > 0 ? 'next' : 'prev');
      U.haptic(7);
    }
    function goChapter(idx) {
      const next = Math.min(total - 1, Math.max(0, Math.floor(Number(idx) || 0)));
      cur = next; curPage = 0;
      ensureChapter(next);
      renderPage(null); persist(); U.haptic(8);
    }

    function buildCatalog() {
      catalog.innerHTML =
        '<div class="nv-cat-tabs">' +
          '<button class="nv-cat-tab active" data-tab="chapters">目录</button>' +
          '<button class="nv-cat-tab" data-tab="bookmarks">书签<span class="nv-bm-count" id="nvBmCount"></span></button>' +
          '<button class="nv-cat-tab" data-tab="search">搜索</button>' +
        '</div>' +
        '<div class="nv-cat-panel" id="nvPanelChapters">' +
          '<div class="nv-cat-head">目录 · 共 ' + total + ' 章</div>' +
          chapters.map(function (c, i) {
            return '<button class="nv-cat-item' + (i === cur ? ' active' : '') + '" data-idx="' + i + '">' +
              '<span class="nv-cat-idx">' + (i + 1) + '</span>' +
              '<span class="nv-cat-title">' + U.esc(c.title || ('第 ' + (i + 1) + ' 章')) + '</span>' +
              '</button>';
          }).join('') +
        '</div>' +
        '<div class="nv-cat-panel" id="nvPanelBookmarks" hidden></div>' +
        '<div class="nv-cat-panel" id="nvPanelSearch" hidden>' +
          '<div class="nv-search-row">' +
            '<input class="nv-search-input" id="nvSearchInput" type="search" placeholder="搜索全文关键词" />' +
            '<button class="nv-search-go" id="nvSearchGo">搜索</button>' +
          '</div>' +
          '<div class="nv-search-results" id="nvSearchResults"></div>' +
        '</div>';
      searchInput = catalog.querySelector('#nvSearchInput');
      renderBookmarkList();
    }
    function switchCatTab(tab) {
      catTab = tab;
      const tabs = catalog.querySelectorAll('.nv-cat-tab');
      for (let i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
      }
      catalog.querySelector('#nvPanelChapters').hidden = tab !== 'chapters';
      catalog.querySelector('#nvPanelBookmarks').hidden = tab !== 'bookmarks';
      catalog.querySelector('#nvPanelSearch').hidden = tab !== 'search';
      if (tab === 'bookmarks') renderBookmarkList();
    }
    function renderBookmarkList() {
      const panel = catalog.querySelector('#nvPanelBookmarks');
      if (!panel) return;
      const list = listBookmarks(id);
      const countEl = catalog.querySelector('#nvBmCount');
      if (countEl) countEl.textContent = list.length ? String(list.length) : '';
      if (!list.length) {
        panel.innerHTML = '<div class="nv-empty">暂无书签 · 点顶部 ☆ 添加</div>';
        return;
      }
      panel.innerHTML = '<div class="nv-cat-head">书签 · ' + list.length + ' 条</div>' +
        list.map(function (b, i) {
          const bc = b.chapter | 0, bp = b.page | 0;
          return '<button class="nv-bm-item' + (bc === cur && bp === curPage ? ' active' : '') + '" data-chapter="' + bc + '" data-page="' + bp + '">' +
            '<span class="nv-bm-idx">' + (i + 1) + '</span>' +
            '<span class="nv-bm-label">' + U.esc(b.label || ('第 ' + (bc + 1) + ' 章 · 第 ' + (bp + 1) + ' 页')) + '</span>' +
            '<span class="nv-bm-time">' + formatTime(b.at) + '</span>' +
            '</button>';
        }).join('');
    }
    async function runSearch() {
      const results = catalog.querySelector('#nvSearchResults');
      if (!results || !searchInput) return;
      const q = (searchInput.value || '').trim();
      if (!q) { results.innerHTML = '<div class="nv-empty">请输入关键词</div>'; return; }
      results.innerHTML = '<div class="nv-empty">搜索中…</div>';
      let matches;
      try { matches = await search(id, q); }
      catch (e) {
        results.innerHTML = '<div class="nv-empty">搜索失败：' + U.esc((e && e.message) || '未知错误') + '</div>';
        return;
      }
      if (closed || !results || catTab !== 'search') return;
      if (!matches.length) { results.innerHTML = '<div class="nv-empty">未找到“' + U.esc(q) + '”</div>'; return; }
      results.innerHTML = '<div class="nv-cat-head">找到 ' + matches.length + ' 条结果</div>' +
        matches.map(function (m, i) {
          const mc = m.chapter | 0, mp = m.page | 0;
          const title = (chapters[mc] && chapters[mc].title) || ('第 ' + (mc + 1) + ' 章');
          return '<button class="nv-search-result" data-chapter="' + mc + '" data-page="' + mp + '">' +
            '<span class="nv-sr-idx">' + (i + 1) + '</span>' +
            '<span class="nv-sr-body">' +
              '<span class="nv-sr-meta">' + U.esc(title) + ' · 约第 ' + (mp + 1) + ' 页</span>' +
              '<span class="nv-sr-snippet">' + U.esc(m.snippet) + '</span>' +
            '</span>' +
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
      immersive = typeof force === 'boolean' ? force : !immersive;
      applyImmersive(); saveImmersive(immersive);
      U.haptic(8);
    }

    function close() {
      if (closed) return;
      persist(); closed = true;
      cleanups.forEach(function (fn) { try { fn(); } catch (e) { /* noop */ } });
      root.style.transition = 'opacity .2s';
      root.style.opacity = '0';
      setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, 200);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); turnPage(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); turnPage(1); }
    }

    applyFont(); applyTheme(); applyImmersive();
    buildCatalog();
    // 必须先挂载到 DOM 再分页：脱离 DOM 时 clientHeight/offsetTop/offsetHeight 全为 0，
    // 会把每章压成单页。这里只分页当前章（懒分页），打开超大文件不再做全量布局。
    host.appendChild(root);
    ensureChapter(cur);
    const cpInit = pages[cur] || [];
    if (curPage >= cpInit.length) curPage = Math.max(0, cpInit.length - 1);
    renderPage(null);
    if (U.enterSheet) U.enterSheet(reader);

    root.querySelector('[data-x="cancel"]').addEventListener('click', close);
    root.querySelector('.overlay-mask').addEventListener('click', close);
    prevBtn.addEventListener('click', function () { turnPage(-1); });
    nextBtn.addEventListener('click', function () { turnPage(1); });
    catalogBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleCatalog(); U.haptic(8); });
    scrim.addEventListener('click', function () { toggleCatalog(false); });
    catalog.addEventListener('click', function (e) {
      const tab = e.target.closest ? e.target.closest('.nv-cat-tab') : null;
      if (tab) { switchCatTab(tab.getAttribute('data-tab')); U.haptic(8); return; }
      const go = e.target.closest ? e.target.closest('#nvSearchGo') : null;
      if (go) { runSearch(); U.haptic(8); return; }
      const bm = e.target.closest ? e.target.closest('.nv-bm-item') : null;
      if (bm) {
        jumpTo(parseInt(bm.getAttribute('data-chapter'), 10), parseInt(bm.getAttribute('data-page'), 10));
        toggleCatalog(false); U.haptic(8); return;
      }
      const sr = e.target.closest ? e.target.closest('.nv-search-result') : null;
      if (sr) {
        const ci = parseInt(sr.getAttribute('data-chapter'), 10);
        const pg = parseInt(sr.getAttribute('data-page'), 10);
        jumpTo(ci, refinePage(ci, pg, searchInput ? searchInput.value : ''));
        toggleCatalog(false); U.haptic(8); return;
      }
      const btn = e.target.closest ? e.target.closest('.nv-cat-item') : null;
      if (btn) { goChapter(parseInt(btn.getAttribute('data-idx'), 10)); toggleCatalog(false); }
    });
    if (searchInput) searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
    });
    bookmarkBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const label = (chapters[cur] && chapters[cur].title ? chapters[cur].title : ('第 ' + (cur + 1) + ' 章')) +
        ' · 第 ' + (curPage + 1) + ' 页';
      const res = toggleBookmark(id, cur, curPage, label);
      updateBookmarkState();
      renderBookmarkList();
      nvToast(res.added ? '已加入书签' : '已移除书签');
      U.haptic(8);
    });
    fontDown.addEventListener('click', function () { setFont(font - FONT_STEP); });
    fontUp.addEventListener('click', function () { setFont(font + FONT_STEP); });
    themeBtn.addEventListener('click', cycleTheme);
    immersiveBtn.addEventListener('click', function () { toggleImmersive(); });
    settingBtn.addEventListener('click', function () {
      const collapsed = tools.classList.toggle('tools-collapsed');
      settingBtn.textContent = collapsed ? '更多' : '设置';
      U.haptic(8);
    });

    /* 左右滑动翻页（水平手势）+ 点击左右侧翻页 / 点击中部切换沉浸。 */
    let tsX = 0, tsY = 0, tsT = 0, swiping = false, didSwipe = false;
    content.addEventListener('touchstart', function (e) {
      didSwipe = false;   // 每次触摸开始重置滑动标记，单击也能可靠触发 click 处理
      if (e.touches.length !== 1) { swiping = false; return; }
      tsX = e.touches[0].clientX; tsY = e.touches[0].clientY; tsT = Date.now(); swiping = true;
    }, { passive: true });
    content.addEventListener('touchcancel', function () { swiping = false; }, { passive: true });
    content.addEventListener('touchend', function (e) {
      if (!swiping || !e.changedTouches || !e.changedTouches.length) return;
      swiping = false;
      const dx = e.changedTouches[0].clientX - tsX;
      const dy = e.changedTouches[0].clientY - tsY;
      const dt = Date.now() - tsT;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3 && dt < 1000) {
        didSwipe = true;   // 真的发生了水平滑动，稍后抑制随之而来的幽灵 click
        turnPage(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
    content.addEventListener('click', function (e) {
      if (didSwipe) { didSwipe = false; return; }   // 只吞掉滑动后浏览器补发的幽灵 click
      const r = content.getBoundingClientRect();
      if (!r.height) return;
      const y = (e.clientY - r.top) / r.height;
      if (y < 0.18 || y > 0.82) return;
      const x = (e.clientX - r.left) / r.width;
      if (x < 0.30) turnPage(-1);
      else if (x > 0.70) turnPage(1);
      else toggleImmersive();
    });

    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        // 尺寸变化会影响分页：清空全部缓存，只重分页当前章
        pages.length = 0; paginated.clear();
        ensureChapter(cur); renderPage(null);
      }, 200);
    }
    global.addEventListener('resize', onResize);
    cleanups.push(function () {
      global.removeEventListener('resize', onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (toastTimer) clearTimeout(toastTimer);
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
    openReader: openReader,
    toggleBookmark: toggleBookmark,
    listBookmarks: listBookmarks,
    search: search
  };
})(window);
