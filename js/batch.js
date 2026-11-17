/* ============================================================
   batch.js — 批量导入错题：格式解析 / 校验 / 归一化 / 模板生成
   纯前端，无依赖，挂到 window.Batch。

   规范格式（供自动化任务生成）：
     { "format":"cuotiben-batch", "version":1, "questions":[ {...} ] }
   兼容输入：裸数组、单条对象、JSONL（每行一个对象）、CSV（UTF-8）。
   详见 README「九、批量导入错题」与 samples/batch-example.json。
   ============================================================ */
(function (global) {
  'use strict';

  const FORMAT = 'cuotiben-batch';
  const VERSION = 1;
  const MAX_ITEMS = 5000;
  const MAX_IMAGES_PER_ITEM = 8;

  // 字段别名（小写归一化后比较）：自动化请用标准英文键，中文键为人工录入兜底
  const ALIAS = {
    externalId: ['externalid', 'external_id', 'sourceid', 'source_id', '外部id', '来源id', '唯一编号', '题号'],
    stem: ['stem', '题干', '题目', '题目内容', 'question', 'text', 'content', '描述'],
    subject: ['subject', '科目', '学科', 'sub'],
    qtype: ['qtype', 'type', '题型', '题目类型'],
    optionA: ['optiona', 'options.a', 'a', '选项a', '选项Ａ', 'a项'],
    optionB: ['optionb', 'options.b', 'b', '选项b', '选项Ｂ', 'b项'],
    optionC: ['optionc', 'options.c', 'c', '选项c', '选项Ｃ', 'c项'],
    optionD: ['optiond', 'options.d', 'd', '选项d', '选项Ｄ', 'd项'],
    correctAnswer: ['correctanswer', 'answer', '正确答案', '答案', '正确选项'],
    myAnswer: ['myanswer', '我的答案', '错误答案', '我选的', '误选'],
    cause: ['cause', '错因', '错误原因', '原因'],
    causeExtra: ['causeextra', '错因说明', '补充说明', '错因补充'],
    analysis: ['analysis', '解析', '答案解析', '解答', 'explanation', 'solution'],
    difficulty: ['difficulty', '难度', '星级', 'stars', 'level'],
    mastery: ['mastery', '掌握状态', '掌握', '状态', 'status'],
    tags: ['tags', '标签', 'tag', '标记'],
    notes: ['notes', 'note', '备考备注', '备注', '复习备注'],
    images: ['images', 'image', '题目图片', '图片', '照片'],
    createdAt: ['createdat', 'created', '录入时间', '创建时间', '录入日期', '创建日期'],
    updatedAt: ['updatedat', 'updated', '修改时间', '更新时间']
  };

  const MASTERY_ALIAS = {
    'unmastered': 'unmastered', '0': 'unmastered', '未掌握': 'unmastered', '不会': 'unmastered', 'red': 'unmastered',
    'fuzzy': 'fuzzy', '1': 'fuzzy', '模糊': 'fuzzy', '半懂': 'fuzzy', 'yellow': 'fuzzy',
    'mastered': 'mastered', '2': 'mastered', '已掌握': 'mastered', '掌握': 'mastered', '会了': 'mastered', 'green': 'mastered'
  };

  // 表头/字段名 -> 标准字段 key
  function keyOf(name) {
    const n = String(name == null ? '' : name).trim().toLowerCase().replace(/[\s_\-]/g, '');
    if (!n) return null;
    for (const key in ALIAS) {
      const list = ALIAS[key];
      for (let i = 0; i < list.length; i++) {
        const an = list[i].toLowerCase().replace(/[\s_\-]/g, '');
        if (n === an || n === an.replace('.', '')) return key;
      }
    }
    return null;
  }

  function clean(s) {
    return String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim();
  }

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* 无 externalId 时的兜底去重键：同一科目下归一化后的题干。
     纯图片题（无文字题干）不生成指纹，只能靠 externalId 去重。 */
  function fingerprint(q) {
    const norm = s => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
    const stem = norm(q && q.stem);
    if (!stem) return '';
    return hash(stem + '\u0001' + norm(q && q.subject));
  }

  // 解析 CSV（支持引号包裹、引号内逗号与换行、"" 转义）
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    const s = String(text).replace(/^\uFEFF/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* handled by \n */ }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  }

  function splitTags(v) {
    if (Array.isArray(v)) return v.map(t => clean(t)).filter(Boolean);
    return String(v == null ? '' : v).split(/[|｜、,，;；\n]/).map(t => t.trim()).filter(Boolean);
  }

  function toDifficulty(v) {
    if (v == null || v === '') return 3;
    const n = parseInt(String(v).replace(/[^\d\-]/g, ''), 10);
    if (isNaN(n)) return 3;
    return Math.max(1, Math.min(5, n));
  }

  function toMastery(v) {
    if (v == null || v === '') return 'unmastered';
    const s = String(v).trim();
    return MASTERY_ALIAS[s.toLowerCase()] || MASTERY_ALIAS[s] || 'unmastered';
  }

  /* 时间：毫秒时间戳 / 秒级时间戳 / ISO 8601 字符串；无效则用 fallback */
  function parseTime(v, fallback) {
    if (v == null || v === '') return fallback;
    let n;
    if (typeof v === 'number') n = v;
    else if (/^\d+(\.\d+)?$/.test(String(v).trim())) n = Number(v);
    else n = Date.parse(String(v).trim());
    if (!isFinite(n) || n <= 0) return fallback;
    if (n < 1e11) n = n * 1000; // 秒级时间戳
    return Math.round(n);
  }

  let noteSeq = 0;
  function normalizeNotes(v, fallbackTime) {
    const arr = Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i];
      let text = '', at = fallbackTime;
      if (x && typeof x === 'object') {
        text = clean(x.text != null ? x.text : x.content);
        at = parseTime(x.createdAt != null ? x.createdAt : x.time, fallbackTime);
      } else text = clean(x);
      if (!text) continue;
      out.push({
        id: 'n_' + Date.now().toString(36) + '_' + (++noteSeq) + '_' + Math.random().toString(36).slice(2, 7),
        text: text, createdAt: at
      });
    }
    return out;
  }

  /* images: dataURL 字符串 / 纯 base64 / {dataUrl} / {data, mime} */
  function normalizeImages(v) {
    const arr = Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
    const list = [], warnings = [];
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i];
      let url = '';
      if (typeof x === 'string') {
        const s = x.trim();
        if (/^data:image\//i.test(s)) url = s;
        else if (s.length > 64 && /^[A-Za-z0-9+/=\s]+$/.test(s)) url = 'data:image/png;base64,' + s.replace(/\s+/g, '');
        else if (s) warnings.push('图片 ' + (i + 1) + ' 不是有效的 dataURL 或 base64');
      } else if (x && typeof x === 'object') {
        const raw = x.dataUrl || x.url || x.data || x.base64 || '';
        const mime = x.mime || 'image/png';
        if (typeof raw === 'string' && /^data:image\//i.test(raw.trim())) url = raw.trim();
        else if (typeof raw === 'string' && raw.length > 64) url = 'data:' + mime + ';base64,' + raw.replace(/\s+/g, '');
        else warnings.push('图片 ' + (i + 1) + ' 缺少图片数据');
      }
      if (url) list.push(url);
      if (list.length >= MAX_IMAGES_PER_ITEM) break;
    }
    return { list: list, warnings: warnings };
  }

  /* 把一条原始记录归一化为 question 草稿（不含 id / imageIds，由 app.js 补齐） */
  function normalize(raw, cfg) {
    cfg = cfg || {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = {};
    for (const k in raw) {
      const std = keyOf(k);
      if (std && !(std in r)) r[std] = raw[k];
    }
    const now = Date.now();
    const stem = clean(r.stem);
    const opts = (raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options)) ? raw.options : {};
    const options = {
      A: clean(opts.A != null ? opts.A : r.optionA),
      B: clean(opts.B != null ? opts.B : r.optionB),
      C: clean(opts.C != null ? opts.C : r.optionC),
      D: clean(opts.D != null ? opts.D : r.optionD)
    };
    const imgs = normalizeImages(r.images);
    if (!stem && !imgs.list.length) return null; // 题干与图片至少有一项

    const createdAt = parseTime(r.createdAt, now);
    const subject = clean(r.subject) || (cfg.subjects && cfg.subjects[0]) || '未分类';
    const q = {
      externalId: clean(r.externalId),
      stem: stem,
      options: options,
      correctAnswer: clean(r.correctAnswer),
      myAnswer: clean(r.myAnswer),
      cause: clean(r.cause),
      causeExtra: clean(r.causeExtra),
      analysis: clean(r.analysis),
      subject: subject,
      qtype: clean(r.qtype) || (cfg.qtypes && cfg.qtypes[0]) || '单选',
      difficulty: toDifficulty(r.difficulty),
      mastery: toMastery(r.mastery),
      tags: splitTags(r.tags),
      notes: normalizeNotes(r.notes, createdAt),
      images: imgs.list,
      createdAt: createdAt,
      updatedAt: parseTime(r.updatedAt, createdAt),
      fp: ''
    };
    q.fp = fingerprint(q);
    return { item: q, warnings: imgs.warnings };
  }

  /* 自动识别格式并解析。返回：
     { format, items, skipped, errors, warnings, meta, error } */
  function parse(text, cfg) {
    const s = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim();
    const out = { format: null, items: [], skipped: 0, errors: [], warnings: [], meta: {}, error: null };
    if (!s) { out.error = '内容为空'; return out; }

    let rawList = [], data = null, ok = false;

    if (s.charAt(0) === '[' || s.charAt(0) === '{') {
      try { data = JSON.parse(s); ok = true; } catch (e) { ok = false; }
      if (!ok) {
        // JSONL：每行一个 JSON 对象（便于自动化脚本逐行追加）
        const lines = s.split(/\r?\n/).filter(l => l.trim());
        if (lines.length > 1 && lines.every(l => l.trim().charAt(0) === '{')) {
          out.format = 'jsonl';
          lines.forEach((l, i) => {
            try { rawList.push(JSON.parse(l)); }
            catch (e) { out.errors.push('第 ' + (i + 1) + ' 行 JSON 解析失败：' + e.message); }
          });
        } else {
          out.format = 'json';
          out.error = 'JSON 解析失败，请检查逗号与引号是否完整';
          return out;
        }
      } else {
        out.format = 'json';
        if (Array.isArray(data)) rawList = data;
        else if (data && typeof data === 'object') {
          if (data.format && data.format !== FORMAT) {
            out.error = '这不是批量导入文件（format=' + String(data.format) + '，应为 ' + FORMAT + '）';
            return out;
          }
          const ver = data.version == null ? VERSION : Number(data.version);
          if (ver !== VERSION) {
            out.error = '不支持的格式版本 v' + String(data.version) + '，当前支持 v' + VERSION;
            return out;
          }
          out.meta = { source: data.source || '', generatedAt: data.generatedAt || '' };
          if (Array.isArray(data.questions)) rawList = data.questions;
          else if (Array.isArray(data.items)) rawList = data.items;
          else if (data.stem || Object.keys(data).some(k => keyOf(k) === 'stem')) rawList = [data];
          else { out.error = 'JSON 需含 questions 数组（或为数组 / 单条错题）'; return out; }
        } else { out.error = 'JSON 顶层结构不正确'; return out; }
      }
    } else {
      out.format = 'csv';
      const rows = parseCSV(s);
      if (rows.length < 2) { out.error = 'CSV 至少需要表头 + 一行数据'; return out; }
      const head = rows[0].map(h => String(h).trim().replace(/^\uFEFF/, ''));
      if (!head.filter(h => keyOf(h)).length) { out.error = 'CSV 表头未识别到任何已知字段，请下载模板'; return out; }
      for (let i = 1; i < rows.length; i++) {
        const obj = {};
        head.forEach((h, j) => { if (h) obj[h] = rows[i][j]; });
        rawList.push(obj);
      }
    }

    if (rawList.length > MAX_ITEMS) {
      out.error = '单次最多导入 ' + MAX_ITEMS + ' 条，当前 ' + rawList.length + ' 条，请拆分文件';
      return out;
    }

    rawList.forEach((raw, i) => {
      const res = normalize(raw, cfg || {});
      if (!res) { out.errors.push('第 ' + (i + 1) + ' 条：缺少题干且没有图片，已跳过'); return; }
      out.items.push(res.item);
      res.warnings.forEach(w => out.warnings.push('第 ' + (i + 1) + ' 条：' + w));
    });
    out.skipped = out.errors.length;
    if (!out.items.length) out.error = out.errors[0] || '没有可导入的有效错题';
    return out;
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function csvTemplate(cfg) {
    cfg = cfg || {};
    const s = cfg.subjects && cfg.subjects[0] || '数学';
    const t = cfg.qtypes && cfg.qtypes[0] || '单选';
    const c = cfg.causes && cfg.causes[0] || '审题粗心';
    const head = ['externalId', '题干', '科目', '题型', '选项A', '选项B', '选项C', '选项D',
      '正确答案', '我的答案', '错因', '错因说明', '解析', '难度', '掌握状态', '标签', '备考备注', '录入时间'];
    const ex1 = ['math-2026-11-16-001', '已知二次函数 f(x)=x²-2x+3，求其最小值', s, t,
      '1', '2', '3', '4', 'B', 'A', c, '看漏条件', '配方得 f(x)=(x-1)²+2', '3', '未掌握', '月考|压轴题', '端点也要比较', ''];
    const ex2 = ['eng-2026-11-16-002', 'The manager suggested that the meeting ____ until next Friday.',
      '英语', '填空', '', '', '', '', 'B', '', '知识点不会', '', 'suggest 后用动词原形', '4', '模糊', '高频错题', '', ''];
    return '\uFEFF' + [head, ex1, ex2].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function jsonTemplate(cfg) {
    cfg = cfg || {};
    const iso = new Date().toISOString();
    return JSON.stringify({
      format: FORMAT,
      version: VERSION,
      generatedAt: iso,
      source: 'your-automation',
      questions: [{
        externalId: 'math-2026-11-16-001',
        stem: '已知二次函数 f(x)=x²-2x+3，求其最小值',
        options: { A: '1', B: '2', C: '3', D: '4' },
        correctAnswer: 'B',
        myAnswer: 'A',
        cause: cfg.causes && cfg.causes[0] || '审题粗心',
        causeExtra: '看漏了定义域',
        analysis: '配方得 f(x)=(x-1)²+2，最小值为 2',
        subject: cfg.subjects && cfg.subjects[0] || '数学',
        qtype: cfg.qtypes && cfg.qtypes[0] || '单选',
        difficulty: 3,
        mastery: 'unmastered',
        tags: ['月考', '压轴题'],
        notes: ['老师补充：端点也要比较'],
        createdAt: iso,
        updatedAt: iso,
        images: []
      }]
    }, null, 2);
  }

  global.Batch = {
    FORMAT: FORMAT, VERSION: VERSION, MAX_ITEMS: MAX_ITEMS,
    parse: parse, parseCSV: parseCSV, normalize: normalize, fingerprint: fingerprint,
    csvTemplate: csvTemplate, jsonTemplate: jsonTemplate,
    keyOf: keyOf, MASTERY_ALIAS: MASTERY_ALIAS
  };
})(window);
