/* ============================================================
   db.js — local persistence (IndexedDB), schema v1
   All data stays on this device. No network calls anywhere.
   ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'cuotiben';
  const DB_VERSION = 2;
  const SCHEMA = 1;

  const DEFAULT_CONFIG = {
    subjects: ['数学', '物理', '英语', '语文', '化学', '生物'],
    qtypes: ['单选', '多选', '填空', '解答', '实验', '作文'],
    causes: ['审题粗心', '知识点不会', '计算失误', '概念混淆', '公式记错', '其他'],
    tags: ['月考', '期中', '压轴题', '高频错题'],
    theme: 'dark',
    hideMastered: false,
    backupDir: 'Download/错题本备份',
    schema: SCHEMA
  };

  let _db = null;
  let _memory = null; // fallback when IndexedDB is unavailable (e.g. some file:// contexts)

  function open() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('questions')) {
          const s = db.createObjectStore('questions', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
          s.createIndex('updatedAt', 'updatedAt');
          s.createIndex('subject', 'subject');
        }
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('pdfs')) db.createObjectStore('pdfs', { keyPath: 'id' });
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error || new Error('打开数据库失败'));
      req.onblocked = () => reject(new Error('数据库被其他页面占用'));
    });
  }

  function reqDone(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  function txDone(tx) {
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('事务被中止'));
    });
  }

  function useMemory() {
    _memory = { questions: new Map(), images: new Map(), pdfs: new Map(), config: null };
    return Promise.resolve();
  }

  async function init() {
    try { await open(); }
    catch (e) {
      console.warn('[db] IndexedDB 不可用，使用内存存储：', e.message);
      await useMemory();
    }
    if (!_memory) {
      const cfg = await getConfig();
      if (!cfg) await putConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
    } else if (!_memory.config) {
      _memory.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    return true;
  }

  const isMemory = () => !!_memory;

  /* ---------------- config ---------------- */
  async function getConfig() {
    if (_memory) return _memory.config;
    const r = _db.transaction('config', 'readonly').objectStore('config').get('main');
    const v = await reqDone(r);
    if (!v) return null;
    const merged = Object.assign({}, DEFAULT_CONFIG, v.value);
    ['subjects', 'qtypes', 'causes', 'tags'].forEach(k => {
      if (!Array.isArray(merged[k])) merged[k] = DEFAULT_CONFIG[k].slice();
    });
    return merged;
  }
  async function putConfig(cfg) {
    const c = Object.assign({}, cfg, { schema: SCHEMA });
    if (_memory) { _memory.config = c; return c; }
    const tx = _db.transaction('config', 'readwrite');
    tx.objectStore('config').put({ key: 'main', value: c });
    await txDone(tx);
    return c;
  }

  /* ---------------- questions ---------------- */
  async function getAllQuestions() {
    if (_memory) return Array.from(_memory.questions.values());
    const r = _db.transaction('questions', 'readonly').objectStore('questions').getAll();
    return await reqDone(r) || [];
  }
  async function getQuestion(id) {
    if (_memory) return _memory.questions.get(id) || null;
    return await reqDone(_db.transaction('questions', 'readonly').objectStore('questions').get(id)) || null;
  }
  async function putQuestion(q) {
    if (_memory) { _memory.questions.set(q.id, q); return q; }
    const tx = _db.transaction('questions', 'readwrite');
    tx.objectStore('questions').put(q);
    await txDone(tx);
    return q;
  }
  async function deleteQuestion(id) {
    if (_memory) { _memory.questions.delete(id); return; }
    const tx = _db.transaction('questions', 'readwrite');
    tx.objectStore('questions').delete(id);
    await txDone(tx);
  }

  /* ---------------- images ---------------- */
  async function getImage(id) {
    if (_memory) return _memory.images.get(id) || null;
    return await reqDone(_db.transaction('images', 'readonly').objectStore('images').get(id)) || null;
  }
  async function getAllImages() {
    if (_memory) return Array.from(_memory.images.values());
    return await reqDone(_db.transaction('images', 'readonly').objectStore('images').getAll()) || [];
  }
  async function putImage(img) {
    if (_memory) { _memory.images.set(img.id, img); return img; }
    const tx = _db.transaction('images', 'readwrite');
    tx.objectStore('images').put(img);
    await txDone(tx);
    return img;
  }
  async function deleteImage(id) {
    if (_memory) { _memory.images.delete(id); return; }
    const tx = _db.transaction('images', 'readwrite');
    tx.objectStore('images').delete(id);
    await txDone(tx);
  }

  /* ---------------- pdfs ----------------
     Imported PDF files kept as ArrayBuffer so they can be viewed offline. */
  async function getPdf(id) {
    if (_memory) return _memory.pdfs.get(id) || null;
    return await reqDone(_db.transaction('pdfs', 'readonly').objectStore('pdfs').get(id)) || null;
  }
  async function getAllPdfs() {
    if (_memory) return Array.from(_memory.pdfs.values());
    return await reqDone(_db.transaction('pdfs', 'readonly').objectStore('pdfs').getAll()) || [];
  }
  async function putPdf(pdf) {
    if (_memory) { _memory.pdfs.set(pdf.id, pdf); return pdf; }
    const tx = _db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').put(pdf);
    await txDone(tx);
    return pdf;
  }
  async function deletePdf(id) {
    if (_memory) { _memory.pdfs.delete(id); return; }
    const tx = _db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').delete(id);
    await txDone(tx);
  }

  /* ---------------- atomic composite operations ----------------
     A question + its images are written in ONE readwrite transaction.
     If anything fails, the whole write rolls back (no half records). */
  async function saveQuestionBundle(question, newImages, removedImageIds) {
    if (_memory) {
      (newImages || []).forEach(im => _memory.images.set(im.id, im));
      (removedImageIds || []).forEach(id => _memory.images.delete(id));
      _memory.questions.set(question.id, question);
      return question;
    }
    const tx = _db.transaction(['questions', 'images'], 'readwrite');
    const qs = tx.objectStore('questions');
    const is = tx.objectStore('images');
    (newImages || []).forEach(im => is.put(im));
    (removedImageIds || []).forEach(id => is.delete(id));
    qs.put(question);
    await txDone(tx);
    return question;
  }

  async function deleteQuestionBundle(id) {
    const q = await getQuestion(id);
    const imageIds = (q && q.imageIds) || [];
    if (_memory) {
      _memory.questions.delete(id);
      imageIds.forEach(x => _memory.images.delete(x));
      return q;
    }
    const tx = _db.transaction(['questions', 'images'], 'readwrite');
    tx.objectStore('questions').delete(id);
    const is = tx.objectStore('images');
    imageIds.forEach(x => is.delete(x));
    await txDone(tx);
    return q;
  }

  /* ---------------- batch import ----------------
     One readwrite transaction for questions + images + config, so a batch is
     all-or-nothing. Used by the JSON/CSV bulk importer. */
  async function bulkImport(questions, images, config) {
    questions = questions || [];
    images = images || [];
    if (_memory) {
      images.forEach(im => _memory.images.set(im.id, im));
      questions.forEach(q => _memory.questions.set(q.id, q));
      if (config) _memory.config = config;
      return questions.length;
    }
    const tx = _db.transaction(['questions', 'images', 'config'], 'readwrite');
    const qs = tx.objectStore('questions'), is = tx.objectStore('images'), cs = tx.objectStore('config');
    images.forEach(im => is.put(im));
    questions.forEach(q => qs.put(q));
    if (config) cs.put({ key: 'main', value: config });
    await txDone(tx);
    return questions.length;
  }

  /* Undo a batch import: drop the new records/images and put back the
     overwritten ones, restoring the pre-import config. Single transaction. */
  async function undoImport(removeIds, restoreQuestions, removeImageIds, config) {
    removeIds = removeIds || [];
    restoreQuestions = restoreQuestions || [];
    removeImageIds = removeImageIds || [];
    if (_memory) {
      removeIds.forEach(id => _memory.questions.delete(id));
      removeImageIds.forEach(id => _memory.images.delete(id));
      restoreQuestions.forEach(q => _memory.questions.set(q.id, q));
      if (config) _memory.config = config;
      return;
    }
    const tx = _db.transaction(['questions', 'images', 'config'], 'readwrite');
    const qs = tx.objectStore('questions'), is = tx.objectStore('images'), cs = tx.objectStore('config');
    removeIds.forEach(id => qs.delete(id));
    removeImageIds.forEach(id => is.delete(id));
    restoreQuestions.forEach(q => qs.put(q));
    if (config) cs.put({ key: 'main', value: config });
    await txDone(tx);
  }

  /* ---------------- bulk (backup restore) ---------------- */
  async function replaceAll(questions, images, config) {
    if (_memory) {
      _memory.questions = new Map(questions.map(q => [q.id, q]));
      _memory.images = new Map(images.map(i => [i.id, i]));
      if (config) _memory.config = config;
      return;
    }
    const tx = _db.transaction(['questions', 'images', 'config'], 'readwrite');
    const qs = tx.objectStore('questions'), is = tx.objectStore('images'), cs = tx.objectStore('config');
    qs.clear(); is.clear();
    questions.forEach(q => qs.put(q));
    images.forEach(i => is.put(i));
    if (config) cs.put({ key: 'main', value: config });
    await txDone(tx);
  }

  /* Merge: for duplicate ids keep the record with the newer updatedAt. */
  async function mergeAll(questions, images, config) {
    const existing = await getAllQuestions();
    const map = new Map(existing.map(q => [q.id, q]));
    for (const q of questions) {
      const old = map.get(q.id);
      if (!old || (q.updatedAt || 0) >= (old.updatedAt || 0)) map.set(q.id, q);
    }
    const merged = Array.from(map.values());
    const existingImgs = await getAllImages();
    const imgMap = new Map(existingImgs.map(i => [i.id, i]));
    for (const i of images) if (!imgMap.has(i.id)) imgMap.set(i.id, i);
    const mergedImgs = Array.from(imgMap.values());

    let mergedCfg = null;
    if (config) {
      const cur = await getConfig();
      const c = Object.assign({}, cur);
      ['subjects', 'qtypes', 'causes', 'tags'].forEach(k => {
        if (Array.isArray(config[k])) c[k] = Array.from(new Set((c[k] || []).concat(config[k])));
      });
      mergedCfg = c;
    }
    await replaceAll(merged, mergedImgs, mergedCfg);
    return { questions: merged.length, images: mergedImgs.length };
  }

  async function estimateSize() {
    const [qs, imgs, pdfs] = await Promise.all([getAllQuestions(), getAllImages(), getAllPdfs()]);
    let bytes = 0;
    const count = s => (s ? s.length * 2 : 0); // UTF-16 approximation
    qs.forEach(q => { bytes += count(JSON.stringify(q)); });
    imgs.forEach(i => {
      bytes += Math.round(((i.full || '').length * 3) / 4);
      bytes += Math.round(((i.thumb || '').length * 3) / 4);
    });
    pdfs.forEach(p => { bytes += (p.data && p.data.byteLength) || count(p.data) || 0; });
    return { bytes, questions: qs.length, images: imgs.length, pdfs: pdfs.length };
  }

  /* Remove images not referenced by any question (cache cleanup). */
  async function cleanupOrphanImages() {
    const [qs, imgs] = await Promise.all([getAllQuestions(), getAllImages()]);
    const used = new Set();
    qs.forEach(q => (q.imageIds || []).forEach(id => used.add(id)));
    const orphans = imgs.filter(i => !used.has(i.id));
    if (_memory) {
      orphans.forEach(i => _memory.images.delete(i.id));
      return orphans.length;
    }
    if (!orphans.length) return 0;
    const tx = _db.transaction('images', 'readwrite');
    const is = tx.objectStore('images');
    orphans.forEach(i => is.delete(i.id));
    await txDone(tx);
    return orphans.length;
  }

  /* ---------------- demo data (opt-in from empty state) ---------------- */
  async function seedDemo() {
    const now = Date.now(), D = 86400000;
    const demos = [
      {
        stem: '已知函数 f(x)=x³-3x+1，求其在区间 [-2,2] 上的最大值与最小值。',
        options: { A: '', B: '', C: '', D: '' },
        correctAnswer: '最大值为 3，最小值为 -1。令 f′(x)=3x²-3=0 得 x=±1，比较端点与极值点函数值。',
        myAnswer: '只算了 f′(x)=0 的两个点，忘了检查区间端点。',
        cause: '审题粗心', causeExtra: '', analysis: '求闭区间最值必须同时比较驻点和端点，不能只解导数方程。',
        subject: '数学', qtype: '解答', difficulty: 4, mastery: 'unmastered', tags: ['月考', '压轴题'],
        createdAt: now - 1 * D, updatedAt: now - 1 * D
      },
      {
        stem: '一物体从静止开始做匀加速直线运动，第 3 秒内位移为 5m，求加速度 a。',
        options: { A: '1 m/s²', B: '2 m/s²', C: '2.5 m/s²', D: '5 m/s²' },
        correctAnswer: 'B', myAnswer: 'D',
        cause: '概念混淆', causeExtra: '', analysis: '第 3 秒内位移 = 前 3 秒位移 − 前 2 秒位移 = (1/2)a(9−4)=2.5a=5，故 a=2 m/s²。',
        subject: '物理', qtype: '单选', difficulty: 3, mastery: 'fuzzy', tags: ['高频错题'],
        createdAt: now - 2 * D, updatedAt: now - 2 * D
      },
      {
        stem: 'The manager suggested that the meeting ____ until next Friday.',
        options: { A: 'will be postponed', B: 'be postponed', C: 'is postponed', D: 'would postpone' },
        correctAnswer: 'B', myAnswer: 'A',
        cause: '知识点不会', causeExtra: '', analysis: 'suggest 表示"建议"时，宾语从句用 (should) + 动词原形的虚拟语气，且 meeting 与 postpone 是被动关系。',
        subject: '英语', qtype: '单选', difficulty: 2, mastery: 'mastered', tags: ['期中'],
        createdAt: now - 5 * D, updatedAt: now - 3 * D
      },
      {
        stem: '实验室配制 100mL 0.1mol/L 的 NaCl 溶液，下列操作会导致浓度偏低的是？',
        options: { A: '定容时俯视刻度线', B: '转移时少量溶液洒出', C: '容量瓶未干燥', D: '砝码生锈' },
        correctAnswer: 'B', myAnswer: 'A',
        cause: '概念混淆', causeExtra: '', analysis: '俯视定容使液面低于刻度线，体积偏小、浓度偏高；溶液洒出使溶质减少，浓度偏低。',
        subject: '化学', qtype: '多选', difficulty: 3, mastery: 'unmastered', tags: ['实验'],
        createdAt: now - 8 * D, updatedAt: now - 8 * D
      },
      {
        stem: '求数列 aₙ = 1/(n(n+1)) 的前 n 项和 Sₙ。',
        options: { A: '', B: '', C: '', D: '' },
        correctAnswer: 'Sₙ = n/(n+1)，用裂项相消：aₙ = 1/n − 1/(n+1)。',
        myAnswer: '直接套等差数列公式算错了。',
        cause: '公式记错', causeExtra: '', analysis: '分式型数列先观察能否裂项，不要盲目套用等差/等比求和公式。',
        subject: '数学', qtype: '填空', difficulty: 2, mastery: 'fuzzy', tags: ['高频错题'],
        createdAt: now - 14 * D, updatedAt: now - 14 * D
      },
      {
        stem: '下列关于细胞有丝分裂的叙述，正确的是？',
        options: { A: '前期核膜核仁消失', B: '中期染色体数目加倍', C: '后期 DNA 数目加倍', D: '末期出现细胞板' },
        correctAnswer: 'A', myAnswer: 'B',
        cause: '知识点不会', causeExtra: '', analysis: '染色体数目加倍发生在后期着丝点分裂时；DNA 加倍在间期；植物细胞末期才形成细胞板。',
        subject: '生物', qtype: '单选', difficulty: 3, mastery: 'unmastered', tags: [],
        createdAt: now - 21 * D, updatedAt: now - 21 * D
      }
    ];
    const cfg = await getConfig();
    const tagAdd = ['实验'];
    tagAdd.forEach(t => { if (!cfg.tags.includes(t)) cfg.tags.push(t); });
    await putConfig(cfg);
    for (const d of demos) {
      await putQuestion(Object.assign({ id: U.uid('q'), imageIds: [], notes: [] }, d));
    }
    return demos.length;
  }

  global.DB = {
    init, isMemory, SCHEMA, DEFAULT_CONFIG,
    getConfig, putConfig,
    getAllQuestions, getQuestion, putQuestion, deleteQuestion,
    getImage, getAllImages, putImage, deleteImage,
    getPdf, getAllPdfs, putPdf, deletePdf,
    saveQuestionBundle, deleteQuestionBundle,
    bulkImport, undoImport,
    replaceAll, mergeAll, estimateSize, cleanupOrphanImages, seedDemo
  };
})(window);
