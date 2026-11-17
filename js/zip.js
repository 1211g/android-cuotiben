/* ============================================================
   zip.js — minimal ZIP (store) writer / reader, no dependencies
   Used for the offline backup package (data.json + images/*).
   ============================================================ */
(function (global) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const strBytes = s => enc.encode(s);
  const jsonBytes = o => strBytes(JSON.stringify(o));

  function dosTime(d) { return (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); }
  function dosDate(d) { return ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(); }

  function concat(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  /* files: [{ name: 'data.json', data: Uint8Array }] */
  function createZip(files) {
    const now = new Date();
    const time = dosTime(now), date = dosDate(now);
    const locals = [], centrals = [];
    let offset = 0;
    const FLAG = 0x0800; // UTF-8 filenames

    for (const f of files) {
      const name = strBytes(f.name);
      const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      const crc = crc32(data);

      const lh = new Uint8Array(30);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, FLAG, true);
      lv.setUint16(8, 0, true);            // stored
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      locals.push(lh, name, data);

      const ch = new Uint8Array(46);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, FLAG, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      centrals.push(ch, name);

      offset += lh.length + name.length + data.length;
    }

    const cd = concat(centrals);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cd.length, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([concat(locals), cd, eocd], { type: 'application/zip' });
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持解压该压缩包（deflate），请用本应用导出的备份包');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* Returns [{ name, data: Uint8Array, text() }] */
  async function readZip(arrayBuffer) {
    const buf = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    // locate EOCD
    let eocd = -1;
    const min = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 备份包');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);

    const out = [];
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('备份包目录损坏');
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const fnLen = view.getUint16(p + 28, true);
      const exLen = view.getUint16(p + 30, true);
      const cmLen = view.getUint16(p + 32, true);
      const localOff = view.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + fnLen));
      p += 46 + fnLen + exLen + cmLen;

      if (view.getUint32(localOff, true) !== 0x04034b50) throw new Error('备份包文件头损坏');
      const lfnLen = view.getUint16(localOff + 26, true);
      const lexLen = view.getUint16(localOff + 28, true);
      const start = localOff + 30 + lfnLen + lexLen;
      let data = buf.subarray(start, start + compSize);
      if (method === 8) data = await inflateRaw(data);
      else if (method !== 0) throw new Error('不支持的压缩方式：' + method);
      out.push({
        name,
        data,
        text() { return dec.decode(this.data); },
        json() { return JSON.parse(this.text()); }
      });
    }
    return out;
  }

  global.Zip = { createZip, readZip, strBytes, jsonBytes, crc32 };
})(window);
