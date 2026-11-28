/* ============================================================
   quiz.js — 刷题模式 (drill / quiz mode) for Noteee
   Self-contained. Exposes only window.Quiz.open(opts).
   No network, no dependencies beyond window.U and window.DB.
   ============================================================ */
(function (global) {
  'use strict';

  var U = global.U;
  var DB = global.DB;

  /* ---------- one-time, quiz-only stylesheet ---------- */
  var CSS = [
    '.qz-wrap{position:relative;overflow:hidden}',
    '.qz-progress{color:var(--accent);font-weight:700;font-variant-numeric:tabular-nums}',
    '.qz-scroll{padding:16px 16px 26px}',
    '.qz-card{',
    '  border-radius:var(--r-lg);padding:16px;',
    '  background:var(--glass);border:1px solid var(--stroke);',
    '  -webkit-backdrop-filter:blur(var(--blur)) saturate(180%);',
    '  backdrop-filter:blur(var(--blur)) saturate(180%);',
    '  box-shadow:inset 0 1px 0 var(--hi),var(--shadow-sm);',
    '  animation:qzCardIn .3s var(--ease);touch-action:pan-y;',
    '}',
    '@keyframes qzCardIn{from{opacity:0;transform:translate3d(0,10px,0)}to{opacity:1;transform:none}}',
    '.qz-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:15px}',
    '.qz-media{margin:0 0 4px}',
    '.qz-img{',
    '  display:block;max-width:100%;max-height:42vh;width:auto;height:auto;',
    '  margin:0 auto 14px;object-fit:contain;object-position:center;',
    '  border-radius:var(--r-md);border:1px solid var(--stroke);',
    '  background:rgba(0,0,0,.18);box-shadow:var(--shadow-sm);',
    '}',
    '.qz-stem{',
    '  font-size:16px;line-height:1.78;color:var(--text);',
    '  white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;',
    '  margin:2px 0 18px;',
    '}',
    '.qz-reveal{width:100%}',
    '.qz-answer{margin-top:16px;display:flex;flex-direction:column;gap:11px}',
    '.qz-answer[hidden],.qz-rate[hidden],.qz-foot[hidden]{display:none!important}',
    '.qz-panel{',
    '  border-radius:var(--r-md);padding:13px 14px;',
    '  background:var(--field);border:1px solid var(--stroke);',
    '  box-shadow:inset 0 1px 0 var(--hi);',
    '}',
    '.qz-panel-title{',
    '  display:flex;align-items:center;gap:6px;',
    '  font-size:10.5px;font-weight:700;letter-spacing:.12em;',
    '  color:var(--accent);margin-bottom:7px;',
    '}',
    '.qz-panel-text{',
    '  font-size:14px;line-height:1.7;color:var(--text);',
    '  white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;',
    '}',
    '.qz-foot{flex-direction:column;gap:10px}',
    '.qz-rate{display:flex;gap:9px;width:100%}',
    '.qz-rate-btn{flex:1;padding:0 6px;height:46px;color:#08160f;font-weight:750}',
    '.qz-rate-btn.good{background:linear-gradient(140deg,var(--good),#3fbf8c)}',
    '.qz-rate-btn.warn{background:linear-gradient(140deg,var(--warn),#f0b64e)}',
    '.qz-rate-btn.bad{background:linear-gradient(140deg,var(--bad),#ec6f92);color:#fff}',
    '.qz-rate-btn.on{box-shadow:0 0 0 2px var(--accent),0 8px 20px rgba(0,0,0,.25)}',
    '.qz-nav{display:flex;gap:10px}',
    '.qz-nav .btn{flex:1}',
    '.qz-summary{display:flex;flex-direction:column;align-items:center;padding:26px 6px 10px;text-align:center}',
    '.qz-sum-orb{',
    '  width:88px;height:88px;border-radius:27px;display:grid;place-items:center;',
    '  color:var(--accent);',
    '  background:linear-gradient(145deg,rgba(141,125,255,.28),rgba(90,169,255,.14));',
    '  border:1px solid var(--stroke-2);',
    '  box-shadow:inset 0 1px 0 var(--hi),0 18px 40px rgba(0,0,0,.22);margin-bottom:14px;',
    '}',
    '.qz-sum-orb .icon{width:38px;height:38px;stroke-width:1.5}',
    '.qz-summary h3{margin:0 0 20px;font-size:19px;font-weight:720}',
    '.qz-sum-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;width:100%;margin-bottom:22px}',
    '.qz-sum-card{',
    '  border-radius:var(--r-lg);padding:16px 12px;text-align:center;',
    '  background:var(--glass);border:1px solid var(--stroke);',
    '  box-shadow:inset 0 1px 0 var(--hi),var(--shadow-sm);',
    '}',
    '.qz-sum-card.wide{grid-column:1 / -1}',
    '.qz-sum-num{font-size:28px;font-weight:760;line-height:1.1;color:var(--text)}',
    '.qz-sum-num.good{color:var(--good)}',
    '.qz-sum-num.warn{color:var(--warn)}',
    '.qz-sum-num.bad{color:var(--bad)}',
    '.qz-sum-num.accent{color:var(--accent)}',
    '.qz-sum-lbl{font-size:11.5px;color:var(--text-2);margin-top:6px}',
    '.qz-finish{width:100%}',
    '@media (prefers-reduced-motion:reduce){.qz-card{animation:none}}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById('quiz-style')) return;
    var s = document.createElement('style');
    s.id = 'quiz-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  injectStyle();

  /* ---------- small helpers over the U / DB globals ---------- */
  function icon(n) { return U && U.icon ? U.icon(n) : ''; }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? '' : s); }
  function haptic() { if (U && U.haptic) U.haptic(8); }
  function toast(msg, type) { if (U && U.toast) U.toast(msg, type); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function chip(label, accent) {
    return '<span class="chip' + (accent ? ' accent' : '') + '">' + esc(label) + '</span>';
  }
  function causesOf(q) {
    if (Array.isArray(q.causes)) return q.causes.slice();
    if (q.cause) return [q.cause];
    return [];
  }
  function correctOf(q) {
    return own(q, 'correct') ? q.correct : (q.correctAnswer || '');
  }
  function imageIdsOf(q) {
    if (Array.isArray(q.images)) return q.images;
    if (Array.isArray(q.imageIds)) return q.imageIds;
    return [];
  }
  function closest(el, sel, within) {
    while (el && el !== within) {
      if (el.nodeType === 1 && el.matches && el.matches(sel)) return el;
      el = el.parentNode;
    }
    return null;
  }

  var activeSession = null;

  /* ---------------------------------------------------------
     PUBLIC ENTRY
     opts: { questions: [...], onResult?: function(summary) }
     --------------------------------------------------------- */
  function open(opts) {
    opts = opts || {};
    var src = Array.isArray(opts.questions) ? opts.questions : [];
    var questions = src.filter(function (q) {
      return q && typeof q === 'object' && q.id != null;
    }).slice();

    if (!questions.length) {
      toast('没有符合条件的题目', 'err');
      return null;
    }
    if (activeSession) {
      try { activeSession.close(); } catch (e) { /* noop */ }
      activeSession = null;
    }

    var N = questions.length;
    var index = 0;
    var revealed = false;
    var results = {};   // question index -> mastery chosen this session
    var imgCache = {};  // image id -> full dataURL (or '')
    var closed = false;
    var renderToken = 0;
    var card = null;

    var root = document.getElementById('overlayRoot') || document.body;
    var ov = document.createElement('div');
    ov.className = 'overlay bottom';
    ov.innerHTML =
      '<div class="overlay-mask"></div>' +
      '<div class="sheet-full qz-wrap">' +
        '<div class="sheet-head">' +
          '<button class="icon-btn" data-x="cancel" aria-label="返回">' + icon('chev-left') + '</button>' +
          '<div style="flex:1;min-width:0">' +
            '<h2>刷题模式</h2>' +
            '<div class="sub qz-progress" id="qzProgress">1 / ' + N + '</div>' +
          '</div>' +
          '<button class="icon-btn" data-qz-act="close" aria-label="关闭">' + icon('x') + '</button>' +
        '</div>' +
        '<div class="sheet-body qz-scroll" id="qzBody"></div>' +
        '<div class="sheet-foot qz-foot" id="qzFoot">' +
          '<div class="qz-rate" id="qzRate" hidden>' +
            '<button class="btn qz-rate-btn good" data-rate="mastered">会了</button>' +
            '<button class="btn qz-rate-btn warn" data-rate="fuzzy">模糊</button>' +
            '<button class="btn qz-rate-btn bad" data-rate="unmastered">不会</button>' +
          '</div>' +
          '<div class="qz-nav">' +
            '<button class="btn btn-ghost" data-qz-act="prev">' + icon('chev-left') + ' 上一题</button>' +
            '<button class="btn btn-ghost" data-qz-act="next">下一题 ' + icon('chev-right') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    root.appendChild(ov);
    if (U && U.enterSheet) U.enterSheet(ov.querySelector('.sheet-full'));

    var body = ov.querySelector('#qzBody');
    var foot = ov.querySelector('#qzFoot');
    var rateBox = ov.querySelector('#qzRate');
    var progress = ov.querySelector('#qzProgress');

    /* ---------- image loading (first image only, cached) ---------- */
    function loadImage(id) {
      if (own(imgCache, id)) return Promise.resolve(imgCache[id]);
      return Promise.resolve()
        .then(function () { return DB && DB.getImage ? DB.getImage(id) : null; })
        .then(function (rec) {
          var full = rec && (rec.full || rec.thumb) ? (rec.full || rec.thumb) : '';
          imgCache[id] = full;
          return full;
        })
        .catch(function () { imgCache[id] = ''; return ''; });
    }

    /* ---------- render one question (answer hidden) ---------- */
    function renderQuestion() {
      if (closed) return;
      var q = questions[index];
      var token = ++renderToken;
      revealed = false;
      progress.textContent = (index + 1) + ' / ' + N;

      var chips = chip(q.subject || '未分类', true) +
        (q.qtype ? chip(q.qtype, false) : '') +
        (Array.isArray(q.tags) ? q.tags.map(function (t) { return chip('# ' + t, false); }).join('') : '');

      var stem = String(q.stem || '').trim();
      if (!stem) stem = '（本题无文字题干，请查看上方图片）';

      var causes = causesOf(q);
      var answerHTML =
        '<div class="qz-panel"><div class="qz-panel-title">正确答案</div><div class="qz-panel-text">' + esc(String(correctOf(q))) + '</div></div>' +
        '<div class="qz-panel"><div class="qz-panel-title">解析</div><div class="qz-panel-text">' + esc(q.analysis || '—') + '</div></div>' +
        '<div class="qz-panel"><div class="qz-panel-title">错因</div><div class="qz-panel-text">' + (causes.length ? esc(causes.join('、')) : '—') + '</div></div>';

      body.innerHTML =
        '<div class="qz-card" id="qzCard">' +
          '<div class="qz-chips">' + chips + '</div>' +
          '<div class="qz-media" id="qzMedia"></div>' +
          '<div class="qz-stem">' + esc(stem) + '</div>' +
          '<button class="btn btn-ghost btn-block qz-reveal" data-qz-act="reveal">' + icon('eye') + ' 显示答案</button>' +
          '<div class="qz-answer" id="qzAnswer" hidden>' + answerHTML + '</div>' +
        '</div>';

      card = body.querySelector('#qzCard');
      bindSwipe(card);

      var ids = imageIdsOf(q);
      if (ids.length) {
        loadImage(ids[0]).then(function (full) {
          if (closed || token !== renderToken || !full) return;
          var media = body.querySelector('#qzMedia');
          if (media) media.innerHTML = '<img class="qz-img" src="' + full + '" alt="题目图片">';
        });
      }
      syncRate();
    }

    function syncRate() {
      if (!rateBox) return;
      var cur = results[index];
      Array.prototype.forEach.call(rateBox.querySelectorAll('[data-rate]'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-rate') === cur);
      });
    }

    function setReveal(on) {
      revealed = !!on;
      var ans = ov.querySelector('#qzAnswer');
      var btn = ov.querySelector('[data-qz-act="reveal"]');
      if (ans) ans.hidden = !revealed;
      if (btn) btn.innerHTML = icon('eye') + (revealed ? ' 隐藏答案' : ' 显示答案');
      if (rateBox) rateBox.hidden = !revealed;
      if (revealed) syncRate();
    }

    /* ---------- persist a rating ----------
       db.js has no updateQuestion/saveQuestion; the single-question write is
       DB.putQuestion(rec). Load the fresh record, modify, put it back. */
    function persistRating(q, mastery) {
      return Promise.resolve()
        .then(function () { return DB && DB.getQuestion ? DB.getQuestion(q.id) : null; })
        .then(function (rec) {
          var base = rec || q;
          var next = Object.assign({}, base, { mastery: mastery, updatedAt: Date.now() });
          if (mastery === 'unmastered') {
            var has = Array.isArray(base.causes) ? base.causes.slice() : (base.cause ? [base.cause] : []);
            if (!has.length) {
              has.push('重做');
              next.causes = has;
              if (!next.cause) next.cause = '重做';
            }
          }
          return DB && DB.putQuestion ? DB.putQuestion(next) : null;
        })
        .catch(function () { /* a storage hiccup never blocks the drill */ });
    }

    function rate(mastery) {
      if (closed || !revealed) return;
      var q = questions[index];
      results[index] = mastery;
      persistRating(q, mastery);
      haptic();
      if (index >= N - 1) showSummary();
      else { index += 1; renderQuestion(); }
    }

    function go(delta) {
      if (closed) return;
      var nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= N) return;
      index = nextIndex;
      haptic();
      renderQuestion();
    }

    /* ---------- summary ---------- */
    function buildSummary() {
      var mastered = 0, fuzzy = 0, unmastered = 0;
      Object.keys(results).forEach(function (k) {
        var m = results[k];
        if (m === 'mastered') mastered++;
        else if (m === 'fuzzy') fuzzy++;
        else if (m === 'unmastered') unmastered++;
      });
      var rated = mastered + fuzzy + unmastered;
      var accuracy = rated ? Math.round(mastered / rated * 100) : 0;
      return { total: N, mastered: mastered, fuzzy: fuzzy, unmastered: unmastered, accuracy: accuracy };
    }

    function showSummary() {
      if (closed) return;
      renderToken++; // invalidate any pending image load
      var s = buildSummary();
      progress.textContent = '已完成';
      body.innerHTML =
        '<div class="qz-summary">' +
          '<div class="qz-sum-orb">' + icon('sparkles') + '</div>' +
          '<h3>刷题完成</h3>' +
          '<div class="qz-sum-grid">' +
            '<div class="qz-sum-card"><div class="qz-sum-num">' + s.total + '</div><div class="qz-sum-lbl">总题数</div></div>' +
            '<div class="qz-sum-card"><div class="qz-sum-num good">' + s.mastered + '</div><div class="qz-sum-lbl">会了</div></div>' +
            '<div class="qz-sum-card"><div class="qz-sum-num warn">' + s.fuzzy + '</div><div class="qz-sum-lbl">模糊</div></div>' +
            '<div class="qz-sum-card"><div class="qz-sum-num bad">' + s.unmastered + '</div><div class="qz-sum-lbl">不会</div></div>' +
            '<div class="qz-sum-card wide"><div class="qz-sum-num accent">' + s.accuracy + '%</div><div class="qz-sum-lbl">正确率</div></div>' +
          '</div>' +
          '<button class="btn btn-primary btn-block qz-finish" data-qz-act="finish">' + icon('check') + ' 完成</button>' +
        '</div>';
      foot.hidden = true;
      card = null;
      haptic();
    }

    /* ---------- close (no onResult on mid-way close) ---------- */
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      if (activeSession === session) activeSession = null;
      ov.style.pointerEvents = 'none';
      ov.style.transition = 'opacity .2s';
      ov.style.opacity = '0';
      setTimeout(function () {
        if (ov.parentNode) ov.parentNode.removeChild(ov);
      }, 200);
    }

    var session = { close: close };
    activeSession = session;

    /* ---------- keyboard ---------- */
    function onKey(e) {
      if (closed) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space') { e.preventDefault(); setReveal(!revealed); }
    }
    document.addEventListener('keydown', onKey);

    /* ---------- delegated clicks ---------- */
    ov.addEventListener('click', function (e) {
      var t = e.target;
      var rateBtn = closest(t, '[data-rate]', ov);
      if (rateBtn) { rate(rateBtn.getAttribute('data-rate')); return; }
      var actEl = closest(t, '[data-qz-act]', ov);
      if (actEl) {
        var act = actEl.getAttribute('data-qz-act');
        if (act === 'reveal') setReveal(!revealed);
        else if (act === 'prev') go(-1);
        else if (act === 'next') go(1);
        else if (act === 'close') close();
        else if (act === 'finish') {
          var summary = buildSummary();
          close();
          if (typeof opts.onResult === 'function') opts.onResult(summary);
        }
        return;
      }
      if (closest(t, '[data-x="cancel"]', ov)) close();
    });
    ov.querySelector('.overlay-mask').addEventListener('click', close);

    /* ---------- swipe: left = next, right = prev (vertical scroll untouched) ---------- */
    function bindSwipe(el) {
      if (!el) return;
      var sx = 0, sy = 0, tracking = false;
      el.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) { tracking = false; return; }
        tracking = true;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
      }, { passive: true });
      el.addEventListener('touchend', function (e) {
        if (!tracking) return;
        tracking = false;
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        var dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) <= 60 || Math.abs(dx) <= 1.3 * Math.abs(dy)) return;
        if (dx < 0) go(1); else go(-1);
      }, { passive: true });
    }

    renderQuestion();
    return session;
  }

  global.Quiz = { open: open };
})(window);
