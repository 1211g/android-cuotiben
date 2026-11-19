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
    let resizeTimer = null;

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
      '</div>';

    const reader = root.querySelector('.novel-reader');
    const content = root.querySelector('#nvContent');
    const measure = root.querySelector('#nvMeasure');
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
      paginate(); renderPage(null); U.haptic(8);
    }
    function cycleTheme() {
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      applyTheme(); saveTheme(theme);
      U.toast('已切换到' + THEME_LABEL[theme] + '主题', 'info');
      U.haptic(8);
    }

    /* 把整章正文按内容区高度切成多页（隐藏测量容器逐段量高）。 */
    function paginate() {
      pages = [];
      const cs = getComputedStyle(content);
      const padT = parseFloat(cs.paddingTop) || 0;
      const padB = parseFloat(cs.paddingBottom) || 0;
      const avail = Math.max(120, content.clientHeight - padT - padB);

      chapters.forEach(function (ch, ci) {
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
      });
      const cp = pages[cur] || [];
      if (curPage >= cp.length) curPage = Math.max(0, cp.length - 1);
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
      const cp = pages[cur] || [];
      if (curPage < 0) curPage = 0;
      if (curPage >= cp.length) curPage = Math.max(0, cp.length - 1);
      content.innerHTML = cp[curPage] || '<p class="nv-para">（本章暂无内容）</p>';
      if (animDir) flip(animDir);
      progressEl.textContent = '第 ' + (cur + 1) + '/' + total + ' 章 · ' + (curPage + 1) + '/' + (cp.length || 1) + ' 页';
      prevBtn.disabled = (cur === 0 && curPage === 0);
      nextBtn.disabled = (cur === total - 1 && curPage >= cp.length - 1);
      updateCatalogHighlight();
      persist();
    }
    /* dir: 1 下一页 / -1 上一页。章内翻页，跨章到该章首页/末页。 */
    function turnPage(dir) {
      const cp = pages[cur] || [];
      const last = Math.max(0, cp.length - 1);
      let nc = cur, np = curPage;
      if (dir > 0) {
        if (curPage < last) np = curPage + 1;
        else if (cur < total - 1) { nc = cur + 1; np = 0; }
        else { U.toast('已经是最后一页', 'info'); return; }
      } else {
        if (curPage > 0) np = curPage - 1;
        else if (cur > 0) { nc = cur - 1; np = Math.max(0, (pages[cur - 1] || []).length - 1); }
        else { U.toast('已经是第一页', 'info'); return; }
      }
      cur = nc; curPage = np;
      renderPage(dir > 0 ? 'next' : 'prev');
      U.haptic(7);
    }
    function goChapter(idx) {
      const next = Math.min(total - 1, Math.max(0, Math.floor(Number(idx) || 0)));
      cur = next; curPage = 0;
      renderPage(null); persist(); U.haptic(8);
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
    // Must attach to the DOM BEFORE paginate(): clientHeight/offsetTop/offsetHeight
    // are all 0 while detached, which would collapse every chapter into a single page.
    host.appendChild(root);
    paginate();
    renderPage(null);
    if (U.enterSheet) U.enterSheet(reader);

    root.querySelector('[data-x="cancel"]').addEventListener('click', close);
    root.querySelector('.overlay-mask').addEventListener('click', close);
    prevBtn.addEventListener('click', function () { turnPage(-1); });
    nextBtn.addEventListener('click', function () { turnPage(1); });
    catalogBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleCatalog(); U.haptic(8); });
    scrim.addEventListener('click', function () { toggleCatalog(false); });
    catalog.addEventListener('click', function (e) {
      const btn = e.target.closest ? e.target.closest('.nv-cat-item') : null;
      if (btn) { goChapter(parseInt(btn.getAttribute('data-idx'), 10)); toggleCatalog(false); }
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
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3 && dt < 1000) {
        turnPage(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
    content.addEventListener('click', function (e) {
      if (Date.now() - lastTouchEnd < 400) return;
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
      resizeTimer = setTimeout(function () { paginate(); renderPage(null); }, 200);
    }
    global.addEventListener('resize', onResize);
    cleanups.push(function () {
      global.removeEventListener('resize', onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
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
