/* ============================================================
   app.js — 错题本 application logic
   Sections: boot / overlays / theme / home / detail / editor /
             image tools / stats / manage / settings / backup
   ============================================================ */
(function () {
  'use strict';

  const { $, $$, esc, uid, fmtDate, fmtDateTime, fmtTime, relDate,
    startOfWeek, weekShort, formatBytes, icon, debounce, toast, haptic } = U;

  /* ---------------------------------------------------------
     STATE
     --------------------------------------------------------- */
  const state = {
    view: 'home',
    questions: [],
    thumbs: new Map(),
    imageCount: 0,
    config: null,
    search: '',
    sort: 'created_desc',
    filters: { subject: [], qtype: [], mastery: [], cause: [], tags: [] },
    keepForNext: null,
    dirHandle: null,
    detailId: null,
    coverCache: new Map(),
    docTab: 'docs',          // 'docs' | 'novels' inside the 资料 view
    manageTagSubject: '',    // '' = all subjects; tag list filtered by this subject in 管理
    manageFieldSubject: '',  // '' = first subject; which subject's field visibility is being edited
    manageCollapsed: { subjects: true, qtypes: true, causes: true, tags: true, fields: true }
  };

  // Which content fields are hidden for a given subject (data is always kept).
  const HIDDEN_FIELD_META = [
    { key: 'stem', label: '题干' },
    { key: 'correct', label: '正确答案 / 我的答案' },
    { key: 'cause', label: '错因' }
  ];
  function hiddenFieldsFor(subject) {
    const hf = state.config && state.config.hiddenFields;
    return (hf && hf[subject]) || [];
  }
  function fieldHidden(subject, key) {
    return hiddenFieldsFor(subject).indexOf(key) >= 0;
  }

  const MASTERY = {
    unmastered: { label: '未掌握', cls: 'unmastered' },
    fuzzy: { label: '模糊', cls: 'fuzzy' },
    mastered: { label: '已掌握', cls: 'master' }
  };
  const SORTS = {
    created_desc: '最新录入', created_asc: '最早录入',
    updated_desc: '最近修改'
  };
  const CAUSE_COLORS = ['#8d7dff', '#5aa9ff', '#4fdfa6', '#ffcf70', '#ff8aa6', '#d17bff', '#62d6e0', '#f3a15c'];

  /* ---------------------------------------------------------
     BOOT
     --------------------------------------------------------- */
  async function boot() {
    await DB.init();
    state.config = await DB.getConfig();
    // Restore persisted manage-group collapse state (v1.0.6).
    if (state.config && state.config.manageCollapsed && typeof state.config.manageCollapsed === 'object') {
      state.manageCollapsed = Object.assign({}, state.manageCollapsed, state.config.manageCollapsed);
    }
    applyTheme(state.config.theme || 'dark');
    await refresh();
    bind();
    setView('home');
    updateGreeting();
    if (DB.isMemory()) toast('本地数据库不可用，数据仅本次会话有效', 'err');
    // The native WebView shell serves assets locally and never needs a SW;
    // registering one there can bypass shouldInterceptRequest. PWA/browser still uses it.
    if ('serviceWorker' in navigator && !window.CuotiBridge && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    }
  }

  function updateGreeting() {
    const h = new Date().getHours();
    const g = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    const el = $('#greeting');
    if (el) el.textContent = g + ' · 我的学习空间';
  }

  async function refresh() {
    const [qs, imgs] = await Promise.all([DB.getAllQuestions(), DB.getAllImages()]);
    state.questions = qs || [];
    state.thumbs = new Map((imgs || []).map(i => [i.id, i.thumb || i.full]));
    state.imageCount = (imgs || []).length;
  }

  function applyTheme(t) {
    document.body.className = 'theme-' + (t === 'light' ? 'light' : 'dark');
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#e8edfb' : '#0b1020');
    const btn = $('#btnTheme');
    if (btn) btn.innerHTML = icon(t === 'light' ? 'sun' : 'moon');
    // Native WebView shell: keep status-bar icons readable in both themes.
    if (window.CuotiBridge && window.CuotiBridge.setLightStatusBar) {
      try { window.CuotiBridge.setLightStatusBar(t === 'light'); } catch (e) { }
    }
  }

  async function setTheme(t) {
    state.config.theme = t;
    await DB.putConfig(state.config);
    applyTheme(t);
    renderSettings();
  }

  /* ---------------------------------------------------------
     OVERLAY PRIMITIVES
     --------------------------------------------------------- */
  function overlay(inner, cls, persistent) {
    const ov = document.createElement('div');
    ov.className = 'overlay ' + (cls || 'center');
    ov.innerHTML = '<div class="overlay-mask"></div>' + inner;
    $('#overlayRoot').appendChild(ov);
    // Suppress the full-screen backdrop blur during the entrance slide so the
    // PDF / detail / editor sheets open without frame drops; blur returns after.
    const sheet = $('.sheet-full', ov) || $('.sheet-card', ov);
    if (sheet && U.enterSheet) U.enterSheet(sheet);
    if (!persistent) $('.overlay-mask', ov).onclick = () => closeOverlay(ov);
    return ov;
  }
  function closeOverlay(ov) {
    if (!ov) return;
    ov.style.transition = 'opacity .2s';
    ov.style.opacity = '0';
    setTimeout(() => ov.remove(), 200);
  }
  /* A detail sheet is a singleton: remove any stale one synchronously so a
     re-open (after a note / mastery change) never stacks two sheets. */
  function dismissDetail() {
    $$('#overlayRoot .overlay').forEach(o => { if (o.querySelector('#dtBack')) o.remove(); });
  }

  /* Android hardware back: close the topmost overlay before leaving the app. */
  window.CuotiBack = function () {
    const list = $$('#overlayRoot .overlay');
    if (!list.length) return false;
    const ov = list[list.length - 1];
    const cancel = ov.querySelector('[data-x="cancel"], #edCancel, #dtBack, .overlay-mask');
    if (cancel) cancel.click(); else closeOverlay(ov);
    return true;
  };

  function confirmDialog(o) {
    return new Promise(resolve => {
      const ov = overlay(
        '<div class="sheet-card">' +
        '<h3 class="modal-title">' + esc(o.title || '确认操作') + '</h3>' +
        (o.desc ? '<p class="modal-desc">' + esc(o.desc) + '</p>' : '<div style="height:8px"></div>') +
        '<div class="modal-actions">' +
        '<button class="btn btn-ghost" data-x="cancel">' + esc(o.cancelText || '取消') + '</button>' +
        '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-x="ok">' + esc(o.confirmText || '确定') + '</button>' +
        '</div></div>', 'center', true);
      const done = v => { closeOverlay(ov); resolve(v); };
      $('[data-x="cancel"]', ov).onclick = () => done(false);
      $('[data-x="ok"]', ov).onclick = () => done(true);
      $('.overlay-mask', ov).onclick = () => done(false);
    });
  }

  function promptDialog(o) {
    return new Promise(resolve => {
      const ov = overlay(
        '<div class="sheet-card">' +
        '<h3 class="modal-title">' + esc(o.title || '输入') + '</h3>' +
        (o.desc ? '<p class="modal-desc">' + esc(o.desc) + '</p>' : '') +
        '<input class="input" id="dlgInput" placeholder="' + esc(o.placeholder || '') + '" value="' + esc(o.value || '') + '">' +
        '<div class="modal-actions mt14">' +
        '<button class="btn btn-ghost" data-x="cancel">取消</button>' +
        '<button class="btn btn-primary" data-x="ok">确定</button>' +
        '</div></div>', 'center', true);
      const inp = $('#dlgInput', ov);
      setTimeout(() => { inp.focus(); inp.select(); }, 120);
      const done = v => { closeOverlay(ov); resolve(v); };
      $('[data-x="cancel"]', ov).onclick = () => done(null);
      $('[data-x="ok"]', ov).onclick = () => {
        const v = inp.value.trim();
        if (!v) { inp.focus(); return; }
        done(v);
      };
      inp.onkeydown = e => { if (e.key === 'Enter') $('[data-x="ok"]', ov).click(); };
      $('.overlay-mask', ov).onclick = () => done(null);
    });
  }

  /* options: [{icon, title, desc, value, danger}] */
  function optionDialog(o) {
    return new Promise(resolve => {
      const list = (o.options || []).map((x, i) =>
        '<button class="opt-item" data-i="' + i + '">' + icon(x.icon || 'circle') +
        '<span style="flex:1"><span class="t" style="display:block' + (x.danger ? ';color:var(--bad)' : '') + '">' + esc(x.title) + '</span>' +
        (x.desc ? '<span class="d" style="display:block">' + esc(x.desc) + '</span>' : '') + '</span>' +
        icon('chev-right') + '</button>').join('');
      const ov = overlay(
        '<div class="sheet-card">' +
        '<h3 class="modal-title">' + esc(o.title || '选择') + '</h3>' +
        (o.desc ? '<p class="modal-desc">' + esc(o.desc) + '</p>' : '<div style="height:12px"></div>') +
        '<div class="opt-list">' + list + '</div>' +
        (o.cancelText ? '<button class="btn btn-ghost btn-block mt14" data-x="cancel">' + esc(o.cancelText) + '</button>' : '') +
        '</div>', 'center', false);
      const done = v => { closeOverlay(ov); resolve(v); };
      $$('.opt-item', ov).forEach(b => b.onclick = () => done(o.options[+b.dataset.i].value));
      const c = $('[data-x="cancel"]', ov); if (c) c.onclick = () => done(null);
      $('.overlay-mask', ov).onclick = () => done(null);
      ov.addEventListener('click', e => { if (e.target === $('.overlay-mask', ov)) done(null); });
    });
  }

  /* ---------------------------------------------------------
     NAVIGATION
     --------------------------------------------------------- */
  function setView(v) {
    state.view = v;
    const activeView = document.getElementById('view-' + v);
    $$('.view').forEach(el => el.classList.toggle('active', el.id === 'view-' + v));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
    // v1.0.6: drop descendant blur only for the duration of the enter
    // animation so the GPU composites a pure transform+opacity layer.
    if (activeView && typeof U.enterSheet === 'function') U.enterSheet(activeView);
    if (v === 'home') renderHome();
    else if (v === 'stats') renderStats();
    else if (v === 'pdf') renderPdfView();
    else if (v === 'manage') renderManage();
    else if (v === 'settings') renderSettings();
  }

  /* ---------------------------------------------------------
     HOME / LIST
     --------------------------------------------------------- */
  function computeList() {
    let arr = state.questions.slice();
    const f = state.filters;
    const kw = state.search.trim().toLowerCase();
    if (kw) {
      arr = arr.filter(q => [q.stem, q.analysis, q.myAnswer, q.correctAnswer, q.cause,
        q.causeExtra, q.subject, q.qtype, (q.tags || []).join(' '),
        q.options ? Object.values(q.options).join(' ') : ''].join(' ').toLowerCase().includes(kw));
    }
    if (f.subject.length) arr = arr.filter(q => f.subject.includes(q.subject));
    if (f.qtype.length) arr = arr.filter(q => f.qtype.includes(q.qtype));
    if (f.mastery.length) arr = arr.filter(q => f.mastery.includes(q.mastery));
    if (f.cause.length) arr = arr.filter(q => f.cause.includes(q.cause));
    if (f.tags.length) arr = arr.filter(q => (q.tags || []).some(t => f.tags.includes(t)));
    if (state.config.hideMastered && !f.mastery.length) arr = arr.filter(q => q.mastery !== 'mastered');

    const s = state.sort;
    arr.sort((a, b) => {
      if (s === 'created_asc') return a.createdAt - b.createdAt;
      if (s === 'updated_desc') return (b.updatedAt || 0) - (a.updatedAt || 0);
      if (s === 'difficulty_desc') return (b.difficulty || 0) - (a.difficulty || 0) || b.createdAt - a.createdAt;
      return b.createdAt - a.createdAt;
    });
    return arr;
  }

  function starsHTML(n) {
    let s = '<span class="stars">';
    for (let i = 1; i <= 5; i++) s += icon('star', i <= (n || 0) ? 'on' : '');
    return s + '</span>';
  }

  /* ---- 题目封面 ----
     q.cover = { mode:'subject' }              默认封面：同 APP 风格的渐变卡 + 科目文字
             = { mode:'image', data:dataURL }  导入图片作封面（存缩略图 dataURL，随备份走）
     未设置 cover 时沿用「首张题目图 / 文字题干」的旧行为。 */
  const COVER_GRADS = [
    ['#8d7dff', '#5aa9ff'], ['#5aa9ff', '#4fdfa6'], ['#d17bff', '#ff8aa6'],
    ['#ffcf70', '#ff8a5c'], ['#62d6e0', '#5aa9ff'], ['#f3a15c', '#d17bff']
  ];
  function subjectCoverDataURL(subject, size) {
    size = size || 160;
    const key = 'cover:' + (subject || '') + ':' + size;
    if (state.coverCache.has(key)) return state.coverCache.get(key);
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const x = c.getContext('2d');
    let h = 0; for (let i = 0; i < (subject || '').length; i++) h = (h * 31 + subject.charCodeAt(i)) >>> 0;
    const g = COVER_GRADS[h % COVER_GRADS.length];
    const grad = x.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, g[0]); grad.addColorStop(1, g[1]);
    x.fillStyle = grad; x.fillRect(0, 0, size, size);
    // 玻璃高光斜带
    x.globalAlpha = .14; x.fillStyle = '#fff';
    x.beginPath(); x.moveTo(0, size * .62); x.lineTo(size, size * .18); x.lineTo(size, size * .42); x.lineTo(0, size * .86); x.closePath(); x.fill();
    x.globalAlpha = 1;
    // 小圆点装饰（呼应液态玻璃光斑）
    x.globalAlpha = .22; x.fillStyle = '#fff';
    x.beginPath(); x.arc(size * .16, size * .18, size * .09, 0, 7); x.fill();
    x.beginPath(); x.arc(size * .86, size * .84, size * .13, 0, 7); x.fill();
    x.globalAlpha = 1;
    // 科目文字（居中，长科目自动缩小）
    const txt = subject || '错题';
    let fs = Math.round(size * (txt.length >= 5 ? .24 : txt.length === 4 ? .3 : .38));
    x.fillStyle = '#fff'; x.font = '700 ' + fs + 'px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,.18)'; x.shadowBlur = size * .04;
    x.fillText(txt, size / 2, size / 2);
    const url = c.toDataURL('image/png');
    state.coverCache.set(key, url);
    return url;
  }
  function coverThumb(q) {
    const cv = q && q.cover;
    if (!cv) return null;
    if (cv.mode === 'image') return cv.data || null;
    if (cv.mode === 'subject') return subjectCoverDataURL(q.subject, 160);
    return null;
  }

  function cardHTML(q, i) {
    const cover = coverThumb(q);
    const thumbId = (q.imageIds || [])[0];
    const thumb = cover || (thumbId ? state.thumbs.get(thumbId) : null);
    const hasImg = !!thumb;
    const title = (q.stem || '').trim() || (hasImg ? '图片题目 · 未填写文字题干' : '未命名错题');
    const m = MASTERY[q.mastery] || MASTERY.unmastered;
    const thumbHTML = hasImg
      ? '<img class="qcard-thumb" src="' + thumb + '" alt="题目缩略图" loading="lazy">'
      : '<div class="qcard-thumb text">' + esc((q.stem || '文字题 · 未填写题干').slice(0, 34)) + '</div>';
    // 第一行：知识点（取前两个标签；无标签则回退到科目）
    const kp = (q.tags || []).slice(0, 2);
    const kpHTML = kp.length
      ? kp.map(t => '<span class="kp-pill">' + esc(t) + '</span>').join('')
      : '<span class="kp-pill muted">' + esc(q.subject || '未分类') + '</span>';
    const badges =
      '<span class="mini-badge subject">' + esc(q.subject || '未分类') + '</span>' +
      (q.qtype ? '<span class="mini-badge">' + esc(q.qtype) + '</span>' : '') +
      (q.cause ? '<span class="mini-badge">' + esc(q.cause) + '</span>' : '') +
      '<span class="mini-badge ' + m.cls + '">' + m.label + '</span>';

    return '<article class="qcard ' + (q.mastery === 'mastered' ? 'is-mastered' : '') + '" style="animation-delay:' + Math.min(i * 35, 350) + 'ms" data-act="card" data-id="' + q.id + '">' +
      thumbHTML +
      '<div class="qcard-main">' +
      '<div class="qcard-kp">' + icon('tag') + kpHTML + '</div>' +
      '<div class="qcard-title" data-math-text="' + esc(title) + '">' + esc(title) + '</div>' +
      '<div class="qcard-badges">' + badges + '</div>' +
      '<div class="qcard-foot">' +
      '<span class="qcard-date">' + relDate(q.createdAt) + '</span>' +
      '<div class="qcard-actions">' +
      '<button class="mini-act" data-act="m-tag" data-id="' + q.id + '" title="加标签">' + icon('tag') + '</button>' +
      '<button class="mini-act" data-act="m-more" data-id="' + q.id + '" title="更多">' + icon('more') + '</button>' +
      '</div></div></div></article>';
  }

  function renderActiveChips() {
    const f = state.filters;
    const labels = { subject: '科目', qtype: '题型', mastery: '掌握', cause: '错因', tags: '标签' };
    let html = '';
    let count = 0;
    Object.keys(f).forEach(k => f[k].forEach(v => {
      count++;
      const label = k === 'mastery' ? (MASTERY[v] ? MASTERY[v].label : v) : v;
      html += '<button class="chip accent" data-act="filter-remove" data-k="' + k + '" data-v="' + esc(v) + '">' +
        esc(labels[k] + ' · ' + label) + icon('x') + '</button>';
    }));
    if (count) html += '<button class="chip clear" data-act="clear-filters">清空全部</button>';
    $('#activeFilterChips').innerHTML = html;
    const badge = $('#filterBadge');
    badge.hidden = count === 0;
    badge.textContent = count;
  }

  function renderHome() {
    const list = computeList();
    const total = state.questions.length;
    $('#listCount').textContent = (list.length === total ? '全部 ' : '筛选 ') + list.length + ' 道错题' + (total ? ' / 共 ' + total : '');
    $('#sortLabel').textContent = SORTS[state.sort];
    $('#searchClear').classList.toggle('show', !!state.search);
    renderActiveChips();

    if (!list.length) {
      if (!total) {
        $('#listBody').innerHTML =
          '<div class="empty">' +
          '<div class="empty-orb">' + icon('book') + '</div>' +
          '<h3>还没有错题</h3>' +
          '<p>拍下第一道错题，或先载入示例数据看看效果。所有数据只保存在这台设备上。</p>' +
          '<div style="display:flex;gap:9px;margin-top:8px">' +
          '<button class="btn btn-ghost btn-sm" data-act="seed-demo">' + icon('sparkles') + '载入示例</button>' +
          '<button class="btn btn-primary btn-sm" data-act="first-add">' + icon('plus') + '录入错题</button>' +
          '</div></div>';
      } else {
        $('#listBody').innerHTML =
          '<div class="empty"><div class="empty-orb">' + icon('search') + '</div>' +
          '<h3>没有匹配的错题</h3><p>试试清空筛选条件，或换个关键词搜索。</p>' +
          '<button class="btn btn-ghost btn-sm mt8" data-act="clear-filters">清空筛选</button></div>';
      }
      return;
    }
    $('#listBody').innerHTML = list.map(cardHTML).join('');
    renderDetailMath($('#listBody'));
  }

  function openFilterSheet() {
    const f = JSON.parse(JSON.stringify(state.filters));
    const cfg = state.config;
    const groups = [
      { k: 'subject', n: '科目', items: cfg.subjects },
      { k: 'qtype', n: '题型', items: cfg.qtypes },
      { k: 'mastery', n: '掌握状态', items: Object.keys(MASTERY), label: v => MASTERY[v].label },
      { k: 'cause', n: '错因', items: cfg.causes },
      { k: 'tags', n: '标签', items: cfg.tags }
    ];
    const body = groups.map(g =>
      '<div class="field"><div class="field-label">' + g.n + '</div><div class="choice-row" data-g="' + g.k + '">' +
      (g.items.length ? g.items.map(v =>
        '<button class="choice small' + (f[g.k].includes(v) ? ' on' : '') + '" data-v="' + esc(v) + '">' +
        esc(g.label ? g.label(v) : v) + '</button>').join('') : '<span class="tiny">暂无可选项</span>') +
      '</div></div>').join('');

    const ov = overlay(
      '<div class="sheet-full">' +
      '<div class="sheet-head"><button class="icon-btn" id="fltBack">' + icon('chev-left') + '</button>' +
      '<h2>筛选错题</h2><button class="text-btn" id="fltReset">重置</button></div>' +
      '<div class="sheet-body">' + body + '</div>' +
      '<div class="sheet-foot"><button class="btn btn-ghost" id="fltCancel">取消</button>' +
      '<button class="btn btn-primary" id="fltApply">查看结果</button></div>' +
      '</div>', 'bottom', true);

    $$('.choice-row', ov).forEach(row => {
      $$('.choice', row).forEach(b => b.onclick = () => {
        const k = row.dataset.g, v = b.dataset.v;
        const i = f[k].indexOf(v);
        if (i >= 0) f[k].splice(i, 1); else f[k].push(v);
        b.classList.toggle('on', i < 0);
        haptic();
      });
    });
    const close = () => closeOverlay(ov);
    $('#fltBack', ov).onclick = close;
    $('#fltCancel', ov).onclick = close;
    $('#fltReset', ov).onclick = () => { Object.keys(f).forEach(k => f[k] = []); $$('.choice', ov).forEach(b => b.classList.remove('on')); };
    $('#fltApply', ov).onclick = () => { state.filters = f; close(); renderHome(); };
    $('.overlay-mask', ov).onclick = close;
  }

  async function openSortSheet() {
    const v = await optionDialog({
      title: '排序方式', desc: '选择错题列表的排列顺序', cancelText: '取消',
      options: Object.keys(SORTS).map(k => ({ icon: 'sort', title: SORTS[k], value: k }))
    });
    if (v) { state.sort = v; renderHome(); }
  }

  /* ---------------------------------------------------------
     QUICK ACTIONS ON CARDS
     --------------------------------------------------------- */
  async function openMasteryPicker(id) {
    const v = await optionDialog({
      title: '掌握状态', desc: '标记为已掌握后，该题会加标记并可在设置中隐藏', cancelText: '取消',
      options: [
        { icon: 'circle', title: '未掌握', desc: '还需要重点复习', value: 'unmastered' },
        { icon: 'eye', title: '模糊', desc: '似懂非懂，容易再错', value: 'fuzzy' },
        { icon: 'check-circle', title: '已掌握', desc: '已经弄明白，不再干扰日常查看', value: 'mastered' }
      ]
    });
    if (!v) return;
    const q = state.questions.find(x => x.id === id);
    if (!q) return;
    q.mastery = v; q.updatedAt = Date.now();
    await DB.putQuestion(q);
    haptic(); renderHome(); toast('已标记为「' + MASTERY[v].label + '」');
    if (state.view === 'stats') renderStats();
  }

  async function openTagPicker(id) {
    const q = state.questions.find(x => x.id === id);
    if (!q) return;
    const cfg = state.config;
    const chosen = new Set(q.tags || []);
    const ov = overlay(
      '<div class="sheet-card">' +
      '<h3 class="modal-title">添加标签</h3>' +
      '<p class="modal-desc">点选标签，可多选；也可以直接新建一个。</p>' +
      '<div class="tag-cloud" id="tagCloud">' +
      (cfg.tags.length ? cfg.tags.map(t => '<button class="tag-pick' + (chosen.has(t) ? ' on' : '') + '" data-t="' + esc(t) + '"># ' + esc(t) + '</button>').join('') : '<span class="tiny">还没有标签</span>') +
      '</div>' +
      '<button class="btn btn-ghost btn-block mt14" id="newTag">' + icon('plus') + ' 新建标签</button>' +
      '<div class="modal-actions mt14"><button class="btn btn-ghost" id="tagCancel">取消</button>' +
      '<button class="btn btn-primary" id="tagOk">保存</button></div></div>', 'center', true);
    const sync = () => $$('.tag-pick', ov).forEach(b => b.classList.toggle('on', chosen.has(b.dataset.t)));
    const bindTags = () => $$('.tag-pick', ov).forEach(b => b.onclick = () => {
      const t = b.dataset.t;
      if (chosen.has(t)) chosen.delete(t); else chosen.add(t);
      sync(); haptic();
    });
    bindTags();
    $('#newTag', ov).onclick = async () => {
      const t = await promptDialog({ title: '新建标签', placeholder: '例如：高考真题' });
      if (!t) return;
      if (!cfg.tags.includes(t)) { cfg.tags.push(t); await DB.putConfig(cfg); }
      chosen.add(t);
      const cloud = $('#tagCloud', ov);
      cloud.insertAdjacentHTML('beforeend', '<button class="tag-pick on" data-t="' + esc(t) + '"># ' + esc(t) + '</button>');
      bindTags(); sync();
    };
    $('#tagCancel', ov).onclick = () => closeOverlay(ov);
    $('#tagOk', ov).onclick = async () => {
      q.tags = Array.from(chosen); q.updatedAt = Date.now();
      await DB.putQuestion(q); await refresh(); closeOverlay(ov); renderHome(); toast('标签已更新');
    };
    $('.overlay-mask', ov).onclick = () => closeOverlay(ov);
  }

  async function openCardMenu(id) {
    const v = await optionDialog({
      title: '这道题', cancelText: '取消',
      options: [
        { icon: 'eye', title: '查看详情', value: 'detail' },
        { icon: 'edit', title: '编辑内容', value: 'edit' },
        { icon: 'note', title: '追加备考备注', value: 'note' },
        { icon: 'trash', title: '删除错题', desc: '同时移除关联图片', value: 'delete', danger: true }
      ]
    });
    if (!v) return;
    if (v === 'detail') openDetail(id);
    else if (v === 'edit') openEditor(state.questions.find(x => x.id === id));
    else if (v === 'note') openNoteDialog(id);
    else if (v === 'delete') deleteQuestion(id);
  }

  async function deleteQuestion(id) {
    const q = state.questions.find(x => x.id === id);
    if (!q) return;
    const ok = await confirmDialog({
      title: '删除这道错题？', desc: '「' + ((q.stem || '图片题目').slice(0, 30)) + '」及其关联图片会一并移除，删除后可在提示中撤销。',
      confirmText: '删除', danger: true
    });
    if (!ok) return;
    const snapshot = JSON.parse(JSON.stringify(q));
    const imgs = await Promise.all((q.imageIds || []).map(i => DB.getImage(i)));
    const validImgs = imgs.filter(Boolean);
    await DB.deleteQuestionBundle(id);
    await refresh();
    renderHome();
    if (state.view === 'stats') renderStats();
    const t = toast('已删除 1 道错题', 'ok', '撤销', async () => {
      await DB.saveQuestionBundle(snapshot, validImgs, []);
      await refresh(); renderHome(); toast('已恢复');
    });
    return t;
  }

  async function openNoteDialog(id) {
    const q = state.questions.find(x => x.id === id);
    if (!q) return;
    const ov = overlay(
      '<div class="sheet-card">' +
      '<h3 class="modal-title">追加备考备注</h3>' +
      '<p class="modal-desc">记录二次理解或老师讲解，不会覆盖原有解析。</p>' +
      '<textarea class="textarea" id="noteText" placeholder="例如：老师讲过，这类题要先画受力图…"></textarea>' +
      '<div class="modal-actions mt14"><button class="btn btn-ghost" id="noteCancel">取消</button>' +
      '<button class="btn btn-primary" id="noteOk">添加</button></div></div>', 'center', true);
    $('#noteCancel', ov).onclick = () => closeOverlay(ov);
    $('#noteOk', ov).onclick = async () => {
      const v = $('#noteText', ov).value.trim();
      if (!v) { $('#noteText', ov).focus(); return; }
      q.notes = q.notes || [];
      q.notes.push({ id: uid('n'), text: v, createdAt: Date.now() });
      q.updatedAt = Date.now();
      await DB.putQuestion(q);
      closeOverlay(ov); toast('备注已添加');
      if (state.detailId === id) openDetail(id);
      renderHome();
    };
    $('.overlay-mask', ov).onclick = () => closeOverlay(ov);
    setTimeout(() => $('#noteText', ov).focus(), 150);
  }

  /* ---------------------------------------------------------
     DETAIL
     --------------------------------------------------------- */
  /* 把容器内标了 data-math-text 的文本节点用 KaTeX 渲染 $…$，普通文字保持不变。 */
  function renderDetailMath(ov) {
    if (!window.Vision || !Vision.renderMathText) return;
    $$('[data-math-text]', ov).forEach(el => Vision.renderMathText(el, el.dataset.mathText));
  }

  /* 选择题目封面：默认（科目文字）/ 导入图片 / 恢复默认（用首张题目图或文字题干）。 */
  async function openCoverPicker(id) {
    const q = state.questions.find(x => x.id === id);
    if (!q) return;
    const mode = q.cover ? q.cover.mode : 'auto';
    const choice = await optionDialog({
      title: '设置题目封面',
      desc: '封面显示在首页题目卡片上；当前：' + (mode === 'subject' ? '默认科目封面' : mode === 'image' ? '自定义图片' : '自动（首张图或题干）'),
      options: [
        { icon: 'book', title: '默认封面', desc: '同 APP 风格的渐变卡，仅显示科目「' + (q.subject || '错题') + '」文字', value: 'subject' },
        { icon: 'image', title: '导入图片作封面', desc: '选一张图片，压缩后作为卡片封面', value: 'image' },
        ...(q.cover ? [{ icon: 'refresh', title: '恢复默认', desc: '改回首张题目图 / 文字题干', value: 'auto' }] : [])
      ],
      cancelText: '取消'
    });
    if (!choice) return;
    if (choice === 'auto') {
      q.cover = null; q.updatedAt = Date.now();
      await DB.putQuestion(q); await refresh(); renderHome();
      if (state.detailId === id) openDetail(id);
      toast('封面已恢复默认');
      return;
    }
    if (choice === 'subject') {
      q.cover = { mode: 'subject' }; q.updatedAt = Date.now();
      await DB.putQuestion(q); await refresh(); renderHome();
      if (state.detailId === id) openDetail(id);
      toast('已使用默认科目封面');
      return;
    }
    if (choice === 'image') {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        inp.remove();
        if (!f) return;
        try {
          const src = await U.readFileAsDataURL(f);
          const variant = await U.makeVariants(src, {});
          q.cover = { mode: 'image', data: variant.thumb };
          q.updatedAt = Date.now();
          await DB.putQuestion(q); await refresh(); renderHome();
          if (state.detailId === id) openDetail(id);
          toast('封面已更新');
        } catch (e) { toast('封面处理失败：' + e.message, 'err'); }
      };
      inp.click();
    }
  }

  async function openDetail(id) {
    const q = state.questions.find(x => x.id === id);
    if (!q) return;
    dismissDetail();
    state.detailId = id;
    const imgs = (await Promise.all((q.imageIds || []).map(i => DB.getImage(i)))).filter(Boolean);
    const m = MASTERY[q.mastery] || MASTERY.unmastered;
    // 文本面板统一挂 data-math-text，$…$ 走 KaTeX；属性值用 esc 转义防止引号破坏 HTML。
    const mt = s => '<span data-math-text="' + esc(s || '') + '">' + esc(s || '') + '</span>';

    const kv = [
      ['科目', q.subject], ['题型', q.qtype],
      ['掌握状态', m.label], ['录入时间', fmtDateTime(q.createdAt)], ['最近修改', fmtDateTime(q.updatedAt)]
    ];
    const notes = (q.notes || []).map(n =>
      '<div class="note-item"><div class="t">' + icon('clock') + ' ' + fmtDateTime(n.createdAt) + '</div>' +
      '<div class="c" data-math-text="' + esc(n.text) + '">' + esc(n.text) + '</div></div>').join('');

    const panel = (t, ic, body) =>
      '<div class="panel"><div class="panel-title">' + icon(ic) + esc(t) + '</div>' + body + '</div>';

    let html = '';
    if (imgs.length) {
      html += '<div class="detail-imgs">' + imgs.map((im, i) =>
        '<img src="' + im.full + '" data-img="' + i + '" alt="题目图片' + (i + 1) + '">').join('') + '</div>';
    }
    const fieldHiddenForQ = key => fieldHidden(q.subject, key);
    if (q.stem && !fieldHiddenForQ('stem')) html += panel('题干', 'type', '<div class="panel-text" data-math-text="' + esc(q.stem) + '">' + esc(q.stem) + '</div>');
    if (!fieldHiddenForQ('correct')) html += panel('正确答案', 'check-circle', '<div class="panel-text" data-math-text="' + esc(q.correctAnswer || '') + '">' + (q.correctAnswer ? esc(q.correctAnswer) : '<span class="muted">未填写</span>') + '</div>');
    if (!fieldHiddenForQ('cause')) html += panel('错因', 'info', '<div class="panel-text"><span data-math-text="' + esc(q.cause || '') + '">' + esc(q.cause || '未填写') + '</span>' +
      (q.causeExtra ? '<br><span style="color:var(--text-2)">补充说明：<span data-math-text="' + esc(q.causeExtra) + '">' + esc(q.causeExtra) + '</span></span>' : '') + '</div>');
    html += panel('解析', 'book', '<div class="panel-text" data-math-text="' + esc(q.analysis || '') + '">' + (q.analysis ? esc(q.analysis) : '<span class="muted">未填写</span>') + '</div>');
    html += panel('属性', 'layers',
      '<div class="kv-grid">' + kv.map(x => '<div><div class="kv-k">' + x[0] + '</div><div class="kv-v">' + esc(x[1] || '—') + '</div></div>').join('') + '</div>' +
      ((q.tags || []).length ? '<div class="tag-cloud mt14">' + q.tags.map(t => '<span class="chip"># ' + esc(t) + '</span>').join('') + '</div>' : ''));
    if (notes) html += panel('备考备注 · ' + q.notes.length, 'note', notes);

    const ov = overlay(
      '<div class="sheet-full">' +
      '<div class="sheet-head"><button class="icon-btn" id="dtBack">' + icon('chev-left') + '</button>' +
      '<div style="flex:1;min-width:0"><h2 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(q.subject || '错题') + ' · 详情</h2>' +
      '<div class="sub">' + fmtDate(q.createdAt) + ' 录入</div></div>' +
      '<button class="icon-btn" id="dtEdit">' + icon('edit') + '</button></div>' +
      '<div class="sheet-body">' + html + '<div class="scroll-pad" style="height:20px"></div></div>' +
      '<div class="sheet-foot" style="flex-wrap:wrap">' +
      '<button class="btn btn-ghost btn-sm" id="dtMastery">' + icon('check-circle') + m.label + '</button>' +
      '<button class="btn btn-ghost btn-sm" id="dtCover">' + icon('image') + '封面</button>' +
      '<button class="btn btn-ghost btn-sm" id="dtNote">' + icon('note') + '备注</button>' +
      '<button class="btn btn-ghost btn-sm" id="dtDel" style="color:var(--bad)">' + icon('trash') + '</button>' +
      '<button class="btn btn-primary btn-sm" id="dtEdit2" style="flex:1">' + icon('edit') + ' 编辑</button>' +
      '</div></div>', 'bottom', true);

    renderDetailMath(ov);
    $('#dtBack', ov).onclick = () => { state.detailId = null; closeOverlay(ov); };
    $('#dtEdit', ov).onclick = $('#dtEdit2', ov).onclick = () => { closeOverlay(ov); openEditor(q); };
    $('#dtMastery', ov).onclick = async () => {
      const next = q.mastery === 'unmastered' ? 'fuzzy' : q.mastery === 'fuzzy' ? 'mastered' : 'unmastered';
      q.mastery = next; q.updatedAt = Date.now();
      await DB.putQuestion(q); closeOverlay(ov); openDetail(id); renderHome();
      toast('已标记为「' + MASTERY[next].label + '」');
    };
    $('#dtNote', ov).onclick = () => openNoteDialog(id);
    $('#dtCover', ov).onclick = () => openCoverPicker(id);
    $('#dtDel', ov).onclick = async () => { state.detailId = null; await deleteQuestion(id); closeOverlay(ov); };
    $$('.detail-imgs img', ov).forEach(im => im.onclick = () => openViewer(imgs, +im.dataset.img));
    $('.overlay-mask', ov).onclick = () => { state.detailId = null; closeOverlay(ov); };
  }

  /* ---------------------------------------------------------
     IMAGE VIEWER (pinch / drag / wheel zoom)
     --------------------------------------------------------- */
  function openViewer(images, index) {
    const ov = overlay(
      '<div class="viewer">' +
      '<img id="vwImg" src="' + images[index].full + '" alt="题目大图">' +
      '<button class="viewer-close" id="vwClose">' + icon('x') + '</button>' +
      '<div class="viewer-tip">双指缩放 · 拖动查看 · 双击还原</div>' +
      '</div>', 'center', true);
    $('.overlay-mask', ov).style.background = 'transparent';
    $('.overlay-mask', ov).style.backdropFilter = 'none';
    const img = $('#vwImg', ov);
    let scale = 1, tx = 0, ty = 0, lastDist = 0, lastX = 0, lastY = 0, dragging = false, moved = false;
    const apply = () => { img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; };
    const reset = () => { scale = 1; tx = 0; ty = 0; apply(); };
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    ov.addEventListener('touchstart', e => {
      if (e.touches.length === 2) lastDist = dist(e.touches);
      else if (e.touches.length === 1) { dragging = true; moved = false; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }
    }, { passive: true });
    ov.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && lastDist) {
        const d = dist(e.touches);
        scale = Math.min(6, Math.max(1, scale * d / lastDist)); lastDist = d; apply(); moved = true;
      } else if (e.touches.length === 1 && dragging) {
        const dx = e.touches[0].clientX - lastX, dy = e.touches[0].clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        tx += dx; ty += dy; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; apply();
      }
    }, { passive: true });
    ov.addEventListener('touchend', () => { dragging = false; lastDist = 0; });
    let lastTap = 0;
    img.ondblclick = reset;
    img.addEventListener('touchend', () => {
      const now = Date.now();
      if (now - lastTap < 300) { scale = scale > 1 ? 1 : 2.4; tx = ty = 0; apply(); }
      lastTap = now;
    });
    img.onwheel = e => { e.preventDefault(); scale = Math.min(6, Math.max(1, scale - e.deltaY * 0.002)); apply(); };
    $('#vwClose', ov).onclick = () => closeOverlay(ov);
    $('.overlay-mask', ov).onclick = () => closeOverlay(ov);
  }

  /* ---------------------------------------------------------
     EDITOR (create / edit)
     --------------------------------------------------------- */
  function openEditor(q) {
    const cfg = state.config;
    const isNew = !q;
    const keep = state.keepForNext || {};
    const d = {
      id: q ? q.id : uid('q'),
      stem: q ? q.stem || '' : '',
      options: q ? Object.assign({ A: '', B: '', C: '', D: '' }, q.options || {}) : { A: '', B: '', C: '', D: '' },
      correctAnswer: q ? q.correctAnswer || '' : '',
      myAnswer: q ? q.myAnswer || '' : '',
      cause: q ? q.cause || '' : '',
      causeExtra: q ? q.causeExtra || '' : '',
      analysis: q ? q.analysis || '' : '',
      subject: q ? q.subject : (keep.subject || cfg.subjects[0] || ''),
      qtype: q ? q.qtype : (keep.qtype || cfg.qtypes[0] || ''),
      difficulty: q ? q.difficulty || 3 : 3,
      mastery: q ? q.mastery || 'unmastered' : 'unmastered',
      tags: q ? (q.tags || []).slice() : [],
      imageIds: q ? (q.imageIds || []).slice() : [],
      notes: q ? (q.notes || []).slice() : [],
      cover: q && q.cover ? Object.assign({}, q.cover) : null,
      createdAt: q ? q.createdAt : Date.now(),
      updatedAt: q ? q.updatedAt : Date.now(),
      _images: [], _removed: [], _isNew: isNew
    };
    state.draft = d;
    state.keepForNext = null;

    // load thumbnails for existing images
    d._images = d.imageIds.map(id => ({ id, thumb: state.thumbs.get(id) || '', _new: false }));

    const selectHTML = (id, items, cur) => '<select class="select" id="' + id + '">' +
      (items.length ? items.map(x => '<option' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>').join('') : '<option value="">（请先到管理页添加）</option>') +
      '</select>';

    const causeChips = cfg.causes.map(c =>
      '<button type="button" class="choice small" data-cause="' + esc(c) + '">' + esc(c) + '</button>').join('');
    const tagChips = cfg.tags.map(t =>
      '<button type="button" class="tag-pick" data-tag="' + esc(t) + '"># ' + esc(t) + '</button>').join('');

    const body =
      '<div class="section-label">题目图片 <span style="text-transform:none;letter-spacing:0;font-weight:500">（可选，可与文字题干并存）</span></div>' +
      '<div class="img-grid" id="draftImgs"></div>' +
      '<div class="pick-row">' +
      '<button class="pick-btn" id="pickCamera">' + icon('camera') + '拍照</button>' +
      '<button class="pick-btn" id="pickAlbum">' + icon('image') + '相册选图</button>' +
      '</div>' +
      '<input type="file" id="fileCamera" accept="image/*" capture="environment" hidden>' +
      '<input type="file" id="fileAlbum" accept="image/*" multiple hidden>' +
      '<div class="tiny mt8">照片可裁剪、调亮度；支持离线 OCR 识别转文字，几何图形可一键变成纯白背景干净图片。全部在本机完成。</div>' +

      '<div class="section-label" style="margin-top:22px">题目内容</div>' +
      '<div class="field" id="field-stem"><div class="field-label">文字题干 <span class="req">*</span><span class="hint">无图时必填，图片题建议补一句便于搜索</span></div>' +
      '<textarea class="textarea" id="f-stem" placeholder="输入题目文字，或粘贴题干…">' + esc(d.stem) + '</textarea></div>' +
      '<div class="field" id="field-correct"><div class="field-label">正确答案</div><textarea class="textarea" id="f-correct" placeholder="标准答案 / 完整解题过程">' + esc(d.correctAnswer) + '</textarea></div>' +
      '<div class="field" id="field-cause"><div class="field-label">错因 <span class="hint">点选常用项</span></div>' +
      '<div class="choice-row" id="f-causes">' + causeChips + '</div>' +
      '<div id="causeExtraWrap" class="' + (d.cause === '其他' ? '' : 'hidden') + '" style="margin-top:9px">' +
      '<input class="input" id="f-causeExtra" placeholder="补充错因说明" value="' + esc(d.causeExtra) + '"></div></div>' +
      '<div class="field"><div class="field-label">解析 <span class="hint">支持分段换行</span></div>' +
      '<textarea class="textarea" id="f-analysis" style="min-height:100px" placeholder="自己整理的解题思路…">' + esc(d.analysis) + '</textarea></div>' +

      '<div class="section-label" style="margin-top:22px">分类与标记</div>' +
      '<div class="field"><div class="field-label">科目 <span class="req">*</span></div>' +
      '<div style="display:flex;gap:8px">' + selectHTML('f-subject', cfg.subjects, d.subject) +
      '<button class="icon-btn" id="addSubject" style="width:46px;flex:none">' + icon('plus') + '</button></div></div>' +
      '<div class="field"><div class="field-label">题型</div>' +
      '<div style="display:flex;gap:8px">' + selectHTML('f-qtype', cfg.qtypes, d.qtype) +
      '<button class="icon-btn" id="addQtype" style="width:46px;flex:none">' + icon('plus') + '</button></div></div>' +
      '<div class="field"><div class="field-label">掌握状态</div>' +
      '<div class="segmented" id="f-mastery">' + Object.keys(MASTERY).map(k =>
        '<button data-m="' + k + '" class="' + (k === d.mastery ? 'on' : '') + '">' + MASTERY[k].label + '</button>').join('') + '</div></div>' +
      '<div class="field"><div class="field-label">标签 <span class="hint">可多选</span></div>' +
      '<div class="tag-cloud" id="f-tags">' + (tagChips || '<span class="tiny">还没有标签，可在「管理」页添加</span>') + '</div></div>' +
      '<div class="scroll-pad" style="height:12px"></div>';

    const ov = overlay(
      '<div class="sheet-full">' +
      '<div class="sheet-head"><button class="icon-btn" id="edCancel">' + icon('x') + '</button>' +
      '<div style="flex:1"><h2>' + (isNew ? '录入错题' : '编辑错题') + '</h2>' +
      '<div class="sub">' + (isNew ? '照片 · 答案 · 错因，一次记清' : fmtDateTime(d.createdAt) + ' 录入') + '</div></div>' +
      '<button class="icon-btn" id="edSaveTop">' + icon('check') + '</button></div>' +
      '<div class="sheet-body">' + body + '</div>' +
      '<div class="sheet-foot">' +
      '<button class="btn btn-ghost" id="edCancel2" style="flex:none">取消</button>' +
      (isNew ? '<button class="btn btn-ghost" id="edNext" style="flex:none">' + icon('copy') + ' 存并继续</button>' : '') +
      '<button class="btn btn-primary" id="edSave">保存</button>' +
      '</div></div>', 'bottom', true);

    /* ---- draft state kept in DOM; sync helpers ---- */
    const syncCauses = () => $$('[data-cause]', ov).forEach(b => b.classList.toggle('on', b.dataset.cause === d.cause));
    const syncTags = () => $$('[data-tag]', ov).forEach(b => b.classList.toggle('on', d.tags.includes(b.dataset.tag)));
    const syncMastery = () => $$('#f-mastery button', ov).forEach(b => b.classList.toggle('on', b.dataset.m === d.mastery));

    // Per-subject field visibility: hide the configured field wrappers for the
    // currently selected subject. Data is never cleared — only hidden.
    function applyEditorFieldVis() {
      const subj = $('#f-subject', ov) ? $('#f-subject', ov).value : d.subject;
      HIDDEN_FIELD_META.forEach(f => {
        const wrap = $('#field-' + f.key, ov);
        if (wrap) wrap.classList.toggle('hidden', fieldHidden(subj, f.key));
      });
    }

    function renderDraftImages() {
      const grid = $('#draftImgs', ov);
      grid.innerHTML = d._images.map((im, i) =>
        '<div class="img-tile">' + (im.cleaned ? '<span class="clean-badge">白底</span>' : '') + '<img src="' + (im.thumb || im.full) + '" alt="题目图片"><button class="rm" data-rm="' + i + '">' + icon('x') + '</button></div>').join('') +
        '<button class="img-add" id="imgAddMore">' + icon('plus') + '<span>添加图片</span></button>';
      $$('[data-rm]', grid).forEach(b => b.onclick = () => {
        const im = d._images.splice(+b.dataset.rm, 1)[0];
        if (im && !im._new) d._removed.push(im.id);
        renderDraftImages(); haptic();
      });
      $('#imgAddMore', grid).onclick = () => $('#fileAlbum', ov).click();
    }

    function collect() {
      d.stem = $('#f-stem', ov).value.trim();
      d.correctAnswer = $('#f-correct', ov).value.trim();
      d.causeExtra = $('#f-causeExtra', ov) ? $('#f-causeExtra', ov).value.trim() : '';
      d.analysis = $('#f-analysis', ov).value.trim();
      d.subject = $('#f-subject', ov).value;
      d.qtype = $('#f-qtype', ov).value;
      d.tags = Array.from(new Set(d.tags));
      return d;
    }

    async function save(continueNext) {
      collect();
      if (!d.subject) { toast('请选择科目', 'err'); return; }
      // 题干字段被隐藏的科目允许用图片/答案等其他内容替代题干保存
      const stemHidden = fieldHidden(d.subject, 'stem');
      const hasOther = d.correctAnswer || d.analysis || d.cause || (d._images && d._images.length);
      if (!stemHidden && !d.stem && !(d._images && d._images.length)) { toast('请填写文字题干或添加一张题目图片', 'err'); return; }
      if (stemHidden && !d.stem && !(d._images && d._images.length) && !hasOther) { toast('请至少添加图片或填写答案内容', 'err'); return; }
      const now = Date.now();
      const record = {
        id: d.id, stem: d.stem, options: d.options, correctAnswer: d.correctAnswer,
        myAnswer: d.myAnswer, cause: d.cause, causeExtra: d.causeExtra, analysis: d.analysis,
        subject: d.subject, qtype: d.qtype, difficulty: d.difficulty, mastery: d.mastery,
        tags: d.tags, imageIds: d._images.map(i => i.id), notes: d.notes,
        cover: d.cover || null,
        createdAt: d.createdAt, updatedAt: now
      };
      try {
        await DB.saveQuestionBundle(record, d._images.filter(i => i._new), d._removed);
        await refresh();
        closeOverlay(ov);
        renderHome();
        if (state.view === 'stats') renderStats();
        toast(d._isNew ? '错题已保存' : '修改已保存');
        haptic(12);
        if (continueNext) {
          state.keepForNext = { subject: d.subject, qtype: d.qtype };
          setTimeout(() => openEditor(null), 240);
        }
      } catch (e) {
        console.error(e);
        toast('保存失败：' + e.message, 'err');
      }
    }

    /* ---- bindings ---- */
    renderDraftImages(); syncCauses(); syncTags(); syncMastery(); applyEditorFieldVis();
    const subjectSel = $('#f-subject', ov);
    if (subjectSel) subjectSel.addEventListener('change', applyEditorFieldVis);

    $$('[data-cause]', ov).forEach(b => b.onclick = () => {
      d.cause = d.cause === b.dataset.cause ? '' : b.dataset.cause;
      syncCauses();
      $('#causeExtraWrap', ov).classList.toggle('hidden', d.cause !== '其他');
      haptic();
    });
    $$('[data-tag]', ov).forEach(b => b.onclick = () => {
      const t = b.dataset.tag;
      const i = d.tags.indexOf(t);
      if (i >= 0) d.tags.splice(i, 1); else d.tags.push(t);
      syncTags(); haptic();
    });
    $$('#f-mastery button', ov).forEach(b => b.onclick = () => { d.mastery = b.dataset.m; syncMastery(); haptic(); });

    const addCfg = async (key, selectId) => {
      const v = await promptDialog({ title: '新增' + (key === 'subjects' ? '科目' : '题型'), placeholder: '输入名称' });
      if (!v) return;
      if (!cfg[key].includes(v)) { cfg[key].push(v); await DB.putConfig(cfg); }
      const sel = $(selectId, ov);
      sel.insertAdjacentHTML('beforeend', '<option value="' + esc(v) + '">' + esc(v) + '</option>');
      sel.value = v;
      toast('已新增「' + v + '」');
    };
    $('#addSubject', ov).onclick = () => addCfg('subjects', '#f-subject');
    $('#addQtype', ov).onclick = () => addCfg('qtypes', '#f-qtype');

    $('#pickCamera', ov).onclick = () => $('#fileCamera', ov).click();
    $('#pickAlbum', ov).onclick = () => $('#fileAlbum', ov).click();
    const onFiles = async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      for (const f of files) {
        try {
          const dataUrl = await U.readFileAsDataURL(f);
          const variant = await openImageEditor(dataUrl, {
            autoCrop: e.target.id === 'fileCamera',
            onText: (text, where) => {
              const target = where === 'analysis' ? $('#f-analysis', ov) : $('#f-stem', ov);
              if (!target) return;
              if (where === 'append') target.value = (target.value.trim() ? target.value.trim() + '\n' : '') + text;
              else target.value = text;
              target.dispatchEvent(new Event('input', { bubbles: true }));
              toast(where === 'analysis' ? '识别文字已填入解析' : where === 'append' ? '识别文字已追加到题干' : '识别文字已填入题干');
            }
          });
          if (variant) {
            variant.id = uid('img');
            variant._new = true;
            variant.createdAt = Date.now();
            d._images.push(variant);
            renderDraftImages();
          }
        } catch (err) { toast('图片处理失败：' + err.message, 'err'); }
      }
    };
    $('#fileCamera', ov).onchange = onFiles;
    $('#fileAlbum', ov).onchange = onFiles;

    $('#edCancel', ov).onclick = $('#edCancel2', ov).onclick = async () => {
      if (d._images.length || d.stem || $('#f-stem', ov).value.trim()) {
        const ok = await confirmDialog({ title: '放弃这次录入？', desc: '尚未保存的内容会丢失。', confirmText: '放弃', danger: true });
        if (!ok) return;
      }
      closeOverlay(ov);
    };
    $('#edSave', ov).onclick = () => save(false);
    $('#edSaveTop', ov).onclick = () => save(false);
    const nx = $('#edNext', ov); if (nx) nx.onclick = () => save(true);
    $('.overlay-mask', ov).onclick = () => { };
  }

  /* ---------------------------------------------------------
     直接截取：拍照 / 选图后先把「题目区域」裁出来，再进入编辑与识别。
     四角可拖动缩放、框内可拖动移动；返回裁剪后的 dataUrl。
     --------------------------------------------------------- */
  function openCropper(dataUrl, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const ov = overlay(
        '<div class="sheet-card crop-sheet vision-sheet" style="max-width:400px">' +
        '<h3 class="modal-title">' + esc(opts.title || '截取题目区域') + '</h3>' +
        '<p class="modal-desc">拖动四角调整选区，只保留题目部分。拍照后可先截取再识别，识别更准。</p>' +
        '<div class="crop-canvas"><canvas id="crCanvas"></canvas></div>' +
        '<div class="crop-presets">' +
        '<button data-preset="full" class="on">整张</button>' +
        '<button data-preset="center">题目区</button>' +
        '<button data-preset="wide">宽幅</button></div>' +
        '<div class="modal-actions mt14 cr-actions">' +
        '<button class="btn btn-ghost" id="crCancel" data-x="cancel">取消</button>' +
        '<button class="btn btn-ghost" id="crOnly">' + icon('crop') + ' 截取</button>' +
        '<button class="btn btn-primary" id="crOcr">' + icon('sparkles') + ' 截取并识别</button>' +
        '</div></div>', 'center', true);

      const canvas = $('#crCanvas', ov), ctx = canvas.getContext('2d');
      let im = null, scale = 1, CW = 0, CH = 0;
      let sel = null, mode = null, handle = null, start = null, orig = null;
      const HS = 13; // 角标命中半径

      const pos = e => {
        const r = canvas.getBoundingClientRect();
        return {
          x: (e.clientX - r.left) * CW / r.width,
          y: (e.clientY - r.top) * CH / r.height
        };
      };
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      function draw() {
        ctx.clearRect(0, 0, CW, CH);
        if (im) ctx.drawImage(im, 0, 0, CW, CH);
        if (!sel) return;
        ctx.fillStyle = 'rgba(4,7,18,.60)';
        ctx.fillRect(0, 0, CW, sel.y);
        ctx.fillRect(0, sel.y + sel.h, CW, CH - sel.y - sel.h);
        ctx.fillRect(0, sel.y, sel.x, sel.h);
        ctx.fillRect(sel.x + sel.w, sel.y, CW - sel.x - sel.w, sel.h);
        /* 三分线，方便对齐题目 */
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
        for (let i = 1; i < 3; i++) {
          ctx.beginPath(); ctx.moveTo(sel.x + sel.w * i / 3, sel.y); ctx.lineTo(sel.x + sel.w * i / 3, sel.y + sel.h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(sel.x, sel.y + sel.h * i / 3); ctx.lineTo(sel.x + sel.w, sel.y + sel.h * i / 3); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 2;
        ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
        const pts = [
          [sel.x, sel.y], [sel.x + sel.w, sel.y],
          [sel.x, sel.y + sel.h], [sel.x + sel.w, sel.y + sel.h]
        ];
        for (const [x, y] of pts) {
          ctx.fillStyle = '#8d7dff';
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      const hitHandle = p => {
        if (!sel) return null;
        const pts = [
          ['nw', sel.x, sel.y], ['ne', sel.x + sel.w, sel.y],
          ['sw', sel.x, sel.y + sel.h], ['se', sel.x + sel.w, sel.y + sel.h]
        ];
        for (const [k, x, y] of pts) if (Math.abs(p.x - x) <= HS && Math.abs(p.y - y) <= HS) return k;
        return null;
      };
      const down = e => {
        if (!im) return;
        e.preventDefault();
        const p = pos(e);
        handle = hitHandle(p);
        orig = sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : null;
        start = p;
        mode = handle ? 'resize' : (sel && p.x > sel.x && p.x < sel.x + sel.w && p.y > sel.y && p.y < sel.y + sel.h) ? 'move' : 'new';
        if (mode === 'new') sel = { x: p.x, y: p.y, w: 0, h: 0 };
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
        draw();
      };
      const move = e => {
        if (!mode || !im) return;
        e.preventDefault();
        const p = pos(e);
        const dx = p.x - start.x, dy = p.y - start.y;
        if (mode === 'new') {
          sel = { x: clamp(Math.min(start.x, p.x), 0, CW), y: clamp(Math.min(start.y, p.y), 0, CH),
                  w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
          sel.w = Math.min(sel.w, CW - sel.x); sel.h = Math.min(sel.h, CH - sel.y);
        } else if (mode === 'move' && orig) {
          sel = { x: clamp(orig.x + dx, 0, CW - orig.w), y: clamp(orig.y + dy, 0, CH - orig.h),
                  w: orig.w, h: orig.h };
        } else if (mode === 'resize' && orig) {
          let x0 = orig.x, y0 = orig.y, x1 = orig.x + orig.w, y1 = orig.y + orig.h;
          if (handle.indexOf('w') >= 0) x0 = clamp(x0 + dx, 0, x1 - 20);
          if (handle.indexOf('e') >= 0) x1 = clamp(x1 + dx, x0 + 20, CW);
          if (handle.indexOf('n') >= 0) y0 = clamp(y0 + dy, 0, y1 - 20);
          if (handle.indexOf('s') >= 0) y1 = clamp(y1 + dy, y0 + 20, CH);
          sel = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
        draw();
      };
      const up = e => {
        if (!mode) return;
        mode = null;
        if (sel && (sel.w < 24 || sel.h < 24)) sel = { x: 0, y: 0, w: CW, h: CH };
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) { }
        draw();
      };
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);

      $$('.crop-presets button', ov).forEach(b => b.onclick = () => {
        $$('.crop-presets button', ov).forEach(x => x.classList.toggle('on', x === b));
        const k = b.dataset.preset;
        if (k === 'full') sel = { x: 0, y: 0, w: CW, h: CH };
        else if (k === 'wide') sel = { x: CW * 0.04, y: CH * 0.18, w: CW * 0.92, h: CH * 0.58 };
        else sel = { x: CW * 0.08, y: CH * 0.10, w: CW * 0.84, h: CH * 0.76 };
        draw();
      });

      (async () => {
        try {
          im = await U.loadImage(dataUrl);
          const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
          scale = Math.min(360 / w, 440 / h, 1);
          CW = Math.max(1, Math.round(w * scale)); CH = Math.max(1, Math.round(h * scale));
          /* 高分屏 backing store：像素按 DPR 放大，避免预览发虚（坐标仍用 CSS 像素 CW/CH） */
          const dpr = Math.min(3, window.devicePixelRatio || 1);
          canvas.width = Math.max(1, Math.round(CW * dpr)); canvas.height = Math.max(1, Math.round(CH * dpr));
          canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          sel = { x: 0, y: 0, w: CW, h: CH };
          if (opts.preset === 'center') {
            sel = { x: CW * 0.08, y: CH * 0.10, w: CW * 0.84, h: CH * 0.76 };
            $$('.crop-presets button', ov).forEach(x => x.classList.toggle('on', x.dataset.preset === 'center'));
          }
          draw();
        } catch (e) { toast('图片读取失败', 'err'); closeOverlay(ov); resolve(null); }
      })();

      const apply = async recognize => {
        if (!im || !sel) { closeOverlay(ov); resolve(null); return; }
        const x = Math.max(0, Math.round(sel.x / scale)), y = Math.max(0, Math.round(sel.y / scale));
        const w = Math.max(1, Math.min(Math.round(sel.w / scale), (im.naturalWidth || im.width) - x));
        const h = Math.max(1, Math.min(Math.round(sel.h / scale), (im.naturalHeight || im.height) - y));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(im, x, y, w, h, 0, 0, w, h);
        closeOverlay(ov);
        resolve({ dataUrl: c.toDataURL('image/jpeg', 0.94), rect: { x: x, y: y, w: w, h: h }, recognize: recognize });
      };
      $('#crCancel', ov).onclick = () => { closeOverlay(ov); resolve(null); };
      $('#crOnly', ov).onclick = () => apply(false);
      $('#crOcr', ov).onclick = () => apply(true);
      $('.overlay-mask', ov).onclick = () => { closeOverlay(ov); resolve(null); };
    });
  }

  /* ---------------------------------------------------------
     IMAGE EDITOR — 裁剪 / 亮度 / OCR 转文字 / 纯白背景图形
     opts.onText(text, where) 由录入页提供，把识别文字写进题干或解析
     opts.autoCrop 拍照来源为 true：进来先弹截取器
     --------------------------------------------------------- */
  function openImageEditor(dataUrl, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const ov = overlay(
        '<div class="sheet-card vision-sheet" style="max-width:400px">' +
        '<h3 class="modal-title">编辑图片</h3>' +
        '<p class="modal-desc">拍照后可先「截取」题目区域，再识别文字 / 数学公式，或把图形题转成纯白背景。</p>' +
        '<div class="vision-tabs" id="visTabs">' +
        '<button data-mode="original" class="on">原图</button>' +
        '<button data-mode="white">纯白图形</button>' +
        '<button data-mode="mono">黑白线稿</button></div>' +
        '<div class="editor-canvas"><canvas id="edCanvas" width="340" height="260"></canvas></div>' +
        '<div class="vision-tools">' +
        '<button class="vision-btn primary" id="visSmart">' + icon('sparkles') + '智能识别</button>' +
        '<button class="vision-btn" id="visOcr">' + icon('type') + '转文字</button>' +
        '<button class="vision-btn" id="visMath">' + icon('grid') + '识别公式</button>' +
         '<button class="vision-btn" id="visCrop">' + icon('crop') + '截取区域</button>' +
         '<button class="vision-btn" id="visCropOcr">' + icon('camera') + '截取并识别</button>' +
         '<button class="vision-btn" id="visClean">' + icon('shield') + '白底图形</button></div>' +
        '<div class="slider-row">' + icon('brightness') +
        '<input type="range" id="edBright" min="60" max="160" value="100"><span class="slider-val" id="edBrightVal">100%</span></div>' +
        '<div class="slider-row">' + icon('shield') +
        '<input type="range" id="visStrength" min="8" max="42" value="20"><span class="slider-val" id="visStrengthVal">20%</span></div>' +
        '<div class="mt8" style="display:flex;gap:8px;align-items:center">' +
        '<span class="tiny" style="flex:1">拖动框选裁剪 · 亮度仅作用于原图</span>' +
        '<button class="btn btn-ghost btn-sm" id="edReset">' + icon('refresh') + '重置</button></div>' +
        '<div class="modal-actions mt14">' +
        '<button class="btn btn-ghost" id="edImgCancel" data-x="cancel">取消</button>' +
        '<button class="btn btn-primary" id="edImgOk">' + icon('check') + ' 使用这张</button>' +
        '</div></div>', 'center', true);

      const canvas = $('#edCanvas', ov), ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      let img = null, workDataUrl = dataUrl, sourceDataUrl = dataUrl;
      let box = { x: 0, y: 0, w: 0, h: 0 }, imgRect = null, brightness = 1, strength = 20;
      let sel = null, drawing = false, startX = 0, startY = 0;
      let previewMode = 'original', busy = false, strengthTimer = null;
      const cleanCache = {}, previewImgs = {};

      function progress(title) {
        const p = overlay(
          '<div class="sheet-card progress-card">' +
          '<div class="progress-orb">' + icon('sparkles') + '</div>' +
          '<h3 class="modal-title">' + esc(title) + '</h3>' +
          '<p class="modal-desc" id="visProgLabel">准备中…</p>' +
          '<div class="progress-track"><div class="progress-fill" id="visProgFill"></div></div>' +
          '<div class="modal-actions mt14"><button class="btn btn-ghost btn-sm" data-x="cancel" id="visProgClose">关闭</button></div>' +
          '</div>', 'center', true);
        let cancelled = false;
        $('#visProgClose', p).onclick = () => { cancelled = true; closeOverlay(p); };
        return {
          set(label, frac) {
            const l = $('#visProgLabel', p), f = $('#visProgFill', p);
            if (l) l.textContent = label;
            if (f) f.style.width = Math.round(Math.max(0, Math.min(1, frac || 0)) * 100) + '%';
          },
          close() { closeOverlay(p); },
          get cancelled() { return cancelled; }
        };
      }

      /* 从「正文 + $...$」混合文本里取出全部公式，交给 KaTeX 渲染。 */
      function extractLatex(text) {
        const segs = String(text || '').match(/\$([^$]+)\$/g) || [];
        const list = segs.map(s => s.slice(1, -1));
        return list.length ? list.join('\\\\[4pt]\n') : String(text || '');
      }

      function ocrResult(text, meta, latex) {
        return new Promise(res => {
          const p = overlay(
            '<div class="sheet-card ocr-sheet">' +
            '<h3 class="modal-title">识别结果</h3>' +
            '<p class="modal-desc">' + esc(meta) + ' · 可先修改再填入，纯图片题也能被全文搜索。</p>' +
            '<textarea class="textarea ocr-text" id="ocrText">' + esc(text) + '</textarea>' +
            (latex ? '<div class="math-tools">' +
              '<span class="tiny">公式快插</span>' +
              '<button data-ins="sqrt">√ 根号</button>' +
              '<button data-ins="frac">a/b 分式</button>' +
              '<button data-ins="sup">xⁿ 上标</button>' +
              '<button data-ins="sub">xₙ 下标</button></div>' +
              '<div class="math-preview" id="ocrMath"></div>' : '') +
            '<div class="ocr-actions">' +
            '<button class="btn btn-ghost btn-sm" data-where="stem">替换题干</button>' +
            '<button class="btn btn-ghost btn-sm" data-where="append">追加到题干</button>' +
            '<button class="btn btn-ghost btn-sm" data-where="analysis">填入解析</button></div>' +
            '<div class="modal-actions mt14">' +
            '<button class="btn btn-ghost" data-x="cancel" id="ocrClose">关闭</button>' +
            '<button class="btn btn-primary" id="ocrOk">填入题干</button></div>' +
            '</div>', 'center', true);
          const apply = where => {
            const t = $('#ocrText', p).value.trim();
            if (t && opts.onText) { try { opts.onText(t, where); } catch (e) { } }
            closeOverlay(p); res(!!t);
          };
          $$('[data-where]', p).forEach(b => b.onclick = () => apply(b.dataset.where));
          $('#ocrOk', p).onclick = () => apply('stem');
          $('#ocrClose', p).onclick = () => { closeOverlay(p); res(false); };
          $('.overlay-mask', p).onclick = () => { closeOverlay(p); res(false); };
          /* 公式快插：在光标处插入 LaTeX 片段，识别不准时可手动修正 */
          $$('.math-tools [data-ins]', p).forEach(b => b.onclick = () => {
            const ta = $('#ocrText', p);
            const wrap = {
              sqrt: ['\\sqrt{', '}'], frac: ['\\frac{', '}{}'],
              sup: ['^{', '}'], sub: ['_{', '}']
            }[b.dataset.ins];
            if (!wrap) return;
            const s = ta.selectionStart, e = ta.selectionEnd;
            const picked = ta.value.slice(s, e) || 'x';
            ta.value = ta.value.slice(0, s) + wrap[0] + picked + wrap[1] + ta.value.slice(e);
            ta.focus(); ta.setSelectionRange(s + wrap[0].length, s + wrap[0].length + picked.length);
            if (latex) Vision.renderMath($('#ocrMath', p), extractLatex(ta.value));
          });
          if (latex) Vision.renderMath($('#ocrMath', p), latex);
        });
      }

      function setMode(m) {
        previewMode = m;
        $$('#visTabs button', ov).forEach(b => b.classList.toggle('on', b.dataset.mode === m));
        draw();
      }

      function draw() {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0a0e1c'; ctx.fillRect(0, 0, W, H);
        if (!img) return;
        const shown = (previewMode !== 'original' && previewImgs[previewMode]) ? previewImgs[previewMode] : img;
        ctx.save();
        if (previewMode === 'original' && brightness !== 1) ctx.filter = 'brightness(' + brightness + ')';
        ctx.drawImage(shown, imgRect.x, imgRect.y, imgRect.w, imgRect.h);
        ctx.restore();
        if (sel && sel.w > 4 && sel.h > 4) {
          ctx.fillStyle = 'rgba(4,7,18,.58)';
          ctx.fillRect(0, 0, W, sel.y);
          ctx.fillRect(0, sel.y + sel.h, W, H - sel.y - sel.h);
          ctx.fillRect(0, sel.y, sel.x, sel.h);
          ctx.fillRect(sel.x + sel.w, sel.y, W - sel.x - sel.w, sel.h);
          ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.5;
          ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
          ctx.strokeStyle = 'rgba(141,125,255,.9)';
          ctx.strokeRect(sel.x + .5, sel.y + .5, sel.w - 1, sel.h - 1);
        }
      }

      const pos = e => {
        const r = canvas.getBoundingClientRect();
        const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
        return { x: cx * W / r.width, y: cy * H / r.height };
      };
      const down = e => {
        if (!img) return;
        e.preventDefault();
        const p = pos(e);
        startX = Math.max(imgRect.x, Math.min(imgRect.x + imgRect.w, p.x));
        startY = Math.max(imgRect.y, Math.min(imgRect.y + imgRect.h, p.y));
        sel = { x: startX, y: startY, w: 0, h: 0 };
        drawing = true; draw();
      };
      const move = e => {
        if (!drawing) return;
        e.preventDefault();
        const p = pos(e);
        const x = Math.max(imgRect.x, Math.min(imgRect.x + imgRect.w, p.x));
        const y = Math.max(imgRect.y, Math.min(imgRect.y + imgRect.h, p.y));
        sel = { x: Math.min(startX, x), y: Math.min(startY, y), w: Math.abs(x - startX), h: Math.abs(y - startY) };
        draw();
      };
      const up = () => { drawing = false; if (sel && (sel.w < 6 || sel.h < 6)) { sel = null; draw(); } };
      canvas.addEventListener('mousedown', down);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      canvas.addEventListener('touchstart', down, { passive: false });
      canvas.addEventListener('touchmove', move, { passive: false });
      canvas.addEventListener('touchend', up);

      /* 统一工作图：所有裁剪坐标、白底化、OCR 都基于同一尺寸（长边 1600）。
         截取器替换图片后复用此函数重绘画布，保证坐标体系一致。 */
      async function loadWork(src) {
        const raw = await U.loadImage(src);
        const w0 = raw.naturalWidth || raw.width, h0 = raw.naturalHeight || raw.height;
        const s0 = Math.min(1, 1600 / Math.max(w0, h0));
        let cur = src;
        if (s0 < 1) {
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w0 * s0));
          c.height = Math.max(1, Math.round(h0 * s0));
          c.getContext('2d').drawImage(raw, 0, 0, c.width, c.height);
          cur = c.toDataURL('image/jpeg', 0.94);
        }
        workDataUrl = cur;
        img = await U.loadImage(cur);
        const s = Math.min(W / img.naturalWidth, H / img.naturalHeight);
        box = { w: img.naturalWidth * s, h: img.naturalHeight * s };
        imgRect = { x: (W - box.w) / 2, y: (H - box.h) / 2, w: box.w, h: box.h, scale: s };
        draw();
      }
      loadWork(dataUrl).then(() => {
        /* 拍照来源先弹截取器，让用户只框出题目部分再识别，命中率更高 */
        if (opts.autoCrop) runCrop(false);
      }).catch(err => {
        toast('图片读取失败', 'err'); closeOverlay(ov); resolve(null);
      });

      async function ensureClean(mode, silent) {
        if (cleanCache[mode]) { setMode(mode); return cleanCache[mode]; }
        if (busy) return null;
        busy = true;
        const prog = progress(mode === 'mono' ? '正在生成黑白线稿' : '正在生成纯白背景图形');
        prog.set('分析背景与线条', 0.3);
        await new Promise(r => setTimeout(r, 40));
        try {
          const r = await Vision.cleanFigure(workDataUrl, { mode: mode, strength: strength / 100 });
          cleanCache[mode] = r;
          previewImgs[mode] = await U.loadImage(r.dataUrl);
          prog.close(); busy = false;
          setMode(mode);
          if (!silent) toast(mode === 'mono' ? '已生成黑白线稿' : '已生成纯白背景图形');
          return r;
        } catch (e) {
          prog.close(); busy = false;
          toast('图形处理失败：' + e.message, 'err');
          return null;
        }
      }

      async function runMath() {
        if (busy) return;
        busy = true;
        const prog = progress('识别数学公式');
        try {
          const chk = await Vision.checkResources();
          if (!chk.ok) throw new Error('缺少本地识别资源：' + chk.missing.join('、'));
          const r = await Vision.recognizeMath(sourceDataUrl, (label, p) => prog.set(label, p));
          prog.close(); busy = false;
          if (prog.cancelled) return;
          const meta = '公式识别 · ' + r.formulas.length + ' 个公式 · 置信度 ' + Math.round(r.confidence) + '%';
          await ocrResult(r.text, meta, r.latex);
        } catch (e) {
          prog.close(); busy = false;
          toast('公式识别失败：' + e.message, 'err');
        }
      }

      /* 从拍照/相册「原始全分辨率图」截取题目区域（不要用已缩到 1600 的工作图，
         否则截取那一刻细节就丢了，OCR 会明显发虚）。截取结果同时作为新的全分辨率源：
         OCR 直接用它，工作图再由它派生 1600px 显示副本。 */
      async function runCrop(recognize) {
        if (busy) return;
        const r = await openCropper(sourceDataUrl, { preset: 'center', recognize: !!recognize });
        if (!r) return;
        sourceDataUrl = r.dataUrl;
        sel = null;
        Object.keys(cleanCache).forEach(k => delete cleanCache[k]);
        Object.keys(previewImgs).forEach(k => delete previewImgs[k]);
        setMode('original');
        await loadWork(sourceDataUrl);
        toast('已截取题目区域 · ' + Math.round(r.rect.w) + '×' + Math.round(r.rect.h));
        if (r.recognize) runMath();
      }

      async function runOcr(smartMode) {
        if (busy) return;
        busy = true;
        const prog = progress(smartMode ? '智能识别' : '图片转文字');
        try {
          const chk = await Vision.checkResources();
          if (!chk.ok) throw new Error('缺少本地识别资源：' + chk.missing.join('、'));
          /* 智能识别：一次 OCR 同时产出正文与结构化公式，避免重复跑 worker。 */
          const r = smartMode
            ? await Vision.recognizeMath(sourceDataUrl, (label, p) => prog.set(label, p))
            : await Vision.recognize(sourceDataUrl, (label, p) => prog.set(label, p));
          const cl = Vision.classify(r);
          prog.close(); busy = false;
          if (prog.cancelled) return;
          if (smartMode && cl.kind === 'figure' && !(r.formulas && r.formulas.length)) {
            await ensureClean('white', true);
            toast('未识别到成段文字，已转为纯白背景图形');
            return;
          }
          const meta = smartMode
            ? '识别为文字题 · ' + cl.chars + ' 字 · ' + r.formulas.length + ' 个公式 · 置信度 ' + cl.confidence + '%'
            : '识别到 ' + Vision.meaningfulChars(r.text) + ' 个有效字符 · 置信度 ' + Math.round(r.confidence) + '%';
          await ocrResult(r.text, meta, smartMode ? r.latex : null);
        } catch (e) {
          prog.close(); busy = false;
          toast('识别失败：' + e.message, 'err');
        }
      }

      $$('#visTabs button', ov).forEach(b => b.onclick = async () => {
        const m = b.dataset.mode;
        if (m === 'original') { setMode('original'); return; }
        await ensureClean(m);
      });
      $('#visSmart', ov).onclick = () => runOcr(true);
      $('#visOcr', ov).onclick = () => runOcr(false);
      $('#visMath', ov).onclick = () => runMath();
      $('#visCrop', ov).onclick = () => runCrop(false);
      $('#visCropOcr', ov).onclick = () => runCrop(true);
      $('#visClean', ov).onclick = () => ensureClean('white');

      $('#edBright', ov).oninput = e => {
        brightness = +e.target.value / 100;
        $('#edBrightVal', ov).textContent = e.target.value + '%';
        draw();
      };
      $('#visStrength', ov).oninput = e => {
        strength = +e.target.value;
        $('#visStrengthVal', ov).textContent = strength + '%';
        Object.keys(cleanCache).forEach(k => delete cleanCache[k]);
        Object.keys(previewImgs).forEach(k => delete previewImgs[k]);
        const m = previewMode;
        setMode('original');
        clearTimeout(strengthTimer);
        if (m !== 'original') strengthTimer = setTimeout(() => ensureClean(m, true), 260);
      };
      $('#edReset', ov).onclick = () => {
        sel = null; brightness = 1; strength = 20;
        $('#edBright', ov).value = 100; $('#edBrightVal', ov).textContent = '100%';
        $('#visStrength', ov).value = 20; $('#visStrengthVal', ov).textContent = '20%';
        setMode('original'); draw();
      };

      const finish = v => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        closeOverlay(ov); resolve(v);
      };
      $('#edImgCancel', ov).onclick = () => finish(null);
      $('#edImgOk', ov).onclick = async () => {
        if (!img) return;
        if (busy) { toast('还在处理中，请稍候', 'err'); return; }
        let crop = null;
        if (sel && sel.w > 6 && sel.h > 6) {
          const s = imgRect.scale;
          crop = {
            x: (sel.x - imgRect.x) / s,
            y: (sel.y - imgRect.y) / s,
            w: sel.w / s,
            h: sel.h / s
          };
          crop.x = Math.max(0, crop.x); crop.y = Math.max(0, crop.y);
          crop.w = Math.min(crop.w, img.naturalWidth - crop.x);
          crop.h = Math.min(crop.h, img.naturalHeight - crop.y);
        }
        try {
          const cleaned = previewMode !== 'original' ? cleanCache[previewMode] : null;
          const src = cleaned ? cleaned.dataUrl : workDataUrl;
          const v = await U.makeVariants(src, {
            crop: crop,
            brightness: cleaned ? 1 : brightness,
            lossless: !!cleaned
          });
          if (cleaned) { v.cleaned = true; v.cleanMode = previewMode; }
          finish(v);
        } catch (e) { toast('图片处理失败', 'err'); finish(null); }
      };
      $('.overlay-mask', ov).onclick = () => finish(null);
    });
  }

  /* ---------------------------------------------------------
     STATS
     --------------------------------------------------------- */
  function renderStats() {
    const qs = state.questions;
    const total = qs.length;
    const mastered = qs.filter(q => q.mastery === 'mastered').length;
    const unmastered = qs.filter(q => q.mastery === 'unmastered').length;
    const weekStart = startOfWeek(Date.now());
    const weekNew = qs.filter(q => q.createdAt >= weekStart).length;

    if (!total) {
      $('#statsBody').innerHTML = '<div class="empty"><div class="empty-orb">' + icon('chart') + '</div>' +
        '<h3>还没有可统计的数据</h3><p>录入几道错题后，这里会显示科目分布、错因占比和近期趋势。</p>' +
        '<button class="btn btn-primary btn-sm mt8" data-act="first-add">' + icon('plus') + '录入错题</button></div>';
      return;
    }

    const stat = (n, l, ic, glow) =>
      '<div class="stat-card"><div class="stat-num" style="--glow:' + glow + '">' + n + '</div>' +
      '<div class="stat-lbl">' + icon(ic) + esc(l) + '</div></div>';

    /* by subject */
    const bySubject = {};
    qs.forEach(q => { const k = q.subject || '未分类'; bySubject[k] = (bySubject[k] || 0) + 1; });
    const subjArr = Object.entries(bySubject).sort((a, b) => b[1] - a[1]);
    const maxSubj = subjArr[0][1];
    const bars = subjArr.map(([k, v]) =>
      '<div class="bar-row"><span class="bar-name">' + esc(k) + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="width:' + (v / maxSubj * 100) + '%"></span></span>' +
      '<span class="bar-val">' + v + '</span></div>').join('');

    /* by cause — donut */
    const byCause = {};
    qs.forEach(q => { const k = q.cause || '未填写'; byCause[k] = (byCause[k] || 0) + 1; });
    const causeArr = Object.entries(byCause).sort((a, b) => b[1] - a[1]);
    const C = 2 * Math.PI * 46;
    let acc = 0;
    const segs = causeArr.map(([k, v], i) => {
      const len = v / total * C;
      const color = CAUSE_COLORS[i % CAUSE_COLORS.length];
      const s = '<circle cx="60" cy="60" r="46" fill="none" stroke="' + color + '" stroke-width="16" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '"/>';
      acc += len;
      return { s, k, v, color };
    });
    const donut = '<div class="donut"><svg viewBox="0 0 120 120" width="132" height="132">' +
      '<circle cx="60" cy="60" r="46" fill="none" stroke="var(--track)" stroke-width="16"/>' +
      segs.map(x => x.s).join('') + '</svg>' +
      '<div class="donut-center"><b>' + total + '</b><span>道错题</span></div></div>';
    const legend = '<div class="legend">' + segs.map(x =>
      '<div class="legend-row"><span class="legend-dot" style="background:' + x.color + '"></span>' +
      '<span class="n">' + esc(x.k) + '</span><span class="v">' + Math.round(x.v / total * 100) + '%</span></div>').join('') + '</div>';

    /* weekly trend — last 8 weeks */
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const w = startOfWeek(Date.now() - i * 7 * 86400000);
      weeks.push({ w, n: 0, label: weekShort(w) });
    }
    qs.forEach(q => {
      const w = startOfWeek(q.createdAt);
      const hit = weeks.find(x => x.w === w);
      if (hit) hit.n++;
    });
    const maxW = Math.max(1, ...weeks.map(w => w.n));
    const trend = '<div class="trend-bars">' + weeks.map((w, i) =>
      '<div class="trend-col"><span class="trend-val">' + (w.n || '') + '</span>' +
      '<span class="trend-bar" style="height:' + Math.max(3, w.n / maxW * 84) + 'px;animation-delay:' + (i * 55) + 'ms"></span>' +
      '<span class="trend-lbl">' + w.label + '</span></div>').join('') + '</div>';

    $('#statsBody').innerHTML =
      '<div class="stat-grid">' +
      stat(total, '错题总数', 'book', 'rgba(141,125,255,.30)') +
      stat(mastered, '已掌握', 'check-circle', 'rgba(79,223,166,.28)') +
      stat(unmastered, '未掌握', 'circle', 'rgba(255,138,166,.28)') +
      stat(weekNew, '本周新增', 'trend', 'rgba(90,169,255,.30)') +
      '</div>' +
      '<div class="chart-card"><div class="chart-title">' + icon('chart') + '分科目分布<small>共 ' + subjArr.length + ' 个科目</small></div>' + bars + '</div>' +
      '<div class="chart-card"><div class="chart-title">' + icon('pie') + '错因分布<small>看看主要失分点</small></div>' +
      '<div class="donut-wrap">' + donut + legend + '</div></div>' +
      '<div class="chart-card"><div class="chart-title">' + icon('trend') + '近 8 周新增趋势<small>按录入时间统计</small></div>' + trend + '</div>' +
      '<div class="about-card" style="margin-top:4px">' + icon('shield') +
      '<p class="mt8">全部统计在本机完成，不上传任何数据。</p></div>';
  }

  /* ---------------------------------------------------------
     MANAGE
     --------------------------------------------------------- */
  const CFG_META = {
    subjects: { title: '科目管理', icon: 'book', hint: '删除科目时可迁移或一并删除错题' },
    qtypes: { title: '题型', icon: 'grid', hint: '单选、多选、填空…录入页直接读取' },
    causes: { title: '错因模板', icon: 'info', hint: '录入页点选，减少手打' },
    tags: { title: '标签', icon: 'tag', hint: '删除标签只解除关联，不影响错题' }
  };

  function renderManage() {
    const cfg = state.config;
    let html = '';
    Object.keys(CFG_META).forEach(k => {
      const meta = CFG_META[k];
      // Subject filter bar above the tag list (需求1: 按科目筛选标签)
      let subjectBar = '';
      if (k === 'tags') {
        const subs = cfg.subjects || [];
        const chips = subs.map(s => '<button class="tag-subject-chip' + (state.manageTagSubject === s ? ' on' : '') +
          '" data-act="tag-subject" data-v="' + esc(s) + '">' + esc(s) + '</button>').join('');
        subjectBar = '<div class="tag-subject-bar">' +
          '<button class="tag-subject-chip' + (!state.manageTagSubject ? ' on' : '') + '" data-act="tag-subject" data-v="">全部科目</button>' +
          chips + '</div>';
      }
      // Determine which items to show. For tags with a subject selected, only tags
      // actually used by questions of that subject are visible (others hidden).
      let entries = cfg[k].map((v, i) => ({ v, i }));
      if (k === 'tags' && state.manageTagSubject) {
        const used = new Set();
        state.questions.forEach(q => {
          if (q.subject === state.manageTagSubject) (q.tags || []).forEach(t => used.add(t));
        });
        entries = entries.filter(e => used.has(e.v));
      }
      const FILTER_KEY = { subjects: 'subject', qtypes: 'qtype', causes: 'cause', tags: 'tags' };
      const rows = entries.map(({ v, i }) => {
        const used = k === 'subjects' ? state.questions.filter(q => q.subject === v).length
          : k === 'qtypes' ? state.questions.filter(q => q.qtype === v).length
            : k === 'causes' ? state.questions.filter(q => q.cause === v).length
              : state.questions.filter(q => (q.tags || []).includes(v)).length;
        return '<div class="grow">' +
          '<div class="grow-ic">' + icon(meta.icon) + '</div>' +
          '<div class="grow-main mgr-filter" data-act="mgr-filter" data-fk="' + FILTER_KEY[k] + '" data-fv="' + esc(v) + '" title="点此查看该' + meta.title.replace('管理', '') + '的错题">' +
          '<div class="grow-title">' + esc(v) + '</div>' +
          '<div class="grow-sub">' + used + ' 道错题 · 点击查看</div></div>' +
          '<div class="grow-acts">' +
          '<button data-act="cfg-edit" data-k="' + k + '" data-i="' + i + '" title="重命名">' + icon('edit') + '</button>' +
          '<button class="del" data-act="cfg-del" data-k="' + k + '" data-i="' + i + '" title="删除">' + icon('trash') + '</button>' +
          '</div></div>';
      }).join('');
      const hiddenNote = (k === 'tags' && state.manageTagSubject)
        ? '<div class="tiny mt8" style="padding:0 4px">当前仅显示「' + esc(state.manageTagSubject) + '」科目错题用到的标签，点「全部科目」恢复。</div>' : '';
      const collapsed = !!state.manageCollapsed[k];
      html += '<div class="group' + (collapsed ? ' collapsed' : '') + '" data-gk="' + k + '">' +
        '<div class="group-head">' +
        '<button class="collapse-toggle" data-act="toggle-collapse" data-k="' + k + '" aria-label="展开/收起">' + icon('chev-right') + '</button>' +
        icon(meta.icon) + '<h3>' + meta.title + '</h3>' +
        '<span class="cnt">' + (k === 'tags' && state.manageTagSubject ? entries.length + '/' + cfg[k].length : cfg[k].length) + '</span>' +
        '<button class="add" data-act="cfg-add" data-k="' + k + '">' + icon('plus') + ' 新增</button></div>' +
        '<div class="group-body">' +
        subjectBar +
        '<div class="glist">' + (rows || '<div class="grow"><div class="grow-main"><div class="grow-sub">' +
          (k === 'tags' && state.manageTagSubject ? '该科目暂无错题使用任何标签' : '暂无项目，点「新增」添加') + '</div></div></div>') + '</div>' +
        (hiddenNote || '<div class="tiny mt8" style="padding:0 4px">' + meta.hint + '</div>') +
        '</div></div>';
    });

    // 科目字段显示：为不同科目控制录入/详情中显示哪些字段（图片替代题干等场景）
    const subs = cfg.subjects || [];
    if (subs.length) {
      if (!subs.includes(state.manageFieldSubject)) state.manageFieldSubject = subs[0];
      const subjChips = subs.map(s => '<button class="tag-subject-chip' + (state.manageFieldSubject === s ? ' on' : '') +
        '" data-act="field-subject" data-v="' + esc(s) + '">' + esc(s) + '</button>').join('');
      const cur = state.manageFieldSubject;
      const fieldRows = HIDDEN_FIELD_META.map(f =>
        '<div class="grow field-vis-row"><div class="grow-main"><div class="grow-title">' + esc(f.label) + '</div>' +
        '<div class="grow-sub">' + (fieldHidden(cur, f.key) ? '已隐藏 · 录入与详情均不显示' : '正常显示') + '</div></div>' +
        '<div class="grow-acts"><div class="switch ' + (fieldHidden(cur, f.key) ? 'on' : '') +
        '" data-act="toggle-field" data-f="' + f.key + '"><i></i></div></div></div>').join('');
      const fieldCollapsed = !!state.manageCollapsed.fields;
      html += '<div class="group field-vis-group' + (fieldCollapsed ? ' collapsed' : '') + '" data-gk="fields">' +
        '<div class="group-head">' +
        '<button class="collapse-toggle" data-act="toggle-collapse" data-k="fields" aria-label="展开/收起">' + icon('chev-right') + '</button>' +
        icon('eye') + '<h3>科目字段显示</h3></div>' +
        '<div class="group-body">' +
        '<div class="tiny" style="padding:0 4px 8px">选择科目后，可隐藏该科目录入页与详情页的字段（数据仍保留）。适合用图片替代题干的题目。</div>' +
        '<div class="tag-subject-bar">' + subjChips + '</div>' +
        '<div class="glist">' + fieldRows + '</div>' +
        '</div></div>';
    }

    $('#manageBody').innerHTML = html;
  }

  async function cfgAdd(k) {
    const v = await promptDialog({ title: '新增' + (k === 'subjects' ? '科目' : k === 'qtypes' ? '题型' : k === 'causes' ? '错因' : '标签'), placeholder: '输入名称' });
    if (!v) return;
    if (state.config[k].includes(v)) { toast('已存在同名项目', 'err'); return; }
    state.config[k].push(v);
    await DB.putConfig(state.config);
    renderManage(); toast('已新增「' + v + '」');
  }

  async function cfgEdit(k, i) {
    const old = state.config[k][i];
    const v = await promptDialog({ title: '重命名', value: old, placeholder: '输入新名称' });
    if (!v || v === old) return;
    if (state.config[k].includes(v)) { toast('已存在同名项目', 'err'); return; }
    state.config[k][i] = v;
    // migrate references on questions
    const field = k === 'subjects' ? 'subject' : k === 'qtypes' ? 'qtype' : k === 'causes' ? 'cause' : null;
    const changed = [];
    if (field) {
      state.questions.forEach(q => {
        if (q[field] === old) { q[field] = v; q.updatedAt = Date.now(); changed.push(q); }
      });
    } else {
      state.questions.forEach(q => {
        if ((q.tags || []).includes(old)) {
          q.tags = q.tags.map(t => t === old ? v : t);
          q.updatedAt = Date.now(); changed.push(q);
        }
      });
    }
    await DB.putConfig(state.config);
    for (const q of changed) await DB.putQuestion(q);
    await refresh(); renderManage(); renderHome();
    toast('已重命名' + (changed.length ? '，同步更新 ' + changed.length + ' 道错题' : ''));
  }

  async function cfgDelete(k, i) {
    const v = state.config[k][i];
    const field = k === 'subjects' ? 'subject' : k === 'qtypes' ? 'qtype' : k === 'causes' ? 'cause' : null;
    const affected = field ? state.questions.filter(q => q[field] === v) : state.questions.filter(q => (q.tags || []).includes(v));

    if (k === 'subjects' && affected.length) {
      const others = state.config.subjects.filter(x => x !== v);
      const choice = await optionDialog({
        title: '删除科目「' + v + '」',
        desc: '该科目下有 ' + affected.length + ' 道错题，请选择处理方式，避免出现无归属数据。',
        cancelText: '取消',
        options: (others.length ? [{ icon: 'layers', title: '迁移到另一科目', desc: '把错题移到指定科目后删除本科目', value: 'migrate' }] : [])
          .concat([{ icon: 'trash', title: '连同错题一并删除', desc: '同时移除这些错题及其图片', value: 'delete', danger: true }])
      });
      if (!choice) return;
      let target = null;
      if (choice === 'migrate') {
        target = await optionDialog({
          title: '迁移到哪个科目？', cancelText: '取消',
          options: others.map(x => ({ icon: 'book', title: x, value: x }))
        });
        if (!target) return;
      }
      for (const q of affected) {
        if (choice === 'migrate') { q.subject = target; q.updatedAt = Date.now(); await DB.putQuestion(q); }
        else await DB.deleteQuestionBundle(q.id);
      }
      state.config.subjects.splice(i, 1);
      await DB.putConfig(state.config);
      await refresh(); renderManage(); renderHome();
      toast(choice === 'migrate' ? '已迁移到「' + target + '」并删除科目' : '已删除科目及 ' + affected.length + ' 道错题');
      return;
    }

    const ok = await confirmDialog({
      title: '删除「' + v + '」？',
      desc: k === 'tags'
        ? '只会解除该标签与错题的关联，错题本身保留。'
        : '仅删除这个配置项，已录入错题中的原值会保留。',
      confirmText: '删除', danger: true
    });
    if (!ok) return;
    if (k === 'tags') {
      const changed = state.questions.filter(q => (q.tags || []).includes(v));
      for (const q of changed) { q.tags = q.tags.filter(t => t !== v); q.updatedAt = Date.now(); await DB.putQuestion(q); }
    }
    state.config[k].splice(i, 1);
    await DB.putConfig(state.config);
    await refresh(); renderManage(); renderHome();
    toast('已删除「' + v + '」');
  }

  /* ---------------------------------------------------------
     DOCS LIBRARY (PDF + local HTML) + VIEWERS
     --------------------------------------------------------- */
  function doPromptPdfImport() {
    const inp = $('#pdfFileInput');
    if (!inp) { toast('PDF 导入不可用', 'err'); return; }
    inp.dataset.context = 'fab';
    inp.value = '';
    inp.click();
  }

  function doPromptHtmlImport() {
    const inp = $('#htmlFileInput');
    if (!inp) { toast('HTML 打开不可用', 'err'); return; }
    inp.value = '';
    inp.click();
  }

  function doPromptTxtImport() {
    const inp = $('#txtFileInput');
    if (!inp) { toast('TXT 导入不可用', 'err'); return; }
    if (!globalNovel()) { toast('小说阅读器尚未加载', 'err'); return; }
    inp.value = '';
    inp.click();
  }

  // Novel module loads after app.js, so resolve lazily at call time.
  function globalNovel() { return (typeof Novel !== 'undefined') ? Novel : (window.Novel || null); }

  async function doImportPdf(file) {
    if (!file) return;
    try {
      toast('正在导入 PDF…', 'info');
      const rec = await Pdf.importFile(file);
      toast('已导入 PDF「' + rec.name + '」', 'ok');
      if (state.view === 'pdf') renderPdfView();
      else {
        const sheet = document.querySelector('#overlayRoot .pdf-sheet');
        if (sheet) { const stale = sheet.closest('.overlay'); if (stale) stale.remove(); openPdfLibrary(); }
      }
    } catch (e) {
      toast('导入失败：' + (e.message || '未知错误'), 'err');
    }
  }

  async function doImportHtml(file) {
    if (!file) return;
    try {
      toast('正在打开本地 HTML…', 'info');
      const rec = await Pdf.importHtml(file);
      toast('已加入资料库「' + rec.name + '」', 'ok');
      if (state.view === 'pdf') renderPdfView();
    } catch (e) {
      toast('打开失败：' + (e.message || '未知错误'), 'err');
    }
  }

  async function doImportTxt(file) {
    if (!file) return;
    const NV = globalNovel();
    if (!NV) { toast('小说阅读器尚未加载', 'err'); return; }
    try {
      toast('正在导入小说…', 'info');
      const rec = await NV.importTxt(file);
      toast('已加入书架「' + rec.name + '」', 'ok');
      switchDocTab('novels');
    } catch (e) {
      toast('导入失败：' + (e.message || '未知错误'), 'err');
    }
  }

  function openPdfLibrary() {
    // Kept as an alias: the library is now the "资料" tab view rather than an overlay.
    setView('pdf');
  }

  function switchDocTab(tab) {
    state.docTab = tab === 'novels' ? 'novels' : 'docs';
    $$('.doc-tabs button').forEach(b => b.classList.toggle('on', b.dataset.doctab === state.docTab));
    const docsBody = $('#pdfViewBody'), novelBody = $('#novelViewBody');
    if (docsBody) docsBody.hidden = state.docTab !== 'docs';
    if (novelBody) novelBody.hidden = state.docTab !== 'novels';
    renderPdfView();
  }

  async function renderPdfView() {
    // Docs and novels share one "资料" view; only render the active tab's list.
    if (state.docTab === 'novels') { await renderNovelView(); return; }
    const host = $('#pdfViewBody');
    if (!host) return;
    const all = (await DB.getAllPdfs()).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const docs = all.filter(p => p.kind !== 'txt');
    if (!docs.length) {
      host.innerHTML = '<div class="pdf-empty">' + icon('pdf') + '<p>还没有资料</p>' +
        '<span>点首页「＋」→「导入资料」添加 PDF 或本地 HTML，随时离线查看。</span></div>';
      return;
    }
    host.innerHTML = '<div class="pdf-list">' + docs.map(p => {
      const isHtml = p.kind === 'html';
      return '<div class="pdf-row" data-id="' + p.id + '" data-kind="' + (isHtml ? 'html' : 'pdf') + '">' +
        '<div class="pdf-ic' + (isHtml ? ' html' : '') + '">' + icon(isHtml ? 'note' : 'pdf') + '</div>' +
        '<div class="pdf-meta"><div class="pdf-name">' + esc(p.name) + '</div>' +
        '<div class="pdf-sub">' + (isHtml ? 'HTML 文档' : 'PDF 文档') + ' · ' + formatBytes(p.size || 0) + ' · ' + fmtDate(p.createdAt) + '</div></div>' +
        '<button class="mini-act danger" data-act="pdf-del" data-id="' + p.id + '" title="删除">' + icon('trash') + '</button>' +
        '<span class="icon chev">' + icon('chev-right') + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  async function renderNovelView() {
    const host = $('#novelViewBody');
    if (!host) return;
    const NV = globalNovel();
    let novels = [];
    if (NV && typeof NV.listNovels === 'function') {
      try { novels = await NV.listNovels(); } catch (e) { novels = []; }
    }
    const importBar = '<div class="novel-import-bar"><button class="btn btn-primary" id="btnNovelImport">' + icon('plus') + ' 导入 TXT 小说</button>' +
      '<div class="tiny">支持 .txt 文本，自动分章，像小说一样离线阅读</div></div>';
    if (!novels.length) {
      host.innerHTML = importBar + '<div class="pdf-empty">' + icon('book') + '<p>书架还空着</p>' +
        '<span>点上方按钮导入 TXT 小说，自动识别章节，享受番茄小说式的阅读体验。</span></div>';
      return;
    }
    host.innerHTML = importBar + '<div class="pdf-list">' + novels.map(n => {
      const prog = n.progress || {};
      const total = (n.chapters && n.chapters.length) || 1;
      const ch = (prog.chapter || 0) + 1;
      const pct = Math.min(100, Math.round((ch / total) * 100));
      return '<div class="pdf-row novel-row" data-id="' + n.id + '" data-kind="novel">' +
        '<div class="pdf-ic novel">' + icon('book') + '</div>' +
        '<div class="pdf-meta"><div class="pdf-name">' + esc(n.name) + '</div>' +
        '<div class="pdf-sub">' + total + ' 章 · ' + formatBytes(n.size || 0) + ' · 读到第 ' + ch + ' 章（' + pct + '%）</div>' +
        '<div class="novel-progress"><i style="width:' + pct + '%"></i></div></div>' +
        '<button class="mini-act danger" data-act="novel-del" data-id="' + n.id + '" title="删除">' + icon('trash') + '</button>' +
        '<span class="icon chev">' + icon('chev-right') + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  async function openHtmlViewer(id) {
    const rec = await DB.getPdf(id);
    if (!rec) { toast('资料不存在', 'err'); return; }
    const ov = overlay(
      '<div class="sheet-full html-viewer">' +
      '<div class="sheet-head"><button class="icon-btn" id="hvClose" aria-label="关闭">' + icon('arrow-left') + '</button>' +
      '<h2>' + esc(rec.name) + '</h2><span class="grow"></span></div>' +
      '<iframe id="hvFrame" class="html-frame" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals" referrerpolicy="no-referrer"></iframe>' +
      '</div>', 'bottom', true);
    const fr = $('#hvFrame', ov);
    // Reading position for HTML = { hash, pct }. Many real-world "handbook"
    // pages are hash-routed SPA apps: on load they show #/home (nothing to
    // scroll) and the actual reading content only appears after navigating to
    // a chapter (#/chapter/...). Tracking only a scroll % therefore always
    // restored 0. v1.0.6: save/restore BOTH the location.hash and the scroll
    // percentage — restore the hash first (which triggers the SPA to build the
    // chapter), then scroll once the content has height.
    const prog = (rec.progress && typeof rec.progress === 'object') ? rec.progress : {};
    const savedPct = typeof prog.pct === 'number' ? prog.pct : 0;
    const savedHash = typeof prog.hash === 'string' ? prog.hash : '';
    let latestPct = savedPct, latestHash = savedHash, saveT, restoreTimer, pollTimer;
    const flushHtmlProgress = () => {
      if (!rec.progress || typeof rec.progress !== 'object') rec.progress = {};
      rec.progress.pct = latestPct;
      rec.progress.hash = latestHash;
      DB.putPdf(rec);
    };
    // The iframe uses allow-same-origin, so we can read its DOM directly from
    // the parent. Doing detection/restore/tracking here (instead of an injected
    // postMessage bridge) is far more reliable for hash-routed SPA handbooks,
    // whose real scroller is often an inner overflow container, not the window.
    fr.srcdoc = String(rec.data || '');
    const maxScroll = (sc, w, d) => sc === w
      ? Math.max(0, Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0) - w.innerHeight)
      : Math.max(0, sc.scrollHeight - sc.clientHeight);
    const findScroller = (w, d) => {
      let best = null, bestAmt = 24;
      const all = d.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        let oy = '';
        try { oy = (w.getComputedStyle(el).overflowY) || ''; } catch (e) { continue; }
        if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
        const amt = el.scrollHeight - el.clientHeight;
        if (amt > bestAmt && el.clientHeight > 80) { best = el; bestAmt = amt; }
      }
      if (best) return best;
      if (Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0) - w.innerHeight > 24) return w;
      return null;
    };
    const posOf = (sc, w, d) => sc === w ? (w.pageYOffset || d.documentElement.scrollTop || 0) : sc.scrollTop;
    const setPos = (sc, w, p) => { try { if (sc === w) w.scrollTo(0, p); else sc.scrollTop = p; } catch (e) {} };

    // Restore: wait for the SPA to build content, jump to the saved hash chapter
    // first, then scroll to the saved percentage once the scroller has height.
    let restoreTries = 0, restoreDone = !savedHash;
    const tryRestore = () => {
      if (restoreDone || restoreTries > 90) return;
      restoreTries++;
      let w, d;
      try { w = fr.contentWindow; d = fr.contentDocument; } catch (e) { setTimeout(tryRestore, 120); return; }
      if (!w || !d) { setTimeout(tryRestore, 120); return; }
      // Hash-routed SPA: navigate to the saved chapter so its body is rendered.
      if (savedHash && w.location.hash !== savedHash) {
        try { w.location.hash = savedHash; } catch (e) {}
        setTimeout(tryRestore, 140); return;
      }
      const sc = findScroller(w, d);
      if (sc && maxScroll(sc, w, d) > 24) {
        setPos(sc, w, savedPct * maxScroll(sc, w, d));
        restoreDone = true;
      } else {
        setTimeout(tryRestore, 120);
      }
    };
    restoreTimer = setInterval(tryRestore, 140);

    // Track: poll the iframe DOM, persist {pct, hash} when either changes.
    // Skip until restore finished, so a transient #/home frame can't overwrite
    // the saved percentage with 0.
    const track = () => {
      if (!restoreDone) return;
      let w, d;
      try { w = fr.contentWindow; d = fr.contentDocument; } catch (e) { return; }
      if (!w || !d) return;
      const hash = w.location.hash || '';
      const sc = findScroller(w, d);
      const m = sc ? maxScroll(sc, w, d) : 0;
      const pct = (sc && m > 0) ? Math.min(1, Math.max(0, posOf(sc, w, d) / m)) : 0;
      if (hash !== latestHash || Math.abs(pct - latestPct) > 0.004) {
        latestHash = hash; latestPct = pct;
        clearTimeout(saveT); saveT = setTimeout(flushHtmlProgress, 300);
      }
    };
    pollTimer = setInterval(track, 600);

    const closeHtml = () => {
      clearInterval(restoreTimer); clearInterval(pollTimer);
      clearTimeout(saveT);
      flushHtmlProgress();
      closeOverlay(ov);
    };
    $('#hvClose', ov).onclick = closeHtml;
    $('.overlay-mask', ov).onclick = closeHtml;
  }

  async function openPdfViewer(id) {
    toast('正在打开 PDF…', 'info');
    let doc;
    try { doc = await Pdf.loadDoc(id); }
    catch (e) { toast('打开失败：' + (e.message || '未知错误'), 'err'); return; }
    const rec = await DB.getPdf(id);
    const total = doc.numPages;

    const ov = overlay(
      '<div class="sheet-full pdf-viewer">' +
      '<div class="sheet-head"><button class="icon-btn" id="pvClose" aria-label="关闭">' + icon('arrow-left') + '</button>' +
      '<h2>' + esc((rec && rec.name) || 'PDF 查看') + '</h2>' +
      '<button class="pdf-page-jump" id="pvPage" aria-label="跳转页面">1 / ' + total + '</button></div>' +
      '<div class="pdf-scroll" id="pvScroll"><div class="pdf-pages" id="pvPages"></div></div>' +
      '<div class="pdf-controls">' +
      '<button class="icon-btn" id="pvPrev" aria-label="上一页">' + icon('chev-left') + '</button>' +
      '<span class="pdf-hint">上下滑动翻页 · 双指缩放 · 点页码跳转</span>' +
      '<button class="icon-btn" id="pvNext" aria-label="下一页">' + icon('chev-right') + '</button>' +
      '</div></div>', 'bottom', true);

    const scroll = $('#pvScroll', ov);
    const pagesEl = $('#pvPages', ov);
    const label = $('#pvPage', ov);
    const sizes = [];           // intrinsic page size at scale 1, index 1..total
    const pageEls = [];         // wrapper div per page
    const rendered = new Map(); // page -> zoom level the canvas was rendered at
    const inFlight = new Set();
    let zoom = 1;
    let activePage = 1;
    let destroyed = false;

    // Build a placeholder wrapper for every page up-front so the scroll height
    // is correct; canvas bitmaps are filled lazily as pages approach the view.
    for (let p = 1; p <= total; p++) {
      let sz;
      try { sz = await Pdf.getPageSize(doc, p); }
      catch (e) { sz = { width: 595, height: 842 }; }
      sizes[p] = sz;
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.dataset.p = p;
      el.innerHTML = '<canvas></canvas>';
      pagesEl.appendChild(el);
      pageEls[p] = el;
    }

    function pageWidth() { return Math.max(120, scroll.clientWidth - 16); }

    function sizePage(p) {
      const sz = sizes[p], cw = pageWidth() * zoom;
      const el = pageEls[p];
      el.style.width = Math.round(cw) + 'px';
      el.style.height = Math.round(cw * sz.height / sz.width) + 'px';
    }

    async function renderPage(p, force) {
      if (destroyed || p < 1 || p > total || inFlight.has(p)) return;
      if (!force && rendered.get(p) === zoom) return;
      inFlight.add(p);
      try {
        sizePage(p);
        await Pdf.renderPage(doc, p, pageEls[p].querySelector('canvas'), pageWidth() * zoom / sizes[p].width);
        rendered.set(p, zoom);
      } catch (e) { /* keep the blank placeholder on failure */ }
      inFlight.delete(p);
    }

    // Render pages within one screen above / two below the viewport.
    function renderVisible() {
      const top = scroll.scrollTop, h = scroll.clientHeight;
      for (let p = 1; p <= total; p++) {
        const el = pageEls[p];
        if (!el) continue;
        const t = el.offsetTop, b = t + el.offsetHeight;
        if (b >= top - h && t <= top + 2 * h) renderPage(p);
      }
    }

    function updateActive() {
      const mark = scroll.scrollTop + Math.min(120, scroll.clientHeight * 0.3);
      let cur = 1;
      for (let p = 1; p <= total; p++) {
        if (pageEls[p] && pageEls[p].offsetTop <= mark) cur = p; else break;
      }
      if (cur !== activePage) { activePage = cur; label.textContent = cur + ' / ' + total; }
    }

    function gotoPage(p, smooth) {
      p = Math.max(1, Math.min(total, p));
      const y = Math.max(0, pageEls[p].offsetTop - 8);
      if (smooth && scroll.scrollTo) scroll.scrollTo({ top: y, behavior: 'smooth' });
      else scroll.scrollTop = y;
      activePage = p; label.textContent = p + ' / ' + total;
      renderVisible();
    }

    for (let p = 1; p <= total; p++) sizePage(p);
    renderVisible();

    let scrollT;
    scroll.addEventListener('scroll', () => {
      clearTimeout(scrollT);
      scrollT = setTimeout(() => { if (!destroyed) { updateActive(); renderVisible(); } }, 50);
    }, { passive: true });

    // Change zoom, keep the reading position proportionally, then re-render.
    function applyZoom(z) {
      z = Math.max(1, Math.min(4, z));
      if (Math.abs(z - zoom) < 0.001) return;
      const ratio = scroll.scrollHeight ? scroll.scrollTop / scroll.scrollHeight : 0;
      zoom = z;
      pagesEl.dataset.zoom = String(zoom);
      for (let p = 1; p <= total; p++) sizePage(p);
      scroll.scrollTop = Math.round(ratio * scroll.scrollHeight);
      renderVisible(); updateActive();
    }

    // Restore last reading position (v1.0.6): prefer saved page, else ratio.
    if (rec && rec.progress && typeof rec.progress === 'object') {
      const savedPage = rec.progress.page;
      const savedRatio = rec.progress.ratio;
      requestAnimationFrame(() => {
        if (destroyed) return;
        if (savedPage >= 1 && savedPage <= total) gotoPage(savedPage);
        else if (typeof savedRatio === 'number' && scroll.scrollHeight) scroll.scrollTop = Math.round(savedRatio * scroll.scrollHeight);
        updateActive(); renderVisible();
      });
    }

    const close = () => {
      destroyed = true;
      if (rec) {
        try {
          if (!rec.progress || typeof rec.progress !== 'object') rec.progress = {};
          rec.progress.page = activePage;
          rec.progress.ratio = scroll.scrollHeight ? scroll.scrollTop / scroll.scrollHeight : 0;
          DB.putPdf(rec);
        } catch (e) { }
      }
      window.removeEventListener('resize', onResize);
      closeOverlay(ov);
      try { doc.destroy(); } catch (e) { }
    };
    $('#pvClose', ov).onclick = close;
    $('.overlay-mask', ov).onclick = close;
    $('#pvPrev', ov).onclick = () => gotoPage(activePage - 1, true);
    $('#pvNext', ov).onclick = () => gotoPage(activePage + 1, true);
    label.onclick = async () => {
      const v = await promptDialog({ title: '跳转页面', desc: '共 ' + total + ' 页', placeholder: '1 - ' + total, value: String(activePage) });
      if (v == null) return;
      const n = parseInt(v, 10);
      if (!isNaN(n)) gotoPage(n, true);
    };

    // --- two-finger pinch to zoom (single finger scrolls the page stack) ---
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let pinchDist = 0, pinchZoom0 = 1, pinchFactor = 1, suppressTapUntil = 0;
    scroll.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        pinchDist = dist(e.touches); pinchZoom0 = zoom; pinchFactor = 1;
        pagesEl.style.transformOrigin = 'top center';
      }
    }, { passive: true });
    scroll.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && pinchDist) {
        e.preventDefault();
        const target = Math.max(1, Math.min(4, pinchZoom0 * dist(e.touches) / pinchDist));
        pinchFactor = target / zoom;
        pagesEl.style.transform = Math.abs(pinchFactor - 1) < 0.002 ? '' : 'scale(' + pinchFactor + ')';
      }
    }, { passive: false });
    const endPinch = () => {
      if (!pinchDist) return;
      pinchDist = 0; pagesEl.style.transform = '';
      suppressTapUntil = Date.now() + 400;
      if (!destroyed) applyZoom(zoom * pinchFactor);
    };
    scroll.addEventListener('touchend', e => { if (e.touches.length < 2) endPinch(); }, { passive: true });
    scroll.addEventListener('touchcancel', () => { pinchDist = 0; pagesEl.style.transform = ''; }, { passive: true });

    // --- double tap toggles 1x / 2x ---
    let lastTap = 0;
    scroll.addEventListener('touchend', e => {
      if (e.touches.length || !e.changedTouches.length || Date.now() < suppressTapUntil) return;
      const now = Date.now();
      if (now - lastTap < 320) applyZoom(zoom > 1.05 ? 1 : 2);
      lastTap = now;
    }, { passive: true });

    // --- desktop: ctrl/cmd + wheel to zoom ---
    scroll.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      applyZoom(zoom + (e.deltaY < 0 ? 0.2 : -0.2));
    }, { passive: false });

    // --- re-fit on orientation / resize (debounced) ---
    let rzT;
    const onResize = () => {
      clearTimeout(rzT);
      rzT = setTimeout(() => {
        if (destroyed) return;
        for (let p = 1; p <= total; p++) sizePage(p);
        rendered.clear(); renderVisible();
      }, 200);
    };
    window.addEventListener('resize', onResize);

    ov.dataset.pdfViewer = '1';
  }

  /* ---------------------------------------------------------
     SETTINGS + BACKUP
     --------------------------------------------------------- */
  async function renderSettings() {
    const cfg = state.config;
    const size = await DB.estimateSize();
    const row = (ic, title, sub, right) =>
      '<div class="grow"><div class="grow-ic">' + icon(ic) + '</div>' +
      '<div class="grow-main"><div class="grow-title">' + esc(title) + '</div>' +
      (sub ? '<div class="grow-sub">' + esc(sub) + '</div>' : '') + '</div>' + (right || '') + '</div>';
    const arrow = '<span class="icon chev">' + icon('chev-right').replace('class="icon "', 'class="icon"') + '</span>';

    $('#settingsBody').innerHTML =
      '<div class="group"><div class="group-head">' + icon('sun') + '<h3>外观</h3></div>' +
      '<div class="glist">' +
      '<div class="grow"><div class="grow-ic">' + icon('moon') + '</div><div class="grow-main"><div class="grow-title">深色 / 浅色模式</div>' +
      '<div class="grow-sub">液态玻璃会随主题改变折射与高光</div></div>' +
      '<div class="segmented" style="width:150px;flex:none">' +
      '<button data-act="set-theme" data-v="dark" class="' + (cfg.theme === 'dark' ? 'on' : '') + '">深色</button>' +
      '<button data-act="set-theme" data-v="light" class="' + (cfg.theme === 'light' ? 'on' : '') + '">浅色</button>' +
      '</div></div>' +
      row('eye', '默认隐藏已掌握', '让已掌握的题目不再出现在列表', '<div class="switch ' + (cfg.hideMastered ? 'on' : '') + '" data-act="toggle-hide"><i></i></div>') +
      '</div></div>' +

      '<div class="group"><div class="group-head">' + icon('db') + '<h3>数据备份</h3></div>' +
      '<div class="glist">' +
      row('download', '导出备份包', '错题 + 图片打包为 ZIP，可拷到电脑留存', '<button class="btn btn-ghost btn-sm" data-act="export">导出</button>') +
      row('upload', '导入恢复', '选择备份包，覆盖或合并（重复以较新修改时间为准）', '<button class="btn btn-ghost btn-sm" data-act="import">导入</button>') +
      row('broom', '清理残留图片', '只删除未被任何错题引用的图片', '<button class="btn btn-ghost btn-sm" data-act="cleanup">清理</button>') +
      row('db', '数据占用空间', size.questions + ' 道错题 · ' + size.images + ' 张图片' + (size.pdfs ? ' · ' + size.pdfs + ' 份资料' : ''), '<span class="grow-val">' + formatBytes(size.bytes) + '</span>') +
      row('layers', '备份目录（原生端）', cfg.backupDir || 'Download/Noteee备份', '<button class="btn btn-ghost btn-sm" data-act="choose-dir">修改</button>') +
      row('trash', '导入后删除 ZIP', '批量导入成功后自动删除来源 ZIP 文件（仅原生端生效）', '<div class="switch ' + (cfg.autoDeleteZip ? 'on' : '') + '" data-act="toggle-autodel"><i></i></div>') +
      '</div>' +
      '<input type="file" id="importFile" accept=".zip,application/zip" hidden>' +
      '</div>' +

      '<div class="group"><div class="group-head">' + icon('info') + '<h3>关于</h3></div>' +
      '<div class="about-card"><div class="about-logo">' + icon('book') + '</div>' +
      '<h3>Noteee</h3><p>个人自用版 · v1.0.6 · chen5<br>' +
      '不联网、不登录、不收集任何信息<br>所有数据只保存在本机与你选择的备份目录</p></div></div>' +

      '<div class="group"><div class="group-head">' + icon('settings') + '<h3>其他</h3></div>' +
      '<div class="glist">' +
      row('sparkles', '载入示例数据', '插入 6 道演示错题，用于快速体验', '<button class="btn btn-ghost btn-sm" data-act="seed-demo">载入</button>') +
      row('trash', '清空全部数据', '删除所有错题、图片与自定义配置', '<button class="btn btn-ghost btn-sm" data-act="clear-all" style="color:var(--bad)">清空</button>') +
      '</div></div>';
  }

  async function exportBackup() {
    try {
      toast('正在打包备份…', 'info');
      const [qs, imgs, cfg] = await Promise.all([DB.getAllQuestions(), DB.getAllImages(), DB.getConfig()]);
      const now = Date.now();
      const manifest = {
        app: 'Noteee', format: 'cuotiben-backup', schema: DB.SCHEMA, dbVersion: 1,
        exportedAt: now, exportedAtText: fmtDateTime(now),
        counts: { questions: qs.length, images: imgs.length }
      };
      const data = { schema: DB.SCHEMA, questions: qs, config: cfg };
      const files = [
        { name: 'manifest.json', data: Zip.jsonBytes(manifest) },
        { name: 'data.json', data: Zip.jsonBytes(data) }
      ];
      imgs.forEach(im => {
        const f = U.dataURLToBytes(im.full);
        const t = im.thumb ? U.dataURLToBytes(im.thumb) : null;
        files.push({ name: 'images/' + im.id + '.' + f.ext, data: f.bytes });
        if (t) files.push({ name: 'images/' + im.id + '_thumb.' + t.ext, data: t.bytes });
      });
      const blob = Zip.createZip(files);
      const d = new Date(now);
      const name = 'Noteee备份_' + d.getFullYear() + U.pad(d.getMonth() + 1) + U.pad(d.getDate()) + '_' + U.pad(d.getHours()) + U.pad(d.getMinutes()) + '.zip';

      // On desktop Chromium, write into a user-chosen directory when available.
      if (state.dirHandle && state.dirHandle.createWritable) {
        try {
          const fh = await state.dirHandle.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(blob); await w.close();
          toast('备份已保存到所选目录：' + name);
          return;
        } catch (e) { /* fall back to download */ }
      }
      U.downloadBlob(blob, name);
      toast('备份已导出：' + qs.length + ' 道错题 / ' + imgs.length + ' 张图片');
    } catch (e) {
      console.error(e); toast('导出失败：' + e.message, 'err');
    }
  }

  async function importBackup(file) {
    try {
      const entries = await Zip.readZip(await file.arrayBuffer());
      const byName = new Map(entries.map(e => [e.name, e]));
      const mf = byName.get('manifest.json');
      const df = byName.get('data.json');
      if (!df) throw new Error('备份包缺少 data.json');
      const manifest = mf ? mf.json() : {};
      if (manifest.format && manifest.format !== 'cuotiben-backup') throw new Error('这不是 Noteee 备份包');
      const data = df.json();
      if (!Array.isArray(data.questions)) throw new Error('备份数据格式不正确');

      const images = [];
      const thumbs = new Map();
      for (const e of entries) {
        if (!e.name.startsWith('images/')) continue;
        const m = e.name.match(/^images\/(.+?)(_thumb)?\.([a-z]+)$/i);
        if (!m) continue;
        const id = m[1], isThumb = !!m[2];
        const mime = 'image/' + (m[3] === 'jpg' ? 'jpeg' : m[3]);
        const url = U.bytesToDataURL(e.data, mime);
        if (isThumb) thumbs.set(id, url); else images.push({ id, full: url });
      }
      images.forEach(im => {
        im.thumb = thumbs.get(im.id) || im.full;
        im.createdAt = manifest.exportedAt || Date.now();
      });

      const mode = await optionDialog({
        title: '导入方式', desc: '备份包含 ' + data.questions.length + ' 道错题、' + images.length + ' 张图片。',
        cancelText: '取消',
        options: [
          { icon: 'upload', title: '合并到现有数据', desc: '重复条目以较新的修改时间为准', value: 'merge' },
          { icon: 'refresh', title: '覆盖当前数据', desc: '清空本机现有错题后完整恢复', value: 'replace', danger: true }
        ]
      });
      if (!mode) return;
      if (mode === 'replace') {
        const ok = await confirmDialog({ title: '确认覆盖？', desc: '本机现有的全部错题与图片会被替换，此操作不可撤销。', confirmText: '覆盖', danger: true });
        if (!ok) return;
        await DB.replaceAll(data.questions, images, data.config || null);
      } else {
        await DB.mergeAll(data.questions, images, data.config || null);
      }
      state.config = await DB.getConfig();
      applyTheme(state.config.theme);
      await refresh();
      renderHome(); renderSettings();
      toast('导入完成，共 ' + state.questions.length + ' 道错题');
    } catch (e) {
      console.error(e); toast('导入失败：' + e.message, 'err');
    }
  }

  /* ---------------------------------------------------------
     BATCH IMPORT — JSON / CSV / JSONL, format v1
     --------------------------------------------------------- */
  function batchIndex() {
    const byExt = new Map(), byFp = new Map();
    (state.questions || []).forEach(q => {
      if (q.externalId && !byExt.has(q.externalId)) byExt.set(q.externalId, q);
      const fp = q.fp || (window.Batch && Batch.fingerprint ? Batch.fingerprint(q) : '');
      if (fp && !byFp.has(fp)) byFp.set(fp, q);
    });
    return { byExt: byExt, byFp: byFp };
  }

  /* Decide create / skip / update for every parsed item.
     externalId wins; stem+subject fingerprint is the fallback for files
     generated without an id. Duplicates inside the same file are skipped. */
  function batchPlan(items, mode) {
    const idx = batchIndex();
    const seenExt = new Set(), seenFp = new Set();
    const rows = [];
    items.forEach(item => {
      let existing = null, dupInFile = false;
      if (mode !== 'duplicate') {
        if (item.externalId && idx.byExt.has(item.externalId)) existing = idx.byExt.get(item.externalId);
        else if (item.fp && idx.byFp.has(item.fp)) existing = idx.byFp.get(item.fp);
        else if ((item.externalId && seenExt.has(item.externalId)) || (item.fp && seenFp.has(item.fp))) dupInFile = true;
      }
      const action = existing ? (mode === 'skip' ? 'skip' : 'update') : (dupInFile ? 'skip' : 'create');
      rows.push({ item: item, old: existing, action: action });
      if (item.externalId) seenExt.add(item.externalId);
      if (item.fp) seenFp.add(item.fp);
    });
    return rows;
  }

  function batchCounts(rows) {
    let create = 0, skip = 0, update = 0;
    rows.forEach(r => {
      if (r.action === 'create') create++;
      else if (r.action === 'update') update++;
      else skip++;
    });
    return { create: create, update: update, skip: skip, total: create + update };
  }

  function mergeNotes(oldNotes, newNotes) {
    const out = (oldNotes || []).map(n => ({ id: n.id, text: n.text, createdAt: n.createdAt }));
    const seen = new Set(out.map(n => n.text));
    (newNotes || []).forEach(n => {
      if (!seen.has(n.text)) { seen.add(n.text); out.push(n); }
    });
    return out;
  }

  const BATCH_MODE_HINT = {
    skip: '按 externalId 优先、题干指纹兜底识别重复；默认跳过，适合定时任务反复执行同一批文件。',
    update: '已存在的题目用文件内容更新（保留录入时间、原图片与历史备注），适合修订答案与解析。',
    duplicate: '忽略幂等键，文件里每一条都新建，可能产生重复题目。'
  };

  /* 读取方案二 ZIP 包：包内 data.json 为批量导入 JSON，images 字段可写包内相对路径
     （如 images/1.png），images/ 目录存放图片字节。返回替换好 dataURL 的 JSON 文本。 */
  async function readBatchZip(file) {
    const entries = await Zip.readZip(await file.arrayBuffer());
    const byName = {};
    entries.forEach(e => { if (e && e.name) byName[e.name.replace(/\\/g, '/')] = e; });
    const jsonEntry = byName['data.json'] || entries.find(e => /\.json$/i.test(e.name || ''));
    if (!jsonEntry) throw new Error('ZIP 包内缺少 data.json');
    let doc;
    try { doc = JSON.parse(new TextDecoder('utf-8').decode(jsonEntry.data)); }
    catch (e) { throw new Error('data.json 不是合法 UTF-8 JSON'); }

    const extMime = n => /\.(png)$/i.test(n) ? 'image/png'
      : /\.(jpe?g)$/i.test(n) ? 'image/jpeg'
      : /\.(webp)$/i.test(n) ? 'image/webp'
      : /\.(gif)$/i.test(n) ? 'image/gif' : 'image/png';
    const imgUrl = new Map();
    entries.forEach(e => {
      if (!e || !/\.(png|jpe?g|webp|gif)$/i.test(e.name || '')) return;
      const url = U.bytesToDataURL(e.data, extMime(e.name));
      const norm = e.name.replace(/\\/g, '/');
      imgUrl.set(norm, url);
      const parts = norm.split('/');
      if (parts.length > 1) imgUrl.set(parts.slice(1).join('/'), url); // images/1.png -> 1.png
      imgUrl.set(parts[parts.length - 1], url);                        // -> 1.png
    });

    const list = Array.isArray(doc) ? doc : (doc.questions || doc.items || []);
    let resolved = 0, missing = 0;
    list.forEach(item => {
      if (!item || item.images == null) return;
      const arr = Array.isArray(item.images) ? item.images : [item.images];
      item.images = arr.map(v => {
        let key = typeof v === 'string' ? v.trim() : (v && (v.path || v.file || v.src || v.name));
        if (!key || /^data:image\//i.test(key)) return v;
        key = String(key).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
        let url = imgUrl.get(key) || imgUrl.get(key.replace(/^images\//, ''));
        if (!url) {
          // 宽松匹配：文件名相同即可
          const base = key.split('/').pop();
          for (const [k, u] of imgUrl) { if (k.split('/').pop() === base) { url = u; break; } }
        }
        if (url) { resolved++; return url; }
        missing++; return v;
      });
    });
    return { text: JSON.stringify(doc), resolved: resolved, missing: missing, images: imgUrl.size };
  }

  /* 导出方案二 ZIP 模板：data.json（含 examples）+ images/README 说明 */
  function downloadZipTemplate() {
    const doc = {
      format: Batch.FORMAT, version: Batch.VERSION,
      questions: [{
        externalId: 'zip-demo-001',
        stem: '示例：已知 $f(x)=x^2-2x+3$，求最小值。',
        subject: (state.config.subjects && state.config.subjects[0]) || '数学',
        qtype: '解答', correctAnswer: '最小值为 2', analysis: '配方：$f(x)=(x-1)^2+2$',
        tags: ['示例'], images: ['images/1.png']
      }]
    };
    const files = [
      { name: 'data.json', data: Zip.strBytes(JSON.stringify(doc, null, 2)) },
      { name: 'images/README.txt', data: Zip.strBytes('把题目图片放进这个 images 目录，文件名与 data.json 里 images 字段对应（如 1.png）。支持 png/jpg/webp/gif。') }
    ];
    downloadBlob(new Blob([Zip.createZip(files)], { type: 'application/zip' }), 'Noteee_批量导入模板.zip');
    toast('ZIP 模板已保存', 'ok');
  }

  function openBatchImport() {
    if (!window.Batch) { toast('批量导入模块未加载，请更新 APK', 'err'); return; }
    if (!window.Zip) { toast('ZIP 模块未加载，请更新 APK', 'err'); return; }
    let parsed = null, mode = 'skip', busy = false, sourceIsZip = false;

    const body =
      '<div class="batch-note">' +
      '<div class="batch-note-t">格式 v' + Batch.VERSION + ' · ' + esc(Batch.FORMAT) + '</div>' +
      '<div>推荐 UTF-8 JSON：<code>{"format":"cuotiben-batch","version":1,"questions":[…]}</code>；也支持 CSV、JSONL 与直接粘贴文本。</div>' +
      '<div class="tiny mt8">带图片请用 <b>ZIP 包</b>：包内放 <code>data.json</code>（批量导入 JSON），题目 <code>images</code> 字段写包内相对路径如 <code>images/1.png</code>，并把图片放在 <code>images/</code> 目录。导入时会自动替换成图片数据。</div>' +
      '<div class="tiny mt8">每条可用 externalId 作幂等键，定时重复导入不会产生重复题目；文件里出现的新科目 / 题型 / 错因 / 标签会自动补进「管理」页。</div>' +
      '<div class="batch-tpl">' +
      '<button class="btn btn-ghost btn-sm" id="btTplJson">' + icon('download') + ' JSON 模板</button>' +
      '<button class="btn btn-ghost btn-sm" id="btTplCsv">' + icon('download') + ' CSV 模板</button>' +
      '<button class="btn btn-ghost btn-sm" id="btTplZip">' + icon('download') + ' ZIP 模板</button>' +
      '</div></div>' +

      '<div class="section-label" style="margin-top:20px">选择文件</div>' +
      '<div class="batch-pick">' +
      '<button class="btn btn-ghost btn-sm" id="btPick">' + icon('upload') + ' 选择 .zip / .json / .csv / .txt</button>' +
      '<button class="btn btn-ghost btn-sm" id="btClip">' + icon('copy') + ' 从剪贴板</button>' +
      '<input type="file" id="batchFile" accept=".zip,.json,.csv,.txt,application/zip,application/json,text/csv,text/plain" hidden>' +
      '</div>' +

      '<div class="field mt14"><div class="field-label">或直接粘贴内容 <span class="hint">粘贴后点「解析预览」</span></div>' +
      '<textarea class="textarea mono" id="btText" placeholder="粘贴 JSON / CSV / JSONL 内容…"></textarea>' +
      '<button class="btn btn-ghost btn-sm mt8" id="btParse">' + icon('sparkles') + ' 解析预览</button></div>' +

      '<div class="section-label" style="margin-top:20px">重复处理</div>' +
      '<div class="segmented" id="btMode">' +
      '<button data-m="skip" class="on">跳过重复</button>' +
      '<button data-m="update">更新已有</button>' +
      '<button data-m="duplicate">全部新建</button></div>' +
      '<div class="tiny mt8" id="btModeHint">' + esc(BATCH_MODE_HINT.skip) + '</div>' +

      '<div class="section-label" style="margin-top:20px">解析结果</div>' +
      '<div id="btResult" class="batch-result"><div class="tiny">尚未解析。选择文件或粘贴内容后点「解析预览」。</div></div>' +
      '<div class="scroll-pad" style="height:12px"></div>';

    const ov = overlay(
      '<div class="sheet-full">' +
      '<div class="sheet-head"><button class="icon-btn" id="btCancel" data-x="cancel">' + icon('x') + '</button>' +
      '<div style="flex:1"><h2>批量导入错题</h2>' +
      '<div class="sub">离线解析 · 单事务写入 · 可撤销</div></div></div>' +
      '<div class="sheet-body">' + body + '</div>' +
      '<div class="sheet-foot">' +
      '<button class="btn btn-ghost" id="btCancel2" style="flex:none">取消</button>' +
      '<button class="btn btn-primary" id="btImport" disabled>导入</button>' +
      '</div></div>', 'bottom', true);

    const q = sel => $(sel, ov);

    function updateFoot() {
      const btn = q('#btImport');
      if (!btn) return;
      const n = parsed && parsed.items.length ? batchCounts(batchPlan(parsed.items, mode)).total : 0;
      btn.disabled = busy || !n;
      btn.textContent = busy ? '导入中…' : (n ? '导入 ' + n + ' 条' : '导入');
    }

    function renderResult() {
      const box = q('#btResult');
      if (!box) return;
      if (!parsed) { box.innerHTML = '<div class="tiny">尚未解析。</div>'; updateFoot(); return; }
      const rows = parsed.items.length ? batchPlan(parsed.items, mode) : [];
      const c = batchCounts(rows);
      let html = '';
      if (parsed.error) html += '<div class="batch-msg">' + esc(parsed.error) + '</div>';
      html += '<div class="batch-sum">' +
        (parsed.format ? esc(String(parsed.format).toUpperCase()) + ' · ' : '') +
        '有效 <b>' + parsed.items.length + '</b> 条' +
        (parsed.skipped ? ' · 无效跳过 <b>' + parsed.skipped + '</b> 条' : '') +
        (parsed.items.length ? ' · 将新增 <b>' + c.create + '</b> · 更新 <b>' + c.update + '</b> · 跳过 <b>' + c.skip + '</b>' : '') +
        '</div>';
      if (parsed.errors.length) {
        html += '<div class="batch-msg">' + esc(parsed.errors.slice(0, 4).join('；')) +
          (parsed.errors.length > 4 ? ' 等 ' + parsed.errors.length + ' 条' : '') + '</div>';
      }
      if (parsed.warnings.length) {
        html += '<div class="batch-msg">' + esc(parsed.warnings.slice(0, 3).join('；')) +
          (parsed.warnings.length > 3 ? ' 等 ' + parsed.warnings.length + ' 条' : '') + '</div>';
      }
      rows.slice(0, 6).forEach(r => {
        const it = r.item;
        const label = r.action === 'create' ? '新增' : (r.action === 'update' ? '更新' : '跳过');
        html += '<div class="batch-item"><div class="bi-main">' +
          '<div class="bi-title">' + esc(it.stem ? it.stem.replace(/\s+/g, ' ') : '（纯图片题）') + '</div>' +
          '<div class="bi-sub">' + esc(it.subject) + ' · ' + esc(it.qtype) + ' · ' + it.difficulty + ' 星' +
          (it.externalId ? ' · ' + esc(it.externalId) : '') +
          (it.images.length ? ' · ' + it.images.length + ' 张图' : '') + '</div></div>' +
          '<span class="batch-tag ' + r.action + '">' + label + '</span></div>';
      });
      if (rows.length > 6) html += '<div class="tiny mt8">仅预览前 6 条，共 ' + rows.length + ' 条。</div>';

      const cfg = state.config || {}, news = { subjects: [], qtypes: [], causes: [], tags: [] };
      parsed.items.forEach(it => {
        const push = (k, v) => {
          if (v && Array.isArray(cfg[k]) && cfg[k].indexOf(v) < 0 && news[k].indexOf(v) < 0) news[k].push(v);
        };
        push('subjects', it.subject); push('qtypes', it.qtype); push('causes', it.cause);
        it.tags.forEach(t => push('tags', t));
      });
      const parts = [];
      if (news.subjects.length) parts.push('科目 ' + news.subjects.join('、'));
      if (news.qtypes.length) parts.push('题型 ' + news.qtypes.join('、'));
      if (news.causes.length) parts.push('错因 ' + news.causes.join('、'));
      if (news.tags.length) parts.push('标签 ' + news.tags.join('、'));
      if (parts.length) html += '<div class="batch-newcfg">将自动新增：' + esc(parts.join('；')) + '</div>';
      box.innerHTML = html;
      updateFoot();
    }

    function runParse() {
      try { parsed = Batch.parse(q('#btText').value, state.config || {}); }
      catch (e) {
        parsed = { format: null, items: [], skipped: 0, errors: [], warnings: [], meta: {}, error: '解析异常：' + e.message };
      }
      renderResult();
      if (parsed.error && !parsed.items.length) toast(parsed.error, 'err');
    }

    async function doImport() {
      if (busy || !parsed || !parsed.items.length) return;
      const rows = batchPlan(parsed.items, mode).filter(r => r.action !== 'skip');
      if (!rows.length) { toast('全部都是重复题目，没有需要导入的内容', 'info'); return; }
      busy = true; updateFoot();
      try {
        const now = Date.now();
        const cfgBefore = JSON.parse(JSON.stringify(state.config));
        const cfg = JSON.parse(JSON.stringify(state.config));
        const records = [], images = [], newIds = [], newImageIds = [], restored = [];
        const addCfg = (k, v) => {
          if (!v || !Array.isArray(cfg[k])) return;
          const s = String(v).trim();
          if (s && cfg[k].indexOf(s) < 0) cfg[k].push(s);
        };
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i], it = row.item, old = row.old;
          const imageIds = [];
          for (let j = 0; j < it.images.length; j++) {
            try {
              const v = await U.makeVariants(it.images[j], {});
              const im = {
                id: uid('img'), full: v.full, thumb: v.thumb,
                createdAt: it.createdAt, width: v.width, height: v.height
              };
              images.push(im); newImageIds.push(im.id); imageIds.push(im.id);
            } catch (e) { console.warn('[batch] 跳过无法处理的图片', e); }
          }
          const keepImages = imageIds.length ? imageIds : (old ? (old.imageIds || []).slice() : []);
          const rec = {
            id: old ? old.id : uid('q'),
            stem: it.stem, options: it.options,
            correctAnswer: it.correctAnswer, myAnswer: it.myAnswer,
            cause: it.cause, causeExtra: it.causeExtra, analysis: it.analysis,
            subject: it.subject, qtype: it.qtype, difficulty: it.difficulty,
            mastery: it.mastery, tags: it.tags.slice(), imageIds: keepImages,
            notes: old ? mergeNotes(old.notes, it.notes) : it.notes.slice(),
            externalId: it.externalId || (old ? old.externalId || '' : ''),
            fp: it.fp || '',
            createdAt: old ? old.createdAt : it.createdAt,
            updatedAt: old ? Math.max(now, it.updatedAt || now) : it.updatedAt
          };
          records.push(rec);
          if (old) restored.push(JSON.parse(JSON.stringify(old))); else newIds.push(rec.id);
          addCfg('subjects', it.subject); addCfg('qtypes', it.qtype); addCfg('causes', it.cause);
          it.tags.forEach(t => addCfg('tags', t));
        }
        await DB.bulkImport(records, images, cfg);
        state.config = await DB.getConfig();
        await refresh();
        closeOverlay(ov);
        renderHome();
        if (state.view === 'stats') renderStats();
        if (state.view === 'manage') renderManage();
        if (state.view === 'settings') renderSettings();
        haptic(12);
        toast('已导入 ' + records.length + ' 条（新增 ' + newIds.length + ' · 更新 ' + restored.length + '）', 'ok', '撤销', async () => {
          try {
            await DB.undoImport(newIds, restored, newImageIds, cfgBefore);
            state.config = await DB.getConfig();
            await refresh(); renderHome();
            toast('已撤销本次批量导入');
          } catch (e) { toast('撤销失败：' + e.message, 'err'); }
        });
        // 批量导入成功后，若来源是 ZIP 且用户开启了「导入后删除 ZIP」，调用原生桥删除来源文件。
        if (sourceIsZip && state.config.autoDeleteZip && window.CuotiBridge && typeof CuotiBridge.deleteLastPickedZip === 'function') {
          try {
            const deleted = CuotiBridge.deleteLastPickedZip();
            if (deleted) toast('来源 ZIP 已自动删除', 'info');
          } catch (e) { /* 删除失败不影响导入结果 */ }
        }
      } catch (e) {
        console.error(e);
        toast('导入失败：' + e.message, 'err');
      } finally {
        busy = false; updateFoot();
      }
    }

    /* ---- bindings ---- */
    const dl = (text, name, type) => U.downloadBlob(new Blob([text], { type: type }), name);
    q('#btTplJson').onclick = () => {
      dl(Batch.jsonTemplate(state.config), 'Noteee_批量导入模板.json', 'application/json;charset=utf-8');
      toast('JSON 模板已保存', 'info');
    };
    q('#btTplCsv').onclick = () => {
      dl(Batch.csvTemplate(state.config), 'Noteee_批量导入模板.csv', 'text/csv;charset=utf-8');
      toast('CSV 模板已保存（UTF-8 BOM）', 'info');
    };
    q('#btTplZip').onclick = downloadZipTemplate;
    q('#btPick').onclick = () => q('#batchFile').click();
    q('#batchFile').onchange = async () => {
      const f = q('#batchFile').files && q('#batchFile').files[0];
      q('#batchFile').value = '';
      if (!f) return;
      sourceIsZip = /\.zip$/i.test(f.name) || f.type === 'application/zip';
      try {
        if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
          const r = await readBatchZip(f);
          q('#btText').value = r.text;
          runParse();
          toast('ZIP 已解包 · 图片 ' + r.images + ' 张，路径替换 ' + r.resolved + ' 处' + (r.missing ? '，缺失 ' + r.missing + ' 处' : ''), r.missing ? 'warn' : 'ok');
        } else {
          q('#btText').value = await U.readFileAsText(f);
          runParse();
        }
      } catch (e) { toast('读取文件失败：' + e.message, 'err'); }
    };
    q('#btClip').onclick = async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('当前环境不支持读取剪贴板，请长按文本框粘贴');
        const t = await navigator.clipboard.readText();
        if (!t || !t.trim()) { toast('剪贴板为空', 'info'); return; }
        q('#btText').value = t;
        runParse();
      } catch (e) { toast(e.message || '读取剪贴板失败', 'err'); }
    };
    q('#btParse').onclick = runParse;
    $$('#btMode button', ov).forEach(b => b.onclick = () => {
      mode = b.dataset.m;
      $$('#btMode button', ov).forEach(x => x.classList.toggle('on', x === b));
      q('#btModeHint').textContent = BATCH_MODE_HINT[mode];
      renderResult();
    });
    q('#btCancel').onclick = q('#btCancel2').onclick = () => closeOverlay(ov);
    q('#btImport').onclick = doImport;
    updateFoot();
  }

  async function cleanupImages() {
    const n = await DB.cleanupOrphanImages();
    await refresh(); renderSettings();
    toast(n ? '已清理 ' + n + ' 张残留图片' : '没有需要清理的残留图片', 'info');
  }

  async function chooseBackupDir() {
    // 直接让用户输入相对目录名。此前优先调用 showDirectoryPicker，在 WebView / 部分
    // 浏览器里它要么弹系统目录框要么静默失败，config.backupDir 始终不变，表现为「点击无效」。
    const v = await promptDialog({ title: '备份目录', desc: '设置原生端（APK）导出备份时使用的相对目录，相对于系统下载目录。', value: state.config.backupDir, placeholder: 'Download/Noteee备份' });
    if (!v) return;
    state.config.backupDir = v.trim();
    await DB.putConfig(state.config);
    // 先更新 DOM 显示，再异步重渲染（renderSettings 内部有 estimateSize 的等待）
    const row = document.querySelector('[data-act="choose-dir"]');
    if (row) {
      const sub = row.closest('.grow').querySelector('.grow-sub');
      if (sub) sub.textContent = state.config.backupDir;
    }
    toast('备份目录已更新为「' + state.config.backupDir + '」');
    renderSettings();
  }

  async function clearAllData() {
    const ok = await confirmDialog({
      title: '清空全部数据？', desc: '所有错题、图片与自定义科目/标签都会被删除，建议先导出备份。',
      confirmText: '确认清空', danger: true
    });
    if (!ok) return;
    await DB.replaceAll([], [], JSON.parse(JSON.stringify(DB.DEFAULT_CONFIG)));
    state.config = await DB.getConfig();
    await refresh(); renderHome(); renderSettings(); renderManage();
    toast('已清空全部数据');
  }

  /* ---------------------------------------------------------
     EVENT BINDING (delegated on #views)
     --------------------------------------------------------- */
  function bind() {
    $$('.tab').forEach(t => t.onclick = () => { haptic(); setView(t.dataset.view); });
    $('#btnAdd').onclick = async () => {
      haptic(10);
      const choice = await optionDialog({
        title: '添加内容', desc: '选择录入 / 导入方式',
        options: [
          { icon: 'plus', title: '直接录入错题', desc: '拍照 / 相册 / 文字，手动录入一道', value: 'single' },
          { icon: 'layers', title: '批量导入错题', desc: '从 JSON / ZIP 文件一次导入多道（可含图片）', value: 'batch' },
          { icon: 'pdf', title: '导入 PDF', desc: '导入 PDF 学习资料，连续滚动阅读', value: 'pdf' },
          { icon: 'book', title: '导入 TXT 小说', desc: '导入 txt，番茄小说式离线阅读', value: 'txt' }
        ]
      });
      if (choice === 'batch') openBatchImport();
      else if (choice === 'pdf') doPromptPdfImport();
      else if (choice === 'txt') doPromptTxtImport();
      else if (choice === 'single') openEditor(null);
    };
    $('#btnTheme').onclick = () => setTheme(state.config.theme === 'dark' ? 'light' : 'dark');
    $('#btnStats').onclick = () => { haptic(); setView('stats'); };

    // "导入资料" from the FAB opens a chooser so it actually triggers a file picker.
    async function doPromptDocImport() {
      const kind = await optionDialog({
        title: '导入资料', desc: '选择要导入的文件类型',
        options: [
          { icon: 'pdf', title: 'PDF 文档', desc: '导入 PDF 学习资料，连续滚动阅读', value: 'pdf' },
          { icon: 'note', title: '本地 HTML', desc: '打开本地 HTML 文档', value: 'html' },
          { icon: 'book', title: 'TXT 小说', desc: '导入 txt，番茄小说式阅读', value: 'txt' }
        ]
      });
      if (kind === 'pdf') doPromptPdfImport();
      else if (kind === 'html') doPromptHtmlImport();
      else if (kind === 'txt') doPromptTxtImport();
    }

    // 资料页「资料 / 小说」切换
    $$('.doc-tabs button').forEach(b => b.onclick = () => { haptic(); switchDocTab(b.dataset.doctab); });
    const novelImportBtn = $('#btnNovelImport');
    if (novelImportBtn) novelImportBtn.onclick = () => { haptic(); doPromptTxtImport(); };
    $('#btnFilter').onclick = openFilterSheet;
    $('#btnSort').onclick = openSortSheet;
    $('#btnBatch').onclick = () => { haptic(); openBatchImport(); };

    // PDF 文件选择（加号导入 / 资料库导入共用同一个隐藏 input）
    const pdfInput = $('#pdfFileInput');
    if (pdfInput) pdfInput.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) doImportPdf(f);
      e.target.value = '';
    });
    const htmlInput = $('#htmlFileInput');
    if (htmlInput) htmlInput.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) doImportHtml(f);
      e.target.value = '';
    });
    const txtInput = $('#txtFileInput');
    if (txtInput) txtInput.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) doImportTxt(f);
      e.target.value = '';
    });

    // Docs library lives in the "资料" tab view now; handle row open + delete.
    const docsBody = $('#pdfViewBody');
    if (docsBody) {
      docsBody.addEventListener('click', async e => {
        const del = e.target.closest('[data-act="pdf-del"]');
        if (del) {
          e.stopPropagation();
          const id = del.getAttribute('data-id');
          const ok = await confirmDialog({ title: '删除这份资料？', desc: '删除后无法恢复，如需保留请先备份。', confirmText: '删除', danger: true });
          if (!ok) return;
          await DB.deletePdf(id);
          toast('已删除资料');
          renderPdfView();
          return;
        }
        const row = e.target.closest('.pdf-row');
        if (row) {
          const id = row.getAttribute('data-id');
          if (row.getAttribute('data-kind') === 'html') openHtmlViewer(id);
          else openPdfViewer(id);
        }
      });
    }

    // NovEL shelf: open reader + delete
    const novelBody = $('#novelViewBody');
    if (novelBody) {
      novelBody.addEventListener('click', async e => {
        const del = e.target.closest('[data-act="novel-del"]');
        if (del) {
          e.stopPropagation();
          const id = del.getAttribute('data-id');
          const ok = await confirmDialog({ title: '移除这本小说？', desc: '删除后无法恢复，如需保留请从其他途径留存 txt。', confirmText: '删除', danger: true });
          if (!ok) return;
          await DB.deletePdf(id);
          toast('已移除小说');
          renderNovelView();
          return;
        }
        const imp = e.target.closest('#btnNovelImport');
        if (imp) { haptic(); doPromptTxtImport(); return; }
        const row = e.target.closest('.novel-row');
        if (row) {
          const NV = globalNovel();
          if (NV && typeof NV.openReader === 'function') NV.openReader(row.getAttribute('data-id'));
          else toast('小说阅读器尚未加载', 'err');
        }
      });
    }

    $('#searchInput').addEventListener('input', debounce(e => {
      state.search = e.target.value;
      renderHome();
    }, 180));
    $('#searchClear').onclick = () => {
      $('#searchInput').value = ''; state.search = ''; renderHome(); $('#searchInput').focus();
    };

    $('#views').addEventListener('click', async e => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act, id = el.dataset.id;
      if (act !== 'card' && act !== 'm-mastery' && act !== 'm-tag' && act !== 'm-more') e.stopPropagation();
      switch (act) {
        case 'card': openDetail(id); break;
        case 'm-mastery': openMasteryPicker(id); break;
        case 'm-tag': openTagPicker(id); break;
        case 'm-more': openCardMenu(id); break;
        case 'first-add': openEditor(null); break;
        case 'filter-remove': {
          const k = el.dataset.k, v = el.dataset.v;
          const a = state.filters[k], i = a.indexOf(v);
          if (i >= 0) a.splice(i, 1);
          renderHome(); break;
        }
        case 'clear-filters':
          state.filters = { subject: [], qtype: [], mastery: [], cause: [], tags: [] };
          state.search = ''; $('#searchInput').value = '';
          renderHome(); break;
        case 'seed-demo':
          await DB.seedDemo(); await refresh(); state.config = await DB.getConfig();
          renderHome(); if (state.view === 'settings') renderSettings();
          toast('已载入 6 道示例错题'); break;
        case 'set-theme': setTheme(el.dataset.v); break;
        case 'toggle-hide':
          state.config.hideMastered = !state.config.hideMastered;
          await DB.putConfig(state.config); renderSettings(); renderHome(); break;
        case 'toggle-autodel':
          state.config.autoDeleteZip = !state.config.autoDeleteZip;
          await DB.putConfig(state.config); renderSettings();
          toast('导入后删除 ZIP 已' + (state.config.autoDeleteZip ? '开启' : '关闭'), 'info'); break;
        case 'cfg-add': cfgAdd(el.dataset.k); break;
        case 'cfg-edit': cfgEdit(el.dataset.k, +el.dataset.i); break;
        case 'cfg-del': cfgDelete(el.dataset.k, +el.dataset.i); break;
        case 'toggle-collapse': {
          const ck = el.dataset.k;
          state.manageCollapsed[ck] = !state.manageCollapsed[ck];
          // Persist so the expand/collapse state survives app restarts (v1.0.6).
          if (!state.config.manageCollapsed || typeof state.config.manageCollapsed !== 'object') state.config.manageCollapsed = {};
          state.config.manageCollapsed[ck] = state.manageCollapsed[ck];
          DB.putConfig(state.config);
          renderManage(); break;
        }
        case 'mgr-filter': {
          const fk = el.dataset.fk, fv = el.dataset.fv;
          state.filters = { subject: [], qtype: [], mastery: [], cause: [], tags: [] };
          if (fk && fv) {
            if (fk === 'tags') state.filters.tags = [fv];
            else if (state.filters[fk]) state.filters[fk] = [fv];
          }
          state.search = '';
          const si = $('#searchInput'); if (si) si.value = '';
          setView('home');
          toast('已筛选「' + fv + '」的错题', 'info');
          break;
        }
        case 'tag-subject':
          state.manageTagSubject = el.dataset.v || '';
          renderManage(); break;
        case 'field-subject':
          state.manageFieldSubject = el.dataset.v || '';
          renderManage(); break;
        case 'toggle-field': {
          const subj = state.manageFieldSubject, key = el.dataset.f;
          if (!state.config.hiddenFields) state.config.hiddenFields = {};
          const arr = state.config.hiddenFields[subj] || (state.config.hiddenFields[subj] = []);
          const i = arr.indexOf(key);
          if (i >= 0) arr.splice(i, 1); else arr.push(key);
          await DB.putConfig(state.config);
          renderManage();
          toast('字段显示已更新', 'info'); break;
        }
        case 'export': exportBackup(); break;
        case 'import': $('#importFile').click(); break;
        case 'batch': openBatchImport(); break;
        case 'cleanup': cleanupImages(); break;
        case 'choose-dir': chooseBackupDir(); break;
        case 'clear-all': clearAllData(); break;
      }
    });

    // import file input lives inside settings body (re-rendered), so delegate on #views
    $('#views').addEventListener('change', e => {
      if (e.target.id === 'importFile' && e.target.files && e.target.files[0]) {
        importBackup(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  boot();
})();
